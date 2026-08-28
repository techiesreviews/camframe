import { readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  app,
  BrowserWindow,
  dialog,
  globalShortcut,
  ipcMain,
  Menu,
  nativeImage,
  screen,
  session,
  Tray,
} from 'electron'
import {
  DEFAULT_SETTINGS,
  overlayDimensionsFor,
  mergePresets,
  reorderPresets,
  resizeOverlayFromCorner,
  sanitizeSettings,
  settingsForPreset,
  settingsWithLivePosition,
  settingsPatchChangesOverlayGeometry,
  startupSettings,
} from './settings.js'
import {
  CURRENT_ONBOARDING_VERSION,
  ONBOARDING_TOP_RESERVE,
  completedOnboardingVersionForLoad,
} from './onboarding.js'
import {
  alwaysOnTopLevelFor,
  fullscreenWindowPlan,
  interpolateWindowBounds,
  isFullscreenExitInput,
  overlayBoundsTransitionPlan,
} from './fullscreen.js'

const currentDirectory = dirname(fileURLToPath(import.meta.url))
const preferencesPath = () => join(app.getPath('userData'), 'preferences.json')
const alwaysOnTopLevel = alwaysOnTopLevelFor(process.platform)

let overlayWindow
let tray
let saveTimer
let settings = { ...DEFAULT_SETTINGS }
let overlayInteractive = false
let dragTimer
let dragOffset
let resizeTimer
let resizeStart
let overlayFullscreen = false
let overlayNormalBounds
let overlayBoundsAnimation
let overlayBoundsAnimationTarget
let overlayBoundsAnimationComplete
let overlayTransitioning = false
let overlayOnboardingOpen = false
let activePresetId = ''
let reducedMotion = false

function loadSettings() {
  try {
    const saved = JSON.parse(readFileSync(preferencesPath(), 'utf8'))
    if ((saved.schemaVersion ?? 0) < 3) {
      saved.borderWidth = 0
      saved.size = DEFAULT_SETTINGS.size
    }
    saved.completedOnboardingVersion = completedOnboardingVersionForLoad(saved, true)
    settings = startupSettings(saved)
  } catch {
    settings = startupSettings()
  }
}

function saveSettings() {
  clearTimeout(saveTimer)
  saveTimer = setTimeout(() => {
    writeFileSync(preferencesPath(), JSON.stringify(settings, null, 2), 'utf8')
  }, 120)
}

function emitState() {
  const state = { ...settings, activePresetId }
  overlayWindow?.webContents.send('state:changed', state)
}

function showPresentationNotice(message) {
  overlayWindow?.webContents.send('presentation:notice', String(message).slice(0, 80))
}

function applyLaunchAtLoginSetting() {
  if (!app.isPackaged) return
  app.setLoginItemSettings({ openAtLogin: settings.launchAtLogin })
}

function baseBoundsFromOverlayWindow(bounds) {
  if (!overlayOnboardingOpen) return { ...bounds }
  return {
    ...bounds,
    y: bounds.y + ONBOARDING_TOP_RESERVE,
    height: Math.max(1, bounds.height - ONBOARDING_TOP_RESERVE),
  }
}

function overlayWindowBoundsFromBase(bounds) {
  if (!overlayOnboardingOpen) return { ...bounds }
  return {
    ...bounds,
    y: bounds.y - ONBOARDING_TOP_RESERVE,
    height: bounds.height + ONBOARDING_TOP_RESERVE,
  }
}

function overlayBounds({ keepCenter = true } = {}) {
  const nextSize = overlayDimensionsFor(settings)
  const currentWindowBounds = overlayWindow?.getBounds()
  const current = currentWindowBounds
    ? baseBoundsFromOverlayWindow(currentWindowBounds)
    : undefined
  const primary = screen.getPrimaryDisplay().workArea

  if (!current) {
    const fallbackPosition = {
      x: primary.x + primary.width - nextSize.width - 36,
      y: primary.y + primary.height - nextSize.height - 36,
    }
    return overlayWindowBoundsFromBase({
      ...nextSize,
      ...(settings.position ?? fallbackPosition),
    })
  }

  if (!keepCenter) {
    const position = settings.position ?? { x: current.x, y: current.y }
    return overlayWindowBoundsFromBase({ ...nextSize, ...position })
  }
  return overlayWindowBoundsFromBase({
    x: Math.round(current.x + (current.width - nextSize.width) / 2),
    y: Math.round(current.y + (current.height - nextSize.height) / 2),
    ...nextSize,
  })
}

function setOverlayOnboardingLayout(open) {
  if (!overlayWindow || overlayWindow.isDestroyed() || overlayFullscreen || overlayTransitioning) {
    return 0
  }
  const nextOpen = Boolean(open)
  if (nextOpen === overlayOnboardingOpen) {
    return nextOpen ? ONBOARDING_TOP_RESERVE : 0
  }

  if (nextOpen) {
    const baseBounds = overlayWindow.getBounds()
    overlayOnboardingOpen = true
    overlayWindow.setBounds(overlayWindowBoundsFromBase(baseBounds))
    return ONBOARDING_TOP_RESERVE
  }

  const baseBounds = baseBoundsFromOverlayWindow(overlayWindow.getBounds())
  overlayOnboardingOpen = false
  settings.position = { x: baseBounds.x, y: baseBounds.y }
  overlayWindow.setBounds({ ...baseBounds, ...overlayDimensionsFor(settings) })
  saveSettings()
  return 0
}

function applyOverlayWindow({ keepCenter = true, updateBounds = true } = {}) {
  if (!overlayWindow || overlayWindow.isDestroyed()) return

  if (updateBounds && !overlayFullscreen && !overlayTransitioning) {
    overlayWindow.setBounds(overlayBounds({ keepCenter }))
  }
  applyOverlayZOrder()

  if (settings.overlayVisible) overlayWindow.showInactive()
  else {
    stopOverlayDrag()
    setOverlayInteractive(false)
    overlayWindow.hide()
  }
}

function setOverlayInteractive(interactive) {
  if (!overlayWindow || overlayWindow.isDestroyed() || overlayInteractive === interactive) return
  overlayInteractive = interactive
  overlayWindow.setIgnoreMouseEvents(!interactive, { forward: !interactive })
}

function stopOverlayDrag() {
  clearInterval(dragTimer)
  dragTimer = undefined
  dragOffset = undefined
}

function applyOverlayZOrder({
  raise = false,
  stayOnTop = overlayFullscreen || settings.alwaysOnTop,
} = {}) {
  if (!overlayWindow || overlayWindow.isDestroyed()) return
  overlayWindow.setAlwaysOnTop(stayOnTop, alwaysOnTopLevel)
  if (raise && stayOnTop) overlayWindow.moveTop()
}

function stopOverlayResize() {
  clearInterval(resizeTimer)
  resizeTimer = undefined
  resizeStart = undefined
  saveSettings()
}

function startOverlayResize(handle) {
  const handles = new Set(['top-left', 'top-right', 'bottom-left', 'bottom-right'])
  if (!overlayWindow || overlayWindow.isDestroyed() || overlayFullscreen || !handles.has(handle)) return
  stopOverlayDrag()
  stopOverlayResize()
  setOverlayInteractive(true)
  resizeStart = {
    handle,
    cursor: screen.getCursorScreenPoint(),
    bounds: baseBoundsFromOverlayWindow(overlayWindow.getBounds()),
    settings: { ...settings },
  }
  resizeTimer = setInterval(() => {
    if (!overlayWindow || overlayWindow.isDestroyed() || !resizeStart) {
      stopOverlayResize()
      return
    }
    const cursor = screen.getCursorScreenPoint()
    const patch = resizeOverlayFromCorner(
      resizeStart.settings,
      resizeStart.bounds,
      resizeStart.handle,
      { x: cursor.x - resizeStart.cursor.x, y: cursor.y - resizeStart.cursor.y },
    )
    settings = sanitizeSettings({ ...settings, ...patch })
    applyOverlayWindow({ keepCenter: false })
    emitState()
  }, 16)
}

function startOverlayDrag() {
  if (!overlayWindow || overlayWindow.isDestroyed() || overlayFullscreen) return
  stopOverlayDrag()
  setOverlayInteractive(true)

  const cursor = screen.getCursorScreenPoint()
  const [windowX, windowY] = overlayWindow.getPosition()
  dragOffset = { x: cursor.x - windowX, y: cursor.y - windowY }
  dragTimer = setInterval(() => {
    if (!overlayWindow || overlayWindow.isDestroyed() || !dragOffset) {
      stopOverlayDrag()
      return
    }
    const nextCursor = screen.getCursorScreenPoint()
    overlayWindow.setPosition(nextCursor.x - dragOffset.x, nextCursor.y - dragOffset.y)
  }, 16)
}

function emitFullscreen() {
  overlayWindow?.webContents.send('fullscreen:changed', overlayFullscreen)
}

function stopOverlayBoundsAnimation() {
  clearInterval(overlayBoundsAnimation)
  overlayBoundsAnimation = undefined
  overlayBoundsAnimationTarget = undefined
  overlayBoundsAnimationComplete = undefined
  overlayTransitioning = false
}

function finishOverlayBoundsAnimation() {
  const targetBounds = overlayBoundsAnimationTarget
  const onComplete = overlayBoundsAnimationComplete
  stopOverlayBoundsAnimation()
  if (!targetBounds || !overlayWindow || overlayWindow.isDestroyed()) return
  overlayWindow.setBounds(targetBounds)
  onComplete?.()
}

function animateOverlayBounds(targetBounds, onComplete) {
  if (!overlayWindow || overlayWindow.isDestroyed()) return
  stopOverlayBoundsAnimation()
  const plan = overlayBoundsTransitionPlan(targetBounds, reducedMotion)
  if (plan.durationMs === 0) {
    overlayWindow.setBounds(plan.bounds)
    onComplete?.()
    return
  }

  const startBounds = overlayWindow.getBounds()
  const startedAt = Date.now()
  overlayBoundsAnimationTarget = plan.bounds
  overlayBoundsAnimationComplete = onComplete
  overlayTransitioning = true

  const updateFrame = () => {
    if (!overlayWindow || overlayWindow.isDestroyed()) {
      stopOverlayBoundsAnimation()
      return
    }
    const progress = Math.min(1, (Date.now() - startedAt) / plan.durationMs)
    overlayWindow.setBounds(interpolateWindowBounds(startBounds, plan.bounds, progress))
    if (progress < 1) return
    finishOverlayBoundsAnimation()
  }

  updateFrame()
  if (overlayTransitioning) overlayBoundsAnimation = setInterval(updateFrame, 16)
}

function setOverlayFullscreen(fullscreen) {
  if (!overlayWindow || overlayWindow.isDestroyed()) return
  const nextFullscreen = Boolean(fullscreen)
  if (nextFullscreen === overlayFullscreen) return

  if (nextFullscreen) {
    overlayNormalBounds ??= overlayWindow.getBounds()
    overlayFullscreen = true
    stopOverlayDrag()
    stopOverlayResize()

    const displayBounds = screen.getDisplayMatching(overlayNormalBounds).bounds
    const plan = fullscreenWindowPlan({
      fullscreen: true,
      normalBounds: overlayNormalBounds,
      displayBounds,
      alwaysOnTop: settings.alwaysOnTop,
      visible: settings.overlayVisible,
    })
    applyOverlayZOrder({ stayOnTop: plan.alwaysOnTop })
    overlayWindow.show()
    setOverlayInteractive(true)
    emitFullscreen()
    overlayWindow.focus()
    animateOverlayBounds(plan.bounds)
    return
  }

  const nextSize = overlayDimensionsFor(settings)
  const normalBounds = overlayNormalBounds
    ? { ...overlayNormalBounds, ...nextSize }
    : overlayBounds({ keepCenter: false })
  overlayFullscreen = false
  const plan = fullscreenWindowPlan({
    fullscreen: false,
    normalBounds,
    displayBounds: screen.getDisplayMatching(normalBounds).bounds,
    alwaysOnTop: settings.alwaysOnTop,
    visible: settings.overlayVisible,
  })
  applyOverlayZOrder({ stayOnTop: true })
  overlayWindow.show()
  emitFullscreen()
  animateOverlayBounds(plan.bounds, () => {
    if (overlayFullscreen || !overlayWindow || overlayWindow.isDestroyed()) return
    applyOverlayZOrder({ stayOnTop: plan.alwaysOnTop })
    if (plan.visible) {
      overlayWindow.showInactive()
      applyOverlayZOrder({ raise: true })
    } else overlayWindow.hide()
    overlayNormalBounds = undefined
  })
}

function updateSettings(patch) {
  const updateBounds = settingsPatchChangesOverlayGeometry(patch)
  activePresetId = ''
  settings = sanitizeSettings({ ...settings, ...patch })
  if (Object.hasOwn(patch, 'launchAtLogin')) applyLaunchAtLoginSetting()
  applyOverlayWindow({ updateBounds })
  emitState()
  setTrayMenu()
  saveSettings()
}

function savePreset(nameInput, idInput = '') {
  const name = String(nameInput ?? '').trim().slice(0, 40)
  if (!name) return

  const liveBounds = overlayWindow?.getBounds()
  settings = settingsWithLivePosition(
    settings,
    liveBounds ? baseBoundsFromOverlayWindow(liveBounds) : undefined,
    overlayFullscreen,
  )

  const requestedId = String(idInput ?? '')
  const existing =
    settings.presets.find((preset) => preset.id === requestedId) ??
    settings.presets.find(
      (preset) => preset.name.toLocaleLowerCase() === name.toLocaleLowerCase(),
    )
  const preset = {
    id: existing?.id ?? `preset-${Date.now().toString(36)}`,
    name,
    settings: settingsForPreset(settings),
  }
  const existingIndex = settings.presets.findIndex((candidate) => candidate.id === preset.id)
  const presets =
    existingIndex >= 0
      ? settings.presets.map((candidate, index) => (index === existingIndex ? preset : candidate))
      : [...settings.presets.slice(-5), preset]
  settings = sanitizeSettings({ ...settings, presets })
  activePresetId = preset.id
  emitState()
  setTrayMenu()
  showPresentationNotice(`${name} saved`)
  saveSettings()
}

function reorderPreset(idInput, directionInput) {
  const id = String(idInput ?? '')
  const direction = Number(directionInput)
  const presets = reorderPresets(settings.presets, id, direction)
  if (presets.every((preset, index) => preset.id === settings.presets[index]?.id)) return
  settings = sanitizeSettings({ ...settings, presets })
  emitState()
  setTrayMenu()
  saveSettings()
}

async function exportPresets() {
  const result = await dialog.showSaveDialog({
    title: 'Export CamFrame scenes',
    defaultPath: 'CamFrame-scenes.json',
    filters: [{ name: 'CamFrame scenes', extensions: ['json'] }],
  })
  if (result.canceled || !result.filePath) return { canceled: true }
  const payload = { format: 'camframe-scenes', version: 1, scenes: settings.presets }
  writeFileSync(result.filePath, JSON.stringify(payload, null, 2), 'utf8')
  showPresentationNotice('Scenes exported')
  return { canceled: false, count: settings.presets.length }
}

async function importPresets() {
  const result = await dialog.showOpenDialog({
    title: 'Import CamFrame scenes',
    properties: ['openFile'],
    filters: [{ name: 'CamFrame scenes', extensions: ['json'] }],
  })
  if (result.canceled || !result.filePaths[0]) return { canceled: true }

  try {
    const payload = JSON.parse(readFileSync(result.filePaths[0], 'utf8'))
    const source = Array.isArray(payload) ? payload : (payload.scenes ?? payload.presets)
    const imported = sanitizeSettings({ presets: source }).presets
    if (!imported.length) return { canceled: false, error: 'No valid scenes found.' }
    const presets = mergePresets(settings.presets, imported)
    settings = sanitizeSettings({ ...settings, presets })
    emitState()
    setTrayMenu()
    saveSettings()
    showPresentationNotice(`${imported.length} scene${imported.length === 1 ? '' : 's'} imported`)
    return { canceled: false, count: imported.length }
  } catch {
    return { canceled: false, error: 'That file is not a valid CamFrame scene export.' }
  }
}

function applyPreset(idInput) {
  const id = String(idInput ?? '')
  const preset = settings.presets.find((candidate) => candidate.id === id)
  if (!preset) return

  settings = sanitizeSettings({ ...settings, ...preset.settings, presets: settings.presets })
  activePresetId = preset.id
  const animateScene =
    overlayWindow && !overlayWindow.isDestroyed() && !overlayFullscreen && settings.overlayVisible
  if (animateScene) {
    const targetBounds = overlayBounds({ keepCenter: false })
    applyOverlayZOrder()
    overlayWindow.showInactive()
    emitState()
    animateOverlayBounds(targetBounds)
  } else {
    applyOverlayWindow({ keepCenter: false })
    emitState()
  }
  setTrayMenu()
  showPresentationNotice(preset.name)
  saveSettings()
}

function cyclePreset() {
  if (!settings.presets.length) {
    showPresentationNotice('No saved scenes')
    return
  }
  const currentIndex = settings.presets.findIndex((preset) => preset.id === activePresetId)
  const nextPreset = settings.presets[(currentIndex + 1) % settings.presets.length]
  applyPreset(nextPreset.id)
}

function deletePreset(idInput) {
  const id = String(idInput ?? '')
  const presets = settings.presets.filter((preset) => preset.id !== id)
  if (presets.length === settings.presets.length) return
  settings = sanitizeSettings({ ...settings, presets })
  if (activePresetId === id) activePresetId = ''
  emitState()
  setTrayMenu()
  showPresentationNotice('Scene deleted')
  saveSettings()
}

function showControls() {
  settings.overlayVisible = true
  applyOverlayWindow()
  emitState()
  setOverlayInteractive(true)
  overlayWindow?.webContents.send('controls:show')
  saveSettings()
}

function showOnboarding() {
  settings.overlayVisible = true
  applyOverlayWindow()
  emitState()
  setOverlayInteractive(true)
  overlayWindow?.show()
  overlayWindow?.focus()
  overlayWindow?.webContents.send('onboarding:show')
  setTrayMenu()
  saveSettings()
}

function completeOnboarding() {
  if (settings.completedOnboardingVersion >= CURRENT_ONBOARDING_VERSION) return
  settings = sanitizeSettings({
    ...settings,
    completedOnboardingVersion: CURRENT_ONBOARDING_VERSION,
  })
  emitState()
  saveSettings()
}

function createOverlayWindow() {
  const bounds = overlayBounds({ keepCenter: false })
  overlayWindow = new BrowserWindow({
    ...bounds,
    show: false,
    frame: false,
    transparent: true,
    resizable: false,
    movable: true,
    minimizable: false,
    maximizable: false,
    fullscreenable: false,
    skipTaskbar: true,
    hasShadow: false,
    backgroundColor: '#00000000',
    webPreferences: {
      preload: join(currentDirectory, 'preload.cjs'),
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
      backgroundThrottling: false,
    },
  })

  overlayWindow.loadFile(join(currentDirectory, 'overlay.html'))
  applyOverlayZOrder()
  overlayWindow.setIgnoreMouseEvents(true, { forward: true })

  overlayWindow.once('ready-to-show', () => {
    emitState()
    emitFullscreen()
    if (settings.overlayVisible) overlayWindow.showInactive()
  })

  overlayWindow.on('blur', () => {
    setTimeout(() => applyOverlayZOrder({ raise: true }), 0)
  })

  overlayWindow.webContents.on('before-input-event', (event, input) => {
    if (!overlayFullscreen || !isFullscreenExitInput(input)) return
    event.preventDefault()
    setOverlayFullscreen(false)
  })

  overlayWindow.on('moved', () => {
    if (overlayFullscreen || overlayTransitioning || overlayOnboardingOpen) return
    const [x, y] = overlayWindow.getPosition()
    settings.position = { x, y }
    saveSettings()
  })

  overlayWindow.on('closed', () => {
    stopOverlayDrag()
    stopOverlayResize()
    stopOverlayBoundsAnimation()
    overlayFullscreen = false
    overlayOnboardingOpen = false
    overlayNormalBounds = undefined
    overlayWindow = undefined
  })
}

function createTray() {
  const png = Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAABAAAAAQCAYAAAAf8/9hAAAAV0lEQVR42mNgoBAwUqifYdQABkZGRv8ZGBj+I2QYGBgYGP7//8/Q4j8DAwPDf4ZGRqQZGBgY/lPAF2dkZPgPxFQjGpkWBgYGhv8MDIyM/4mRkZGJYdQABgYAlVYNt+H4v2wAAAAASUVORK5CYII=',
    'base64',
  )
  tray = new Tray(nativeImage.createFromBuffer(png))
  tray.setToolTip('CamFrame')
  setTrayMenu()
  tray.on('double-click', showControls)
}

function setTrayMenu() {
  if (!tray) return
  const presetMenu = settings.presets.length
    ? settings.presets.map((preset) => ({
        label: preset.name,
        type: 'radio',
        checked: preset.id === activePresetId,
        click: () => applyPreset(preset.id),
      }))
    : [{ label: 'No saved scenes', enabled: false }]
  tray.setContextMenu(
    Menu.buildFromTemplate([
      { label: 'Open controls', click: showControls },
      { label: 'Help & onboarding', click: showOnboarding },
      {
        label: 'Show camera',
        type: 'checkbox',
        checked: settings.overlayVisible,
        click: (item) => updateSettings({ overlayVisible: item.checked }),
      },
      { label: 'Scenes', submenu: presetMenu },
      { type: 'separator' },
      {
        label: 'Quit CamFrame',
        click: () => {
          app.isQuitting = true
          app.quit()
        },
      },
    ]),
  )
}

function registerIpc() {
  ipcMain.handle('state:get', () => ({ ...settings, activePresetId }))
  ipcMain.on('state:update', (_event, patch) => updateSettings(patch))
  ipcMain.on('accessibility:preferences', (event, preferences) => {
    if (event.sender !== overlayWindow?.webContents) return
    const nextReducedMotion = Boolean(preferences?.reducedMotion)
    if (nextReducedMotion === reducedMotion) return
    reducedMotion = nextReducedMotion
    if (reducedMotion) finishOverlayBoundsAnimation()
  })
  ipcMain.on('preset:save', (_event, name, id) => savePreset(name, id))
  ipcMain.on('preset:apply', (_event, id) => applyPreset(id))
  ipcMain.on('preset:delete', (_event, id) => deletePreset(id))
  ipcMain.on('preset:reorder', (_event, id, direction) => reorderPreset(id, direction))
  ipcMain.handle('preset:export', exportPresets)
  ipcMain.handle('preset:import', importPresets)
  ipcMain.on('overlay:interactive', (_event, interactive) => {
    setOverlayInteractive(Boolean(interactive))
  })
  ipcMain.on('overlay:settings-open', (_event, open) => {
    if (open) setOverlayInteractive(true)
  })
  ipcMain.on('overlay:onboarding-open', (event, open) => {
    const topReserve = setOverlayOnboardingLayout(Boolean(open))
    if (open) {
      setOverlayInteractive(true)
      overlayWindow?.show()
      overlayWindow?.focus()
    }
    event.returnValue = topReserve
  })
  ipcMain.on('onboarding:complete', completeOnboarding)
  ipcMain.on('overlay:drag-start', startOverlayDrag)
  ipcMain.on('overlay:drag-stop', stopOverlayDrag)
  ipcMain.on('overlay:resize-start', (_event, handle) => startOverlayResize(handle))
  ipcMain.on('overlay:resize-stop', stopOverlayResize)
  ipcMain.on('overlay:fullscreen-toggle', () => setOverlayFullscreen(!overlayFullscreen))
  ipcMain.on('overlay:fullscreen-exit', () => setOverlayFullscreen(false))
  ipcMain.on('app:quit', () => {
    app.isQuitting = true
    app.quit()
  })
}

app.whenReady().then(() => {
  app.dock?.hide()
  loadSettings()
  applyLaunchAtLoginSetting()
  registerIpc()

  session.defaultSession.setPermissionCheckHandler((webContents, permission) => {
    return permission === 'media' && webContents === overlayWindow?.webContents
  })
  session.defaultSession.setPermissionRequestHandler((webContents, permission, callback) => {
    callback(permission === 'media' && webContents === overlayWindow?.webContents)
  })

  createOverlayWindow()
  createTray()

  globalShortcut.register('CommandOrControl+Shift+C', showControls)
  globalShortcut.register('CommandOrControl+Shift+H', () => {
    updateSettings({ overlayVisible: !settings.overlayVisible })
  })
  globalShortcut.register('CommandOrControl+Shift+F', () => {
    setOverlayFullscreen(!overlayFullscreen)
  })
  globalShortcut.register('CommandOrControl+Shift+P', cyclePreset)
  for (let index = 0; index < 6; index += 1) {
    globalShortcut.register(`CommandOrControl+Shift+${index + 1}`, () => {
      const preset = settings.presets[index]
      if (preset) applyPreset(preset.id)
    })
  }
})

app.on('before-quit', () => {
  app.isQuitting = true
  stopOverlayDrag()
  stopOverlayResize()
  clearTimeout(saveTimer)
  writeFileSync(preferencesPath(), JSON.stringify(settings, null, 2), 'utf8')
})

app.on('will-quit', () => globalShortcut.unregisterAll())
app.on('window-all-closed', () => {})
