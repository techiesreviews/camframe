import { sanitizeSettings, settingsAfterHandResize } from './settings.js'
import * as sceneLibrary from './scenes.js'

// The Scene session: the live Preferences, the Active Scene and the Scenes tab's Undo windows,
// held and changed together (ADR 0030, ADR 0037). Main and the browser QA preview are its adapters;
// the Scene library (scenes.js) stays the pure core it calls.
//
// - `settings` and `activeSceneId` are where the session starts.
// - `geometry` is the Overlay's port: `sceneContext()` returns the displays a Scene is fitted to
//   (`workArea`, `workAreaAt`, `workAreas`, see applyScene), and `compactPlace()` returns where the
//   camera is now (`{ bounds, fullscreen }`, the Compact window bounds, either may be missing).
// - `onChange(result, options)` hears every stored result and every notice or announcement, so the
//   adapter can broadcast, save and move the window. `options.resizing` is true for a hand resize,
//   which reports every frame; other options are the ones given to `commit`. The session never
//   touches files, windows or timers itself.
// - `now` is the clock the Undo windows run on.
export function createSceneSession({
  settings: initialSettings,
  activeSceneId: initialActiveSceneId = '',
  geometry,
  onChange = () => {},
  now = () => Date.now(),
}) {
  let settings = initialSettings
  let activeSceneId = initialActiveSceneId
  const edits = sceneLibrary.createSceneEdits({ now })

  const state = () => ({ settings, activeSceneId })
  const context = () => geometry?.sceneContext() ?? {}

  // Stores a Scene library result and tells the adapter. Results that change nothing are dropped;
  // one with only a notice or an announcement is still passed on. `options` go to `onChange`.
  function commit(result, options = {}) {
    if (!result) return
    if (result.settings) {
      edits.track(state(), result)
      settings = result.settings
      activeSceneId = result.activeSceneId
    }
    onChange(result, { resizing: false, ...options })
  }

  // A hand change (Inline settings, the toolbar, a drag or resize) is saved into the Active Scene,
  // which stays active (ADR 0037). An onboarding demo step is stored but never saved into it.
  function handChange(patch, { demo = false } = {}) {
    const next = sanitizeSettings({ ...settings, ...patch })
    commit(demo ? { settings: next, activeSceneId } : sceneLibrary.followLiveLook(state(), next, { keys: Object.keys(patch) }))
  }

  return {
    state,
    settings: () => settings,
    // The runtime fields the Overlay draws beside Preferences: the Active Scene and the Undo offers.
    view: () => ({ activePresetId: activeSceneId, ...edits.view(activeSceneId) }),
    commit,
    handChange,
    // Resizing by hand also sets the size a Prompter link "small" cue restores (KG-14).
    handResize(patch) {
      commit(sceneLibrary.followLiveLook(state(), settingsAfterHandResize(settings, patch), { keys: ['size', 'position'] }), {
        resizing: true,
      })
    },
    // A move-drag that moved the camera is a hand change of the place.
    dragEnd(position) {
      commit(sceneLibrary.followLiveLook(state(), sanitizeSettings({ ...settings, position }), { keys: ['position'] }))
    },
    // A change that is not a look change (showing the camera, finishing onboarding, a place the
    // window reached by itself): stored as is, the Active Scene and the Undo windows untouched, and
    // the adapter not told, since what to do next differs for each. Patches pass `sanitizeSettings`,
    // so a position must be whole pixels (window bounds are).
    record(patch) {
      settings = sanitizeSettings({ ...settings, ...patch })
    },
    applyScene: (id) => commit(sceneLibrary.applyScene(state(), id, context())),
    applySceneAt: (index) => commit(sceneLibrary.applySceneAt(state(), index, context())),
    cycleScene: () => commit(sceneLibrary.cycleScene(state(), context())),
    saveScene(name, id) {
      const { bounds, fullscreen = false } = geometry?.compactPlace() ?? {}
      commit(sceneLibrary.saveScene(state(), { name, id, liveBounds: bounds, fullscreen: Boolean(fullscreen) }))
    },
    // `{ error: 'name-taken' }` when another Scene has the name; nothing is stored then.
    renameScene(id, name) {
      const renamed = sceneLibrary.renameScene(state(), id, name)
      if (renamed?.error) return renamed
      commit(renamed)
      return renamed
    },
    deleteScene: (id) => commit(sceneLibrary.deleteScene(state(), id)),
    reorderScene: (id, offset) => commit(sceneLibrary.reorderScene(state(), id, offset)),
    undoChange: () => commit(sceneLibrary.undoSceneChange(state(), edits.takeChange(activeSceneId), context())),
    undoDelete: () => commit(sceneLibrary.restoreScene(state(), edits.takeDelete(), context())),
    // The import result (`importedCount`, or `error` with nothing stored).
    importScenes(documentText) {
      const imported = sceneLibrary.importScenes(state(), documentText)
      if (!imported.error) commit(imported)
      return imported
    },
    exportScenes: () => sceneLibrary.sceneExport(state()),
  }
}
