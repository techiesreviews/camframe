import { readFileSync, writeFileSync } from 'node:fs'
import { dirname, isAbsolute, join } from 'node:path'
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
  SCENE_LIMIT,
  legacyLaunchAtLogin,
  preferencesFromDocument,
  sanitizeSettings,
  settingsAfterHandResize,
  settingsPatchChangesOverlayGeometry,
} from './settings.js'
import * as sceneLibrary from './scenes.js'
import { registerBridgeHandlers, sendBridgeEvent } from './bridge.js'
import { CURRENT_ONBOARDING_VERSION } from './onboarding.js'
import {
  alwaysOnTopLevelFor,
  compactBaseBounds,
  createOverlayGeometry,
  isFullscreenExitInput,
  onScreenBase,
} from './overlay-geometry.js'
import { createPrompterLink } from './prompter-link.js'
import { createPrompterControl } from './prompter-control.js'

const currentDirectory = dirname(fileURLToPath(import.meta.url))
const integrationUserDataDirectory = process.env.CAMFRAME_E2E_USER_DATA_DIR
if (!app.isPackaged && process.env.CAMFRAME_E2E === '1' && isAbsolute(integrationUserDataDirectory ?? '')) {
  app.setPath('userData', integrationUserDataDirectory)
  if (process.env.CAMFRAME_E2E_REAL_CAMERA !== '1') {
    app.commandLine.appendSwitch('use-fake-device-for-media-stream', 'fps=60')
  }
  app.commandLine.appendSwitch('use-fake-ui-for-media-stream')
}
const preferencesPath = () => join(app.getPath('userData'), 'preferences.json')

let overlayWindow
let overlayGeometry
let tray
let saveTimer
let settings = { ...DEFAULT_SETTINGS }
let activeSceneId = ''
// The Scenes tab's Undo offers: a change saved into the active Scene, and the last delete.
const sceneEdits = sceneLibrary.createSceneEdits()
let prompterLink
let prompterLinkStatus = { state: 'off', port: 0, message: '' }

function loadSettings() {
  let documentText
  try {
    documentText = readFileSync(preferencesPath(), 'utf8')
  } catch {
    documentText = undefined
  }
  settings = preferencesFromDocument(documentText)
  // Start at login is gone (ADR 0037): a packaged build that registered it turns it off once.
  if (app.isPackaged && legacyLaunchAtLogin(documentText)) app.setLoginItemSettings({ openAtLogin: false })
}

function saveSettings() {
  clearTimeout(saveTimer)
  saveTimer = setTimeout(() => {
    writeFileSync(preferencesPath(), JSON.stringify(settings, null, 2), 'utf8')
  }, 120)
}

// Where each Scene's camera sits on its display, for the Scenes tab tiles (ADR 0037).
function previewContext() {
  if (!overlayGeometry) return undefined
  return {
    workArea: overlayGeometry.currentWorkArea(),
    workAreaAt: (point) => overlayGeometry.workAreaAt(point),
    displayAt: (point) => screen.getDisplayNearestPoint(point).bounds,
    liveBounds: overlayGeometry.isFullscreen() ? undefined : overlayGeometry.targetBounds(),
  }
}

// Runtime-only fields ride along with Preferences: the active Scene, the Scenes tab's Undo offers
// and tile previews, and the Prompter link state.
function overlayState() {
  const context = previewContext()
  return {
    ...settings,
    activePresetId: activeSceneId,
    ...sceneEdits.view(activeSceneId),
    scenePreviews: context ? sceneLibrary.scenePreviews(settings, context) : null,
    prompterLinkStatus,
  }
}

function emitState() {
  sendBridgeEvent(overlayWindow?.webContents, 'onStateChanged', overlayState())
}

function emitFullscreen() {
  sendBridgeEvent(overlayWindow?.webContents, 'onFullscreenChanged', Boolean(overlayGeometry?.isFullscreen()))
}

function showPresentationNotice(message) {
  sendBridgeEvent(overlayWindow?.webContents, 'onPresentationNotice', String(message).slice(0, 80))
}

// The Scene's name for screen readers only (a hidden live region); nothing is drawn on the camera.
function announceScene(name) {
  sendBridgeEvent(overlayWindow?.webContents, 'onSceneAnnouncement', String(name).slice(0, 80))
}

function toggleFullscreen() {
  overlayGeometry?.setFullscreen(!overlayGeometry.isFullscreen())
}

// A change from the Overlay (Inline settings, the toolbar). A hand change of the look is saved into
// the active Scene, which stays active (ADR 0037).
// An onboarding demo step (`demo`) is stored but never saved into the active Scene.
function updateSettings(patch, { demo = false } = {}) {
  const updateBounds = settingsPatchChangesOverlayGeometry(patch)
  const next = sanitizeSettings({ ...settings, ...patch })
  commitState(
    demo ? { settings: next, activeSceneId } : sceneLibrary.followLiveLook(sceneState(), next, { keys: Object.keys(patch) }),
  )
  if (Object.hasOwn(patch, 'prompterLink')) prompterLink?.setEnabled(settings.prompterLink)
  overlayGeometry?.apply({ updateBounds })
}

function sceneState() {
  return { settings, activeSceneId }
}

// Stores a Scene library result, broadcasts it and saves it; window effects are the caller's.
// `tray: false` skips rebuilding the tray menu (a corner drag reports a size every frame).
function commitState(result, { tray = true } = {}) {
  if (!result) return
  if (result.settings) {
    sceneEdits.track(sceneState(), result)
    settings = result.settings
    activeSceneId = result.activeSceneId
    emitState()
    if (tray) setTrayMenu()
    saveSettings()
  }
  if (result.notice) showPresentationNotice(result.notice)
  if (result.announce) announceScene(result.announce)
}

function commitScenes(result) {
  commitState(result)
  if (result?.appliedScene) overlayGeometry?.showScene()
}

// A layout Scene fits the display the Overlay is on now, or the display its saved point is on; an
// exact Scene saved off screen opens on the display nearest its place.
function sceneContext() {
  if (!overlayGeometry) return {}
  return {
    workArea: overlayGeometry.currentWorkArea(),
    workAreaAt: (point) => overlayGeometry?.workAreaAt(point),
    workAreas: overlayGeometry.workAreas(),
  }
}

function applySceneById(id) {
  commitScenes(sceneLibrary.applyScene(sceneState(), id, sceneContext()))
}

function savePreset(name, id) {
  commitScenes(
    sceneLibrary.saveScene(sceneState(), {
      name,
      id,
      liveBounds: overlayGeometry?.compactBounds(),
      fullscreen: Boolean(overlayGeometry?.isFullscreen()),
    }),
  )
}

async function exportPresets() {
  const result = await dialog.showSaveDialog({
    title: 'Export CamFrame scenes',
    defaultPath: 'CamFrame-scenes.json',
    filters: [{ name: 'CamFrame scenes', extensions: ['json'] }],
  })
  if (result.canceled || !result.filePath) return { canceled: true }
  const payload = sceneLibrary.sceneExport(sceneState())
  writeFileSync(result.filePath, JSON.stringify(payload, null, 2), 'utf8')
  return { canceled: false, count: payload.scenes.length }
}

async function importPresets() {
  const result = await dialog.showOpenDialog({
    title: 'Import CamFrame scenes',
    properties: ['openFile'],
    filters: [{ name: 'CamFrame scenes', extensions: ['json'] }],
  })
  if (result.canceled || !result.filePaths[0]) return { canceled: true }

  let documentText
  try {
    documentText = readFileSync(result.filePaths[0], 'utf8')
  } catch {
    return { canceled: false, error: sceneLibrary.SCENE_IMPORT_ERROR }
  }
  const imported = sceneLibrary.importScenes(sceneState(), documentText)
  if (imported.error) return { canceled: false, error: imported.error }
  commitScenes(imported)
  return { canceled: false, count: imported.importedCount }
}

function showControls() {
  settings.overlayVisible = true
  overlayGeometry?.apply()
  emitState()
  overlayGeometry?.setInteractive(true)
  sendBridgeEvent(overlayWindow?.webContents, 'onShowControls')
  saveSettings()
}

function showOnboarding() {
  settings.overlayVisible = true
  overlayGeometry?.apply()
  emitState()
  overlayGeometry?.setInteractive(true)
  overlayWindow?.show()
  overlayWindow?.focus()
  sendBridgeEvent(overlayWindow?.webContents, 'onShowOnboarding')
  setTrayMenu()
  saveSettings()
}

function setOnboardingOpen(open) {
  const topReserve = overlayGeometry?.setOnboardingReserve(open) ?? 0
  if (open) {
    overlayGeometry?.setInteractive(true)
    overlayWindow?.show()
    overlayWindow?.focus()
  }
  return topReserve
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
  const workArea = screen.getPrimaryDisplay().workArea
  const saved = compactBaseBounds({ settings, workArea, keepCenter: false })
  // A saved place off every connected display (another monitor, docking, a new resolution) would
  // run CamFrame out of sight (TOOLS-156): it opens at the bottom right of the main display instead.
  const bounds = onScreenBase(saved, {
    workAreas: screen.getAllDisplays().map((display) => display.workArea),
    primaryWorkArea: workArea,
    margin: settings.prompterMargin,
  })
  if (bounds !== saved) {
    settings.position = { x: bounds.x, y: bounds.y }
    saveSettings()
  }
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

  overlayGeometry = createOverlayGeometry({
    window: overlayWindow,
    screen,
    settings: () => settings,
    alwaysOnTopLevel: alwaysOnTopLevelFor(process.platform),
    // Resizing by hand also sets the size a Prompter link "small" cue restores, and is saved into
    // the active Scene.
    onResize(patch) {
      commitState(
        sceneLibrary.followLiveLook(sceneState(), settingsAfterHandResize(settings, patch), { keys: ['size', 'position'] }),
        { tray: false },
      )
      overlayGeometry.apply({ keepCenter: false })
    },
    onCompactPositionChanged(position) {
      settings.position = position
      saveSettings()
    },
    onFullscreenChanged: emitFullscreen,
    // A move-drag that moved the camera is a hand change of the place: saved into the active Scene.
    onDragEnd(position) {
      const next = sanitizeSettings({ ...settings, position })
      commitState(sceneLibrary.followLiveLook(sceneState(), next, { keys: ['position'] }))
    },
  })
  overlayWindow.loadFile(join(currentDirectory, 'overlay.html'))

  overlayWindow.once('ready-to-show', () => {
    emitState()
    emitFullscreen()
    if (settings.overlayVisible) {
      overlayGeometry?.ensureOnScreen()
      overlayWindow.showInactive()
    }
  })

  overlayWindow.on('blur', () => {
    setTimeout(() => overlayGeometry?.raise(), 0)
  })

  overlayWindow.webContents.on('before-input-event', (event, input) => {
    if (!overlayGeometry?.isFullscreen() || !isFullscreenExitInput(input)) return
    event.preventDefault()
    overlayGeometry.setFullscreen(false)
  })

  overlayWindow.on('moved', () => overlayGeometry?.windowMoved())

  overlayWindow.on('closed', () => {
    overlayGeometry?.dispose()
    overlayGeometry = undefined
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
        checked: preset.id === activeSceneId,
        click: () => applySceneById(preset.id),
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
  registerBridgeHandlers(ipcMain, {
    isOverlaySender: (event) => Boolean(overlayWindow) && event.sender === overlayWindow.webContents,
    handlers: {
      getState: overlayState,
      updateState: updateSettings,
      reportAccessibilityPreferences: ({ reducedMotion }) => {
        overlayGeometry?.setReducedMotion(reducedMotion)
      },
      savePreset,
      applyPreset: (id) => applySceneById(id),
      renamePreset: (id, name) => {
        const renamed = sceneLibrary.renameScene(sceneState(), id, name)
        if (!renamed?.error) commitState(renamed)
      },
      undoPresetChange: () => {
        commitScenes(sceneLibrary.undoSceneChange(sceneState(), sceneEdits.takeChange(activeSceneId), sceneContext()))
      },
      undoPresetDelete: () => {
        commitScenes(sceneLibrary.restoreScene(sceneState(), sceneEdits.takeDelete(), sceneContext()))
      },
      deletePreset: (id) => commitScenes(sceneLibrary.deleteScene(sceneState(), id)),
      reorderPreset: (id, direction) => {
        commitScenes(sceneLibrary.reorderScene(sceneState(), id, direction))
      },
      exportPresets,
      importPresets,
      setOverlayInteractive: (interactive) => overlayGeometry?.setInteractive(interactive),
      setOverlaySettingsOpen: (open) => {
        if (open) overlayGeometry?.setInteractive(true)
      },
      setOverlayOnboardingOpen: setOnboardingOpen,
      completeOnboarding,
      startOverlayDrag: () => overlayGeometry?.startDrag(),
      stopOverlayDrag: () => overlayGeometry?.stopDrag(),
      startOverlayResize: (handle) => overlayGeometry?.startResize(handle),
      stopOverlayResize: () => overlayGeometry?.stopResize(),
      toggleFullscreen,
      exitFullscreen: () => overlayGeometry?.setFullscreen(false),
      quit: () => {
        app.isQuitting = true
        app.quit()
      },
    },
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
  // A screen added or removed, a new resolution or scale, or docking: a lost Overlay comes back.
  for (const event of ['display-added', 'display-removed', 'display-metrics-changed']) {
    screen.on(event, () => overlayGeometry?.ensureOnScreen())
  }

  const prompterControl = createPrompterControl({
    geometry: () => overlayGeometry,
    sceneState,
    commit: commitState,
    version: () => app.getVersion(),
  })
  prompterLink = createPrompterLink({
    status: prompterControl.status,
    applyCue: prompterControl.applyCue,
    saveScene: prompterControl.saveScene,
    setSmallSize: prompterControl.setSmallSize,
    onState(state) {
      prompterLinkStatus = state
      emitState()
    },
  })
  prompterLink.setEnabled(settings.prompterLink)

  globalShortcut.register('CommandOrControl+Shift+C', showControls)
  globalShortcut.register('CommandOrControl+Shift+H', () => {
    updateSettings({ overlayVisible: !settings.overlayVisible })
  })
  globalShortcut.register('CommandOrControl+Shift+F', toggleFullscreen)
  globalShortcut.register('CommandOrControl+Shift+P', () => {
    commitScenes(sceneLibrary.cycleScene(sceneState(), sceneContext()))
  })
  for (let index = 0; index < SCENE_LIMIT; index += 1) {
    globalShortcut.register(`CommandOrControl+Shift+${index + 1}`, () => {
      commitScenes(sceneLibrary.applySceneAt(sceneState(), index, sceneContext()))
    })
  }
})

app.on('before-quit', () => {
  app.isQuitting = true
  prompterLink?.close()
  overlayGeometry?.stopDrag()
  overlayGeometry?.stopResize()
  clearTimeout(saveTimer)
  writeFileSync(preferencesPath(), JSON.stringify(settings, null, 2), 'utf8')
})

app.on('will-quit', () => globalShortcut.unregisterAll())
app.on('window-all-closed', () => {})
