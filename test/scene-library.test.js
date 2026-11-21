import test from 'node:test'
import assert from 'node:assert/strict'
import { OVERLAY_CHROME, sanitizeSettings, settingsForPreset } from '../src/settings.js'
import { describeScene, sceneKind, sceneLook, sceneLookOnCamera } from '../src/scenes.js'
import { layoutToSave, sceneRequest } from '../src/layout-request.js'

// The Scene library answers the questions about one Scene (its kind, the size it asks for now, its
// place, its look); the Prompter link status and the Scenes tab only format these answers.

const snapshot = (settings) => ({ id: 'desk', name: 'Desk', settings: settingsForPreset(settings) })
const layoutScene = (layout, settings = {}) => ({ id: 'corner', name: 'Corner', settings: settingsForPreset(settings), layout })
const live = (patch = {}) => sanitizeSettings({ prompterSmallSize: 300, ...patch })

test('a Scene look is everything it stores but its size and place, the camera included', () => {
  const settings = live({
    cameraId: 'cam-2',
    cameraLabel: 'Desk camera',
    overlayResolution: '1080p',
    shape: 'portrait',
    size: 400,
    position: { x: 10, y: 20 },
    frameEffect: 'glow',
    cameraPosition: { x: 40, y: 60 },
  })
  const look = sceneLook(settings)
  assert.deepEqual(Object.keys(look), [
    'cameraId',
    'cameraLabel',
    'shape',
    'overlayResolution',
    'frameEffect',
    'effectColor',
    'glowStrength',
    'glowSpread',
    'blurAmount',
    'blurOpacity',
    'borderWidth',
    'borderColor',
    'mirror',
    'cameraZoom',
    'cameraPosition',
  ])
  assert.equal(look.cameraId, 'cam-2')
  assert.equal(look.overlayResolution, '1080p')
  assert.equal(look.shape, 'portrait')
  assert.deepEqual(look.cameraPosition, { x: 40, y: 60 })
  assert.notEqual(look.cameraPosition, settings.cameraPosition, 'the framing is a copy')
})

test('a Scene saved through the Prompter link is a layout Scene; any other is a snapshot', () => {
  assert.equal(sceneKind(layoutScene({ size: 'small', position: 'bottom-right' })), 'layout')
  assert.equal(sceneKind(snapshot({ size: 288 })), 'snapshot')
})

test('a "small" layout Scene asks for the live small size at its spot and keeps the live look', () => {
  const scene = layoutScene({ size: 'small', position: 'bottom-right', margin: 24 }, { size: 288, position: { x: 1, y: 2 } })
  assert.deepEqual(describeScene(scene, live()), {
    kind: 'layout',
    followsSmallSize: true,
    size: 300,
    place: 'bottom-right',
    margin: 24,
    withinRight: undefined,
    saved: { size: 288, position: { x: 1, y: 2 } },
    keepsLiveLook: true,
    look: undefined,
  })
})

test('a layout Scene without a spot asks for its saved camera point', () => {
  const scene = layoutScene({ size: 432 }, { size: 432, position: { x: 100, y: 200 } })
  const answer = describeScene(scene, live())
  assert.equal(answer.size, 432)
  assert.equal(answer.followsSmallSize, false)
  assert.deepEqual(answer.place, { x: 100 + OVERLAY_CHROME.left, y: 200 + OVERLAY_CHROME.top })
})

test('a snapshot Scene asks for its saved size and camera point and applies its own look', () => {
  const scene = snapshot({ size: 400, shape: 'landscape', cameraId: 'cam-2', position: { x: 10, y: 20 } })
  const answer = describeScene(scene, live())
  assert.equal(answer.kind, 'snapshot')
  assert.equal(answer.size, 400)
  assert.equal(answer.followsSmallSize, false)
  assert.deepEqual(answer.place, { x: 10 + OVERLAY_CHROME.left, y: 20 + OVERLAY_CHROME.top })
  assert.equal(answer.keepsLiveLook, false)
  assert.deepEqual(answer.look, sceneLook(scene.settings))
  assert.equal(describeScene(snapshot({ size: 288 }), live()).place, null, 'a Scene without a place has none')
})

test('on camera a layout Scene shows the live look at the size it opens at; a snapshot its own', () => {
  const settings = live({ shape: 'rounded', size: 500, borderWidth: 4 })
  const corner = layoutScene({ size: 'small', position: 'bottom-right' })
  assert.deepEqual(sceneLookOnCamera(corner, settings), { ...settings, size: 300 }, 'before a preview: the size it asks for')
  assert.deepEqual(sceneLookOnCamera(corner, settings, 240), { ...settings, size: 240 }, 'the size it really opens at')
  const desk = snapshot({ shape: 'portrait', size: 400 })
  assert.equal(sceneLookOnCamera(desk, settings, 240), desk.settings)
})

test('a saved layout makes the request it was saved from', () => {
  const settings = live()
  for (const asked of [
    { size: 'small', spot: 'bottom-right' },
    { size: 432, spot: 'right', margin: 0, withinRight: 0.3 },
    { size: 'current', spot: 'top-left', margin: 48 },
  ]) {
    const scene = layoutScene(layoutToSave(asked, settings), { size: 288, position: { x: 5, y: 6 } })
    const size = asked.size === 'current' ? settings.size : asked.size
    assert.deepEqual(sceneRequest(scene), { size, spot: asked.spot, point: undefined, margin: asked.margin, withinRight: asked.withinRight })
  }
  const point = layoutScene({ size: 400 }, { size: 400, position: { x: 5, y: 6 } })
  assert.deepEqual(sceneRequest(point).point, { x: 5 + OVERLAY_CHROME.left, y: 6 + OVERLAY_CHROME.top })
  assert.deepEqual(sceneRequest(snapshot({ size: 360, position: { x: 7, y: 8 } })), {
    size: 360,
    point: { x: 7 + OVERLAY_CHROME.left, y: 8 + OVERLAY_CHROME.top },
  })
  assert.deepEqual(sceneRequest(snapshot({ size: 360 })), { size: 360, point: undefined })
})
