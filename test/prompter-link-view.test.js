import test from 'node:test'
import assert from 'node:assert/strict'
import { prompterLinkView } from '../src/prompter-link-view.js'

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

test('only a stored true turns the view on', () => {
  for (const prompterLink of [undefined, 'true', 1]) assert.equal(prompterLinkView({ prompterLink }).on, false)
  assert.equal(prompterLinkView().state, 'off')
})
