import { cameraPositionAfterDrag, centeredFraming } from './camera-framing.js'

export const CURRENT_ONBOARDING_VERSION = 1
export const ONBOARDING_STEP_COUNT = 4
export const ONBOARDING_TOP_RESERVE = 220
export const ONBOARDING_SETTINGS_REVEAL_DELAY_MS = 80
export const ONBOARDING_DEMO_START_DELAY_MS = 320
const ONBOARDING_SHAPE_DEMO_CLICKS = 3

const SHAPE_DEMO_ACTIVATE_MS = 560
const SHAPE_DEMO_CURSOR_MS = 920
const SHAPE_DEMO_NEXT_CLICK_MS = 1280
const SHAPE_DEMO_READY_MS = 980
const FRAMING_PAN_MS = 1400
const FRAMING_PAN_DISTANCE = Object.freeze({ x: 80, y: -38 })
const FRAMING_ZOOM_MS = 1000
const FRAMING_ZOOM_CHANGE = 30
const FRAMING_RESET_MS = 760
const FRAMING_RESET_DONE_MS = 1650
const FRAMING_PAN_TO_ZOOM_MS = 420
const FRAMING_ZOOM_TO_RESET_MS = 520
const DEMO_FRAME_MS = 16
const SETTINGS_PANEL_FOR_REVEAL = Object.freeze({
  'camera-settings': 'camera',
  'scene-settings': 'presets',
})

const clamp = (value, min, max) => Math.min(max, Math.max(min, value))

export function sanitizeCompletedOnboardingVersion(value) {
  if (!Number.isFinite(value)) return 0
  return Math.round(clamp(value, 0, CURRENT_ONBOARDING_VERSION))
}

export function completedOnboardingVersionForLoad(input = {}, hasPreferencesDocument = false) {
  if (Object.hasOwn(input, 'completedOnboardingVersion')) {
    return sanitizeCompletedOnboardingVersion(input.completedOnboardingVersion)
  }
  return hasPreferencesDocument ? CURRENT_ONBOARDING_VERSION : 0
}

export function shouldShowOnboarding(completedVersion) {
  return sanitizeCompletedOnboardingVersion(completedVersion) < CURRENT_ONBOARDING_VERSION
}

export function onboardingStepsFor() {
  return [
    {
      title: 'Choose your camera',
      description: 'Settings allow you to choose your camera and camera quality.',
      target: '#controls-button',
      reveal: 'camera-settings',
    },
    {
      title: 'Move, resize, and reshape',
      description:
        'Watch Shape cycle. Hover it to stop, then click to continue. Drag the picture to move it or a corner to resize.',
      target: '#shape-button',
      reveal: 'shape-controls',
    },
    {
      title: 'Frame the shot',
      description:
        'Watch the mouse pan and zoom. Move over the camera to take control. Double-click resets; click Crosshair or press Escape to exit.',
      target: '#position-button',
      reveal: 'framing',
    },
    {
      title: 'Save and switch Scenes',
      description:
        'Each Scene remembers its camera, screen position, shape, framing, and style. Use this panel to save or switch layouts.',
      target: '#controls-button',
      reveal: 'scene-settings',
    },
  ]
}

const systemTimers = {
  setTimeout: (callback, ms) => setTimeout(callback, ms),
  clearTimeout: (timer) => clearTimeout(timer),
  setInterval: (callback, ms) => setInterval(callback, ms),
  clearInterval: (timer) => clearInterval(timer),
  now: () => performance.now(),
  nextFrame: (callback) => requestAnimationFrame(callback),
}

// The Onboarding tour: which step shows, when its Inline settings panel opens, the live shape and
// framing demos, handing a demo over to the user, and completing or dismissing the tour.
// ADRs 0012 and 0016-0023 are its specification.
//
// It drives the Overlay only through `overlay`:
//   state(), showChrome(), scheduleHideChrome(), setTourOpen(open) -> top reserve in px,
//   settingsOpen(), openSettings(panel), selectSettingsPanel(panel), closeSettings(),
//   isFraming(), setFraming(on), cycleShape(), previewFraming(framing), patchState(patch),
//   surfaceSize(), completeOnboarding()
// and draws only through `view`:
//   show(offset, invoker), hide(), setLayoutOffset(px), restoreFocus(), clearStep(),
//   renderStep(content, index, count), relayout(reveal), focusTitle(),
//   setDemoMarker(marker), playCursor(gesture), hideCursor(), endDemo()
export function createOnboardingTour({
  overlay,
  view,
  steps = onboardingStepsFor(),
  timers = systemTimers,
  prefersReducedMotion = () => false,
}) {
  let open = false
  let step = 0
  let reveal
  let cameraKnown = false
  let autoOffered = false
  let demo

  function relayout() {
    if (open) view.relayout(reveal)
  }

  function relayoutNow() {
    relayout()
    timers.nextFrame(relayout)
  }

  function beginDemo(type, snapshot) {
    demo = { type, snapshot, framingChanged: false, timeouts: new Set(), intervals: new Set() }
    view.setDemoMarker(type)
    return demo
  }

  function later(current, callback, ms) {
    const timeout = timers.setTimeout(() => {
      current.timeouts.delete(timeout)
      if (demo === current) callback()
    }, ms)
    current.timeouts.add(timeout)
  }

  function animate(current, duration, frame, done) {
    const startedAt = timers.now()
    const interval = timers.setInterval(() => {
      if (demo !== current) {
        timers.clearInterval(interval)
        current.intervals.delete(interval)
        return
      }
      const progress = Math.min(1, (timers.now() - startedAt) / duration)
      frame(progress * (2 - progress))
      if (progress < 1) return
      timers.clearInterval(interval)
      current.intervals.delete(interval)
      done()
    }, DEMO_FRAME_MS)
    current.intervals.add(interval)
  }

  // `restore` returns the Overlay to its pre-demo state. Otherwise a handed-over framing demo
  // keeps (`commit`) the framing the user took over.
  function stopDemo({ commit = true, restore = false } = {}) {
    const stopped = demo
    demo = undefined
    stopped?.timeouts.forEach((timeout) => timers.clearTimeout(timeout))
    stopped?.intervals.forEach((interval) => timers.clearInterval(interval))
    view.endDemo()
    if (!stopped) return

    if (restore && stopped.type === 'shape') {
      overlay.patchState({ shape: stopped.snapshot.shape })
    } else if (restore && stopped.type === 'framing') {
      const framing = {
        cameraPosition: { ...stopped.snapshot.cameraPosition },
        cameraZoom: stopped.snapshot.cameraZoom,
      }
      overlay.previewFraming(framing)
      overlay.patchState(framing)
    } else if (commit && stopped.type === 'framing' && stopped.framingChanged) {
      const { cameraPosition, cameraZoom } = overlay.state()
      overlay.patchState({ cameraPosition: { ...cameraPosition }, cameraZoom })
    }
  }

  function startShapeDemo() {
    stopDemo({ restore: true })
    const current = beginDemo('shape', { shape: overlay.state().shape })
    let clicks = 0
    const playNextClick = () => {
      view.playCursor('click')
      later(current, () => overlay.cycleShape(), SHAPE_DEMO_ACTIVATE_MS)
      later(current, () => view.hideCursor(), SHAPE_DEMO_CURSOR_MS)
      clicks += 1
      if (clicks < ONBOARDING_SHAPE_DEMO_CLICKS) {
        later(current, playNextClick, SHAPE_DEMO_NEXT_CLICK_MS)
      } else {
        later(
          current,
          () => {
            view.hideCursor()
            view.setDemoMarker('shape-ready')
          },
          SHAPE_DEMO_READY_MS,
        )
      }
    }
    playNextClick()
  }

  function previewDemoFraming(current, framing) {
    current.framingChanged = true
    overlay.previewFraming(framing)
  }

  function playFramingPan(current) {
    view.playCursor('drag')
    const start = { ...overlay.state().cameraPosition }
    const surface = overlay.surfaceSize()
    let cameraPosition = start
    animate(
      current,
      FRAMING_PAN_MS,
      (eased) => {
        const { mirror, cameraZoom } = overlay.state()
        const delta = { x: FRAMING_PAN_DISTANCE.x * eased, y: FRAMING_PAN_DISTANCE.y * eased }
        cameraPosition = cameraPositionAfterDrag(start, delta, surface, mirror, cameraZoom)
        previewDemoFraming(current, { cameraPosition, cameraZoom })
      },
      () => {
        overlay.patchState({ cameraPosition })
        later(current, () => playFramingZoom(current), FRAMING_PAN_TO_ZOOM_MS)
      },
    )
  }

  function playFramingZoom(current) {
    view.playCursor('scroll')
    const startZoom = overlay.state().cameraZoom
    const targetZoom =
      startZoom >= 220
        ? Math.max(100, startZoom - FRAMING_ZOOM_CHANGE)
        : Math.min(250, startZoom + FRAMING_ZOOM_CHANGE)
    let cameraZoom = startZoom
    animate(
      current,
      FRAMING_ZOOM_MS,
      (eased) => {
        cameraZoom = Math.round(startZoom + (targetZoom - startZoom) * eased)
        previewDemoFraming(current, { cameraPosition: { ...overlay.state().cameraPosition }, cameraZoom })
      },
      () => {
        overlay.patchState({ cameraZoom })
        later(current, () => playFramingReset(current), FRAMING_ZOOM_TO_RESET_MS)
      },
    )
  }

  function playFramingReset(current) {
    view.playCursor('double-click')
    later(
      current,
      () => {
        previewDemoFraming(current, centeredFraming())
        overlay.patchState(centeredFraming())
      },
      FRAMING_RESET_MS,
    )
    later(
      current,
      () => {
        view.hideCursor()
        playFramingPan(current)
      },
      FRAMING_RESET_DONE_MS,
    )
  }

  function startFramingDemo() {
    stopDemo({ restore: true })
    const { cameraPosition, cameraZoom } = overlay.state()
    const current = beginDemo('framing', { cameraPosition: { ...cameraPosition }, cameraZoom })
    overlay.setFraming(true)
    relayout()
    playFramingPan(current)
  }

  const stillShowing = (content, renderedStep) =>
    open && step === renderedStep && reveal === content.reveal

  function revealSettings(content, renderedStep) {
    const panel = SETTINGS_PANEL_FOR_REVEAL[content.reveal]
    if (!stillShowing(content, renderedStep) || !panel) return
    overlay.openSettings(panel)
    relayoutNow()
  }

  function startDemonstration(content, renderedStep) {
    if (!stillShowing(content, renderedStep) || prefersReducedMotion()) return
    if (content.reveal === 'shape-controls') startShapeDemo()
    if (content.reveal === 'framing') startFramingDemo()
  }

  function renderStep({ focus = true } = {}) {
    const content = steps[step]
    const renderedStep = step
    view.clearStep()
    reveal = content.reveal
    overlay.showChrome()
    view.renderStep(content, step, steps.length)
    relayout()
    timers.setTimeout(() => revealSettings(content, renderedStep), ONBOARDING_SETTINGS_REVEAL_DELAY_MS)
    timers.setTimeout(() => startDemonstration(content, renderedStep), ONBOARDING_DEMO_START_DELAY_MS)
    timers.nextFrame(() => {
      if (!open || step !== renderedStep) return
      relayout()
      if (focus) view.focusTitle()
    })
  }

  // Back and Next restore any running demo and close what the previous step opened.
  function resetStep() {
    stopDemo({ restore: true })
    if (overlay.isFraming()) overlay.setFraming(false)
    if (overlay.settingsOpen()) overlay.closeSettings()
  }

  function goTo(nextStep) {
    resetStep()
    step = clamp(nextStep, 0, steps.length - 1)
    renderStep()
  }

  function show({ invoker } = {}) {
    if (open) {
      renderStep()
      return
    }
    open = true
    step = 0
    const offset = Math.max(0, Number(overlay.setTourOpen(true)) || 0)
    view.show(offset, invoker)
    overlay.showChrome()
    renderStep()
  }

  function close({ complete = true } = {}) {
    if (!open) return
    open = false
    view.hide()
    reveal = undefined
    stopDemo({ restore: true })
    if (overlay.isFraming()) overlay.setFraming(false)
    if (overlay.settingsOpen()) overlay.closeSettings()
    overlay.setTourOpen(false)
    view.setLayoutOffset(0)
    if (complete && shouldShowOnboarding(overlay.state()?.completedOnboardingVersion)) {
      overlay.completeOnboarding()
    }
    view.restoreFocus()
    overlay.scheduleHideChrome()
  }

  function offerOnce() {
    const state = overlay.state()
    if (!state || !cameraKnown || autoOffered) return
    autoOffered = true
    if (shouldShowOnboarding(state.completedOnboardingVersion)) show()
  }

  return {
    get isOpen() {
      return open
    },
    get step() {
      return step
    },
    get demo() {
      return demo?.type
    },

    open: show,
    close,
    next() {
      if (step === steps.length - 1) close()
      else goTo(step + 1)
    },
    back: () => goTo(step - 1),

    // Escape leaves framing first, then dismisses the tour (ADR 0021). Returns whether it acted.
    escape() {
      if (!open) return false
      if (overlay.isFraming()) {
        overlay.setFraming(false)
        relayout()
        return true
      }
      close()
      return true
    },

    // The first time the camera works or fails, offer the tour if this version is unseen.
    cameraSettled() {
      cameraKnown = true
      offerOnce()
    },
    stateChanged: offerOnce,

    // The user reached for the control a demo is showing. The shape demo keeps the current shape;
    // the framing demo keeps any framing it already changed.
    takeOver(type) {
      if (demo?.type !== type) return
      stopDemo(type === 'shape' ? { commit: false } : {})
    },
    reducedMotionChanged(reduced) {
      if (reduced && demo) stopDemo({ commit: false, restore: true })
    },
    settingsToggled() {
      if (!open) return
      const panel = SETTINGS_PANEL_FOR_REVEAL[reveal]
      if (overlay.settingsOpen() && panel) overlay.selectSettingsPanel(panel)
      relayoutNow()
    },
    framingToggled() {
      if (open) relayoutNow()
    },
    relayout,
  }
}
