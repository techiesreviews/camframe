import { SCENE_LIMIT, sanitizeSettings, settingsForPreset } from './settings.js'

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
const sameName = (left, right) => left.toLocaleLowerCase() === right.toLocaleLowerCase()

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

export function applyScene({ settings }, idInput) {
  const id = String(idInput ?? '')
  const scene = settings.presets.find((candidate) => candidate.id === id)
  if (!scene) return undefined
  return {
    settings: sanitizeSettings({ ...settings, ...scene.settings, presets: settings.presets }),
    activeSceneId: scene.id,
    notice: scene.name,
    appliedScene: scene,
  }
}

export function applySceneAt(state, index) {
  const scene = state.settings.presets[index]
  return scene ? applyScene(state, scene.id) : undefined
}

export function cycleScene(state) {
  const scenes = state.settings.presets
  if (!scenes.length) return { notice: NO_SCENES_NOTICE }
  const currentIndex = scenes.findIndex((scene) => scene.id === state.activeSceneId)
  return applyScene(state, scenes[(currentIndex + 1) % scenes.length].id)
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
