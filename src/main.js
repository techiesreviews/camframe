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
  preferencesFromDocument,
  sanitizeSettings,
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
} from './overlay-geometry.js'

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

function loadSettings() {
  let documentText
  try {
    documentText = readFileSync(preferencesPath(), 'utf8')
  } catch {
    documentText = undefined
  }
  settings = preferencesFromDocument(documentText)
}

function saveSettings() {
  clearTimeout(saveTimer)
  saveTimer = setTimeout(() => {
    writeFileSync(preferencesPath(), JSON.stringify(settings, null, 2), 'utf8')
  }, 120)
}

function emitState() {
  sendBridgeEvent(overlayWindow?.webContents, 'onStateChanged', {
    ...settings,
    activePresetId: activeSceneId,
  })
}

function emitFullscreen() {
  sendBridgeEvent(overlayWindow?.webContents, 'onFullscreenChanged', Boolean(overlayGeometry?.isFullscreen()))
}

function showPresentationNotice(message) {
  sendBridgeEvent(overlayWindow?.webContents, 'onPresentationNotice', String(message).slice(0, 80))
}

function applyLaunchAtLoginSetting() {
  if (!app.isPackaged) return
  app.setLoginItemSettings({ openAtLogin: settings.launchAtLogin })
}

function toggleFullscreen() {
  overlayGeometry?.setFullscreen(!overlayGeometry.isFullscreen())
}

function updateSettings(patch) {
  const updateBounds = settingsPatchChangesOverlayGeometry(patch)
  ;({ settings, activeSceneId } = sceneLibrary.patchSettings(sceneState(), patch))
  if (Object.hasOwn(patch, 'launchAtLogin')) applyLaunchAtLoginSetting()
  overlayGeometry?.apply({ updateBounds })
  emitState()
  setTrayMenu()
  saveSettings()
}

function sceneState() {
  return { settings, activeSceneId }
}

function commitScenes(result) {
  if (!result) return
  if (result.settings) {
    settings = result.settings
    activeSceneId = result.activeSceneId
    if (result.appliedScene) overlayGeometry?.showScene()
    emitState()
    setTrayMenu()
    saveSettings()
  }
  if (result.notice) showPresentationNotice(result.notice)
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
  showPresentationNotice('Scenes exported')
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
  const bounds = compactBaseBounds({
    settings,
    workArea: screen.getPrimaryDisplay().workArea,
    keepCenter: false,
  })
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
    onResize(patch) {
      settings = sanitizeSettings({ ...settings, ...patch })
      overlayGeometry.apply({ keepCenter: false })
      emitState()
      saveSettings()
    },
    onCompactPositionChanged(position) {
      settings.position = position
      saveSettings()
    },
    onFullscreenChanged: emitFullscreen,
  })
  overlayWindow.loadFile(join(currentDirectory, 'overlay.html'))

  overlayWindow.once('ready-to-show', () => {
    emitState()
    emitFullscreen()
    if (settings.overlayVisible) overlayWindow.showInactive()
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
        click: () => commitScenes(sceneLibrary.applyScene(sceneState(), preset.id)),
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
      getState: () => ({ ...settings, activePresetId: activeSceneId }),
      updateState: updateSettings,
      reportAccessibilityPreferences: ({ reducedMotion }) => {
        overlayGeometry?.setReducedMotion(reducedMotion)
      },
      savePreset,
      applyPreset: (id) => commitScenes(sceneLibrary.applyScene(sceneState(), id)),
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
  globalShortcut.register('CommandOrControl+Shift+F', toggleFullscreen)
  globalShortcut.register('CommandOrControl+Shift+P', () => {
    commitScenes(sceneLibrary.cycleScene(sceneState()))
  })
  for (let index = 0; index < SCENE_LIMIT; index += 1) {
    globalShortcut.register(`CommandOrControl+Shift+${index + 1}`, () => {
      commitScenes(sceneLibrary.applySceneAt(sceneState(), index))
    })
  }
})

app.on('before-quit', () => {
  app.isQuitting = true
  overlayGeometry?.stopDrag()
  overlayGeometry?.stopResize()
  clearTimeout(saveTimer)
  writeFileSync(preferencesPath(), JSON.stringify(settings, null, 2), 'utf8')
})

app.on('will-quit', () => globalShortcut.unregisterAll())
app.on('window-all-closed', () => {})
