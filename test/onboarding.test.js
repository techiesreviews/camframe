import test from 'node:test'
import assert from 'node:assert/strict'
import { sanitizeSettings, settingsForPreset } from '../src/settings.js'
import {
  CURRENT_ONBOARDING_VERSION,
  ONBOARDING_DEMO_START_DELAY_MS,
  ONBOARDING_SETTINGS_REVEAL_DELAY_MS,
  ONBOARDING_STEP_COUNT,
  ONBOARDING_TOP_RESERVE,
  completedOnboardingVersionForLoad,
  createOnboardingTour,
  onboardingStepsFor,
  shouldShowOnboarding,
} from '../src/onboarding.js'

function fakeClock() {
  let now = 0
  let nextId = 1
  const timers = new Map()
  const frames = []
  const add = (callback, ms, repeat) => {
    const id = nextId++
    timers.set(id, { callback, due: now + ms, repeat: repeat ? ms : 0 })
    return id
  }
  return {
    timers: {
      setTimeout: (callback, ms) => add(callback, ms, false),
      clearTimeout: (id) => timers.delete(id),
      setInterval: (callback, ms) => add(callback, ms, true),
      clearInterval: (id) => timers.delete(id),
      now: () => now,
      nextFrame: (callback) => frames.push(callback),
    },
    advance(ms) {
      const end = now + ms
      for (;;) {
        frames.splice(0).forEach((callback) => callback())
        const [id, timer] = [...timers].sort((a, b) => a[1].due - b[1].due)[0] ?? []
        if (!timer || timer.due > end) break
        now = timer.due
        if (timer.repeat) timer.due += timer.repeat
        else timers.delete(id)
        timer.callback()
      }
      now = end
      frames.splice(0).forEach((callback) => callback())
    },
    pending: () => timers.size,
  }
}

const SHAPES = ['circle', 'rounded', 'portrait', 'landscape']

function tourHarness({ settings = {}, reducedMotion = false } = {}) {
  const clock = fakeClock()
  let state = { ...sanitizeSettings(settings) }
  const log = []
  const overlay = {
    chrome: false,
    tourOpen: false,
    settingsPanel: undefined,
    framing: false,
    patches: [],
    previews: [],
    completed: 0,
    hideScheduled: 0,
  }
  const view = {
    shown: false,
    offset: undefined,
    step: undefined,
    marker: undefined,
    cursor: undefined,
    gestures: [],
    focused: 0,
    restored: 0,
    relayouts: [],
  }
  const tour = createOnboardingTour({
    steps: onboardingStepsFor('win32'),
    timers: clock.timers,
    prefersReducedMotion: () => reducedMotion,
    overlay: {
      state: () => state,
      showChrome: () => {
        overlay.chrome = true
      },
      scheduleHideChrome: () => overlay.hideScheduled++,
      setTourOpen(open) {
        overlay.tourOpen = open
        log.push(`tour:${open}`)
        return open ? ONBOARDING_TOP_RESERVE : 0
      },
      settingsOpen: () => Boolean(overlay.settingsPanel),
      openSettings(panel) {
        overlay.settingsPanel = panel
        log.push(`settings:${panel}`)
      },
      selectSettingsPanel(panel) {
        overlay.settingsPanel = panel
      },
      closeSettings() {
        overlay.settingsPanel = undefined
        log.push('settings:closed')
      },
      isFraming: () => overlay.framing,
      setFraming(on) {
        overlay.framing = on
        log.push(`framing:${on}`)
      },
      cycleShape() {
        const shape = SHAPES[(SHAPES.indexOf(state.shape) + 1) % SHAPES.length]
        state = { ...state, shape }
        overlay.patches.push({ shape })
      },
      previewFraming(framing) {
        state = { ...state, ...framing }
        overlay.previews.push(framing)
      },
      patchState(patch) {
        state = { ...state, ...patch }
        overlay.patches.push(patch)
      },
      surfaceSize: () => ({ width: 288, height: 288 }),
      completeOnboarding() {
        state = { ...state, completedOnboardingVersion: CURRENT_ONBOARDING_VERSION }
        overlay.completed++
      },
    },
    view: {
      show(offset, invoker) {
        view.shown = true
        view.offset = offset
        view.invoker = invoker
      },
      hide() {
        view.shown = false
      },
      setLayoutOffset(offset) {
        view.offset = offset
      },
      restoreFocus: () => view.restored++,
      clearStep() {
        view.step = undefined
      },
      renderStep(content, index, count) {
        view.step = { title: content.title, index, count }
      },
      relayout: (reveal) => view.relayouts.push(reveal),
      focusTitle: () => view.focused++,
      setDemoMarker(marker) {
        view.marker = marker
      },
      playCursor(gesture) {
        view.cursor = gesture
        view.gestures.push(gesture)
      },
      hideCursor() {
        view.cursor = undefined
      },
      endDemo() {
        view.marker = undefined
        view.cursor = undefined
      },
    },
  })
  return {
    tour,
    clock,
    overlay,
    view,
    log,
    state: () => state,
    setState(patch) {
      state = { ...state, ...patch }
    },
    settle: (ms = ONBOARDING_DEMO_START_DELAY_MS + 1) => clock.advance(ms),
  }
}

test('new installations receive onboarding while existing preferences migrate quietly', () => {
  assert.equal(completedOnboardingVersionForLoad({}, false), 0)
  assert.equal(completedOnboardingVersionForLoad({ schemaVersion: 11 }, true), CURRENT_ONBOARDING_VERSION)
  assert.equal(completedOnboardingVersionForLoad({ completedOnboardingVersion: 0 }, true), 0)
  assert.equal(completedOnboardingVersionForLoad({ completedOnboardingVersion: 99 }, true), CURRENT_ONBOARDING_VERSION)
  assert.equal(shouldShowOnboarding(0), true)
  assert.equal(shouldShowOnboarding(CURRENT_ONBOARDING_VERSION), false)
})

test('coach marks target user-activated controls and explain saved Scenes', () => {
  const steps = onboardingStepsFor('win32')
  const copy = JSON.stringify(steps)

  assert.equal(steps.length, ONBOARDING_STEP_COUNT)
  assert.deepEqual(
    steps.map(({ target }) => target),
    ['#controls-button', '#shape-button', '#position-button', '#controls-button'],
  )
  assert.deepEqual(
    steps.map(({ reveal }) => reveal),
    ['camera-settings', 'shape-controls', 'framing', 'scene-settings'],
  )
  for (const phrase of [
    /Drag the picture/,
    /Watch the mouse pan and zoom/,
    /press Escape to exit/,
    /Settings allow you to choose your camera and camera quality/,
    /Hover it to stop/,
    /Each Scene remembers its camera, screen position, shape, framing, and style/,
  ]) {
    assert.match(copy, phrase)
  }
  assert.doesNotMatch(JSON.stringify(onboardingStepsFor('darwin')), /Windows Settings/)
})

test('onboarding completion is global and excluded from Scenes', () => {
  const settings = sanitizeSettings({ completedOnboardingVersion: CURRENT_ONBOARDING_VERSION })
  assert.equal(settings.completedOnboardingVersion, CURRENT_ONBOARDING_VERSION)
  assert.equal(Object.hasOwn(settingsForPreset(settings), 'completedOnboardingVersion'), false)
})

test('the tour is offered once, after the camera settles, only for an unseen version', () => {
  const unseen = tourHarness()
  unseen.tour.stateChanged()
  assert.equal(unseen.tour.isOpen, false)
  unseen.tour.cameraSettled()
  assert.equal(unseen.tour.isOpen, true)
  unseen.tour.close({ complete: false })
  unseen.tour.stateChanged()
  unseen.tour.cameraSettled()
  assert.equal(unseen.tour.isOpen, false)

  const seen = tourHarness({ settings: { completedOnboardingVersion: CURRENT_ONBOARDING_VERSION } })
  seen.tour.cameraSettled()
  assert.equal(seen.tour.isOpen, false)
})

test('opening reserves room above the toolbar and focuses the first step', () => {
  const { tour, overlay, view, clock } = tourHarness()
  tour.open({ invoker: 'help-button' })
  clock.advance(0)

  assert.equal(overlay.tourOpen, true)
  assert.equal(overlay.chrome, true)
  assert.equal(view.offset, ONBOARDING_TOP_RESERVE)
  assert.equal(view.invoker, 'help-button')
  assert.deepEqual(view.step, { title: 'Choose your camera', index: 0, count: ONBOARDING_STEP_COUNT })
  assert.equal(view.focused, 1)
})

test('settings steps open their panel only after the coach mark paints (ADR 0022)', () => {
  const { tour, overlay, clock } = tourHarness()
  tour.open()
  clock.advance(ONBOARDING_SETTINGS_REVEAL_DELAY_MS - 1)
  assert.equal(overlay.settingsPanel, undefined)
  clock.advance(1)
  assert.equal(overlay.settingsPanel, 'camera')

  tour.next()
  tour.next()
  tour.next()
  clock.advance(ONBOARDING_SETTINGS_REVEAL_DELAY_MS)
  assert.equal(overlay.settingsPanel, 'presets')
})

test('a delayed reveal is dropped when the user has already moved on', () => {
  const { tour, overlay, clock } = tourHarness()
  tour.open()
  tour.next()
  clock.advance(1000)
  assert.equal(overlay.settingsPanel, undefined)
})

test('the shape demo cycles three shapes, then waits for the user', () => {
  const { tour, view, state, settle, clock } = tourHarness()
  tour.open()
  tour.next()
  settle()
  assert.equal(tour.demo, 'shape')
  assert.equal(view.marker, 'shape')

  clock.advance(5000)
  assert.equal(state().shape, 'landscape')
  assert.equal(view.marker, 'shape-ready')
  assert.deepEqual(view.gestures, ['click', 'click', 'click'])
  assert.equal(view.cursor, undefined)
})

test('taking over the shape demo keeps the current shape', () => {
  const { tour, state, settle, clock, overlay } = tourHarness()
  tour.open()
  tour.next()
  settle()
  clock.advance(1000)
  tour.takeOver('framing')
  assert.equal(tour.demo, 'shape')
  tour.takeOver('shape')

  assert.equal(tour.demo, undefined)
  assert.equal(state().shape, 'rounded')
  const patches = overlay.patches.length
  clock.advance(5000)
  assert.equal(overlay.patches.length, patches)
})

test('Back during the shape demo restores the shape it started from', () => {
  const { tour, state, settle, clock, view } = tourHarness({ settings: { shape: 'portrait' } })
  tour.open()
  tour.next()
  settle()
  clock.advance(2000)
  assert.notEqual(state().shape, 'portrait')
  tour.back()

  assert.equal(state().shape, 'portrait')
  assert.equal(tour.step, 0)
  assert.equal(view.marker, undefined)
})

test('the framing demo pans, zooms, and resets while framing mode is on', () => {
  const { tour, overlay, state, settle, clock, view } = tourHarness()
  tour.open()
  tour.next()
  tour.next()
  settle()
  assert.equal(tour.demo, 'framing')
  assert.equal(overlay.framing, true)

  clock.advance(1500)
  assert.notDeepEqual(state().cameraPosition, { x: 50, y: 50 })
  clock.advance(1500)
  assert.ok(state().cameraZoom > 100)
  clock.advance(1400)
  assert.deepEqual([state().cameraPosition, state().cameraZoom], [{ x: 50, y: 50 }, 100])
  assert.deepEqual(view.gestures.slice(0, 3), ['drag', 'scroll', 'double-click'])
})

test('taking over the framing demo keeps the framing it changed', () => {
  const { tour, overlay, state, settle, clock } = tourHarness()
  tour.open()
  tour.next()
  tour.next()
  settle()
  clock.advance(700)
  const taken = { ...state().cameraPosition }
  tour.takeOver('framing')

  assert.equal(tour.demo, undefined)
  assert.deepEqual(overlay.patches.at(-1), { cameraPosition: taken, cameraZoom: 100 })
  assert.equal(overlay.framing, true)
})

test('Next restores framing from before the demo and leaves framing mode', () => {
  const { tour, overlay, state, settle, clock } = tourHarness({
    settings: { cameraPosition: { x: 30, y: 40 }, cameraZoom: 150 },
  })
  tour.open()
  tour.next()
  tour.next()
  settle()
  clock.advance(2500)
  tour.next()

  assert.deepEqual([state().cameraPosition, state().cameraZoom], [{ x: 30, y: 40 }, 150])
  assert.equal(overlay.framing, false)
  assert.equal(tour.step, 3)
})

test('Escape leaves framing first, then dismisses the tour (ADR 0021)', () => {
  const { tour, overlay, settle } = tourHarness()
  tour.open()
  tour.next()
  tour.next()
  settle()

  assert.equal(tour.escape(), true)
  assert.equal(overlay.framing, false)
  assert.equal(tour.isOpen, true)
  assert.equal(tour.escape(), true)
  assert.equal(tour.isOpen, false)
  assert.equal(tour.escape(), false)
})

test('reduced motion never starts a demo and stops a running one', () => {
  const reduced = tourHarness({ reducedMotion: true })
  reduced.tour.open()
  reduced.tour.next()
  reduced.settle()
  assert.equal(reduced.tour.demo, undefined)

  const live = tourHarness({ settings: { shape: 'portrait' } })
  live.tour.open()
  live.tour.next()
  live.settle()
  live.clock.advance(1000)
  live.tour.reducedMotionChanged(true)
  assert.equal(live.tour.demo, undefined)
  assert.equal(live.state().shape, 'portrait')
})

test('finishing the tour completes this version, releases the reserve, and returns focus', () => {
  const { tour, overlay, view, log, state } = tourHarness()
  tour.open()
  for (let step = 0; step < ONBOARDING_STEP_COUNT; step += 1) tour.next()

  assert.equal(tour.isOpen, false)
  assert.equal(overlay.completed, 1)
  assert.equal(state().completedOnboardingVersion, CURRENT_ONBOARDING_VERSION)
  assert.equal(overlay.tourOpen, false)
  assert.equal(view.shown, false)
  assert.equal(view.offset, 0)
  assert.equal(view.restored, 1)
  assert.equal(overlay.hideScheduled, 1)
  assert.equal(log.at(-1), 'tour:false')
})

test('dismissing for Open controls does not complete the tour', () => {
  const { tour, overlay, clock } = tourHarness()
  tour.open()
  clock.advance(ONBOARDING_SETTINGS_REVEAL_DELAY_MS)
  tour.close({ complete: false })

  assert.equal(overlay.completed, 0)
  assert.equal(overlay.settingsPanel, undefined)
})

test('closing during a demo restores it and stops every timer', () => {
  const { tour, state, settle, clock } = tourHarness()
  tour.open()
  tour.next()
  tour.next()
  settle()
  clock.advance(800)
  tour.close()
  clock.advance(10)

  assert.deepEqual(state().cameraPosition, { x: 50, y: 50 })
  assert.equal(clock.pending(), 0)
})

test('opening Settings during a settings step selects that step panel', () => {
  const { tour, overlay, clock, view } = tourHarness()
  tour.open()
  tour.next()
  tour.next()
  tour.next()
  clock.advance(ONBOARDING_SETTINGS_REVEAL_DELAY_MS)
  overlay.settingsPanel = 'appearance'
  tour.settingsToggled()
  assert.equal(overlay.settingsPanel, 'presets')
  assert.equal(view.relayouts.at(-1), 'scene-settings')
})

test('reopening from Help while open re-renders the current step', () => {
  const { tour, view } = tourHarness()
  tour.open({ invoker: 'first' })
  tour.next()
  tour.open({ invoker: 'second' })
  assert.equal(tour.step, 1)
  assert.equal(view.invoker, 'first')
})
