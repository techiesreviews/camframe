// Camera framing: the zoom and crop origin of the video inside the Camera surface, independent
// from Overlay size and position. Positions are percentages of the video; zoom is a percentage
// from 100 to 250. Every place that shows framing renders it through `cameraFramingStyles`.

export const CAMERA_ZOOM_MIN = 100
export const CAMERA_ZOOM_MAX = 250
const CAMERA_ZOOM_STEP = 5
// Double-click and the onboarding demo reset framing to this.
export function centeredFraming() {
  return { cameraPosition: { x: 50, y: 50 }, cameraZoom: CAMERA_ZOOM_MIN }
}

const clamp = (value, min, max) => Math.min(max, Math.max(min, value))

// CSS for the camera video. Mirroring flips the element around the same origin it zooms from.
// Known gap KG-10: a mirrored, off-center origin can uncover an edge of the Camera surface.
export function cameraFramingStyles({ cameraPosition, cameraZoom, mirror }) {
  const origin = `${cameraPosition.x}% ${cameraPosition.y}%`
  return {
    transform: `${mirror ? 'scaleX(-1) ' : ''}scale(${cameraZoom / 100})`,
    transformOrigin: origin,
    objectPosition: origin,
  }
}

export function cameraPositionAfterDrag(
  position,
  delta,
  surface,
  mirrored = false,
  zoom = CAMERA_ZOOM_MIN,
) {
  const width = Math.max(1, Number(surface?.width) || 1)
  const height = Math.max(1, Number(surface?.height) || 1)
  const zoomOverflow = Number(zoom) / 100 - 1
  const overflowScale = zoomOverflow > 0 ? zoomOverflow : 1
  return {
    x:
      Math.round(
        clamp(
          position.x + ((mirrored ? delta.x : -delta.x) / (width * overflowScale)) * 100,
          0,
          100,
        ) * 10,
      ) / 10,
    y:
      Math.round(clamp(position.y - (delta.y / (height * overflowScale)) * 100, 0, 100) * 10) /
      10,
  }
}

export function cameraZoomAfterWheel(zoom, deltaY) {
  const currentZoom = Number.isFinite(zoom) ? zoom : CAMERA_ZOOM_MIN
  if (!Number.isFinite(deltaY) || deltaY === 0) return currentZoom
  const step = deltaY < 0 ? CAMERA_ZOOM_STEP : -CAMERA_ZOOM_STEP
  return Math.round(clamp(currentZoom + step, CAMERA_ZOOM_MIN, CAMERA_ZOOM_MAX))
}
