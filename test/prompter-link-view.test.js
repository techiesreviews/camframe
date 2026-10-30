import test from 'node:test'
import assert from 'node:assert/strict'
import { prompterLinkView, toggledPrompterLink } from '../src/prompter-link-view.js'

// The Inline settings switch, its status line and the toolbar button all render this one view.

test('a switched-off link reads as off whatever main last reported', () => {
  for (const prompterLinkStatus of [undefined, { state: 'on', port: 47833 }, { state: 'error', message: 'x' }]) {
    const view = prompterLinkView({ prompterLink: false, prompterLinkStatus })
    assert.equal(view.on, false)
    assert.equal(view.state, 'off')
    assert.equal(view.title, 'Prompter link: off')
    assert.match(view.status, /^Off\./)
  }
})

test('a switched-on link follows main: starting, ready on its port, or a problem', () => {
  const ready = prompterLinkView({ prompterLink: true, prompterLinkStatus: { state: 'on', port: 47833, message: '' } })
  assert.deepEqual(ready, {
    on: true,
    state: 'on',
    status: 'On. Waiting for prompter cues on port 47833.',
    title: 'Prompter link: on, waiting for cues',
  })

  const starting = prompterLinkView({ prompterLink: true, prompterLinkStatus: { state: 'starting', port: 47833 } })
  assert.equal(starting.state, 'starting')
  assert.equal(starting.status, 'Starting…')

  const busy = prompterLinkView({
    prompterLink: true,
    prompterLinkStatus: { state: 'error', port: 47833, message: 'Port 47833 is in use by another app.' },
  })
  assert.equal(busy.on, true)
  assert.equal(busy.state, 'error')
  assert.equal(busy.status, 'Port 47833 is in use by another app. Turn it off and on to retry.')
  assert.equal(busy.title, 'Prompter link: problem. Port 47833 is in use by another app.')
})

test('a switched-on link whose status has not caught up reads as starting, never off', () => {
  for (const prompterLinkStatus of [undefined, { state: 'off', port: 47833 }, { state: 'unknown' }]) {
    const view = prompterLinkView({ prompterLink: true, prompterLinkStatus })
    assert.equal(view.on, true)
    assert.equal(view.state, 'starting')
  }
})

test('a problem without a message still says what to do', () => {
  const view = prompterLinkView({ prompterLink: true, prompterLinkStatus: { state: 'error', port: 47833 } })
  assert.equal(view.status, 'The Prompter link stopped. Turn it off and on to retry.')
})

test('a ready link without a port never shows "undefined"', () => {
  const view = prompterLinkView({ prompterLink: true, prompterLinkStatus: { state: 'on' } })
  assert.equal(view.status, 'On. Waiting for prompter cues.')
})

test('only a stored true turns the view on', () => {
  for (const prompterLink of [undefined, 'true', 1]) assert.equal(prompterLinkView({ prompterLink }).on, false)
  assert.equal(prompterLinkView().state, 'off')
})

// The Overlay as the two controls see it: each press flips the last request (or the stored choice
// before the first press) and sends it; main answers requests in order, whenever it gets to them.
function overlayModel(stored) {
  const model = { stored, pending: undefined, sent: [], queue: [] }
  const press = () => {
    model.pending = toggledPrompterLink(model.pending, model.stored)
    model.sent.push(model.pending)
    model.queue.push(model.pending)
  }
  return Object.assign(model, {
    toolbar: press,
    settingsSwitch: press,
    answer: () => { model.stored = model.queue.shift() },
    drain: () => { while (model.queue.length) model.answer() },
  })
}

test('quick toolbar presses flip the last request instead of repeating it', () => {
  const model = overlayModel(true)
  model.toolbar()
  model.toolbar()
  model.answer()
  model.toolbar()
  assert.deepEqual(model.sent, [false, true, false])
  model.drain()
  assert.equal(model.stored, false)
})

test('an early answer that matches the newest request does not end it', () => {
  const model = overlayModel(false)
  model.toolbar()
  model.toolbar()
  model.toolbar()
  model.answer()
  model.answer()
  model.toolbar()
  model.drain()
  assert.deepEqual(model.sent, [true, false, true, false])
  assert.equal(model.stored, false)
})

test('the toolbar and the settings switch flip the same request', () => {
  const model = overlayModel(true)
  model.toolbar()
  model.settingsSwitch()
  model.toolbar()
  assert.deepEqual(model.sent, [false, true, false])
  model.drain()
  assert.equal(model.stored, false)
})

test('a slow main never makes a press repeat the request before it', () => {
  const model = overlayModel(true)
  model.toolbar()
  model.toolbar()
  assert.deepEqual(model.sent, [false, true])
  model.drain()
  assert.equal(model.stored, true)
  model.settingsSwitch()
  model.drain()
  assert.deepEqual(model.sent, [false, true, false])
  assert.equal(model.stored, false)
})
