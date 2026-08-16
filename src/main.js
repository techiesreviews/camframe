import { readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  app,
  BrowserWindow,
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
  dimensionsFor,
  overlayDimensionsFor,
  OVERLAY_CHROME,
  resizeOverlayFromCorner,
  sanitizeSettings,
  settingsPatchChangesOverlayGeometry,
  startupSettings,
} from './settings.js'
import {
  alwaysOnTopLevelFor,
  fullscreenWindowPlan,
  interpolateWindowBounds,
  isFullscreenExitInput,
} from './fullscreen.js'

const currentDirectory = dirname(fileURLToPath(import.meta.url))
const preferencesPath = () => join(app.getPath('userData'), 'preferences.json')
const alwaysOnTopLevel = alwaysOnTopLevelFor(process.platform)

let controlWindow
let overlayWindow
let tray
let saveTimer
let devices = []
let settings = { ...DEFAULT_SETTINGS }
let overlayInteractive = false
let dragTimer
let dragOffset
let resizeTimer
let resizeStart
let overlayFullscreen = false
let overlayNormalBounds
let overlayBoundsAnimation
let overlayTransitioning = false

const FULLSCREEN_ANIMATION_MS = 280

function loadSettings() {
  try {
    const saved = JSON.parse(readFileSync(preferencesPath(), 'utf8'))
    if ((saved.schemaVersion ?? 0) < 3) {
      saved.borderWidth = 0
      saved.size = DEFAULT_SETTINGS.size
    }
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
  controlWindow?.webContents.send('state:changed', settings)
  overlayWindow?.webContents.send('state:changed', settings)
}

function overlayBounds({ keepCenter = true } = {}) {
  const nextSize = overlayDimensionsFor(settings)
  const current = overlayWindow?.getBounds()
  const primary = screen.getPrimaryDisplay().workArea

  if (!current) {
    const fallbackPosition = {
      x: primary.x + primary.width - nextSize.width - 36,
      y: primary.y + primary.height - nextSize.height - 36,
    }
    return { ...nextSize, ...(settings.position ?? fallbackPosition) }
  }

  if (!keepCenter) {
    const position = settings.position ?? { x: current.x, y: current.y }
    return { ...nextSize, ...position }
  }
  return {
    x: Math.round(current.x + (current.width - nextSize.width) / 2),
    y: Math.round(current.y + (current.height - nextSize.height) / 2),
    ...nextSize,
  }
}

function applyOverlayWindow({ keepCenter = true, updateBounds = true } = {}) {
  if (!overlayWindow || overlayWindow.isDestroyed()) return

  if (updateBounds && !overlayFullscreen && !overlayTransitioning) {
    overlayWindow.setBounds(overlayBounds({ keepCenter }))
  }
  overlayWindow.setAlwaysOnTop(overlayFullscreen || settings.alwaysOnTop, alwaysOnTopLevel)

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
    bounds: overlayWindow.getBounds(),
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
  overlayTransitioning = false
}

function animateOverlayBounds(targetBounds, onComplete) {
  if (!overlayWindow || overlayWindow.isDestroyed()) return
  stopOverlayBoundsAnimation()
  const startBounds = overlayWindow.getBounds()
  const startedAt = Date.now()
  overlayTransitioning = true

  const updateFrame = () => {
    if (!overlayWindow || overlayWindow.isDestroyed()) {
      stopOverlayBoundsAnimation()
      return
    }
    const progress = Math.min(1, (Date.now() - startedAt) / FULLSCREEN_ANIMATION_MS)
    overlayWindow.setBounds(interpolateWindowBounds(startBounds, targetBounds, progress))
    if (progress < 1) return

    stopOverlayBoundsAnimation()
    onComplete?.()
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
    overlayWindow.setAlwaysOnTop(plan.alwaysOnTop, alwaysOnTopLevel)
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
  overlayWindow.setAlwaysOnTop(true, alwaysOnTopLevel)
  overlayWindow.show()
  emitFullscreen()
  animateOverlayBounds(plan.bounds, () => {
    if (overlayFullscreen || !overlayWindow || overlayWindow.isDestroyed()) return
    overlayWindow.setAlwaysOnTop(plan.alwaysOnTop, alwaysOnTopLevel)
    if (plan.visible) {
      overlayWindow.showInactive()
      overlayWindow.moveTop()
    } else overlayWindow.hide()
    overlayNormalBounds = undefined
  })
}

function updateSettings(patch) {
  const updateBounds = settingsPatchChangesOverlayGeometry(patch)
  settings = sanitizeSettings({ ...settings, ...patch })
  applyOverlayWindow({ updateBounds })
  emitState()
  setTrayMenu()
  saveSettings()
}

function showController() {
  settings.overlayVisible = true
  applyOverlayWindow()
  emitState()
  setOverlayInteractive(true)
  overlayWindow?.webContents.send('controls:show')
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
  overlayWindow.setAlwaysOnTop(settings.alwaysOnTop, alwaysOnTopLevel)
  overlayWindow.setIgnoreMouseEvents(true, { forward: true })

  overlayWindow.once('ready-to-show', () => {
    emitState()
    emitFullscreen()
    if (settings.overlayVisible) overlayWindow.showInactive()
  })

  overlayWindow.webContents.on('before-input-event', (event, input) => {
    if (!overlayFullscreen || !isFullscreenExitInput(input)) return
    event.preventDefault()
    setOverlayFullscreen(false)
  })

  overlayWindow.on('moved', () => {
    if (overlayFullscreen || overlayTransitioning) return
    const [x, y] = overlayWindow.getPosition()
    settings.position = { x, y }
    controlWindow?.webContents.send('state:changed', settings)
    saveSettings()
  })

  overlayWindow.on('closed', () => {
    stopOverlayDrag()
    stopOverlayResize()
    stopOverlayBoundsAnimation()
    overlayFullscreen = false
    overlayNormalBounds = undefined
    overlayWindow = undefined
  })
}

function createControlWindow() {
  controlWindow = new BrowserWindow({
    width: 404,
    height: 720,
    minWidth: 360,
    minHeight: 620,
    show: false,
    autoHideMenuBar: true,
    backgroundColor: '#09090b',
    title: 'CamFrame',
    webPreferences: {
      preload: join(currentDirectory, 'preload.cjs'),
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
    },
  })

  controlWindow.loadFile(join(currentDirectory, 'control.html'))
  controlWindow.once('ready-to-show', () => {
    controlWindow.show()
    emitState()
    if (devices.length) controlWindow.webContents.send('devices:changed', devices)
  })

  controlWindow.on('close', (event) => {
    if (!app.isQuitting) {
      event.preventDefault()
      controlWindow.hide()
    }
  })

  controlWindow.on('closed', () => {
    controlWindow = undefined
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
  tray.on('double-click', showController)
}

function setTrayMenu() {
  if (!tray) return
  tray.setContextMenu(
    Menu.buildFromTemplate([
      { label: 'Open controls', click: showController },
      {
        label: 'Show camera',
        type: 'checkbox',
        checked: settings.overlayVisible,
        click: (item) => updateSettings({ overlayVisible: item.checked }),
      },
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
  ipcMain.handle('state:get', () => settings)
  ipcMain.on('state:update', (_event, patch) => updateSettings(patch))
  ipcMain.on('overlay:devices', (_event, nextDevices) => {
    devices = Array.isArray(nextDevices)
      ? nextDevices.slice(0, 32).map(({ deviceId, label }) => ({
          deviceId: String(deviceId).slice(0, 512),
          label: String(label).slice(0, 120),
        }))
      : []
    controlWindow?.webContents.send('devices:changed', devices)
  })
  ipcMain.on('overlay:error', (_event, message) => {
    controlWindow?.webContents.send('camera:error', String(message).slice(0, 300))
  })
  ipcMain.on('overlay:interactive', (_event, interactive) => {
    setOverlayInteractive(Boolean(interactive))
  })
  ipcMain.on('overlay:settings-open', (_event, open) => {
    if (open) setOverlayInteractive(true)
  })
  ipcMain.on('overlay:drag-start', startOverlayDrag)
  ipcMain.on('overlay:drag-stop', stopOverlayDrag)
  ipcMain.on('overlay:resize-start', (_event, handle) => startOverlayResize(handle))
  ipcMain.on('overlay:resize-stop', stopOverlayResize)
  ipcMain.on('overlay:fullscreen-toggle', () => setOverlayFullscreen(!overlayFullscreen))
  ipcMain.on('overlay:fullscreen-exit', () => setOverlayFullscreen(false))
  ipcMain.on('controller:show', showController)
  ipcMain.on('overlay:center', () => {
    const display = screen.getDisplayNearestPoint(screen.getCursorScreenPoint()).workArea
    const camera = dimensionsFor(settings)
    const windowSize = overlayDimensionsFor(settings)
    settings.position = {
      x: display.x + Math.round((display.width - windowSize.width) / 2),
      y: display.y + Math.round(display.height / 2 - OVERLAY_CHROME.top - camera.height / 2),
    }
    applyOverlayWindow({ keepCenter: false })
    emitState()
    saveSettings()
  })
  ipcMain.on('app:quit', () => {
    app.isQuitting = true
    app.quit()
  })
}

app.whenReady().then(() => {
  app.dock?.hide()
  loadSettings()
  registerIpc()

  session.defaultSession.setPermissionCheckHandler((webContents, permission) => {
    return permission === 'media' && webContents === overlayWindow?.webContents
  })
  session.defaultSession.setPermissionRequestHandler((webContents, permission, callback) => {
    callback(permission === 'media' && webContents === overlayWindow?.webContents)
  })

  createOverlayWindow()
  createTray()

  globalShortcut.register('CommandOrControl+Shift+C', showController)
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
