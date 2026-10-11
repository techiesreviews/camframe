import { DEFAULT_SETTINGS } from './settings.js'

// The one contract between the Electron main process and the Overlay renderer.
//
// `kind` is how the renderer reaches main: `invoke` (async reply), `send` (fire and forget),
// `sendSync` (blocking reply), or `event` (main pushes to a renderer subscription). `check`
// validates and normalizes untrusted renderer arguments; a `send` whose check fails is dropped.
//
// The sandboxed preload cannot import this file, so `src/preload.cjs` is a hand-written adapter
// that `test/bridge.test.js` verifies against this table. Main registers handlers from it and the
// browser QA preview builds its fake from it.

const isPlainObject = (value) =>
  Boolean(value) && typeof value === 'object' && Object.getPrototypeOf(value) === Object.prototype

// Renderer patches may change ordinary settings, never Scenes, onboarding completion, or schema.
const RENDERER_SETTING_KEYS = new Set(
  Object.keys(DEFAULT_SETTINGS).filter(
    (key) => !['schemaVersion', 'presets', 'completedOnboardingVersion'].includes(key),
  ),
)

const settingsPatch = (patch) => {
  if (!isPlainObject(patch)) return undefined
  return [Object.fromEntries(Object.entries(patch).filter(([key]) => RENDERER_SETTING_KEYS.has(key)))]
}
const optionalString = (value) => (value === undefined || value === null ? '' : String(value))
const noArguments = () => []
const flag = (value) => [Boolean(value)]

export const BRIDGE_CONTRACT = Object.freeze([
  { method: 'getState', channel: 'state:get', kind: 'invoke', check: noArguments },
  { method: 'updateState', channel: 'state:update', kind: 'send', check: settingsPatch },
  {
    method: 'reportAccessibilityPreferences',
    channel: 'accessibility:preferences',
    kind: 'send',
    check: (preferences) =>
      isPlainObject(preferences)
        ? [{ reducedMotion: Boolean(preferences.reducedMotion), highContrast: Boolean(preferences.highContrast) }]
        : undefined,
  },
  {
    method: 'savePreset',
    channel: 'preset:save',
    kind: 'send',
    check: (name, id) => [optionalString(name), optionalString(id)],
  },
  { method: 'applyPreset', channel: 'preset:apply', kind: 'send', check: (id) => [optionalString(id)] },
  { method: 'deletePreset', channel: 'preset:delete', kind: 'send', check: (id) => [optionalString(id)] },
  {
    method: 'reorderPreset',
    channel: 'preset:reorder',
    kind: 'send',
    check: (id, direction) => (Number.isFinite(direction) ? [optionalString(id), direction] : undefined),
  },
  { method: 'exportPresets', channel: 'preset:export', kind: 'invoke', check: noArguments },
  { method: 'importPresets', channel: 'preset:import', kind: 'invoke', check: noArguments },
  { method: 'setOverlayInteractive', channel: 'overlay:interactive', kind: 'send', check: flag },
  { method: 'setOverlaySettingsOpen', channel: 'overlay:settings-open', kind: 'send', check: flag },
  {
    method: 'setOverlayOnboardingOpen',
    channel: 'overlay:onboarding-open',
    kind: 'sendSync',
    check: flag,
    rejected: 0,
  },
  { method: 'completeOnboarding', channel: 'onboarding:complete', kind: 'send', check: noArguments },
  { method: 'startOverlayDrag', channel: 'overlay:drag-start', kind: 'send', check: noArguments },
  { method: 'stopOverlayDrag', channel: 'overlay:drag-stop', kind: 'send', check: noArguments },
  {
    method: 'startOverlayResize',
    channel: 'overlay:resize-start',
    kind: 'send',
    check: (handle) => (typeof handle === 'string' ? [handle] : undefined),
  },
  { method: 'stopOverlayResize', channel: 'overlay:resize-stop', kind: 'send', check: noArguments },
  { method: 'toggleFullscreen', channel: 'overlay:fullscreen-toggle', kind: 'send', check: noArguments },
  { method: 'exitFullscreen', channel: 'overlay:fullscreen-exit', kind: 'send', check: noArguments },
  { method: 'quit', channel: 'app:quit', kind: 'send', check: noArguments },
  { method: 'onStateChanged', channel: 'state:changed', kind: 'event' },
  { method: 'onFullscreenChanged', channel: 'fullscreen:changed', kind: 'event' },
  { method: 'onShowControls', channel: 'controls:show', kind: 'event' },
  { method: 'onPresentationNotice', channel: 'presentation:notice', kind: 'event' },
  { method: 'onShowOnboarding', channel: 'onboarding:show', kind: 'event' },
])

const contractEntry = (method) => {
  const entry = BRIDGE_CONTRACT.find((candidate) => candidate.method === method)
  if (!entry) throw new Error(`Unknown bridge method: ${method}`)
  return entry
}

// Registers one handler per renderer→main entry. Every channel only accepts the Overlay renderer
// (`isOverlaySender(event)`) and checked arguments. `handlers` must cover the contract exactly.
export function registerBridgeHandlers(ipcMain, { isOverlaySender, handlers }) {
  const requests = BRIDGE_CONTRACT.filter((entry) => entry.kind !== 'event')
  const missing = requests.filter((entry) => typeof handlers[entry.method] !== 'function')
  const unknown = Object.keys(handlers).filter((method) => !requests.some((entry) => entry.method === method))
  if (missing.length || unknown.length) {
    throw new Error(
      `Bridge handlers do not match the contract. Missing: ${missing.map((entry) => entry.method).join(', ') || 'none'}. Unknown: ${unknown.join(', ') || 'none'}.`,
    )
  }

  for (const entry of requests) {
    const handler = handlers[entry.method]
    const accept = (event, args) => (isOverlaySender(event) ? entry.check(...args) : undefined)
    if (entry.kind === 'invoke') {
      ipcMain.handle(entry.channel, (event, ...args) => {
        const checked = accept(event, args)
        if (!checked) throw new Error(`Rejected ${entry.channel}`)
        return handler(...checked)
      })
    } else if (entry.kind === 'sendSync') {
      ipcMain.on(entry.channel, (event, ...args) => {
        const checked = accept(event, args)
        event.returnValue = checked ? handler(...checked) : entry.rejected
      })
    } else {
      ipcMain.on(entry.channel, (event, ...args) => {
        const checked = accept(event, args)
        if (checked) handler(...checked)
      })
    }
  }
}

// Sends a main→renderer event by its renderer subscription name, e.g. `onStateChanged`.
export function sendBridgeEvent(webContents, method, ...payload) {
  const entry = contractEntry(method)
  if (entry.kind !== 'event') throw new Error(`${method} is not a bridge event`)
  if (!webContents || webContents.isDestroyed?.()) return
  webContents.send(entry.channel, ...payload)
}

// A complete in-page stand-in for `window.camFrame`, for the browser QA preview. Methods default to
// harmless no-ops; `overrides` replace them. `emit(method, ...payload)` fires an event subscription.
export function createBridgeFake({ platform, overrides = {} }) {
  const listeners = new Map()
  const bridge = { platform }
  for (const entry of BRIDGE_CONTRACT) {
    if (entry.kind === 'event') {
      bridge[entry.method] = (callback) => {
        const set = listeners.get(entry.method) ?? new Set()
        set.add(callback)
        listeners.set(entry.method, set)
        return () => set.delete(callback)
      }
    } else if (entry.kind === 'invoke') {
      bridge[entry.method] = async () => undefined
    } else if (entry.kind === 'sendSync') {
      bridge[entry.method] = () => entry.rejected
    } else {
      bridge[entry.method] = () => {}
    }
  }
  for (const [method, override] of Object.entries(overrides)) {
    if (contractEntry(method).kind === 'event') throw new Error(`Cannot override bridge event ${method}`)
    bridge[method] = override
  }
  return {
    bridge,
    emit(method, ...payload) {
      if (contractEntry(method).kind !== 'event') throw new Error(`${method} is not a bridge event`)
      listeners.get(method)?.forEach((callback) => callback(...payload))
    },
  }
}
