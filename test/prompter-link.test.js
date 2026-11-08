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
  parseSceneSave,
  parseSmallSize,
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

async function startLink(t, { settings = withScenes(), applyCue, extra = {} } = {}) {
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
    ...extra,
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
  // The original fields keep their meaning; API 2 only adds fields.
  assert.equal(status.body.app, 'camframe')
  assert.equal(status.body.version, '0.6.0')
  assert.deepEqual(status.body.scenes, ['Demo', 'Talking head'])
  assert.equal(status.body.api, 2)

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

test('origins: the prompter site, localhost pages and file:// copies only; the old preview address is refused', () => {
  assert.equal(originAllowed(PROMPTER), true)
  assert.equal(originAllowed(PREVIEW), false, "the prompter's old preview address is no longer trusted")
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

test('the live prompter site gets full answers; the old preview address and look-alikes get none', async (t) => {
  const { port, cues } = await startLink(t)
  const status = await call(port, { headers: { Origin: PROMPTER } })
  assert.equal(status.status, 200)
  assert.equal(status.headers['access-control-allow-origin'], PROMPTER)

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

  const cue = await call(port, { method: 'POST', path: '/camframe/cue', headers: { ...json, Origin: PROMPTER }, body: { size: 'full' } })
  assert.equal(cue.status, 200)
  assert.equal(cue.headers['access-control-allow-origin'], PROMPTER)

  for (const origin of [PREVIEW, 'https://evil.preview.prompter.techies.tools']) {
    const refusedStatus = await call(port, { headers: { Origin: origin } })
    assert.equal(refusedStatus.status, 403, origin)
    assert.equal(refusedStatus.headers['access-control-allow-origin'], undefined, origin)
    const refusedCue = await call(port, {
      method: 'POST',
      path: '/camframe/cue',
      headers: { ...json, Origin: origin },
      body: { size: 'small' },
    })
    assert.equal(refusedCue.status, 403, origin)
    assert.equal(refusedCue.headers['access-control-allow-origin'], undefined, origin)
    const refusedPreflight = await call(port, {
      method: 'OPTIONS',
      path: '/camframe/cue',
      headers: {
        Origin: origin,
        'Access-Control-Request-Method': 'POST',
        'Access-Control-Request-Private-Network': 'true',
      },
    })
    assert.equal(refusedPreflight.status, 403, origin)
    assert.equal(refusedPreflight.headers['access-control-allow-origin'], undefined, origin)
    assert.equal(refusedPreflight.headers['access-control-allow-private-network'], undefined, origin)
  }
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

test('the Scene and small-size routes refuse an oversized body', async (t) => {
  const { port } = await startLink(t, { extra: { saveScene: () => ({ ok: true }), setSmallSize: () => ({ ok: true }) } })
  for (const path of ['/camframe/scenes', '/camframe/small-size']) {
    const response = await call(port, {
      method: 'POST',
      path,
      headers: { ...json, Origin: PROMPTER },
      body: { name: 'x'.repeat(2000) },
    })
    assert.equal(response.status, 413, path)
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
  assert.equal(badValue.body.error, 'size must be "full", "small", or a whole number of pixels from 180 to 640.')
  assert.equal(badValue.body.code, 'bad-request')
  assert.equal(unknownScene.body.code, 'unknown-scene')

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
  assert.deepEqual(cueAction({ size: 'small' }, settings), { action: 'compact', size: 288 })
  assert.deepEqual(cueAction({ size: 'small', position: 'right' }, settings), {
    action: 'place',
    size: 288,
    spot: 'right',
  })
  assert.deepEqual(cueAction({ size: 'small', scene: 'talking HEAD' }, settings), {
    action: 'scene',
    sceneId: 'preset-talk',
  })

  const chosen = withScenes({ prompterFaceFull: 'scene:preset-demo', prompterFaceSmall: 'bottom-left' })
  assert.deepEqual(cueAction({ size: 'full' }, chosen), { action: 'scene', sceneId: 'preset-demo' })
  assert.deepEqual(cueAction({ size: 'small' }, chosen), { action: 'place', size: 288, spot: 'bottom-left' })
  assert.deepEqual(cueAction({ size: 'small', position: 'top-right' }, chosen), {
    action: 'place',
    size: 288,
    spot: 'top-right',
  })

  const smallScene = withScenes({ prompterFaceSmall: 'scene:preset-talk' })
  assert.deepEqual(cueAction({ size: 'small' }, smallScene), { action: 'scene', sceneId: 'preset-talk' })

  const deleted = sanitizeSettings({ prompterFaceFull: 'scene:gone', prompterFaceSmall: 'scene:gone' })
  assert.deepEqual(cueAction({ size: 'full' }, deleted), { action: 'fullscreen' })
  assert.deepEqual(cueAction({ size: 'small' }, deleted), { action: 'compact', size: 288 })
})

test('cues take an exact size, an exact point, a margin and a right-hand share', () => {
  assert.deepEqual(parseCue({ size: 432, position: 'right', withinRight: 0.3 }), {
    cue: { size: 432, position: 'right', withinRight: 0.3 },
  })
  assert.deepEqual(parseCue({ size: 300 }), { cue: { size: 300 } })
  assert.deepEqual(parseCue({ size: 'small', position: { x: 1500, y: 700 } }), {
    cue: { size: 'small', position: { x: 1500, y: 700 } },
  })
  assert.deepEqual(parseCue({ size: 'small', position: 'bottom-right', margin: 0 }), {
    cue: { size: 'small', position: 'bottom-right', margin: 0 },
  })
  for (const bad of [
    { size: 179 },
    { size: 641 },
    { size: 300.5 },
    { size: '432' },
    { size: 432, position: { x: 1 } },
    { size: 432, position: { x: 1, y: 2, z: 3 } },
    { size: 432, position: { x: 1.5, y: 2 } },
    { size: 432, position: { x: 1e9, y: 2 } },
    { size: 432, margin: 20 },
    { size: 432, position: { x: 1, y: 2 }, margin: 20 },
    { size: 432, position: 'right', margin: 161 },
    { size: 432, position: 'right', margin: -1 },
    { size: 432, position: 'right', withinRight: 0 },
    { size: 432, position: 'right', withinRight: 1.5 },
    { size: 432, position: 'left', withinRight: 0.3 },
    { size: 432, withinRight: 0.3 },
    { size: 'full', withinRight: 0.3 },
    { size: 'full', margin: 0 },
    { scene: 'Demo', withinRight: 0.3 },
    { scene: 'Demo', size: 432 },
  ]) {
    assert.ok(parseCue(bad).error, JSON.stringify(bad))
  }
})

test('Scene and small-size requests are checked strictly', () => {
  assert.deepEqual(parseSceneSave({ name: ' Live right large ', size: 432, position: 'right', withinRight: 0.3 }), {
    request: { name: 'Live right large', size: 432, position: 'right', withinRight: 0.3, replace: false, apply: false },
  })
  assert.deepEqual(parseSceneSave({ name: 'Here' }), {
    request: { name: 'Here', size: 'current', position: 'current', replace: false, apply: false },
  })
  for (const bad of [
    null,
    { size: 'small' },
    { name: '' },
    { name: 'x'.repeat(41) },
    { name: '\u200b' },
    { name: 'A\nB' },
    { name: '\u3164' },
    { name: '\u200d' },
    { name: '\u200c\u200d' },
    { name: '\ufe0f' },
    { name: '\u{E0067}' },
    { name: 'Demo\u200d' },
    { name: 'De\u200bmo' },
    { name: 'De\u00admo' },
    { name: 'De\u2060mo' },
    { name: 'De\ufeffmo' },
    { name: '\u2800' },
    { name: ' \u200b\u2800 ' },
    { name: 'A', size: 'big' },
    { name: 'A', size: 100 },
    { name: 'A', position: 'middle' },
    { name: 'A', position: 'current', margin: 4 },
    { name: 'A', position: 'top-left', withinRight: 0.3 },
    { name: 'A', replace: 'yes' },
    { name: 'A', apply: 1 },
    { name: 'A', scene: 'B' },
  ]) {
    assert.ok(parseSceneSave(bad).error, JSON.stringify(bad))
  }
  assert.match(parseCue({ size: 'full', margin: 0 }).error, /margin/)
  assert.match(parseCue({ size: 'full', withinRight: 0.3 }).error, /withinRight/)
  for (const good of ['\u{1F469}\u200d\u{1F4BB} Demo', '\u0645\u06cc\u200c\u062e\u0648\u0627\u0647\u0645', '\u{1F3F4}\u{E0067}\u{E0062}\u{E007F} flag']) {
    assert.equal(parseSceneSave({ name: good }).error, undefined, good)
  }
  assert.deepEqual(parseSmallSize({ size: 288 }), { request: { size: 288 } })
  assert.deepEqual(parseSmallSize({ size: 'current' }), { request: { size: 'current' } })
  for (const bad of [{}, { size: 'small' }, { size: 700 }, { size: 288, extra: 1 }, []]) {
    assert.ok(parseSmallSize(bad).error, JSON.stringify(bad))
  }
})

test('"small" means the small size, whatever size a Scene or cue set since', () => {
  const large = withScenes({ size: 432, prompterSmallSize: 288 })
  assert.deepEqual(cueAction({ size: 'small' }, large), { action: 'compact', size: 288 })
  assert.deepEqual(cueAction({ size: 'small', position: 'bottom-right' }, large), {
    action: 'place',
    size: 288,
    spot: 'bottom-right',
  })
  assert.deepEqual(cueAction({ size: 500, position: { x: 10, y: 20 } }, large), {
    action: 'place',
    size: 500,
    point: { x: 10, y: 20 },
  })
  assert.deepEqual(cueAction({ size: 400, position: 'right', margin: 8, withinRight: 0.3 }, large), {
    action: 'place',
    size: 400,
    spot: 'right',
    margin: 8,
    withinRight: 0.3,
  })
})

test('routes without a handler answer 404; new routes report checked errors with a code', async (t) => {
  const { port } = await startLink(t)
  const post = (path, body) =>
    call(port, { method: 'POST', path, headers: { ...json, Origin: PROMPTER }, body })
  assert.equal((await post('/camframe/scenes', { name: 'A' })).status, 404)
  assert.equal((await post('/camframe/small-size', { size: 288 })).status, 404)

  const saved = []
  const link = createPrompterLink({
    port: 0,
    status: () => ({}),
    applyCue: () => ({ ok: true }),
    saveScene: (request) => {
      saved.push(request)
      return request.name === 'Full'
        ? { error: 'Too many.', code: 'scene-limit', status: 409 }
        : { ok: true, scene: { name: request.name } }
    },
    setSmallSize: (request) => ({ ok: true, smallSize: request.size }),
  })
  link.setEnabled(true)
  t.after(() => link.close())
  await new Promise((resolve) => {
    const wait = () => (link.state().state === 'starting' ? setTimeout(wait, 5) : resolve())
    wait()
  })
  const other = link.address().port
  const send = (path, body) =>
    call(other, { method: 'POST', path, headers: { ...json, Origin: PROMPTER }, body })
  assert.deepEqual((await send('/camframe/scenes', { name: 'A' })).body, { ok: true, scene: { name: 'A' } })
  const full = await send('/camframe/scenes', { name: 'Full' })
  assert.equal(full.status, 409)
  assert.deepEqual(full.body, { ok: false, error: 'Too many.', code: 'scene-limit' })
  const bad = await send('/camframe/scenes', { name: 'A', size: 9000 })
  assert.equal(bad.status, 400)
  assert.equal(bad.body.code, 'bad-request')
  assert.deepEqual((await send('/camframe/small-size', { size: 300 })).body, { ok: true, smallSize: 300 })
  assert.equal((await call(other, { path: '/camframe/scenes' })).status, 405)
  // A file:// copy (or a sandboxed iframe anywhere) may cue the view but not save.
  for (const path of ['/camframe/scenes', '/camframe/small-size']) {
    const fromFile = await call(other, { method: 'POST', path, headers: { ...json, Origin: 'null' }, body: { name: 'A', size: 300 } })
    assert.equal(fromFile.status, 403, path)
  }
  assert.equal(
    (await call(other, { method: 'POST', path: '/camframe/cue', headers: { ...json, Origin: 'null' }, body: { size: 'full' } })).status,
    200,
  )
  assert.equal(saved.length, 2)
})

test('a null Origin (a file:// copy or any sandboxed iframe) reads only the Scene names', async (t) => {
  const link = createPrompterLink({
    port: 0,
    status: () => ({ app: 'camframe', version: '0.6.1', scenes: ['Demo'], api: 2, look: { cameraLabel: 'BRIO' }, view: {} }),
    applyCue: () => ({ ok: true }),
  })
  link.setEnabled(true)
  t.after(() => link.close())
  await new Promise((resolve) => {
    const wait = () => (link.state().state === 'starting' ? setTimeout(wait, 5) : resolve())
    wait()
  })
  const port = link.address().port
  const fromFile = await call(port, { headers: { Origin: 'null' } })
  assert.deepEqual(fromFile.body, { app: 'camframe', version: '0.6.1', scenes: ['Demo'], api: 2 })
  const fromSite = await call(port, { headers: { Origin: PROMPTER } })
  assert.equal(fromSite.body.look.cameraLabel, 'BRIO')
})

test('a null Origin gets cue replies without the view or the layout', async (t) => {
  // How far a size shrank (`layout`) would also give the display size away.
  const { port } = await startLink(t, { applyCue: () => ({ ok: true, layout: { size: 172, clamped: true }, view: { workArea: {} } }) })
  const cue = (origin) =>
    call(port, { method: 'POST', path: '/camframe/cue', headers: { ...json, Origin: origin }, body: { size: 'small' } })
  assert.deepEqual((await cue('null')).body, { ok: true, cue: { size: 'small' } })
  assert.deepEqual((await cue(PROMPTER)).body.view, { workArea: {} })
})

test('a null Origin gets a does-not-fit refusal without the share or margin', async (t) => {
  const refuse = () => ({ error: 'The right 10% of this display is too narrow…', code: 'does-not-fit', status: 422 })
  const { port } = await startLink(t, { applyCue: refuse })
  const send = (origin) =>
    call(port, { method: 'POST', path: '/camframe/cue', headers: { ...json, Origin: origin }, body: { size: 300 } })
  assert.deepEqual((await send('null')).body, { ok: false, error: 'That size and place do not fit this display.', code: 'does-not-fit' })
  assert.match((await send(PROMPTER)).body.error, /right 10%/)
})
