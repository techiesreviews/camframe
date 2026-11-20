import test from 'node:test'
import assert from 'node:assert/strict'
import { SCENE_LIMIT, sanitizeSettings, settingsForPreset } from '../src/settings.js'
import { NO_SCENES_NOTICE, SCENE_DELETE_UNDO_MS, SCENE_IMPORT_ERROR, SCENE_UNDO_MS, patchSettings } from '../src/scenes.js'
import { createSceneSession } from '../src/scene-session.js'

const WORK_AREA = Object.freeze({ x: 0, y: 0, width: 1920, height: 1040 })
const scene = (id, name, settings = {}, layout) => ({
  id,
  name,
  settings: settingsForPreset(settings),
  ...(layout ? { layout } : {}),
})

// A Scene session on a pretend 1920x1040 work area with a fake clock. `changes` records what the
// session told its adapter after each stored result.
function sessionWith({ scenes = [], settings = {}, activeSceneId = '', place = {} } = {}) {
  let time = 1_000
  const clock = { now: () => time, advance: (ms) => (time += ms) }
  const changes = []
  const session = createSceneSession({
    settings: sanitizeSettings({ ...settings, presets: scenes }),
    activeSceneId,
    now: clock.now,
    geometry: {
      sceneContext: () => ({ workArea: WORK_AREA, workAreaAt: () => WORK_AREA, workAreas: [WORK_AREA] }),
      compactPlace: () => place,
    },
    onChange: (result, options) => changes.push({ result, options }),
  })
  return { session, clock, changes }
}

const desk = scene('desk', 'Desk', { shape: 'circle', size: 300, borderWidth: 2, position: { x: 100, y: 100 } })
const talk = scene('talk', 'Talk', { shape: 'landscape', size: 400, borderWidth: 6, position: { x: 500, y: 300 } })

test('a hand change of the look is saved into the Active Scene and offers Undo', () => {
  const { session, changes } = sessionWith({ scenes: [desk, talk], settings: desk.settings, activeSceneId: 'desk' })

  session.handChange({ borderWidth: 9 })

  assert.equal(session.state().settings.borderWidth, 9)
  assert.equal(session.state().activeSceneId, 'desk', 'the Active Scene stays active')
  assert.equal(session.state().settings.presets[0].settings.borderWidth, 9)
  assert.deepEqual(session.view().sceneUndo, { id: 'desk', endsAt: 1_000 + SCENE_UNDO_MS })
  assert.equal(session.view().activePresetId, 'desk')
  assert.equal(changes.length, 1)
  assert.deepEqual(changes[0].options, { resizing: false })
})

test('Undo puts the Active Scene back as it went on camera, and only once', () => {
  const { session } = sessionWith({ scenes: [desk, talk], settings: desk.settings, activeSceneId: 'desk' })
  session.handChange({ borderWidth: 9 })
  session.handChange({ shape: 'rounded' })

  session.undoChange()

  assert.deepEqual(session.state().settings.presets[0], desk)
  assert.equal(session.state().settings.borderWidth, 2)
  assert.equal(session.state().settings.shape, 'circle')
  assert.equal(session.view().sceneUndo, null)
  const before = session.settings()
  session.undoChange()
  assert.equal(session.settings(), before, 'a second Undo changes nothing')
})

test('the Undo window closes after its time', () => {
  const { session, clock, changes } = sessionWith({ scenes: [desk], settings: desk.settings, activeSceneId: 'desk' })
  session.handChange({ borderWidth: 9 })
  clock.advance(SCENE_UNDO_MS)

  assert.equal(session.view().sceneUndo, null)
  session.undoChange()
  assert.equal(session.state().settings.presets[0].settings.borderWidth, 9)
  assert.equal(changes.length, 1, 'an Undo with nothing to undo tells the adapter nothing')
})

test('an onboarding demo step changes the look but never the Active Scene', () => {
  const { session } = sessionWith({ scenes: [desk], settings: desk.settings, activeSceneId: 'desk' })

  session.handChange({ shape: 'landscape' }, { demo: true })

  assert.equal(session.state().settings.shape, 'landscape')
  assert.equal(session.state().activeSceneId, 'desk')
  assert.equal(session.state().settings.presets[0].settings.shape, 'circle')
  assert.equal(session.view().sceneUndo, null)
})

test('the hand change that takes over from a demo saves the look the demo left', () => {
  const { session } = sessionWith({ scenes: [desk], settings: desk.settings, activeSceneId: 'desk' })
  session.handChange({ cameraZoom: 160 }, { demo: true })

  session.handChange({ cameraZoom: 160 })

  assert.equal(session.state().settings.presets[0].settings.cameraZoom, 160)
})

test('resizing by hand saves the size into the Active Scene and sets the small size', () => {
  const { session, changes } = sessionWith({ scenes: [desk], settings: desk.settings, activeSceneId: 'desk' })

  session.handResize({ size: 360, position: { x: 80, y: 90 } })

  const { settings } = session.state()
  assert.equal(settings.size, 360)
  assert.equal(settings.prompterSmallSize, 360)
  assert.equal(settings.presets[0].settings.size, 360)
  assert.deepEqual(settings.presets[0].settings.position, { x: 80, y: 90 })
  assert.deepEqual(changes.at(-1).options, { resizing: true }, 'a resize reports every frame')
})

test('a drag that moved the camera saves the place into the Active Scene', () => {
  const { session } = sessionWith({ scenes: [desk], settings: desk.settings, activeSceneId: 'desk' })

  session.dragEnd({ x: 700, y: 400 })

  assert.deepEqual(session.state().settings.position, { x: 700, y: 400 })
  assert.deepEqual(session.state().settings.presets[0].settings.position, { x: 700, y: 400 })
  assert.equal(session.view().sceneUndo.id, 'desk')
})

test('a quiet change is stored without touching the Active Scene, Undo or the adapter', () => {
  const { session, changes } = sessionWith({ scenes: [desk], settings: desk.settings, activeSceneId: 'desk' })

  session.record({ position: { x: 10, y: 20 }, overlayVisible: false })

  assert.deepEqual(session.state().settings.position, { x: 10, y: 20 })
  assert.equal(session.state().settings.overlayVisible, false)
  assert.equal(session.state().activeSceneId, 'desk')
  assert.deepEqual(session.state().settings.presets[0], desk)
  assert.equal(session.view().sceneUndo, null)
  assert.equal(changes.length, 0)
})

test('applying a Scene puts it on camera on screen and ends the Undo window', () => {
  const lost = scene('lost', 'Lost', { size: 300, position: { x: 4000, y: 300 } })
  const { session, changes } = sessionWith({ scenes: [desk, lost], settings: desk.settings, activeSceneId: 'desk' })
  session.handChange({ borderWidth: 9 })

  session.applyScene('lost')

  const { settings, activeSceneId } = session.state()
  assert.equal(activeSceneId, 'lost')
  assert.ok(settings.position.x < WORK_AREA.width, 'a Scene saved on a display that is gone opens on screen')
  assert.equal(changes.at(-1).result.appliedScene.id, 'lost')
  assert.equal(changes.at(-1).result.announce, 'Lost')
  assert.equal(session.view().sceneUndo, null)
})

test('numbered and cycle shortcuts apply Scenes in order', () => {
  const { session, changes } = sessionWith({ scenes: [desk, talk], settings: desk.settings, activeSceneId: 'desk' })

  session.applySceneAt(1)
  assert.equal(session.state().activeSceneId, 'talk')
  session.cycleScene()
  assert.equal(session.state().activeSceneId, 'desk')
  session.applySceneAt(5)
  assert.equal(changes.length, 2, 'a shortcut with no Scene does nothing')
})

test('cycling with no Scenes only shows the notice', () => {
  const { session, changes } = sessionWith()
  const before = session.settings()

  session.cycleScene()

  assert.equal(session.settings(), before)
  assert.deepEqual(changes, [{ result: { notice: NO_SCENES_NOTICE }, options: { resizing: false } }])
})

test('a layout Scene is planned on the display the session gets from its geometry', () => {
  const corner = scene('corner', 'Corner', { size: 288 }, { size: 288, position: 'bottom-right' })
  const { session } = sessionWith({ scenes: [corner] })

  session.applyScene('corner')

  const { position } = session.state().settings
  assert.ok(position.x > WORK_AREA.width / 2 && position.y > WORK_AREA.height / 2)
})

test('saving remembers where the camera is now, except from Full screen', () => {
  const live = sessionWith({ settings: { position: { x: 10, y: 20 } }, place: { bounds: { x: 420, y: 260, width: 356, height: 422 } } })
  live.session.saveScene('Desk')
  const saved = live.session.state()
  assert.equal(saved.activeSceneId, saved.settings.presets[0].id)
  assert.deepEqual(saved.settings.presets[0].settings.position, { x: 420, y: 260 })
  assert.deepEqual(live.session.view().sceneSaved, { id: saved.activeSceneId, at: 1_000 })

  const full = sessionWith({
    settings: { position: { x: 10, y: 20 } },
    place: { bounds: { x: 0, y: 0, width: 1920, height: 1080 }, fullscreen: true },
  })
  full.session.saveScene('Talk')
  assert.deepEqual(full.session.state().settings.presets[0].settings.position, { x: 10, y: 20 })
})

test('saving over a Scene by its id keeps the id and order', () => {
  const { session } = sessionWith({ scenes: [desk, talk], settings: { borderWidth: 12 } })

  session.saveScene('Desk again', 'desk')

  assert.deepEqual(session.state().settings.presets.map(({ id, name }) => [id, name]), [['desk', 'Desk again'], ['talk', 'Talk']])
  assert.equal(session.state().settings.presets[0].settings.borderWidth, 12)
})

test('a delete offers Undo for a short time and Undo puts the Scene back on camera', () => {
  const { session, clock } = sessionWith({ scenes: [desk, talk], settings: desk.settings, activeSceneId: 'desk' })

  session.deleteScene('desk')
  assert.deepEqual(session.state().settings.presets.map(({ id }) => id), ['talk'])
  assert.equal(session.state().activeSceneId, '')
  assert.deepEqual(session.view().sceneDeleted, { id: 'desk', name: 'Desk', index: 0, endsAt: 1_000 + SCENE_DELETE_UNDO_MS })

  clock.advance(SCENE_DELETE_UNDO_MS - 1)
  session.undoDelete()
  assert.deepEqual(session.state().settings.presets.map(({ id }) => id), ['desk', 'talk'])
  assert.equal(session.state().activeSceneId, 'desk', 'it was on camera, so it goes back on camera')
  assert.equal(session.view().sceneDeleted, null)
})

test('a delete cannot be undone once its window closed', () => {
  const { session, clock } = sessionWith({ scenes: [desk, talk] })
  session.deleteScene('talk')
  clock.advance(SCENE_DELETE_UNDO_MS)

  session.undoDelete()

  assert.deepEqual(session.state().settings.presets.map(({ id }) => id), ['desk'])
})

test('renaming to a taken name and a broken import change nothing and say why', () => {
  const { session, changes } = sessionWith({ scenes: [desk, talk] })

  assert.deepEqual(session.renameScene('talk', 'desk'), { error: 'name-taken' })
  assert.deepEqual(session.importScenes('not json'), { error: SCENE_IMPORT_ERROR })
  assert.equal(changes.length, 0)

  session.renameScene('talk', 'Interview')
  assert.equal(session.state().settings.presets[1].name, 'Interview')
})

test('an import merges Scenes up to the limit and closes the delete Undo', () => {
  const { session } = sessionWith({ scenes: [desk, talk] })
  session.deleteScene('talk')
  const imported = Array.from({ length: SCENE_LIMIT }, (_, index) => scene(`i${index}`, `Imported ${index}`))

  const result = session.importScenes(JSON.stringify({ scenes: imported }))

  assert.equal(result.importedCount, SCENE_LIMIT)
  assert.deepEqual(session.state().settings.presets.map(({ id }) => id), ['desk', 'i0', 'i1', 'i2', 'i3', 'i4'])
  assert.equal(session.view().sceneDeleted, null)
  assert.deepEqual(session.exportScenes().scenes, session.state().settings.presets)
})

test('moving a Scene changes its place in the list', () => {
  const { session } = sessionWith({ scenes: [desk, talk] })

  session.reorderScene('talk', -1)

  assert.deepEqual(session.state().settings.presets.map(({ id }) => id), ['talk', 'desk'])
})

test('a Prompter link cue committed through the session ends the Active Scene and its Undo', () => {
  const { session, changes } = sessionWith({ scenes: [desk], settings: desk.settings, activeSceneId: 'desk' })
  session.handChange({ borderWidth: 9 })

  session.commit(patchSettings(session.state(), { size: 200, position: { x: 1, y: 2 } }))

  assert.equal(session.state().activeSceneId, '')
  assert.equal(session.state().settings.size, 200)
  assert.equal(session.view().sceneUndo, null)
  assert.equal(changes.length, 2)
  assert.deepEqual(changes[1].options, { resizing: false })
  session.commit(patchSettings(session.state(), { size: 220 }), { placedByCaller: true })
  assert.deepEqual(changes[2].options, { resizing: false, placedByCaller: true }, 'commit options reach the adapter')
  session.commit(undefined)
  assert.equal(changes.length, 3, 'nothing to commit tells the adapter nothing')
})
