import { DEFAULT_CAMERA_LABEL, createCameraSession } from './camera-session.js'
import { createOverlayInteraction } from './overlay-interaction.js'
import { DEFAULT_SETTINGS, SHAPES, STARTER_SCENES, dimensionsFor, sanitizeSettings } from './settings.js'
import * as sceneLibrary from './scenes.js'
import { createScenesPanel } from './scenes-panel.js'
import {
  cameraFramingStyles,
  cameraPositionAfterDrag,
  cameraZoomAfterWheel,
  centeredFraming,
} from './camera-framing.js'
import { createBridgeFake } from './bridge.js'
import {
  CURRENT_ONBOARDING_VERSION,
  ONBOARDING_TOP_RESERVE,
  createOnboardingTour,
  onboardingStepsFor,
} from './onboarding.js'
import { prompterLinkView, toggledPrompterLink } from './prompter-link-view.js'

const overlay = document.querySelector('#overlay')
const cameraSurface = document.querySelector('#camera-surface')
const hoverToolbar = document.querySelector('#hover-toolbar')
const inlineSettings = document.querySelector('#inline-settings')
const settingsTabs = document.querySelectorAll('#inline-settings [data-settings-tab]')
const cameraSelect = document.querySelector('#overlay-camera-select')
const scenesPanelRoot = document.querySelector('#scenes-panel')
const overlayResolutionSelect = document.querySelector('#overlay-resolution-select')
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
// The toolbar button's screen reader description: the Prompter link status (ADR 0037 removed the
// Scenes tab's Prompter link section; the toolbar button is its only control).
const prompterStatus = document.querySelector('#overlay-prompter-status')
const presentationToast = document.querySelector('#presentation-toast')
const sceneAnnouncer = document.querySelector('#scene-announcer')
let sceneAnnouncerClear
const fullscreenButton = document.querySelector('#fullscreen-button')
const shapeButton = document.querySelector('#shape-button')
const positionButton = document.querySelector('#position-button')
const prompterButton = document.querySelector('#prompter-button')
// The Overlay's last Prompter link request (see toggledPrompterLink).
let pendingPrompterLink
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
const HEX_COLOR_PATTERN = /^#[0-9a-f]{6}$/i
const SHAPE_CYCLE = Object.freeze([...SHAPES])
const onboardingMotionQuery = window.matchMedia('(prefers-reduced-motion: reduce)')
const forcedColorsQuery = window.matchMedia('(forced-colors: active)')
const increasedContrastQuery = window.matchMedia('(prefers-contrast: more)')
// The QA preview has no main process: the Prompter link shows on, or `?prompter=busy` its port error.
function qaPrompterLinkStatus(patch) {
  if (!Object.hasOwn(patch, 'prompterLink')) return {}
  if (!patch.prompterLink) return { prompterLinkStatus: { state: 'off', port: 47833, message: '' } }
  return qaPreviewParams.get('prompter') === 'busy'
    ? { prompterLinkStatus: { state: 'error', port: 47833, message: 'Port 47833 is in use by another app.' } }
    : { prompterLinkStatus: { state: 'on', port: 47833, message: '' } }
}
// The QA preview runs the real Scene library on a pretend 1920x1080 display, so the Scenes tab can be
// tried without Electron: `?scenes=empty|starter|full` picks the Scenes it starts with.
const QA_DISPLAY = Object.freeze({ x: 0, y: 0, width: 1920, height: 1080 })
const QA_WORK_AREA = Object.freeze({ x: 0, y: 0, width: 1920, height: 1040 })
const qaScenes = {
  edits: sceneLibrary.createSceneEdits(),
  active: '',
  context: { workArea: QA_WORK_AREA, workAreaAt: () => QA_WORK_AREA },
  start() {
    const extra = [
      { id: 'qa-interview', name: 'Interview', settings: { shape: 'landscape', size: 360, borderWidth: 4, position: { x: 60, y: 600 } } },
      { id: 'qa-demo', name: 'Demo corner', settings: { shape: 'rounded', size: 220, frameEffect: 'glow', position: { x: 40, y: 30 } } },
      { id: 'qa-outro', name: 'Outro', settings: { shape: 'portrait', size: 420, frameEffect: 'glow', effectColor: '#22d3ee', position: { x: 760, y: 300 } } },
      { id: 'qa-wide', name: 'Wide top', settings: { shape: 'landscape', size: 400, position: { x: 1460, y: 20 } } },
    ]
    const pick = qaPreviewParams.get('scenes') ?? 'starter'
    const presets = pick === 'empty' ? [] : pick === 'full' ? [...STARTER_SCENES, ...extra] : STARTER_SCENES
    const settings = sanitizeSettings({ ...DEFAULT_SETTINGS, presets })
    this.active = presets.length ? presets[0].id : ''
    const applied = this.active ? sceneLibrary.applyScene({ settings, activeSceneId: '' }, this.active, this.context) : undefined
    return applied?.settings ?? settings
  },
  stateFor(settings) {
    return {
      ...settings,
      activePresetId: this.active,
      ...this.edits.view(this.active),
      scenePreviews: sceneLibrary.scenePreviews(settings, { ...this.context, displayAt: () => QA_DISPLAY }),
    }
  },
  commit(result) {
    if (!result?.settings) return
    this.edits.track({ settings: state, activeSceneId: this.active }, result)
    this.active = result.activeSceneId
    applyState({ ...this.stateFor(result.settings), prompterLinkStatus: state.prompterLinkStatus })
  },
  library: () => ({ settings: sanitizeSettings(state), activeSceneId: qaScenes.active }),
}
const qaBridge = isQaPreview
  ? createBridgeFake({
      platform: navigator.userAgent.includes('Mac') ? 'darwin' : 'win32',
      overrides: {
        getState: async () => ({
          ...qaScenes.stateFor(qaScenes.start()),
          completedOnboardingVersion:
            qaPreviewParams.get('state') === 'onboarding' ? 0 : CURRENT_ONBOARDING_VERSION,
        }),
        updateState: (patch, options) => {
          const status = qaPrompterLinkStatus(patch)
          const next = sanitizeSettings({ ...state, ...patch })
          qaScenes.commit(
            options?.demo
              ? { settings: next, activeSceneId: qaScenes.active }
              : sceneLibrary.followLiveLook(qaScenes.library(), next, { keys: Object.keys(patch) }),
          )
          if (status.prompterLinkStatus) applyState({ ...state, ...status })
        },
        savePreset: (name, id) => qaScenes.commit(sceneLibrary.saveScene(qaScenes.library(), { name, id })),
        applyPreset: (id) => qaScenes.commit(sceneLibrary.applyScene(qaScenes.library(), id, qaScenes.context)),
        renamePreset: (id, name) => {
          const renamed = sceneLibrary.renameScene(qaScenes.library(), id, name)
          if (!renamed?.error) qaScenes.commit(renamed)
        },
        deletePreset: (id) => qaScenes.commit(sceneLibrary.deleteScene(qaScenes.library(), id)),
        reorderPreset: (id, offset) => qaScenes.commit(sceneLibrary.reorderScene(qaScenes.library(), id, offset)),
        undoPresetChange: () =>
          qaScenes.commit(
            sceneLibrary.undoSceneChange(qaScenes.library(), qaScenes.edits.takeChange(qaScenes.active), qaScenes.context),
          ),
        undoPresetDelete: () =>
          qaScenes.commit(sceneLibrary.restoreScene(qaScenes.library(), qaScenes.edits.takeDelete(), qaScenes.context)),
        exportPresets: async () => ({ canceled: false, count: state.presets.length }),
        importPresets: async () =>
          qaPreviewParams.get('import') === 'bad'
            ? { canceled: false, error: sceneLibrary.SCENE_IMPORT_ERROR }
            : { canceled: false, count: 0 },
        setOverlayOnboardingOpen: (open) => (open ? ONBOARDING_TOP_RESERVE : 0),
        toggleFullscreen: () => qaBridge.emit('onFullscreenChanged', !interaction.fullscreen),
        exitFullscreen: () => qaBridge.emit('onFullscreenChanged', false),
      },
    })
  : undefined
const camFrame = window.camFrame ?? qaBridge.bridge
const interaction = createOverlayInteraction({
  onHoveredChange: (hovered) => {
    overlay.dataset.hovered = String(hovered)
  },
  onInteractiveChange: (interactive) => camFrame.setOverlayInteractive(interactive),
})

let state
let cameraReposition
let presentationToastTimer
let onboardingReturnFocus
let onboardingTarget
let onboardingTargetDescription
const onboardingDemoAnimations = new Set()

function clearOnboardingTarget() {
  if (!onboardingTarget) return
  delete onboardingTarget.dataset.onboardingTarget
  if (onboardingTargetDescription) {
    onboardingTarget.setAttribute('aria-describedby', onboardingTargetDescription)
  } else onboardingTarget.removeAttribute('aria-describedby')
  onboardingTarget = undefined
  onboardingTargetDescription = undefined
}

function trackOnboardingDemoAnimation(animation) {
  onboardingDemoAnimations.add(animation)
  animation.finished
    .catch(() => {})
    .finally(() => onboardingDemoAnimations.delete(animation))
  return animation
}

function showOnboardingDemoMouse(target, action, offset = { x: 0, y: 0 }) {
  const overlayBounds = overlay.getBoundingClientRect()
  const targetBounds = target.getBoundingClientRect()
  onboardingDemoMouse.style.left = `${Math.round(
    targetBounds.left - overlayBounds.left + targetBounds.width / 2 - 9 + offset.x,
  )}px`
  onboardingDemoMouse.style.top = `${Math.round(
    targetBounds.top - overlayBounds.top + targetBounds.height / 2 - 13 + offset.y,
  )}px`
  onboardingDemoMouse.hidden = false
  onboardingDemoMouse.dataset.action = action
}

function hideOnboardingDemoMouse() {
  onboardingDemoMouse.hidden = true
  onboardingDemoMouse.style.opacity = ''
  onboardingDemoMouse.style.transform = ''
  onboardingDemoMouse.removeAttribute('data-action')
}

const onboardingClickRipple = [
  { opacity: 0, transform: 'scale(0.45)' },
  { opacity: 0.9, transform: 'scale(0.65)', offset: 0.35 },
  { opacity: 0, transform: 'scale(1)' },
]

// The demo cursor's gestures. Timing of what each gesture does lives in the Onboarding tour.
const onboardingCursorGestures = {
  click() {
    showOnboardingDemoMouse(shapeButton, 'click')
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
      onboardingDemoClick.animate(onboardingClickRipple, { duration: 320, delay: 500, easing: 'ease-out' }),
    )
  },
  'double-click'() {
    showOnboardingDemoMouse(cameraSurface, 'double-click')
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
      onboardingDemoClick.animate(onboardingClickRipple, {
        duration: 260,
        delay: 470,
        iterations: 2,
        easing: 'ease-out',
      }),
    )
  },
  scroll() {
    showOnboardingDemoMouse(cameraSurface, 'scroll', { x: 42, y: 0 })
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
  },
  drag() {
    showOnboardingDemoMouse(cameraSurface, 'drag')
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
  },
}

function positionOnboardingCoachmark(reveal) {
  if (!onboardingTarget) return
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
    interaction.controlsOpen &&
    (reveal === 'camera-settings' || reveal === 'scene-settings')
  ) {
    inlineSettings.style.setProperty('--settings-top', `${Math.round(toolbarTop + 44 + gap)}px`)
  } else inlineSettings.style.removeProperty('--settings-top')
}

const onboardingView = {
  show(offset, invoker) {
    if (
      invoker instanceof HTMLElement &&
      invoker !== document.body &&
      !onboardingPanel.contains(invoker)
    ) {
      onboardingReturnFocus = invoker
    }
    overlay.style.setProperty('--onboarding-offset', `${offset}px`)
    overlay.dataset.onboarding = 'true'
    onboardingPanel.hidden = false
  },
  hide() {
    onboardingPanel.hidden = true
    overlay.dataset.onboarding = 'false'
    onboardingView.clearStep()
  },
  setLayoutOffset(offset) {
    if (offset) overlay.style.setProperty('--onboarding-offset', `${offset}px`)
    else overlay.style.removeProperty('--onboarding-offset')
  },
  restoreFocus() {
    const returnFocus = onboardingReturnFocus
    onboardingReturnFocus = undefined
    if (returnFocus?.isConnected) returnFocus.focus()
  },
  clearStep() {
    clearOnboardingTarget()
    inlineSettings.style.removeProperty('--settings-top')
  },
  renderStep(content, index, count) {
    onboardingProgressLabel.textContent = 'Getting started'
    onboardingProgressBar.setAttribute('aria-valuenow', String(index + 1))
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
    onboardingProgress.forEach((segment, segmentIndex) => {
      segment.dataset.current = String(segmentIndex <= index)
    })
    onboardingBack.hidden = index === 0
    onboardingNext.textContent = index === count - 1 ? 'Done' : 'Next'
    onboardingTarget = document.querySelector(content.target)
    if (onboardingTarget) {
      onboardingTarget.dataset.onboardingTarget = 'true'
      onboardingTargetDescription = onboardingTarget.getAttribute('aria-describedby')
      onboardingTarget.setAttribute(
        'aria-describedby',
        [onboardingTargetDescription, 'onboarding-description'].filter(Boolean).join(' '),
      )
    }
  },
  relayout: positionOnboardingCoachmark,
  focusTitle: () => onboardingTitle.focus(),
  setDemoMarker(marker) {
    overlay.dataset.onboardingDemo = marker
  },
  playCursor: (gesture) => onboardingCursorGestures[gesture](),
  hideCursor: hideOnboardingDemoMouse,
  endDemo() {
    overlay.removeAttribute('data-onboarding-demo')
    onboardingDemoAnimations.forEach((animation) => animation.cancel())
    onboardingDemoAnimations.clear()
    hideOnboardingDemoMouse()
  },
}

const tour = createOnboardingTour({
  steps: onboardingStepsFor(camFrame.platform),
  prefersReducedMotion: () => onboardingMotionQuery.matches,
  view: onboardingView,
  overlay: {
    state: () => state,
    showChrome: () => interaction.showChrome(),
    scheduleHideChrome: () => interaction.scheduleHide(),
    setTourOpen(open) {
      interaction.set({ onboardingOpen: open })
      return camFrame.setOverlayOnboardingOpen(open)
    },
    settingsOpen: () => interaction.controlsOpen,
    openSettings(panel) {
      selectSettingsPanel(panel)
      setControlsOpen(true)
    },
    selectSettingsPanel: (panel) => selectSettingsPanel(panel),
    closeSettings: () => setControlsOpen(false),
    isFraming: () => interaction.positioning,
    setFraming: (on) => setPositioning(on),
    cycleShape: (options) => cycleCameraShape(options),
    previewFraming(framing) {
      state = { ...state, ...framing }
      renderCameraFraming()
    },
    patchState: (patch, options) => camFrame.updateState(patch, options),
    surfaceSize: () => cameraSurface.getBoundingClientRect(),
    completeOnboarding() {
      state = { ...state, completedOnboardingVersion: CURRENT_ONBOARDING_VERSION }
      camFrame.completeOnboarding()
    },
  },
})

new ResizeObserver(() => tour.relayout()).observe(overlay)

function syncAccessibilityPreferences() {
  const preferences = {
    reducedMotion: onboardingMotionQuery.matches,
    highContrast: forcedColorsQuery.matches || increasedContrastQuery.matches,
  }
  overlay.dataset.reducedMotion = String(preferences.reducedMotion)
  overlay.dataset.highContrast = String(preferences.highContrast)
  tour.reducedMotionChanged(preferences.reducedMotion)
  camFrame.reportAccessibilityPreferences(preferences)
}

onboardingMotionQuery.addEventListener('change', syncAccessibilityPreferences)
forcedColorsQuery.addEventListener('change', syncAccessibilityPreferences)
increasedContrastQuery.addEventListener('change', syncAccessibilityPreferences)
syncAccessibilityPreferences()

// `options.demo`: an onboarding demo step, never saved into the active Scene (ADR 0037).
function cycleCameraShape(options) {
  const currentIndex = SHAPE_CYCLE.indexOf(state.shape)
  camFrame.updateState({ shape: SHAPE_CYCLE[(currentIndex + 1) % SHAPE_CYCLE.length] }, options)
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
  button.addEventListener('click', () => {
    if (button.dataset.settingsTab !== 'presets') scenesPanel.reset()
    selectSettingsPanel(button.dataset.settingsTab)
  })
})


function showCameraState(message) {
  cameraStateLabel.textContent = message
  cameraState.hidden = false
}

function hideCameraState() {
  cameraState.hidden = true
}

function renderDevices({ cameras, selectedDeviceId, error }) {
  cameraSelect.replaceChildren()
  if (error || !cameras.length) {
    cameraSelect.add(new Option(error ?? 'No cameras found', ''))
    cameraSelect.disabled = true
    return
  }

  cameraSelect.disabled = false
  for (const camera of cameras) cameraSelect.add(new Option(camera.label, camera.deviceId))
  if (selectedDeviceId) cameraSelect.value = selectedDeviceId
}

const cameraSession = createCameraSession({
  mediaDevices: isQaPreview ? undefined : navigator.mediaDevices,
  video,
  effectVideo,
  platform: camFrame.platform,
  onStatus: (message) => (message ? showCameraState(message) : hideCameraState()),
  onSettled: () => tour.cameraSettled(),
  onDevices: renderDevices,
  onSelectedCameraMissing: () => {
    camFrame.updateState({ cameraId: '', cameraLabel: DEFAULT_CAMERA_LABEL })
  },
})

function renderCameraFraming(framing = state) {
  const styles = cameraFramingStyles(framing)
  for (const camera of [video, effectVideo]) Object.assign(camera.style, styles)
  framingZoom.textContent = `${framing.cameraZoom}%`
}

// A Scene name or a Scenes tab change for screen readers only; nothing is drawn (ADR 0036). The
// region is emptied first so the same text twice in a row is read twice, and cleared once read.
function announce(text) {
  sceneAnnouncer.textContent = ''
  setTimeout(() => {
    sceneAnnouncer.textContent = String(text)
  }, 50)
  clearTimeout(sceneAnnouncerClear)
  sceneAnnouncerClear = setTimeout(() => {
    sceneAnnouncer.textContent = ''
  }, 5000)
}

const scenesPanel = createScenesPanel({
  root: scenesPanelRoot,
  camFrame,
  announce,
  closeSettings() {
    setControlsOpen(false)
    document.querySelector('#controls-button').focus()
  },
})

// The toolbar's Prompter link button and its screen reader description render from the stored
// `prompterLink` and main's link status.
function renderPrompterLink() {
  const link = prompterLinkView(state)
  if (prompterStatus.textContent !== link.status) prompterStatus.textContent = link.status
  prompterButton.classList.toggle('selected', link.on)
  prompterButton.setAttribute('aria-pressed', String(link.on))
  prompterButton.dataset.linkState = link.state
  prompterButton.title = link.title
}

function applyState(nextState) {
  state = nextState
  tour.stateChanged()
  const camera = dimensionsFor(state)
  const cameraWidthValue = `${camera.width}px`
  const cameraHeightValue = `${camera.height}px`
  overlay.dataset.shape = state.shape
  overlay.dataset.effect = state.frameEffect
  overlay.style.setProperty('--camera-width', cameraWidthValue)
  overlay.style.setProperty('--camera-height', cameraHeightValue)
  document.documentElement.style.setProperty('--camera-width', cameraWidthValue)
  document.documentElement.style.setProperty('--camera-height', cameraHeightValue)
  overlay.style.setProperty('--corner-scale-x', String(camera.width / camera.height))
  overlay.style.setProperty('--frame-width', `${state.borderWidth}px`)
  overlay.style.setProperty('--frame-color', state.borderColor)
  overlay.style.setProperty('--effect-color', state.effectColor)
  overlay.style.setProperty('--effect-glow-near', `${Math.max(1, Math.round(state.glowSpread * 0.4))}px`)
  overlay.style.setProperty('--effect-glow-far', `${state.glowSpread}px`)
  overlay.style.setProperty('--effect-glow-opacity', String(state.glowStrength / 100))
  overlay.style.setProperty('--effect-blur-radius', `${state.blurAmount}px`)
  overlay.style.setProperty('--effect-blur-opacity', String(state.blurOpacity / 100))
  renderCameraFraming()
  mirrorToggle.checked = state.mirror
  overlayResolutionSelect.value = state.overlayResolution
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
  scenesPanel.update(state)
  renderPrompterLink()
  if (state.cameraId && [...cameraSelect.options].some((option) => option.value === state.cameraId)) {
    cameraSelect.value = state.cameraId
  }
  cameraSession.update({
    cameraId: state.cameraId,
    resolution: state.overlayResolution,
    effect: state.frameEffect,
  })
}

function applyFullscreen(nextFullscreen) {
  const fullscreen = Boolean(nextFullscreen)
  interaction.set({ fullscreen })
  overlay.dataset.fullscreen = String(fullscreen)
  fullscreenButton.classList.toggle('selected', fullscreen)
  const label = fullscreen ? 'Exit full screen' : 'Enter full screen'
  fullscreenButton.setAttribute('aria-label', label)
  fullscreenButton.title = label
  if (fullscreen) {
    setControlsOpen(false)
    interaction.showChrome()
    interaction.scheduleHide()
  } else interaction.hideChrome()
}

function setControlsOpen(open) {
  if (!open) scenesPanel.reset()
  interaction.set({ controlsOpen: open })
  inlineSettings.hidden = !open
  document.querySelector('#controls-button').classList.toggle('selected', open)
  camFrame.setOverlaySettingsOpen(open)
  if (open) {
    interaction.showChrome()
    cameraSession.refreshDevices()
  }
}

function setPositioning(nextPositioning) {
  const positioning = Boolean(nextPositioning)
  interaction.set({ positioning })
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
    interaction.showChrome()
  } else {
    cameraReposition = undefined
    interaction.set({ repositioning: false })
    delete cameraSurface.dataset.repositioning
  }
}

document.addEventListener('mousemove', (event) => {
  interaction.pointerMoved({
    point: { x: event.clientX, y: event.clientY },
    toolbarRect: interaction.fullscreen ? hoverToolbar.getBoundingClientRect() : undefined,
    overSurface:
      event.target instanceof Element &&
      Boolean(
        event.target.closest('.camera-surface, .hover-toolbar, .inline-settings, .onboarding-coachmark'),
      ),
  })
})

document.addEventListener('mouseleave', () => interaction.pointerLeft())

cameraSurface.addEventListener('pointerenter', () => {
  tour.takeOver('framing')
})

cameraSurface.addEventListener('pointerdown', (event) => {
  if (event.button !== 0) return
  tour.takeOver('framing')
  if (interaction.positioning) {
    cameraReposition = {
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      startPosition: { ...state.cameraPosition },
      position: { ...state.cameraPosition },
    }
    interaction.set({ repositioning: true })
    cameraSurface.dataset.repositioning = 'true'
    cameraSurface.setPointerCapture(event.pointerId)
    event.preventDefault()
    return
  }
  if (interaction.fullscreen) return
  interaction.set({ dragging: true })
  cameraSurface.dataset.dragging = 'true'
  cameraSurface.setPointerCapture(event.pointerId)
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
  renderCameraFraming({ ...state, cameraPosition: cameraReposition.position })
})

function finishCameraReposition(event) {
  if (!cameraReposition || event.pointerId !== cameraReposition.pointerId) return
  const position = cameraReposition.position
  cameraReposition = undefined
  interaction.set({ repositioning: false })
  delete cameraSurface.dataset.repositioning
  state = { ...state, cameraPosition: position }
  camFrame.updateState({ cameraPosition: position })
}

function stopDragging() {
  if (!interaction.dragging) return
  interaction.set({ dragging: false })
  delete cameraSurface.dataset.dragging
  camFrame.stopOverlayDrag()
}

function handleWindowBlur() {
  stopDragging()
  if (!tour.isOpen) {
    if (interaction.controlsOpen) setControlsOpen(false)
    if (interaction.positioning) setPositioning(false)
    interaction.hideChrome()
  }
}

cameraSurface.addEventListener('pointerup', stopDragging)
cameraSurface.addEventListener('pointercancel', stopDragging)
cameraSurface.addEventListener('pointerup', finishCameraReposition)
cameraSurface.addEventListener('pointercancel', finishCameraReposition)
cameraSurface.addEventListener('dblclick', () => {
  tour.takeOver('framing')
  if (!interaction.positioning) return
  const framing = centeredFraming()
  state = { ...state, ...framing }
  renderCameraFraming()
  camFrame.updateState(framing)
})

cameraSurface.addEventListener(
  'wheel',
  (event) => {
    tour.takeOver('framing')
    if (!interaction.positioning) return
    event.preventDefault()
    const cameraZoom = cameraZoomAfterWheel(state.cameraZoom, event.deltaY)
    if (cameraZoom === state.cameraZoom) return
    state = { ...state, cameraZoom }
    renderCameraFraming()
    camFrame.updateState({ cameraZoom })
  },
  { passive: false },
)
window.addEventListener('blur', handleWindowBlur)
window.addEventListener('resize', () => requestAnimationFrame(() => tour.relayout()))

document.querySelector('#close-button').addEventListener('click', () => {
  setControlsOpen(false)
  camFrame.quit()
})

fullscreenButton.addEventListener('click', () => {
  tour.close()
  camFrame.toggleFullscreen()
})

shapeButton.addEventListener('pointerenter', () => {
  tour.takeOver('shape')
})

shapeButton.addEventListener('focus', () => {
  tour.takeOver('shape')
})

shapeButton.addEventListener('click', () => {
  tour.takeOver('shape')
  cycleCameraShape()
})

positionButton.addEventListener('pointerenter', () => {
  tour.takeOver('framing')
})

positionButton.addEventListener('focus', () => {
  tour.takeOver('framing')
})

positionButton.addEventListener('click', () => {
  tour.takeOver('framing')
  setPositioning(!interaction.positioning)
  tour.framingToggled()
})

document.querySelectorAll('[data-resize-handle]').forEach((handle) => {
  handle.addEventListener('pointerdown', (event) => {
    if (event.button !== 0 || interaction.fullscreen) return
    interaction.set({ resizing: true })
    overlay.dataset.resizing = 'true'
    handle.setPointerCapture(event.pointerId)
    camFrame.startOverlayResize(handle.dataset.resizeHandle)
    event.preventDefault()
    event.stopPropagation()
  })

  const stopResizing = () => {
    if (!interaction.resizing) return
    interaction.set({ resizing: false })
    delete overlay.dataset.resizing
    camFrame.stopOverlayResize()
    interaction.scheduleHide()
  }

  handle.addEventListener('pointerup', stopResizing)
  handle.addEventListener('pointercancel', stopResizing)
  window.addEventListener('blur', stopResizing)
})

document.querySelector('#controls-button').addEventListener('click', () => {
  setControlsOpen(!interaction.controlsOpen)
  tour.settingsToggled()
})

onboardingSkip.addEventListener('click', () => tour.close())
onboardingBack.addEventListener('click', () => tour.back())
onboardingNext.addEventListener('click', () => tour.next())

cameraSelect.addEventListener('change', () => {
  const option = cameraSelect.selectedOptions[0]
  camFrame.updateState({ cameraId: cameraSelect.value, cameraLabel: option.textContent })
})

overlayResolutionSelect.addEventListener('change', () => {
  camFrame.updateState({ overlayResolution: overlayResolutionSelect.value })
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

// The toolbar button turns the Prompter link on and off (the stored `prompterLink`).
prompterButton.addEventListener('click', () => {
  if (!state) return
  pendingPrompterLink = toggledPrompterLink(pendingPrompterLink, state.prompterLink)
  camFrame.updateState({ prompterLink: pendingPrompterLink })
})

camFrame.onShowControls(() => {
  tour.close({ complete: false })
  interaction.showChrome()
  setControlsOpen(true)
})

camFrame.onShowOnboarding(() => {
  tour.open({ invoker: document.activeElement })
})

camFrame.onStateChanged(applyState)
camFrame.onFullscreenChanged(applyFullscreen)
camFrame.getState().then((initialState) => {
  applyState(initialState)
  if (isQaPreview) {
    document.documentElement.classList.add('qa-preview')
    if (qaPreviewParams.get('state') === 'hover') interaction.showChrome()
    tour.relayout()
  } else cameraSession.refreshDevices()
})

const typingIn = (target) => target instanceof HTMLInputElement && target.type === 'text'

window.addEventListener('keydown', (event) => {
  if (tour.isOpen) {
    if (event.key !== 'Escape') return
    event.preventDefault()
    tour.escape()
    return
  }
  // Ctrl+Z on the Scenes tab undoes the last Scene delete, else the active Scene's changes.
  if (
    (event.ctrlKey || event.metaKey) &&
    event.key.toLowerCase() === 'z' &&
    interaction.controlsOpen &&
    inlineSettings.dataset.activePanel === 'presets' &&
    !typingIn(event.target) &&
    scenesPanel.undo()
  ) {
    event.preventDefault()
    return
  }
  if (event.key !== 'Escape') return
  // Escape with Inline settings open cancels a rename or save in progress, else closes the settings.
  if (interaction.controlsOpen && !interaction.fullscreen) {
    event.preventDefault()
    if (inlineSettings.contains(event.target)) scenesPanel.escape()
    else setControlsOpen(false)
    return
  }
  if (interaction.positioning && !interaction.fullscreen) {
    event.preventDefault()
    setPositioning(false)
    return
  }
  if (!interaction.fullscreen) return
  event.preventDefault()
  camFrame.exitFullscreen()
})

camFrame.onPresentationNotice(showPresentationNotice)
// A Scene applied or saved is read out to screen readers and never drawn.
camFrame.onSceneAnnouncement(announce)

if (!isQaPreview) navigator.mediaDevices.addEventListener('devicechange', cameraSession.refreshDevices)
window.addEventListener('beforeunload', () => {
  camFrame.stopOverlayDrag()
  cameraSession.stop()
})
