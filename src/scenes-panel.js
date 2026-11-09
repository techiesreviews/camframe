import { SCENE_LIMIT, dimensionsFor } from './settings.js'
import { sameName } from './scenes.js'

// The Scenes tab of Inline settings (ADR 0037): the saved Scenes as a list or a grid of small
// screens, a slot that saves the live look, rename, delete with Undo, Undo after a change saved into
// the active Scene, reorder, and Import/Export. Main owns every Scene rule and both Undo windows;
// this module draws `state` and sends the user's requests through `camFrame`. State shows on the
// controls themselves: no notice is drawn on the camera.

export const SAVED_FLASH_MS = 1800
const FILE_RESULT_MS = 2400
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

// What a Scene looks like on camera: a layout Scene keeps the live look at its own size.
function lookFor(scene, live) {
  if (!scene.layout) return scene.settings
  const size = scene.layout.size === 'small' ? live.prompterSmallSize : scene.layout.size
  return { ...live, size }
}

// Everything the tab draws, from the Overlay state, the tab's own UI state and the time now.
export function scenesPanelModel(state, ui, now) {
  const previews = state.scenePreviews ?? { live: undefined, scenes: {} }
  const scenes = state.presets
  const flashOn = ui.flash && now < ui.flash.until ? ui.flash.id : ''
  const undo = state.sceneUndo && now < state.sceneUndo.endsAt ? state.sceneUndo : null
  const items = scenes.map((scene, index) => {
    const look = lookFor(scene, state)
    const rect = previews.scenes?.[scene.id]
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

// ---- DOM ----

function element(tag, attributes = {}, children = []) {
  const node = document.createElement(tag)
  for (const [name, value] of Object.entries(attributes)) {
    if (value === undefined || value === null || value === false) continue
    if (name === 'text') node.textContent = value
    else if (name === 'style') Object.assign(node.style, value)
    else if (name === 'dataset') Object.assign(node.dataset, value)
    else node.setAttribute(name, value === true ? '' : String(value))
  }
  for (const child of children.flat()) if (child) node.append(child)
  return node
}

const icon = (name) => element('i', { class: `ph ph-${name}`, 'aria-hidden': 'true' })

function drain(endsAt, total, now) {
  return element('span', {
    class: 'scene-drain',
    'aria-hidden': 'true',
    style: { animationDuration: `${total}ms`, animationDelay: `-${Math.max(0, total - (endsAt - now))}ms` },
  })
}

// `camFrame` is the bridge; `announce(text)` reads text to screen readers only; `closeSettings()`
// closes Inline settings (Escape with nothing to cancel).
export function createScenesPanel({ root, camFrame, announce, closeSettings, now = () => Date.now() }) {
  const ui = { editingId: '', saving: false, saveName: '', renameValue: '', flash: null, files: {} }
  let state
  let lastSaved
  let lastKey = ''
  // Where focus goes once the next state has drawn it (a Scene's main button after Undo, the Undo
  // button after a delete); kept until that control exists, for a short while.
  let pendingFocus = ''
  let pendingFocusUntil = 0
  let savedBefore
  let renderTimer
  let dragId = ''
  // While an input method composes text in a field, a rebuild would cancel it: it waits for the end.
  let composing = false
  let renderAfterComposition = false

  function scheduleNextRender(model, time) {
    clearTimeout(renderTimer)
    const ends = [
      ui.flash?.until,
      ...model.items.map((item) => item.undo?.endsAt ?? (item.kind === 'deleted' ? item.endsAt : undefined)),
      ...Object.values(ui.files).map((result) => result.until),
    ].filter((end) => end > time)
    if (ends.length) renderTimer = setTimeout(render, Math.min(...ends) - time + 16)
  }

  function render() {
    if (!state) return
    const time = now()
    const model = scenesPanelModel(state, ui, time)
    const files = Object.fromEntries(Object.entries(ui.files).filter(([, result]) => result.until > time))
    // The typed Scene name stays out of the key: typing updates the save button in place
    // (`updateSaveButton`) and never swaps the field, which would cancel input-method composition and
    // make screen readers read the field again.
    const add = { ...model.add, saveName: undefined, replace: undefined }
    const key = JSON.stringify({ model: { ...model, add }, files, renaming: ui.editingId && ui.renameInvalid })
    scheduleNextRender(model, time)
    if (pendingFocus && time > pendingFocusUntil) pendingFocus = ''
    if (key === lastKey && !pendingFocus) return
    if (composing) {
      renderAfterComposition = true
      return
    }
    lastKey = key
    const focused = root.contains(document.activeElement) ? document.activeElement : undefined
    const selection =
      focused && 'selectionStart' in focused ? [focused.selectionStart, focused.selectionEnd] : undefined
    root.replaceChildren(head(model), model.view === 'grid' ? grid(model, time) : list(model, time), fileRow(model, files))
    // After Save look, focus waits for main's answer (a one-way message in Electron): the next
    // saved Scene after the one known when the save was sent.
    const savedNow = state.sceneSaved
    const wanted =
      pendingFocus === 'saved-scene'
        ? savedNow && savedNow.at !== savedBefore ? `apply:${savedNow.id}` : ''
        : pendingFocus
    const find = (focusKey) => focusKey && root.querySelector(`[data-key="${CSS.escape(focusKey)}"]`)
    const target = find(wanted)
    if (target) {
      pendingFocus = ''
      target.focus()
    } else if (focused?.dataset.key) {
      const again = find(focused.dataset.key)
      again?.focus()
      if (again && selection && 'selectionStart' in again) again.setSelectionRange(...selection)
    }
  }

  function focusNext(key) {
    pendingFocus = key
    pendingFocusUntil = now() + 1500
  }

  function head(model) {
    const viewButton = (view, label, glyph) =>
      element('button', {
        type: 'button',
        'data-view': view,
        'data-key': `view:${view}`,
        'aria-pressed': String(model.view === view),
        'aria-label': label,
        title: label,
      }, [icon(glyph)])
    return element('div', { class: 'scenes-head' }, [
      element('h2', { class: 'inline-group-title', id: 'scenes-title', text: 'Scenes' }),
      element('div', { class: 'scene-view-switch', role: 'group', 'aria-label': 'Scene layout' }, [
        viewButton('list', 'List view', 'list'),
        viewButton('grid', 'Grid view', 'squares-four'),
      ]),
    ])
  }

  function screen(camera, extraClass = '') {
    return element('span', { class: `scene-screen ${extraClass}`.trim(), 'aria-hidden': 'true' }, [
      element('span', { class: 'scene-screen-camera', style: camera }),
    ])
  }

  function slotBadge(item) {
    return element('span', { class: `scene-slot${item.saved ? ' saved' : ''}` }, [item.saved ? icon('check') : String(item.slot)])
  }

  function undoChangeButton(item, extraClass) {
    const label = `Undo changes to ${item.name}`
    return element('button', {
      type: 'button',
      class: `scene-icon-button scene-undo ${extraClass}`,
      'data-act': 'undo-change',
      'data-key': `undo-change:${item.id}`,
      'aria-label': label,
      title: `${label} (Ctrl+Z)`,
    }, [icon('arrow-counter-clockwise')])
  }

  function deletedItem(item, time, tag) {
    return element(tag, { class: 'scene-item scene-deleted', 'data-id': item.id }, [
      element('span', { class: 'scene-deleted-name', text: `${item.name} deleted` }),
      element('button', {
        type: 'button',
        class: 'scene-button',
        'data-act': 'undo-delete',
        'data-key': 'undo-delete',
        'aria-label': `Undo delete ${item.name}`,
        title: 'Undo (Ctrl+Z)',
      }, [icon('arrow-counter-clockwise'), 'Undo']),
      drain(item.endsAt, 6000, time),
    ])
  }

  function renameField(item) {
    return element('input', {
      class: 'scene-field',
      type: 'text',
      maxlength: '40',
      autocomplete: 'off',
      spellcheck: 'false',
      value: ui.renameValue,
      'data-role': 'rename',
      'data-key': `rename:${item.id}`,
      'aria-label': `Name for scene ${item.slot}`,
      'aria-invalid': ui.renameInvalid ? 'true' : undefined,
    })
  }

  function confirmButton(act, key, label) {
    return element('button', {
      type: 'button',
      class: 'scene-icon-button scene-confirm',
      'data-act': act,
      'data-key': key,
      'aria-label': label,
      title: label,
    }, [icon('check')])
  }

  function mainButton(item, children) {
    return element('button', {
      type: 'button',
      class: 'scene-main',
      'data-act': 'apply',
      'data-key': `apply:${item.id}`,
      'aria-label': item.label,
      'aria-current': item.active ? 'true' : undefined,
      'aria-keyshortcuts': `Control+Shift+${item.slot}`,
      title: `${item.name} · ${item.description.short}`,
    }, children)
  }

  function list(model, time) {
    const rows = model.items.map((item) => {
      if (item.kind === 'deleted') return deletedItem(item, time, 'li')
      if (item.editing) {
        return element('li', { class: 'scene-item scene-editing', 'data-id': item.id }, [
          element('span', { class: 'scene-slot', text: String(item.slot) }),
          renameField(item),
          confirmButton('rename-ok', `rename-ok:${item.id}`, 'Save name'),
          element('button', {
            type: 'button',
            class: 'scene-icon-button',
            'data-act': 'rename-cancel',
            'data-key': `rename-cancel:${item.id}`,
            'aria-label': 'Cancel rename',
            title: 'Cancel (Esc)',
          }, [icon('x')]),
        ])
      }
      return element('li', {
        class: `scene-item${item.active ? ' active' : ''}${item.undo ? ' undoable' : ''}`,
        'data-id': item.id,
        draggable: 'true',
      }, [
        element('span', { class: 'scene-grip', 'aria-hidden': 'true', title: 'Drag to reorder' }, [icon('dots-six-vertical')]),
        mainButton(item, [
          slotBadge(item),
          element('span', { class: 'scene-text' }, [
            element('span', { class: 'scene-name', text: item.name }),
            element('span', { class: 'scene-meta', text: item.description.short }),
          ]),
        ]),
        item.undo ? undoChangeButton(item, 'scene-undo-row') : null,
        element('span', { class: 'scene-actions' }, [
          element('button', {
            type: 'button',
            class: 'scene-icon-button',
            'data-act': 'rename',
            'data-key': `rename-open:${item.id}`,
            'aria-label': `Rename ${item.name}`,
            title: 'Rename (F2)',
          }, [icon('pencil-simple')]),
          element('button', {
            type: 'button',
            class: 'scene-icon-button danger',
            'data-act': 'delete',
            'data-key': `delete:${item.id}`,
            'aria-label': `Delete ${item.name}`,
            title: 'Delete (Del)',
          }, [icon('trash')]),
        ]),
        item.undo ? drain(item.undo.endsAt, 10000, time) : null,
      ])
    })
    const children = []
    if (rows.length) children.push(element('ul', { class: 'scene-list', 'aria-labelledby': 'scenes-title' }, rows))
    children.push(listAdd(model))
    return element('div', { class: 'scene-body', 'data-layout': 'list' }, children)
  }

  function saveButtonLabel(add) {
    return add.replace ? `Replace ${add.replace}` : `Save as scene ${add.slot}`
  }

  // Typing a name updates only the save button: enabled, and Replace when the name is taken.
  function updateSaveButton() {
    const button = root.querySelector('[data-key="save-ok"]')
    if (!button || !state) return
    const { add } = scenesPanelModel(state, ui, now())
    const label = saveButtonLabel(add)
    button.disabled = !add.saveName.trim()
    button.setAttribute('aria-label', label)
    button.setAttribute('title', label)
    button.classList.toggle('icon-only', !add.replace)
    button.replaceChildren(icon('check'), ...(add.replace ? ['Replace'] : []))
  }

  function saveForm(model) {
    const label = saveButtonLabel(model.add)
    return element('div', { class: 'scene-save-form' }, [
      element('span', { class: 'scene-slot dashed', text: String(model.add.slot) }),
      element('input', {
        class: 'scene-field',
        type: 'text',
        maxlength: '40',
        autocomplete: 'off',
        spellcheck: 'false',
        placeholder: 'Scene name',
        value: model.add.saveName,
        'data-role': 'new-name',
        'data-key': 'new-name',
        'aria-label': `Name for scene ${model.add.slot}`,
      }),
      element('button', {
        type: 'button',
        class: `scene-primary${model.add.replace ? '' : ' icon-only'}`,
        'data-act': 'save-ok',
        'data-key': 'save-ok',
        'aria-label': label,
        title: label,
        disabled: !model.add.saveName.trim(),
      }, [icon('check'), model.add.replace ? 'Replace' : null]),
    ])
  }

  function listAdd(model) {
    const { add, live } = model
    if (add.saving) return saveForm(model)
    if (add.kind === 'full') {
      return element('div', { class: 'scene-add full', 'aria-disabled': 'true' }, [
        element('span', { class: 'scene-slot dashed', text: String(add.slot) }),
        element('span', { class: 'scene-name', text: add.label }),
      ])
    }
    if (add.kind === 'empty') {
      return element('button', {
        type: 'button',
        class: 'scene-add big',
        'data-act': 'save-open',
        'data-key': 'save-open',
        title: `Live look · ${live.description.short}`,
      }, [screen(live.camera, 'live'), element('span', { class: 'scene-name', text: add.label })])
    }
    return element('button', {
      type: 'button',
      class: 'scene-add',
      'data-act': 'save-open',
      'data-key': 'save-open',
      'aria-label': `Save the live look as scene ${add.slot}, ${live.description.spoken}`,
      title: `Live look · ${live.description.short}`,
    }, [
      element('span', { class: 'scene-slot dashed', text: String(add.slot) }),
      element('span', { class: 'scene-text' }, [
        element('span', { class: 'scene-name', text: add.label }),
        element('span', { class: 'scene-meta', text: live.description.short }),
      ]),
      icon('plus'),
    ])
  }

  function grid(model, time) {
    const tiles = model.items.map((item) => {
      if (item.kind === 'deleted') return deletedItem(item, time, 'div')
      if (item.editing) {
        return element('div', { class: 'scene-item scene-tile wide', 'data-id': item.id }, [
          element('div', { class: 'scene-panel' }, [
            element('div', { class: 'scene-panel-row' }, [
              element('span', { class: 'scene-slot', text: String(item.slot) }),
              renameField(item),
              confirmButton('rename-ok', `rename-ok:${item.id}`, 'Save name'),
            ]),
            element('button', {
              type: 'button',
              class: 'scene-button danger',
              'data-act': 'delete',
              'data-key': `delete:${item.id}`,
              'aria-label': `Delete ${item.name}`,
              title: 'Delete (Del)',
            }, [icon('trash'), 'Delete']),
          ]),
        ])
      }
      return element('div', {
        class: `scene-item scene-tile${item.active ? ' active' : ''}${item.undo ? ' undoable' : ''}`,
        'data-id': item.id,
        draggable: 'true',
      }, [
        mainButton(item, [
          screen(item.camera),
          element('span', { class: 'scene-foot' }, [slotBadge(item), element('span', { class: 'scene-name', text: item.name })]),
        ]),
        item.undo ? undoChangeButton(item, 'scene-undo-tile') : null,
        element('button', {
          type: 'button',
          class: 'scene-icon-button scene-edit',
          'data-act': 'rename',
          'data-key': `rename-open:${item.id}`,
          'aria-label': `Edit ${item.name}`,
          title: 'Rename or delete (F2)',
        }, [icon('pencil-simple')]),
        item.undo ? drain(item.undo.endsAt, 10000, time) : null,
      ])
    })
    const { add, live } = model
    if (add.saving) tiles.push(element('div', { class: 'scene-tile wide' }, [saveForm(model)]))
    else if (add.kind === 'full') {
      tiles.push(element('div', { class: 'scene-tile' }, [
        element('div', { class: 'scene-add-tile full', 'aria-disabled': 'true' }, [
          element('span', { class: 'scene-foot' }, [
            element('span', { class: 'scene-slot dashed', text: String(add.slot) }),
            element('span', { class: 'scene-name', text: add.label }),
          ]),
        ]),
      ]))
    } else {
      tiles.push(element('div', { class: `scene-tile${add.kind === 'empty' ? ' wide' : ''}` }, [
        element('button', {
          type: 'button',
          class: 'scene-add-tile',
          'data-act': 'save-open',
          'data-key': 'save-open',
          'aria-label': `${add.kind === 'empty' ? add.label : `Save the live look as scene ${add.slot}`}, ${live.description.spoken}`,
          title: `Live look · ${live.description.short}`,
        }, [
          screen(live.camera, 'live'),
          element('span', { class: 'scene-foot' }, [
            element('span', { class: 'scene-slot dashed', text: String(add.slot) }),
            element('span', { class: 'scene-name', text: add.label }),
          ]),
        ]),
      ]))
    }
    return element('div', { class: 'scene-body scene-grid', 'data-layout': 'grid', role: 'group', 'aria-labelledby': 'scenes-title' }, tiles)
  }

  function fileRow(model, files) {
    const fileButton = (act, glyph, idle) => {
      const result = files[act]
      return element('button', {
        type: 'button',
        class: `scene-button scene-file${result ? ` ${result.kind}` : ''}`,
        'data-act': act,
        'data-key': act,
        title: result?.title,
        disabled: act === 'export' && !model.canExport,
      }, [icon(result ? (result.kind === 'ok' ? 'check' : 'warning') : glyph), result?.text ?? idle])
    }
    return element('div', { class: 'scene-files' }, [
      fileButton('import', 'download-simple', 'Import'),
      fileButton('export', 'upload-simple', 'Export'),
    ])
  }

  // ---- requests ----

  const sceneName = (id) => state.presets.find((scene) => scene.id === id)?.name ?? ''

  function openRename(id) {
    ui.editingId = id
    ui.renameValue = sceneName(id)
    ui.renameInvalid = false
    ui.saving = false
    focusNext(`rename:${id}`)
    render()
    root.querySelector(`[data-key="${CSS.escape(`rename:${id}`)}"]`)?.select()
  }

  function commitRename(id) {
    const name = ui.renameValue.trim()
    if (name && name !== sceneName(id)) {
      if (state.presets.some((scene) => scene.id !== id && sameName(scene.name, name))) {
        ui.renameInvalid = true
        announce('That name is already used')
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
    const wasSaving = ui.saving
    if (!id && !wasSaving) return false
    ui.editingId = ''
    ui.saving = false
    focusNext(id ? `apply:${id}` : 'save-open')
    render()
    return true
  }

  function save() {
    const name = ui.saveName.trim()
    if (!name) return
    ui.saving = false
    ui.saveName = ''
    // The saved Scene goes on camera; focus follows it once main has saved it.
    savedBefore = state.sceneSaved?.at
    focusNext('saved-scene')
    camFrame.savePreset(name, '')
    render()
  }

  function remove(id) {
    const name = sceneName(id)
    if (!name) return
    ui.editingId = ''
    focusNext('undo-delete')
    camFrame.deletePreset(id)
    announce(`${name} deleted`)
  }

  function undoDelete() {
    const deleted = state.sceneDeleted
    if (!deleted || now() >= deleted.endsAt) return false
    focusNext(`apply:${deleted.id}`)
    camFrame.undoPresetDelete()
    return true
  }

  function undoChange() {
    const undo = state.sceneUndo
    if (!undo || now() >= undo.endsAt || undo.id !== state.activePresetId) return false
    focusNext(`apply:${undo.id}`)
    camFrame.undoPresetChange()
    return true
  }

  async function runFile(act) {
    const result = act === 'import' ? await camFrame.importPresets() : await camFrame.exportPresets()
    if (!result || result.canceled) return
    ui.files[act] = result.error
      ? { kind: 'error', text: act === 'import' ? 'Not imported' : 'Not exported', title: result.error, until: now() + FILE_RESULT_MS }
      : { kind: 'ok', text: `${act === 'import' ? 'Imported' : 'Exported'} ${result.count}`, until: now() + FILE_RESULT_MS }
    announce(result.error ?? ui.files[act].text)
    render()
  }

  root.addEventListener('click', (event) => {
    const viewButton = event.target.closest('[data-view]')
    if (viewButton) {
      focusNext(`view:${viewButton.dataset.view}`)
      camFrame.updateState({ sceneView: viewButton.dataset.view })
      return
    }
    const button = event.target.closest('[data-act]')
    if (!button || button.disabled) return
    const id = button.closest('[data-id]')?.dataset.id ?? ''
    const act = button.dataset.act
    if (act === 'apply') {
      ui.editingId = ''
      ui.saving = false
      focusNext(`apply:${id}`)
      camFrame.applyPreset(id)
      render()
    } else if (act === 'rename') openRename(id)
    else if (act === 'rename-ok') commitRename(id)
    else if (act === 'rename-cancel') cancelEditing()
    else if (act === 'delete') remove(id)
    else if (act === 'undo-delete') undoDelete()
    else if (act === 'undo-change') undoChange()
    else if (act === 'save-open') {
      ui.saving = true
      ui.editingId = ''
      ui.saveName = ''
      focusNext('new-name')
      render()
    } else if (act === 'save-ok') save()
    else if (act === 'import' || act === 'export') runFile(act)
  })

  root.addEventListener('input', (event) => {
    const role = event.target.dataset.role
    if (role === 'new-name') {
      ui.saveName = event.target.value
      updateSaveButton()
    } else if (role === 'rename') {
      ui.renameValue = event.target.value
      if (ui.renameInvalid) {
        ui.renameInvalid = false
        render()
      }
    }
  })

  root.addEventListener('compositionstart', () => {
    composing = true
  })
  root.addEventListener('compositionend', () => {
    composing = false
    if (renderAfterComposition) {
      renderAfterComposition = false
      render()
    }
  })

  root.addEventListener('keydown', (event) => {
    if (event.isComposing) return
    const target = event.target
    const role = target.dataset?.role
    if (role === 'rename' || role === 'new-name') {
      if (event.key === 'Enter') {
        event.preventDefault()
        if (role === 'rename') commitRename(target.closest('[data-id]').dataset.id)
        else save()
      } else if (event.key === 'Escape') {
        event.preventDefault()
        event.stopPropagation()
        cancelEditing()
      }
      return
    }
    if (target.dataset?.act !== 'apply') return
    const id = target.closest('[data-id]')?.dataset.id
    if (!id) return
    const mains = [...root.querySelectorAll('[data-act="apply"]')]
    const index = mains.indexOf(target)
    const isGrid = Boolean(root.querySelector('.scene-grid'))
    const go = (next) => mains[Math.max(0, Math.min(mains.length - 1, next))]?.focus()
    // In the grid, up and down go to the nearest Scene in the row above or below, so a wide tile (a
    // rename, the save form) or a deleted Scene's place does not throw them off.
    const vertical = (direction) => {
      const from = target.getBoundingClientRect()
      const centre = from.left + from.width / 2
      let best
      let bestScore = Infinity
      for (const candidate of mains) {
        const rect = candidate.getBoundingClientRect()
        const gap = direction < 0 ? from.top - rect.bottom : rect.top - from.bottom
        if (candidate === target || gap < -1) continue
        const score = gap * 1000 + Math.abs(rect.left + rect.width / 2 - centre)
        if (score < bestScore) {
          bestScore = score
          best = candidate
        }
      }
      return best ? mains.indexOf(best) : index
    }
    const arrows = isGrid
      ? { ArrowUp: vertical(-1) - index, ArrowDown: vertical(1) - index, ArrowLeft: -1, ArrowRight: 1 }
      : { ArrowUp: -1, ArrowDown: 1, ArrowLeft: 0, ArrowRight: 0 }
    if (event.altKey && event.key in arrows) {
      event.preventDefault()
      // One place earlier (up, left) or later (down, right), in both views.
      const offset = event.key === 'ArrowUp' || event.key === 'ArrowLeft' ? -1 : 1
      if (offset) {
        focusNext(`apply:${id}`)
        camFrame.reorderPreset(id, offset)
      }
    } else if (event.key in arrows && arrows[event.key]) {
      event.preventDefault()
      go(index + arrows[event.key])
    } else if (event.key === 'Home' || event.key === 'End') {
      event.preventDefault()
      go(event.key === 'Home' ? 0 : mains.length - 1)
    } else if (event.key === 'F2') {
      event.preventDefault()
      openRename(id)
    } else if (event.key === 'Delete') {
      event.preventDefault()
      remove(id)
    }
  })

  // Drag a Scene onto another to move it there; its number follows the new order.
  root.addEventListener('dragstart', (event) => {
    const item = event.target.closest?.('[draggable="true"]')
    if (!item) return
    dragId = item.dataset.id
    event.dataTransfer.effectAllowed = 'move'
    event.dataTransfer.setData('text/plain', dragId)
  })
  root.addEventListener('dragover', (event) => {
    const item = event.target.closest?.('[draggable="true"]')
    if (!item || !dragId) return
    event.preventDefault()
    root.querySelectorAll('.drag-over').forEach((node) => node.classList.remove('drag-over'))
    if (item.dataset.id !== dragId) item.classList.add('drag-over')
  })
  root.addEventListener('drop', (event) => {
    const item = event.target.closest?.('[draggable="true"]')
    if (!item || !dragId) return
    event.preventDefault()
    const ids = state.presets.map((scene) => scene.id)
    const offset = ids.indexOf(item.dataset.id) - ids.indexOf(dragId)
    if (offset) camFrame.reorderPreset(dragId, offset)
    dragId = ''
  })
  root.addEventListener('dragend', () => {
    dragId = ''
    root.querySelectorAll('.drag-over').forEach((node) => node.classList.remove('drag-over'))
  })

  return {
    update(nextState) {
      state = nextState
      const saved = state.sceneSaved
      if (lastSaved !== undefined && saved && saved.at !== lastSaved?.at) {
        ui.flash = { id: saved.id, until: now() + SAVED_FLASH_MS }
      }
      lastSaved = saved ?? null
      if (ui.editingId && !state.presets.some((scene) => scene.id === ui.editingId)) ui.editingId = ''
      render()
    },
    // Ctrl+Z in Inline settings: the last delete first, else the active Scene's changes.
    undo: () => undoDelete() || undoChange(),
    // Escape: cancel a rename or a save in progress, else close Inline settings.
    escape() {
      if (!cancelEditing()) closeSettings()
    },
    // Leaving the tab or closing the settings drops a rename or a save in progress.
    reset() {
      ui.editingId = ''
      ui.saving = false
      lastKey = ''
      render()
    },
  }
}
