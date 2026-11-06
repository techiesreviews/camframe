import test from 'node:test'
import assert from 'node:assert/strict'
import { request as httpRequest } from 'node:http'
import { OVERLAY_CHROME, SCENE_LIMIT, preferencesFromDocument, sanitizeSettings } from '../src/settings.js'
import { OVERLAY_BOUNDS_TRANSITION_MS, compactBaseBounds, createOverlayGeometry } from '../src/overlay-geometry.js'
import { PROMPTER_LINK_HOST, createPrompterLink } from '../src/prompter-link.js'
import { createPrompterControl } from '../src/prompter-control.js'
import * as sceneLibrary from '../src/scenes.js'

// The Prompter link end to end in Node: the real HTTP endpoint, the real control, Scene library
// and Overlay geometry, with a fake window, screen and clock in place of Electron.

const PROMPTER = 'https://prompter.techies.tools'

function fakeClock() {
  let now = 0
  let nextId = 1
  const intervals = new Map()
  return {
    timers: {
      now: () => now,
      setInterval(callback, ms) {
        const id = nextId++
        intervals.set(id, { callback, ms, due: now + ms })
        return id
      },
      clearInterval: (id) => intervals.delete(id),
    },
    advance(ms) {
      const end = now + ms
      for (;;) {
        const due = [...intervals.entries()].sort((a, b) => a[1].due - b[1].due)[0]
        if (!due || due[1].due > end) break
        now = due[1].due
        due[1].due += due[1].ms
        due[1].callback()
      }
      now = end
    },
  }
}

function fakeWindow(bounds) {
  const window = {
    bounds: { ...bounds },
    isDestroyed: () => false,
    getBounds: () => ({ ...window.bounds }),
    setBounds(next) {
      window.bounds = { ...window.bounds, ...next }
    },
    getPosition: () => [window.bounds.x, window.bounds.y],
    setPosition(x, y) {
      window.bounds = { ...window.bounds, x, y }
    },
    setAlwaysOnTop() {},
    moveTop() {},
    show() {},
    showInactive() {},
    hide() {},
    focus() {},
    setIgnoreMouseEvents() {},
  }
  return window
}

// The look Lex streams with: a chosen camera, a frame, a glow and a custom crop.
const LOOK = {
  cameraId: 'camera-brio',
  cameraLabel: 'Logitech BRIO',
  shape: 'circle',
  frameEffect: 'glow',
  effectColor: '#22c55e',
  borderWidth: 4,
  borderColor: '#fafafa',
  mirror: false,
  cameraZoom: 140,
  cameraPosition: { x: 40, y: 55 },
}
const OTHER_SCENES = [
  { id: 'preset-interview', name: 'Interview', settings: { size: 400, shape: 'portrait', position: { x: 10, y: 20 } } },
  { id: 'preset-demo', name: 'Demo', settings: { size: 250, shape: 'landscape', position: { x: 30, y: 40 } } },
]

async function harness(
  t,
  { display = { x: 0, y: 0, width: 1920, height: 1080 }, workArea, extraDisplays = [], settings: patch = {} } = {},
) {
  const area = workArea ?? { ...display, height: display.height - 40 }
  const state = {
    settings: sanitizeSettings({ ...LOOK, size: 288, presets: OTHER_SCENES, prompterLink: true, ...patch }),
    activeSceneId: '',
  }
  const saves = []
  const notices = []
  const announced = []
  const clock = fakeClock()
  const window = fakeWindow(compactBaseBounds({ settings: state.settings, workArea: area, keepCenter: false }))
  // `extraDisplays` sit next to the primary one; the nearest display to a point holds it.
  const displays = [{ bounds: display, workArea: area }, ...extraDisplays]
  const unplug = (index) => displays.splice(index, 1)
  const inside = (point, rect) =>
    point.x >= rect.x && point.x < rect.x + rect.width && point.y >= rect.y && point.y < rect.y + rect.height
  const screen = {
    getCursorScreenPoint: () => ({ x: 0, y: 0 }),
    getPrimaryDisplay: () => displays[0],
    // The display holding the bounds' centre, as Electron's getDisplayMatching picks by overlap.
    getDisplayMatching: (bounds) =>
      displays.find((candidate) =>
        inside({ x: bounds.x + bounds.width / 2, y: bounds.y + bounds.height / 2 }, candidate.bounds),
      ) ?? displays[0],
    getDisplayNearestPoint: (point) => displays.find((candidate) => inside(point, candidate.bounds)) ?? displays[0],
  }
  const geometry = createOverlayGeometry({
    window,
    screen,
    settings: () => state.settings,
    timers: clock.timers,
    onCompactPositionChanged(position) {
      state.settings = { ...state.settings, position }
    },
  })
  const control = createPrompterControl({
    geometry: () => geometry,
    sceneState: () => ({ ...state }),
    commit(result) {
      if (result?.notice) notices.push(result.notice)
      if (result?.announce) announced.push(result.announce)
      if (!result?.settings) return
      state.settings = result.settings
      state.activeSceneId = result.activeSceneId
      // What main writes to preferences.json.
      saves.push(JSON.stringify(state.settings))
    },
    version: () => '0.6.1',
  })
  const link = createPrompterLink({
    port: 0,
    status: control.status,
    applyCue: control.applyCue,
    saveScene: control.saveScene,
    setSmallSize: control.setSmallSize,
  })
  link.setEnabled(true)
  t.after(() => link.close())
  await new Promise((resolve) => {
    const wait = () => (link.state().state === 'starting' ? setTimeout(wait, 5) : resolve())
    wait()
  })
  const port = link.address().port
  const call = (method, path, body) =>
    new Promise((resolve, reject) => {
      const request = httpRequest(
        {
          host: PROMPTER_LINK_HOST,
          port,
          method,
          path,
          agent: false,
          headers: { Host: `127.0.0.1:${port}`, Origin: PROMPTER, ...(body ? { 'Content-Type': 'application/json' } : {}) },
        },
        (response) => {
          let text = ''
          response.setEncoding('utf8')
          response.on('data', (chunk) => {
            text += chunk
          })
          response.on('end', () => resolve({ status: response.statusCode, body: JSON.parse(text) }))
        },
      )
      request.on('error', reject)
      if (body) request.write(JSON.stringify(body))
      request.end()
    })
  return {
    state,
    saves,
    notices,
    announced,
    geometry,
    window,
    status: async () => (await call('GET', '/camframe/status')).body,
    cue: (body) => call('POST', '/camframe/cue', body),
    saveScene: (body) => call('POST', '/camframe/scenes', body),
    setSmallSize: (body) => call('POST', '/camframe/small-size', body),
    settle: () => clock.advance(OVERLAY_BOUNDS_TRANSITION_MS + 32),
    unplug,
  }
}

const SMALL_CORNER = { name: 'Live small corner', size: 'small', position: 'bottom-right' }
const RIGHT_LARGE = { name: 'Live right large', size: 432, position: 'right', withinRight: 0.3 }

test('large then small returns the original small size, corner and look; both Scenes persist', async (t) => {
  const live = await harness(t)

  // 1. Record the original small geometry before enlarging anything.
  const before = await live.status()
  assert.equal(before.api, 2)
  assert.equal(before.smallSize, 288)
  assert.equal(before.view.size, 288)
  assert.equal(before.view.mode, 'compact')
  const originalLook = before.look
  assert.equal(originalLook.cameraLabel, 'Logitech BRIO')
  assert.equal(originalLook.cameraId, undefined, 'the device id stays in CamFrame')

  // 2. Save both Scenes. Saving does not move the Overlay.
  const small = await live.saveScene(SMALL_CORNER)
  assert.equal(small.status, 200)
  assert.deepEqual(small.body.saved.camera, { x: 1920 - 32 - 288, y: 1040 - 32 - 288, width: 288, height: 288 })
  assert.equal(small.body.scene.kind, 'layout')
  assert.equal(small.body.scene.size, 288)
  assert.equal(small.body.scene.position, 'bottom-right')
  const large = await live.saveScene(RIGHT_LARGE)
  assert.equal(large.status, 200)
  assert.deepEqual(large.body.saved.camera, { x: 1920 - 32 - 432, y: (1040 - 432) / 2, width: 432, height: 432 })
  assert.equal(large.body.saved.clamped, false)
  assert.ok(large.body.saved.camera.x >= 1920 * 0.7, 'inside the right 30%')
  assert.deepEqual((await live.status()).view, before.view)

  // 3. Apply large: bigger, right, vertically centred, same look, small size untouched.
  const toLarge = await live.cue({ scene: 'Live right large' })
  assert.equal(toLarge.status, 200)
  assert.deepEqual(toLarge.body.cue, { size: 'small', scene: 'Live right large' })
  assert.equal(toLarge.body.view.settled, false, 'still moving')
  live.settle()
  const inLarge = await live.status()
  assert.equal(inLarge.view.settled, true)
  assert.deepEqual(inLarge.view.camera, large.body.saved.camera)
  assert.equal(inLarge.activeScene, 'Live right large')
  assert.equal(inLarge.smallSize, 288)
  assert.deepEqual(inLarge.look, originalLook)

  // 4. Apply small: the ORIGINAL size and the bottom-right corner come back, same look.
  await live.cue({ scene: 'Live small corner' })
  live.settle()
  const inSmall = await live.status()
  assert.deepEqual(inSmall.view.camera, small.body.saved.camera)
  assert.equal(inSmall.view.size, 288)
  assert.deepEqual(inSmall.look, originalLook)

  // 5. The original cues also restore the original size after large.
  await live.cue({ scene: 'Live right large' })
  live.settle()
  await live.cue({ size: 'small', position: 'bottom-right' })
  live.settle()
  assert.deepEqual((await live.status()).view.camera, small.body.saved.camera)
  await live.cue({ scene: 'Live right large' })
  live.settle()
  await live.cue({ size: 'small' })
  live.settle()
  assert.equal((await live.status()).view.size, 288)
  await live.cue({ size: 'small', position: 'right' })
  live.settle()
  const right = (await live.status()).view.camera
  assert.deepEqual(right, { x: 1920 - 32 - 288, y: (1040 - 288) / 2, width: 288, height: 288 })

  // 6. Through Full screen and back.
  await live.cue({ size: 'full' })
  live.settle()
  assert.equal((await live.status()).view.mode, 'fullscreen')
  await live.cue({ scene: 'Live right large' })
  live.settle()
  assert.deepEqual((await live.status()).view.camera, large.body.saved.camera)
  await live.cue({ size: 'full' })
  live.settle()
  await live.cue({ scene: 'Live small corner' })
  live.settle()
  const back = await live.status()
  assert.equal(back.view.mode, 'compact')
  assert.deepEqual(back.view.camera, small.body.saved.camera)
  assert.deepEqual(back.look, originalLook)

  // 7. Both Scenes and the unrelated ones survive a save and a relaunch.
  const relaunched = preferencesFromDocument(live.saves.at(-1))
  assert.deepEqual(
    relaunched.presets.map((scene) => scene.name),
    ['Interview', 'Demo', 'Live small corner', 'Live right large'],
  )
  assert.deepEqual(relaunched.presets[0], sanitizeSettings({ presets: OTHER_SCENES }).presets[0])
  assert.deepEqual(relaunched.presets[1], sanitizeSettings({ presets: OTHER_SCENES }).presets[1])
  // "small" stays symbolic, so the Scene and a "small" cue always agree.
  assert.deepEqual(relaunched.presets[2].layout, { size: 'small', position: 'bottom-right' })
  assert.deepEqual(relaunched.presets[3].layout, { size: 432, position: 'right', withinRight: 0.3 })
  assert.equal(relaunched.prompterSmallSize, 288)
  // And they still work after the relaunch.
  const afterRelaunch = sceneLibrary.applyScene(
    { settings: { ...relaunched, size: 288 }, activeSceneId: '' },
    relaunched.presets[3].id,
    { workArea: { x: 0, y: 0, width: 1920, height: 1040 } },
  )
  assert.equal(afterRelaunch.settings.size, 432)
  assert.equal(afterRelaunch.settings.prompterSmallSize, 288)
})

test('from Full screen, a bare "small" with a grown small size keeps the window on screen and says it shrank', async (t) => {
  const live = await harness(t)
  await live.cue({ size: 'small', position: 'bottom-right' })
  live.settle()
  assert.equal((await live.setSmallSize({ size: 400 })).status, 200)
  await live.cue({ size: 'full' })
  live.settle()
  const back = await live.cue({ size: 'small' })
  assert.equal(back.status, 200)
  live.settle()
  const { view } = await live.status()
  assert.equal(view.mode, 'compact')
  const inside = (window, area) =>
    window.x >= area.x &&
    window.y >= area.y &&
    window.x + window.width <= area.x + area.width &&
    window.y + window.height <= area.y + area.height
  assert.ok(inside(view.window, view.workArea), `window ${JSON.stringify(view.window)} inside ${JSON.stringify(view.workArea)}`)
  assert.deepEqual(back.body.layout, { size: 400, requestedSize: 400, clamped: false })
  assert.equal(view.size, 400)

  // A small size the display cannot hold shrinks, and the reply says so.
  const tiny = await harness(t, { display: { x: 0, y: 0, width: 800, height: 500 } })
  await tiny.setSmallSize({ size: 640 })
  await tiny.cue({ size: 'full' })
  tiny.settle()
  const shrunk = await tiny.cue({ size: 'small' })
  tiny.settle()
  const tinyView = (await tiny.status()).view
  assert.ok(inside(tinyView.window, tinyView.workArea))
  assert.equal(shrunk.body.layout.clamped, true)
  assert.equal(shrunk.body.layout.requestedSize, 640)
  assert.equal(shrunk.body.layout.size, tinyView.size)
})

test('Full screen then a bare "small" at the same size and place keeps the Active Scene', async (t) => {
  const live = await harness(t)
  await live.saveScene(SMALL_CORNER)
  await live.cue({ scene: 'Live small corner' })
  live.settle()
  const inSmall = await live.status()
  assert.equal(inSmall.activeScene, 'Live small corner')
  await live.cue({ size: 'full' })
  live.settle()
  await live.cue({ size: 'small' })
  live.settle()
  const back = await live.status()
  assert.equal(back.view.mode, 'compact')
  assert.deepEqual(back.view.camera, inSmall.view.camera)
  assert.equal(back.activeScene, 'Live small corner')
  // In Compact mode at the same size it stays too.
  await live.cue({ size: 'small' })
  live.settle()
  assert.equal((await live.status()).activeScene, 'Live small corner')
  // A bare "small" that has to move or resize the camera is a size cue, so it clears it.
  await live.setSmallSize({ size: 400 })
  await live.cue({ size: 'full' })
  live.settle()
  await live.cue({ size: 'small' })
  live.settle()
  assert.equal((await live.status()).activeScene, null)
})

test('a hand drag not yet saved by the moved event is where Full screen then "small" returns', async (t) => {
  const live = await harness(t)
  await live.cue({ size: 288, position: 'bottom-right' })
  live.settle()
  live.window.bounds = { ...live.window.bounds, x: 700, y: 300 }
  await live.cue({ size: 'full' })
  live.settle()
  await live.cue({ size: 'small' })
  live.settle()
  const view = (await live.status()).view
  assert.equal(view.window.x, 700)
  assert.equal(view.window.y, 300)

  // A cue that names the old stored place still goes there, not to the dragged place.
  const corner = (await live.status()).view.camera
  await live.cue({ size: 'full' })
  live.settle()
  await live.cue({ size: 288, position: 'bottom-right' })
  live.settle()
  const placed = (await live.status()).view
  assert.equal(placed.camera.x + placed.camera.width, 1920 - 32)
  assert.notEqual(placed.camera.x, corner.x)
})

test('with no stored position, Full screen then a bare "small" goes back where the Overlay was', async (t) => {
  const live = await harness(t)
  await live.saveScene(SMALL_CORNER)
  await live.cue({ scene: 'Live small corner' })
  live.settle()
  // A top-left place, then no stored position (as after applying a Scene saved without one).
  live.window.setBounds({ x: 40, y: 50 })
  live.state.settings = { ...live.state.settings, position: null }
  const before = (await live.status()).view
  assert.deepEqual({ x: before.window.x, y: before.window.y }, { x: 40, y: 50 })
  assert.equal((await live.status()).activeScene, 'Live small corner')
  await live.cue({ size: 'full' })
  live.settle()
  const back = await live.cue({ size: 'small' })
  assert.deepEqual(back.body.layout, { size: 288, requestedSize: 288, clamped: false })
  live.settle()
  const after = await live.status()
  assert.equal(after.view.mode, 'compact')
  assert.deepEqual(after.view.window, before.window)
  assert.equal(after.activeScene, 'Live small corner', 'same size and place keeps the Active Scene')
})

test('in Full screen, a bare "small" after a tray apply of a Scene from another display returns to that display', async (t) => {
  const second = { bounds: { x: 1920, y: 0, width: 1920, height: 1080 }, workArea: { x: 1920, y: 0, width: 1920, height: 1040 } }
  const live = await harness(t, { extraDisplays: [second] })
  live.state.settings = sanitizeSettings({
    ...live.state.settings,
    presets: [
      ...live.state.settings.presets,
      { id: 'preset-side', name: 'Side B', settings: { size: 288, shape: 'circle', position: { x: 2400, y: 300 } } },
    ],
  })
  // Full screen on the first display.
  await live.cue({ size: 'full' })
  live.settle()
  assert.equal((await live.status()).view.mode, 'fullscreen')
  // The tray or a shortcut applies the Scene saved on the second display: in Full screen that only
  // stores its position (main commits the result and calls showScene).
  const applied = sceneLibrary.applyScene({ ...live.state }, 'preset-side', {
    workArea: live.geometry.currentWorkArea(),
    workAreaAt: (point) => live.geometry.workAreaAt(point),
  })
  live.state.settings = applied.settings
  live.state.activeSceneId = applied.activeSceneId
  live.geometry.showScene()
  assert.equal((await live.status()).view.mode, 'fullscreen')

  const back = await live.cue({ size: 'small' })
  assert.equal(back.status, 200)
  live.settle()
  const { view, activeScene } = await live.status()
  assert.equal(view.mode, 'compact')
  assert.deepEqual(view.workArea, second.workArea)
  assert.deepEqual({ x: view.window.x, y: view.window.y }, { x: 2400, y: 300 })
  assert.equal(activeScene, 'Side B')
})

test('saving a Scene at "current" from Full screen saves the place Full screen returns to', async (t) => {
  const live = await harness(t)
  live.window.setBounds({ x: 40, y: 50 })
  live.state.settings = { ...live.state.settings, position: null }
  const before = (await live.status()).view.camera
  await live.cue({ size: 'full' })
  live.settle()
  const saved = await live.saveScene({ name: 'Here', size: 'current', position: 'current' })
  assert.equal(saved.status, 200)
  assert.deepEqual(saved.body.saved.camera, before)
  assert.equal((await live.status()).view.mode, 'fullscreen', 'saving does not move the Overlay')
})

test('changing the small size while "Live small corner" is active updates its details, not the view', async (t) => {
  const live = await harness(t)
  await live.saveScene(SMALL_CORNER)
  await live.cue({ scene: 'Live small corner' })
  live.settle()
  const before = await live.status()
  assert.equal((await live.setSmallSize({ size: 400 })).body.smallSize, 400)
  const after = await live.status()
  // The Scene follows the small size from its next apply; the view does not move on its own.
  assert.equal(after.sceneDetails.find((scene) => scene.name === 'Live small corner').size, 400)
  assert.deepEqual(after.view.camera, before.view.camera)
  assert.equal(after.activeScene, 'Live small corner')
  await live.cue({ scene: 'Live small corner' })
  live.settle()
  assert.equal((await live.status()).view.size, 400)
})

test('a circle "Live right large" applied with a landscape live shape still meets the large-layout checks', async (t) => {
  const live = await harness(t)
  await live.saveScene(RIGHT_LARGE)
  live.state.settings = sanitizeSettings({ ...live.state.settings, shape: 'landscape' })
  await live.cue({ scene: 'Live right large' })
  live.settle()
  const { view } = await live.status()
  assert.equal(view.shape, 'landscape')
  const { camera, workArea } = view
  // Inside the right 30%, 32 px from the right edge, vertically centred, window on screen.
  assert.ok(camera.x >= workArea.x + workArea.width * 0.7, `camera x ${camera.x}`)
  assert.equal(camera.x + camera.width, workArea.x + workArea.width - 32)
  assert.ok(Math.abs(camera.y + camera.height / 2 - (workArea.y + workArea.height / 2)) <= 1)
  assert.ok(view.window.y >= workArea.y && view.window.y + view.window.height <= workArea.y + workArea.height)
  assert.equal(camera.height, Math.round(camera.width * 0.5625))
})

test('Face small set to a place: a bare "small" after the large layout lands on the small corner', async (t) => {
  const live = await harness(t, { settings: { prompterFaceSmall: 'bottom-right' } })
  const small = await live.saveScene(SMALL_CORNER)
  await live.saveScene(RIGHT_LARGE)
  await live.cue({ scene: 'Live right large' })
  live.settle()
  assert.equal((await live.status()).activeScene, 'Live right large')
  const back = await live.cue({ size: 'small' })
  assert.equal(back.status, 200)
  live.settle()
  const after = await live.status()
  assert.deepEqual(after.view.camera, small.body.saved.camera)
  assert.equal(after.activeScene, null, 'a place cue clears the Active Scene')
})

test('Face full set to a layout Scene: a "full" cue applies it in Compact mode with the live look', async (t) => {
  const live = await harness(t)
  const large = await live.saveScene(RIGHT_LARGE)
  live.state.settings = sanitizeSettings({
    ...live.state.settings,
    prompterFaceFull: `scene:${large.body.scene.id}`,
    borderWidth: 9,
  })
  const changedLook = (await live.status()).look
  const full = await live.cue({ size: 'full' })
  assert.equal(full.status, 200)
  live.settle()
  const after = await live.status()
  assert.equal(after.view.mode, 'compact')
  assert.deepEqual(after.view.camera, large.body.saved.camera)
  assert.equal(after.look.signature, changedLook.signature)
  assert.equal(after.activeScene, 'Live right large')
})

test('a Scene saved at a point reports that camera point as its position', async (t) => {
  const live = await harness(t)
  const saved = await live.saveScene({ name: 'Desk', size: 300, position: { x: 1200, y: 100 } })
  assert.equal(saved.status, 200)
  assert.deepEqual(saved.body.scene.position, { x: 1200, y: 100 })
  assert.deepEqual(saved.body.scene.savedPosition, { x: 1200 - OVERLAY_CHROME.left, y: 100 - OVERLAY_CHROME.top })
  const detail = (await live.status()).sceneDetails.find((scene) => scene.name === 'Desk')
  assert.deepEqual(detail.position, { x: 1200, y: 100 })
  // A snapshot Scene reports its camera point the same way.
  const interview = (await live.status()).sceneDetails.find((scene) => scene.name === 'Interview')
  assert.deepEqual(interview.position, { x: 10 + OVERLAY_CHROME.left, y: 20 + OVERLAY_CHROME.top })
  assert.deepEqual(interview.savedPosition, { x: 10, y: 20 })
})

test('a layout Scene keeps the live look, even one changed after the Scene was saved', async (t) => {
  const live = await harness(t)
  await live.saveScene(RIGHT_LARGE)
  live.state.settings = sanitizeSettings({ ...live.state.settings, borderWidth: 9, cameraId: 'camera-c920', cameraLabel: 'C920' })
  const changedLook = (await live.status()).look
  await live.cue({ scene: 'Live right large' })
  live.settle()
  const after = await live.status()
  assert.deepEqual(after.look, changedLook)
  assert.equal(live.state.settings.cameraId, 'camera-c920')
  assert.equal(after.view.size, 432)
})

test('on a narrow display the large Scene shrinks to fit the right 30%; small is unchanged', async (t) => {
  const live = await harness(t, { display: { x: 0, y: 0, width: 1280, height: 720 } })
  await live.saveScene(SMALL_CORNER)
  await live.saveScene(RIGHT_LARGE)
  const cue = await live.cue({ scene: 'Live right large' })
  assert.deepEqual(cue.body.layout, { size: Math.floor(1280 * 0.3 - 32), requestedSize: 432, clamped: true })
  live.settle()
  const view = (await live.status()).view
  assert.ok(view.camera.x >= 1280 * 0.7)
  assert.equal(view.camera.x + view.camera.width, 1280 - 32)
  assert.equal(view.camera.y, Math.round((680 - view.camera.height) / 2))
  await live.cue({ scene: 'Live small corner' })
  live.settle()
  assert.equal((await live.status()).view.size, 288)
  // The Scene keeps asking for 432, so a wider display gets the full size again.
  assert.equal((await live.status()).sceneDetails.find((scene) => scene.name === 'Live right large').size, 432)
})

test('exact size and place cues, and the small size, apply without a restart', async (t) => {
  const live = await harness(t)
  const exact = await live.cue({ size: 400, position: { x: 1200, y: 100 } })
  assert.equal(exact.status, 200)
  live.settle()
  assert.deepEqual((await live.status()).view.camera, { x: 1200, y: 100, width: 400, height: 400 })
  assert.equal((await live.status()).smallSize, 288)

  const margin = await live.cue({ size: 300, position: 'top-right', margin: 0 })
  assert.equal(margin.status, 200)
  live.settle()
  const view = (await live.status()).view
  // The whole window, with its transparent chrome, stays on screen, so a 0 margin leaves the
  // chrome's width; at a top place the hover toolbar stays reachable, so the camera sits below it.
  assert.equal(view.camera.x + view.camera.width, 1920 - OVERLAY_CHROME.right)
  assert.equal(view.window.y, 0)

  const smallSize = await live.setSmallSize({ size: 260 })
  assert.deepEqual(smallSize.body, { ok: true, smallSize: 260 })
  await live.cue({ size: 'small', position: 'bottom-right' })
  live.settle()
  assert.deepEqual((await live.status()).view.camera, { x: 1920 - 32 - 260, y: 1040 - 32 - 260, width: 260, height: 260 })

  const tooNarrow = await live.cue({ size: 300, position: 'right', withinRight: 0.1, margin: 160 })
  assert.equal(tooNarrow.status, 422)
  assert.equal(tooNarrow.body.code, 'does-not-fit')
  assert.equal((await live.status()).view.size, 260, 'a refused cue changes nothing')
})

test('saving and cueing a Scene draw no name on the camera', async (t) => {
  const live = await harness(t)
  assert.equal((await live.saveScene(SMALL_CORNER)).status, 200)
  assert.equal((await live.saveScene({ ...RIGHT_LARGE, apply: true })).status, 200)
  assert.equal((await live.cue({ scene: 'Live small corner' })).status, 200)
  assert.equal((await live.cue({ scene: 'Live right large' })).status, 200)
  assert.deepEqual(live.notices, [])
  // Screen readers still get each name: the two saves, the apply that goes with the second, both cues.
  assert.deepEqual(live.announced, ['Live small corner', 'Live right large', 'Live right large', 'Live small corner', 'Live right large'])
})

test('Scene capacity and names: refused with a code, never an eviction', async (t) => {
  const live = await harness(t)
  for (const name of ['One', 'Two', 'Three', 'Four']) {
    assert.equal((await live.saveScene({ name, size: 'small', position: 'bottom-left' })).status, 200)
  }
  assert.equal(live.state.settings.presets.length, SCENE_LIMIT)
  const names = live.state.settings.presets.map((scene) => scene.name)

  const full = await live.saveScene(RIGHT_LARGE)
  assert.equal(full.status, 409)
  assert.equal(full.body.code, 'scene-limit')
  assert.match(full.body.error, /6 Scenes/)
  assert.deepEqual(live.state.settings.presets.map((scene) => scene.name), names)

  const exists = await live.saveScene({ name: 'two', size: 300 })
  assert.equal(exists.status, 409)
  assert.equal(exists.body.code, 'scene-exists')

  const id = live.state.settings.presets[3].id
  const replaced = await live.saveScene({ name: 'Two', size: 432, position: 'right', withinRight: 0.3, replace: true })
  assert.equal(replaced.status, 200)
  assert.equal(replaced.body.replaced, true)
  assert.equal(live.state.settings.presets[3].id, id, 'same id and place in the list')
  assert.deepEqual(live.state.settings.presets.map((scene) => scene.name), names)
  assert.deepEqual(live.state.settings.presets[0], sanitizeSettings({ presets: OTHER_SCENES }).presets[0])

  const unique = new Set(live.state.settings.presets.map((scene) => scene.id))
  assert.equal(unique.size, SCENE_LIMIT, 'Scenes saved in the same millisecond still get their own ids')
})

test('a look-alike name needs replace, and a cue finds a Scene by either form of an accent', async (t) => {
  const live = await harness(t)
  const composed = 'Caf\u00e9'
  const decomposed = 'Cafe\u0301'
  assert.equal((await live.saveScene({ name: composed, size: 300, position: 'bottom-left' })).status, 200)
  const again = await live.saveScene({ name: decomposed, size: 300 })
  assert.equal(again.status, 409)
  assert.equal(again.body.code, 'scene-exists')
  // An invisible character cannot make a second Scene that looks the same.
  const hidden = await live.saveScene({ name: 'Ca\u200bf\u00e9', size: 300 })
  assert.equal(hidden.status, 400)
  assert.equal((await live.cue({ scene: decomposed })).status, 200)
  assert.equal((await live.cue({ scene: composed })).status, 200)
  // Allowed invisible characters (a variation selector) cannot make a look-alike either.
  assert.equal((await live.saveScene({ name: 'Caf\u00e9\ufe0f', size: 300 })).status, 409)
  // Joiners that real text needs are still fine.
  assert.equal((await live.saveScene({ name: '\u{1F469}\u200d\u{1F4BB} Demo', size: 300 })).status, 200)
})

test('save with apply moves at once; the status lists what each Scene does', async (t) => {
  const live = await harness(t)
  const saved = await live.saveScene({ ...RIGHT_LARGE, apply: true })
  assert.equal(saved.status, 200)
  assert.deepEqual(saved.body.layout, { size: 432, requestedSize: 432, clamped: false })
  live.settle()
  const status = await live.status()
  assert.equal(status.activeScene, 'Live right large')
  const detail = status.sceneDetails.find((scene) => scene.name === 'Live right large')
  assert.equal(detail.kind, 'layout')
  assert.equal(detail.withinRight, 0.3)
  assert.equal(status.sceneDetails.find((scene) => scene.name === 'Interview').kind, 'snapshot')
  assert.equal(status.sceneLimit, SCENE_LIMIT)
  assert.equal(status.view.window.width, status.view.camera.width + OVERLAY_CHROME.left + OVERLAY_CHROME.right)
})

test('"Live small corner" follows the small size, so it always matches a "small" cue', async (t) => {
  const live = await harness(t)
  await live.saveScene(SMALL_CORNER)
  await live.saveScene(RIGHT_LARGE)
  assert.deepEqual((await live.setSmallSize({ size: 260 })).body, { ok: true, smallSize: 260 })
  await live.cue({ scene: 'Live right large' })
  live.settle()
  await live.cue({ scene: 'Live small corner' })
  live.settle()
  const fromScene = (await live.status()).view.camera
  await live.cue({ scene: 'Live right large' })
  live.settle()
  await live.cue({ size: 'small', position: 'bottom-right' })
  live.settle()
  assert.deepEqual((await live.status()).view.camera, fromScene)
  assert.equal(fromScene.width, 260)
  const detail = (await live.status()).sceneDetails.find((scene) => scene.name === 'Live small corner')
  assert.equal(detail.size, 260)
  assert.equal(detail.followsSmallSize, true)
})

test('on a display too small for any camera, a layout Scene keeps its saved geometry and says so', async (t) => {
  const tiny = { bounds: { x: 1920, y: 0, width: 400, height: 300 }, workArea: { x: 1920, y: 0, width: 400, height: 300 } }
  const live = await harness(t, { extraDisplays: [tiny] })
  await live.saveScene(RIGHT_LARGE)
  // Move the Overlay onto the tiny display.
  await live.cue({ size: 180, position: { x: 1930, y: 90 } })
  live.settle()
  assert.deepEqual((await live.status()).view.workArea, tiny.workArea)
  const cue = await live.cue({ scene: 'Live right large' })
  assert.equal(cue.status, 200)
  assert.deepEqual(cue.body.layout, { size: 432, requestedSize: 432, clamped: true })
  live.settle()
  // A direct cue that cannot fit is refused instead.
  await live.cue({ size: 180, position: { x: 1930, y: 90 } })
  live.settle()
  const direct = await live.cue({ size: 432, position: 'right', withinRight: 0.3 })
  assert.equal(direct.status, 422)
})

test('a layout Scene saved without a place stays on screen when the small size grows', async (t) => {
  const live = await harness(t)
  await live.cue({ size: 'small', position: 'bottom-right', margin: 0 })
  live.settle()
  assert.equal((await live.saveScene({ name: 'Here', size: 'small', position: 'current' })).status, 200)
  await live.setSmallSize({ size: 432 })
  await live.cue({ scene: 'Here' })
  live.settle()
  const { view } = await live.status()
  assert.equal(view.size, 432)
  assert.ok(view.window.x + view.window.width <= view.workArea.x + view.workArea.width)
  assert.ok(view.window.y + view.window.height <= view.workArea.y + view.workArea.height)
})

test('a layout Scene saved at a point on another display goes back to that display', async (t) => {
  const second = { bounds: { x: 1920, y: 0, width: 1280, height: 1024 }, workArea: { x: 1920, y: 0, width: 1280, height: 984 } }
  const live = await harness(t, { extraDisplays: [second] })
  const saved = await live.saveScene({ name: 'Side', size: 300, position: { x: 2200, y: 100 } })
  assert.equal(saved.status, 200)
  // Saved and applied while the Overlay is on the first display: it plans on the point's display.
  assert.deepEqual(saved.body.saved.camera, { x: 2200, y: 100, width: 300, height: 300 })
  assert.deepEqual(saved.body.saved.workArea, second.workArea)
  await live.cue({ scene: 'Side' })
  live.settle()
  const { view } = await live.status()
  assert.deepEqual(
    { x: view.window.x + OVERLAY_CHROME.left, y: view.window.y + OVERLAY_CHROME.top, width: view.camera.width },
    { x: 2200, y: 100, width: 300 },
  )
})

test('a cue to a point on another display reports that display at once', async (t) => {
  const second = { bounds: { x: 1920, y: 0, width: 1280, height: 1024 }, workArea: { x: 1920, y: 0, width: 1280, height: 984 } }
  const live = await harness(t, { extraDisplays: [second] })
  const cue = await live.cue({ size: 300, position: { x: 2200, y: 100 } })
  assert.equal(cue.body.view.settled, false)
  assert.deepEqual(cue.body.view.workArea, second.workArea)
  assert.deepEqual(cue.body.view.camera, { x: 2200, y: 100, width: 300, height: 300 })
})

test('a Scene saved on a display that is later unplugged opens on screen', async (t) => {
  const second = { bounds: { x: 1920, y: 0, width: 1280, height: 1024 }, workArea: { x: 1920, y: 0, width: 1280, height: 984 } }
  const live = await harness(t, { extraDisplays: [second] })
  assert.equal((await live.saveScene({ name: 'Side', size: 300, position: { x: 2200, y: 100 } })).status, 200)
  live.unplug(1)
  await live.cue({ scene: 'Side' })
  live.settle()
  const { view } = await live.status()
  assert.ok(view.window.x >= 0 && view.window.x + view.window.width <= 1920, JSON.stringify(view.window))
  assert.ok(view.window.y >= 0 && view.window.y + view.window.height <= 1040)
})

test('a place cue sent while the camera is still moving to another display lands on that display', async (t) => {
  const second = { bounds: { x: 1920, y: 0, width: 1280, height: 1024 }, workArea: { x: 1920, y: 0, width: 1280, height: 984 } }
  const live = await harness(t, { extraDisplays: [second] })
  await live.cue({ size: 300, position: { x: 2200, y: 100 } })
  const corner = await live.cue({ size: 300, position: 'top-right' })
  assert.deepEqual(corner.body.view.workArea, second.workArea)
  live.settle()
  const { view } = await live.status()
  assert.deepEqual(view.workArea, second.workArea)
  assert.equal(view.camera.x + view.camera.width, 1920 + 1280 - 32)
})

test('a layout Scene applied while the camera is still moving to another display lands on that display', async (t) => {
  const second = { bounds: { x: 1920, y: 0, width: 1280, height: 1024 }, workArea: { x: 1920, y: 0, width: 1280, height: 984 } }
  const live = await harness(t, { extraDisplays: [second] })
  await live.saveScene({ name: 'Corner', size: 300, position: 'top-right' })
  await live.cue({ size: 300, position: { x: 2200, y: 100 } })
  const applied = await live.cue({ scene: 'Corner' })
  assert.deepEqual(applied.body.view.workArea, second.workArea)
  live.settle()
  const { view } = await live.status()
  assert.deepEqual(view.workArea, second.workArea)
  assert.equal(view.camera.x + view.camera.width, 1920 + 1280 - 32)
})
