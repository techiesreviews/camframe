import test from 'node:test'
import assert from 'node:assert/strict'
import { sanitizeSettings, settingsForPreset } from '../src/settings.js'
import { SAVED_FLASH_MS, createScenesTabState, sceneButtonTarget } from '../src/scenes-tab-state.js'

const scene = (id, name, settings = {}) => ({ id, name, settings: settingsForPreset(settings) })
const stateWith = (scenes, extra = {}) => ({
  ...sanitizeSettings({ presets: scenes, ...extra }),
  activePresetId: extra.activePresetId ?? '',
  sceneUndo: extra.sceneUndo ?? null,
  sceneDeleted: extra.sceneDeleted ?? null,
  sceneSaved: extra.sceneSaved ?? null,
  scenePreviews: extra.scenePreviews ?? null,
})

// A bridge that records each call as `[method, ...args]`.
function recordingBridge(calls) {
  return new Proxy({}, { get: (_, method) => (...args) => calls.push([method, ...args]) })
}

// The Scenes tab state on a fake clock, with the two Scenes most tests start from. Each step also
// lists the bridge calls made while it was handled, as `requests`.
function tabWith(state = stateWith([scene('a', 'Intro'), scene('b', 'Talk')], { activePresetId: 'a' })) {
  let time = 1_000
  const clock = { now: () => time, advance: (ms) => (time += ms) }
  const calls = []
  const tabState = createScenesTabState({ camFrame: recordingBridge(calls), now: clock.now })
  const tab = {
    send(event) {
      calls.length = 0
      return { ...tabState.send(event), requests: [...calls] }
    },
  }
  const first = tab.send({ type: 'state', state })
  return { tab, clock, first }
}

// The browser QA preview's bridge answers at once: main's new state comes back while the click is
// still being handled. That state is drawn (and focused) in its own step; the click's own step then
// has nothing older to draw over it.
test('a state sent back while a request is made is drawn once, before the rest of the step', () => {
  const scenes = [scene('a', 'Intro'), scene('b', 'Talk')]
  const steps = []
  let tab
  const camFrame = {
    applyPreset(id) {
      const step = tab.send({ type: 'state', state: stateWith(scenes, { activePresetId: id }) })
      steps.push(step)
      if (step.focus) tab.send({ type: 'focused' })
    },
  }
  tab = createScenesTabState({ camFrame, now: () => 1_000 })
  tab.send({ type: 'state', state: stateWith(scenes, { activePresetId: 'a' }) })
  const click = tab.send({ type: 'apply', id: 'b' })
  assert.equal(steps.length, 1)
  assert.equal(steps[0].draw.model.items.find((item) => item.active).id, 'b')
  assert.equal(steps[0].focus, 'apply:b')
  assert.equal(click.draw, null, 'the click draws nothing over the newer state')
  assert.equal(click.focus, '')
})

test('the first state draws the tab; the same state again draws nothing', () => {
  const { tab, first } = tabWith()
  assert.ok(first.draw, 'drawn')
  assert.deepEqual(first.draw.model.items.map((item) => item.id), ['a', 'b'])
  assert.equal(first.focus, '')
  assert.equal(tab.send({ type: 'state', state: stateWith([scene('a', 'Intro'), scene('b', 'Talk')], { activePresetId: 'a' }) }).draw, null)
})

test('nothing is drawn before the first state', () => {
  const tab = createScenesTabState({ now: () => 0 })
  const step = tab.send({ type: 'save-open' })
  assert.equal(step.draw, null)
  assert.equal(step.wakeIn, undefined)
  assert.equal(tab.send({ type: 'undo' }).handled, false)
  assert.equal(tab.send({ type: 'escape' }).closeSettings, false, 'the save form opened above is cancelled')
  assert.equal(tab.send({ type: 'escape' }).closeSettings, true)
})

// Regression for 6862b5e: after Save look by keyboard, focus went to the Scene that was on camera
// before, not the one just saved, because savePreset is a one-way message in Electron.
test('after Save look, focus waits for main to save the Scene and then goes to it', () => {
  const before = stateWith([scene('a', 'Intro')], { activePresetId: 'a', sceneSaved: { id: 'a', at: 10 } })
  const { tab } = tabWith(before)
  tab.send({ type: 'save-open' })
  tab.send({ type: 'input', role: 'new-name', value: 'Close up' })
  const sent = tab.send({ type: 'save-ok' })
  assert.deepEqual(sent.requests, [['savePreset', 'Close up', '']])
  assert.equal(sent.focus, '', 'the Scene on camera before keeps no claim on focus')
  const saved = stateWith([scene('a', 'Intro'), scene('c', 'Close up')], { activePresetId: 'c', sceneSaved: { id: 'c', at: 20 } })
  const answer = tab.send({ type: 'state', state: saved })
  assert.equal(answer.focus, 'apply:c')
  tab.send({ type: 'focused' })
  assert.equal(tab.send({ type: 'state', state: saved }).draw, null, 'focus is not asked for again')
})

// Regression for 7c63315: an autosave or a Prompter link save arriving before main's answer also
// sets `sceneSaved`, and took the focus meant for the Scene being saved.
test('a different Scene saved in between does not take the focus meant for the sent name', () => {
  const before = stateWith([scene('a', 'Intro'), scene('b', 'Talk')], { activePresetId: 'a', sceneSaved: { id: 'a', at: 10 } })
  const { tab } = tabWith(before)
  tab.send({ type: 'save-open' })
  tab.send({ type: 'input', role: 'new-name', value: 'Close up' })
  tab.send({ type: 'save-ok' })
  const autosaved = stateWith([scene('a', 'Intro'), scene('b', 'Talk')], { activePresetId: 'b', sceneSaved: { id: 'b', at: 15 } })
  assert.equal(tab.send({ type: 'state', state: autosaved }).focus, '')
  const saved = stateWith([scene('a', 'Intro'), scene('b', 'Talk'), scene('c', 'Close up')], { activePresetId: 'c', sceneSaved: { id: 'c', at: 20 } })
  assert.equal(tab.send({ type: 'state', state: saved }).focus, 'apply:c')
})

test('Save look over a taken name says Replace and focuses the Scene it replaced', () => {
  const before = stateWith([scene('a', 'Intro'), scene('b', 'Talk')], { activePresetId: 'b', sceneSaved: { id: 'b', at: 10 } })
  const { tab } = tabWith(before)
  tab.send({ type: 'save-open' })
  const typed = tab.send({ type: 'input', role: 'new-name', value: 'intro' })
  assert.equal(typed.saveButton.replace, 'Intro')
  tab.send({ type: 'save-ok' })
  const replaced = stateWith([scene('a', 'intro'), scene('b', 'Talk')], { activePresetId: 'a', sceneSaved: { id: 'a', at: 20 } })
  assert.equal(tab.send({ type: 'state', state: replaced }).focus, 'apply:a')
})

// Regression for 6862b5e: each key in the name field redrew the tab, swapping the field, which
// cancelled input-method composition and made screen readers read the field again.
test('typing a Scene name updates only the save button and never redraws the field', () => {
  const { tab } = tabWith()
  const opened = tab.send({ type: 'save-open' })
  assert.ok(opened.draw)
  assert.equal(opened.focus, 'new-name')
  tab.send({ type: 'focused' })
  const typed = tab.send({ type: 'input', role: 'new-name', value: 'Ou' })
  assert.equal(typed.draw, null)
  assert.deepEqual({ slot: typed.saveButton.slot, saveName: typed.saveButton.saveName, replace: typed.saveButton.replace }, { slot: 3, saveName: 'Ou', replace: '' })
  const state = stateWith([scene('a', 'Intro'), scene('b', 'Talk')], { activePresetId: 'a' })
  assert.equal(tab.send({ type: 'state', state }).draw, null, 'the typed name is not part of what is drawn')
  assert.equal(tab.send({ type: 'save-ok' }).requests[0][1], 'Ou')
})

// Regression for 6862b5e and 7c63315: a redraw while an input method composes cancels the
// composition, also when main's state changes meanwhile.
test('while an input method composes, nothing is drawn; the waiting draw comes at the end', () => {
  const { tab } = tabWith()
  tab.send({ type: 'save-open' })
  tab.send({ type: 'focused' })
  tab.send({ type: 'compositionstart' })
  const moved = stateWith([scene('a', 'Intro'), scene('b', 'Talk')], { activePresetId: 'b' })
  assert.equal(tab.send({ type: 'state', state: moved }).draw, null)
  const ended = tab.send({ type: 'compositionend' })
  assert.ok(ended.draw)
  assert.equal(ended.draw.model.items[1].active, true)
  assert.equal(tab.send({ type: 'compositionstart' }).draw, null)
  assert.equal(tab.send({ type: 'compositionend' }).draw, null, 'no draw was waiting')
})

// Regression for 7c63315: Escape while composing closed the save form (and the settings).
test('keys while an input method composes stay in the field, Escape and Enter too', () => {
  const { tab } = tabWith()
  tab.send({ type: 'save-open' })
  tab.send({ type: 'input', role: 'new-name', value: 'Ou' })
  for (const key of ['Escape', 'Enter']) {
    const step = tab.send({ type: 'keydown', key, role: 'new-name', isComposing: true })
    assert.equal(step.stopPropagation, true, key)
    assert.equal(step.preventDefault, false, key)
    assert.deepEqual(step.requests, [], key)
    assert.equal(step.draw, null, key)
  }
  const escaped = tab.send({ type: 'keydown', key: 'Escape', role: 'new-name' })
  assert.equal(escaped.stopPropagation, true)
  assert.equal(escaped.draw.model.add.saving, false, 'Escape after the composition cancels the form')
  assert.equal(escaped.focus, 'save-open')
})

test('Enter in the name field saves', () => {
  const { tab } = tabWith()
  tab.send({ type: 'save-open' })
  tab.send({ type: 'input', role: 'new-name', value: '  Outro ' })
  const step = tab.send({ type: 'keydown', key: 'Enter', role: 'new-name' })
  assert.equal(step.preventDefault, true)
  assert.deepEqual(step.requests, [['savePreset', 'Outro', '']])
  assert.equal(step.draw.model.add.saving, false)
})

test('an empty name saves nothing', () => {
  const { tab } = tabWith()
  tab.send({ type: 'save-open' })
  tab.send({ type: 'input', role: 'new-name', value: '   ' })
  assert.deepEqual(tab.send({ type: 'save-ok' }).requests, [])
})

test('rename: the field opens focused and selected, Enter sends the new name, focus goes back', () => {
  const { tab } = tabWith()
  const opened = tab.send({ type: 'rename', id: 'b' })
  assert.equal(opened.draw.model.items[1].editing, true)
  assert.equal(opened.focus, 'rename:b')
  assert.equal(opened.select, 'rename:b')
  assert.equal(opened.draw.renameValue, 'Talk')
  tab.send({ type: 'focused' })
  tab.send({ type: 'input', role: 'rename', value: 'Talking head' })
  const done = tab.send({ type: 'keydown', key: 'Enter', role: 'rename', id: 'b' })
  assert.deepEqual(done.requests, [['renamePreset', 'b', 'Talking head']])
  assert.equal(done.draw.model.items[1].editing, false)
  assert.equal(done.focus, 'apply:b')
})

test('rename to a taken name marks the field and sends nothing; typing clears the mark', () => {
  const { tab } = tabWith()
  tab.send({ type: 'rename', id: 'b' })
  tab.send({ type: 'focused' })
  tab.send({ type: 'input', role: 'rename', value: 'intro' })
  const refused = tab.send({ type: 'rename-ok', id: 'b' })
  assert.deepEqual(refused.requests, [])
  assert.deepEqual(refused.announce, ['That name is already used'])
  assert.equal(refused.draw.renameInvalid, true)
  assert.ok(refused.draw, 'the field is drawn again with its mark')
  const typed = tab.send({ type: 'input', role: 'rename', value: 'intro 2' })
  assert.equal(typed.draw.renameInvalid, false)
  assert.ok(typed.draw)
  assert.equal(tab.send({ type: 'input', role: 'rename', value: 'intro 22' }).draw, null, 'no mark, no draw')
})

test('rename with the same or an empty name sends nothing and closes the field', () => {
  const { tab } = tabWith()
  tab.send({ type: 'rename', id: 'a' })
  const same = tab.send({ type: 'rename-ok', id: 'a' })
  assert.deepEqual(same.requests, [])
  assert.equal(same.draw.model.items[0].editing, false)
  tab.send({ type: 'rename', id: 'a' })
  tab.send({ type: 'input', role: 'rename', value: '  ' })
  assert.deepEqual(tab.send({ type: 'rename-ok', id: 'a' }).requests, [])
})

test('Escape cancels a rename (focus back on the Scene), else closes the settings', () => {
  const { tab } = tabWith()
  tab.send({ type: 'rename', id: 'b' })
  const cancelled = tab.send({ type: 'escape' })
  assert.equal(cancelled.closeSettings, false)
  assert.equal(cancelled.focus, 'apply:b')
  assert.equal(cancelled.draw.model.items[1].editing, false)
  const closed = tab.send({ type: 'escape' })
  assert.equal(closed.closeSettings, true)
  assert.deepEqual(closed.requests, [])
})

test('Escape in the rename field cancels it there and stays in the tab', () => {
  const { tab } = tabWith()
  tab.send({ type: 'rename', id: 'b' })
  const step = tab.send({ type: 'keydown', key: 'Escape', role: 'rename', id: 'b' })
  assert.equal(step.preventDefault, true)
  assert.equal(step.stopPropagation, true, 'the Overlay does not also close the settings')
  assert.equal(step.focus, 'apply:b')
  assert.equal(step.draw.model.items[1].editing, false)
  assert.deepEqual(step.requests, [])
})

// ADR 0037: the settings stay open while Scenes are applied, saved, renamed, deleted and restored.
test('no Scene request closes the settings', () => {
  const deleted = { id: 'c', name: 'Old', index: 2, endsAt: 7_000 }
  const { tab } = tabWith(stateWith([scene('a', 'Intro'), scene('b', 'Talk')], { activePresetId: 'a', sceneDeleted: deleted }))
  const steps = [tab.send({ type: 'apply', id: 'b' })]
  tab.send({ type: 'save-open' })
  tab.send({ type: 'input', role: 'new-name', value: 'New' })
  steps.push(tab.send({ type: 'save-ok' }))
  tab.send({ type: 'rename', id: 'a' })
  tab.send({ type: 'input', role: 'rename', value: 'Opening' })
  steps.push(tab.send({ type: 'rename-ok', id: 'a' }), tab.send({ type: 'undo-delete' }), tab.send({ type: 'delete', id: 'b' }))
  assert.deepEqual(steps.map((step) => step.requests[0][0]), ['applyPreset', 'savePreset', 'renamePreset', 'undoPresetDelete', 'deletePreset'])
  for (const step of steps) assert.equal(step.closeSettings, false, step.requests[0][0])
})

test('an inner event that throws gives the outer event its own step back', () => {
  let tab
  const camFrame = {
    reorderPreset() {
      try {
        tab.send({ type: 'state', state: null })
      } catch {
        // The bridge swallows it; the key that asked for the move still has to be handled.
      }
    },
  }
  tab = createScenesTabState({ camFrame, now: () => 1_000 })
  tab.send({ type: 'state', state: stateWith([scene('a', 'Intro'), scene('b', 'Talk')], { activePresetId: 'a' }) })
  const step = tab.send({ type: 'keydown', key: 'ArrowUp', altKey: true, role: 'scene', id: 'b' })
  assert.equal(step.preventDefault, true)
})

test('a bridge call that throws leaves the next step whole', () => {
  const scenes = [scene('a', 'Intro'), scene('b', 'Talk')]
  let tab
  const camFrame = {
    applyPreset(id) {
      tab.send({ type: 'state', state: stateWith(scenes, { activePresetId: id }) })
      throw new Error('bad argument')
    },
  }
  tab = createScenesTabState({ camFrame, now: () => 1_000 })
  tab.send({ type: 'state', state: stateWith(scenes, { activePresetId: 'a' }) })
  assert.throws(() => tab.send({ type: 'apply', id: 'b' }), /bad argument/)
  const next = tab.send({ type: 'state', state: stateWith([...scenes, scene('c', 'New')], { activePresetId: 'b' }) })
  assert.ok(next.draw, 'the next state draws in its own step')
  assert.equal(next.draw.model.items.length, 3)
})

test('a rename open on a Scene that main deleted closes', () => {
  const { tab } = tabWith()
  tab.send({ type: 'rename', id: 'b' })
  const step = tab.send({ type: 'state', state: stateWith([scene('a', 'Intro')], { activePresetId: 'a' }) })
  assert.deepEqual(step.draw.model.items.map((item) => item.editing), [false])
  assert.equal(tab.send({ type: 'escape' }).closeSettings, true, 'nothing left to cancel')
})

test('applying a Scene closes a form, asks main, and keeps focus on that Scene', () => {
  const { tab } = tabWith()
  tab.send({ type: 'save-open' })
  const step = tab.send({ type: 'apply', id: 'b' })
  assert.deepEqual(step.requests, [['applyPreset', 'b']])
  assert.equal(step.draw.model.add.saving, false)
  assert.equal(step.focus, 'apply:b')
})

test('the view switch asks main and keeps focus on the pressed button once it is drawn', () => {
  const { tab } = tabWith()
  const step = tab.send({ type: 'view', view: 'list' })
  assert.deepEqual(step.requests, [['updateState', { sceneView: 'list' }]])
  assert.equal(step.draw, null, 'main answers with the new view')
  const drawn = tab.send({ type: 'state', state: stateWith([scene('a', 'Intro'), scene('b', 'Talk')], { activePresetId: 'a', sceneView: 'list' }) })
  assert.equal(drawn.draw.model.view, 'list')
  assert.equal(drawn.focus, 'view:list')
})

test('a delete is announced, and focus moves to its Undo once main shows it', () => {
  const { tab, clock } = tabWith()
  const step = tab.send({ type: 'delete', id: 'b' })
  assert.deepEqual(step.requests, [['deletePreset', 'b']])
  assert.deepEqual(step.announce, ['Talk deleted'])
  const deleted = stateWith([scene('a', 'Intro')], { activePresetId: 'a', sceneDeleted: { id: 'b', name: 'Talk', index: 1, endsAt: clock.now() + 6000 } })
  const shown = tab.send({ type: 'state', state: deleted })
  assert.equal(shown.focus, 'undo-delete')
  assert.equal(shown.wakeIn, 6016, 'drawn again when the Undo window closes')
  assert.deepEqual(tab.send({ type: 'delete', id: 'gone' }).requests, [], 'an unknown Scene is not deleted')
})

test('Ctrl+Z undoes the last delete first, then the active Scene changes, else is not handled', () => {
  const { tab, clock } = tabWith()
  const end = clock.now() + 6000
  tab.send({ type: 'state', state: stateWith([scene('a', 'Intro')], { activePresetId: 'a', sceneDeleted: { id: 'b', name: 'Talk', index: 1, endsAt: end }, sceneUndo: { id: 'a', endsAt: end } }) })
  const first = tab.send({ type: 'undo' })
  assert.equal(first.handled, true)
  assert.deepEqual(first.requests, [['undoPresetDelete']])
  tab.send({ type: 'state', state: stateWith([scene('a', 'Intro'), scene('b', 'Talk')], { activePresetId: 'a', sceneUndo: { id: 'a', endsAt: end } }) })
  const second = tab.send({ type: 'undo' })
  assert.deepEqual(second.requests, [['undoPresetChange']])
  clock.advance(6000)
  const none = tab.send({ type: 'undo' })
  assert.equal(none.handled, false, 'the Undo window has closed')
  assert.deepEqual(none.requests, [])
})

test('Undo for changes only works for the Scene on camera', () => {
  const { tab, clock } = tabWith()
  tab.send({ type: 'state', state: stateWith([scene('a', 'Intro'), scene('b', 'Talk')], { activePresetId: 'b', sceneUndo: { id: 'a', endsAt: clock.now() + 9000 } }) })
  assert.equal(tab.send({ type: 'undo-change' }).handled, false)
})

test('a Scene saved by main shows its saved check for a moment, not on the first state', () => {
  const start = stateWith([scene('a', 'Intro')], { activePresetId: 'a', sceneSaved: { id: 'a', at: 5 } })
  const { tab, clock, first } = tabWith(start)
  assert.equal(first.draw.model.items[0].saved, false)
  const saved = tab.send({ type: 'state', state: stateWith([scene('a', 'Intro')], { activePresetId: 'a', sceneSaved: { id: 'a', at: 6 } }) })
  assert.equal(saved.draw.model.items[0].saved, true)
  assert.equal(saved.wakeIn, SAVED_FLASH_MS + 16)
  clock.advance(SAVED_FLASH_MS + 16)
  const cleared = tab.send({ type: 'tick' })
  assert.equal(cleared.draw.model.items[0].saved, false)
  assert.equal(cleared.wakeIn, null)
})

test('a focus wish lapses after a short while when its control never shows', () => {
  const { tab, clock } = tabWith()
  tab.send({ type: 'delete', id: 'b' })
  clock.advance(1600)
  const late = stateWith([scene('a', 'Intro')], { activePresetId: 'a', sceneDeleted: { id: 'b', name: 'Talk', index: 1, endsAt: clock.now() + 6000 } })
  assert.equal(tab.send({ type: 'state', state: late }).focus, '')
})

test('a pending focus draws again on each state until its control shows', () => {
  const { tab } = tabWith()
  tab.send({ type: 'delete', id: 'b' })
  const same = stateWith([scene('a', 'Intro'), scene('b', 'Talk')], { activePresetId: 'a' })
  const step = tab.send({ type: 'state', state: same })
  assert.ok(step.draw, 'drawn again although nothing changed')
  assert.equal(step.focus, 'undo-delete')
})

test('leaving the tab drops a rename or a save in progress and draws it fresh', () => {
  const { tab } = tabWith()
  tab.send({ type: 'save-open' })
  tab.send({ type: 'focused' })
  const step = tab.send({ type: 'reset' })
  assert.equal(step.draw.model.add.saving, false)
  assert.ok(tab.send({ type: 'reset' }).draw, 'a reset always draws')
})

test('Import and Export show their result on the button for a moment and announce it', () => {
  const { tab, clock } = tabWith()
  assert.equal(tab.send({ type: 'import' }).file, 'import')
  const imported = tab.send({ type: 'file-result', act: 'import', result: { count: 2 } })
  assert.deepEqual(imported.draw.files, { import: { kind: 'ok', text: 'Imported 2', until: clock.now() + 2400 } })
  assert.deepEqual(imported.announce, ['Imported 2'])
  const failed = tab.send({ type: 'file-result', act: 'export', result: { error: 'Disk full' } })
  assert.equal(failed.draw.files.export.text, 'Not exported')
  assert.equal(failed.draw.files.export.title, 'Disk full')
  assert.deepEqual(failed.announce, ['Disk full'])
  const cancelled = tab.send({ type: 'file-result', act: 'import', result: { canceled: true } })
  assert.equal(cancelled.draw, null)
  clock.advance(2400)
  assert.deepEqual(tab.send({ type: 'tick' }).draw.files, {})
})

test('keys on a Scene: F2 renames, Delete deletes, Alt+arrows move it one place', () => {
  const { tab } = tabWith()
  assert.equal(tab.send({ type: 'keydown', key: 'F2', role: 'scene', id: 'a' }).focus, 'rename:a')
  tab.send({ type: 'escape' })
  assert.deepEqual(tab.send({ type: 'keydown', key: 'Delete', role: 'scene', id: 'a' }).requests, [['deletePreset', 'a']])
  for (const [key, offset] of [['ArrowUp', -1], ['ArrowLeft', -1], ['ArrowDown', 1], ['ArrowRight', 1]]) {
    const step = tab.send({ type: 'keydown', key, role: 'scene', id: 'b', altKey: true })
    assert.deepEqual(step.requests, [['reorderPreset', 'b', offset]], key)
    assert.equal(step.preventDefault, true, key)
  }
  const nav = tab.send({ type: 'keydown', key: 'ArrowDown', role: 'scene', id: 'a' })
  assert.equal(nav.navigate, 'ArrowDown')
  assert.deepEqual(nav.requests, [])
  assert.equal(tab.send({ type: 'keydown', key: 'x', role: 'scene', id: 'a' }).navigate, '')
})

test('arrow keys move between Scenes: a line in the list, the nearest Scene above or below in the grid', () => {
  const list = Array.from({ length: 3 }, () => ({}))
  assert.equal(sceneButtonTarget({ key: 'ArrowDown', index: 0, rects: list, grid: false }), 1)
  assert.equal(sceneButtonTarget({ key: 'ArrowUp', index: 0, rects: list, grid: false }), 0, 'held at the first')
  assert.equal(sceneButtonTarget({ key: 'ArrowRight', index: 0, rects: list, grid: false }), undefined)
  assert.equal(sceneButtonTarget({ key: 'End', index: 0, rects: list, grid: false }), 2)
  assert.equal(sceneButtonTarget({ key: 'Home', index: 2, rects: list, grid: false }), 0)
  // A grid of two columns; the second row starts with a wide tile (a rename) under both.
  const tile = (left, top, width = 100) => ({ left, top, width, bottom: top + 80 })
  const rects = [tile(0, 0), tile(110, 0), tile(0, 90, 210), tile(110, 180)]
  assert.equal(sceneButtonTarget({ key: 'ArrowDown', index: 1, rects, grid: true }), 2, 'the wide tile below')
  assert.equal(sceneButtonTarget({ key: 'ArrowDown', index: 2, rects, grid: true }), 3)
  assert.equal(sceneButtonTarget({ key: 'ArrowUp', index: 3, rects, grid: true }), 2)
  assert.equal(sceneButtonTarget({ key: 'ArrowUp', index: 0, rects, grid: true }), undefined, 'nothing above')
  assert.equal(sceneButtonTarget({ key: 'ArrowLeft', index: 0, rects, grid: true }), 0, 'held at the first')
  assert.equal(sceneButtonTarget({ key: 'ArrowRight', index: 1, rects, grid: true }), 2)
})

test('dragging a Scene onto another moves it there', () => {
  const state = stateWith([scene('a', 'A'), scene('b', 'B'), scene('c', 'C')])
  const { tab } = tabWith(state)
  assert.equal(tab.send({ type: 'dragover', id: 'b' }).preventDefault, false, 'no drag started')
  assert.deepEqual(tab.send({ type: 'drop', id: 'b' }).requests, [])
  tab.send({ type: 'dragstart', id: 'a' })
  const over = tab.send({ type: 'dragover', id: 'c' })
  assert.equal(over.preventDefault, true)
  assert.equal(over.highlight, true)
  assert.equal(tab.send({ type: 'dragover', id: 'a' }).highlight, false, 'not on itself')
  assert.deepEqual(tab.send({ type: 'drop', id: 'c' }).requests, [['reorderPreset', 'a', 2]])
  assert.deepEqual(tab.send({ type: 'drop', id: 'c' }).requests, [], 'the drag ended with the drop')
  tab.send({ type: 'dragstart', id: 'b' })
  assert.deepEqual(tab.send({ type: 'drop', id: 'b' }).requests, [], 'dropped on itself')
  tab.send({ type: 'dragstart', id: 'b' })
  tab.send({ type: 'dragend' })
  assert.equal(tab.send({ type: 'dragover', id: 'c' }).preventDefault, false)
})
