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
  settingsPatchChangesOverlayGeometry,
} from './settings.js'
import * as sceneLibrary from './scenes.js'
import { sceneDisplays } from './layout-request.js'
import { createSceneSession } from './scene-session.js'
import { registerBridgeHandlers, sendBridgeEvent } from './bridge.js'
import { CURRENT_ONBOARDING_VERSION } from './onboarding.js'
import {
  alwaysOnTopLevelFor,
  createOverlayGeometry,
  isFullscreenExitInput,
  openingCompactBounds,
} from './overlay-geometry.js'
import { createPrompterLink } from './prompter-link.js'
import { createPrompterControl } from './prompter-control.js'
import { createPreferencesStore } from './preferences-store.js'

const currentDirectory = dirname(fileURLToPath(import.meta.url))
const integrationUserDataDirectory = process.env.CAMFRAME_E2E_USER_DATA_DIR
if (!app.isPackaged && process.env.CAMFRAME_E2E === '1' && isAbsolute(integrationUserDataDirectory ?? '')) {
  app.setPath('userData', integrationUserDataDirectory)
  if (process.env.CAMFRAME_E2E_REAL_CAMERA !== '1') {
    app.commandLine.appendSwitch('use-fake-device-for-media-stream', 'fps=60')
  }
  app.commandLine.appendSwitch('use-fake-ui-for-media-stream')
}
const openPreferencesStore = () => createPreferencesStore(join(app.getPath('userData'), 'preferences.json'))

let overlayWindow
let overlayGeometry
let tray
let saveTimer
// The live Preferences, the Active Scene and the Scenes tab's Undo offers (scene-session.js).
let sceneSession = sceneSessionWith({ ...DEFAULT_SETTINGS })
const settings = () => sceneSession.settings()
let prompterLink
let prompterLinkStatus = { state: 'off', port: 0, message: '' }

function sceneSessionWith(startSettings) {
  return createSceneSession({
    settings: startSettings,
    geometry: {
      sceneContext,
      compactPlace: () => ({ bounds: overlayGeometry?.compactBounds(), fullscreen: overlayGeometry?.isFullscreen() }),
      compactPlaceAfter: (next) => overlayGeometry?.compactPlaceAfter(next),
    },
    onChange: sceneSessionChanged,
  })
}

function loadSettings() {
  const documentText = openPreferencesStore().read()
  sceneSession = sceneSessionWith(preferencesFromDocument(documentText))
  // Start at login is gone (ADR 0037): a packaged build that registered it turns it off once.
  if (app.isPackaged && legacyLaunchAtLogin(documentText)) app.setLoginItemSettings({ openAtLogin: false })
}

function saveSettings() {
  clearTimeout(saveTimer)
  saveTimer = setTimeout(() => {
    openPreferencesStore().write(JSON.stringify(settings(), null, 2))
  }, 120)
}

// Where each Scene's camera opens on its display, for the Scenes tab tiles (ADR 0037): fitted to the
// same displays as applying it.
function previewContext() {
  if (!overlayGeometry) return undefined
  return {
    ...sceneDisplays(overlayGeometry),
    displayAt: (point) => screen.getDisplayNearestPoint(point).bounds,
    liveBounds: overlayGeometry.isFullscreen() ? undefined : overlayGeometry.targetBounds(),
  }
}

// Runtime-only fields ride along with Preferences: the active Scene, the Scenes tab's Undo offers
// and tile previews, and the Prompter link state.
function overlayState() {
  const context = previewContext()
  return {
    ...settings(),
    ...sceneSession.view(),
    scenePreviews: context ? sceneLibrary.scenePreviews(settings(), context) : null,
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

// A change from the Overlay (Inline settings, the toolbar): a hand change, or an onboarding demo
// step (`demo`), see the Scene session. A Shape or size change already stored the place the
// geometry gave for it, so the window lands exactly there.
function updateSettings(patch, { demo = false } = {}) {
  const updateBounds = settingsPatchChangesOverlayGeometry(patch)
  sceneSession.handChange(patch, { demo })
  if (Object.hasOwn(patch, 'prompterLink')) prompterLink?.setEnabled(settings().prompterLink)
  overlayGeometry?.apply({ updateBounds, keepCenter: false })
}

// A place the window reached by itself (a heal, the end of the onboarding reserve, a native move):
// stored in Preferences only, no Scene changes (ADR 0038). The tiles are sent again, since a heal
// after a move can land on another display than the one the move was heading to.
function compactPlaceReached(position) {
  sceneSession.record({ position })
  emitState()
  saveSettings()
}

// Broadcasts and saves what the Scene session stored. A resize skips rebuilding the tray menu (a
// corner drag reports a size every frame). A Scene put on camera moves the window to it, unless the
// caller moves the window itself (the Prompter link). The move starts before the broadcast, so the
// tiles are fitted to the display the window is heading to (`currentWorkArea()` reads the move's target).
function sceneSessionChanged(result, { resizing, placedByCaller = false }) {
  if (result.appliedScene && !placedByCaller) overlayGeometry?.showScene()
  if (result.settings) {
    emitState()
    if (!resizing) setTrayMenu()
    saveSettings()
  }
  if (result.notice) showPresentationNotice(result.notice)
  if (result.announce) announceScene(result.announce)
}

// A layout Scene fits the display the Overlay is on now, or the display its saved point is on; an
// exact Scene saved off screen opens on the display nearest its place.
function sceneContext() {
  return sceneDisplays(overlayGeometry)
}

async function exportPresets() {
  const result = await dialog.showSaveDialog({
    title: 'Export CamFrame scenes',
    defaultPath: 'CamFrame-scenes.json',
    filters: [{ name: 'CamFrame scenes', extensions: ['json'] }],
  })
  if (result.canceled || !result.filePath) return { canceled: true }
  const payload = sceneSession.exportScenes()
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
  const imported = sceneSession.importScenes(documentText)
  if (imported.error) return { canceled: false, error: imported.error }
  return { canceled: false, count: imported.importedCount }
}

function showControls() {
  sceneSession.record({ overlayVisible: true })
  overlayGeometry?.apply()
  emitState()
  overlayGeometry?.setInteractive(true)
  sendBridgeEvent(overlayWindow?.webContents, 'onShowControls')
  saveSettings()
}

function showOnboarding() {
  sceneSession.record({ overlayVisible: true })
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
  if (settings().completedOnboardingVersion >= CURRENT_ONBOARDING_VERSION) return
  sceneSession.record({ completedOnboardingVersion: CURRENT_ONBOARDING_VERSION })
  emitState()
  saveSettings()
}

function createOverlayWindow() {
  // A saved place off every connected display opens at the bottom right of the main display.
  const { bounds, healed } = openingCompactBounds({ settings: settings(), screen })
  if (healed) compactPlaceReached(healed)
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
    settings,
    alwaysOnTopLevel: alwaysOnTopLevelFor(process.platform),
    // Resizing by hand also sets the size a Prompter link "small" cue restores, and is saved into
    // the active Scene.
    onResize(patch) {
      sceneSession.handResize(patch)
      overlayGeometry.apply({ keepCenter: false })
    },
    onCompactPositionChanged: compactPlaceReached,
    onFullscreenChanged: emitFullscreen,
    // A move-drag that moved the camera is a hand change of the place: saved into the active Scene.
    onDragEnd: (position) => sceneSession.dragEnd(position),
  })
  overlayWindow.loadFile(join(currentDirectory, 'overlay.html'))

  overlayWindow.once('ready-to-show', () => {
    emitState()
    emitFullscreen()
    if (settings().overlayVisible) {
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
  const { settings: current, activeSceneId } = sceneSession.state()
  const presetMenu = current.presets.length
    ? current.presets.map((preset) => ({
        label: preset.name,
        type: 'radio',
        checked: preset.id === activeSceneId,
        click: () => sceneSession.applyScene(preset.id),
      }))
    : [{ label: 'No saved scenes', enabled: false }]
  tray.setContextMenu(
    Menu.buildFromTemplate([
      { label: 'Open controls', click: showControls },
      { label: 'Help & onboarding', click: showOnboarding },
      {
        label: 'Show camera',
        type: 'checkbox',
        checked: current.overlayVisible,
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
      savePreset: (name, id) => {
        sceneSession.saveScene(name, id)
      },
      applyPreset: (id) => sceneSession.applyScene(id),
      renamePreset: (id, name) => {
        sceneSession.renameScene(id, name)
      },
      undoPresetChange: () => sceneSession.undoChange(),
      undoPresetDelete: () => sceneSession.undoDelete(),
      deletePreset: (id) => sceneSession.deleteScene(id),
      reorderPreset: (id, direction) => sceneSession.reorderScene(id, direction),
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
  // A screen added or removed, a new resolution or scale, or docking: a lost Overlay comes back, and
  // the Scenes tab tiles are sent again for the displays there are now.
  for (const event of ['display-added', 'display-removed', 'display-metrics-changed']) {
    screen.on(event, () => {
      overlayGeometry?.ensureOnScreen()
      emitState()
    })
  }

  const prompterControl = createPrompterControl({
    geometry: () => overlayGeometry,
    sceneState: () => sceneSession.state(),
    // The Prompter link moves the window itself after each commit.
    commit: (result) => sceneSession.commit(result, { placedByCaller: true }),
    version: () => app.getVersion(),
  })
  // The Prompter link moves the window after its commit, so the tiles are sent again once the window
  // is heading to its new display.
  const thenSendTiles = (handle) => (request) => {
    const answer = handle(request)
    emitState()
    return answer
  }
  prompterLink = createPrompterLink({
    status: prompterControl.status,
    applyCue: thenSendTiles(prompterControl.applyCue),
    saveScene: thenSendTiles(prompterControl.saveScene),
    setSmallSize: prompterControl.setSmallSize,
    onState(state) {
      prompterLinkStatus = state
      emitState()
    },
  })
  prompterLink.setEnabled(settings().prompterLink)

  globalShortcut.register('CommandOrControl+Shift+C', showControls)
  globalShortcut.register('CommandOrControl+Shift+H', () => {
    updateSettings({ overlayVisible: !settings().overlayVisible })
  })
  globalShortcut.register('CommandOrControl+Shift+F', toggleFullscreen)
  globalShortcut.register('CommandOrControl+Shift+P', () => sceneSession.cycleScene())
  for (let index = 0; index < SCENE_LIMIT; index += 1) {
    globalShortcut.register(`CommandOrControl+Shift+${index + 1}`, () => sceneSession.applySceneAt(index))
  }
})

app.on('before-quit', () => {
  app.isQuitting = true
  prompterLink?.close()
  overlayGeometry?.stopDrag()
  overlayGeometry?.stopResize()
  clearTimeout(saveTimer)
  openPreferencesStore().write(JSON.stringify(settings(), null, 2))
})

app.on('will-quit', () => globalShortcut.unregisterAll())
app.on('window-all-closed', () => {})
