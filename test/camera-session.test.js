import test from 'node:test'
import assert from 'node:assert/strict'
import { cameraConstraintsFor, cameraTrackConstraintsFor } from '../src/cameras.js'
import {
  STARTING_CAMERA_MESSAGE,
  cameraErrorMessage,
  createCameraSession,
} from '../src/camera-session.js'

function expectedCameraProfile(width, height) {
  const requestedSize = { width: { min: width }, height: { min: height } }
  return {
    width: { ideal: width },
    height: { ideal: height },
    frameRate: { min: 30 },
    advanced: [
      { ...requestedSize, frameRate: { min: 50 } },
      requestedSize,
      { frameRate: { min: 50 } },
    ],
  }
}

function frameRateLimitsIn(constraints) {
  return [constraints, ...(constraints.advanced ?? [])]
    .map((set) => set.frameRate)
    .filter((frameRate) => frameRate && ('ideal' in frameRate || 'max' in frameRate || 'exact' in frameRate))
}

const namedError = (name) => Object.assign(new Error(name), { name })

function deferred() {
  let resolve
  let reject
  const promise = new Promise((res, rej) => {
    resolve = res
    reject = rej
  })
  return { promise, resolve, reject }
}

function fakeTrack(deviceId) {
  const track = {
    deviceId,
    readyState: 'live',
    contentHint: '',
    applied: [],
    stopped: false,
    getSettings: () => ({ deviceId }),
    stop() {
      track.stopped = true
      track.readyState = 'ended'
    },
    async applyConstraints(constraints) {
      track.applied.push(constraints)
      if (track.rejectConstraints) throw namedError('OverconstrainedError')
    },
  }
  return track
}

function fakeStream(deviceId) {
  const track = fakeTrack(deviceId)
  return { track, getTracks: () => [track], getVideoTracks: () => [track] }
}

function fakeVideo() {
  const video = {
    srcObject: null,
    playing: false,
    play: async () => {
      video.playing = true
    },
    pause: () => {
      video.playing = false
    },
  }
  return video
}

// `respond(constraints)` returns a stream, throws, or returns a promise the test controls.
function harness({ respond, devices = [], platform = 'win32' } = {}) {
  const requests = []
  const events = { status: [], settled: 0, devices: [], missing: 0 }
  const mediaDevices = {
    devices,
    async getUserMedia(constraints) {
      requests.push(constraints)
      const deviceId = constraints.video.deviceId?.exact ?? 'default-cam'
      return respond ? respond(constraints, requests.length) : fakeStream(deviceId)
    },
    enumerateDevices: async () => mediaDevices.devices,
  }
  const video = fakeVideo()
  const effectVideo = fakeVideo()
  const session = createCameraSession({
    mediaDevices,
    video,
    effectVideo,
    platform,
    onStatus: (message) => events.status.push(message),
    onSettled: () => events.settled++,
    onDevices: (report) => events.devices.push(report),
    onSelectedCameraMissing: () => events.missing++,
  })
  return { session, requests, events, video, effectVideo, mediaDevices }
}

const camera = (cameraId = '', resolution = '720p', effect = 'none') => ({ cameraId, resolution, effect })

test('Chromium never receives a frame-rate limit that discards early camera frames (ADR 0028)', () => {
  for (const resolution of ['480p', '720p', '1080p', '2160p']) {
    for (const allowSlowerFrameRate of [false, true]) {
      assert.deepEqual(frameRateLimitsIn(cameraTrackConstraintsFor({ resolution, allowSlowerFrameRate })), [])
    }
  }
  assert.equal(cameraTrackConstraintsFor({ allowSlowerFrameRate: true }).frameRate, undefined)
  assert.deepEqual(cameraTrackConstraintsFor({ allowSlowerFrameRate: true }).advanced, expectedCameraProfile(1280, 720).advanced)
  assert.deepEqual(cameraTrackConstraintsFor(), expectedCameraProfile(1280, 720))
  assert.deepEqual(cameraTrackConstraintsFor({ resolution: '1080p' }), expectedCameraProfile(1920, 1080))
  assert.deepEqual(cameraConstraintsFor('cam-link'), {
    audio: false,
    video: { deviceId: { exact: 'cam-link' }, ...expectedCameraProfile(1280, 720) },
  })
})

test('starting the camera requests the selected device and quality, then reports it settled', async () => {
  const { session, requests, events, video } = harness({
    devices: [{ kind: 'videoinput', deviceId: 'cam-link', label: 'Cam Link 4K' }],
  })
  await session.update(camera('cam-link', '1080p'))

  assert.deepEqual(requests, [cameraConstraintsFor('cam-link', { resolution: '1080p' })])
  assert.equal(video.srcObject.track.deviceId, 'cam-link')
  assert.equal(video.playing, true)
  assert.equal(video.srcObject.track.contentHint, 'motion')
  assert.deepEqual(events.status, [STARTING_CAMERA_MESSAGE, undefined])
  assert.equal(events.settled, 1)
  assert.deepEqual(events.devices.at(-1), {
    cameras: [{ deviceId: 'cam-link', label: 'Cam Link 4K' }],
    selectedDeviceId: 'cam-link',
  })
})

test('an overconstrained camera retries once without the frame-rate floor', async () => {
  const { session, requests, events } = harness({
    respond: (constraints, attempt) => {
      if (attempt === 1) throw namedError('OverconstrainedError')
      return fakeStream('default-cam')
    },
  })
  await session.update(camera())

  assert.deepEqual(requests, [
    cameraConstraintsFor('', { resolution: '720p' }),
    cameraConstraintsFor('', { allowSlowerFrameRate: true, resolution: '720p' }),
  ])
  assert.equal(events.settled, 1)
})

test('a missing selected camera falls back to the default camera instead of an error', async () => {
  const { session, events } = harness({
    respond: () => {
      throw namedError('NotFoundError')
    },
  })
  await session.update(camera('unplugged'))

  assert.equal(events.missing, 1)
  assert.equal(events.settled, 0)
  assert.deepEqual(events.status, [STARTING_CAMERA_MESSAGE])
})

test('camera errors become platform recovery copy and still settle', async () => {
  const { session, events } = harness({
    platform: 'darwin',
    respond: () => {
      throw namedError('NotAllowedError')
    },
  })
  await session.update(camera())

  assert.match(events.status.at(-1), /System Settings/)
  assert.equal(events.settled, 1)
  assert.match(cameraErrorMessage(namedError('NotAllowedError'), 'win32'), /Windows Settings.*desktop apps/)
  assert.doesNotMatch(cameraErrorMessage(namedError('NotAllowedError'), 'darwin'), /Windows/)
  assert.equal(cameraErrorMessage(namedError('NotReadableError')), 'This camera is already in use by another app.')
  assert.equal(cameraErrorMessage(namedError('AbortError')), 'CamFrame could not start this camera.')
})

test('a stale camera result is stopped and never shown', async () => {
  const first = deferred()
  const { session, video, events } = harness({
    respond: (constraints, attempt) => (attempt === 1 ? first.promise : fakeStream('second')),
  })
  const slowStart = session.update(camera('first'))
  await session.update(camera('second'))
  const lateStream = fakeStream('first')
  first.resolve(lateStream)
  await slowStart

  assert.equal(video.srcObject.track.deviceId, 'second')
  assert.equal(lateStream.track.stopped, true)
  assert.equal(events.settled, 1)
})

test('selecting the device the default camera already uses keeps the running stream', async () => {
  const { session, requests, video } = harness()
  await session.update(camera(''))
  const stream = video.srcObject
  await session.update(camera('default-cam'))

  assert.equal(requests.length, 1)
  assert.equal(video.srcObject, stream)
  assert.equal(stream.track.stopped, false)

  // Returning to "Default camera" asks the OS again, because the default may be another device.
  await session.update(camera(''))
  assert.equal(requests.length, 2)
})

test('switching to a different camera stops the previous stream first', async () => {
  const { session, video } = harness()
  await session.update(camera('one'))
  const previous = video.srcObject
  await session.update(camera('two'))

  assert.equal(previous.track.stopped, true)
  assert.equal(video.srcObject.track.deviceId, 'two')
})

test('Camera quality changes apply to the running track in order without renegotiating', async () => {
  const { session, requests, video } = harness()
  await session.update(camera('cam', '720p'))
  const { track } = video.srcObject
  session.update(camera('cam', '1080p'))
  await session.update(camera('cam', '2160p'))

  assert.equal(requests.length, 1)
  assert.deepEqual(track.applied, [
    cameraTrackConstraintsFor({ resolution: '2160p' }),
    cameraTrackConstraintsFor({ resolution: '2160p' }),
  ])
})

test('an unsupported Camera quality leaves the camera running', async () => {
  const { session, video, events } = harness()
  await session.update(camera('cam', '720p'))
  video.srcObject.track.rejectConstraints = true
  await session.update(camera('cam', '2160p'))

  assert.equal(video.srcObject.track.stopped, false)
  assert.equal(events.status.at(-1), undefined)
})

test('unrelated preference changes never touch the camera', async () => {
  const { session, requests, video } = harness()
  await session.update(camera('cam', '720p', 'none'))
  await session.update(camera('cam', '720p', 'none'))

  assert.equal(requests.length, 1)
  assert.deepEqual(video.srcObject.track.applied, [])
})

test('the blur Frame effect shares the stream with a second video', async () => {
  const { session, video, effectVideo } = harness()
  await session.update(camera('cam', '720p', 'blur'))
  assert.equal(effectVideo.srcObject, video.srcObject)
  assert.equal(effectVideo.playing, true)

  await session.update(camera('cam', '720p', 'glow'))
  assert.equal(effectVideo.srcObject, null)
  assert.equal(effectVideo.playing, false)

  await session.update(camera('cam', '720p', 'blur'))
  assert.equal(effectVideo.srcObject, video.srcObject)
})

test('device scans label unnamed cameras and report failures', async () => {
  const { session, events, mediaDevices } = harness({
    devices: [
      { kind: 'audioinput', deviceId: 'mic', label: 'Microphone' },
      { kind: 'videoinput', deviceId: 'cam-link', label: 'Cam Link 4K' },
      { kind: 'videoinput', deviceId: 'camera-2', label: '' },
    ],
  })
  await session.update(camera('missing-from-list'))
  assert.deepEqual(events.devices.at(-1), {
    cameras: [
      { deviceId: 'cam-link', label: 'Cam Link 4K' },
      { deviceId: 'camera-2', label: 'Camera 2' },
    ],
    selectedDeviceId: undefined,
  })

  mediaDevices.enumerateDevices = async () => {
    throw new Error('denied')
  }
  await session.refreshDevices()
  assert.deepEqual(events.devices.at(-1), { error: 'Camera scan failed' })
})

test('only the newest device scan is reported', async () => {
  const slow = deferred()
  const { session, events, mediaDevices } = harness()
  mediaDevices.enumerateDevices = () => slow.promise
  const first = session.refreshDevices()
  mediaDevices.enumerateDevices = async () => [{ kind: 'videoinput', deviceId: 'new', label: 'New' }]
  await session.refreshDevices()
  slow.resolve([{ kind: 'videoinput', deviceId: 'old', label: 'Old' }])
  await first

  assert.equal(events.devices.length, 1)
  assert.equal(events.devices[0].cameras[0].deviceId, 'new')
})

test('stopping ends every track and detaches the halo', async () => {
  const { session, video, effectVideo } = harness()
  await session.update(camera('cam', '720p', 'blur'))
  const { track } = video.srcObject
  session.stop()
  assert.equal(track.stopped, true)
  assert.equal(effectVideo.srcObject, null)
})

test('the browser QA preview reports a working camera without capture', async () => {
  const events = { status: [], settled: 0 }
  const session = createCameraSession({
    video: fakeVideo(),
    effectVideo: fakeVideo(),
    onStatus: (message) => events.status.push(message),
    onSettled: () => events.settled++,
  })
  await session.update(camera('cam', '1080p', 'blur'))
  await session.update(camera('cam', '2160p', 'none'))
  await session.refreshDevices()

  assert.deepEqual(events, { status: [undefined], settled: 1 })
})
