export function cameraConstraintsFor(cameraId, { allowSlowerFrameRate = false } = {}) {
  return {
    audio: false,
    video: {
      ...(cameraId ? { deviceId: { exact: cameraId } } : {}),
      width: { ideal: 1280 },
      height: { ideal: 720 },
      frameRate: {
        ideal: 60,
        ...(!allowSlowerFrameRate ? { min: 30 } : {}),
        max: 60,
      },
    },
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
