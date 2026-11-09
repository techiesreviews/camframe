import {
  OVERLAY_CHROME,
  PRESET_SETTING_KEYS,
  SCENE_LIMIT,
  overlayDimensionsFor,
  sanitizeSettings,
  settingsForPreset,
} from './settings.js'
import { cameraRectFor, compactBaseBounds, keepInside, planCompactLayout } from './overlay-geometry.js'

// The Scene library owns every Scene rule: naming, ids, the Scene limit, ordering, import/export,
// and which Scene is active. Each operation takes the current `{ settings, activeSceneId }` and
// returns the next one when something changed, plus an optional presentation `notice`. Saving and
// applying a Scene show no notice: the Overlay is what gets captured on stream, so no Scene name is
// drawn on it (ADR 0036). `announce` is the Scene name for screen readers only.
// `appliedScene` marks a result whose Overlay geometry should move to the Scene. Operations that
// change nothing return `undefined`. Callers keep dialogs, file I/O, window effects, and persistence.

const SCENE_EXPORT_FORMAT = 'camframe-scenes'
const SCENE_EXPORT_VERSION = 1
export const SCENE_IMPORT_ERROR = 'That file is not a valid CamFrame scene export.'
export const NO_SCENES_NOTICE = 'No saved scenes'

const defaultSceneId = () => `preset-${Date.now().toString(36)}`
// Scene names match without regard to case, to composed versus decomposed accents, or to joiners,
// variation selectors and emoji tags (invisible, so two such names look the same).
const INVISIBLE_WHEN_MATCHING = /[\u200c\u200d\ufe00-\ufe0f\u{e0020}-\u{e007f}\u{e0100}-\u{e01ef}]/gu
const nameKey = (name) => name.normalize('NFC').replace(INVISIBLE_WHEN_MATCHING, '').toLocaleLowerCase()
export const sameName = (left, right) => nameKey(left) === nameKey(right)

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

// A settings change that is not a hand edit of the look (a Prompter link cue moving the camera):
// the Overlay no longer matches the active Scene, so no Scene is active after it.
export function patchSettings({ settings }, patch) {
  return { settings: sanitizeSettings({ ...settings, ...patch }), activeSceneId: '' }
}

// What the active Scene follows when the look changes by hand (ADR 0037): everything a Scene stores
// except the camera and its quality, so a missing camera falling back to the default one, or a
// quality the device refused, never rewrites a Scene.
export const FOLLOWED_SETTING_KEYS = Object.freeze(
  PRESET_SETTING_KEYS.filter((key) => !['cameraId', 'cameraLabel', 'overlayResolution'].includes(key)),
)
const LOOK_KEYS = FOLLOWED_SETTING_KEYS.filter((key) => key !== 'size' && key !== 'position')
const sameValue = (left, right) => JSON.stringify(left) === JSON.stringify(right)

// A hand change of the live look (Inline settings, the toolbar's Shape, dragging or resizing the
// Overlay). `next` is the full settings after the change. The active Scene saves itself and stays
// active: every followed value of `next` that differs from the Scene is written into it (also one an
// onboarding demo left unsaved). A layout Scene keeps the live look rather than storing one, so it
// changes only when the hand change changed a followed value; it then becomes an exact Scene of the
// live look. Without an active Scene, or with nothing to save, only the settings change. `keys`
// (the keys the change set; default all) keeps a change of something no Scene stores, such as the
// Scenes view, from saving anything. `autosaved` holds the Scene before and after, for Undo.
export function followLiveLook({ settings, activeSceneId }, next, { keys } = {}) {
  const active = settings.presets.find((scene) => scene.id === activeSceneId)
  const reference = active?.layout ? settings : active?.settings
  const touchesLook = !keys || keys.some((key) => FOLLOWED_SETTING_KEYS.includes(key))
  const changed =
    active && touchesLook ? FOLLOWED_SETTING_KEYS.filter((key) => !sameValue(reference[key], next[key])) : []
  if (!active || !changed.length) return { settings: next, activeSceneId: active ? activeSceneId : '' }
  const scene = active.layout
    ? { id: active.id, name: active.name, settings: settingsForPreset(next) }
    : {
        id: active.id,
        name: active.name,
        settings: settingsForPreset({
          ...active.settings,
          ...Object.fromEntries(changed.map((key) => [key, next[key]])),
        }),
      }
  const scenes = next.presets.map((candidate) => (candidate.id === scene.id ? scene : candidate))
  const result = withScenes(next, scenes)
  return {
    settings: result,
    activeSceneId,
    savedSceneId: scene.id,
    autosaved: { before: active, after: result.presets.find((candidate) => candidate.id === scene.id) },
  }
}

// Renames a Scene and keeps its look. `{ error: 'name-taken' }` when another Scene has that name.
export function renameScene({ settings, activeSceneId }, idInput, nameInput) {
  const id = String(idInput ?? '')
  const name = String(nameInput ?? '').trim().slice(0, 40)
  const target = settings.presets.find((scene) => scene.id === id)
  if (!target || !name || target.name === name) return undefined
  if (settings.presets.some((scene) => scene.id !== id && sameName(scene.name, name))) {
    return { error: 'name-taken' }
  }
  const scenes = settings.presets.map((scene) => (scene.id === id ? { ...scene, name } : scene))
  return { settings: withScenes(settings, scenes), activeSceneId, announce: name }
}

// Puts a deleted Scene (`deleteScene(…).deleted`) back in its place. Nothing comes back when the
// library is full or its id or name was taken meanwhile. It goes on camera again (applied, so its
// look comes back) when it was on camera, unless another Scene went on camera since. `context` is
// applyScene's.
export function restoreScene({ settings, activeSceneId }, deleted, context = {}) {
  const scene = deleted?.scene
  if (!scene || settings.presets.length >= SCENE_LIMIT) return undefined
  if (settings.presets.some((candidate) => candidate.id === scene.id || sameName(candidate.name, scene.name))) {
    return undefined
  }
  const scenes = [...settings.presets]
  scenes.splice(Math.min(deleted.index, scenes.length), 0, scene)
  const restored = { settings: withScenes(settings, scenes), activeSceneId }
  if (deleted.wasActive && !activeSceneId) return applyScene(restored, scene.id, context)
  return { ...restored, announce: scene.name }
}

// Puts a Scene back as it was and on camera. `taken` is `createSceneEdits().takeChange(…)`: the
// Scene before the changes and the live look then; a layout Scene keeps the live look, so that look
// comes back with it.
export function undoSceneChange(state, taken, context = {}) {
  const before = taken?.scene
  if (!before || !state.settings.presets.some((scene) => scene.id === before.id)) return undefined
  const scenes = state.settings.presets.map((scene) => (scene.id === before.id ? before : scene))
  const look = before.layout ? taken.look : {}
  const settings = withScenes({ ...state.settings, ...look }, scenes)
  const applied = applyScene({ ...state, settings }, before.id, context)
  return applied && { ...applied, savedSceneId: before.id }
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
    announce: name,
    savedSceneId: scene.id,
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
    announce: scene.name,
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
    announce: name,
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

// Deleting draws nothing on the camera; `deleted` lets the Scenes tab offer Undo (restoreScene).
export function deleteScene({ settings, activeSceneId }, idInput) {
  const id = String(idInput ?? '')
  const index = settings.presets.findIndex((scene) => scene.id === id)
  if (index < 0) return undefined
  return {
    settings: withScenes(settings, settings.presets.filter((scene) => scene.id !== id)),
    activeSceneId: activeSceneId === id ? '' : activeSceneId,
    deleted: { scene: settings.presets[index], index, wasActive: activeSceneId === id },
  }
}

// Moves a Scene `offsetInput` places (negative is up), kept inside the list. Its numbered shortcut
// follows the new order.
export function reorderScene({ settings, activeSceneId }, idInput, offsetInput) {
  const scenes = [...settings.presets]
  const index = scenes.findIndex((scene) => scene.id === String(idInput ?? ''))
  const offset = Math.trunc(Number(offsetInput) || 0)
  const target = Math.max(0, Math.min(scenes.length - 1, index + offset))
  if (index < 0 || target === index) return undefined
  const [moved] = scenes.splice(index, 1)
  scenes.splice(target, 0, moved)
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
  }
}

export function sceneExport({ settings }) {
  return { format: SCENE_EXPORT_FORMAT, version: SCENE_EXPORT_VERSION, scenes: settings.presets }
}

export const SCENE_UNDO_MS = 10_000
export const SCENE_DELETE_UNDO_MS = 6_000

// The Scenes tab's two short-lived Undo offers, kept beside the Scene library state (ADR 0037).
// `track(before, result)` sees every committed Scene library result:
// - a hand change saved into the active Scene opens (or extends) a 10 second Undo window; Undo goes
//   back to the Scene as it was when it went on camera, or as it was when the last window closed;
// - another Scene going on camera, or the active Scene put on camera again, closes that window;
// - a delete opens a 6 second Undo window for the deleted Scene; a save or an import closes it.
// `view(activeSceneId)` is what the Overlay draws: `endsAt` and `at` are `now()` times.
export function createSceneEdits({ now = () => Date.now() } = {}) {
  let change
  let removal
  let saved

  const open = (window) => Boolean(window) && now() < window.endsAt

  return {
    track(before, result) {
      if (!result?.settings) return
      if (result.savedSceneId) saved = { id: result.savedSceneId, at: now() }
      if (result.autosaved) {
        const { before: scene } = result.autosaved
        const keep = open(change) && change.base.id === scene.id
        const look = Object.fromEntries(LOOK_KEYS.map((key) => [key, before.settings[key]]))
        change = keep ? { ...change, endsAt: now() + SCENE_UNDO_MS } : { base: scene, look, endsAt: now() + SCENE_UNDO_MS }
      } else if (result.appliedScene || result.activeSceneId !== before?.activeSceneId) {
        change = undefined
      }
      if (result.deleted) removal = { ...result.deleted, endsAt: now() + SCENE_DELETE_UNDO_MS }
      else if (result.importedCount || (result.savedSceneId && !result.autosaved && !result.appliedScene)) {
        removal = undefined
      }
    },
    // The Scene as it was before the open window's changes and the live look then (`{ scene, look }`),
    // once; undefined when there is none.
    takeChange(activeSceneId) {
      const taken = open(change) && change.base.id === activeSceneId ? { scene: change.base, look: change.look } : undefined
      change = undefined
      return taken
    },
    takeDelete() {
      const taken = open(removal) ? removal : undefined
      removal = undefined
      return taken && { scene: taken.scene, index: taken.index, wasActive: taken.wasActive }
    },
    view(activeSceneId) {
      return {
        sceneUndo: open(change) && change.base.id === activeSceneId ? { id: change.base.id, endsAt: change.endsAt } : null,
        sceneDeleted: open(removal)
          ? { id: removal.scene.id, name: removal.scene.name, index: removal.index, endsAt: removal.endsAt }
          : null,
        sceneSaved: saved ?? null,
      }
    },
  }
}

// Where each Scene's camera is on its display, for the Scenes tab tiles, as shares (0–1) of that
// display's bounds. An exact Scene uses its saved place (or the first-launch place without one); a
// layout Scene is planned like applying it would (`context.workArea`, `workAreaAt`), with the live
// shape. `live` is the camera now: `liveBounds` (the Compact window, without the onboarding reserve)
// when known, else the stored place. `displayAt(point)` returns the bounds of the display nearest a
// point.
export function scenePreviews(settings, { workArea, workAreaAt, displayAt, liveBounds } = {}) {
  const share = (window) => {
    const camera = cameraRectFor(window)
    const display = displayAt({ x: camera.x + camera.width / 2, y: camera.y + camera.height / 2 })
    return {
      x: (camera.x - display.x) / display.width,
      y: (camera.y - display.y) / display.height,
      width: camera.width / display.width,
      height: camera.height / display.height,
    }
  }
  const windowFor = (sceneSettings) => compactBaseBounds({ settings: sceneSettings, workArea })
  const scenes = {}
  for (const scene of settings.presets) {
    if (scene.layout) {
      const planned = layoutSceneGeometry(scene, settings, { workArea, workAreaAt })
      scenes[scene.id] = share(windowFor({ shape: settings.shape, size: planned.size, position: planned.position }))
    } else scenes[scene.id] = share(windowFor(scene.settings))
  }
  const live = liveBounds ? { ...liveBounds, ...overlayDimensionsFor(settings) } : windowFor(settings)
  return { live: share(live), scenes }
}
