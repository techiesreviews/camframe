import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { OVERLAY_CHROME, SCENE_LIMIT, overlayDimensionsFor, sanitizeSettings, settingsForPreset } from '../src/settings.js'
import {
  NO_SCENES_NOTICE,
  applyScene,
  applySceneAt,
  cycleScene,
  deleteScene,
  importScenes,
  layoutSceneGeometry,
  patchSettings,
  reorderScene,
  saveScene,
  sceneExport,
  SCENE_DELETE_UNDO_MS,
  SCENE_UNDO_MS,
  createSceneEdits,
  followLiveLook,
  renameScene,
  restoreScene,
  scenePreviews,
  undoSceneChange,
} from '../src/scenes.js'

const scene = (id, name, settings = {}) => ({ id, name, settings: settingsForPreset(settings) })
const library = (scenes = [], settings = {}, activeSceneId = '') => ({
  settings: sanitizeSettings({ ...settings, presets: scenes }),
  activeSceneId,
})
const ids = (state) => state.settings.presets.map(({ id }) => id)

for (const entry of JSON.parse(
  readFileSync(join(import.meta.dirname, 'fixtures', 'preferences', 'scene-import.json'), 'utf8'),
).cases) {
  test(`Scene import contract: ${entry.name}`, () => {
    const text = Object.hasOwn(entry, 'payloadText') ? entry.payloadText : JSON.stringify(entry.payload)
    const result = importScenes(library(entry.existing), text)
    assert.deepEqual(
      result.error ? { error: result.error } : { scenes: result.settings.presets, importedCount: result.importedCount },
      entry.expected,
    )
  })
}

test('saving a new Scene snapshots reusable settings and the live compact position', () => {
  const state = library([], { size: 320, shape: 'rounded', position: { x: 10, y: 20 }, alwaysOnTop: false })
  const result = saveScene(state, {
    name: '  Desk  ',
    liveBounds: { x: 420, y: 260, width: 356, height: 422 },
    createId: () => 'scene-new',
  })

  assert.equal(result.activeSceneId, 'scene-new')
  assert.equal(result.notice, undefined, 'saving a Scene draws nothing on the camera')
  assert.equal(result.announce, 'Desk', 'screen readers get the name')
  assert.deepEqual(result.settings.position, { x: 420, y: 260 })
  assert.deepEqual(result.settings.presets, [
    scene('scene-new', 'Desk', { size: 320, shape: 'rounded', position: { x: 420, y: 260 } }),
  ])
  assert.equal(Object.hasOwn(result.settings.presets[0].settings, 'alwaysOnTop'), false)
})

test('saving from Full screen keeps the stored compact position', () => {
  const state = library([], { position: { x: 10, y: 20 } })
  const result = saveScene(state, {
    name: 'Talk',
    liveBounds: { x: 0, y: 0, width: 1920, height: 1080 },
    fullscreen: true,
    createId: () => 'talk',
  })

  assert.deepEqual(result.settings.presets[0].settings.position, { x: 10, y: 20 })
})

test('saving beyond the Scene limit drops the oldest Scene', () => {
  const full = Array.from({ length: SCENE_LIMIT }, (_, index) => scene(`s${index}`, `Scene ${index}`))
  const result = saveScene(library(full), { name: 'Newest', createId: () => 'newest' })

  assert.deepEqual(ids(result), ['s1', 's2', 's3', 's4', 's5', 'newest'])
})

test('saving a matching name or the selected id updates that Scene in place', () => {
  const state = library([scene('desk', 'Desk', { size: 240 }), scene('wide', 'Wide')], { size: 400 })

  const byName = saveScene(state, { name: 'DESK', createId: () => 'unused' })
  assert.deepEqual(ids(byName), ['desk', 'wide'])
  assert.equal(byName.settings.presets[0].name, 'DESK')
  assert.equal(byName.settings.presets[0].settings.size, 400)

  const byId = saveScene(state, { name: 'Renamed', id: 'wide', createId: () => 'unused' })
  assert.deepEqual(ids(byId), ['desk', 'wide'])
  assert.equal(byId.settings.presets[1].name, 'Renamed')
})

test('saving over a layout Scene from Inline settings turns it into a snapshot Scene', () => {
  const large = {
    id: 'large',
    name: 'Live right large',
    settings: settingsForPreset({ size: 432, shape: 'circle', borderWidth: 4, position: { x: 1438, y: 220 } }),
    layout: { size: 432, position: 'right', withinRight: 0.3 },
  }
  const state = library([large], { size: 300, shape: 'circle', borderWidth: 9, position: { x: 50, y: 60 } })
  assert.ok(state.settings.presets[0].layout, 'the library keeps the layout')

  const saved = saveScene(state, { name: 'Live right large', createId: () => 'unused' })
  const scene = saved.settings.presets[0]
  assert.equal(scene.id, 'large')
  assert.equal(scene.layout, undefined)
  assert.equal(scene.settings.borderWidth, 9)

  // Applying it now brings back the look and geometry it saved, not the live ones.
  const changed = { settings: sanitizeSettings({ ...saved.settings, borderWidth: 2, size: 250 }), activeSceneId: '' }
  const applied = applyScene(changed, 'large', { workArea: { x: 0, y: 0, width: 1920, height: 1040 } })
  assert.equal(applied.settings.borderWidth, 9)
  assert.equal(applied.settings.size, 300)
  assert.deepEqual(applied.settings.position, { x: 50, y: 60 })
})

test('the tray and shortcut paths apply a layout Scene like a cue: planned on the work area, live look kept', () => {
  const large = {
    id: 'large',
    name: 'Live right large',
    settings: settingsForPreset({ size: 432, shape: 'circle', borderWidth: 4, position: { x: 1438, y: 220 } }),
    layout: { size: 432, position: 'right', withinRight: 0.3 },
  }
  const state = library([large], {
    size: 288,
    shape: 'circle',
    borderWidth: 9,
    frameEffect: 'glow',
    cameraZoom: 140,
    position: { x: 50, y: 60 },
  })
  const workArea = { x: 0, y: 0, width: 1280, height: 680 }
  const expected = layoutSceneGeometry(state.settings.presets[0], state.settings, { workArea })
  for (const [path, result] of [
    ['cycle', cycleScene(state, { workArea })],
    ['numbered shortcut', applySceneAt(state, 0, { workArea })],
  ]) {
    assert.equal(result.activeSceneId, 'large', path)
    assert.equal(result.settings.size, expected.size, path)
    assert.deepEqual(result.settings.position, expected.position, path)
    // The live look stays, not the look the Scene record holds.
    assert.equal(result.settings.borderWidth, 9, path)
    assert.equal(result.settings.frameEffect, 'glow', path)
    assert.equal(result.settings.cameraZoom, 140, path)
  }
  // On this narrow display the large Scene shrinks into the right 30%.
  assert.equal(expected.clamped, true)
  assert.ok(expected.position.x + OVERLAY_CHROME.left >= 1280 * 0.7)
})

test('saving ignores blank names and truncates long ones', () => {
  assert.equal(saveScene(library(), { name: '   ' }), undefined)
  assert.equal(saveScene(library(), { name: undefined }), undefined)
  const result = saveScene(library(), { name: 'n'.repeat(60), createId: () => 'long' })
  assert.equal(result.settings.presets[0].name.length, 40)
})

test('applying a Scene restores its settings without touching global preferences', () => {
  const desk = scene('desk', 'Desk', { size: 420, shape: 'landscape', position: { x: 5, y: 6 } })
  const state = library([desk], { alwaysOnTop: false, sceneView: 'list', completedOnboardingVersion: 1 })
  const result = applyScene(state, 'desk')

  assert.equal(result.activeSceneId, 'desk')
  assert.equal(result.notice, undefined, 'applying a Scene draws nothing on the camera')
  assert.equal(result.announce, 'Desk', 'screen readers get the name')
  assert.equal(result.appliedScene, state.settings.presets[0])
  assert.equal(result.settings.size, 420)
  assert.equal(result.settings.shape, 'landscape')
  assert.deepEqual(result.settings.position, { x: 5, y: 6 })
  assert.equal(result.settings.alwaysOnTop, false)
  assert.equal(result.settings.sceneView, 'list')
  assert.equal(result.settings.completedOnboardingVersion, 1)
  assert.deepEqual(result.settings.presets, state.settings.presets)
  assert.equal(applyScene(state, 'missing'), undefined)
})

test('numbered shortcuts apply Scenes by position', () => {
  const state = library([scene('one', 'One'), scene('two', 'Two')])
  assert.equal(applySceneAt(state, 1).activeSceneId, 'two')
  assert.equal(applySceneAt(state, 5), undefined)
})

test('cycling starts at the first Scene, wraps, and reports an empty library', () => {
  const scenes = [scene('one', 'One'), scene('two', 'Two')]
  assert.equal(cycleScene(library(scenes)).activeSceneId, 'one')
  assert.equal(cycleScene(library(scenes, {}, 'one')).activeSceneId, 'two')
  assert.equal(cycleScene(library(scenes, {}, 'two')).activeSceneId, 'one')
  assert.deepEqual(cycleScene(library()), { notice: NO_SCENES_NOTICE })
  assert.equal(cycleScene(library(scenes)).notice, undefined, 'the cycle shortcut draws no name')
  assert.equal(applySceneAt(library(scenes), 0).notice, undefined, 'a numbered shortcut draws no name')
})

test('deleting the active Scene clears it; deleting another keeps it', () => {
  const state = library([scene('one', 'One'), scene('two', 'Two')], {}, 'one')
  const deletedActive = deleteScene(state, 'one')
  assert.deepEqual(ids(deletedActive), ['two'])
  assert.equal(deletedActive.activeSceneId, '')
  // No notice on the camera: the Scenes tab shows Undo on the deleted Scene's place instead.
  assert.equal(deletedActive.notice, undefined)
  assert.deepEqual(deletedActive.deleted, { scene: state.settings.presets[0], index: 0, wasActive: true })
  assert.equal(deleteScene(state, 'two').deleted.wasActive, false)
  assert.equal(deleteScene(state, 'two').activeSceneId, 'one')
  assert.equal(deleteScene(state, 'missing'), undefined)
})

test('Scene order defines the numbered shortcut order', () => {
  const state = library([scene('one', 'One'), scene('two', 'Two'), scene('three', 'Three')], {}, 'two')

  assert.deepEqual(ids(reorderScene(state, 'two', -1)), ['two', 'one', 'three'])
  assert.deepEqual(ids(reorderScene(state, 'two', 1)), ['one', 'three', 'two'])
  assert.equal(reorderScene(state, 'two', 1).activeSceneId, 'two')
  assert.equal(reorderScene(state, 'one', -1), undefined)
  assert.equal(reorderScene(state, 'three', 1), undefined)
  assert.equal(reorderScene(state, 'two', 'sideways'), undefined)
  assert.equal(reorderScene(state, 'missing', 1), undefined)
})

test('an ordinary settings patch is sanitized and clears the active Scene', () => {
  const state = library([scene('one', 'One')], {}, 'one')
  const result = patchSettings(state, { size: 9000, mirror: false })

  assert.equal(result.activeSceneId, '')
  assert.equal(result.settings.size, 640)
  assert.equal(result.settings.mirror, false)
  assert.deepEqual(result.settings.presets, state.settings.presets)
})

test('imports report how many Scenes they read, on the Import button, not on the camera', () => {
  const result = importScenes(library(), JSON.stringify([scene('a', 'A')]))
  assert.equal(result.importedCount, 1)
  assert.equal(result.notice, undefined)
  assert.equal(importScenes(library(), JSON.stringify([scene('a', 'A'), scene('b', 'B')])).importedCount, 2)
})

test('exports identify the Scene format and version', () => {
  const state = library([scene('one', 'One')])
  assert.deepEqual(sceneExport(state), {
    format: 'camframe-scenes',
    version: 1,
    scenes: state.settings.presets,
  })
})

test('a layout Scene without a place plans on the display nearest its saved point', () => {
  const scene = {
    id: 'side',
    name: 'Side',
    settings: settingsForPreset({ size: 300, position: { x: 2182, y: 16 } }),
    layout: { size: 600 },
  }
  const settings = sanitizeSettings({ size: 288 })
  const current = { x: 0, y: 0, width: 1920, height: 1040 }
  const nearest = { x: 1920, y: 0, width: 800, height: 600 }
  const planned = layoutSceneGeometry(scene, settings, { workArea: current, workAreaAt: () => nearest })
  // 600 px would not fit 600 px of height with the chrome, so it shrinks inside `nearest`.
  assert.equal(planned.size, 600 - OVERLAY_CHROME.top - OVERLAY_CHROME.bottom)
  assert.equal(planned.clamped, true)
  assert.ok(planned.position.x >= nearest.x && planned.position.x + planned.size + OVERLAY_CHROME.left + OVERLAY_CHROME.right <= nearest.x + nearest.width)
  const fallback = layoutSceneGeometry(scene, settings, { workArea: current })
  assert.ok(fallback.position.x + fallback.size + OVERLAY_CHROME.left + OVERLAY_CHROME.right <= current.width, 'without workAreaAt it uses workArea')
})

test('a layout Scene that cannot be planned keeps its saved place on the screen', () => {
  const scene = {
    id: 'right',
    name: 'Right',
    // Saved on a 1920 px display: the window sits near the right edge, x 1518.
    settings: settingsForPreset({ size: 288, position: { x: 1518, y: 300 } }),
    layout: { size: 'small', position: 'right', withinRight: 0.2 },
  }
  const settings = sanitizeSettings({ size: 288 })
  // A lone 1024 px display: 20% of it is too narrow for the smallest camera, so planning fails.
  const lone = { x: 0, y: 0, width: 1024, height: 768 }
  const geometry = layoutSceneGeometry(scene, settings, { workArea: lone })
  const window = overlayDimensionsFor({ shape: settings.shape, size: geometry.size })
  assert.ok(geometry.position.x >= lone.x && geometry.position.x + window.width <= lone.x + lone.width, 'inside horizontally')
  assert.ok(geometry.position.y >= lone.y && geometry.position.y + window.height <= lone.y + lone.height, 'inside vertically')
  // With no work area known there is nothing to keep it inside: the saved place stays.
  assert.deepEqual(layoutSceneGeometry(scene, settings).position, { x: 1518, y: 300 })
})

// --- Scenes tab (ADR 0037): autosave, undo, delete with undo, rename, reorder, tile previews ---

const live = (scenes, settings = {}, activeSceneId = '') => library(scenes, settings, activeSceneId)
const sceneById = (state, id) => state.settings.presets.find((candidate) => candidate.id === id)

test('the active Scene follows a hand change of the live look and saves itself', () => {
  const state = live([scene('one', 'One', { size: 300, shape: 'circle' }), scene('two', 'Two')], { size: 300, shape: 'circle' }, 'one')
  const next = sanitizeSettings({ ...state.settings, size: 420, frameEffect: 'glow', borderWidth: 4, position: { x: 50, y: 60 } })
  const result = followLiveLook(state, next)
  assert.equal(result.activeSceneId, 'one')
  assert.equal(result.savedSceneId, 'one')
  const saved = sceneById(result, 'one').settings
  assert.equal(saved.size, 420)
  assert.equal(saved.frameEffect, 'glow')
  assert.equal(saved.borderWidth, 4)
  assert.deepEqual(saved.position, { x: 50, y: 60 })
  assert.deepEqual(result.autosaved.before, state.settings.presets[0])
  assert.deepEqual(sceneById(result, 'two'), state.settings.presets[1], 'other Scenes stay as they were')
  assert.equal(result.settings.size, 420)
})

test('a hand change saves what it set when it differs from the active Scene, also a value a demo left', () => {
  // The onboarding demo changed the live shape without saving it; the takeover commit sends the same shape.
  const state = live([scene('one', 'One', { shape: 'circle' })], { shape: 'rounded' }, 'one')
  const result = followLiveLook(state, sanitizeSettings({ ...state.settings, shape: 'rounded' }), { keys: ['shape'] })
  assert.equal(sceneById(result, 'one').settings.shape, 'rounded')
  assert.equal(result.savedSceneId, 'one')
  // A change of something no Scene stores (the Scenes view, Always on top) saves nothing.
  const view = followLiveLook(state, sanitizeSettings({ ...state.settings, sceneView: 'list' }), { keys: ['sceneView'] })
  assert.equal(view.savedSceneId, undefined)
  assert.equal(sceneById(view, 'one').settings.shape, 'circle')
})

test('a hand change saves only what it set: a place the window was moved to by itself stays out', () => {
  // The Scene's display is gone, so the window was put back on screen at B and the native move stored B.
  const state = live([scene('one', 'One', { position: { x: 2500, y: 100 }, mirror: true })], { position: { x: 1500, y: 100 }, mirror: true }, 'one')
  const result = followLiveLook(state, sanitizeSettings({ ...state.settings, mirror: false }), { keys: ['mirror'] })
  assert.deepEqual(sceneById(result, 'one').settings.position, { x: 2500, y: 100 })
  assert.equal(sceneById(result, 'one').settings.mirror, false)
})

test('autosave leaves the camera, its quality and global switches out of the Scene', () => {
  const state = live([scene('one', 'One', { cameraId: 'cam-a', overlayResolution: '1080p' })], { cameraId: 'cam-a', overlayResolution: '1080p' }, 'one')
  // A missing camera falls back to the default one: that must never erase the Scene's camera.
  const next = sanitizeSettings({ ...state.settings, cameraId: '', cameraLabel: 'Default camera', overlayResolution: '480p', alwaysOnTop: false })
  const result = followLiveLook(state, next)
  assert.equal(result.activeSceneId, 'one', 'the Scene stays on')
  assert.equal(result.savedSceneId, undefined)
  assert.equal(result.autosaved, undefined)
  assert.equal(sceneById(result, 'one').settings.cameraId, 'cam-a')
  assert.equal(sceneById(result, 'one').settings.overlayResolution, '1080p')
  assert.equal(result.settings.alwaysOnTop, false)
})

test('without an active Scene a hand change saves nothing', () => {
  const state = live([scene('one', 'One')], {}, '')
  const result = followLiveLook(state, sanitizeSettings({ ...state.settings, size: 400 }))
  assert.equal(result.activeSceneId, '')
  assert.equal(result.savedSceneId, undefined)
  assert.deepEqual(result.settings.presets, state.settings.presets)
})

test('a hand change on an active layout Scene turns it into an exact Scene of the live look', () => {
  const layoutScene = { id: 'big', name: 'Big right', settings: settingsForPreset({}), layout: { size: 540, position: 'right' } }
  const state = live([layoutScene], { size: 540, shape: 'circle', position: { x: 1300, y: 200 } }, 'big')
  // A look change only: the layout Scene keeps the live look anyway, now it stores it.
  const reshaped = followLiveLook(state, sanitizeSettings({ ...state.settings, shape: 'rounded', position: { x: 1300, y: 200 } }))
  const converted = sceneById(reshaped, 'big')
  assert.equal(converted.layout, undefined)
  assert.equal(converted.settings.shape, 'rounded')
  assert.equal(converted.settings.size, 540)
  assert.deepEqual(converted.settings.position, { x: 1300, y: 200 })
  assert.equal(converted.name, 'Big right')
})

test('renaming keeps the look; an empty or taken name changes nothing', () => {
  const state = live([scene('one', 'One', { size: 400 }), scene('two', 'Two')], { size: 288 }, 'one')
  const renamed = renameScene(state, 'one', '  Intro  ')
  assert.equal(sceneById(renamed, 'one').name, 'Intro')
  assert.deepEqual(sceneById(renamed, 'one').settings, state.settings.presets[0].settings)
  assert.equal(renamed.activeSceneId, 'one')
  assert.equal(renamed.settings.size, 288, 'the live look does not change')
  assert.equal(renameScene(state, 'one', '   '), undefined)
  assert.equal(renameScene(state, 'one', 'One'), undefined)
  assert.equal(renameScene(state, 'missing', 'X'), undefined)
  assert.deepEqual(renameScene(state, 'one', 'two'), { error: 'name-taken' })
})

test('a deleted Scene comes back in its place, on camera again when it was', () => {
  const state = live([scene('one', 'One'), scene('two', 'Two'), scene('three', 'Three')], {}, 'two')
  const deleted = deleteScene(state, 'two')
  // The look changed while the Scene was gone: putting it back on camera brings its look back too.
  const changedMeanwhile = { ...deleted, settings: sanitizeSettings({ ...deleted.settings, shape: 'landscape', size: 500 }) }
  const restored = restoreScene(changedMeanwhile, deleted.deleted)
  assert.deepEqual(ids(restored), ['one', 'two', 'three'])
  assert.equal(restored.activeSceneId, 'two')
  assert.equal(restored.settings.shape, state.settings.presets[1].settings.shape)
  assert.equal(restored.settings.size, state.settings.presets[1].settings.size)
  assert.ok(restored.appliedScene, 'the Overlay moves back to it')
  // A Scene put on camera meanwhile stays on camera.
  const otherOn = restoreScene({ ...deleted, activeSceneId: 'three' }, deleted.deleted)
  assert.equal(otherOn.activeSceneId, 'three')
  // No room or the name taken meanwhile: nothing comes back.
  const full = live(Array.from({ length: SCENE_LIMIT }, (_, index) => scene(`s${index}`, `S${index}`)))
  assert.equal(restoreScene(full, deleted.deleted), undefined)
  assert.equal(restoreScene(live([scene('x', 'two')]), deleted.deleted), undefined)
})

test('undoing a change puts the Scene back as it was and on camera', () => {
  const before = scene('one', 'One', { size: 300, frameEffect: 'none', position: { x: 10, y: 20 } })
  const state = live([before], { size: 300, position: { x: 10, y: 20 } }, 'one')
  const changed = followLiveLook(state, sanitizeSettings({ ...state.settings, size: 500, frameEffect: 'glow' }))
  const undone = undoSceneChange(changed, { scene: changed.autosaved.before, look: {} })
  assert.deepEqual(sceneById(undone, 'one'), before)
  assert.equal(undone.settings.size, 300)
  assert.equal(undone.settings.frameEffect, 'none')
  assert.equal(undone.activeSceneId, 'one')
  assert.equal(undone.savedSceneId, 'one')
  assert.ok(undone.appliedScene, 'the Overlay moves back')
  assert.equal(undoSceneChange(live([]), { scene: before }), undefined, 'a Scene deleted meanwhile is not brought back')
})

test('undoing a change to a layout Scene also brings back the live look it was shown with', () => {
  let clock = 0
  const edits = createSceneEdits({ now: () => clock })
  const layoutScene = { id: 'big', name: 'Big right', settings: settingsForPreset({}), layout: { size: 540, position: 'right' } }
  const state = live([layoutScene], { shape: 'circle', frameEffect: 'none' }, 'big')
  const changed = followLiveLook(state, sanitizeSettings({ ...state.settings, shape: 'rounded', frameEffect: 'glow' }))
  edits.track(state, changed)
  const taken = edits.takeChange('big')
  assert.deepEqual(taken.scene, layoutScene)
  assert.equal(taken.look.shape, 'circle')
  const undone = undoSceneChange(changed, taken, { workArea: { x: 0, y: 0, width: 1920, height: 1040 } })
  assert.deepEqual(sceneById(undone, 'big').layout, layoutScene.layout)
  assert.equal(undone.settings.shape, 'circle')
  assert.equal(undone.settings.frameEffect, 'none')
  assert.equal(undone.settings.size, 540)
})

test('reordering moves a Scene by any number of places (drag and Alt+arrow)', () => {
  const state = live([scene('a', 'A'), scene('b', 'B'), scene('c', 'C'), scene('d', 'D')], {}, 'a')
  assert.deepEqual(ids(reorderScene(state, 'a', 2)), ['b', 'c', 'a', 'd'])
  assert.deepEqual(ids(reorderScene(state, 'd', -3)), ['d', 'a', 'b', 'c'])
  assert.deepEqual(ids(reorderScene(state, 'b', 9)), ['a', 'c', 'd', 'b'], 'clamped to the end')
  assert.equal(reorderScene(state, 'a', 2).activeSceneId, 'a')
})

test('the edit windows: Undo lives 10 seconds after a change, a delete 6 seconds', () => {
  let clock = 1000
  const edits = createSceneEdits({ now: () => clock })
  const original = scene('one', 'One', { size: 300 })
  const state = live([original, scene('two', 'Two')], { size: 300 }, 'one')
  edits.track(live([original, scene('two', 'Two')]), { ...state, appliedScene: original })
  assert.deepEqual(edits.view('one'), { sceneUndo: null, sceneDeleted: null, sceneSaved: null })

  const first = followLiveLook(state, sanitizeSettings({ ...state.settings, size: 400 }))
  edits.track(state, first)
  clock += 4000
  const second = followLiveLook(first, sanitizeSettings({ ...first.settings, size: 500 }))
  edits.track(first, second)
  assert.equal(SCENE_UNDO_MS, 10_000)
  assert.deepEqual(edits.view('one').sceneUndo, { id: 'one', endsAt: clock + SCENE_UNDO_MS })
  assert.deepEqual(edits.view('one').sceneSaved, { id: 'one', at: clock })

  // After the window closes Undo is gone; the next change opens a new window that still goes back to
  // how the Scene was when it went on camera, not one step.
  const third = followLiveLook(second, sanitizeSettings({ ...second.settings, size: 520 }))
  edits.track(second, third)
  clock += SCENE_UNDO_MS + 1
  assert.equal(edits.view('one').sceneUndo, null)
  assert.equal(edits.takeChange('one'), undefined)
  const later = followLiveLook(third, sanitizeSettings({ ...third.settings, size: 510 }))
  edits.track(third, later)
  assert.deepEqual(edits.takeChange('one').scene, original)
  assert.equal(edits.takeChange('one'), undefined, 'one undo per window')

  // Switching Scenes closes the window.
  const fourth = followLiveLook(later, sanitizeSettings({ ...later.settings, size: 530 }))
  edits.track(later, fourth)
  const switched = applyScene(fourth, 'two')
  edits.track(fourth, switched)
  assert.equal(edits.view('two').sceneUndo, null)

  const deleted = deleteScene(switched, 'one')
  edits.track(switched, deleted)
  assert.equal(SCENE_DELETE_UNDO_MS, 6000)
  assert.deepEqual(edits.view('two').sceneDeleted, { id: 'one', name: 'One', index: 0, endsAt: clock + SCENE_DELETE_UNDO_MS })
  clock += SCENE_DELETE_UNDO_MS + 1
  assert.equal(edits.view('two').sceneDeleted, null)
  assert.equal(edits.takeDelete(), undefined)
})

test('on a 1024x768 display (the Windows CI runner) Big right starts at 44% of its tile', () => {
  const display = { x: 0, y: 0, width: 1024, height: 768 }
  const right = { id: 'big', name: 'Big right', settings: settingsForPreset({}), layout: { size: 540, position: 'right' } }
  const settings = sanitizeSettings({ presets: [right] })
  const big = scenePreviews(settings, { workArea: display, workAreaAt: () => display, displayAt: () => display }).scenes.big
  // 540 px fits (768 - 2 x 84 = 600 px of centred height), 32 px from the right edge.
  assert.equal(big.x, (1024 - 32 - 540) / 1024)
  assert.equal(big.width, 540 / 1024)
})

test('Scene tiles draw the camera where it really is on its display', () => {
  const display = { x: 0, y: 0, width: 1920, height: 1080 }
  const workArea = { x: 0, y: 0, width: 1920, height: 1040 }
  const exact = scene('exact', 'Exact', { size: 288, shape: 'circle', position: { x: 100, y: 200 } })
  const right = { id: 'big', name: 'Big right', settings: settingsForPreset({}), layout: { size: 540, position: 'right' } }
  const settings = sanitizeSettings({ size: 288, shape: 'circle', position: { x: 1500, y: 600 }, presets: [exact, right] })
  const previews = scenePreviews(settings, { workArea, workAreaAt: () => workArea, displayAt: () => display })
  // The camera surface sits inside the window's chrome.
  assert.deepEqual(previews.scenes.exact, {
    x: (100 + OVERLAY_CHROME.left) / 1920,
    y: (200 + OVERLAY_CHROME.top) / 1080,
    width: 288 / 1920,
    height: 288 / 1080,
  })
  const big = previews.scenes.big
  assert.equal(Math.round(big.width * 1920), 540)
  // Right place: the camera's right edge is the 32 px margin from the work area's edge.
  assert.equal(Math.round((big.x + big.width) * 1920), 1920 - 32)
  assert.deepEqual(previews.live, {
    x: (1500 + OVERLAY_CHROME.left) / 1920,
    y: (600 + OVERLAY_CHROME.top) / 1080,
    width: 288 / 1920,
    height: 288 / 1080,
  })
  // The live window's real bounds win over a stored position that may be older.
  const moved = scenePreviews(settings, { workArea, workAreaAt: () => workArea, displayAt: () => display, liveBounds: { x: 0, y: 0, ...overlayDimensionsFor(settings) } })
  assert.equal(moved.live.x, OVERLAY_CHROME.left / 1920)
})

test('Undo after a rename puts the look back and keeps the new name', () => {
  let clock = 0
  const edits = createSceneEdits({ now: () => clock })
  const one = scene('one', 'One', { size: 300 })
  const state = live([one, scene('two', 'Two')], { size: 300 }, 'one')
  const changed = followLiveLook(state, sanitizeSettings({ ...state.settings, size: 500 }))
  edits.track(state, changed)
  const renamed = renameScene(changed, 'one', 'Intro')
  edits.track(changed, renamed)
  // Another Scene takes the freed name meanwhile.
  const taken = renameScene(renamed, 'two', 'One')
  edits.track(renamed, taken)
  const undone = undoSceneChange(taken, edits.takeChange('one'))
  assert.equal(sceneById(undone, 'one').name, 'Intro')
  assert.equal(sceneById(undone, 'one').settings.size, 300)
  assert.deepEqual(undone.settings.presets.map(({ name }) => name), ['Intro', 'One'])
})

test('saving over the Scene on camera on purpose ends its Undo window', () => {
  let clock = 0
  const edits = createSceneEdits({ now: () => clock })
  const state = live([scene('one', 'One', { size: 300 })], { size: 300 }, 'one')
  const changed = followLiveLook(state, sanitizeSettings({ ...state.settings, size: 500 }))
  edits.track(state, changed)
  const replaced = saveScene(changed, { name: 'one' })
  edits.track(changed, replaced)
  assert.equal(edits.view('one').sceneUndo, null)
})
