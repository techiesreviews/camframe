import {
  completedOnboardingVersionForLoad,
  sanitizeCompletedOnboardingVersion,
} from './onboarding.js'
import { CAMERA_ZOOM_MAX, CAMERA_ZOOM_MIN } from './camera-framing.js'

export const SHAPES = new Set(['circle', 'rounded', 'portrait', 'landscape'])
export const CAPTURE_RESOLUTIONS = new Set(['480p', '720p', '1080p', '2160p'])
export const FRAME_EFFECTS = new Set(['none', 'glow', 'blur'])
export const SCENE_LIMIT = 6
// The places a Prompter link cue can put the Compact Overlay on its current display.
export const COMPACT_SPOTS = Object.freeze([
  'top-left',
  'top-right',
  'bottom-left',
  'bottom-right',
  'left',
  'right',
  'center',
])
export const PROMPTER_MARGIN_MIN = 0
export const PROMPTER_MARGIN_MAX = 160
// The camera size range (px). For a circle or rounded square it is the side; portrait and
// landscape derive their other side from it (`dimensionsFor`).
export const CAMERA_SIZE_MIN = 180
export const CAMERA_SIZE_MAX = 640
const SCENE_CHOICE_PATTERN = /^scene:[\s\S]{1,64}$/
export const PRESET_SETTING_KEYS = Object.freeze([
  'cameraId',
  'cameraLabel',
  'shape',
  'size',
  'overlayResolution',
  'frameEffect',
  'effectColor',
  'glowStrength',
  'glowSpread',
  'blurAmount',
  'blurOpacity',
  'borderWidth',
  'borderColor',
  'mirror',
  'cameraZoom',
  'cameraPosition',
  'position',
])

export const DEFAULT_SETTINGS = Object.freeze({
  schemaVersion: 14,
  cameraId: '',
  cameraLabel: 'Default camera',
  shape: 'circle',
  size: 288,
  overlayResolution: '720p',
  frameEffect: 'none',
  effectColor: '#fb923c',
  glowStrength: 90,
  glowSpread: 13,
  blurAmount: 12,
  blurOpacity: 72,
  borderWidth: 0,
  borderColor: '#ffffff',
  mirror: true,
  cameraZoom: 100,
  cameraPosition: Object.freeze({ x: 50, y: 50 }),
  alwaysOnTop: true,
  overlayVisible: true,
  launchAtLogin: false,
  completedOnboardingVersion: 0,
  position: null,
  prompterLink: false,
  prompterFaceFull: 'fullscreen',
  prompterFaceSmall: 'previous',
  prompterMargin: 32,
  // The camera size a Prompter link "small" cue restores. Scenes and Prompter layouts never change
  // it; resizing the Overlay by hand and `POST /camframe/small-size` do. Missing means `size`.
  prompterSmallSize: 288,
  presets: Object.freeze([]),
})

const clamp = (value, min, max) => Math.min(max, Math.max(min, value))

export function sanitizeSettings(input = {}, includePresets = true) {
  const settings = {
    ...DEFAULT_SETTINGS,
    cameraPosition: { ...DEFAULT_SETTINGS.cameraPosition },
    presets: [],
  }

  if (typeof input.cameraId === 'string') settings.cameraId = input.cameraId.slice(0, 512)
  if (typeof input.cameraLabel === 'string') settings.cameraLabel = input.cameraLabel.slice(0, 120)
  if (SHAPES.has(input.shape)) settings.shape = input.shape
  if (Number.isFinite(input.size)) {
    settings.size = Math.round(clamp(input.size, CAMERA_SIZE_MIN, CAMERA_SIZE_MAX))
  }
  if (CAPTURE_RESOLUTIONS.has(input.overlayResolution)) {
    settings.overlayResolution = input.overlayResolution
  }
  if (FRAME_EFFECTS.has(input.frameEffect)) settings.frameEffect = input.frameEffect
  if (/^#[0-9a-f]{6}$/i.test(input.effectColor ?? '')) settings.effectColor = input.effectColor
  if (Number.isFinite(input.glowStrength)) {
    settings.glowStrength = Math.round(clamp(input.glowStrength, 10, 100))
  }
  if (Number.isFinite(input.glowSpread)) {
    settings.glowSpread = Math.round(clamp(input.glowSpread, 4, 18))
  }
  if (Number.isFinite(input.blurAmount)) {
    settings.blurAmount = Math.round(clamp(input.blurAmount, 4, 18))
  }
  if (Number.isFinite(input.blurOpacity)) {
    settings.blurOpacity = Math.round(clamp(input.blurOpacity, 10, 100))
  }
  if (Number.isFinite(input.borderWidth)) {
    settings.borderWidth = Math.round(clamp(input.borderWidth, 0, 12))
  }
  if (/^#[0-9a-f]{6}$/i.test(input.borderColor ?? '')) settings.borderColor = input.borderColor
  if (typeof input.mirror === 'boolean') settings.mirror = input.mirror
  if (Number.isFinite(input.cameraZoom)) {
    settings.cameraZoom = Math.round(clamp(input.cameraZoom, CAMERA_ZOOM_MIN, CAMERA_ZOOM_MAX))
  }
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
  if (typeof input.launchAtLogin === 'boolean') settings.launchAtLogin = input.launchAtLogin
  if (typeof input.prompterLink === 'boolean') settings.prompterLink = input.prompterLink
  if (
    typeof input.prompterFaceFull === 'string' &&
    (input.prompterFaceFull === 'fullscreen' || SCENE_CHOICE_PATTERN.test(input.prompterFaceFull))
  ) {
    settings.prompterFaceFull = input.prompterFaceFull
  }
  if (
    typeof input.prompterFaceSmall === 'string' &&
    (input.prompterFaceSmall === 'previous' ||
      COMPACT_SPOTS.includes(input.prompterFaceSmall) ||
      SCENE_CHOICE_PATTERN.test(input.prompterFaceSmall))
  ) {
    settings.prompterFaceSmall = input.prompterFaceSmall
  }
  if (Number.isFinite(input.prompterMargin)) {
    settings.prompterMargin = Math.round(
      clamp(input.prompterMargin, PROMPTER_MARGIN_MIN, PROMPTER_MARGIN_MAX),
    )
  }
  settings.prompterSmallSize = Number.isFinite(input.prompterSmallSize)
    ? Math.round(clamp(input.prompterSmallSize, CAMERA_SIZE_MIN, CAMERA_SIZE_MAX))
    : settings.size
  settings.completedOnboardingVersion = sanitizeCompletedOnboardingVersion(
    input.completedOnboardingVersion,
  )
  if (
    input.position &&
    Number.isInteger(input.position.x) &&
    Number.isInteger(input.position.y)
  ) {
    settings.position = { x: input.position.x, y: input.position.y }
  }

  if (includePresets && Array.isArray(input.presets)) {
    settings.presets = input.presets.slice(0, SCENE_LIMIT).flatMap((preset) => {
      const id = typeof preset?.id === 'string' ? preset.id.slice(0, 64) : ''
      const name = typeof preset?.name === 'string' ? preset.name.trim().slice(0, 40) : ''
      if (!id || !name || !preset.settings) return []
      const layout = sanitizeSceneLayout(preset.layout)
      const scene = { id, name, settings: settingsForPreset(preset.settings) }
      return [layout ? { ...scene, layout } : scene]
    })
  }

  return settings
}

// A Scene with a `layout` is a layout Scene (saved through the Prompter link): applying it changes
// only the Overlay size and place, planned on the display the Overlay is on or heading to (a place) or
// the display nearest its saved point (no place), and keeps the live
// camera, shape, appearance and framing. `position` is a place name; without one the Scene's saved
// `settings.position` is used. `withinRight` keeps the camera inside that share of the display's
// right side. Anything invalid drops the layout, so the Scene stays an ordinary Scene.
export function sanitizeSceneLayout(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return undefined
  // `"small"` follows the small size when applied, so the Scene and a `"small"` cue always agree.
  if (
    input.size !== 'small' &&
    (!Number.isInteger(input.size) || input.size < CAMERA_SIZE_MIN || input.size > CAMERA_SIZE_MAX)
  ) {
    return undefined
  }
  const layout = { size: input.size }
  if (input.position !== undefined) {
    if (!COMPACT_SPOTS.includes(input.position)) return undefined
    layout.position = input.position
  }
  if (input.margin !== undefined) {
    if (
      !Number.isInteger(input.margin) ||
      input.margin < PROMPTER_MARGIN_MIN ||
      input.margin > PROMPTER_MARGIN_MAX ||
      !layout.position
    ) {
      return undefined
    }
    layout.margin = input.margin
  }
  if (input.withinRight !== undefined) {
    if (!isWithinRightShare(input.withinRight) || !layout.position?.endsWith('right')) return undefined
    layout.withinRight = input.withinRight
  }
  return layout
}

export const WITHIN_RIGHT_MIN = 0.1
export const WITHIN_RIGHT_MAX = 1
export function isWithinRightShare(value) {
  return Number.isFinite(value) && value >= WITHIN_RIGHT_MIN && value <= WITHIN_RIGHT_MAX
}

// The camera, shape, appearance and framing of a settings object: everything a Scene stores
// except its size and place. A layout Scene keeps these from the live settings.
export const LOOK_SETTING_KEYS = Object.freeze(
  PRESET_SETTING_KEYS.filter((key) => key !== 'size' && key !== 'position'),
)

// A corner resize by hand (the geometry reports one only after the pointer moved). It also sets the
// small size whenever the size changes, so the size let go at always wins.
export function settingsAfterHandResize(settings, patch) {
  const next = sanitizeSettings({ ...settings, ...patch })
  if (Number.isFinite(patch.size) && next.size !== settings.size) next.prompterSmallSize = next.size
  return next
}

export function settingsForPreset(input = {}) {
  const settings = sanitizeSettings(input, false)
  return Object.fromEntries(
    PRESET_SETTING_KEYS.map((key) => {
      const value = settings[key]
      if (value && typeof value === 'object') return [key, { ...value }]
      return [key, value]
    }),
  )
}






function startupSettings(input = {}) {
  return {
    ...sanitizeSettings(input),
    alwaysOnTop: true,
    overlayVisible: true,
  }
}

// Turns the raw `preferences.json` text (undefined when the file is missing) into launch settings.
export function preferencesFromDocument(documentText) {
  let saved
  try {
    saved = JSON.parse(documentText)
  } catch {
    return startupSettings()
  }
  if (saved === null || typeof saved !== 'object') return startupSettings()
  if ((saved.schemaVersion ?? 0) < 3) {
    saved.borderWidth = 0
    saved.size = DEFAULT_SETTINGS.size
  }
  saved.completedOnboardingVersion = completedOnboardingVersionForLoad(saved, true)
  return startupSettings(saved)
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

export const OVERLAY_CHROME = Object.freeze({ top: 84, right: 18, bottom: 18, left: 18 })

export function overlayDimensionsFor(settings) {
  const camera = dimensionsFor(settings)
  return {
    width: camera.width + OVERLAY_CHROME.left + OVERLAY_CHROME.right,
    height: camera.height + OVERLAY_CHROME.top + OVERLAY_CHROME.bottom,
  }
}
