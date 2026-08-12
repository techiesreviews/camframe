import test from 'node:test'
import assert from 'node:assert/strict'
import {
  DEFAULT_SETTINGS,
  cameraPositionAfterDrag,
  dimensionsFor,
  overlayDimensionsFor,
  overlayRegionsFor,
  regionsFor,
  resizeOverlayFromCorner,
  sanitizeSettings,
  startupSettings,
} from '../src/settings.js'
import {
  applyCameraTrackProfile,
  cameraConstraintsFor,
  cameraOptionsFrom,
  cameraTrackConstraintsFor,
  canReuseCameraStream,
  configureCameraTrack,
} from '../src/cameras.js'
import {
  alwaysOnTopLevelFor,
  fullscreenButtonCopy,
  fullscreenWindowPlan,
  interpolateWindowBounds,
  isFullscreenExitInput,
} from '../src/fullscreen.js'

test('places the Windows camera above the taskbar without changing macOS layering', () => {
  assert.equal(alwaysOnTopLevelFor('win32'), 'pop-up-menu')
  assert.equal(alwaysOnTopLevelFor('darwin'), 'floating')
})

test('sanitizes untrusted settings and keeps safe values', () => {
  const result = sanitizeSettings({
    shape: 'triangle',
    size: 900,
    borderWidth: -4,
    borderColor: 'red',
    mirror: false,
    cameraPosition: { x: -20, y: 138.42 },
    position: { x: 12, y: 34 },
  })

  assert.equal(result.shape, DEFAULT_SETTINGS.shape)
  assert.equal(result.size, 640)
  assert.equal(result.borderWidth, 0)
  assert.equal(result.borderColor, DEFAULT_SETTINGS.borderColor)
  assert.equal(result.mirror, false)
  assert.deepEqual(result.cameraPosition, { x: 0, y: 100 })
  assert.deepEqual(result.position, { x: 12, y: 34 })
})

test('camera positioning follows drag direction and respects mirroring', () => {
  const center = { x: 50, y: 50 }
  const surface = { width: 200, height: 200 }

  assert.deepEqual(cameraPositionAfterDrag(center, { x: 40, y: -20 }, surface), {
    x: 30,
    y: 60,
  })
  assert.deepEqual(cameraPositionAfterDrag(center, { x: 40, y: -20 }, surface, true), {
    x: 70,
    y: 60,
  })
  assert.deepEqual(cameraPositionAfterDrag(center, { x: -500, y: 500 }, surface), {
    x: 100,
    y: 0,
  })
})

test('corner resizing preserves aspect ratio and anchors the opposite corner', () => {
  const circle = { ...DEFAULT_SETTINGS, shape: 'circle', size: 300 }
  const bounds = { x: 100, y: 200, width: 336, height: 402 }

  assert.deepEqual(resizeOverlayFromCorner(circle, bounds, 'bottom-right', { x: 80, y: 40 }), {
    size: 380,
    position: { x: 100, y: 200 },
  })
  assert.deepEqual(resizeOverlayFromCorner(circle, bounds, 'top-left', { x: -80, y: -40 }), {
    size: 380,
    position: { x: 20, y: 120 },
  })

  const wide = { ...DEFAULT_SETTINGS, shape: 'landscape', size: 320 }
  const resized = resizeOverlayFromCorner(wide, bounds, 'bottom-right', { x: 64, y: 36 })
  assert.deepEqual(resized, { size: 384, position: { x: 100, y: 200 } })
  assert.deepEqual(dimensionsFor({ ...wide, size: resized.size }), { width: 384, height: 216 })
})

test('computes dimensions for every aspect ratio', () => {
  assert.deepEqual(dimensionsFor({ shape: 'circle', size: 320 }), { width: 320, height: 320 })
  assert.deepEqual(dimensionsFor({ shape: 'portrait', size: 320 }), { width: 240, height: 320 })
  assert.deepEqual(dimensionsFor({ shape: 'landscape', size: 320 }), { width: 320, height: 180 })
})

test('every launch starts visible and always on top', () => {
  const result = startupSettings({ overlayVisible: false, alwaysOnTop: false, size: 360 })

  assert.equal(result.overlayVisible, true)
  assert.equal(result.alwaysOnTop, true)
  assert.equal(result.size, 360)
})

test('window regions stay inside the requested bounds', () => {
  const width = 320
  const height = 180
  const regions = regionsFor('landscape', width, height)

  assert.ok(regions.length > 1)
  for (const region of regions) {
    assert.ok(region.x >= 0)
    assert.ok(region.y >= 0)
    assert.ok(region.width > 0)
    assert.ok(region.height > 0)
    assert.ok(region.x + region.width <= width)
    assert.ok(region.y + region.height <= height)
  }
})

test('overlay reserves room for hover controls without expanding on hover', () => {
  const settings = { ...DEFAULT_SETTINGS, size: 320, shape: 'circle' }
  const bounds = overlayDimensionsFor(settings)
  const normal = overlayRegionsFor(settings, false)
  const hovered = overlayRegionsFor(settings, true)
  const controlsOpen = overlayRegionsFor(settings, true, true)

  assert.deepEqual(bounds, { width: 356, height: 422 })
  assert.ok(hovered.length > normal.length)
  assert.ok(controlsOpen.length > hovered.length)
  for (const region of controlsOpen) {
    assert.ok(region.x >= 0 && region.y >= 0)
    assert.ok(region.x + region.width <= bounds.width)
    assert.ok(region.y + region.height <= bounds.height)
  }
})

test('camera discovery keeps video inputs even before labels are available', () => {
  assert.deepEqual(
    cameraOptionsFrom([
      { kind: 'audioinput', deviceId: 'mic', label: 'Microphone' },
      { kind: 'videoinput', deviceId: 'cam-link', label: 'Cam Link 4K' },
      { kind: 'videoinput', deviceId: 'camera-2', label: '' },
    ]),
    [
      { deviceId: 'cam-link', label: 'Cam Link 4K' },
      { deviceId: 'camera-2', label: 'Camera 2' },
    ],
  )
})

test('reuses an active capture when default and selected IDs resolve to the same camera', () => {
  assert.equal(canReuseCameraStream('', '', 'cam-link'), true)
  assert.equal(canReuseCameraStream('cam-link', '', 'cam-link'), true)
  assert.equal(canReuseCameraStream('camera-2', '', 'cam-link'), false)
})

test('uses the verified low-latency camera profile', () => {
  assert.deepEqual(cameraConstraintsFor('cam-link'), {
    audio: false,
    video: {
      deviceId: { exact: 'cam-link' },
      width: { ideal: 1280 },
      height: { ideal: 720 },
      frameRate: { ideal: 60, min: 30, max: 60 },
    },
  })

  const track = { contentHint: 'detail' }
  configureCameraTrack(track)
  assert.equal(track.contentHint, 'motion')
})

test('switches between 4K fullscreen and 720p overlay capture profiles', async () => {
  assert.deepEqual(cameraTrackConstraintsFor(true), {
    width: { ideal: 3840 },
    height: { ideal: 2160 },
    frameRate: { ideal: 30, max: 30 },
  })
  assert.deepEqual(cameraTrackConstraintsFor(false), {
    width: { ideal: 1280 },
    height: { ideal: 720 },
    frameRate: { ideal: 60, min: 30, max: 60 },
  })
  assert.deepEqual(cameraConstraintsFor('cam-link', { fullscreen: true }), {
    audio: false,
    video: {
      deviceId: { exact: 'cam-link' },
      width: { ideal: 3840 },
      height: { ideal: 2160 },
      frameRate: { ideal: 30, max: 30 },
    },
  })

  const applied = []
  const track = { applyConstraints: async (constraints) => applied.push(constraints) }
  assert.equal(await applyCameraTrackProfile(track, true), true)
  assert.equal(await applyCameraTrackProfile(track, false), true)
  assert.deepEqual(applied, [cameraTrackConstraintsFor(true), cameraTrackConstraintsFor(false)])

  const unsupportedTrack = {
    applyConstraints: async () => {
      throw new DOMException('Unsupported profile', 'OverconstrainedError')
    },
  }
  assert.equal(await applyCameraTrackProfile(unsupportedTrack, true), false)
})

test('fullscreen copy and Escape behavior stay in sync', () => {
  assert.equal(fullscreenButtonCopy(false), 'Enter full screen')
  assert.equal(fullscreenButtonCopy(true), 'Exit full screen')
  assert.equal(isFullscreenExitInput({ type: 'keyDown', key: 'Escape' }), true)
  assert.equal(isFullscreenExitInput({ type: 'keyUp', key: 'Escape' }), false)
  assert.equal(isFullscreenExitInput({ type: 'keyDown', key: 'Enter' }), false)
})

test('leaving fullscreen restores the live topmost camera window', () => {
  const normalBounds = { x: 120, y: 80, width: 356, height: 422 }
  const displayBounds = { x: 0, y: 0, width: 1920, height: 1080 }

  assert.deepEqual(
    fullscreenWindowPlan({
      fullscreen: false,
      normalBounds,
      displayBounds,
      alwaysOnTop: true,
      visible: true,
    }),
    {
      bounds: normalBounds,
      alwaysOnTop: true,
      visible: true,
    },
  )
})

test('fullscreen bounds animate smoothly in either direction', () => {
  const small = { x: 120, y: 80, width: 360, height: 420 }
  const large = { x: 0, y: 0, width: 1920, height: 1080 }

  assert.deepEqual(interpolateWindowBounds(small, large, 0), small)
  assert.deepEqual(interpolateWindowBounds(small, large, 0.5), {
    x: 60,
    y: 40,
    width: 1140,
    height: 750,
  })
  assert.deepEqual(interpolateWindowBounds(small, large, 1), large)
  assert.deepEqual(interpolateWindowBounds(large, small, 1), small)
})
