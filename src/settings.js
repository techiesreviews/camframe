export const SHAPES = new Set(['circle', 'rounded', 'portrait', 'landscape'])
export const CAPTURE_RESOLUTIONS = new Set(['480p', '720p', '1080p', '2160p'])

export const DEFAULT_SETTINGS = Object.freeze({
  schemaVersion: 5,
  cameraId: '',
  cameraLabel: 'Default camera',
  shape: 'circle',
  size: 288,
  overlayResolution: '720p',
  fullscreenResolution: '2160p',
  borderWidth: 0,
  borderColor: '#ffffff',
  mirror: true,
  cameraPosition: Object.freeze({ x: 50, y: 50 }),
  alwaysOnTop: true,
  overlayVisible: true,
  position: null,
})

const clamp = (value, min, max) => Math.min(max, Math.max(min, value))

export function sanitizeSettings(input = {}) {
  const settings = { ...DEFAULT_SETTINGS, cameraPosition: { ...DEFAULT_SETTINGS.cameraPosition } }

  if (typeof input.cameraId === 'string') settings.cameraId = input.cameraId.slice(0, 512)
  if (typeof input.cameraLabel === 'string') settings.cameraLabel = input.cameraLabel.slice(0, 120)
  if (SHAPES.has(input.shape)) settings.shape = input.shape
  if (Number.isFinite(input.size)) settings.size = Math.round(clamp(input.size, 180, 640))
  if (CAPTURE_RESOLUTIONS.has(input.overlayResolution)) {
    settings.overlayResolution = input.overlayResolution
  }
  if (CAPTURE_RESOLUTIONS.has(input.fullscreenResolution)) {
    settings.fullscreenResolution = input.fullscreenResolution
  }
  if (Number.isFinite(input.borderWidth)) {
    settings.borderWidth = Math.round(clamp(input.borderWidth, 0, 12))
  }
  if (/^#[0-9a-f]{6}$/i.test(input.borderColor ?? '')) settings.borderColor = input.borderColor
  if (typeof input.mirror === 'boolean') settings.mirror = input.mirror
  if (input.cameraPosition) {
    if (Number.isFinite(input.cameraPosition.x)) {
      settings.cameraPosition.x = Math.round(clamp(input.cameraPosition.x, 0, 100) * 10) / 10
    }
    if (Number.isFinite(input.cameraPosition.y)) {
      settings.cameraPosition.y = Math.round(clamp(input.cameraPosition.y, 0, 100) * 10) / 10
    }
  }
  if (typeof input.alwaysOnTop === 'boolean') settings.alwaysOnTop = input.alwaysOnTop
  if (typeof input.overlayVisible === 'boolean') settings.overlayVisible = input.overlayVisible
  if (
    input.position &&
    Number.isInteger(input.position.x) &&
    Number.isInteger(input.position.y)
  ) {
    settings.position = { x: input.position.x, y: input.position.y }
  }

  return settings
}

export function cameraPositionAfterDrag(position, delta, surface, mirrored = false) {
  const width = Math.max(1, Number(surface?.width) || 1)
  const height = Math.max(1, Number(surface?.height) || 1)
  return {
    x:
      Math.round(
        clamp(position.x + ((mirrored ? delta.x : -delta.x) / width) * 100, 0, 100) * 10,
      ) / 10,
    y: Math.round(clamp(position.y - (delta.y / height) * 100, 0, 100) * 10) / 10,
  }
}

export function startupSettings(input = {}) {
  return {
    ...sanitizeSettings(input),
    alwaysOnTop: true,
    overlayVisible: true,
  }
}

export function settingsPatchChangesOverlayGeometry(patch = {}) {
  return ['shape', 'size', 'position'].some((key) => Object.hasOwn(patch, key))
}

export function dimensionsFor(settings) {
  const size = settings.size
  if (settings.shape === 'portrait') return { width: Math.round(size * 0.75), height: size }
  if (settings.shape === 'landscape') return { width: size, height: Math.round(size * 0.5625) }
  return { width: size, height: size }
}

export function resizeOverlayFromCorner(settings, windowBounds, handle, delta) {
  const startCamera = dimensionsFor(settings)
  const scaleX = startCamera.width / settings.size
  const scaleY = startCamera.height / settings.size
  const horizontalDirection = handle.includes('left') ? -1 : 1
  const verticalDirection = handle.includes('top') ? -1 : 1
  const horizontalChange = (horizontalDirection * delta.x) / scaleX
  const verticalChange = (verticalDirection * delta.y) / scaleY
  const sizeChange =
    Math.abs(horizontalChange) >= Math.abs(verticalChange) ? horizontalChange : verticalChange
  const size = Math.round(clamp(settings.size + sizeChange, 180, 640))
  const nextCamera = dimensionsFor({ ...settings, size })

  return {
    size,
    position: {
      x: windowBounds.x + (handle.includes('left') ? startCamera.width - nextCamera.width : 0),
      y: windowBounds.y + (handle.includes('top') ? startCamera.height - nextCamera.height : 0),
    },
  }
}

export const OVERLAY_CHROME = Object.freeze({ top: 84, right: 18, bottom: 18, left: 18 })

export function overlayDimensionsFor(settings) {
  const camera = dimensionsFor(settings)
  return {
    width: camera.width + OVERLAY_CHROME.left + OVERLAY_CHROME.right,
    height: camera.height + OVERLAY_CHROME.top + OVERLAY_CHROME.bottom,
  }
}

function radiusFor(shape, width, height) {
  if (shape === 'circle') return Math.min(width, height) / 2
  if (shape === 'rounded') return Math.round(Math.min(width, height) * 0.16)
  return Math.round(Math.min(width, height) * 0.12)
}

export function regionsFor(shape, width, height, step = 2) {
  const radius = radiusFor(shape, width, height)
  const regions = []

  for (let y = 0; y < height; y += step) {
    const bandHeight = Math.min(step, height - y)
    const sampleY = Math.min(y + bandHeight / 2, height - 0.5)
    let inset = 0

    if (sampleY < radius) {
      const dy = radius - sampleY
      inset = Math.ceil(radius - Math.sqrt(Math.max(0, radius * radius - dy * dy)))
    } else if (sampleY > height - radius) {
      const dy = sampleY - (height - radius)
      inset = Math.ceil(radius - Math.sqrt(Math.max(0, radius * radius - dy * dy)))
    }

    regions.push({
      x: inset,
      y,
      width: Math.max(1, width - inset * 2),
      height: bandHeight,
    })
  }

  return regions
}

function offsetRegions(regions, x, y) {
  return regions.map((region) => ({ ...region, x: region.x + x, y: region.y + y }))
}

function bracketRegions(x, y, horizontalDirection, verticalDirection) {
  const length = 17
  const thickness = 2
  return [
    {
      x: horizontalDirection > 0 ? x : x - length + thickness,
      y,
      width: length,
      height: thickness,
    },
    {
      x,
      y: verticalDirection > 0 ? y : y - length + thickness,
      width: thickness,
      height: length,
    },
  ]
}

export function overlayRegionsFor(settings, hovered = false, controlsOpen = false) {
  const camera = dimensionsFor(settings)
  const left = OVERLAY_CHROME.left
  const top = OVERLAY_CHROME.top
  const antialiasHalo = 3
  const regions = offsetRegions(
    regionsFor(
      settings.shape,
      camera.width + antialiasHalo * 2,
      camera.height + antialiasHalo * 2,
      1,
    ),
    left - antialiasHalo,
    top - antialiasHalo,
  )

  if (!hovered) return regions

  const overlayWidth = camera.width + OVERLAY_CHROME.left + OVERLAY_CHROME.right
  const toolbarWidth = Math.min(240, overlayWidth - 8)
  const toolbarX = Math.round((overlayWidth - toolbarWidth) / 2)
  regions.push(...offsetRegions(regionsFor('rounded', toolbarWidth, 44, 1), toolbarX, 22))

  const inset = 10
  const right = left + camera.width
  const bottom = top + camera.height
  regions.push(...bracketRegions(left + inset, top + inset, 1, 1))
  regions.push(...bracketRegions(right - inset - 2, top + inset, -1, 1))
  regions.push(...bracketRegions(left + inset, bottom - inset - 2, 1, -1))
  regions.push(...bracketRegions(right - inset - 2, bottom - inset - 2, -1, -1))

  if (controlsOpen) {
    const controlsWidth = Math.min(240, camera.width - 28)
    const controlsX = Math.round(left + (camera.width - controlsWidth) / 2)
    const overlayHeight = camera.height + OVERLAY_CHROME.top + OVERLAY_CHROME.bottom
    const controlsHeight = Math.min(268, overlayHeight - 76)
    regions.push(
      ...offsetRegions(regionsFor('rounded', controlsWidth, controlsHeight, 1), controlsX, 76),
    )
  }

  return regions
}
