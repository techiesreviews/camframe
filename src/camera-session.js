import { cameraConstraintsFor, cameraTrackConstraintsFor } from './cameras.js'

export const DEFAULT_CAMERA_LABEL = 'Default camera'
export const STARTING_CAMERA_MESSAGE = 'Starting camera.'

export function cameraErrorMessage(error, platform) {
  if (error?.name === 'NotAllowedError') {
    if (platform === 'darwin') {
      return 'Camera access is blocked. In System Settings, allow CamFrame to use the camera.'
    }
    if (platform === 'win32') {
      return 'Camera access is blocked. In Windows Settings, allow camera access for desktop apps.'
    }
    return 'Camera access is blocked. Allow CamFrame to use the camera in system privacy settings.'
  }
  if (error?.name === 'NotReadableError') return 'This camera is already in use by another app.'
  return 'CamFrame could not start this camera.'
}

function cameraOptionsFrom(devices = []) {
  return devices
    .filter((device) => device.kind === 'videoinput')
    .map((device, index) => ({
      deviceId: device.deviceId,
      label: device.label || `Camera ${index + 1}`,
    }))
}

function stopTracks(stream) {
  stream?.getTracks().forEach((track) => track.stop())
}

// Owns the Overlay's one camera MediaStream: acquiring the selected camera at the selected Camera
// quality, reusing it when the selection resolves to the same device, discarding stale results,
// applying quality changes in order without renegotiating, feeding the blur Frame effect's second
// video, and scanning devices. The Overlay renders what the callbacks report.
//
// Every change of capture mode on a live track is a visible risk on Windows (stale, black or another
// camera's frames, GitHub issue 5), so the track is only switched when the final Camera quality
// differs from the one it runs at, and a quality chosen while the camera starts is applied before
// the camera is shown.
//
// `mediaDevices` is `navigator.mediaDevices` (or a fake). Without it the session runs as the
// browser QA preview: it reports a working camera and never scans devices.
export function createCameraSession({
  mediaDevices,
  video,
  effectVideo,
  platform,
  onStatus = () => {},
  onSettled = () => {},
  onDevices = () => {},
  onSelectedCameraMissing = () => {},
}) {
  let current
  let activeStream
  let activeCameraId
  // The Camera quality the active track runs at: the one it opened with, or the last one applied.
  let activeResolution
  // Camera qualities the camera being started or shown refused: never tried on it again.
  let refusedResolutions = new Set()
  // A started stream that is still getting its late Camera quality, not yet shown.
  let startingStream
  let startRequest = 0
  let deviceRequest = 0
  let qualityUpdates = Promise.resolve()
  // Bumped at every camera start: operations queued on an older chain do nothing.
  let qualityChain = 0

  const activeTrack = () => activeStream?.getVideoTracks()[0]
  const activeDeviceId = () => activeTrack()?.getSettings().deviceId

  async function refreshDevices() {
    if (!mediaDevices) return
    const request = ++deviceRequest
    try {
      const devices = await mediaDevices.enumerateDevices()
      if (request !== deviceRequest) return
      const cameras = cameraOptionsFrom(devices)
      const selected = current?.cameraId || activeDeviceId()
      onDevices({
        cameras,
        selectedDeviceId: cameras.some((camera) => camera.deviceId === selected) ? selected : undefined,
      })
    } catch {
      if (request !== deviceRequest) return
      onDevices({ error: 'Camera scan failed' })
    }
  }

  async function syncEffectVideo() {
    if (current?.effect !== 'blur' || !activeStream) {
      effectVideo.pause()
      effectVideo.srcObject = null
      return
    }
    if (effectVideo.srcObject !== activeStream) effectVideo.srcObject = activeStream
    try {
      await effectVideo.play()
    } catch {
      // The primary camera video owns playback; a later update can retry the halo.
    }
  }

  function queueQualityUpdate() {
    const chain = qualityChain
    qualityUpdates = qualityUpdates.then(async () => {
      if (chain !== qualityChain) return
      const track = activeTrack()
      const { resolution } = current
      if (!track || track.readyState === 'ended' || !track.applyConstraints) return
      if (resolution === activeResolution || refusedResolutions.has(resolution)) return
      try {
        await track.applyConstraints(cameraTrackConstraintsFor({ resolution }))
        if (track === activeTrack()) activeResolution = resolution
      } catch (error) {
        // An unsupported profile leaves the camera running at its current mode.
        if (error?.name === 'OverconstrainedError' && track === activeTrack()) refusedResolutions.add(resolution)
      }
    })
    return qualityUpdates
  }

  async function getStream(cameraId, resolution) {
    try {
      return await mediaDevices.getUserMedia(cameraConstraintsFor(cameraId, { resolution }))
    } catch (error) {
      if (error.name !== 'OverconstrainedError') throw error
      return mediaDevices.getUserMedia(
        cameraConstraintsFor(cameraId, { allowSlowerFrameRate: true, resolution }),
      )
    }
  }

  async function start(cameraId) {
    if (!mediaDevices) {
      onStatus(undefined)
      onSettled()
      return
    }
    const deviceId = activeDeviceId()
    const reusable =
      cameraId === activeCameraId || (Boolean(cameraId) && cameraId === deviceId)
    if (activeStream && reusable) {
      activeCameraId = cameraId
      // The same update may also have changed the Camera quality (a Scene naming this device).
      await Promise.all([queueQualityUpdate(), refreshDevices()])
      return
    }

    const request = ++startRequest
    onStatus(STARTING_CAMERA_MESSAGE)
    stopTracks(startingStream)
    startingStream = undefined
    // A switch still pending on the old camera (a stalled driver) must not hold back the new one.
    // Operations queued behind it belong to the old chain and do nothing when they finally run, and
    // the pending one no longer matches the active track, so it changes nothing either.
    qualityChain++
    qualityUpdates = Promise.resolve()
    const refused = new Set()
    refusedResolutions = refused
    if (activeStream) {
      stopTracks(activeStream)
      activeStream = undefined
      activeCameraId = undefined
      video.srcObject = null
      effectVideo.srcObject = null
    }

    try {
      let { resolution } = current
      const stream = await getStream(cameraId, resolution)
      if (request !== startRequest) {
        stopTracks(stream)
        return
      }
      const [track] = stream.getVideoTracks()
      // A Camera quality chosen while the camera was starting was skipped then. It is applied to
      // the new track here, before the stream reaches either video, so the change of mode is never
      // seen; and directly, not through the quality chain, which may still wait on the old camera.
      startingStream = stream
      const pending = () => current.resolution !== resolution && !refused.has(current.resolution)
      while (track?.applyConstraints && pending()) {
        const wanted = current.resolution
        try {
          await track.applyConstraints(cameraTrackConstraintsFor({ resolution: wanted }))
          resolution = wanted
        } catch (error) {
          if (error?.name === 'OverconstrainedError') refused.add(wanted)
          else break
        }
        if (request !== startRequest) {
          stopTracks(stream)
          return
        }
      }
      startingStream = undefined
      activeStream = stream
      activeCameraId = cameraId
      activeResolution = resolution
      video.srcObject = stream
      if (track && 'contentHint' in track) track.contentHint = 'motion'
      await video.play()
      await syncEffectVideo()
      await refreshDevices()
      onStatus(undefined)
      onSettled()
    } catch (error) {
      if (request !== startRequest) return
      if (cameraId && (error.name === 'OverconstrainedError' || error.name === 'NotFoundError')) {
        onSelectedCameraMissing()
        return
      }
      onStatus(cameraErrorMessage(error, platform))
      onSettled()
    }
  }

  return {
    // Applies the camera-related Preferences. The first call starts the camera. Later calls only
    // change what changed: a new camera restarts capture, a new Camera quality is applied to the
    // running track, and a new Frame effect attaches or detaches the halo video.
    update({ cameraId = '', resolution, effect }) {
      const previous = current
      current = { cameraId, resolution, effect }
      if (!previous || previous.cameraId !== cameraId) return start(cameraId)
      const work = []
      if (mediaDevices && previous.resolution !== resolution) work.push(queueQualityUpdate())
      if (previous.effect !== effect) work.push(syncEffectVideo())
      return Promise.all(work)
    },
    refreshDevices,
    stop() {
      startRequest++
      effectVideo.srcObject = null
      stopTracks(startingStream)
      stopTracks(activeStream)
    },
  }
}
