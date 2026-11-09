import test from 'node:test'
import assert from 'node:assert/strict'
import { ONBOARDING_TOP_RESERVE } from '../src/onboarding.js'
import {
  COMPACT_SPOTS,
  DEFAULT_SETTINGS,
  OVERLAY_CHROME,
  overlayDimensionsFor,
  sanitizeSettings,
  settingsAfterHandResize,
} from '../src/settings.js'
import {
  OVERLAY_BOUNDS_TRANSITION_MS,
  alwaysOnTopLevelFor,
  cameraRectFor,
  compactBaseBounds,
  compactPositionAt,
  createOverlayGeometry,
  isFullscreenExitInput,
  isOnScreen,
  keepOnWorkArea,
  onScreenBase,
  visibleShare,
} from '../src/overlay-geometry.js'

const DISPLAY = { x: 0, y: 0, width: 1920, height: 1080 }
const WORK_AREA = { x: 0, y: 0, width: 1920, height: 1040 }

function fakeClock() {
  let now = 0
  let nextId = 1
  const intervals = new Map()
  return {
    timers: {
      now: () => now,
      setInterval(callback, ms) {
        const id = nextId++
        intervals.set(id, { callback, ms, due: now + ms })
        return id
      },
      clearInterval: (id) => intervals.delete(id),
    },
    advance(ms) {
      const end = now + ms
      for (;;) {
        const due = [...intervals.entries()].sort((a, b) => a[1].due - b[1].due)[0]
        if (!due || due[1].due > end) break
        now = due[1].due
        due[1].due += due[1].ms
        due[1].callback()
      }
      now = end
    },
    activeTimers: () => intervals.size,
  }
}

function fakeWindow(bounds) {
  const window = {
    bounds: { ...bounds },
    visible: false,
    ignoringMouse: undefined,
    alwaysOnTop: undefined,
    destroyed: false,
    calls: [],
    isDestroyed: () => window.destroyed,
    getBounds: () => ({ ...window.bounds }),
    setBounds(next) {
      window.bounds = { ...window.bounds, ...next }
    },
    getPosition: () => [window.bounds.x, window.bounds.y],
    setPosition(x, y) {
      window.bounds = { ...window.bounds, x, y }
    },
    setAlwaysOnTop(flag, level) {
      window.alwaysOnTop = { flag, level }
    },
    moveTop: () => window.calls.push('moveTop'),
    show: () => {
      window.visible = true
    },
    showInactive: () => {
      window.visible = true
    },
    hide: () => {
      window.visible = false
    },
    focus: () => window.calls.push('focus'),
    setIgnoreMouseEvents(ignore, options) {
      window.ignoringMouse = ignore
      window.calls.push(`ignore:${ignore}:${options.forward}`)
    },
  }
  return window
}

function overlay({ settings: initial = {}, reducedMotion = false } = {}) {
  let settings = sanitizeSettings({ position: { x: 400, y: 500 }, ...initial })
  const clock = fakeClock()
  const window = fakeWindow(compactBaseBounds({ settings, workArea: WORK_AREA, keepCenter: false }))
  const screen = {
    cursor: { x: 0, y: 0 },
    getCursorScreenPoint: () => ({ ...screen.cursor }),
    getPrimaryDisplay: () => ({ workArea: WORK_AREA }),
    getDisplayMatching: () => ({ bounds: DISPLAY }),
  }
  const events = { fullscreen: [], positions: [], resizes: [], dragEnds: [] }
  const geometry = createOverlayGeometry({
    window,
    screen,
    settings: () => settings,
    alwaysOnTopLevel: 'floating',
    timers: clock.timers,
    onResize(patch) {
      events.resizes.push({ size: patch.size })
      settings = sanitizeSettings({ ...settings, ...patch })
      geometry.apply({ keepCenter: false })
    },
    onCompactPositionChanged(position) {
      settings = { ...settings, position }
      events.positions.push(position)
    },
    onFullscreenChanged: (fullscreen) => events.fullscreen.push(fullscreen),
    onDragEnd: (position) => events.dragEnds.push(position),
  })
  geometry.setReducedMotion(reducedMotion)
  return {
    geometry,
    window,
    screen,
    clock,
    events,
    settings: () => settings,
    patch(patch) {
      settings = sanitizeSettings({ ...settings, ...patch })
    },
    settle: () => clock.advance(OVERLAY_BOUNDS_TRANSITION_MS + 32),
  }
}

const compact = (settings, position = settings.position) => ({ ...position, ...overlayDimensionsFor(settings) })

test('the Overlay starts click-through, topmost at the platform level, at its saved position', () => {
  const { window, settings } = overlay()

  assert.equal(window.ignoringMouse, true)
  assert.deepEqual(window.alwaysOnTop, { flag: true, level: 'floating' })
  assert.deepEqual(window.bounds, compact(settings()))
  assert.equal(alwaysOnTopLevelFor('win32'), 'screen-saver')
  assert.equal(alwaysOnTopLevelFor('darwin'), 'floating')
})

test('a first launch sits near the bottom-right of the primary work area', () => {
  const settings = { ...DEFAULT_SETTINGS }
  const size = overlayDimensionsFor(settings)
  assert.deepEqual(compactBaseBounds({ settings, workArea: WORK_AREA, keepCenter: false }), {
    ...size,
    x: WORK_AREA.width - size.width - 36,
    y: WORK_AREA.height - size.height - 36,
  })
})

test('size changes keep the Overlay centered unless asked to anchor its position', () => {
  const { geometry, window, patch, settings } = overlay({ settings: { size: 300 } })
  const before = window.getBounds()
  patch({ size: 400 })
  geometry.apply()

  assert.equal(window.bounds.width, before.width + 100)
  assert.equal(window.bounds.x, before.x - 50)
  assert.equal(window.bounds.y, before.y - 50)

  geometry.apply({ keepCenter: false })
  assert.deepEqual(window.bounds, compact(settings()))
})

test('hiding the Overlay stops dragging and makes it click-through', () => {
  const { geometry, window, patch, clock, screen } = overlay()
  geometry.startDrag()
  assert.equal(window.ignoringMouse, false)
  patch({ overlayVisible: false })
  geometry.apply({ updateBounds: false })

  assert.equal(window.visible, false)
  assert.equal(window.ignoringMouse, true)
  const before = window.getBounds()
  screen.cursor = { x: 300, y: 300 }
  clock.advance(100)
  assert.deepEqual(window.bounds, before)
})

test('a cue sent during a move-drag ends the drag and keeps its own place', () => {
  const { geometry, window, patch, screen, clock, settings, events, settle } = overlay()
  geometry.startDrag()
  screen.cursor = { x: 300, y: 300 }
  clock.advance(32)
  patch({ position: { x: 1500, y: 700 } })
  geometry.showCompact()
  settle()
  assert.deepEqual(window.bounds, compact(settings(), { x: 1500, y: 700 }))

  // The pointer keeps moving, but the drag is over: the camera stays at the cue's place.
  screen.cursor = { x: 900, y: 900 }
  clock.advance(100)
  assert.deepEqual(window.bounds, compact(settings(), { x: 1500, y: 700 }))
  assert.equal(clock.activeTimers(), 0)
  assert.deepEqual(events.positions, [])
})

test('Full screen animates to the display and back to the compact position', () => {
  const { geometry, window, clock, events, settings, settle } = overlay()
  const compactBounds = window.getBounds()

  geometry.setFullscreen(true)
  assert.equal(geometry.isFullscreen(), true)
  assert.deepEqual(events.fullscreen, [true])
  assert.equal(window.ignoringMouse, false)
  assert.deepEqual(window.alwaysOnTop, { flag: true, level: 'floating' })
  clock.advance(OVERLAY_BOUNDS_TRANSITION_MS / 2)
  assert.ok(window.bounds.width > compactBounds.width && window.bounds.width < DISPLAY.width)
  settle()
  assert.deepEqual(window.bounds, DISPLAY)

  geometry.setFullscreen(false)
  assert.deepEqual(events.fullscreen, [true, false])
  settle()
  assert.deepEqual(window.bounds, compact(settings()))
  assert.equal(clock.activeTimers(), 0)
})

test('leaving Full screen restores the user Always on top preference after the animation', () => {
  const { geometry, window, settle } = overlay({ settings: { alwaysOnTop: false } })
  geometry.setFullscreen(true)
  settle()
  geometry.setFullscreen(false)
  assert.equal(window.alwaysOnTop.flag, true)
  settle()
  assert.equal(window.alwaysOnTop.flag, false)
})

test('reduced motion jumps straight to final bounds and finishes a running animation', () => {
  const reduced = overlay({ reducedMotion: true })
  reduced.geometry.setFullscreen(true)
  assert.deepEqual(reduced.window.bounds, DISPLAY)
  assert.equal(reduced.clock.activeTimers(), 0)

  const animated = overlay()
  animated.geometry.setFullscreen(true)
  animated.clock.advance(50)
  animated.geometry.setReducedMotion(true)
  assert.deepEqual(animated.window.bounds, DISPLAY)
  assert.equal(animated.clock.activeTimers(), 0)
})

test('the onboarding reserve grows the window upward without moving the camera', () => {
  const { geometry, window, settings } = overlay()
  const base = window.getBounds()

  assert.equal(geometry.setOnboardingReserve(true), ONBOARDING_TOP_RESERVE)
  assert.deepEqual(window.bounds, {
    ...base,
    y: base.y - ONBOARDING_TOP_RESERVE,
    height: base.height + ONBOARDING_TOP_RESERVE,
  })
  assert.deepEqual(geometry.compactBounds(), base)
  assert.equal(geometry.setOnboardingReserve(true), ONBOARDING_TOP_RESERVE)

  assert.equal(geometry.setOnboardingReserve(false), 0)
  assert.deepEqual(window.bounds, base)
  assert.deepEqual(settings().position, { x: base.x, y: base.y })
})

test('moving the Overlay records its compact position, including during onboarding', () => {
  const { geometry, window, events } = overlay()
  geometry.setOnboardingReserve(true)
  window.setPosition(100, 50)
  geometry.windowMoved()

  assert.deepEqual(events.positions.at(-1), { x: 100, y: 50 + ONBOARDING_TOP_RESERVE })
})

test('Full screen and its animation never record a compact position', () => {
  const { geometry, events, settle } = overlay()
  geometry.setFullscreen(true)
  geometry.windowMoved()
  settle()
  geometry.windowMoved()
  assert.deepEqual(events.positions, [])
})

test('the onboarding reserve cannot open in Full screen', () => {
  const { geometry, window, settle } = overlay()
  geometry.setFullscreen(true)
  settle()
  assert.equal(geometry.setOnboardingReserve(true), 0)
  assert.deepEqual(window.bounds, DISPLAY)
})

test('closing onboarding in Full screen still restores the real compact position (regression)', () => {
  const { geometry, window, settings, settle } = overlay()
  const base = window.getBounds()

  geometry.setOnboardingReserve(true)
  geometry.setFullscreen(true)
  settle()
  assert.equal(geometry.setOnboardingReserve(false), 0)
  geometry.setFullscreen(false)
  settle()

  assert.deepEqual(window.bounds, base)
  assert.deepEqual(settings().position, { x: base.x, y: base.y })
  window.setPosition(10, 20)
  geometry.windowMoved()
  assert.deepEqual(settings().position, { x: 10, y: 20 })
  assert.equal(geometry.setOnboardingReserve(true), ONBOARDING_TOP_RESERVE)
})

test('onboarding left open through Full screen returns with its reserve intact', () => {
  const { geometry, window, settle } = overlay()
  geometry.setOnboardingReserve(true)
  const withReserve = window.getBounds()

  geometry.setFullscreen(true)
  settle()
  geometry.setFullscreen(false)
  settle()

  assert.deepEqual(window.bounds, withReserve)
  assert.equal(geometry.setOnboardingReserve(false), 0)
  assert.equal(window.bounds.y, withReserve.y + ONBOARDING_TOP_RESERVE)
})

test('closing onboarding during a bounds animation lands on the compact position', () => {
  const { geometry, window, clock } = overlay()
  const base = window.getBounds()
  geometry.setOnboardingReserve(true)
  geometry.setFullscreen(true)
  clock.advance(OVERLAY_BOUNDS_TRANSITION_MS + 32)
  geometry.setFullscreen(false)
  clock.advance(40)

  geometry.setOnboardingReserve(false)
  assert.deepEqual(window.bounds, base)
  assert.equal(clock.activeTimers(), 0)
})

test('Scenes animate a visible compact Overlay to their saved geometry', () => {
  const { geometry, window, patch, settings, clock, settle } = overlay()
  patch({ size: 420, shape: 'landscape', position: { x: 50, y: 60 } })
  geometry.showScene()
  clock.advance(OVERLAY_BOUNDS_TRANSITION_MS / 2)
  assert.notDeepEqual(window.bounds, compact(settings()))
  settle()
  assert.deepEqual(window.bounds, compact(settings()))
})

test('Scenes applied in Full screen keep the display bounds', () => {
  const { geometry, window, patch, settle } = overlay()
  geometry.setFullscreen(true)
  settle()
  patch({ size: 420 })
  geometry.showScene()
  assert.deepEqual(window.bounds, DISPLAY)
})

test('dragging follows the cursor until stopped', () => {
  const { geometry, window, screen, clock } = overlay()
  screen.cursor = { x: 410, y: 520 }
  geometry.startDrag()
  screen.cursor = { x: 510, y: 470 }
  clock.advance(16)
  assert.deepEqual([window.bounds.x, window.bounds.y], [500, 450])
  geometry.stopDrag()
  screen.cursor = { x: 900, y: 900 }
  clock.advance(100)
  assert.deepEqual([window.bounds.x, window.bounds.y], [500, 450])
})

test('corner resizing anchors the opposite corner and reports the new size', () => {
  const { geometry, window, screen, clock, settings } = overlay({ settings: { size: 300 } })
  const start = window.getBounds()
  geometry.startResize('top-left')
  screen.cursor = { x: -80, y: -40 }
  clock.advance(16)
  geometry.stopResize()

  assert.equal(settings().size, 380)
  assert.equal(window.bounds.x + window.bounds.width, start.x + start.width)
  assert.equal(window.bounds.y + window.bounds.height, start.y + start.height)
  assert.equal(clock.activeTimers(), 0)
})

test('resizing a wide Overlay follows the dominant axis and keeps its aspect ratio', () => {
  const { geometry, screen, clock, settings } = overlay({ settings: { size: 320, shape: 'landscape' } })
  geometry.startResize('bottom-right')
  screen.cursor = { x: 64, y: 36 }
  clock.advance(16)
  geometry.stopResize()

  assert.equal(settings().size, 384)
  assert.deepEqual(settings().position, { x: 400, y: 500 })
  assert.deepEqual(overlayDimensionsFor(settings()), { width: 384 + 36, height: 216 + 102 })
})

test('resizing clamps the camera size', () => {
  const { geometry, screen, clock, settings } = overlay({ settings: { size: 300 } })
  geometry.startResize('bottom-right')
  screen.cursor = { x: 5000, y: 0 }
  clock.advance(16)
  assert.equal(settings().size, 640)
  screen.cursor = { x: -5000, y: 0 }
  clock.advance(16)
  assert.equal(settings().size, 180)
})

test('resizing keeps the onboarding reserve out of the saved position', () => {
  const { geometry, screen, clock, settings } = overlay({ settings: { size: 300 } })
  geometry.setOnboardingReserve(true)
  geometry.startResize('bottom-right')
  screen.cursor = { x: 40, y: 40 }
  clock.advance(16)
  geometry.stopResize()

  assert.deepEqual(settings().position, { x: 400, y: 500 })
})

test('dragging, resizing, and unknown handles are ignored in Full screen', () => {
  const { geometry, clock, settle } = overlay()
  geometry.setFullscreen(true)
  settle()
  geometry.startDrag()
  geometry.startResize('top-left')
  geometry.startResize('middle')
  assert.equal(clock.activeTimers(), 0)
})

test('mouse pass-through only changes when interactivity changes', () => {
  const { geometry, window } = overlay()
  window.calls.length = 0
  geometry.setInteractive(true)
  geometry.setInteractive(true)
  geometry.setInteractive(false)
  assert.deepEqual(window.calls, ['ignore:false:false', 'ignore:true:true'])
})

test('Escape key-down is the only Full screen exit input', () => {
  assert.equal(isFullscreenExitInput({ type: 'keyDown', key: 'Escape' }), true)
  assert.equal(isFullscreenExitInput({ type: 'keyUp', key: 'Escape' }), false)
  assert.equal(isFullscreenExitInput({ type: 'keyDown', key: 'Enter' }), false)
})

test('a destroyed window ignores every intent', () => {
  const { geometry, window } = overlay()
  window.destroyed = true
  geometry.setFullscreen(true)
  geometry.startDrag()
  assert.equal(geometry.isFullscreen(), false)
  assert.equal(geometry.setOnboardingReserve(true), 0)
  assert.equal(geometry.compactBounds(), undefined)
})

test('Prompter link spots put the camera surface a margin from the work area edges', () => {
  const settings = sanitizeSettings({ size: 300 })
  const size = overlayDimensionsFor(settings)
  const margin = 40
  const camera = (spot, workArea) => {
    const { x, y } = compactPositionAt(spot, { workArea, size, margin })
    return { left: x + OVERLAY_CHROME.left, top: y + OVERLAY_CHROME.top, right: x + size.width - OVERLAY_CHROME.right, bottom: y + size.height - OVERLAY_CHROME.bottom, window: { x, y } }
  }

  const bottomRight = camera('bottom-right', WORK_AREA)
  assert.equal(bottomRight.right, WORK_AREA.width - margin)
  assert.equal(bottomRight.bottom, WORK_AREA.height - margin)
  const bottomLeft = camera('bottom-left', WORK_AREA)
  assert.equal(bottomLeft.left, margin)
  assert.equal(bottomLeft.bottom, WORK_AREA.height - margin)
  const left = camera('left', WORK_AREA)
  assert.equal(left.left, margin)
  assert.equal(left.top + 150, WORK_AREA.height / 2)
  const right = camera('right', WORK_AREA)
  assert.equal(right.right, WORK_AREA.width - margin)
  const center = camera('center', WORK_AREA)
  assert.equal(center.left + 150, WORK_AREA.width / 2)
  assert.equal(center.top + 150, WORK_AREA.height / 2)

  // The hover toolbar above the camera stays on screen: a top spot never puts the window above the work area.
  const topLeft = camera('top-left', WORK_AREA)
  assert.equal(topLeft.left, margin)
  assert.equal(topLeft.window.y, WORK_AREA.y)
  assert.equal(topLeft.top, OVERLAY_CHROME.top)
  const topRight = camera('top-right', { ...WORK_AREA, y: 0 })
  assert.equal(topRight.right, WORK_AREA.width - margin)
  assert.equal(compactPositionAt('middle', { workArea: WORK_AREA, size, margin }), undefined)
  assert.deepEqual(COMPACT_SPOTS, ['top-left', 'top-right', 'bottom-left', 'bottom-right', 'left', 'right', 'center'])
})

test('Prompter link spots use the given display, also left of or above the primary one', () => {
  const settings = sanitizeSettings({ size: 240, shape: 'landscape' })
  const size = overlayDimensionsFor(settings)
  const leftOfPrimary = { x: -2560, y: -200, width: 2560, height: 1400 }
  const abovePrimary = { x: 300, y: -1080, width: 1920, height: 1040 }

  const bottomRight = compactPositionAt('bottom-right', { workArea: leftOfPrimary, size, margin: 24 })
  assert.equal(bottomRight.x + size.width - OVERLAY_CHROME.right, -24)
  assert.equal(bottomRight.y + size.height - OVERLAY_CHROME.bottom, -200 + 1400 - 24)
  const topLeft = compactPositionAt('top-left', { workArea: leftOfPrimary, size, margin: 120 })
  assert.deepEqual(topLeft, { x: -2560 + 120 - OVERLAY_CHROME.left, y: -200 + 120 - OVERLAY_CHROME.top })
  const center = compactPositionAt('center', { workArea: abovePrimary, size, margin: 24 })
  assert.ok(center.x >= 300 && center.x + size.width <= 300 + 1920)
  assert.ok(center.y >= -1080 && center.y + size.height <= -40)

  // A margin of 0 still keeps the whole window (and its transparent chrome) on that display.
  const flush = compactPositionAt('bottom-left', { workArea: leftOfPrimary, size, margin: 0 })
  assert.equal(flush.x, -2560)
  assert.equal(flush.y + size.height, -200 + 1400)
})

test('the current work area is the display the Overlay is on, Full screen included', () => {
  const secondary = { bounds: { x: 1920, y: 0, width: 2560, height: 1440 }, workArea: { x: 1920, y: 0, width: 2560, height: 1400 } }
  const { geometry, screen, window } = overlay()
  screen.getDisplayMatching = (bounds) => (bounds.x >= 1920 ? secondary : { bounds: DISPLAY, workArea: WORK_AREA })
  assert.deepEqual(geometry.currentWorkArea(), WORK_AREA)
  window.setBounds({ x: 2400, y: 300 })
  assert.deepEqual(geometry.currentWorkArea(), secondary.workArea)
  assert.deepEqual(geometry.workAreaFor({ x: 2000, y: 10, width: 100, height: 100 }), secondary.workArea)
  assert.deepEqual(geometry.workAreaFor({ x: 10, y: 10, width: 100, height: 100 }), WORK_AREA)
})

test('while the window moves, the current work area is the display it is heading to', () => {
  const secondary = { bounds: { x: 1920, y: 0, width: 2560, height: 1440 }, workArea: { x: 1920, y: 0, width: 2560, height: 1400 } }
  const view = overlay()
  view.screen.getDisplayMatching = (bounds) => (bounds.x >= 1920 ? secondary : { bounds: DISPLAY, workArea: WORK_AREA })
  view.patch({ position: { x: 2400, y: 300 } })
  view.geometry.showScene()
  assert.equal(view.geometry.isSettled(), false)
  assert.deepEqual(view.geometry.currentWorkArea(), secondary.workArea)
})

test('a move during the Full screen exit does not leave a stale Compact base for the next Full screen', () => {
  const { geometry, window, patch, settings, clock, settle } = overlay()
  geometry.setFullscreen(true)
  settle()
  // A bare cue leaves Full screen, then a placed cue moves the window while that animation runs.
  geometry.setFullscreen(false)
  clock.advance(OVERLAY_BOUNDS_TRANSITION_MS / 3)
  patch({ position: { x: 1500, y: 700 } })
  geometry.showCompact()
  settle()
  assert.deepEqual(window.bounds, compact(settings()))

  geometry.setFullscreen(true)
  settle()
  geometry.setFullscreen(false)
  settle()
  assert.deepEqual(window.bounds, compact(settings(), { x: 1500, y: 700 }))
  assert.equal(window.alwaysOnTop.flag, settings().alwaysOnTop)
  assert.equal(clock.activeTimers(), 0)
})

test('a Scene applied in Full screen lands with its size and shape, and without a position where it was', () => {
  const { geometry, window, patch, settings, settle } = overlay()
  geometry.setFullscreen(true)
  settle()
  patch({ size: 240, shape: 'rounded', position: { x: 120, y: 140 } })
  geometry.showCompact()
  settle()
  assert.equal(geometry.isFullscreen(), false)
  assert.deepEqual(window.bounds, compact(settings(), { x: 120, y: 140 }))

  geometry.setFullscreen(true)
  settle()
  patch({ size: 200, shape: 'portrait', position: null })
  geometry.showCompact()
  settle()
  assert.equal(geometry.isFullscreen(), false)
  assert.deepEqual(window.bounds, compact(settings(), { x: 120, y: 140 }))
})

test('a Scene without a position applied during the Full screen exit lands where the Overlay was before', () => {
  const { geometry, window, patch, settings, clock, settle } = overlay()
  const before = window.getBounds()
  geometry.setFullscreen(true)
  settle()
  geometry.setFullscreen(false)
  clock.advance(OVERLAY_BOUNDS_TRANSITION_MS / 3)
  patch({ size: 200, shape: 'portrait', position: null })
  geometry.showCompact()
  settle()
  assert.deepEqual(window.bounds, compact(settings(), { x: before.x, y: before.y }))
  assert.equal(clock.activeTimers(), 0)
})

test('two Scenes applied in Full screen, the last without a position, leave to the place before Full screen', () => {
  const { geometry, window, patch, settings, settle } = overlay()
  const before = window.getBounds()
  geometry.setFullscreen(true)
  settle()
  patch({ position: { x: 1200, y: 300 } })
  geometry.showScene()
  patch({ position: null })
  geometry.showScene()
  const expected = geometry.fullscreenReturnBounds()
  assert.deepEqual(expected, compact(settings(), { x: before.x, y: before.y }))
  geometry.setFullscreen(false)
  settle()
  assert.deepEqual(window.bounds, expected)

  // A Scene with a position still wins: that is where leaving Full screen lands.
  geometry.setFullscreen(true)
  settle()
  patch({ position: { x: 1200, y: 300 } })
  geometry.showScene()
  geometry.setFullscreen(false)
  settle()
  assert.deepEqual(window.bounds, compact(settings(), { x: 1200, y: 300 }))
})

test('a hand drag the stored position has not seen yet still returns there after Full screen', () => {
  const { geometry, window, settings, settle } = overlay()
  // The window is dragged by hand; the native `moved` event has not reached the settings yet.
  window.bounds = { ...window.bounds, x: 900, y: 250 }
  geometry.setFullscreen(true)
  settle()
  const expected = geometry.fullscreenReturnBounds()
  assert.deepEqual(expected, compact(settings(), { x: 900, y: 250 }))
  geometry.setFullscreen(false)
  settle()
  assert.deepEqual(window.bounds, expected)
})

test('in Full screen with the onboarding reserve open, the heading bounds are the whole display', () => {
  const { geometry, settle } = overlay()
  geometry.setOnboardingReserve(true)
  geometry.setFullscreen(true)
  settle()
  assert.deepEqual(geometry.targetBounds(), DISPLAY)
})

test('Full screen right after a move cue returns to where the cue was sending the window', () => {
  const { geometry, window, patch, settings, clock, settle } = overlay()
  patch({ position: { x: 1300, y: 200 } })
  geometry.showCompact()
  clock.advance(OVERLAY_BOUNDS_TRANSITION_MS / 2)
  assert.notDeepEqual(window.bounds, compact(settings()), 'still on its way')
  geometry.setFullscreen(true)
  settle()
  assert.deepEqual(geometry.fullscreenReturnBounds(), compact(settings(), { x: 1300, y: 200 }))
  geometry.setFullscreen(false)
  settle()
  assert.deepEqual(window.bounds, compact(settings(), { x: 1300, y: 200 }))
})

test('showCompact leaves Full screen for the new compact position', () => {
  const { geometry, window, patch, settings, settle, events } = overlay()
  geometry.setFullscreen(true)
  settle()
  patch({ position: { x: 1500, y: 700 } })
  geometry.showCompact()
  assert.equal(geometry.isFullscreen(), false)
  assert.deepEqual(events.fullscreen, [true, false])
  settle()
  assert.deepEqual(window.bounds, compact(settings()))

  patch({ position: { x: 100, y: 120 } })
  geometry.showCompact()
  settle()
  assert.deepEqual(window.bounds, compact(settings()))
})

test('an exact Compact layout keeps the camera inside a right-hand share of the display', async () => {
  const { planCompactLayout } = await import('../src/overlay-geometry.js')
  const large = planCompactLayout(
    { shape: 'circle', size: 432, spot: 'right', margin: 32, withinRight: 0.3 },
    { workArea: WORK_AREA },
  )
  assert.deepEqual(large, {
    size: 432,
    position: { x: 1920 - 32 - 432 - OVERLAY_CHROME.left, y: (1040 - 432) / 2 - OVERLAY_CHROME.top },
    requestedSize: 432,
    clamped: false,
  })
  // The camera surface starts inside the right 30%.
  assert.ok(large.position.x + OVERLAY_CHROME.left >= 1920 * 0.7)

  const narrow = { x: 0, y: 0, width: 1280, height: 680 }
  const clamped = planCompactLayout(
    { shape: 'circle', size: 432, spot: 'right', margin: 32, withinRight: 0.3 },
    { workArea: narrow },
  )
  assert.equal(clamped.size, Math.floor(1280 * 0.3 - 32))
  assert.equal(clamped.clamped, true)
  assert.ok(clamped.position.x + OVERLAY_CHROME.left >= 1280 * 0.7)
  assert.equal(clamped.position.x + OVERLAY_CHROME.left + clamped.size, 1280 - 32)

  const landscape = planCompactLayout(
    { shape: 'landscape', size: 640, spot: 'top-right', margin: 0, withinRight: 0.25 },
    { workArea: WORK_AREA },
  )
  // 25% of 1920 is 480, less the 18 px of chrome that always stays on screen at the right.
  assert.equal(landscape.size, 480 - OVERLAY_CHROME.right)
  assert.ok(landscape.position.x + OVERLAY_CHROME.left >= 1920 * 0.75)
  const zeroMargin = planCompactLayout(
    { shape: 'circle', size: 640, spot: 'right', margin: 0, withinRight: 0.3 },
    { workArea: WORK_AREA },
  )
  assert.ok(zeroMargin.position.x + OVERLAY_CHROME.left >= 1920 * 0.7, 'a 0 margin still stays inside the share')

  const tooNarrow = planCompactLayout(
    { shape: 'circle', size: 300, spot: 'right', margin: 32, withinRight: 0.1 },
    { workArea: narrow },
  )
  assert.equal(tooNarrow.code, 'does-not-fit')
  assert.match(tooNarrow.error, /right 10% of this display is too narrow/)
  assert.match(tooNarrow.error, /and the 32 px gap at the right edge/)
  // Below 18 px the chrome that stays on screen sets the gap, and the refusal says so.
  const noMargin = planCompactLayout(
    { shape: 'circle', size: 300, spot: 'right', margin: 0, withinRight: 0.1 },
    { workArea: { x: 0, y: 0, width: 800, height: 600 } },
  )
  assert.equal(noMargin.code, 'does-not-fit')
  assert.match(noMargin.error, new RegExp(`and the ${OVERLAY_CHROME.right} px gap at the right edge`))

  const point = planCompactLayout({ shape: 'circle', size: 300, point: { x: 100, y: 200 } }, { workArea: WORK_AREA })
  assert.deepEqual(point.position, { x: 100 - OVERLAY_CHROME.left, y: 200 - OVERLAY_CHROME.top })
  const outside = planCompactLayout({ shape: 'circle', size: 300, point: { x: 5000, y: -50 } }, { workArea: WORK_AREA })
  assert.deepEqual(outside.position, { x: 1920 - 300 - OVERLAY_CHROME.left - OVERLAY_CHROME.right, y: 0 })

  const current = { x: 1000, y: 400, width: 336, height: 390 }
  const centred = planCompactLayout({ shape: 'circle', size: 200 }, { workArea: WORK_AREA, current })
  assert.deepEqual(centred.position, { x: 1000 + (336 - 236) / 2, y: 400 + (390 - 302) / 2 })
})

test('portrait and landscape cameras fit the right share at the largest size and stay vertically centred', async () => {
  const { planCompactLayout } = await import('../src/overlay-geometry.js')
  const { dimensionsFor } = await import('../src/settings.js')
  const narrow = { x: 0, y: 0, width: 1280, height: 680 }
  const share = 1280 * 0.3
  for (const shape of ['portrait', 'landscape']) {
    const plan = planCompactLayout({ shape, size: 640, spot: 'right', margin: 32, withinRight: 0.3 }, { workArea: narrow })
    assert.equal(plan.error, undefined, shape)
    const camera = cameraRectFor({ ...plan.position, ...overlayDimensionsFor({ shape, size: plan.size }) })
    assert.ok(camera.width + 32 <= share, `${shape}: ${camera.width} + 32 inside ${share}`)
    assert.ok(camera.x >= 1280 - share, `${shape}: starts inside the right 30%`)
    assert.equal(camera.x + camera.width, 1280 - 32, `${shape}: 32 px from the right edge`)
    // One pixel more would no longer fit the share or the display.
    const bigger = dimensionsFor({ shape, size: plan.size + 1 })
    const biggerWindow = overlayDimensionsFor({ shape, size: plan.size + 1 })
    assert.ok(bigger.width + 32 > share || biggerWindow.height > narrow.height, `${shape}: ${plan.size} is the largest that fits`)
    assert.equal(plan.clamped, true, shape)
    if (shape === 'landscape') {
      // Vertically centred: the camera's middle is the work area's middle (340 of 680).
      const middle = camera.y + camera.height / 2
      assert.ok(Math.abs(middle - 340) <= 1, `landscape middle ${middle}, expected 340`)
    }
  }
})

test('targetBounds reports where an animated move is heading and isSettled when it is there', () => {
  const view = overlay()
  const start = view.window.getBounds()
  assert.equal(view.geometry.isSettled(), true)
  view.patch({ position: { x: 900, y: 300 } })
  view.geometry.showScene()
  assert.equal(view.geometry.isSettled(), false)
  assert.deepEqual(view.geometry.targetBounds(), { ...start, x: 900, y: 300 })
  view.settle()
  assert.equal(view.geometry.isSettled(), true)
  assert.deepEqual(view.window.getBounds(), { ...start, x: 900, y: 300 })
})

test('a held, dragged and dragged-back corner leaves the small size at the size let go at', () => {
  const view = overlay({ settings: { size: 300 } })
  let settings = sanitizeSettings({ size: 300, prompterSmallSize: 260 })
  const feed = () => {
    for (const resize of view.events.resizes.splice(0)) settings = settingsAfterHandResize(settings, { size: resize.size })
  }
  view.geometry.startResize('bottom-right')
  view.clock.advance(50)
  feed()
  assert.equal(settings.prompterSmallSize, 260, 'holding a corner still changes nothing')
  view.screen.cursor = { x: 40, y: 40 }
  view.clock.advance(20)
  feed()
  assert.equal(settings.prompterSmallSize, 340)
  view.screen.cursor = { x: 0, y: 0 }
  view.clock.advance(20)
  feed()
  view.geometry.stopResize()
  assert.equal(settings.size, 300)
  assert.equal(settings.prompterSmallSize, 300, 'dragged back: the size let go at wins')
})

test('a cue that changes the size while a corner is only held keeps the cue size', () => {
  const view = overlay({ settings: { size: 300 } })
  view.geometry.startResize('bottom-right')
  view.clock.advance(20)
  // A Prompter cue makes the camera 432 px while the corner is held.
  view.patch({ size: 432 })
  view.geometry.showScene()
  view.settle()
  assert.deepEqual(view.events.resizes, [], 'a held corner reports no resize')
  view.geometry.stopResize()
  assert.equal(view.settings().size, 432)
  assert.equal(view.window.getBounds().width, 432 + OVERLAY_CHROME.left + OVERLAY_CHROME.right)
})

test('a drag after a cue changed the size while the corner was held starts from the cue size', () => {
  const view = overlay({ settings: { size: 300 } })
  view.geometry.startResize('bottom-right')
  view.clock.advance(20)
  view.patch({ size: 432 })
  view.geometry.showScene()
  view.settle()
  view.screen.cursor = { x: 5, y: 5 }
  view.clock.advance(20)
  const reported = view.events.resizes.at(-1)
  assert.equal(reported.size, 437)
  view.geometry.stopResize()
  const settings = settingsAfterHandResize(sanitizeSettings({ ...view.settings(), size: 432, prompterSmallSize: 288 }), reported)
  assert.equal(settings.prompterSmallSize, 437)
})

test('a drag that starts while a cue is still moving the window starts from where it is heading', () => {
  const view = overlay({ settings: { size: 300 } })
  view.geometry.startResize('top-left')
  view.clock.advance(20)
  view.patch({ size: 432, position: { x: 600, y: 400 } })
  view.geometry.showScene()
  assert.equal(view.geometry.isSettled(), false)
  view.screen.cursor = { x: -5, y: -5 }
  view.clock.advance(16)
  const reported = view.events.resizes.at(-1)
  assert.equal(reported.size, 437)
  view.geometry.stopResize()
  // The top-left corner grows up and left from the cue's target, not from half-way bounds.
  assert.deepEqual(view.settings().position, { x: 595, y: 395 })
})

test('a drag started during a cue move and let go before it ends keeps the dragged size on screen', () => {
  const view = overlay({ settings: { size: 300 } })
  view.patch({ size: 432, position: { x: 600, y: 400 } })
  view.geometry.showScene()
  assert.equal(view.geometry.isSettled(), false)
  view.geometry.startResize('top-left')
  view.screen.cursor = { x: -5, y: -5 }
  view.clock.advance(16)
  assert.equal(view.events.resizes.at(-1).size, 437)
  // Let go before the cue's move would have ended: the window shows the size that was saved.
  view.geometry.stopResize()
  view.settle()
  assert.equal(view.settings().size, 437)
  assert.deepEqual(view.window.bounds, compact(view.settings()))
})

test('a cue during a hand drag ends the drag: the cue size stays and the drag reports nothing more', () => {
  const view = overlay({ settings: { size: 300 } })
  view.settle()
  view.geometry.startResize('bottom-right')
  view.screen.cursor = { x: 10, y: 10 }
  view.clock.advance(16)
  const reported = view.events.resizes.length
  assert.ok(reported > 0)
  view.patch({ size: 432, position: { x: 600, y: 400 } })
  view.geometry.showScene()
  view.screen.cursor = { x: 20, y: 20 }
  view.clock.advance(16)
  view.settle()
  view.geometry.stopResize()
  assert.equal(view.events.resizes.length, reported, 'no hand resize after the cue')
  assert.equal(view.settings().size, 432)
  assert.deepEqual(view.window.bounds, compact(view.settings()))
})

test('a Scene applied in Full screen (tray or shortcut) is where Escape lands', () => {
  const view = overlay()
  view.geometry.setFullscreen(true)
  view.settle()
  view.patch({ size: 300, position: { x: 100, y: 120 } })
  view.geometry.showScene()
  view.geometry.setFullscreen(false)
  view.settle()
  assert.deepEqual(view.window.bounds, compact(view.settings()))
  // A Scene without a place still returns to where the Overlay was before Full screen.
  const other = overlay()
  const before = other.window.getBounds()
  other.geometry.setFullscreen(true)
  other.settle()
  other.patch({ size: 300, position: null })
  other.geometry.showScene()
  other.geometry.setFullscreen(false)
  other.settle()
  assert.deepEqual({ x: other.window.bounds.x, y: other.window.bounds.y }, { x: before.x, y: before.y })
})

test('left, right and center stay vertically centred on a short screen', async () => {
  const { planCompactLayout } = await import('../src/overlay-geometry.js')
  const short = { x: 0, y: 0, width: 1366, height: 728 }
  for (const spot of ['right', 'left', 'center']) {
    const plan = planCompactLayout({ shape: 'circle', size: 640, spot, margin: 32 }, { workArea: short })
    const camera = cameraRectFor({ ...plan.position, ...overlayDimensionsFor({ shape: 'circle', size: plan.size }) })
    assert.ok(Math.abs(camera.y + camera.height / 2 - 364) <= 1, `${spot}: middle ${camera.y + camera.height / 2}`)
    assert.ok(plan.position.y >= short.y, `${spot}: toolbar on screen`)
    assert.equal(plan.clamped, true)
  }
  // Top and bottom places keep using the full height.
  const bottom = planCompactLayout({ shape: 'circle', size: 640, spot: 'bottom-right', margin: 32 }, { workArea: short })
  assert.equal(bottom.size, 728 - OVERLAY_CHROME.top - OVERLAY_CHROME.bottom)
})

test('leaving Full screen for another display, the current work area is that display', () => {
  const secondary = { bounds: { x: 1920, y: 0, width: 2560, height: 1440 }, workArea: { x: 1920, y: 0, width: 2560, height: 1400 } }
  const view = overlay()
  view.screen.getDisplayMatching = (bounds) => (bounds.x >= 1920 ? secondary : { bounds: DISPLAY, workArea: WORK_AREA })
  view.geometry.setFullscreen(true)
  view.settle()
  view.patch({ position: { x: 2000, y: 100 } })
  view.geometry.showCompact()
  assert.equal(view.geometry.isSettled(), false)
  assert.deepEqual(view.geometry.currentWorkArea(), secondary.workArea)
})

test('a native move event during a move-drag stores nothing; the end of the drag reports its place once', () => {
  const { geometry, screen, clock, events, window } = overlay()
  geometry.startDrag()
  screen.cursor = { x: 300, y: 300 }
  clock.advance(32)
  geometry.windowMoved()
  assert.deepEqual(events.positions, [], 'macOS reports moved on every step of a drag')
  geometry.stopDrag()
  assert.deepEqual(events.dragEnds, [{ x: window.bounds.x, y: window.bounds.y }])
  geometry.stopDrag()
  assert.equal(events.dragEnds.length, 1)
})

test('a click on the camera without moving it reports no drag end, so nothing is saved', () => {
  const { geometry, clock, events } = overlay()
  geometry.startDrag()
  clock.advance(48)
  geometry.stopDrag()
  assert.deepEqual(events.dragEnds, [])
})

test('a drag ended by hiding or Full screen reports its place; one ended by a Scene or cue move does not', () => {
  const hidden = overlay()
  hidden.geometry.startDrag()
  hidden.screen.cursor = { x: 300, y: 300 }
  hidden.clock.advance(32)
  hidden.patch({ overlayVisible: false })
  hidden.geometry.apply({ updateBounds: false })
  assert.equal(hidden.events.dragEnds.length, 1)

  const moved = overlay()
  moved.geometry.startDrag()
  moved.screen.cursor = { x: 300, y: 300 }
  moved.clock.advance(32)
  moved.patch({ position: { x: 1500, y: 700 } })
  moved.geometry.showCompact()
  assert.deepEqual(moved.events.dragEnds, [], 'the drag must not save its spot over the cue')
})

// --- TOOLS-156: the Overlay can never end up off screen ---

const LAPTOP = { x: 0, y: 0, width: 1920, height: 1040 }
// A second display to the right of the laptop, as on a docked desk.
const DESK = { x: 1920, y: 0, width: 2560, height: 1400 }
const windowAt = (x, y, size = 288) => ({ x, y, ...overlayDimensionsFor({ shape: 'circle', size }) })

test('visibleShare: the share of a rectangle on any display, across two displays and none', () => {
  const rect = { x: 1820, y: 100, width: 200, height: 100 }
  assert.equal(visibleShare(rect, [LAPTOP]), 0.5)
  assert.equal(visibleShare(rect, [LAPTOP, DESK]), 1)
  assert.equal(visibleShare({ x: 5000, y: 100, width: 200, height: 100 }, [LAPTOP, DESK]), 0)
  assert.equal(visibleShare(rect, []), 0)
})

test('isOnScreen: at least half the window and half its camera (the drag handle) on a display', () => {
  assert.equal(isOnScreen(windowAt(400, 500), [LAPTOP]), true)
  // Saved on the desk display, which is gone now (the TOOLS-156 laptop).
  assert.equal(isOnScreen(windowAt(3000, 400), [LAPTOP]), false)
  assert.equal(isOnScreen(windowAt(3000, 400), [LAPTOP, DESK]), true)
  // Straddling two displays still counts: every part is on one of them.
  assert.equal(isOnScreen(windowAt(1800, 400), [LAPTOP, DESK]), true)
  // Mostly past the right edge of a lone display.
  assert.equal(isOnScreen(windowAt(1920 - 100, 400), [LAPTOP]), false)
  // Far above every display (negative coordinates from an old display arrangement).
  assert.equal(isOnScreen(windowAt(400, -2000), [LAPTOP, DESK]), false)
  // The window's transparent chrome on screen is not enough: the camera itself must be.
  const window = windowAt(400, 1040 - 210)
  assert.ok(visibleShare(window, [LAPTOP]) > 0.5)
  assert.equal(isOnScreen(window, [LAPTOP]), false)
  assert.equal(isOnScreen(windowAt(400, 500), []), false)
})

test('onScreenBase keeps a reachable place and moves a lost one to the bottom right of the main display', () => {
  const options = { workAreas: [LAPTOP], primaryWorkArea: LAPTOP, margin: 32 }
  const kept = windowAt(400, 500)
  assert.deepEqual(onScreenBase(kept, options), kept)
  const lost = windowAt(3000, 400, 360)
  const healed = onScreenBase(lost, options)
  assert.equal(healed.width, lost.width, 'the size is kept')
  assert.equal(healed.height, lost.height)
  assert.deepEqual(
    { x: healed.x, y: healed.y },
    compactPositionAt('bottom-right', { workArea: LAPTOP, size: lost, margin: 32 }),
    'the same corner and margin as the Small bottom starter Scene',
  )
  assert.equal(isOnScreen(healed, [LAPTOP]), true)
  // A main display that is not at 0,0 (Windows can put it anywhere in the desktop).
  const main = { x: -1280, y: 200, width: 1280, height: 984 }
  const moved = onScreenBase(lost, { workAreas: [main], primaryWorkArea: main, margin: 32 })
  assert.equal(isOnScreen(moved, [main]), true)
})

test('keepOnWorkArea clamps a place so the whole window is on that display', () => {
  const size = overlayDimensionsFor({ shape: 'circle', size: 288 })
  assert.deepEqual(keepOnWorkArea({ x: 400, y: 500 }, size, LAPTOP), { x: 400, y: 500 })
  assert.deepEqual(keepOnWorkArea({ x: 3000, y: -50 }, size, LAPTOP), { x: 1920 - size.width, y: 0 })
  assert.deepEqual(keepOnWorkArea({ x: -900, y: 5000 }, size, DESK), { x: 1920, y: 1400 - size.height })
})

function screenWith(view, workAreas, primary = workAreas[0]) {
  view.screen.displays = workAreas.map((workArea) => ({ bounds: workArea, workArea }))
  view.screen.getAllDisplays = () => view.screen.displays
  view.screen.getPrimaryDisplay = () => ({ bounds: primary, workArea: primary })
  view.screen.getDisplayMatching = (bounds) => {
    const centre = { x: bounds.x + bounds.width / 2, y: bounds.y + bounds.height / 2 }
    const distance = ({ workArea: a }) =>
      Math.hypot(Math.max(a.x - centre.x, 0, centre.x - a.x - a.width), Math.max(a.y - centre.y, 0, centre.y - a.y - a.height))
    return [...view.screen.displays].sort((left, right) => distance(left) - distance(right))[0]
  }
}

test('showing the Overlay at a saved place on a display that is gone brings it back on screen', () => {
  const view = overlay({ settings: { position: { x: 3000, y: 400 } } })
  screenWith(view, [LAPTOP])
  view.geometry.apply()
  assert.equal(view.window.visible, true)
  assert.equal(isOnScreen(view.window.bounds, [LAPTOP]), true)
  assert.deepEqual(view.window.bounds, onScreenBase(compact(sanitizeSettings({ position: { x: 3000, y: 400 } })), { workAreas: [LAPTOP], primaryWorkArea: LAPTOP, margin: 32 }))
  assert.deepEqual(view.settings().position, { x: view.window.bounds.x, y: view.window.bounds.y }, 'the new place is stored')
})

test('a display removed while the Overlay is on it brings the Overlay back; a reachable one stays put', () => {
  const view = overlay({ settings: { position: { x: 3000, y: 400 } } })
  screenWith(view, [LAPTOP, DESK])
  view.geometry.apply()
  assert.deepEqual({ x: view.window.bounds.x, y: view.window.bounds.y }, { x: 3000, y: 400 }, 'on the desk display, untouched')
  view.screen.displays = view.screen.displays.slice(0, 1)
  view.geometry.ensureOnScreen()
  assert.equal(isOnScreen(view.window.bounds, [LAPTOP]), true)
  assert.equal(view.window.bounds.width, overlayDimensionsFor(view.settings()).width, 'the size is kept')
  const settled = { ...view.window.bounds }
  view.geometry.ensureOnScreen()
  assert.deepEqual(view.window.bounds, settled)
})

test('a lower resolution that leaves the Overlay past the edge brings it back', () => {
  const view = overlay({ settings: { position: { x: 1500, y: 700 } } })
  screenWith(view, [LAPTOP])
  view.geometry.apply()
  assert.deepEqual({ x: view.window.bounds.x, y: view.window.bounds.y }, { x: 1500, y: 700 })
  const smaller = { x: 0, y: 0, width: 1280, height: 680 }
  screenWith(view, [smaller])
  view.geometry.ensureOnScreen()
  assert.equal(isOnScreen(view.window.bounds, [smaller]), true)
})

test('leaving Full screen never lands on a display that is gone', () => {
  const view = overlay({ settings: { position: { x: 3000, y: 400 } } })
  screenWith(view, [LAPTOP, DESK])
  view.geometry.apply()
  view.geometry.setFullscreen(true)
  view.settle()
  view.screen.displays = view.screen.displays.slice(0, 1)
  view.geometry.ensureOnScreen()
  assert.equal(isOnScreen(view.window.bounds, [LAPTOP]), true, 'Full screen moves to a display still there')
  assert.equal(isOnScreen(view.geometry.fullscreenReturnBounds(), [LAPTOP]), true)
  view.geometry.setFullscreen(false)
  view.settle()
  assert.equal(isOnScreen(view.window.bounds, [LAPTOP]), true)
})

test('without a display list (an old screen fake) the saved place is trusted as before', () => {
  const view = overlay({ settings: { position: { x: 3000, y: 400 } } })
  view.geometry.apply()
  assert.deepEqual({ x: view.window.bounds.x, y: view.window.bounds.y }, { x: 3000, y: 400 })
  view.geometry.ensureOnScreen()
  assert.deepEqual({ x: view.window.bounds.x, y: view.window.bounds.y }, { x: 3000, y: 400 })
})

test('a lost Overlay comes back with the onboarding space above it still open', () => {
  const view = overlay()
  screenWith(view, [LAPTOP, DESK])
  view.geometry.apply()
  assert.equal(view.geometry.setOnboardingReserve(true), ONBOARDING_TOP_RESERVE)
  view.window.setBounds({ x: 3000, y: 400 - ONBOARDING_TOP_RESERVE })
  view.screen.displays = view.screen.displays.slice(0, 1)
  view.geometry.ensureOnScreen()
  const base = view.geometry.compactBounds()
  assert.equal(view.window.bounds.y, base.y - ONBOARDING_TOP_RESERVE)
  assert.equal(isOnScreen(base, [LAPTOP]), true)
  assert.deepEqual(view.events.positions.at(-1), { x: base.x, y: base.y })
})

test('a drag in progress is left alone; a move in progress is checked when it ends', () => {
  const dragged = overlay({ settings: { position: { x: 3000, y: 400 } } })
  screenWith(dragged, [LAPTOP, DESK])
  dragged.geometry.apply()
  dragged.geometry.startDrag()
  dragged.screen.displays = dragged.screen.displays.slice(0, 1)
  dragged.geometry.ensureOnScreen()
  assert.deepEqual({ x: dragged.window.bounds.x, y: dragged.window.bounds.y }, { x: 3000, y: 400 })
  assert.deepEqual(dragged.events.positions, [])
  dragged.geometry.stopDrag()

  // A Scene move heading for the desk display, which is unplugged while it runs.
  const moving = overlay()
  screenWith(moving, [LAPTOP, DESK])
  moving.geometry.apply()
  moving.patch({ position: { x: 3000, y: 400 } })
  moving.geometry.showScene()
  assert.equal(moving.geometry.isSettled(), false)
  moving.screen.displays = moving.screen.displays.slice(0, 1)
  moving.geometry.ensureOnScreen()
  moving.settle()
  assert.equal(isOnScreen(moving.window.bounds, [LAPTOP]), true, 'checked once the move ended')
})
