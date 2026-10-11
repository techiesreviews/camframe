import test from 'node:test'
import assert from 'node:assert/strict'
import {
  cameraFramingStyles,
  cameraPositionAfterDrag,
  cameraZoomAfterWheel,
  centeredFraming,
} from '../src/camera-framing.js'

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
  assert.deepEqual(cameraPositionAfterDrag(center, { x: 20, y: -10 }, surface, false, 150), {
    x: 30,
    y: 60,
  })
})

test('camera wheel zoom uses stable steps and respects framing limits', () => {
  assert.equal(cameraZoomAfterWheel(100, -120), 105)
  assert.equal(cameraZoomAfterWheel(245, -120), 250)
  assert.equal(cameraZoomAfterWheel(250, -120), 250)
  assert.equal(cameraZoomAfterWheel(105, 120), 100)
  assert.equal(cameraZoomAfterWheel(100, 120), 100)
  assert.equal(cameraZoomAfterWheel(175, 0), 175)
})

test('framing renders as one transform shared by the camera and halo videos', () => {
  assert.deepEqual(cameraFramingStyles({ ...centeredFraming(), mirror: true }), {
    transform: 'scaleX(-1) scale(1)',
    transformOrigin: '50% 50%',
    objectPosition: '50% 50%',
  })
  assert.deepEqual(
    cameraFramingStyles({ cameraPosition: { x: 32.5, y: 68 }, cameraZoom: 175, mirror: false }),
    { transform: 'scale(1.75)', transformOrigin: '32.5% 68%', objectPosition: '32.5% 68%' },
  )
})

test('centered framing is a fresh value every time', () => {
  const first = centeredFraming()
  first.cameraPosition.x = 10
  assert.deepEqual(centeredFraming(), { cameraPosition: { x: 50, y: 50 }, cameraZoom: 100 })
})
