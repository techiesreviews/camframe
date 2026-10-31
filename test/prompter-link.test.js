import test from 'node:test'
import assert from 'node:assert/strict'
import { EventEmitter } from 'node:events'
import { createServer, request as httpRequest } from 'node:http'
import { DEFAULT_SETTINGS, sanitizeSettings } from '../src/settings.js'
import {
  PROMPTER_LINK_HOST,
  PROMPTER_LINK_PORT,
  createPrompterLink,
  cueAction,
  hostAllowed,
  linkStatusBody,
  originAllowed,
  parseCue,
} from '../src/prompter-link.js'

const scenes = [
  { id: 'preset-demo', name: 'Demo', settings: {} },
  { id: 'preset-talk', name: 'Talking head', settings: {} },
]
const withScenes = (patch = {}) => sanitizeSettings({ presets: scenes, ...patch })

function call(port, { method = 'GET', path = '/camframe/status', headers = {}, body } = {}) {
  return new Promise((resolve, reject) => {
    const request = httpRequest(
      { host: PROMPTER_LINK_HOST, port, method, path, agent: false, headers: { Host: `127.0.0.1:${port}`, ...headers } },
      (response) => {
        let text = ''
        response.setEncoding('utf8')
        response.on('data', (chunk) => {
          text += chunk
        })
        response.on('end', () => {
          resolve({ status: response.statusCode, headers: response.headers, body: text ? JSON.parse(text) : undefined })
        })
      },
    )
    request.on('error', reject)
    if (body !== undefined) request.write(typeof body === 'string' ? body : JSON.stringify(body))
    request.end()
  })
}

const json = { 'Content-Type': 'application/json' }
const PROMPTER = 'https://prompter.techies.tools'
const PREVIEW = 'https://preview.prompter.techies.tools'

async function startLink(t, { settings = withScenes(), applyCue } = {}) {
  const cues = []
  const states = []
  const link = createPrompterLink({
    port: 0,
    status: () => linkStatusBody(settings, '0.6.0'),
    applyCue: (cue) => {
      cues.push(cue)
      if (applyCue) return applyCue(cue)
      const plan = cueAction(cue, settings)
      return plan.error ? plan : { ok: true }
    },
    onState: (state) => states.push(state),
  })
  link.setEnabled(true)
  t.after(() => link.close())
  await new Promise((resolve) => {
    const wait = () => (link.state().state === 'starting' ? setTimeout(wait, 5) : resolve())
    wait()
  })
  return { link, cues, states, port: link.address().port }
}

test('the link is off by default and uses its documented local port', () => {
  assert.equal(DEFAULT_SETTINGS.prompterLink, false)
  assert.equal(sanitizeSettings({}).prompterLink, false)
  assert.equal(PROMPTER_LINK_PORT, 47833)
  assert.equal(PROMPTER_LINK_HOST, '127.0.0.1')

  let created = 0
  const link = createPrompterLink({
    createServer: () => {
      created += 1
      throw new Error('must not listen')
    },
    status: () => ({}),
    applyCue: () => ({ ok: true }),
  })
  link.setEnabled(false)
  assert.equal(created, 0)
  assert.deepEqual(link.state(), { state: 'off', port: PROMPTER_LINK_PORT, message: '' })
})

test('turning the link on listens on 127.0.0.1 only; turning it off closes the port', async (t) => {
  const { link, port, states } = await startLink(t)
  assert.equal(link.address().address, '127.0.0.1')
  assert.deepEqual(states.map((state) => state.state), ['starting', 'on'])
  assert.equal(states.at(-1).port, port)

  const status = await call(port, { headers: { Origin: PROMPTER } })
  assert.equal(status.status, 200)
  assert.deepEqual(status.body, { app: 'camframe', version: '0.6.0', scenes: ['Demo', 'Talking head'] })

  link.setEnabled(false)
  assert.equal(link.state().state, 'off')
  await assert.rejects(call(port), /ECONNREFUSED/)
})

test('turning the link on and off in the same tick leaves no listener behind', async (t) => {
  const probe = createServer()
  await new Promise((resolve) => probe.listen(0, '127.0.0.1', resolve))
  const port = probe.address().port
  await new Promise((resolve) => probe.close(resolve))
  const states = []
  const link = createPrompterLink({ port, status: () => ({}), applyCue: () => ({ ok: true }), onState: (s) => states.push(s) })
  t.after(() => link.close())
  link.setEnabled(true)
  link.setEnabled(false)
  await new Promise((resolve) => setTimeout(resolve, 50))
  assert.equal(link.state().state, 'off')
  assert.deepEqual(states.map((state) => state.state), ['starting', 'off'])
  await assert.rejects(call(port), /ECONNREFUSED/)

  // The port is free for the next "on".
  link.setEnabled(true)
  await new Promise((resolve) => {
    const wait = () => (link.state().state === 'starting' ? setTimeout(wait, 5) : resolve())
    wait()
  })
  assert.equal(link.state().state, 'on')
})

test('a port that opens after the link was turned off is closed at once', async () => {
  // Some Node versions still bind after close() when the host lookup was pending; model that.
  const server = new EventEmitter()
  Object.assign(server, {
    listening: false,
    listen(port, host, done) {
      setImmediate(() => {
        server.listening = true
        done()
      })
    },
    close() {
      server.listening = false
    },
    address: () => ({ address: '127.0.0.1', port: 47833 }),
  })
  const link = createPrompterLink({ createServer: () => server, status: () => ({}), applyCue: () => ({ ok: true }) })
  link.setEnabled(true)
  link.setEnabled(false)
  await new Promise((resolve) => setImmediate(resolve))
  assert.equal(server.listening, false)
  assert.equal(link.state().state, 'off')
})

test('on, off and on again before the port opens reuses the same server', async () => {
  // A second server would race the first for the port (EADDRINUSE) on Node versions that still bind it.
  let created = 0
  let bound = false
  const server = new EventEmitter()
  Object.assign(server, {
    listen(port, host, done) {
      if (bound) throw Object.assign(new Error('in use'), { code: 'EADDRINUSE' })
      setImmediate(() => {
        bound = true
        done()
      })
    },
    close() {
      bound = false
    },
    address: () => ({ address: '127.0.0.1', port: 47833 }),
  })
  const states = []
  const link = createPrompterLink({
    createServer: () => {
      created += 1
      return server
    },
    status: () => ({}),
    applyCue: () => ({ ok: true }),
    onState: (s) => states.push(s.state),
  })
  link.setEnabled(true)
  link.setEnabled(false)
  link.setEnabled(true)
  await new Promise((resolve) => setImmediate(resolve))
  assert.equal(created, 1)
  assert.equal(bound, true)
  assert.equal(link.state().state, 'on')
  assert.deepEqual(states, ['starting', 'off', 'starting', 'on'])
  link.close()
  assert.equal(bound, false)
})

test('a busy port is reported, not thrown', async (t) => {
  const blocker = createServer()
  await new Promise((resolve) => blocker.listen(0, '127.0.0.1', resolve))
  t.after(() => blocker.close())
  const busyPort = blocker.address().port
  const states = []
  const link = createPrompterLink({ port: busyPort, status: () => ({}), applyCue: () => ({ ok: true }), onState: (s) => states.push(s) })
  link.setEnabled(true)
  await new Promise((resolve) => {
    const wait = () => (link.state().state === 'starting' ? setTimeout(wait, 5) : resolve())
    wait()
  })
  assert.equal(link.state().state, 'error')
  assert.equal(link.state().message, `Port ${busyPort} is in use by another app.`)
  link.close()
  assert.equal(link.state().state, 'off')
})

test('origins: the prompter site, its preview, localhost pages and file:// copies only', () => {
  assert.equal(originAllowed(PROMPTER), true)
  assert.equal(originAllowed(PREVIEW), true, "the prompter's preview")
  assert.equal(originAllowed('null'), true)
  assert.equal(originAllowed('http://localhost:8787'), true)
  assert.equal(originAllowed('http://127.0.0.1:5173'), true)
  assert.equal(originAllowed('http://localhost'), true)
  assert.equal(originAllowed(undefined), true, 'a program on this computer sends no Origin')
  for (const origin of [
    'https://evil.example',
    'http://prompter.techies.tools',
    'https://prompter.techies.tools.evil.example',
    'http://preview.prompter.techies.tools',
    'https://preview.prompter.techies.tools.evil.example',
    'https://evil.preview.prompter.techies.tools',
    'https://preview.prompter.techies.tools:8443',
    'https://localhost:8787',
    'http://localhost.evil.example',
    'http://127.0.0.1.evil.example',
    'http://192.168.1.4:8787',
    '',
  ]) {
    assert.equal(originAllowed(origin), false, origin)
  }
  assert.equal(hostAllowed('127.0.0.1:47833'), true)
  assert.equal(hostAllowed('localhost:47833'), true)
  assert.equal(hostAllowed('evil.example:47833'), false)
  assert.equal(hostAllowed(undefined), false)
})

test('other sites are refused, and so is a rebound host name', async (t) => {
  const { port, cues } = await startLink(t)
  const refused = await call(port, {
    method: 'POST',
    path: '/camframe/cue',
    headers: { ...json, Origin: 'https://evil.example' },
    body: { size: 'full' },
  })
  assert.equal(refused.status, 403)
  assert.equal(refused.headers['access-control-allow-origin'], undefined)

  const rebound = await call(port, { headers: { Host: `evil.example:${port}`, Origin: `http://evil.example:${port}` } })
  assert.equal(rebound.status, 403)
  assert.deepEqual(cues, [])
})

test('a file:// copy (Origin null) and a localhost Host reach the endpoint', async (t) => {
  const { port, cues } = await startLink(t)
  const fromFile = await call(port, {
    method: 'POST',
    path: '/camframe/cue',
    headers: { ...json, Origin: 'null' },
    body: { size: 'full' },
  })
  assert.equal(fromFile.status, 200)
  assert.equal(fromFile.headers['access-control-allow-origin'], 'null')

  const localhost = await call(port, {
    method: 'POST',
    path: '/camframe/cue',
    headers: { ...json, Host: `localhost:${port}`, Origin: PROMPTER },
    body: { size: 'small' },
  })
  assert.equal(localhost.status, 200)
  assert.equal(localhost.headers['access-control-allow-origin'], PROMPTER)
  assert.deepEqual(cues, [{ size: 'full' }, { size: 'small' }])
})

test('preflights answer the prompter, including Chrome Private Network Access', async (t) => {
  const { port } = await startLink(t)
  const preflight = await call(port, {
    method: 'OPTIONS',
    path: '/camframe/cue',
    headers: {
      Origin: PROMPTER,
      'Access-Control-Request-Method': 'POST',
      'Access-Control-Request-Headers': 'content-type',
      'Access-Control-Request-Private-Network': 'true',
    },
  })
  assert.equal(preflight.status, 204)
  assert.equal(preflight.headers['access-control-allow-origin'], PROMPTER)
  assert.equal(preflight.headers['access-control-allow-private-network'], 'true')
  assert.match(preflight.headers['access-control-allow-methods'], /POST/)
  assert.match(preflight.headers['access-control-allow-headers'], /Content-Type/)

  const fileCopy = await call(port, { method: 'OPTIONS', path: '/camframe/cue', headers: { Origin: 'null' } })
  assert.equal(fileCopy.status, 204)
  assert.equal(fileCopy.headers['access-control-allow-origin'], 'null')
  assert.equal(fileCopy.headers['access-control-allow-private-network'], undefined)
})

test("the prompter's preview gets the same answers as the live site; a look-alike does not", async (t) => {
  const { port, cues } = await startLink(t)
  const status = await call(port, { headers: { Origin: PREVIEW } })
  assert.equal(status.status, 200)
  assert.equal(status.headers['access-control-allow-origin'], PREVIEW)

  const preflight = await call(port, {
    method: 'OPTIONS',
    path: '/camframe/cue',
    headers: {
      Origin: PREVIEW,
      'Access-Control-Request-Method': 'POST',
      'Access-Control-Request-Headers': 'content-type',
      'Access-Control-Request-Private-Network': 'true',
    },
  })
  assert.equal(preflight.status, 204)
  assert.equal(preflight.headers['access-control-allow-origin'], PREVIEW)
  assert.equal(preflight.headers['access-control-allow-private-network'], 'true')

  const cue = await call(port, { method: 'POST', path: '/camframe/cue', headers: { ...json, Origin: PREVIEW }, body: { size: 'full' } })
  assert.equal(cue.status, 200)
  assert.equal(cue.headers['access-control-allow-origin'], PREVIEW)

  const lookAlike = await call(port, {
    method: 'POST',
    path: '/camframe/cue',
    headers: { ...json, Origin: 'https://evil.preview.prompter.techies.tools' },
    body: { size: 'small' },
  })
  assert.equal(lookAlike.status, 403)
  assert.equal(lookAlike.headers['access-control-allow-origin'], undefined)
  const lookAlikePreflight = await call(port, {
    method: 'OPTIONS',
    path: '/camframe/cue',
    headers: {
      Origin: 'https://evil.preview.prompter.techies.tools',
      'Access-Control-Request-Method': 'POST',
      'Access-Control-Request-Private-Network': 'true',
    },
  })
  assert.equal(lookAlikePreflight.status, 403)
  assert.equal(lookAlikePreflight.headers['access-control-allow-origin'], undefined)
  assert.equal(lookAlikePreflight.headers['access-control-allow-private-network'], undefined)
  assert.deepEqual(cues, [{ size: 'full' }])
})

test('cues are checked strictly', () => {
  assert.deepEqual(parseCue({ size: 'full' }), { cue: { size: 'full' } })
  assert.deepEqual(parseCue({ size: 'small' }), { cue: { size: 'small' } })
  assert.deepEqual(parseCue({ size: 'small', position: 'bottom-right' }), {
    cue: { size: 'small', position: 'bottom-right' },
  })
  assert.deepEqual(parseCue({ scene: '  Demo ' }), { cue: { size: 'small', scene: 'Demo' } })
  assert.deepEqual(parseCue({ size: 'small', scene: 'Demo' }), { cue: { size: 'small', scene: 'Demo' } })

  for (const bad of [
    null,
    [],
    'full',
    {},
    { size: 'big' },
    { size: 'FULL' },
    { size: 'full', position: 'top-left' },
    { size: 'small', position: 'middle' },
    { size: 'small', position: 'top left' },
    { position: 'left' },
    { scene: '' },
    { scene: 7 },
    { scene: 'x'.repeat(41) },
    { scene: 'Demo', position: 'left' },
    { scene: 'Demo', size: 'full' },
    { size: 'full', extra: true },
  ]) {
    assert.ok(parseCue(bad).error, JSON.stringify(bad))
  }
})

test('the endpoint applies a valid cue and explains bad ones', async (t) => {
  const { port, cues } = await startLink(t)
  const post = (body, headers = json) =>
    call(port, { method: 'POST', path: '/camframe/cue', headers: { ...headers, Origin: PROMPTER }, body })

  const ok = await post({ size: 'small', position: 'top-left' })
  assert.equal(ok.status, 200)
  assert.deepEqual(ok.body, { ok: true, cue: { size: 'small', position: 'top-left' } })
  assert.equal(ok.headers['access-control-allow-origin'], PROMPTER)

  const unknownScene = await post({ scene: 'Outro' })
  assert.equal(unknownScene.status, 404)
  assert.equal(unknownScene.body.error, 'CamFrame has no Scene named "Outro".')

  const badValue = await post({ size: 'huge' })
  assert.equal(badValue.status, 400)
  assert.equal(badValue.body.error, 'size must be "full" or "small".')

  assert.equal((await post('{"size":', json)).status, 400)
  assert.equal((await post({ size: 'full' }, { 'Content-Type': 'text/plain' })).status, 415)
  assert.equal((await post({ size: 'full', scene: 'x'.repeat(2000) })).status, 413)
  assert.equal((await call(port, { method: 'GET', path: '/camframe/cue' })).status, 405)
  assert.equal((await call(port, { method: 'POST', path: '/camframe/status', headers: json, body: {} })).status, 405)
  assert.equal((await call(port, { path: '/other' })).status, 404)

  assert.deepEqual(cues, [{ size: 'small', position: 'top-left' }, { size: 'small', scene: 'Outro' }])
})

test('cue actions follow the Face full and Face small settings', () => {
  const settings = withScenes()
  assert.deepEqual(cueAction({ size: 'full' }, settings), { action: 'fullscreen' })
  assert.deepEqual(cueAction({ size: 'small' }, settings), { action: 'compact' })
  assert.deepEqual(cueAction({ size: 'small', position: 'right' }, settings), { action: 'place', spot: 'right' })
  assert.deepEqual(cueAction({ size: 'small', scene: 'talking HEAD' }, settings), {
    action: 'scene',
    sceneId: 'preset-talk',
  })

  const chosen = withScenes({ prompterFaceFull: 'scene:preset-demo', prompterFaceSmall: 'bottom-left' })
  assert.deepEqual(cueAction({ size: 'full' }, chosen), { action: 'scene', sceneId: 'preset-demo' })
  assert.deepEqual(cueAction({ size: 'small' }, chosen), { action: 'place', spot: 'bottom-left' })
  assert.deepEqual(cueAction({ size: 'small', position: 'top-right' }, chosen), {
    action: 'place',
    spot: 'top-right',
  })

  const smallScene = withScenes({ prompterFaceSmall: 'scene:preset-talk' })
  assert.deepEqual(cueAction({ size: 'small' }, smallScene), { action: 'scene', sceneId: 'preset-talk' })

  const deleted = sanitizeSettings({ prompterFaceFull: 'scene:gone', prompterFaceSmall: 'scene:gone' })
  assert.deepEqual(cueAction({ size: 'full' }, deleted), { action: 'fullscreen' })
  assert.deepEqual(cueAction({ size: 'small' }, deleted), { action: 'compact' })
})
