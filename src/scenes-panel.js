import { createScenesTabState, sceneButtonTarget } from './scenes-tab-state.js'

// The Scenes tab of Inline settings (ADR 0037): the saved Scenes as a list or a grid of small
// screens, a slot that saves the live look, rename, delete with Undo, Undo after a change saved into
// the active Scene, reorder, and Import/Export. This module is the DOM side only: it builds the tab
// from what `scenes-tab-state.js` says to draw, turns DOM events into its events and carries out the
// step each one returns (focus, the save button, announcements, a timer). State shows on the controls
// themselves: no notice is drawn on the camera.

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

// A button's `data-act` is its tab state event. Only these, so a button never sends `state`, `tick`,
// `focused`, `reset` or another event only this adapter sends.
const BUTTON_ACTS = new Set([
  'apply', 'rename', 'rename-ok', 'rename-cancel', 'delete', 'undo-delete', 'undo-change', 'save-open', 'save-ok', 'import', 'export',
])

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
  const tab = createScenesTabState({ camFrame, now })
  // The rename field's text and mark, as last drawn.
  let rename = { value: '', invalid: false }
  let wakeTimer

  const find = (key) => key && root.querySelector(`[data-key="${CSS.escape(key)}"]`)
  const send = (event) => run(tab.send(event))

  function run(step) {
    if (step.draw) draw(step.draw, step.focus)
    if (step.select) find(step.select)?.select()
    if (step.saveButton) updateSaveButton(step.saveButton)
    for (const text of step.announce) announce(text)
    if (step.closeSettings) closeSettings()
    if (step.wakeIn !== undefined) {
      clearTimeout(wakeTimer)
      if (step.wakeIn !== null) wakeTimer = setTimeout(() => send({ type: 'tick' }), step.wakeIn)
    }
    if (step.file) runFile(step.file)
    return step
  }

  function draw({ model, files, time, renameValue, renameInvalid }, focusKey) {
    rename = { value: renameValue, invalid: renameInvalid }
    const focused = root.contains(document.activeElement) ? document.activeElement : undefined
    const selection =
      focused && 'selectionStart' in focused ? [focused.selectionStart, focused.selectionEnd] : undefined
    root.replaceChildren(head(model), model.view === 'grid' ? grid(model, time) : list(model, time), fileRow(model, files))
    const target = find(focusKey)
    if (target) {
      send({ type: 'focused' })
      target.focus()
    } else if (focused?.dataset.key) {
      const again = find(focused.dataset.key)
      again?.focus()
      if (again && selection && 'selectionStart' in again) again.setSelectionRange(...selection)
    }
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
      value: rename.value,
      'data-role': 'rename',
      'data-key': `rename:${item.id}`,
      'aria-label': `Name for scene ${item.slot}`,
      'aria-invalid': rename.invalid ? 'true' : undefined,
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
  function updateSaveButton(add) {
    const button = root.querySelector('[data-key="save-ok"]')
    if (!button) return
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

  // ---- events ----

  async function runFile(act) {
    const result = act === 'import' ? await camFrame.importPresets() : await camFrame.exportPresets()
    send({ type: 'file-result', act, result })
  }

  root.addEventListener('click', (event) => {
    const viewButton = event.target.closest('[data-view]')
    if (viewButton) {
      send({ type: 'view', view: viewButton.dataset.view })
      return
    }
    const button = event.target.closest('[data-act]')
    if (!button || button.disabled || !BUTTON_ACTS.has(button.dataset.act)) return
    send({ type: button.dataset.act, id: button.closest('[data-id]')?.dataset.id ?? '' })
  })

  root.addEventListener('input', (event) => {
    const role = event.target.dataset.role
    if (role) send({ type: 'input', role, value: event.target.value })
  })

  root.addEventListener('compositionstart', () => send({ type: 'compositionstart' }))
  root.addEventListener('compositionend', () => send({ type: 'compositionend' }))

  root.addEventListener('keydown', (event) => {
    const target = event.target
    const role = target.dataset?.role ?? (target.dataset?.act === 'apply' ? 'scene' : '')
    const step = send({
      type: 'keydown',
      key: event.key,
      altKey: event.altKey,
      isComposing: event.isComposing,
      role,
      id: target.closest?.('[data-id]')?.dataset.id ?? '',
    })
    if (step.preventDefault) event.preventDefault()
    if (step.stopPropagation) event.stopPropagation()
    if (!step.navigate) return
    const mains = [...root.querySelectorAll('[data-act="apply"]')]
    const next = sceneButtonTarget({
      key: step.navigate,
      index: mains.indexOf(target),
      rects: mains.map((main) => main.getBoundingClientRect()),
      grid: Boolean(root.querySelector('.scene-grid')),
    })
    if (next === undefined) return
    event.preventDefault()
    mains[next].focus()
  })

  // Drag a Scene onto another to move it there.
  const clearDragOver = () => root.querySelectorAll('.drag-over').forEach((node) => node.classList.remove('drag-over'))
  const draggedItem = (event) => event.target.closest?.('[draggable="true"]')
  root.addEventListener('dragstart', (event) => {
    const item = draggedItem(event)
    if (!item) return
    send({ type: 'dragstart', id: item.dataset.id })
    event.dataTransfer.effectAllowed = 'move'
    event.dataTransfer.setData('text/plain', item.dataset.id)
  })
  root.addEventListener('dragover', (event) => {
    const item = draggedItem(event)
    if (!item) return
    const step = send({ type: 'dragover', id: item.dataset.id })
    if (!step.preventDefault) return
    event.preventDefault()
    clearDragOver()
    if (step.highlight) item.classList.add('drag-over')
  })
  root.addEventListener('drop', (event) => {
    const item = draggedItem(event)
    if (item && send({ type: 'drop', id: item.dataset.id }).preventDefault) event.preventDefault()
  })
  root.addEventListener('dragend', () => {
    send({ type: 'dragend' })
    clearDragOver()
  })

  return {
    update(state) {
      send({ type: 'state', state })
    },
    // Ctrl+Z in Inline settings: the last delete first, else the active Scene's changes.
    undo: () => send({ type: 'undo' }).handled,
    // Escape: cancel a rename or a save in progress, else close Inline settings.
    escape() {
      send({ type: 'escape' })
    },
    // Leaving the tab or closing the settings drops a rename or a save in progress.
    reset() {
      send({ type: 'reset' })
    },
  }
}
