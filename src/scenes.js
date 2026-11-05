import { OVERLAY_CHROME, SCENE_LIMIT, overlayDimensionsFor, sanitizeSettings, settingsForPreset } from './settings.js'
import { keepInside, planCompactLayout } from './overlay-geometry.js'

// The Scene library owns every Scene rule: naming, ids, the Scene limit, ordering, import/export,
// and which Scene is active. Each operation takes the current `{ settings, activeSceneId }` and
// returns the next one when something changed, plus an optional presentation `notice`.
// `appliedScene` marks a result whose Overlay geometry should move to the Scene. Operations that
// change nothing return `undefined`. Callers keep dialogs, file I/O, window effects, and persistence.

const SCENE_EXPORT_FORMAT = 'camframe-scenes'
const SCENE_EXPORT_VERSION = 1
export const SCENE_IMPORT_ERROR = 'That file is not a valid CamFrame scene export.'
export const NO_SCENES_NOTICE = 'No saved scenes'

const defaultSceneId = () => `preset-${Date.now().toString(36)}`
// Scene names match without regard to case or to composed versus decomposed accents.
const sameName = (left, right) => left.normalize('NFC').toLocaleLowerCase() === right.normalize('NFC').toLocaleLowerCase()

function withScenes(settings, scenes) {
  return sanitizeSettings({ ...settings, presets: scenes })
}

// A Scene saved from Compact mode remembers where the Overlay is now, not where it was last saved.
function settingsWithLivePosition(settings, windowBounds, fullscreen = false) {
  if (
    fullscreen ||
    !Number.isInteger(windowBounds?.x) ||
    !Number.isInteger(windowBounds?.y)
  ) {
    return settings
  }
  return { ...settings, position: { x: windowBounds.x, y: windowBounds.y } }
}

// Any ordinary settings change means the Overlay no longer matches the active Scene.
export function patchSettings({ settings }, patch) {
  return { settings: sanitizeSettings({ ...settings, ...patch }), activeSceneId: '' }
}

export function saveScene(
  { settings },
  { name: nameInput, id: idInput = '', liveBounds, fullscreen = false, createId = defaultSceneId },
) {
  const name = String(nameInput ?? '').trim().slice(0, 40)
  if (!name) return undefined

  const live = settingsWithLivePosition(settings, liveBounds, fullscreen)
  const requestedId = String(idInput ?? '')
  const existing =
    live.presets.find((scene) => scene.id === requestedId) ??
    live.presets.find((scene) => sameName(scene.name, name))
  const scene = { id: existing?.id ?? createId(), name, settings: settingsForPreset(live) }
  const scenes = existing
    ? live.presets.map((candidate) => (candidate.id === scene.id ? scene : candidate))
    : [...live.presets.slice(-(SCENE_LIMIT - 1)), scene]
  return {
    settings: withScenes(live, scenes),
    activeSceneId: scene.id,
    notice: `${name} saved`,
  }
}

// The size and place a layout Scene gets now, planned with the live shape; else its saved size and
// place (no work area known, or the display is too small even for the smallest camera). With a work
// area known, the saved place is kept inside it, so the camera never opens off screen.
// A layout with a place is planned on the display the Overlay is on or heading to
// (`context.workArea`). One without a place keeps its saved camera point on the display nearest
// that point (`context.workAreaAt`), shrunk and kept on screen there.
export function layoutSceneGeometry(scene, settings, { workArea, workAreaAt } = {}) {
  const { layout } = scene
  const requestedSize = layout.size === 'small' ? settings.prompterSmallSize : layout.size
  const saved = { size: scene.settings.size, position: scene.settings.position }
  const point =
    !layout.position && saved.position
      ? { x: saved.position.x + OVERLAY_CHROME.left, y: saved.position.y + OVERLAY_CHROME.top }
      : undefined
  const area = point && workAreaAt ? workAreaAt(point) : workArea
  const plan =
    area && (layout.position || point)
      ? planCompactLayout(
          {
            shape: settings.shape,
            size: requestedSize,
            spot: layout.position,
            point,
            margin: layout.position ? (layout.margin ?? settings.prompterMargin) : 0,
            withinRight: layout.withinRight,
          },
          { workArea: area },
        )
      : undefined
  if (!plan || plan.error) {
    const window = overlayDimensionsFor({ shape: settings.shape, size: saved.size })
    const position =
      area && saved.position
        ? {
            x: keepInside(saved.position.x, area.x, area.width, window.width),
            y: keepInside(saved.position.y, area.y, area.height, window.height),
          }
        : saved.position
    // `clamped` is also true when the Scene's rule could not be met (no room even for the smallest
    // camera in its place), so a cue answer never reports a clean fit for the fallback.
    return { ...saved, position, requestedSize, clamped: Boolean(plan?.error) || saved.size !== requestedSize }
  }
  return { size: plan.size, position: plan.position, clamped: plan.clamped, requestedSize }
}

// A layout Scene changes only size and place and keeps the live look; any other Scene applies
// everything it saved. `context` (`workArea`, `workAreaAt`) lets a layout Scene fit the right display.
export function applyScene({ settings }, idInput, context = {}) {
  const id = String(idInput ?? '')
  const scene = settings.presets.find((candidate) => candidate.id === id)
  if (!scene) return undefined
  const geometry = scene.layout ? layoutSceneGeometry(scene, settings, context) : undefined
  const applied = geometry
    ? { ...settings, size: geometry.size, position: geometry.position }
    : { ...settings, ...scene.settings, presets: settings.presets }
  return {
    settings: sanitizeSettings(applied),
    activeSceneId: scene.id,
    notice: scene.name,
    appliedScene: scene,
    ...(geometry ? { layout: geometry } : {}),
  }
}

// Saves a layout Scene (Prompter link). Never evicts a Scene: a new name past SCENE_LIMIT and an
// existing name without `replace` are refused with `{ error, code, status }`. Replacing keeps the
// Scene's id and order. The Active Scene stays, unless it was the Scene replaced.
export function saveLayoutScene(
  { settings, activeSceneId },
  { name: nameInput, size, position, layout, replace = false, createId = defaultSceneId },
) {
  const name = String(nameInput ?? '').trim().slice(0, 40)
  if (!name) return { error: 'A Scene needs a name.', code: 'bad-request', status: 400 }
  const existing = settings.presets.find((scene) => sameName(scene.name, name))
  if (existing && !replace) {
    return {
      error: `CamFrame already has a Scene named "${existing.name}". Send "replace": true to save over it.`,
      code: 'scene-exists',
      status: 409,
    }
  }
  if (!existing && settings.presets.length >= SCENE_LIMIT) {
    return {
      error: `CamFrame already has ${SCENE_LIMIT} Scenes, the most it keeps. Delete one in CamFrame, or save over an existing name with "replace": true.`,
      code: 'scene-limit',
      status: 409,
    }
  }
  // Two saves in the same millisecond would share a time-based id.
  let id = existing?.id ?? createId()
  for (let attempt = 2; !existing && settings.presets.some((candidate) => candidate.id === id); attempt += 1) {
    id = `${createId()}-${attempt}`
  }
  const scene = {
    id,
    name,
    settings: settingsForPreset({ ...settings, size, position }),
    layout,
  }
  const scenes = existing
    ? settings.presets.map((candidate) => (candidate.id === scene.id ? scene : candidate))
    : [...settings.presets, scene]
  const next = withScenes(settings, scenes)
  return {
    settings: next,
    activeSceneId: existing && existing.id === activeSceneId ? '' : activeSceneId,
    scene: next.presets.find((candidate) => candidate.id === scene.id),
    replaced: Boolean(existing),
    notice: `${name} saved`,
  }
}

export function applySceneAt(state, index, context = {}) {
  const scene = state.settings.presets[index]
  return scene ? applyScene(state, scene.id, context) : undefined
}

export function cycleScene(state, context = {}) {
  const scenes = state.settings.presets
  if (!scenes.length) return { notice: NO_SCENES_NOTICE }
  const currentIndex = scenes.findIndex((scene) => scene.id === state.activeSceneId)
  return applyScene(state, scenes[(currentIndex + 1) % scenes.length].id, context)
}

export function deleteScene({ settings, activeSceneId }, idInput) {
  const id = String(idInput ?? '')
  const scenes = settings.presets.filter((scene) => scene.id !== id)
  if (scenes.length === settings.presets.length) return undefined
  return {
    settings: withScenes(settings, scenes),
    activeSceneId: activeSceneId === id ? '' : activeSceneId,
    notice: 'Scene deleted',
  }
}

export function reorderScene({ settings, activeSceneId }, idInput, directionInput) {
  const scenes = [...settings.presets]
  const index = scenes.findIndex((scene) => scene.id === String(idInput ?? ''))
  const target = index + Math.sign(Number(directionInput) || 0)
  if (index < 0 || target === index || target < 0 || target >= scenes.length) return undefined
  ;[scenes[index], scenes[target]] = [scenes[target], scenes[index]]
  return { settings: withScenes(settings, scenes), activeSceneId }
}

function mergeScenes(existingScenes, importedScenes) {
  const next = [...existingScenes]
  for (const imported of importedScenes) {
    const match = next.findIndex(
      (scene) => scene.id === imported.id || sameName(scene.name, imported.name),
    )
    if (match >= 0) {
      next[match] = { ...imported, id: next[match].id }
    } else if (next.length < SCENE_LIMIT) {
      next.push(imported)
    }
  }
  return sanitizeSettings({ presets: next }).presets
}

// Accepts an export object (`scenes`, or legacy `presets`) or a bare array. See KG-09.
export function importScenes({ settings, activeSceneId }, documentText) {
  let imported
  try {
    const payload = JSON.parse(documentText)
    const source = Array.isArray(payload) ? payload : (payload.scenes ?? payload.presets)
    imported = sanitizeSettings({ presets: source }).presets
  } catch {
    return { error: SCENE_IMPORT_ERROR }
  }
  if (!imported.length) return { error: 'No valid scenes found.' }
  return {
    settings: withScenes(settings, mergeScenes(settings.presets, imported)),
    activeSceneId,
    importedCount: imported.length,
    notice: `${imported.length} scene${imported.length === 1 ? '' : 's'} imported`,
  }
}

export function sceneExport({ settings }) {
  return { format: SCENE_EXPORT_FORMAT, version: SCENE_EXPORT_VERSION, scenes: settings.presets }
}
