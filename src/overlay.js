import {
  applyCameraTrackProfile,
  cameraConstraintsFor,
  cameraOptionsFrom,
  canReuseCameraStream,
  configureCameraTrack,
} from './cameras.js'
import {
  FULLSCREEN_TOOLBAR_HIDE_DELAY_MS,
  fullscreenButtonCopy,
  pointIsInToolbarHotspot,
} from './fullscreen.js'
import { cameraPositionAfterDrag, cameraZoomAfterWheel } from './settings.js'

const overlay = document.querySelector('#overlay')
const cameraSurface = document.querySelector('#camera-surface')
const hoverToolbar = document.querySelector('#hover-toolbar')
const inlineSettings = document.querySelector('#inline-settings')
const settingsTabs = document.querySelectorAll('#inline-settings [data-settings-tab]')
const cameraSelect = document.querySelector('#overlay-camera-select')
const presetName = document.querySelector('#overlay-preset-name')
const savePresetButton = document.querySelector('#overlay-save-preset')
const presetSelect = document.querySelector('#overlay-preset-select')
const deletePresetButton = document.querySelector('#overlay-delete-preset')
const movePresetUpButton = document.querySelector('#overlay-move-preset-up')
const movePresetDownButton = document.querySelector('#overlay-move-preset-down')
const importPresetsButton = document.querySelector('#overlay-import-presets')
const exportPresetsButton = document.querySelector('#overlay-export-presets')
const sceneMessage = document.querySelector('#overlay-scene-message')
const overlayResolutionSelect = document.querySelector('#overlay-resolution-select')
const fullscreenResolutionSelect = document.querySelector('#fullscreen-resolution-select')
const effectSelect = document.querySelector('#overlay-effect-select')
const effectColorField = document.querySelector('#overlay-effect-color-field')
const effectColor = document.querySelector('#overlay-effect-color')
const effectColorSwatches = document.querySelectorAll('[data-effect-color]')
const glowControls = document.querySelector('#overlay-glow-controls')
const glowStrength = document.querySelector('#overlay-glow-strength')
const glowStrengthOutput = document.querySelector('#overlay-glow-strength-output')
const glowSpread = document.querySelector('#overlay-glow-spread')
const glowSpreadOutput = document.querySelector('#overlay-glow-spread-output')
const blurControls = document.querySelector('#overlay-blur-controls')
const blurAmount = document.querySelector('#overlay-blur-amount')
const blurAmountOutput = document.querySelector('#overlay-blur-amount-output')
const blurOpacity = document.querySelector('#overlay-blur-opacity')
const blurOpacityOutput = document.querySelector('#overlay-blur-opacity-output')
const frameRange = document.querySelector('#overlay-frame-range')
const frameOutput = document.querySelector('#overlay-frame-output')
const mirrorToggle = document.querySelector('#overlay-mirror-toggle')
const topToggle = document.querySelector('#overlay-top-toggle')
const launchToggle = document.querySelector('#overlay-launch-toggle')
const presentationToast = document.querySelector('#presentation-toast')
const fullscreenButton = document.querySelector('#fullscreen-button')
const positionButton = document.querySelector('#position-button')
const video = document.querySelector('#camera')
const effectVideo = document.querySelector('#effect-camera')
const cameraState = document.querySelector('#camera-state')
const cameraStateLabel = document.querySelector('#camera-state-label')
const framingZoom = document.querySelector('#framing-zoom')
const isQaPreview = !window.camFrame
let qaFullscreenListener
const HEX_COLOR_PATTERN = /^#[0-9a-f]{6}$/i
const camFrame = window.camFrame ?? {
  getState: async () => ({
    cameraId: '',
    shape: 'circle',
    size: 288,
    overlayResolution: '720p',
    fullscreenResolution: '2160p',
    frameEffect: 'none',
    effectColor: '#fb923c',
    glowStrength: 90,
    glowSpread: 13,
    blurAmount: 12,
    blurOpacity: 72,
    borderWidth: 0,
    borderColor: '#ffffff',
    mirror: true,
    cameraZoom: 100,
    cameraPosition: { x: 50, y: 50 },
    alwaysOnTop: true,
    overlayVisible: true,
    presets: [],
  }),
  updateState: (patch) => applyState({ ...state, ...patch }),
  savePreset: () => {},
  applyPreset: () => {},
  deletePreset: () => {},
  reorderPreset: () => {},
  exportPresets: async () => ({ canceled: false, count: 0 }),
  importPresets: async () => ({ canceled: false, count: 0 }),
  onStateChanged: () => {},
  reportDevices: () => {},
  reportCameraError: () => {},
  setOverlayInteractive: () => {},
  setOverlaySettingsOpen: () => {},
  startOverlayDrag: () => {},
  stopOverlayDrag: () => {},
  startOverlayResize: () => {},
  stopOverlayResize: () => {},
  toggleFullscreen: () => qaFullscreenListener?.(!fullscreen),
  exitFullscreen: () => qaFullscreenListener?.(false),
  onFullscreenChanged: (callback) => {
    qaFullscreenListener = callback
  },
  onShowControls: () => {},
  onPresentationNotice: () => {},
  quit: () => {},
}

let activeStream
let activeCameraId
let startRequest = 0
let deviceRequest = 0
let state
let selectedPresetId = ''
let cameraStateInitialized = false
let hoverTimer
let controlsOpen = false
let dragging = false
let interactive = false
let fullscreen = false
let positioning = false
let cameraReposition
let resizing = false
let cameraQualityUpdates = Promise.resolve()
let presentationToastTimer

function selectSettingsPanel(panel) {
  inlineSettings.dataset.activePanel = panel
  settingsTabs.forEach((button) => {
    button.setAttribute('aria-pressed', String(button.dataset.settingsTab === panel))
  })
}

function showPresentationNotice(message) {
  clearTimeout(presentationToastTimer)
  presentationToast.textContent = message
  presentationToast.hidden = false
  presentationToastTimer = setTimeout(() => {
    presentationToast.hidden = true
  }, 1600)
}

settingsTabs.forEach((button) => {
  button.addEventListener('click', () => selectSettingsPanel(button.dataset.settingsTab))
})

function queueCameraQualityUpdate(nextFullscreen = fullscreen) {
  if (isQaPreview) return
  cameraQualityUpdates = cameraQualityUpdates.then(async () => {
    const track = activeStream?.getVideoTracks()[0]
    if (!track || track.readyState === 'ended') return
    const resolution = nextFullscreen ? state.fullscreenResolution : state.overlayResolution
    await applyCameraTrackProfile(track, nextFullscreen, resolution)
  })
}

function showCameraState(message) {
  cameraStateLabel.textContent = message
  cameraState.hidden = false
}

function hideCameraState() {
  cameraState.hidden = true
}

function applyCameraFraming() {
  const cameraTransform = `${state.mirror ? 'scaleX(-1) ' : ''}scale(${state.cameraZoom / 100})`
  const cameraOrigin = `${state.cameraPosition.x}% ${state.cameraPosition.y}%`
  for (const camera of [video, effectVideo]) {
    camera.style.transform = cameraTransform
    camera.style.transformOrigin = cameraOrigin
    camera.style.objectPosition = cameraOrigin
  }
  framingZoom.textContent = `${state.cameraZoom}%`
}

async function syncEffectVideo() {
  const shouldShowCameraHalo = state?.frameEffect === 'blur' && activeStream
  if (!shouldShowCameraHalo) {
    effectVideo.pause()
    effectVideo.srcObject = null
    return
  }

  if (effectVideo.srcObject !== activeStream) effectVideo.srcObject = activeStream
  try {
    await effectVideo.play()
  } catch {
    // The primary camera video owns playback; a later state update can retry the halo.
  }
}

async function reportDevices() {
  const request = ++deviceRequest

  try {
    const allDevices = await navigator.mediaDevices.enumerateDevices()
    if (request !== deviceRequest) return

    const cameras = cameraOptionsFrom(allDevices)
    renderDevices(cameras)
    camFrame.reportDevices(cameras)
  } catch (error) {
    if (request !== deviceRequest) return
    cameraSelect.replaceChildren(new Option('Camera scan failed', ''))
    cameraSelect.disabled = true
    camFrame.reportCameraError(`CamFrame could not scan cameras. ${error.message ?? ''}`)
  }
}

function renderDevices(cameras) {
  cameraSelect.replaceChildren()
  if (!cameras.length) {
    cameraSelect.add(new Option('No cameras found', ''))
    cameraSelect.disabled = true
    return
  }

  cameraSelect.disabled = false
  for (const camera of cameras) cameraSelect.add(new Option(camera.label, camera.deviceId))
  const activeDeviceId = activeStream?.getVideoTracks()[0]?.getSettings().deviceId
  const selectedDeviceId = state?.cameraId || activeDeviceId
  if (cameras.some((camera) => camera.deviceId === selectedDeviceId)) {
    cameraSelect.value = selectedDeviceId
  }
}

function renderPresets() {
  const previousPresetId = selectedPresetId
  if (state.presets.some((preset) => preset.id === state.activePresetId)) {
    selectedPresetId = state.activePresetId
  } else if (!state.presets.some((preset) => preset.id === selectedPresetId)) {
    selectedPresetId = ''
  }
  presetSelect.replaceChildren(
    new Option(state.presets.length ? 'New scene…' : 'No saved scenes', ''),
  )
  state.presets.forEach((preset, index) => {
    presetSelect.add(new Option(`${index + 1}. ${preset.name}`, preset.id))
  })
  presetSelect.value = selectedPresetId
  const selectedIndex = state.presets.findIndex((preset) => preset.id === selectedPresetId)
  deletePresetButton.disabled = selectedIndex < 0
  movePresetUpButton.disabled = selectedIndex <= 0
  movePresetDownButton.disabled = selectedIndex < 0 || selectedIndex >= state.presets.length - 1
  savePresetButton.textContent = selectedPresetId ? 'Update' : 'Save'
  if (previousPresetId !== selectedPresetId) {
    presetName.value = state.presets[selectedIndex]?.name ?? ''
    savePresetButton.disabled = !presetName.value.trim()
  }
}

async function startCamera(cameraId = '') {
  if (isQaPreview) {
    hideCameraState()
    return
  }
  const activeDeviceId = activeStream?.getVideoTracks()[0]?.getSettings().deviceId
  if (activeStream && canReuseCameraStream(cameraId, activeCameraId, activeDeviceId)) {
    activeCameraId = cameraId
    await reportDevices()
    return
  }
  const request = ++startRequest
  showCameraState('Starting camera.')

  if (activeStream) {
    activeStream.getTracks().forEach((track) => track.stop())
    activeStream = undefined
    activeCameraId = undefined
    video.srcObject = null
    effectVideo.srcObject = null
  }

  try {
    let nextStream
    try {
      nextStream = await navigator.mediaDevices.getUserMedia(
        cameraConstraintsFor(cameraId, {
          fullscreen,
          resolution: fullscreen ? state.fullscreenResolution : state.overlayResolution,
        }),
      )
    } catch (error) {
      if (error.name !== 'OverconstrainedError') throw error
      nextStream = await navigator.mediaDevices.getUserMedia(
        cameraConstraintsFor(cameraId, {
          allowSlowerFrameRate: true,
          fullscreen,
          resolution: fullscreen ? state.fullscreenResolution : state.overlayResolution,
        }),
      )
    }
    if (request !== startRequest) {
      nextStream.getTracks().forEach((track) => track.stop())
      return
    }
    activeStream = nextStream
    activeCameraId = cameraId
    video.srcObject = nextStream
    const [track] = nextStream.getVideoTracks()
    configureCameraTrack(track)
    await video.play()
    await syncEffectVideo()
    await reportDevices()
    hideCameraState()
  } catch (error) {
    if (request !== startRequest) return
    if (cameraId && (error.name === 'OverconstrainedError' || error.name === 'NotFoundError')) {
      camFrame.updateState({ cameraId: '', cameraLabel: 'Default camera' })
      return
    }
    const friendlyMessage =
      error.name === 'NotAllowedError'
        ? 'Camera access is blocked in Windows privacy settings.'
        : error.name === 'NotReadableError'
          ? 'This camera is already in use by another app.'
          : 'CamFrame could not start this camera.'
    showCameraState(friendlyMessage)
    camFrame.reportCameraError(`${friendlyMessage} ${error.message ?? ''}`)
  }
}

function applyState(nextState) {
  const cameraChanged = !cameraStateInitialized || state?.cameraId !== nextState.cameraId
  const effectChanged = cameraStateInitialized && state?.frameEffect !== nextState.frameEffect
  const qualityChanged =
    cameraStateInitialized &&
    (state?.overlayResolution !== nextState.overlayResolution ||
      state?.fullscreenResolution !== nextState.fullscreenResolution)
  state = nextState
  const cameraWidth = state.shape === 'portrait' ? state.size * 0.75 : state.size
  const cameraHeight = state.shape === 'landscape' ? state.size * 0.5625 : state.size
  const cameraWidthValue = `${Math.round(cameraWidth)}px`
  const cameraHeightValue = `${Math.round(cameraHeight)}px`
  overlay.dataset.shape = state.shape
  overlay.dataset.effect = state.frameEffect
  overlay.style.setProperty('--camera-width', cameraWidthValue)
  overlay.style.setProperty('--camera-height', cameraHeightValue)
  document.documentElement.style.setProperty('--camera-width', cameraWidthValue)
  document.documentElement.style.setProperty('--camera-height', cameraHeightValue)
  overlay.style.setProperty('--corner-scale-x', String(cameraWidth / cameraHeight))
  overlay.style.setProperty('--frame-width', `${state.borderWidth}px`)
  overlay.style.setProperty('--frame-color', state.borderColor)
  overlay.style.setProperty('--effect-color', state.effectColor)
  overlay.style.setProperty('--effect-glow-near', `${Math.max(1, Math.round(state.glowSpread * 0.4))}px`)
  overlay.style.setProperty('--effect-glow-far', `${state.glowSpread}px`)
  overlay.style.setProperty('--effect-glow-opacity', String(state.glowStrength / 100))
  overlay.style.setProperty('--effect-blur-radius', `${state.blurAmount}px`)
  overlay.style.setProperty('--effect-blur-opacity', String(state.blurOpacity / 100))
  applyCameraFraming()
  mirrorToggle.checked = state.mirror
  overlayResolutionSelect.value = state.overlayResolution
  fullscreenResolutionSelect.value = state.fullscreenResolution
  effectSelect.value = state.frameEffect
  effectColor.value = state.effectColor.toUpperCase()
  effectColorSwatches.forEach((swatch) => {
    swatch.setAttribute('aria-pressed', String(swatch.dataset.effectColor === state.effectColor))
  })
  effectColorField.hidden = state.frameEffect !== 'glow'
  glowControls.hidden = state.frameEffect !== 'glow'
  glowStrength.value = String(state.glowStrength)
  glowStrengthOutput.textContent = `${state.glowStrength}%`
  glowSpread.value = String(state.glowSpread)
  glowSpreadOutput.textContent = `${state.glowSpread} px`
  blurControls.hidden = state.frameEffect !== 'blur'
  blurAmount.value = String(state.blurAmount)
  blurAmountOutput.textContent = `${state.blurAmount} px`
  blurOpacity.value = String(state.blurOpacity)
  blurOpacityOutput.textContent = `${state.blurOpacity}%`
  frameRange.value = String(state.borderWidth)
  frameOutput.textContent = `${state.borderWidth} px`
  topToggle.checked = state.alwaysOnTop
  launchToggle.checked = state.launchAtLogin
  renderPresets()
  if (state.cameraId && [...cameraSelect.options].some((option) => option.value === state.cameraId)) {
    cameraSelect.value = state.cameraId
  }
  if (cameraChanged) {
    cameraStateInitialized = true
    startCamera(state.cameraId)
  } else {
    if (qualityChanged) queueCameraQualityUpdate(fullscreen)
    if (effectChanged) syncEffectVideo()
  }
}

function applyFullscreen(nextFullscreen) {
  fullscreen = Boolean(nextFullscreen)
  queueCameraQualityUpdate(fullscreen)
  overlay.dataset.fullscreen = String(fullscreen)
  fullscreenButton.classList.toggle('selected', fullscreen)
  const label = fullscreenButtonCopy(fullscreen)
  fullscreenButton.setAttribute('aria-label', label)
  fullscreenButton.title = label
  if (fullscreen) {
    setControlsOpen(false)
    setHovered(true)
    scheduleFullscreenToolbarHide()
  } else setHovered(false)
}

function clearHoverTimer() {
  clearTimeout(hoverTimer)
  hoverTimer = undefined
}

function setHovered(hovered) {
  clearHoverTimer()
  overlay.dataset.hovered = String(hovered)
  setInteractive(
    hovered || controlsOpen || dragging || positioning || resizing || Boolean(cameraReposition),
  )
}

function scheduleFullscreenToolbarHide() {
  if (!fullscreen || controlsOpen || positioning || resizing || hoverTimer) return
  hoverTimer = setTimeout(() => {
    hoverTimer = undefined
    setHovered(false)
  }, FULLSCREEN_TOOLBAR_HIDE_DELAY_MS)
}

function setInteractive(nextInteractive) {
  if (interactive === nextInteractive) return
  interactive = nextInteractive
  camFrame.setOverlayInteractive(nextInteractive)
}

function scheduleHideChrome() {
  if (fullscreen) {
    scheduleFullscreenToolbarHide()
    return
  }
  if (controlsOpen || positioning || resizing) return
  clearHoverTimer()
  hoverTimer = setTimeout(() => setHovered(false), 220)
}

function setControlsOpen(open) {
  controlsOpen = open
  inlineSettings.hidden = !open
  document.querySelector('#controls-button').classList.toggle('selected', open)
  camFrame.setOverlaySettingsOpen(open)
  if (open) {
    setHovered(true)
    if (!isQaPreview) reportDevices()
  } else setInteractive(overlay.dataset.hovered === 'true' || dragging || positioning)
}

function setPositioning(nextPositioning) {
  positioning = Boolean(nextPositioning)
  overlay.dataset.positioning = String(positioning)
  positionButton.classList.toggle('selected', positioning)
  positionButton.setAttribute('aria-pressed', String(positioning))
  const positionButtonCopy = positioning
    ? 'Finish framing'
    : 'Frame camera: drag to pan, scroll to zoom'
  positionButton.setAttribute('aria-label', positionButtonCopy)
  positionButton.title = positionButtonCopy
  if (positioning) {
    setControlsOpen(false)
    setHovered(true)
  } else {
    cameraReposition = undefined
    delete cameraSurface.dataset.repositioning
    setInteractive(overlay.dataset.hovered === 'true' || controlsOpen || dragging)
  }
}

document.addEventListener('mousemove', (event) => {
  if (fullscreen) {
    if (
      controlsOpen ||
      pointIsInToolbarHotspot(
        { x: event.clientX, y: event.clientY },
        hoverToolbar.getBoundingClientRect(),
      )
    ) {
      setHovered(true)
    } else scheduleFullscreenToolbarHide()
    return
  }
  const overInteractiveSurface =
    event.target instanceof Element &&
    event.target.closest('.camera-surface, .hover-toolbar, .inline-settings')
  if (overInteractiveSurface) setHovered(true)
  else if (!dragging) scheduleHideChrome()
})

document.addEventListener('mouseleave', () => {
  if (fullscreen || controlsOpen || positioning || resizing) {
    scheduleHideChrome()
    return
  }
  setHovered(false)
})

cameraSurface.addEventListener('pointerdown', (event) => {
  if (event.button !== 0) return
  if (positioning) {
    cameraReposition = {
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      startPosition: { ...state.cameraPosition },
      position: { ...state.cameraPosition },
    }
    cameraSurface.dataset.repositioning = 'true'
    cameraSurface.setPointerCapture(event.pointerId)
    setInteractive(true)
    event.preventDefault()
    return
  }
  if (fullscreen) return
  dragging = true
  cameraSurface.dataset.dragging = 'true'
  cameraSurface.setPointerCapture(event.pointerId)
  setInteractive(true)
  camFrame.startOverlayDrag()
})

cameraSurface.addEventListener('pointermove', (event) => {
  if (!cameraReposition || event.pointerId !== cameraReposition.pointerId) return
  const bounds = cameraSurface.getBoundingClientRect()
  cameraReposition.position = cameraPositionAfterDrag(
    cameraReposition.startPosition,
    { x: event.clientX - cameraReposition.startX, y: event.clientY - cameraReposition.startY },
    bounds,
    state.mirror,
    state.cameraZoom,
  )
  video.style.objectPosition = `${cameraReposition.position.x}% ${cameraReposition.position.y}%`
  video.style.transformOrigin = `${cameraReposition.position.x}% ${cameraReposition.position.y}%`
  effectVideo.style.objectPosition = `${cameraReposition.position.x}% ${cameraReposition.position.y}%`
  effectVideo.style.transformOrigin = `${cameraReposition.position.x}% ${cameraReposition.position.y}%`
})

function finishCameraReposition(event) {
  if (!cameraReposition || event.pointerId !== cameraReposition.pointerId) return
  const position = cameraReposition.position
  cameraReposition = undefined
  delete cameraSurface.dataset.repositioning
  state = { ...state, cameraPosition: position }
  camFrame.updateState({ cameraPosition: position })
  setInteractive(true)
}

function stopDragging() {
  if (!dragging) return
  dragging = false
  delete cameraSurface.dataset.dragging
  camFrame.stopOverlayDrag()
  setInteractive(overlay.dataset.hovered === 'true' || controlsOpen)
}

function handleWindowBlur() {
  stopDragging()
  if (controlsOpen) setControlsOpen(false)
  if (positioning) setPositioning(false)
  setHovered(false)
}

cameraSurface.addEventListener('pointerup', stopDragging)
cameraSurface.addEventListener('pointercancel', stopDragging)
cameraSurface.addEventListener('pointerup', finishCameraReposition)
cameraSurface.addEventListener('pointercancel', finishCameraReposition)
cameraSurface.addEventListener('dblclick', () => {
  if (!positioning) return
  const cameraPosition = { x: 50, y: 50 }
  state = { ...state, cameraPosition, cameraZoom: 100 }
  applyCameraFraming()
  camFrame.updateState({ cameraPosition, cameraZoom: 100 })
})

cameraSurface.addEventListener(
  'wheel',
  (event) => {
    if (!positioning) return
    event.preventDefault()
    const cameraZoom = cameraZoomAfterWheel(state.cameraZoom, event.deltaY)
    if (cameraZoom === state.cameraZoom) return
    state = { ...state, cameraZoom }
    applyCameraFraming()
    camFrame.updateState({ cameraZoom })
  },
  { passive: false },
)
window.addEventListener('blur', handleWindowBlur)

document.querySelector('#close-button').addEventListener('click', () => {
  setControlsOpen(false)
  camFrame.quit()
})

fullscreenButton.addEventListener('click', () => {
  camFrame.toggleFullscreen()
})

document.querySelector('#shape-button').addEventListener('click', () => {
  const shapes = ['circle', 'rounded', 'portrait', 'landscape']
  camFrame.updateState({ shape: shapes[(shapes.indexOf(state.shape) + 1) % shapes.length] })
})

positionButton.addEventListener('click', () => {
  setPositioning(!positioning)
})

document.querySelectorAll('[data-resize-handle]').forEach((handle) => {
  handle.addEventListener('pointerdown', (event) => {
    if (event.button !== 0 || fullscreen) return
    resizing = true
    overlay.dataset.resizing = 'true'
    handle.setPointerCapture(event.pointerId)
    setInteractive(true)
    camFrame.startOverlayResize(handle.dataset.resizeHandle)
    event.preventDefault()
    event.stopPropagation()
  })

  const stopResizing = () => {
    if (!resizing) return
    resizing = false
    delete overlay.dataset.resizing
    camFrame.stopOverlayResize()
    setInteractive(overlay.dataset.hovered === 'true' || controlsOpen || positioning)
    scheduleHideChrome()
  }

  handle.addEventListener('pointerup', stopResizing)
  handle.addEventListener('pointercancel', stopResizing)
  window.addEventListener('blur', stopResizing)
})

document.querySelector('#controls-button').addEventListener('click', () => {
  setControlsOpen(!controlsOpen)
})

cameraSelect.addEventListener('change', () => {
  const option = cameraSelect.selectedOptions[0]
  camFrame.updateState({ cameraId: cameraSelect.value, cameraLabel: option.textContent })
})

presetName.addEventListener('input', () => {
  savePresetButton.disabled = !presetName.value.trim()
})

savePresetButton.addEventListener('click', () => {
  const name = presetName.value.trim()
  if (!name) return
  camFrame.savePreset(name, selectedPresetId)
  if (!selectedPresetId) {
    presetName.value = ''
    savePresetButton.disabled = true
  }
  setControlsOpen(false)
})

presetName.addEventListener('keydown', (event) => {
  if (event.key === 'Enter' && !savePresetButton.disabled) savePresetButton.click()
})

presetSelect.addEventListener('change', () => {
  selectedPresetId = presetSelect.value
  const selected = state.presets.find((preset) => preset.id === selectedPresetId)
  presetName.value = selected?.name ?? ''
  savePresetButton.textContent = selected ? 'Update' : 'Save'
  savePresetButton.disabled = !presetName.value.trim()
  const selectedIndex = state.presets.findIndex((preset) => preset.id === selectedPresetId)
  deletePresetButton.disabled = selectedIndex < 0
  movePresetUpButton.disabled = selectedIndex <= 0
  movePresetDownButton.disabled = selectedIndex < 0 || selectedIndex >= state.presets.length - 1
  if (selectedPresetId) {
    camFrame.applyPreset(selectedPresetId)
    setControlsOpen(false)
  }
})

movePresetUpButton.addEventListener('click', () => {
  if (selectedPresetId) camFrame.reorderPreset(selectedPresetId, -1)
})

movePresetDownButton.addEventListener('click', () => {
  if (selectedPresetId) camFrame.reorderPreset(selectedPresetId, 1)
})

importPresetsButton.addEventListener('click', async () => {
  const result = await camFrame.importPresets()
  sceneMessage.textContent = result.error ?? (result.canceled ? '' : `${result.count} imported`)
})

exportPresetsButton.addEventListener('click', async () => {
  const result = await camFrame.exportPresets()
  sceneMessage.textContent = result.error ?? (result.canceled ? '' : `${result.count} exported`)
})

deletePresetButton.addEventListener('click', () => {
  if (!selectedPresetId) return
  camFrame.deletePreset(selectedPresetId)
  selectedPresetId = ''
  setControlsOpen(false)
})

overlayResolutionSelect.addEventListener('change', () => {
  camFrame.updateState({ overlayResolution: overlayResolutionSelect.value })
})

fullscreenResolutionSelect.addEventListener('change', () => {
  camFrame.updateState({ fullscreenResolution: fullscreenResolutionSelect.value })
})

effectSelect.addEventListener('change', () => {
  camFrame.updateState({ frameEffect: effectSelect.value })
})

effectColor.addEventListener('input', () => {
  if (HEX_COLOR_PATTERN.test(effectColor.value)) {
    camFrame.updateState({ effectColor: effectColor.value.toLowerCase() })
  }
})

effectColor.addEventListener('blur', () => {
  if (!HEX_COLOR_PATTERN.test(effectColor.value)) effectColor.value = state.effectColor.toUpperCase()
})

effectColorSwatches.forEach((swatch) => {
  swatch.addEventListener('click', () => {
    camFrame.updateState({ effectColor: swatch.dataset.effectColor })
  })
})

function bindEffectRange(input, output, key, suffix) {
  input.addEventListener('input', () => {
    output.textContent = `${input.value}${suffix}`
    camFrame.updateState({ [key]: Number(input.value) })
  })
}

bindEffectRange(glowStrength, glowStrengthOutput, 'glowStrength', '%')
bindEffectRange(glowSpread, glowSpreadOutput, 'glowSpread', ' px')
bindEffectRange(blurAmount, blurAmountOutput, 'blurAmount', ' px')
bindEffectRange(blurOpacity, blurOpacityOutput, 'blurOpacity', '%')

frameRange.addEventListener('input', () => {
  frameOutput.textContent = `${frameRange.value} px`
  camFrame.updateState({ borderWidth: Number(frameRange.value) })
})

mirrorToggle.addEventListener('change', () => {
  camFrame.updateState({ mirror: mirrorToggle.checked })
})

topToggle.addEventListener('change', () => {
  camFrame.updateState({ alwaysOnTop: topToggle.checked })
})

launchToggle.addEventListener('change', () => {
  camFrame.updateState({ launchAtLogin: launchToggle.checked })
})

camFrame.onShowControls(() => {
  setHovered(true)
  setControlsOpen(true)
})

camFrame.onStateChanged(applyState)
camFrame.onFullscreenChanged(applyFullscreen)
camFrame.getState().then((initialState) => {
  applyState(initialState)
  if (isQaPreview) {
    document.documentElement.classList.add('qa-preview')
    setHovered(new URLSearchParams(window.location.search).get('state') === 'hover')
  } else reportDevices()
})

window.addEventListener('keydown', (event) => {
  if (event.key !== 'Escape') return
  if (positioning && !fullscreen) {
    event.preventDefault()
    setPositioning(false)
    return
  }
  if (!fullscreen) return
  event.preventDefault()
  camFrame.exitFullscreen()
})

camFrame.onPresentationNotice(showPresentationNotice)

if (!isQaPreview) navigator.mediaDevices.addEventListener('devicechange', reportDevices)
window.addEventListener('beforeunload', () => {
  camFrame.stopOverlayDrag()
  effectVideo.srcObject = null
  activeStream?.getTracks().forEach((track) => track.stop())
})
