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
  const state = library([desk], { alwaysOnTop: false, launchAtLogin: true, completedOnboardingVersion: 1 })
  const result = applyScene(state, 'desk')

  assert.equal(result.activeSceneId, 'desk')
  assert.equal(result.notice, undefined, 'applying a Scene draws nothing on the camera')
  assert.equal(result.appliedScene, state.settings.presets[0])
  assert.equal(result.settings.size, 420)
  assert.equal(result.settings.shape, 'landscape')
  assert.deepEqual(result.settings.position, { x: 5, y: 6 })
  assert.equal(result.settings.alwaysOnTop, false)
  assert.equal(result.settings.launchAtLogin, true)
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
})

test('deleting the active Scene clears it; deleting another keeps it', () => {
  const state = library([scene('one', 'One'), scene('two', 'Two')], {}, 'one')
  const deletedActive = deleteScene(state, 'one')
  assert.deepEqual(ids(deletedActive), ['two'])
  assert.equal(deletedActive.activeSceneId, '')
  assert.equal(deletedActive.notice, 'Scene deleted')
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

test('imports report how many Scenes they read', () => {
  const result = importScenes(library(), JSON.stringify([scene('a', 'A')]))
  assert.equal(result.notice, '1 scene imported')
  assert.equal(importScenes(library(), JSON.stringify([scene('a', 'A'), scene('b', 'B')])).notice, '2 scenes imported')
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
