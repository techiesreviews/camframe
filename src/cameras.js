export function cameraTrackConstraintsFor({ allowSlowerFrameRate = false, resolution } = {}) {
  const resolutions = {
    '480p': { width: 854, height: 480 },
    '720p': { width: 1280, height: 720 },
    '1080p': { width: 1920, height: 1080 },
    '2160p': { width: 3840, height: 2160 },
  }
  const selectedResolution = resolutions[resolution] ?? resolutions['720p']

  return {
    width: { ideal: selectedResolution.width },
    height: { ideal: selectedResolution.height },
    frameRate: {
      ideal: 60,
      ...(!allowSlowerFrameRate ? { min: 30 } : {}),
      max: 60,
    },
  }
}

export function cameraConstraintsFor(
  cameraId,
  { allowSlowerFrameRate = false, resolution } = {},
) {
  return {
    audio: false,
    video: {
      ...(cameraId ? { deviceId: { exact: cameraId } } : {}),
      ...cameraTrackConstraintsFor({ allowSlowerFrameRate, resolution }),
    },
  }
}

export async function applyCameraTrackProfile(track, resolution) {
  if (!track?.applyConstraints) return false
  try {
    await track.applyConstraints(cameraTrackConstraintsFor({ resolution }))
    return true
  } catch {
    return false
  }
}

export function configureCameraTrack(track) {
  if ('contentHint' in track) track.contentHint = 'motion'
}

export function cameraOptionsFrom(devices = []) {
  return devices
    .filter((device) => device.kind === 'videoinput')
    .map((device, index) => ({
      deviceId: device.deviceId,
      label: device.label || `Camera ${index + 1}`,
    }))
}

export function canReuseCameraStream(requestedId, activeId, activeDeviceId) {
  return requestedId === activeId || (Boolean(requestedId) && requestedId === activeDeviceId)
}
