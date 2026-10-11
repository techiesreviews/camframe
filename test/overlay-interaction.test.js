import test from 'node:test'
import assert from 'node:assert/strict'
import {
  COMPACT_CHROME_HIDE_DELAY_MS,
  FULLSCREEN_TOOLBAR_HIDE_DELAY_MS,
  createOverlayInteraction,
} from '../src/overlay-interaction.js'

function fakeTimers() {
  let now = 0
  let nextId = 1
  const pending = new Map()
  return {
    timers: {
      setTimeout(callback, ms) {
        const id = nextId++
        pending.set(id, { callback, due: now + ms })
        return id
      },
      clearTimeout: (id) => pending.delete(id),
    },
    advance(ms) {
      now += ms
      for (const [id, timer] of [...pending].sort((a, b) => a[1].due - b[1].due)) {
        if (timer.due > now) continue
        pending.delete(id)
        timer.callback()
      }
    },
    pending: () => pending.size,
  }
}

function overlay() {
  const clock = fakeTimers()
  const sent = []
  const interaction = createOverlayInteraction({
    timers: clock.timers,
    onInteractiveChange: (interactive) => sent.push(interactive),
  })
  return { interaction, clock, sent }
}

const toolbarRect = { left: 100, top: 20, right: 340, bottom: 64 }
const at = (x, y) => ({ point: { x, y }, toolbarRect })

test('hovering a surface shows the chrome and makes the window interactive', () => {
  const { interaction, sent } = overlay()
  interaction.pointerMoved({ overSurface: true })
  assert.equal(interaction.hovered, true)
  assert.deepEqual(sent, [true])
})

test('leaving the surfaces hides the chrome after a short delay, restarted by movement', () => {
  const { interaction, clock, sent } = overlay()
  interaction.pointerMoved({ overSurface: true })
  interaction.pointerMoved({ overSurface: false })
  clock.advance(COMPACT_CHROME_HIDE_DELAY_MS - 20)
  interaction.pointerMoved({ overSurface: false })
  clock.advance(COMPACT_CHROME_HIDE_DELAY_MS - 20)
  assert.equal(interaction.hovered, true)
  clock.advance(20)
  assert.equal(interaction.hovered, false)
  assert.deepEqual(sent, [true, false])
})

test('leaving the window hides the chrome at once', () => {
  const { interaction, clock } = overlay()
  interaction.pointerMoved({ overSurface: true })
  interaction.pointerLeft()
  assert.equal(interaction.hovered, false)
  assert.equal(clock.pending(), 0)
})

test('open settings, onboarding, framing, and resizing keep the chrome and the mouse', () => {
  for (const activity of ['controlsOpen', 'onboardingOpen', 'positioning', 'resizing']) {
    const { interaction, clock } = overlay()
    interaction.showChrome()
    interaction.set({ [activity]: true })
    interaction.pointerLeft()
    interaction.pointerMoved({ overSurface: false })
    clock.advance(1000)
    assert.equal(interaction.hovered, true, activity)
    interaction.hideChrome()
    assert.equal(interaction.interactive, true, activity)
  }
})

test('dragging keeps the window interactive and does not schedule a hide', () => {
  const { interaction, clock } = overlay()
  interaction.showChrome()
  interaction.set({ dragging: true })
  interaction.pointerMoved({ overSurface: false })
  clock.advance(1000)
  assert.equal(interaction.hovered, true)
  interaction.hideChrome()
  assert.equal(interaction.interactive, true)
  interaction.set({ dragging: false })
  assert.equal(interaction.interactive, false)
})

test('every way out of an activity derives interactivity from the same rule', () => {
  const { interaction, sent } = overlay()
  interaction.set({ onboardingOpen: true })
  interaction.set({ dragging: true })
  interaction.set({ dragging: false })
  interaction.set({ positioning: true, repositioning: true })
  interaction.set({ repositioning: false })
  interaction.set({ positioning: false })
  assert.equal(interaction.interactive, true)
  interaction.set({ onboardingOpen: false })
  assert.deepEqual(sent, [true, false])
})

test('Full screen shows the toolbar only near its padded hotspot', () => {
  const { interaction, clock } = overlay()
  interaction.set({ fullscreen: true })

  interaction.pointerMoved(at(220, 42))
  assert.equal(interaction.hovered, true)
  interaction.pointerMoved(at(92, 42))
  assert.equal(interaction.hovered, true)

  interaction.pointerMoved(at(80, 42))
  clock.advance(FULLSCREEN_TOOLBAR_HIDE_DELAY_MS)
  assert.equal(interaction.hovered, false)
  interaction.pointerMoved(at(220, 80))
  assert.equal(interaction.hovered, false)
  interaction.pointerMoved({ point: { x: 220, y: 42 } })
  assert.equal(interaction.hovered, false)
})

test('Full screen hides after inactivity instead of restarting on every move', () => {
  const { interaction, clock } = overlay()
  interaction.set({ fullscreen: true })
  interaction.showChrome()
  interaction.scheduleHide()
  clock.advance(FULLSCREEN_TOOLBAR_HIDE_DELAY_MS - 50)
  interaction.pointerMoved(at(800, 800))
  clock.advance(50)
  assert.equal(interaction.hovered, false)
  assert.equal(interaction.interactive, false)
})

test('open settings keep the Full screen toolbar wherever the pointer goes', () => {
  const { interaction, clock } = overlay()
  interaction.set({ fullscreen: true, controlsOpen: true })
  interaction.pointerMoved(at(800, 800))
  clock.advance(1000)
  assert.equal(interaction.hovered, true)
})

test('showing the chrome cancels a pending hide', () => {
  const { interaction, clock } = overlay()
  interaction.showChrome()
  interaction.scheduleHide()
  interaction.showChrome()
  clock.advance(1000)
  assert.equal(interaction.hovered, true)
})

test('only real changes reach the window', () => {
  const { interaction, sent } = overlay()
  interaction.showChrome()
  interaction.showChrome()
  interaction.set({ controlsOpen: true })
  interaction.hideChrome()
  interaction.set({ controlsOpen: false })
  assert.deepEqual(sent, [true, false])
  assert.throws(() => interaction.set({ hovering: true }), /Unknown Overlay activity/)
})
