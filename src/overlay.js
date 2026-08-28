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
import {
  CURRENT_ONBOARDING_VERSION,
  ONBOARDING_DEMO_START_DELAY_MS,
  ONBOARDING_SETTINGS_REVEAL_DELAY_MS,
  ONBOARDING_SHAPE_DEMO_CLICKS,
  ONBOARDING_STEP_COUNT,
  ONBOARDING_TOP_RESERVE,
  onboardingStepAfter,
  onboardingStepsFor,
  permissionRecoveryCopyFor,
  shouldShowOnboarding,
} from './onboarding.js'

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
const shapeButton = document.querySelector('#shape-button')
const positionButton = document.querySelector('#position-button')
const video = document.querySelector('#camera')
const effectVideo = document.querySelector('#effect-camera')
const cameraState = document.querySelector('#camera-state')
const cameraStateLabel = document.querySelector('#camera-state-label')
const framingZoom = document.querySelector('#framing-zoom')
const isQaPreview = !window.camFrame
const qaPreviewParams = new URLSearchParams(window.location.search)
const onboardingPanel = document.querySelector('#onboarding-panel')
const onboardingProgressLabel = document.querySelector('#onboarding-progress-label')
const onboardingProgressBar = document.querySelector('#onboarding-progress')
const onboardingProgress = document.querySelectorAll('[data-onboarding-progress]')
const onboardingTitle = document.querySelector('#onboarding-title')
const onboardingDescription = document.querySelector('#onboarding-description')
const onboardingItems = document.querySelector('#onboarding-items')
const onboardingNote = document.querySelector('#onboarding-note')
const onboardingSkip = document.querySelector('#onboarding-skip')
const onboardingBack = document.querySelector('#onboarding-back')
const onboardingNext = document.querySelector('#onboarding-next')
const onboardingDemoMouse = document.querySelector('#onboarding-demo-mouse')
const onboardingDemoWheel = document.querySelector('#onboarding-demo-wheel')
const onboardingDemoClick = document.querySelector('#onboarding-demo-click')
let qaFullscreenListener
const HEX_COLOR_PATTERN = /^#[0-9a-f]{6}$/i
const ONBOARDING_SHAPES = Object.freeze(['circle', 'rounded', 'portrait', 'landscape'])
const onboardingMotionQuery = window.matchMedia('(prefers-reduced-motion: reduce)')
const camFrame = window.camFrame ?? {
  platform: navigator.userAgent.includes('Mac') ? 'darwin' : 'win32',
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
    completedOnboardingVersion:
      qaPreviewParams.get('state') === 'onboarding' ? 0 : CURRENT_ONBOARDING_VERSION,
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
  setOverlayOnboardingOpen: (open) => (open ? ONBOARDING_TOP_RESERVE : 0),
  completeOnboarding: () => {},
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
  onShowOnboarding: () => {},
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
let onboardingOpen = false
let onboardingStep = 0
let onboardingCameraKnown = false
let onboardingAutoOffered = false
let onboardingReturnFocus
let onboardingTarget
let onboardingTargetDescription
let onboardingReveal
let onboardingDemoType
let onboardingDemoSnapshot
let onboardingDemoFramingChanged = false
const onboardingDemoTimeouts = new Set()
const onboardingDemoIntervals = new Set()
const onboardingDemoAnimations = new Set()
const onboardingSteps = onboardingStepsFor(camFrame.platform)

function clearOnboardingTarget() {
  if (!onboardingTarget) return
  delete onboardingTarget.dataset.onboardingTarget
  if (onboardingTargetDescription) {
    onboardingTarget.setAttribute('aria-describedby', onboardingTargetDescription)
  } else onboardingTarget.removeAttribute('aria-describedby')
  onboardingTarget = undefined
  onboardingTargetDescription = undefined
}

function prepareOnboardingStep(content) {
  onboardingReveal = content.reveal
  setHovered(true)
}

function revealOnboardingSettings(content, renderedStep) {
  if (
    !onboardingOpen ||
    onboardingStep !== renderedStep ||
    onboardingReveal !== content.reveal ||
    (content.reveal !== 'camera-settings' && content.reveal !== 'scene-settings')
  ) return

  selectSettingsPanel(content.reveal === 'camera-settings' ? 'camera' : 'presets')
  setControlsOpen(true)
  positionOnboardingCoachmark()
  requestAnimationFrame(positionOnboardingCoachmark)
}

function scheduleOnboardingDemo(callback, delay) {
  const timeout = setTimeout(() => {
    onboardingDemoTimeouts.delete(timeout)
    callback()
  }, delay)
  onboardingDemoTimeouts.add(timeout)
  return timeout
}

function trackOnboardingDemoAnimation(animation) {
  onboardingDemoAnimations.add(animation)
  animation.finished
    .catch(() => {})
    .finally(() => onboardingDemoAnimations.delete(animation))
  return animation
}

function placeOnboardingDemoMouse(target, offset = { x: 0, y: 0 }) {
  const overlayBounds = overlay.getBoundingClientRect()
  const targetBounds = target.getBoundingClientRect()
  onboardingDemoMouse.style.left = `${Math.round(
    targetBounds.left - overlayBounds.left + targetBounds.width / 2 - 9 + offset.x,
  )}px`
  onboardingDemoMouse.style.top = `${Math.round(
    targetBounds.top - overlayBounds.top + targetBounds.height / 2 - 13 + offset.y,
  )}px`
}

function showOnboardingDemoMouse(target, offset) {
  placeOnboardingDemoMouse(target, offset)
  onboardingDemoMouse.hidden = false
}

function hideOnboardingDemoMouse() {
  onboardingDemoMouse.hidden = true
  onboardingDemoMouse.style.opacity = ''
  onboardingDemoMouse.style.transform = ''
  onboardingDemoMouse.removeAttribute('data-action')
}

function stopOnboardingDemo({ commit = true, restore = false } = {}) {
  const stoppedType = onboardingDemoType
  const snapshot = onboardingDemoSnapshot
  onboardingDemoType = undefined
  onboardingDemoSnapshot = undefined
  overlay.removeAttribute('data-onboarding-demo')
  onboardingDemoTimeouts.forEach(clearTimeout)
  onboardingDemoTimeouts.clear()
  onboardingDemoIntervals.forEach(clearInterval)
  onboardingDemoIntervals.clear()
  onboardingDemoAnimations.forEach((animation) => animation.cancel())
  onboardingDemoAnimations.clear()
  hideOnboardingDemoMouse()

  if (restore && stoppedType === 'shape' && snapshot?.shape) {
    camFrame.updateState({ shape: snapshot.shape })
  } else if (restore && stoppedType === 'framing' && snapshot?.cameraPosition) {
    const cameraPosition = { ...snapshot.cameraPosition }
    state = { ...state, cameraPosition, cameraZoom: snapshot.cameraZoom }
    applyCameraFraming()
    camFrame.updateState({ cameraPosition, cameraZoom: snapshot.cameraZoom })
  } else if (commit && stoppedType === 'framing' && onboardingDemoFramingChanged && state) {
    camFrame.updateState({
      cameraPosition: { ...state.cameraPosition },
      cameraZoom: state.cameraZoom,
    })
  }
  onboardingDemoFramingChanged = false
}

function playOnboardingMouseClick(target, onActivate) {
  if (!onboardingDemoType) return
  showOnboardingDemoMouse(target)
  onboardingDemoMouse.dataset.action = 'click'
  trackOnboardingDemoAnimation(
    onboardingDemoMouse.animate(
      [
        { opacity: 0, transform: 'translate(22px, 24px)' },
        { opacity: 1, transform: 'translate(22px, 24px)', offset: 0.18 },
        { opacity: 1, transform: 'translate(0, 0)', offset: 0.55 },
        { opacity: 1, transform: 'scale(0.88)', offset: 0.64 },
        { opacity: 1, transform: 'scale(1)', offset: 0.74 },
        { opacity: 0, transform: 'translate(-4px, -4px)' },
      ],
      { duration: 920, easing: 'ease-in-out', fill: 'forwards' },
    ),
  )
  trackOnboardingDemoAnimation(
    onboardingDemoClick.animate(
      [
        { opacity: 0, transform: 'scale(0.45)' },
        { opacity: 0.9, transform: 'scale(0.65)', offset: 0.35 },
        { opacity: 0, transform: 'scale(1)' },
      ],
      { duration: 320, delay: 500, easing: 'ease-out' },
    ),
  )
  scheduleOnboardingDemo(() => {
    if (onboardingDemoType) onActivate()
  }, 560)
  scheduleOnboardingDemo(() => {
    if (onboardingDemoType) hideOnboardingDemoMouse()
  }, 920)
}

function cycleCameraShape() {
  const currentIndex = ONBOARDING_SHAPES.indexOf(state.shape)
  camFrame.updateState({
    shape: ONBOARDING_SHAPES[(currentIndex + 1) % ONBOARDING_SHAPES.length],
  })
}

function startShapeOnboardingDemo() {
  stopOnboardingDemo({ restore: true })
  onboardingDemoType = 'shape'
  onboardingDemoSnapshot = { shape: state.shape }
  overlay.dataset.onboardingDemo = 'shape'
  let clicks = 0

  const playNextClick = () => {
    if (onboardingDemoType !== 'shape') return
    playOnboardingMouseClick(shapeButton, cycleCameraShape)
    clicks += 1
    if (clicks < ONBOARDING_SHAPE_DEMO_CLICKS) {
      scheduleOnboardingDemo(playNextClick, 1280)
    } else {
      scheduleOnboardingDemo(() => {
        if (onboardingDemoType !== 'shape') return
        hideOnboardingDemoMouse()
        overlay.dataset.onboardingDemo = 'shape-ready'
      }, 980)
    }
  }

  playNextClick()
}

function setDemoFraming(cameraPosition, cameraZoom = state.cameraZoom) {
  state = { ...state, cameraPosition, cameraZoom }
  onboardingDemoFramingChanged = true
  applyCameraFraming()
}

function startDemoInterval(update) {
  const interval = setInterval(() => {
    if (!onboardingDemoType) {
      clearInterval(interval)
      onboardingDemoIntervals.delete(interval)
      return
    }
    update(interval)
  }, 16)
  onboardingDemoIntervals.add(interval)
  return interval
}

function finishDemoInterval(interval) {
  clearInterval(interval)
  onboardingDemoIntervals.delete(interval)
}

function playFramingResetDemo() {
  if (onboardingDemoType !== 'framing') return
  showOnboardingDemoMouse(cameraSurface)
  onboardingDemoMouse.dataset.action = 'double-click'
  trackOnboardingDemoAnimation(
    onboardingDemoMouse.animate(
      [
        { opacity: 0, transform: 'translate(16px, 18px)' },
        { opacity: 1, transform: 'translate(0, 0)', offset: 0.35 },
        { opacity: 1, transform: 'scale(0.88)', offset: 0.5 },
        { opacity: 1, transform: 'scale(1)', offset: 0.62 },
        { opacity: 1, transform: 'scale(0.88)', offset: 0.72 },
        { opacity: 1, transform: 'scale(1)', offset: 0.82 },
        { opacity: 0, transform: 'translate(-4px, -4px)' },
      ],
      { duration: 1000, easing: 'ease-in-out', fill: 'forwards' },
    ),
  )
  trackOnboardingDemoAnimation(
    onboardingDemoClick.animate(
      [
        { opacity: 0, transform: 'scale(0.45)' },
        { opacity: 0.9, transform: 'scale(0.65)', offset: 0.35 },
        { opacity: 0, transform: 'scale(1)' },
      ],
      { duration: 260, delay: 470, iterations: 2, easing: 'ease-out' },
    ),
  )
  scheduleOnboardingDemo(() => {
    if (onboardingDemoType !== 'framing') return
    const cameraPosition = { x: 50, y: 50 }
    setDemoFraming(cameraPosition, 100)
    camFrame.updateState({ cameraPosition, cameraZoom: 100 })
  }, 760)
  scheduleOnboardingDemo(() => {
    if (onboardingDemoType !== 'framing') return
    hideOnboardingDemoMouse()
    playFramingPanDemo()
  }, 1650)
}

function playFramingZoomDemo() {
  if (onboardingDemoType !== 'framing') return
  showOnboardingDemoMouse(cameraSurface, { x: 42, y: 0 })
  onboardingDemoMouse.dataset.action = 'scroll'
  trackOnboardingDemoAnimation(
    onboardingDemoMouse.animate(
      [
        { opacity: 0, transform: 'translateY(12px)' },
        { opacity: 1, transform: 'translateY(0)', offset: 0.2 },
        { opacity: 1, transform: 'translateY(0)', offset: 0.82 },
        { opacity: 0, transform: 'translateY(-6px)' },
      ],
      { duration: 1100, easing: 'ease-in-out', fill: 'forwards' },
    ),
  )
  trackOnboardingDemoAnimation(
    onboardingDemoWheel.animate(
      [
        { transform: 'translateY(-2px)' },
        { transform: 'translateY(2px)' },
        { transform: 'translateY(-2px)' },
      ],
      { duration: 260, iterations: 4, easing: 'ease-in-out' },
    ),
  )

  const startedAt = performance.now()
  const duration = 1000
  const startZoom = state.cameraZoom
  const targetZoom = startZoom >= 220 ? Math.max(100, startZoom - 30) : Math.min(250, startZoom + 30)
  startDemoInterval((interval) => {
    const progress = Math.min(1, (performance.now() - startedAt) / duration)
    const eased = progress * (2 - progress)
    const cameraZoom = Math.round(startZoom + (targetZoom - startZoom) * eased)
    setDemoFraming({ ...state.cameraPosition }, cameraZoom)
    if (progress < 1) return
    finishDemoInterval(interval)
    camFrame.updateState({ cameraZoom })
    scheduleOnboardingDemo(playFramingResetDemo, 520)
  })
}

function playFramingPanDemo() {
  if (onboardingDemoType !== 'framing') return
  showOnboardingDemoMouse(cameraSurface)
  onboardingDemoMouse.dataset.action = 'drag'
  trackOnboardingDemoAnimation(
    onboardingDemoMouse.animate(
      [
        { opacity: 0, transform: 'translate(-40px, 20px)' },
        { opacity: 1, transform: 'translate(-40px, 20px)', offset: 0.15 },
        { opacity: 1, transform: 'translate(40px, -18px)', offset: 0.84 },
        { opacity: 0, transform: 'translate(44px, -20px)' },
      ],
      { duration: 1400, easing: 'ease-in-out', fill: 'forwards' },
    ),
  )

  const startedAt = performance.now()
  const duration = 1400
  const startPosition = { ...state.cameraPosition }
  const surface = cameraSurface.getBoundingClientRect()
  startDemoInterval((interval) => {
    const progress = Math.min(1, (performance.now() - startedAt) / duration)
    const eased = progress * (2 - progress)
    const cameraPosition = cameraPositionAfterDrag(
      startPosition,
      { x: 80 * eased, y: -38 * eased },
      surface,
      state.mirror,
      state.cameraZoom,
    )
    setDemoFraming(cameraPosition)
    if (progress < 1) return
    finishDemoInterval(interval)
    camFrame.updateState({ cameraPosition })
    scheduleOnboardingDemo(playFramingZoomDemo, 420)
  })
}

function startFramingOnboardingDemo() {
  stopOnboardingDemo({ restore: true })
  onboardingDemoType = 'framing'
  onboardingDemoSnapshot = {
    cameraPosition: { ...state.cameraPosition },
    cameraZoom: state.cameraZoom,
  }
  overlay.dataset.onboardingDemo = 'framing'
  setPositioning(true)
  positionOnboardingCoachmark()
  playFramingPanDemo()
}

function startOnboardingDemonstration(content, renderedStep) {
  if (
    !onboardingOpen ||
    onboardingStep !== renderedStep ||
    onboardingReveal !== content.reveal ||
    onboardingMotionQuery.matches
  ) return

  if (content.reveal === 'shape-controls') startShapeOnboardingDemo()
  if (content.reveal === 'framing') startFramingOnboardingDemo()
}

function resetOnboardingDemonstration() {
  stopOnboardingDemo({ restore: true })
  if (positioning) setPositioning(false)
  if (controlsOpen) setControlsOpen(false)
  inlineSettings.style.removeProperty('--settings-top')
}

function positionOnboardingCoachmark() {
  if (!onboardingOpen || !onboardingTarget) return
  const panelBounds = onboardingPanel.getBoundingClientRect()
  const overlayBounds = overlay.getBoundingClientRect()
  const margin = 8
  const gap = 12
  const viewportWidth = overlayBounds.width
  const onboardingOffset =
    Number.parseFloat(getComputedStyle(overlay).getPropertyValue('--onboarding-offset')) || 0
  const toolbarTop = onboardingOffset + 22
  const top = Math.max(margin, toolbarTop - panelBounds.height - gap)
  const targetBounds = onboardingTarget.getBoundingClientRect()
  const targetCenter = targetBounds.left - overlayBounds.left + targetBounds.width / 2
  const left = Math.min(
    viewportWidth - panelBounds.width - margin,
    Math.max(margin, targetCenter - panelBounds.width / 2),
  )
  const arrowLeft = Math.min(panelBounds.width - 18, Math.max(18, targetCenter - left))

  onboardingPanel.style.setProperty('--coachmark-left', `${Math.round(left)}px`)
  onboardingPanel.style.setProperty('--coachmark-top', `${Math.round(top)}px`)
  onboardingPanel.style.setProperty('--coachmark-arrow-left', `${Math.round(arrowLeft)}px`)
  onboardingPanel.dataset.placement = 'above'
  if (
    controlsOpen &&
    (onboardingReveal === 'camera-settings' || onboardingReveal === 'scene-settings')
  ) {
    inlineSettings.style.setProperty('--settings-top', `${Math.round(toolbarTop + 44 + gap)}px`)
  } else inlineSettings.style.removeProperty('--settings-top')
}

new ResizeObserver(positionOnboardingCoachmark).observe(overlay)

function renderOnboardingStep({ focus = true } = {}) {
  const content = onboardingSteps[onboardingStep]
  const renderedStep = onboardingStep
  clearOnboardingTarget()
  onboardingReveal = undefined
  inlineSettings.style.removeProperty('--settings-top')
  prepareOnboardingStep(content)
  onboardingProgressLabel.textContent = 'Getting started'
  onboardingProgressBar.setAttribute('aria-valuenow', String(onboardingStep + 1))
  onboardingTitle.textContent = content.title
  onboardingDescription.textContent = content.description
  const items = content.items ?? []
  onboardingItems.replaceChildren(...items.map((item) => {
    const row = document.createElement('li')
    row.textContent = item
    return row
  }))
  onboardingItems.hidden = items.length === 0
  onboardingNote.textContent = content.note ?? ''
  onboardingNote.hidden = !content.note
  onboardingProgress.forEach((segment, index) => {
    segment.dataset.current = String(index <= onboardingStep)
  })
  onboardingBack.hidden = onboardingStep === 0
  onboardingNext.textContent =
    onboardingStep === ONBOARDING_STEP_COUNT - 1 ? 'Done' : 'Next'
  onboardingTarget = document.querySelector(content.target)
  if (onboardingTarget) {
    onboardingTarget.dataset.onboardingTarget = 'true'
    onboardingTargetDescription = onboardingTarget.getAttribute('aria-describedby')
    onboardingTarget.setAttribute(
      'aria-describedby',
      [onboardingTargetDescription, 'onboarding-description'].filter(Boolean).join(' '),
    )
  }
  positionOnboardingCoachmark()
  setTimeout(
    () => revealOnboardingSettings(content, renderedStep),
    ONBOARDING_SETTINGS_REVEAL_DELAY_MS,
  )
  setTimeout(
    () => startOnboardingDemonstration(content, renderedStep),
    ONBOARDING_DEMO_START_DELAY_MS,
  )
  requestAnimationFrame(() => {
    if (!onboardingOpen || onboardingStep !== renderedStep) return
    positionOnboardingCoachmark()
    if (focus) onboardingTitle.focus()
  })
}

function openOnboarding({ invoker } = {}) {
  if (onboardingOpen) {
    renderOnboardingStep()
    return
  }
  if (
    invoker instanceof HTMLElement &&
    invoker !== document.body &&
    !onboardingPanel.contains(invoker)
  ) {
    onboardingReturnFocus = invoker
  }
  onboardingOpen = true
  onboardingStep = 0
  const onboardingOffset = Math.max(0, Number(camFrame.setOverlayOnboardingOpen(true)) || 0)
  overlay.style.setProperty('--onboarding-offset', `${onboardingOffset}px`)
  overlay.dataset.onboarding = 'true'
  onboardingPanel.hidden = false
  setHovered(true)
  renderOnboardingStep()
}

function closeOnboarding({ complete = true } = {}) {
  if (!onboardingOpen) return
  onboardingOpen = false
  onboardingPanel.hidden = true
  overlay.dataset.onboarding = 'false'
  clearOnboardingTarget()
  onboardingReveal = undefined
  stopOnboardingDemo({ restore: true })
  inlineSettings.style.removeProperty('--settings-top')
  if (positioning) setPositioning(false)
  if (controlsOpen) setControlsOpen(false)
  camFrame.setOverlayOnboardingOpen(false)
  overlay.style.removeProperty('--onboarding-offset')
  if (complete && shouldShowOnboarding(state?.completedOnboardingVersion)) {
    state = { ...state, completedOnboardingVersion: CURRENT_ONBOARDING_VERSION }
    camFrame.completeOnboarding()
  }
  setInteractive(
    overlay.dataset.hovered === 'true' || controlsOpen || dragging || positioning || resizing,
  )
  const returnFocus = onboardingReturnFocus
  onboardingReturnFocus = undefined
  if (returnFocus?.isConnected) returnFocus.focus()
  scheduleHideChrome()
}

function maybeOfferOnboarding() {
  if (!state || !onboardingCameraKnown || onboardingAutoOffered) return
  onboardingAutoOffered = true
  if (shouldShowOnboarding(state.completedOnboardingVersion)) openOnboarding()
}

function markCameraKnownForOnboarding() {
  onboardingCameraKnown = true
  maybeOfferOnboarding()
}

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
    markCameraKnownForOnboarding()
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
    markCameraKnownForOnboarding()
  } catch (error) {
    if (request !== startRequest) return
    if (cameraId && (error.name === 'OverconstrainedError' || error.name === 'NotFoundError')) {
      camFrame.updateState({ cameraId: '', cameraLabel: 'Default camera' })
      return
    }
    const friendlyMessage =
      error.name === 'NotAllowedError'
        ? permissionRecoveryCopyFor(camFrame.platform)
        : error.name === 'NotReadableError'
          ? 'This camera is already in use by another app.'
          : 'CamFrame could not start this camera.'
    showCameraState(friendlyMessage)
    camFrame.reportCameraError(`${friendlyMessage} ${error.message ?? ''}`)
    markCameraKnownForOnboarding()
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
  maybeOfferOnboarding()
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
    hovered ||
      controlsOpen ||
      onboardingOpen ||
      dragging ||
      positioning ||
      resizing ||
      Boolean(cameraReposition),
  )
}

function scheduleFullscreenToolbarHide() {
  if (!fullscreen || controlsOpen || onboardingOpen || positioning || resizing || hoverTimer) return
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
  if (controlsOpen || onboardingOpen || positioning || resizing) return
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
  } else {
    setInteractive(overlay.dataset.hovered === 'true' || onboardingOpen || dragging || positioning)
  }
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
    event.target.closest('.camera-surface, .hover-toolbar, .inline-settings, .onboarding-coachmark')
  if (overInteractiveSurface) setHovered(true)
  else if (!dragging) scheduleHideChrome()
})

document.addEventListener('mouseleave', () => {
  if (fullscreen || controlsOpen || onboardingOpen || positioning || resizing) {
    scheduleHideChrome()
    return
  }
  setHovered(false)
})

cameraSurface.addEventListener('pointerenter', () => {
  if (onboardingDemoType === 'framing') stopOnboardingDemo()
})

cameraSurface.addEventListener('pointerdown', (event) => {
  if (event.button !== 0) return
  if (onboardingDemoType === 'framing') stopOnboardingDemo()
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
  if (!onboardingOpen) {
    if (controlsOpen) setControlsOpen(false)
    if (positioning) setPositioning(false)
    setHovered(false)
  }
}

cameraSurface.addEventListener('pointerup', stopDragging)
cameraSurface.addEventListener('pointercancel', stopDragging)
cameraSurface.addEventListener('pointerup', finishCameraReposition)
cameraSurface.addEventListener('pointercancel', finishCameraReposition)
cameraSurface.addEventListener('dblclick', () => {
  if (onboardingDemoType === 'framing') stopOnboardingDemo()
  if (!positioning) return
  const cameraPosition = { x: 50, y: 50 }
  state = { ...state, cameraPosition, cameraZoom: 100 }
  applyCameraFraming()
  camFrame.updateState({ cameraPosition, cameraZoom: 100 })
})

cameraSurface.addEventListener(
  'wheel',
  (event) => {
    if (onboardingDemoType === 'framing') stopOnboardingDemo()
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
window.addEventListener('resize', () => requestAnimationFrame(positionOnboardingCoachmark))

document.querySelector('#close-button').addEventListener('click', () => {
  setControlsOpen(false)
  camFrame.quit()
})

fullscreenButton.addEventListener('click', () => {
  if (onboardingOpen) closeOnboarding()
  camFrame.toggleFullscreen()
})

shapeButton.addEventListener('pointerenter', () => {
  if (onboardingDemoType === 'shape') stopOnboardingDemo({ commit: false })
})

shapeButton.addEventListener('focus', () => {
  if (onboardingDemoType === 'shape') stopOnboardingDemo({ commit: false })
})

shapeButton.addEventListener('click', () => {
  if (onboardingDemoType === 'shape') stopOnboardingDemo({ commit: false })
  cycleCameraShape()
})

positionButton.addEventListener('pointerenter', () => {
  if (onboardingDemoType === 'framing') stopOnboardingDemo()
})

positionButton.addEventListener('focus', () => {
  if (onboardingDemoType === 'framing') stopOnboardingDemo()
})

positionButton.addEventListener('click', () => {
  if (onboardingDemoType === 'framing') stopOnboardingDemo()
  setPositioning(!positioning)
  if (onboardingOpen) {
    positionOnboardingCoachmark()
    requestAnimationFrame(positionOnboardingCoachmark)
  }
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
  if (onboardingOpen && controlsOpen) {
    if (onboardingReveal === 'camera-settings') selectSettingsPanel('camera')
    if (onboardingReveal === 'scene-settings') selectSettingsPanel('presets')
  }
  if (onboardingOpen) {
    positionOnboardingCoachmark()
    requestAnimationFrame(positionOnboardingCoachmark)
  }
})

onboardingSkip.addEventListener('click', () => closeOnboarding())

onboardingBack.addEventListener('click', () => {
  resetOnboardingDemonstration()
  onboardingStep = onboardingStepAfter(onboardingStep, -1)
  renderOnboardingStep()
})

onboardingNext.addEventListener('click', () => {
  if (onboardingStep === ONBOARDING_STEP_COUNT - 1) {
    closeOnboarding()
    return
  }
  resetOnboardingDemonstration()
  onboardingStep = onboardingStepAfter(onboardingStep, 1)
  renderOnboardingStep()
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
  if (onboardingOpen) closeOnboarding({ complete: false })
  setHovered(true)
  setControlsOpen(true)
})

camFrame.onShowOnboarding(() => {
  openOnboarding({ invoker: document.activeElement })
})

camFrame.onStateChanged(applyState)
camFrame.onFullscreenChanged(applyFullscreen)
camFrame.getState().then((initialState) => {
  applyState(initialState)
  if (isQaPreview) {
    document.documentElement.classList.add('qa-preview')
    setHovered(qaPreviewParams.get('state') === 'hover')
    positionOnboardingCoachmark()
  } else reportDevices()
})

window.addEventListener('keydown', (event) => {
  if (onboardingOpen) {
    if (event.key !== 'Escape') return
    event.preventDefault()
    if (positioning) {
      setPositioning(false)
      positionOnboardingCoachmark()
      return
    }
    closeOnboarding()
    return
  }
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
