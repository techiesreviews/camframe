import test from 'node:test'
import assert from 'node:assert/strict'
import { sanitizeSettings, settingsForPreset } from '../src/settings.js'
import { placeLabel, sceneDescription, scenesPanelModel, tileCamera } from '../src/scenes-panel.js'

const scene = (id, name, settings = {}) => ({ id, name, settings: settingsForPreset(settings) })
const rect = (x, y, width = 0.15, height = 0.27) => ({ x, y, width, height })
const stateWith = (scenes, extra = {}) => ({
  ...sanitizeSettings({ presets: scenes, ...extra }),
  activePresetId: extra.activePresetId ?? '',
  sceneUndo: extra.sceneUndo ?? null,
  sceneDeleted: extra.sceneDeleted ?? null,
  sceneSaved: extra.sceneSaved ?? null,
  scenePreviews: extra.scenePreviews ?? null,
})
const ui = (extra = {}) => ({ editingId: '', saving: false, saveName: '', flash: null, ...extra })

test('a place is named from where the camera sits on its display', () => {
  assert.equal(placeLabel(rect(0.8, 0.7)), 'Bottom right')
  assert.equal(placeLabel(rect(0.7, 0.35, 0.28, 0.5)), 'Right')
  assert.equal(placeLabel(rect(0.02, 0.03)), 'Top left')
  assert.equal(placeLabel(rect(0.42, 0.36)), 'Center')
  assert.equal(placeLabel(rect(0.42, 0.7)), 'Bottom')
  assert.equal(placeLabel(undefined), '')
})

test('a Scene is described by shape, size (its longest edge), place and frame', () => {
  const look = settingsForPreset({ shape: 'portrait', size: 420, frameEffect: 'glow', borderWidth: 3 })
  assert.deepEqual(sceneDescription(look, rect(0.8, 0.6)), {
    short: 'Portrait · 420 · Bottom right · Glow · Border',
    spoken: 'Portrait, size 420, bottom right, glow, border',
  })
  assert.deepEqual(sceneDescription(settingsForPreset({ size: 288 }), undefined), {
    short: 'Circle · 288',
    spoken: 'Circle, size 288',
  })
})

test('a tile draws the camera at its real place, size, shape, and glow or border', () => {
  const glow = tileCamera(settingsForPreset({ shape: 'landscape', size: 400, frameEffect: 'glow', effectColor: '#22d3ee' }), rect(0.5, 0.25, 0.2, 0.2))
  assert.equal(glow.left, '50%')
  assert.equal(glow.top, '25%')
  assert.equal(glow.width, '20%')
  assert.equal(glow.aspectRatio, '400 / 225')
  assert.match(glow.boxShadow, /#22d3ee/)
  const border = tileCamera(settingsForPreset({ shape: 'circle', size: 288, borderWidth: 6, borderColor: '#ffffff' }), rect(0, 0))
  assert.equal(border.borderRadius, '50%')
  assert.match(border.boxShadow, /#ffffff/)
  assert.equal(tileCamera(settingsForPreset({}), rect(0, 0)).boxShadow, 'none')
})

test('no Scenes: one slot that saves the live look as scene 1', () => {
  const model = scenesPanelModel(stateWith([]), ui(), 0)
  assert.deepEqual(model.items, [])
  assert.equal(model.add.kind, 'empty')
  assert.equal(model.add.slot, 1)
  assert.equal(model.add.label, 'Save the live look as scene 1')
  assert.equal(model.canExport, false)
})

test('later slots save the live look as the next number; six Scenes make the slot Full', () => {
  const two = scenesPanelModel(stateWith([scene('a', 'A'), scene('b', 'B')]), ui(), 0)
  assert.deepEqual({ kind: two.add.kind, slot: two.add.slot, label: two.add.label }, { kind: 'save', slot: 3, label: 'Save look' })
  const six = scenesPanelModel(stateWith(Array.from({ length: 6 }, (_, index) => scene(`s${index}`, `S${index}`))), ui(), 0)
  assert.equal(six.add.kind, 'full')
  assert.equal(six.add.label, 'Full')
})

test('the active Scene shows its saved check, and Undo while its window is open', () => {
  const state = stateWith([scene('a', 'A'), scene('b', 'B')], {
    activePresetId: 'b',
    sceneUndo: { id: 'b', endsAt: 10_000 },
  })
  const model = scenesPanelModel(state, ui({ flash: { id: 'b', until: 1800 } }), 1000)
  const [first, second] = model.items
  assert.deepEqual([first.slot, second.slot], [1, 2])
  assert.equal(first.active, false)
  assert.equal(second.active, true)
  assert.equal(second.saved, true)
  assert.deepEqual(second.undo, { endsAt: 10_000 })
  assert.match(second.label, /^B, scene 2, .*on camera, saved$/)
  assert.equal(scenesPanelModel(state, ui(), 10_001).items[1].undo, null, 'Undo lives 10 seconds')
  assert.equal(scenesPanelModel(state, ui({ flash: { id: 'b', until: 1800 } }), 2000).items[1].saved, false)
})

test('a deleted Scene keeps its place with Undo for 6 seconds and frees its number', () => {
  const state = stateWith([scene('a', 'A'), scene('c', 'C')], {
    sceneDeleted: { id: 'b', name: 'B', index: 1, endsAt: 6000 },
  })
  const model = scenesPanelModel(state, ui(), 1000)
  assert.deepEqual(model.items.map((item) => [item.kind, item.id, item.slot ?? null]), [
    ['scene', 'a', 1],
    ['deleted', 'b', null],
    ['scene', 'c', 2],
  ])
  assert.equal(scenesPanelModel(state, ui(), 6001).items.length, 2)
})

test('a layout Scene draws the live look; an exact Scene its own', () => {
  const layout = { id: 'big', name: 'Big right', settings: settingsForPreset({}), layout: { size: 540, position: 'right' } }
  const exact = scene('mine', 'Mine', { shape: 'rounded', size: 300, frameEffect: 'glow' })
  const state = stateWith([layout, exact], {
    shape: 'portrait',
    scenePreviews: { live: rect(0.8, 0.6), scenes: { big: rect(0.7, 0.3, 0.28, 0.5), mine: rect(0.1, 0.1) } },
  })
  const [big, mine] = scenesPanelModel(state, ui(), 0).items
  assert.match(big.description.short, /^Portrait · 540 · Right/)
  assert.match(mine.description.short, /^Rounded · 300 · Top left · Glow/)
  const model = scenesPanelModel(state, ui(), 0)
  assert.match(model.live.description.short, /^Portrait · 288 · Bottom right/)
})

test('the save form says Replace when the name is taken', () => {
  const state = stateWith([scene('a', 'Intro')])
  assert.equal(scenesPanelModel(state, ui({ saving: true, saveName: 'intro' }), 0).add.replace, 'Intro')
  assert.equal(scenesPanelModel(state, ui({ saving: true, saveName: 'Outro' }), 0).add.replace, '')
})
