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
  let startRequest = 0
  let deviceRequest = 0
  let qualityUpdates = Promise.resolve()

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
    qualityUpdates = qualityUpdates.then(async () => {
      const track = activeTrack()
      if (!track || track.readyState === 'ended' || !track.applyConstraints) return
      try {
        await track.applyConstraints(cameraTrackConstraintsFor({ resolution: current.resolution }))
      } catch {
        // An unsupported profile leaves the camera running at its current mode.
      }
    })
    return qualityUpdates
  }

  async function getStream(cameraId) {
    try {
      return await mediaDevices.getUserMedia(
        cameraConstraintsFor(cameraId, { resolution: current.resolution }),
      )
    } catch (error) {
      if (error.name !== 'OverconstrainedError') throw error
      return mediaDevices.getUserMedia(
        cameraConstraintsFor(cameraId, { allowSlowerFrameRate: true, resolution: current.resolution }),
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
      await refreshDevices()
      return
    }

    const request = ++startRequest
    onStatus(STARTING_CAMERA_MESSAGE)
    if (activeStream) {
      stopTracks(activeStream)
      activeStream = undefined
      activeCameraId = undefined
      video.srcObject = null
      effectVideo.srcObject = null
    }

    try {
      const stream = await getStream(cameraId)
      if (request !== startRequest) {
        stopTracks(stream)
        return
      }
      activeStream = stream
      activeCameraId = cameraId
      video.srcObject = stream
      const [track] = stream.getVideoTracks()
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
      effectVideo.srcObject = null
      stopTracks(activeStream)
    },
  }
}
