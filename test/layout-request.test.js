import test from 'node:test'
import assert from 'node:assert/strict'
import { OVERLAY_CHROME, sanitizeSceneLayout, sanitizeSettings, settingsForPreset } from '../src/settings.js'
import { layoutToSave, planLayoutRequest, resolveLayoutRequest, sceneDisplays, sceneOpening } from '../src/layout-request.js'
import { applyScene, scenePreviews } from '../src/scenes.js'

// One answer to "where and how big does this Scene really open": applying the Scene and its Scenes
// tab tile must agree for every kind of Scene, including one saved on a display that is gone.

const desktop = { bounds: { x: 0, y: 0, width: 1920, height: 1080 }, workArea: { x: 0, y: 0, width: 1920, height: 1040 } }
const laptop = { bounds: { x: 0, y: 0, width: 1280, height: 720 }, workArea: { x: 0, y: 0, width: 1280, height: 680 } }
const small = { bounds: { x: 0, y: 0, width: 1024, height: 768 }, workArea: { x: 0, y: 0, width: 1024, height: 768 } }

// A single connected display: every point is nearest to it.
const displaysOf = (display) => ({
  workArea: display.workArea,
  workAreaAt: () => display.workArea,
  workAreas: [display.workArea],
  displayAt: () => display.bounds,
})

const exact = (id, settings) => ({ id, name: id, settings: settingsForPreset(settings) })
const layoutScene = (id, layout, settings) => ({ id, name: id, settings: settingsForPreset(settings), layout })

const openings = [
  {
    name: 'a snapshot Scene on screen opens at its saved place',
    display: desktop,
    scene: exact('desk', { size: 288, shape: 'circle', position: { x: 100, y: 200 } }),
    expected: { size: 288, position: { x: 100, y: 200 }, clamped: false },
  },
  {
    name: 'a snapshot Scene saved on a display that is gone opens kept on the nearest display',
    display: desktop,
    // Saved on a second display right of this one; the window is 324 px wide.
    scene: exact('gone', { size: 288, shape: 'circle', position: { x: 2500, y: 300 } }),
    expected: { size: 288, position: { x: 1920 - 324, y: 300 }, clamped: false },
  },
  {
    name: 'a snapshot Scene without a place keeps none (the first-launch place)',
    display: desktop,
    scene: exact('fresh', { size: 288, shape: 'circle' }),
    expected: { size: 288, position: null, clamped: false },
  },
  {
    name: 'a layout Scene with a spot is planned on the display',
    display: desktop,
    scene: layoutScene('right', { size: 540, position: 'right' }, { size: 540, position: { x: 0, y: 0 } }),
    // The camera's right edge is the 32 px Prompter margin from the work area's right edge.
    expected: { size: 540, position: { x: 1920 - 32 - 540 - OVERLAY_CHROME.left, y: 166 }, clamped: false },
  },
  {
    name: 'a layout Scene that follows the small size opens at the small size',
    display: desktop,
    settings: { prompterSmallSize: 200 },
    scene: layoutScene('corner', { size: 'small', position: 'bottom-left' }, { size: 288, position: { x: 0, y: 0 } }),
    expected: { size: 200, position: { x: 32 - OVERLAY_CHROME.left, y: 1040 - 32 - 200 - OVERLAY_CHROME.top }, clamped: false },
  },
  {
    name: 'a layout Scene without a place, saved on a display that is gone, opens shrunk on the nearest display',
    display: laptop,
    scene: layoutScene('side', { size: 640 }, { size: 640, position: { x: 1500, y: 16 } }),
    // 680 px of height leaves 578 px for the camera under the chrome; the window is kept inside.
    expected: { size: 578, position: { x: 1280 - 578 - OVERLAY_CHROME.left - OVERLAY_CHROME.right, y: 0 }, clamped: true },
  },
  {
    name: 'a layout Scene that cannot be planned keeps its saved size, kept on screen',
    display: small,
    // 20% of 1024 px is too narrow for the smallest camera.
    scene: layoutScene('narrow', { size: 'small', position: 'right', withinRight: 0.2 }, { size: 288, position: { x: 1518, y: 300 } }),
    expected: { size: 288, position: { x: 1024 - 324, y: 300 }, clamped: true },
  },
  {
    name: 'a portrait snapshot Scene saved on a display that is gone keeps its own shape in the tile',
    display: desktop,
    // The live shape is a circle; the portrait window is 351 px wide and its camera 315 x 420.
    scene: exact('outro', { size: 420, shape: 'portrait', position: { x: 2500, y: 300 } }),
    expected: { size: 420, position: { x: 1920 - 351, y: 300 }, clamped: false, camera: { width: 315, height: 420 } },
  },
  {
    name: 'a layout Scene is drawn with the live shape',
    display: desktop,
    settings: { shape: 'landscape' },
    // Saved as a circle, but a layout Scene keeps the live look: a 300 x 169 landscape camera, centred down.
    scene: layoutScene('wide', { size: 300, position: 'right' }, { size: 300, shape: 'circle', position: { x: 0, y: 0 } }),
    expected: { size: 300, position: { x: 1920 - 32 - 300 - OVERLAY_CHROME.left, y: 352 }, clamped: false, camera: { width: 300, height: 169 } },
  },
]

for (const entry of openings) {
  test(`Scene opening: ${entry.name}`, () => {
    const settings = sanitizeSettings({ size: 300, shape: 'circle', ...entry.settings, presets: [entry.scene] })
    const camera = entry.expected.camera ?? { width: entry.expected.size, height: entry.expected.size }
    const context = displaysOf(entry.display)
    const opening = sceneOpening(settings.presets[0], settings, context)
    assert.equal(opening.size, entry.expected.size, 'size')
    assert.deepEqual(opening.position, entry.expected.position, 'place')
    assert.equal(opening.clamped, entry.expected.clamped, 'clamped')

    const applied = applyScene({ settings, activeSceneId: '' }, entry.scene.id, context)
    assert.equal(applied.settings.size, opening.size, 'applying opens at that size')
    assert.deepEqual(applied.settings.position ?? null, opening.position, 'applying opens at that place')

    const tile = scenePreviews(settings, context).scenes[entry.scene.id]
    assert.equal(tile.size, opening.size, 'the tile names the size it opens at')
    if (opening.position) {
      const display = entry.display.bounds
      assert.equal(tile.x, (opening.position.x + OVERLAY_CHROME.left - display.x) / display.width, 'tile across')
      assert.equal(tile.y, (opening.position.y + OVERLAY_CHROME.top - display.y) / display.height, 'tile down')
    }
    assert.equal(tile.width, camera.width / entry.display.bounds.width, 'tile width')
    assert.equal(tile.height, camera.height / entry.display.bounds.height, 'tile height')
  })
}

const live = sanitizeSettings({ size: 350, prompterSmallSize: 200, prompterMargin: 32 })
const requests = [
  { name: '"small" is the small size', request: { size: 'small' }, expected: { size: 200, margin: 0 } },
  { name: '"current" is the live size', request: { size: 'current' }, expected: { size: 350, margin: 0 } },
  { name: 'a spot gets the Prompter margin', request: { size: 400, spot: 'right' }, expected: { size: 400, spot: 'right', margin: 32 } },
  { name: 'a spot keeps its own margin', request: { size: 400, spot: 'right', margin: 10 }, expected: { size: 400, spot: 'right', margin: 10 } },
  { name: 'a point has no margin', request: { size: 400, point: { x: 5, y: 6 } }, expected: { size: 400, point: { x: 5, y: 6 }, margin: 0 } },
  // The Prompter link and loading refuse a margin with a point; the function itself still passes it on.
  { name: 'a point keeps a margin given straight to the function', request: { size: 400, point: { x: 5, y: 6 }, margin: 12 }, expected: { size: 400, point: { x: 5, y: 6 }, margin: 12 } },
  { name: 'withinRight passes through', request: { size: 400, spot: 'top-right', withinRight: 0.3 }, expected: { size: 400, spot: 'top-right', margin: 32, withinRight: 0.3 } },
]

for (const entry of requests) {
  test(`Layout request: ${entry.name}`, () => {
    const resolved = resolveLayoutRequest(entry.request, live)
    assert.deepEqual(
      Object.fromEntries(Object.entries(resolved).filter(([, value]) => value !== undefined)),
      entry.expected,
    )
  })
}

test('a Layout request is planned with the live shape and reports what was asked', () => {
  const plan = planLayoutRequest({ size: 'small', spot: 'right' }, { ...live, shape: 'portrait' }, { workArea: desktop.workArea })
  assert.equal(plan.requestedSize, 200)
  assert.equal(plan.size, 200)
  assert.equal(plan.clamped, false)
  assert.equal(planLayoutRequest({ size: 2000 }, live, { workArea: laptop.workArea }).clamped, true)
})

const saves = [
  {
    name: '"small" stays "small" so the Scene follows the small size',
    request: { size: 'small', spot: 'right', margin: 10, withinRight: 0.3 },
    expected: { size: 'small', position: 'right', margin: 10, withinRight: 0.3 },
  },
  { name: '"current" stores the live size', request: { size: 'current' }, expected: { size: 350 } },
  { name: 'a point stores no place (the Scene keeps its saved one)', request: { size: 400, point: { x: 5, y: 6 } }, expected: { size: 400 } },
]

for (const entry of saves) {
  test(`Layout to save: ${entry.name}`, () => {
    const layout = layoutToSave(entry.request, live)
    assert.deepEqual(layout, entry.expected)
    assert.deepEqual(sanitizeSceneLayout(layout), layout, 'the stored layout survives loading')
  })
}

test('the displays a Scene is fitted to come from the Overlay geometry', () => {
  const geometry = {
    currentWorkArea: () => desktop.workArea,
    workAreaAt: (point) => ({ ...laptop.workArea, point }),
    workAreas: () => [desktop.workArea, laptop.workArea],
  }
  const displays = sceneDisplays(geometry)
  assert.deepEqual(displays.workArea, desktop.workArea)
  assert.deepEqual(displays.workAreas, [desktop.workArea, laptop.workArea])
  assert.deepEqual(displays.workAreaAt({ x: 1, y: 2 }).point, { x: 1, y: 2 })
  assert.deepEqual(sceneDisplays(undefined), {})
})
