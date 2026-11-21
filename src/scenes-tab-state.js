import { SCENE_LIMIT, dimensionsFor } from './settings.js'
import { sameName, sceneLookOnCamera } from './scenes.js'

// The Scenes tab state (ADR 0037): what the tab draws and the interaction around it, without a DOM.
// It takes events (main's state, clicks, keys, typing, input-method composition, drags, a clock
// tick) and returns a step: what to draw, where focus goes, what to announce. Requests to main go
// straight to the bridge (`camFrame`), at the point they are made: a bridge that answers at once
// (the browser QA preview) sends the new state back in while the event is still being handled, and
// that state is drawn before the rest. `scenes-panel.js` is its DOM adapter: it builds the tab from
// `step.draw`, turns DOM events into events here and carries out the rest of the step. Main owns
// every Scene rule and both Undo windows; state shows on the controls themselves, no notice is drawn
// on the camera.

export const SAVED_FLASH_MS = 1800
const FILE_RESULT_MS = 2400
// How long a focus wish waits for its control to be drawn (main's answer to a request).
const FOCUS_WAIT_MS = 1500
const SHAPE_LABELS = Object.freeze({ circle: 'Circle', rounded: 'Rounded', portrait: 'Portrait', landscape: 'Landscape' })
const SHAPE_RADII = Object.freeze({ circle: '50%', rounded: '16%', portrait: '12%', landscape: '12%' })

// A place name from where the camera's centre sits on its display (thirds across and down).
export function placeLabel(rect) {
  if (!rect) return ''
  const third = (start, length) => {
    const centre = start + length / 2
    return centre < 1 / 3 ? 0 : centre > 2 / 3 ? 2 : 1
  }
  const across = third(rect.x, rect.width)
  const down = third(rect.y, rect.height)
  const vertical = ['Top', '', 'Bottom'][down]
  const horizontal = ['left', '', 'right'][across]
  if (!vertical && !horizontal) return 'Center'
  if (!vertical) return horizontal[0].toUpperCase() + horizontal.slice(1)
  return horizontal ? `${vertical} ${horizontal}` : vertical
}

function frameParts(look) {
  const parts = []
  if (look.frameEffect === 'glow') parts.push('Glow')
  if (look.frameEffect === 'blur') parts.push('Blur')
  if (look.borderWidth > 0) parts.push('Border')
  return parts
}

// Shape, size (the camera's longest edge, px), place and frame, for the list line, the tile's hover
// details and the screen reader name.
export function sceneDescription(look, rect) {
  const parts = [SHAPE_LABELS[look.shape] ?? 'Circle', String(look.size), placeLabel(rect), ...frameParts(look)].filter(Boolean)
  return {
    short: parts.join(' · '),
    spoken: parts.map((part, index) => (index === 1 ? `size ${part}` : index ? part.toLowerCase() : part)).join(', '),
  }
}

// The camera on a tile: its place and width as shares of the display, its real shape (aspect and
// corners), and its glow or border, drawn at a size a 100 px wide screen can show.
export function tileCamera(look, rect) {
  const camera = dimensionsFor(look)
  const shadows = []
  if (look.borderWidth > 0) shadows.push(`0 0 0 ${look.borderWidth >= 6 ? 2 : 1}px ${look.borderColor}`)
  if (look.frameEffect === 'glow') {
    const alpha = Math.round((look.glowStrength / 100) * 255).toString(16).padStart(2, '0')
    shadows.push(`0 0 0 0.5px ${look.effectColor}`, `0 0 ${Math.max(3, Math.round(look.glowSpread / 2))}px 1px ${look.effectColor}${alpha}`)
  }
  if (look.frameEffect === 'blur') shadows.push(`0 0 6px 2px rgb(255 255 255 / ${Math.round(look.blurOpacity / 3)}%)`)
  const percent = (value) => `${Math.round(value * 10000) / 100}%`
  return {
    left: percent(rect?.x ?? 0.75),
    top: percent(rect?.y ?? 0.6),
    width: percent(rect?.width ?? 0.15),
    aspectRatio: `${camera.width} / ${camera.height}`,
    borderRadius: SHAPE_RADII[look.shape] ?? '50%',
    boxShadow: shadows.length ? shadows.join(', ') : 'none',
  }
}

// Everything the tab draws, from the Overlay state, the tab's own UI state and the time now.
export function scenesPanelModel(state, ui, now) {
  const previews = state.scenePreviews ?? { live: undefined, scenes: {} }
  const scenes = state.presets
  const flashOn = ui.flash && now < ui.flash.until ? ui.flash.id : ''
  const undo = state.sceneUndo && now < state.sceneUndo.endsAt ? state.sceneUndo : null
  const items = scenes.map((scene, index) => {
    const rect = previews.scenes?.[scene.id]
    // The size a tile preview gives is the size the Scene really opens at, which can be smaller than
    // it asks for on a small display.
    const look = sceneLookOnCamera(scene, state, rect?.size)
    const description = sceneDescription(look, rect)
    const active = scene.id === state.activePresetId
    const saved = scene.id === flashOn
    const slot = index + 1
    return {
      kind: 'scene',
      id: scene.id,
      slot,
      name: scene.name,
      active,
      saved,
      editing: ui.editingId === scene.id,
      undo: undo && undo.id === scene.id ? { endsAt: undo.endsAt } : null,
      description,
      camera: tileCamera(look, rect),
      label: `${scene.name}, scene ${slot}, ${description.spoken}${active ? ', on camera' : ''}${saved ? ', saved' : ''}`,
    }
  })
  const deleted = state.sceneDeleted && now < state.sceneDeleted.endsAt ? state.sceneDeleted : null
  if (deleted) {
    items.splice(Math.min(deleted.index, items.length), 0, {
      kind: 'deleted',
      id: deleted.id,
      name: deleted.name,
      endsAt: deleted.endsAt,
    })
  }
  const count = scenes.length
  const replace = ui.saving && ui.saveName.trim() ? (scenes.find((scene) => sameName(scene.name, ui.saveName.trim()))?.name ?? '') : ''
  const liveDescription = sceneDescription(state, previews.live)
  return {
    view: state.sceneView === 'list' ? 'list' : 'grid',
    items,
    add: {
      kind: count >= SCENE_LIMIT ? 'full' : count ? 'save' : 'empty',
      slot: Math.min(count + 1, SCENE_LIMIT),
      label: count >= SCENE_LIMIT ? 'Full' : count ? 'Save look' : 'Save the live look as scene 1',
      saving: ui.saving && count < SCENE_LIMIT,
      saveName: ui.saveName,
      replace,
    },
    live: { description: liveDescription, camera: tileCamera(state, previews.live) },
    canExport: count > 0,
  }
}

// Where an arrow key, Home or End moves focus among the Scene buttons: `rects` are their boxes in
// order (`left`, `top`, `width`, `bottom`) and `index` the focused one. In the list, up and down go
// one line; in the grid, left and right go one Scene and up and down to the nearest Scene in the
// row above or below, so a wide tile (a rename, the save form) or a deleted Scene's place does not
// throw them off. Undefined when the key moves nothing.
export function sceneButtonTarget({ key, index, rects, grid }) {
  const last = rects.length - 1
  const clamp = (next) => Math.max(0, Math.min(last, next))
  if (key === 'Home') return 0
  if (key === 'End') return last
  if (!grid) {
    if (key === 'ArrowUp') return clamp(index - 1)
    if (key === 'ArrowDown') return clamp(index + 1)
    return undefined
  }
  if (key === 'ArrowLeft') return clamp(index - 1)
  if (key === 'ArrowRight') return clamp(index + 1)
  if (key !== 'ArrowUp' && key !== 'ArrowDown') return undefined
  const direction = key === 'ArrowUp' ? -1 : 1
  const from = rects[index]
  const centre = from.left + from.width / 2
  let best = index
  let bestScore = Infinity
  rects.forEach((rect, candidate) => {
    const gap = direction < 0 ? from.top - rect.bottom : rect.top - from.bottom
    if (candidate === index || gap < -1) return
    const score = gap * 1000 + Math.abs(rect.left + rect.width / 2 - centre)
    if (score < bestScore) {
      bestScore = score
      best = candidate
    }
  })
  return best === index ? undefined : best
}

const ARROWS = new Set(['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'])

// A step: what the adapter does after one event.
// - `draw`: build the tab again from `{ model, files, time, renameValue, renameInvalid }`, or null.
// - `focus`: after that draw, the `data-key` of the control focus goes to (the adapter sends
//   `focused` once it is there); '' keeps focus where it was.
// - `select`: after the draw, the `data-key` of the field whose text gets selected.
// - `saveButton`: the save form's `add` model, for updating its button in place while a name is
//   typed (the field is never drawn again then).
// - `file`: 'import' or 'export' to run (an answer that takes a while), whose result comes back as a
//   `file-result` event.
// - `announce`: texts for screen readers; `closeSettings`: Escape found nothing to cancel.
// - `handled`: Ctrl+Z found something to undo.
// - `preventDefault`, `stopPropagation`: for the DOM event; `navigate`: an arrow, Home or End for
//   `sceneButtonTarget`; `highlight`: a drag is over another Scene.
// - `wakeIn`: ms until the next `tick` (an Undo window, the saved check or a file result ends);
//   null for none; undefined leaves the timer as it is.
function emptyStep() {
  return {
    draw: null,
    focus: '',
    select: '',
    saveButton: null,
    file: '',
    announce: [],
    closeSettings: false,
    handled: false,
    preventDefault: false,
    stopPropagation: false,
    navigate: '',
    highlight: false,
    wakeIn: undefined,
  }
}

// `camFrame` is the bridge (only its Scene methods and `updateState` are used here).
export function createScenesTabState({ camFrame, now = () => Date.now() }) {
  const ui = { editingId: '', saving: false, saveName: '', renameValue: '', renameInvalid: false, flash: null, files: {} }
  let state
  let lastSaved
  let lastKey = ''
  // Where focus goes once the next state has drawn it (a Scene's main button after Undo, the Undo
  // button after a delete); kept until that control exists, for a short while.
  let pendingFocus = ''
  let pendingFocusUntil = 0
  // After Save look: the saved Scene known when the save was sent, and the name sent.
  let savedBefore
  let savedNameSent = ''
  let dragId = ''
  // While an input method composes text in a field, a draw would cancel it: it waits for the end,
  // also when main's state changes (Chromium ends composition when the field loses focus).
  let composing = false
  let drawAfterComposition = false
  let step

  const sceneName = (id) => state.presets.find((scene) => scene.id === id)?.name ?? ''

  function focusNext(key) {
    pendingFocus = key
    pendingFocusUntil = now() + FOCUS_WAIT_MS
  }

  function render() {
    if (!state) return
    const time = now()
    const model = scenesPanelModel(state, ui, time)
    const files = Object.fromEntries(Object.entries(ui.files).filter(([, result]) => result.until > time))
    // The typed Scene name stays out of the key: typing updates the save button in place and never
    // swaps the field, which would cancel input-method composition and make screen readers read the
    // field again.
    const add = { ...model.add, saveName: undefined, replace: undefined }
    const key = JSON.stringify({ model: { ...model, add }, files, renaming: ui.editingId && ui.renameInvalid })
    const ends = [
      ui.flash?.until,
      ...model.items.map((item) => item.undo?.endsAt ?? (item.kind === 'deleted' ? item.endsAt : undefined)),
      ...Object.values(ui.files).map((result) => result.until),
    ].filter((end) => end > time)
    step.wakeIn = ends.length ? Math.min(...ends) - time + 16 : null
    if (pendingFocus && time > pendingFocusUntil) pendingFocus = ''
    if (key === lastKey && !pendingFocus) return
    if (composing) {
      drawAfterComposition = true
      return
    }
    lastKey = key
    step.draw = { model, files, time, renameValue: ui.renameValue, renameInvalid: ui.renameInvalid }
    // After Save look, focus waits for main's answer (a one-way message in Electron): the next
    // saved Scene after the one known when the save was sent, with the name that was sent (an
    // autosave or a Prompter link save in between also sets `sceneSaved`).
    const savedNow = state.sceneSaved
    const isSentSave = savedNow && savedNow.at !== savedBefore && sameName(sceneName(savedNow.id), savedNameSent)
    step.focus = pendingFocus === 'saved-scene' ? (isSentSave ? `apply:${savedNow.id}` : '') : pendingFocus
  }

  function openRename(id) {
    ui.editingId = id
    ui.renameValue = sceneName(id)
    ui.renameInvalid = false
    ui.saving = false
    focusNext(`rename:${id}`)
    render()
    step.select = `rename:${id}`
  }

  function commitRename(id) {
    const name = ui.renameValue.trim()
    if (name && name !== sceneName(id)) {
      if (state.presets.some((scene) => scene.id !== id && sameName(scene.name, name))) {
        ui.renameInvalid = true
        step.announce.push('That name is already used')
        render()
        return
      }
      camFrame.renamePreset(id, name)
    }
    ui.editingId = ''
    focusNext(`apply:${id}`)
    render()
  }

  function cancelEditing() {
    const id = ui.editingId
    if (!id && !ui.saving) return false
    ui.editingId = ''
    ui.saving = false
    focusNext(id ? `apply:${id}` : 'save-open')
    render()
    return true
  }

  function openSave() {
    ui.saving = true
    ui.editingId = ''
    ui.saveName = ''
    focusNext('new-name')
    render()
  }

  function save() {
    const name = ui.saveName.trim()
    if (!name) return
    ui.saving = false
    ui.saveName = ''
    // The saved Scene goes on camera; focus follows it once main has saved it.
    savedBefore = state.sceneSaved?.at
    savedNameSent = name
    focusNext('saved-scene')
    camFrame.savePreset(name, '')
    render()
  }

  function apply(id) {
    ui.editingId = ''
    ui.saving = false
    focusNext(`apply:${id}`)
    camFrame.applyPreset(id)
    render()
  }

  function remove(id) {
    const name = sceneName(id)
    if (!name) return
    ui.editingId = ''
    focusNext('undo-delete')
    camFrame.deletePreset(id)
    step.announce.push(`${name} deleted`)
  }

  function undoDelete() {
    const deleted = state?.sceneDeleted
    if (!deleted || now() >= deleted.endsAt) return false
    focusNext(`apply:${deleted.id}`)
    camFrame.undoPresetDelete()
    return true
  }

  function undoChange() {
    const undo = state?.sceneUndo
    if (!undo || now() >= undo.endsAt || undo.id !== state.activePresetId) return false
    focusNext(`apply:${undo.id}`)
    camFrame.undoPresetChange()
    return true
  }

  function fileResult(act, result) {
    if (!result || result.canceled) return
    ui.files[act] = result.error
      ? { kind: 'error', text: act === 'import' ? 'Not imported' : 'Not exported', title: result.error, until: now() + FILE_RESULT_MS }
      : { kind: 'ok', text: `${act === 'import' ? 'Imported' : 'Exported'} ${result.count}`, until: now() + FILE_RESULT_MS }
    step.announce.push(result.error ?? ui.files[act].text)
    render()
  }

  function input(role, value) {
    if (role === 'new-name') {
      ui.saveName = value
      if (state) step.saveButton = scenesPanelModel(state, ui, now()).add
    } else if (role === 'rename') {
      ui.renameValue = value
      if (ui.renameInvalid) {
        ui.renameInvalid = false
        render()
      }
    }
  }

  function keydown({ key, role, id, isComposing, altKey }) {
    // Keys while an input method composes belong to it, also Escape (which would close the form).
    if (isComposing) {
      step.stopPropagation = true
      return
    }
    if (role === 'rename' || role === 'new-name') {
      if (key === 'Enter') {
        step.preventDefault = true
        if (role === 'rename') commitRename(id)
        else save()
      } else if (key === 'Escape') {
        step.preventDefault = true
        step.stopPropagation = true
        cancelEditing()
      }
      return
    }
    if (role !== 'scene' || !id) return
    if (altKey && ARROWS.has(key)) {
      // One place earlier (up, left) or later (down, right), in both views.
      step.preventDefault = true
      focusNext(`apply:${id}`)
      camFrame.reorderPreset(id, key === 'ArrowUp' || key === 'ArrowLeft' ? -1 : 1)
    } else if (ARROWS.has(key) || key === 'Home' || key === 'End') {
      step.navigate = key
    } else if (key === 'F2') {
      step.preventDefault = true
      openRename(id)
    } else if (key === 'Delete') {
      step.preventDefault = true
      remove(id)
    }
  }

  // Drag a Scene onto another to move it there; its number follows the new order.
  function drop(id) {
    if (!dragId) return
    step.preventDefault = true
    const ids = state.presets.map((scene) => scene.id)
    const offset = ids.indexOf(id) - ids.indexOf(dragId)
    const from = dragId
    dragId = ''
    if (offset) camFrame.reorderPreset(from, offset)
  }

  function update(nextState) {
    state = nextState
    const saved = state.sceneSaved
    if (lastSaved !== undefined && saved && saved.at !== lastSaved?.at) {
      ui.flash = { id: saved.id, until: now() + SAVED_FLASH_MS }
    }
    lastSaved = saved ?? null
    if (ui.editingId && !state.presets.some((scene) => scene.id === ui.editingId)) ui.editingId = ''
    render()
  }

  const handlers = {
    state: (event) => update(event.state),
    tick: render,
    focused: () => {
      pendingFocus = ''
    },
    view: (event) => {
      focusNext(`view:${event.view}`)
      camFrame.updateState({ sceneView: event.view })
    },
    apply: (event) => apply(event.id),
    rename: (event) => openRename(event.id),
    'rename-ok': (event) => commitRename(event.id),
    'rename-cancel': cancelEditing,
    delete: (event) => remove(event.id),
    'undo-delete': () => {
      step.handled = undoDelete()
    },
    'undo-change': () => {
      step.handled = undoChange()
    },
    'save-open': openSave,
    'save-ok': save,
    import: () => {
      step.file = 'import'
    },
    export: () => {
      step.file = 'export'
    },
    'file-result': (event) => fileResult(event.act, event.result),
    input: (event) => input(event.role, event.value),
    compositionstart: () => {
      composing = true
    },
    compositionend: () => {
      composing = false
      if (drawAfterComposition) {
        drawAfterComposition = false
        render()
      }
    },
    keydown,
    // Ctrl+Z in Inline settings: the last delete first, else the active Scene's changes.
    undo: () => {
      step.handled = undoDelete() || undoChange()
    },
    // Escape: cancel a rename or a save in progress, else close Inline settings.
    escape: () => {
      step.closeSettings = !cancelEditing()
    },
    // Leaving the tab or closing the settings drops a rename or a save in progress.
    reset: () => {
      ui.editingId = ''
      ui.saving = false
      lastKey = ''
      render()
    },
    dragstart: (event) => {
      dragId = event.id
    },
    dragover: (event) => {
      if (!dragId) return
      step.preventDefault = true
      step.highlight = event.id !== dragId
    },
    drop: (event) => drop(event.id),
    dragend: () => {
      dragId = ''
    },
  }

  return {
    // One event in, one step out. Nothing is drawn before the first `state`. A state that comes
    // back while a request is made gets its own step, carried out before the step it came from.
    send(event) {
      const outer = step
      step = emptyStep()
      handlers[event.type]?.(event)
      const done = step
      step = outer
      return done
    },
  }
}
