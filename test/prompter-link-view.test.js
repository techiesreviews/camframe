import test from 'node:test'
import assert from 'node:assert/strict'
import { prompterLinkView, settledPrompterLink, toggledPrompterLink } from '../src/prompter-link-view.js'

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

// A small model of the Overlay: presses record a pending request and send it; main answers each
// request in order with the stored value; every answer settles the pending request.
function overlayModel(stored) {
  const model = { stored, pending: undefined, sent: [] }
  const send = (value) => {
    model.pending = value
    model.sent.push(value)
  }
  return Object.assign(model, {
    toolbar: () => send(toggledPrompterLink(model.pending, model.stored)),
    // The switch shows `stored` until main answers, so a click asks for the opposite of that.
    settingsSwitch: () => send(!model.stored),
    answer: () => {
      model.stored = model.sent.shift()
      model.pending = settledPrompterLink(model.pending, model.stored)
    },
  })
}

test('quick toolbar presses flip the pending request instead of repeating it', () => {
  const model = overlayModel(true)
  model.toolbar()
  model.toolbar()
  assert.deepEqual(model.sent, [false, true])
  model.answer()
  model.toolbar()
  assert.deepEqual(model.sent, [true, false])
  model.answer()
  model.answer()
  assert.equal(model.stored, false)
  assert.equal(model.pending, undefined)
})

test('the toolbar after the settings switch flips the switch\'s request', () => {
  const model = overlayModel(true)
  model.toolbar()
  model.settingsSwitch()
  model.toolbar()
  assert.deepEqual(model.sent, [false, false, true])
  while (model.sent.length) model.answer()
  assert.equal(model.stored, true)
  assert.equal(model.pending, undefined)
})

test('a pending request clears only when the stored setting matches it', () => {
  assert.equal(settledPrompterLink(undefined, true), undefined)
  assert.equal(settledPrompterLink(false, true), false)
  assert.equal(settledPrompterLink(false, false), undefined)
  assert.equal(toggledPrompterLink(undefined, false), true)
  assert.equal(toggledPrompterLink(true, true), false)
})
