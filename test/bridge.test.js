import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import vm from 'node:vm'
import {
  BRIDGE_CONTRACT,
  createBridgeFake,
  registerBridgeHandlers,
  sendBridgeEvent,
} from '../src/bridge.js'

function loadPreload() {
  const source = readFileSync(join(import.meta.dirname, '..', 'src', 'preload.cjs'), 'utf8')
  const exposed = {}
  const calls = []
  const listeners = new Map()
  const required = []
  const ipcRenderer = {
    send: (channel, ...args) => calls.push({ kind: 'send', channel, args }),
    sendSync: (channel, ...args) => {
      calls.push({ kind: 'sendSync', channel, args })
      return 'sync-reply'
    },
    invoke: async (channel, ...args) => {
      calls.push({ kind: 'invoke', channel, args })
      return 'invoke-reply'
    },
    on: (channel, listener) => listeners.set(channel, listener),
    removeListener: (channel, listener) => {
      if (listeners.get(channel) === listener) listeners.delete(channel)
    },
  }
  vm.runInNewContext(source, {
    process: { platform: 'test-os' },
    require(name) {
      required.push(name)
      if (name !== 'electron') throw new Error(`Sandboxed preload cannot require ${name}`)
      return { contextBridge: { exposeInMainWorld: (key, api) => (exposed[key] = api) }, ipcRenderer }
    },
  })
  return { api: exposed.camFrame, calls, listeners, required }
}

function fakeIpcMain() {
  const routes = new Map()
  return {
    routes,
    handle: (channel, listener) => routes.set(channel, { type: 'handle', listener }),
    on: (channel, listener) => routes.set(channel, { type: 'on', listener }),
  }
}

const overlaySender = { id: 'overlay' }
const handlersRecording = (log) =>
  Object.fromEntries(
    BRIDGE_CONTRACT.filter((entry) => entry.kind !== 'event').map((entry) => [
      entry.method,
      (...args) => {
        log.push([entry.method, ...args])
        return `${entry.method}-result`
      },
    ]),
  )

test('the sandboxed preload exposes exactly the bridge contract', () => {
  const { api, required } = loadPreload()

  assert.deepEqual(required, ['electron'])
  assert.equal(api.platform, 'test-os')
  assert.deepEqual(
    Object.keys(api).filter((key) => key !== 'platform').sort(),
    BRIDGE_CONTRACT.map((entry) => entry.method).sort(),
  )
})

test('every preload method uses its contract channel and transport', async () => {
  const { api, calls, listeners } = loadPreload()

  for (const entry of BRIDGE_CONTRACT) {
    if (entry.kind === 'event') {
      const received = []
      const unsubscribe = api[entry.method]((...payload) => received.push(payload))
      listeners.get(entry.channel)({ sender: 'ipc' }, 'payload')
      assert.ok(received.length === 1, `${entry.method} should deliver ${entry.channel}`)
      unsubscribe()
      assert.equal(listeners.has(entry.channel), false, `${entry.method} should unsubscribe`)
      continue
    }
    calls.length = 0
    const reply = await api[entry.method]('first', 'second')
    assert.equal(calls.length, 1, entry.method)
    assert.equal(calls[0].kind, entry.kind, entry.method)
    assert.equal(calls[0].channel, entry.channel, entry.method)
    if (entry.kind === 'sendSync') assert.equal(reply, 'sync-reply')
    if (entry.kind === 'invoke') assert.equal(reply, 'invoke-reply')
  }
})

test('main registers every request channel and only accepts the Overlay renderer', async () => {
  const ipcMain = fakeIpcMain()
  const log = []
  registerBridgeHandlers(ipcMain, {
    isOverlaySender: (event) => event.sender === overlaySender,
    handlers: handlersRecording(log),
  })

  const requests = BRIDGE_CONTRACT.filter((entry) => entry.kind !== 'event')
  assert.deepEqual([...ipcMain.routes.keys()].sort(), requests.map((entry) => entry.channel).sort())

  for (const entry of requests) {
    const route = ipcMain.routes.get(entry.channel)
    const event = { sender: { id: 'other' } }
    if (route.type === 'handle') {
      assert.throws(() => route.listener(event), /Rejected/)
    } else {
      route.listener(event, true)
      if (entry.kind === 'sendSync') assert.equal(event.returnValue, entry.rejected)
    }
  }
  assert.deepEqual(log, [])
})

test('main checks and normalizes renderer arguments', async () => {
  const ipcMain = fakeIpcMain()
  const log = []
  registerBridgeHandlers(ipcMain, {
    isOverlaySender: (event) => event.sender === overlaySender,
    handlers: handlersRecording(log),
  })
  const send = (channel, ...args) => {
    const event = { sender: overlaySender }
    ipcMain.routes.get(channel).listener(event, ...args)
    return event.returnValue
  }

  send('state:update', { size: 320, presets: [], completedOnboardingVersion: 1, schemaVersion: 1 })
  send('state:update', 'not a patch')
  send('state:update', [{ size: 1 }])
  send('preset:reorder', 'one', 'up')
  send('preset:reorder', 'one', -1)
  send('preset:save', undefined, null)
  send('overlay:interactive', 'yes')
  send('overlay:resize-start', { handle: 'top-left' })
  send('overlay:resize-start', 'top-left')
  send('accessibility:preferences', { reducedMotion: 1, extra: true })
  assert.equal(send('overlay:onboarding-open', 1), 'setOverlayOnboardingOpen-result')
  assert.equal(
    await ipcMain.routes.get('state:get').listener({ sender: overlaySender }, 'ignored'),
    'getState-result',
  )

  assert.deepEqual(log, [
    ['updateState', { size: 320 }],
    ['reorderPreset', 'one', -1],
    ['savePreset', '', ''],
    ['setOverlayInteractive', true],
    ['startOverlayResize', 'top-left'],
    ['reportAccessibilityPreferences', { reducedMotion: true, highContrast: false }],
    ['setOverlayOnboardingOpen', true],
    ['getState'],
  ])
})

test('main refuses handler sets that drift from the contract', () => {
  const handlers = handlersRecording([])
  delete handlers.quit
  assert.throws(
    () => registerBridgeHandlers(fakeIpcMain(), { isOverlaySender: () => true, handlers }),
    /Missing: quit/,
  )
  assert.throws(
    () =>
      registerBridgeHandlers(fakeIpcMain(), {
        isOverlaySender: () => true,
        handlers: { ...handlersRecording([]), centerOverlay: () => {} },
      }),
    /Unknown: centerOverlay/,
  )
})

test('main sends events on their contract channel', () => {
  const sent = []
  const webContents = { send: (...args) => sent.push(args), isDestroyed: () => false }
  sendBridgeEvent(webContents, 'onStateChanged', { size: 1 })
  sendBridgeEvent(webContents, 'onShowControls')
  sendBridgeEvent(undefined, 'onShowControls')
  assert.deepEqual(sent, [['state:changed', { size: 1 }], ['controls:show']])
  assert.throws(() => sendBridgeEvent(webContents, 'getState'), /not a bridge event/)
})

test('the browser QA fake implements the whole contract', async () => {
  const { bridge, emit } = createBridgeFake({
    platform: 'win32',
    overrides: { getState: async () => ({ size: 300 }) },
  })
  const received = []
  const unsubscribe = bridge.onFullscreenChanged((value) => received.push(value))

  assert.deepEqual(
    Object.keys(bridge).filter((key) => key !== 'platform').sort(),
    BRIDGE_CONTRACT.map((entry) => entry.method).sort(),
  )
  assert.deepEqual(await bridge.getState(), { size: 300 })
  assert.equal(bridge.setOverlayOnboardingOpen(true), 0)
  emit('onFullscreenChanged', true)
  unsubscribe()
  emit('onFullscreenChanged', false)
  assert.deepEqual(received, [true])
  assert.throws(() => createBridgeFake({ overrides: { onStateChanged: () => {} } }), /Cannot override/)
})
