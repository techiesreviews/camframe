import {
  applyCameraTrackProfile,
  cameraConstraintsFor,
  cameraOptionsFrom,
  canReuseCameraStream,
  configureCameraTrack,
} from './cameras.js'
import { fullscreenButtonCopy } from './fullscreen.js'
import { cameraPositionAfterDrag } from './settings.js'

const overlay = document.querySelector('#overlay')
const cameraSurface = document.querySelector('#camera-surface')
const hoverToolbar = document.querySelector('#hover-toolbar')
const inlineSettings = document.querySelector('#inline-settings')
const cameraSelect = document.querySelector('#overlay-camera-select')
const sizeRange = document.querySelector('#overlay-size-range')
const sizeOutput = document.querySelector('#overlay-size-output')
const frameRange = document.querySelector('#overlay-frame-range')
const frameOutput = document.querySelector('#overlay-frame-output')
const topToggle = document.querySelector('#overlay-top-toggle')
const fullscreenButton = document.querySelector('#fullscreen-button')
const positionButton = document.querySelector('#position-button')
const video = document.querySelector('#camera')
const cameraState = document.querySelector('#camera-state')
const cameraStateLabel = document.querySelector('#camera-state-label')
const isQaPreview = !window.camFrame
let qaFullscreenListener
const camFrame = window.camFrame ?? {
  getState: async () => ({
    cameraId: '',
    shape: 'circle',
    size: 288,
    borderWidth: 0,
    borderColor: '#ffffff',
    mirror: true,
    cameraPosition: { x: 50, y: 50 },
    alwaysOnTop: true,
    overlayVisible: true,
  }),
  updateState: (patch) => applyState({ ...state, ...patch }),
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
  quit: () => {},
}

let activeStream
let activeCameraId
let startRequest = 0
let deviceRequest = 0
let state
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

function queueCameraQualityUpdate(nextFullscreen = fullscreen) {
  if (isQaPreview) return
  cameraQualityUpdates = cameraQualityUpdates.then(async () => {
    const track = activeStream?.getVideoTracks()[0]
    if (!track || track.readyState === 'ended') return
    await applyCameraTrackProfile(track, nextFullscreen)
  })
}

function showCameraState(message) {
  cameraStateLabel.textContent = message
  cameraState.hidden = false
}

function hideCameraState() {
  cameraState.hidden = true
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
  }

  try {
    let nextStream
    try {
      nextStream = await navigator.mediaDevices.getUserMedia(
        cameraConstraintsFor(cameraId, { fullscreen }),
      )
    } catch (error) {
      if (error.name !== 'OverconstrainedError') throw error
      nextStream = await navigator.mediaDevices.getUserMedia(
        cameraConstraintsFor(cameraId, { allowSlowerFrameRate: true, fullscreen }),
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
  state = nextState
  const cameraWidth = state.shape === 'portrait' ? state.size * 0.75 : state.size
  const cameraHeight = state.shape === 'landscape' ? state.size * 0.5625 : state.size
  const cameraWidthValue = `${Math.round(cameraWidth)}px`
  const cameraHeightValue = `${Math.round(cameraHeight)}px`
  overlay.dataset.shape = state.shape
  overlay.style.setProperty('--camera-width', cameraWidthValue)
  overlay.style.setProperty('--camera-height', cameraHeightValue)
  document.documentElement.style.setProperty('--camera-width', cameraWidthValue)
  document.documentElement.style.setProperty('--camera-height', cameraHeightValue)
  overlay.style.setProperty('--corner-scale-x', String(cameraWidth / cameraHeight))
  overlay.style.setProperty('--frame-width', `${state.borderWidth}px`)
  overlay.style.setProperty('--frame-color', state.borderColor)
  video.style.transform = state.mirror ? 'scaleX(-1)' : 'none'
  video.style.objectPosition = `${state.cameraPosition.x}% ${state.cameraPosition.y}%`
  document.querySelector('#mirror-button').classList.toggle('selected', state.mirror)
  sizeRange.value = String(state.size)
  sizeOutput.textContent = `${state.size} px`
  frameRange.value = String(state.borderWidth)
  frameOutput.textContent = `${state.borderWidth} px`
  topToggle.checked = state.alwaysOnTop
  if (state.cameraId && [...cameraSelect.options].some((option) => option.value === state.cameraId)) {
    cameraSelect.value = state.cameraId
  }
  if (cameraChanged) {
    cameraStateInitialized = true
    startCamera(state.cameraId)
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
  }
}

function setHovered(hovered) {
  clearTimeout(hoverTimer)
  overlay.dataset.hovered = String(hovered)
  setInteractive(
    hovered || controlsOpen || dragging || positioning || resizing || Boolean(cameraReposition),
  )
}

function setInteractive(nextInteractive) {
  if (interactive === nextInteractive) return
  interactive = nextInteractive
  camFrame.setOverlayInteractive(nextInteractive)
}

function scheduleHideChrome() {
  if (controlsOpen || positioning || resizing) return
  clearTimeout(hoverTimer)
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
  const overInteractiveSurface =
    event.target instanceof Element &&
    event.target.closest('.camera-surface, .hover-toolbar, .inline-settings')
  if (overInteractiveSurface) setHovered(true)
  else if (!dragging) scheduleHideChrome()
})

document.addEventListener('mouseleave', scheduleHideChrome)

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
  )
  video.style.objectPosition = `${cameraReposition.position.x}% ${cameraReposition.position.y}%`
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

cameraSurface.addEventListener('pointerup', stopDragging)
cameraSurface.addEventListener('pointercancel', stopDragging)
cameraSurface.addEventListener('pointerup', finishCameraReposition)
cameraSurface.addEventListener('pointercancel', finishCameraReposition)
cameraSurface.addEventListener('dblclick', () => {
  if (!positioning) return
  const cameraPosition = { x: 50, y: 50 }
  state = { ...state, cameraPosition }
  video.style.objectPosition = '50% 50%'
  camFrame.updateState({ cameraPosition })
})
window.addEventListener('blur', stopDragging)

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

document.querySelector('#mirror-button').addEventListener('click', () => {
  camFrame.updateState({ mirror: !state.mirror })
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

sizeRange.addEventListener('input', () => {
  sizeOutput.textContent = `${sizeRange.value} px`
  camFrame.updateState({ size: Number(sizeRange.value) })
})

frameRange.addEventListener('input', () => {
  frameOutput.textContent = `${frameRange.value} px`
  camFrame.updateState({ borderWidth: Number(frameRange.value) })
})

topToggle.addEventListener('change', () => {
  camFrame.updateState({ alwaysOnTop: topToggle.checked })
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

if (!isQaPreview) navigator.mediaDevices.addEventListener('devicechange', reportDevices)
window.addEventListener('beforeunload', () => {
  camFrame.stopOverlayDrag()
  activeStream?.getTracks().forEach((track) => track.stop())
})
