import test from 'node:test'
import assert from 'node:assert/strict'
import { ONBOARDING_TOP_RESERVE } from '../src/onboarding.js'
import {
  COMPACT_SPOTS,
  DEFAULT_SETTINGS,
  OVERLAY_CHROME,
  overlayDimensionsFor,
  sanitizeSettings,
} from '../src/settings.js'
import {
  OVERLAY_BOUNDS_TRANSITION_MS,
  alwaysOnTopLevelFor,
  compactBaseBounds,
  compactPositionAt,
  createOverlayGeometry,
  isFullscreenExitInput,
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
  const events = { fullscreen: [], positions: [] }
  const geometry = createOverlayGeometry({
    window,
    screen,
    settings: () => settings,
    alwaysOnTopLevel: 'floating',
    timers: clock.timers,
    onResize(patch) {
      settings = sanitizeSettings({ ...settings, ...patch })
      geometry.apply({ keepCenter: false })
    },
    onCompactPositionChanged(position) {
      settings = { ...settings, position }
      events.positions.push(position)
    },
    onFullscreenChanged: (fullscreen) => events.fullscreen.push(fullscreen),
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
