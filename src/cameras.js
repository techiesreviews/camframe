export function cameraTrackConstraintsFor(
  fullscreen = false,
  { allowSlowerFrameRate = false } = {},
) {
  if (fullscreen) {
    return {
      width: { ideal: 3840 },
      height: { ideal: 2160 },
      frameRate: { ideal: 30, max: 30 },
    }
  }

  return {
    width: { ideal: 1280 },
    height: { ideal: 720 },
    frameRate: {
      ideal: 60,
      ...(!allowSlowerFrameRate ? { min: 30 } : {}),
      max: 60,
    },
  }
}

export function cameraConstraintsFor(
  cameraId,
  { allowSlowerFrameRate = false, fullscreen = false } = {},
) {
  return {
    audio: false,
    video: {
      ...(cameraId ? { deviceId: { exact: cameraId } } : {}),
      ...cameraTrackConstraintsFor(fullscreen, { allowSlowerFrameRate }),
    },
  }
}

export async function applyCameraTrackProfile(track, fullscreen) {
  if (!track?.applyConstraints) return false
  try {
    await track.applyConstraints(cameraTrackConstraintsFor(fullscreen))
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
