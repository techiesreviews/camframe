import { createServer as createHttpServer } from 'node:http'
import { COMPACT_SPOTS } from './settings.js'

// The Prompter link: an opt-in, view-only HTTP endpoint on this computer that lets the teleprompter
// (https://prompter.techies.tools, a local copy, or a file:// copy) switch the Overlay between Full
// screen, Compact mode at a chosen spot, and a saved Scene when its reading line reaches a cue line.
// It binds 127.0.0.1 only, answers only the prompter's origins, and never changes the camera
// itself. Main owns the window effects through `applyCue`; this module owns the wire protocol.

export const PROMPTER_LINK_HOST = '127.0.0.1'
export const PROMPTER_LINK_PORT = 47833
export const PROMPTER_SITE = 'https://prompter.techies.tools'
const MAX_BODY_BYTES = 1024
const SCENE_NAME_MAX = 40
const CUE_KEYS = new Set(['size', 'position', 'scene'])
const SIZES = new Set(['full', 'small'])
const LOCAL_ORIGIN_PATTERN = /^http:\/\/(?:localhost|127\.0\.0\.1)(?::\d{1,5})?$/

const isPlainObject = (value) =>
  Boolean(value) && typeof value === 'object' && Object.getPrototypeOf(value) === Object.prototype

// Browsers send `Origin` on every cross-origin request. `null` is a file:// copy of the prompter.
// A request without `Origin` comes from a program on this computer, not from a web page.
export function originAllowed(origin) {
  if (origin === undefined) return true
  return origin === PROMPTER_SITE || origin === 'null' || LOCAL_ORIGIN_PATTERN.test(origin)
}

// Refuses DNS rebinding: a page whose own name points at 127.0.0.1 still sends its name as Host.
export function hostAllowed(host, port = PROMPTER_LINK_PORT) {
  return host === `${PROMPTER_LINK_HOST}:${port}` || host === `localhost:${port}`
}

// Checks a cue strictly: `{ size: 'full' | 'small', position?, scene? }`, nothing else.
// A Scene cue may leave `size` out; a Scene and a position never mix, and a position needs `small`.
export function parseCue(body) {
  if (!isPlainObject(body)) return { error: 'A cue is a JSON object.' }
  const unknown = Object.keys(body).filter((key) => !CUE_KEYS.has(key))
  if (unknown.length) return { error: `Unknown cue field: ${unknown.join(', ')}.` }
  const { size, position, scene } = body
  if (size !== undefined && !SIZES.has(size)) return { error: 'size must be "full" or "small".' }
  if (position !== undefined && !COMPACT_SPOTS.includes(position)) {
    return { error: `position must be one of: ${COMPACT_SPOTS.join(', ')}.` }
  }
  if (scene !== undefined) {
    if (typeof scene !== 'string' || !scene.trim() || scene.trim().length > SCENE_NAME_MAX) {
      return { error: `scene must be a Scene name of 1 to ${SCENE_NAME_MAX} characters.` }
    }
    if (position !== undefined) return { error: 'A Scene has its own position; leave position out.' }
    if (size === 'full') return { error: 'A Scene is a compact view; use size "small" or leave size out.' }
    return { cue: { size: 'small', scene: scene.trim() } }
  }
  if (size === undefined) return { error: 'A cue needs size ("full" or "small") or scene.' }
  if (position !== undefined && size !== 'small') return { error: 'position goes only with size "small".' }
  return { cue: position === undefined ? { size } : { size, position } }
}

const sceneById = (settings, id) => settings.presets.find((scene) => scene.id === id)
const sameName = (left, right) => left.toLocaleLowerCase() === right.toLocaleLowerCase()

// What a checked cue does with the current Preferences: `fullscreen`, `compact` (back to the
// previous Compact geometry), `place` (Compact at a spot), or `scene`. Settings choose what
// "Face full" and a bare "Face small" do; a choice naming a deleted Scene falls back to the default.
export function cueAction(cue, settings) {
  if (cue.scene) {
    const scene = settings.presets.find((candidate) => sameName(candidate.name.trim(), cue.scene))
    return scene
      ? { action: 'scene', sceneId: scene.id }
      : { error: `CamFrame has no Scene named "${cue.scene}".`, status: 404 }
  }
  const choice = cue.size === 'full' ? settings.prompterFaceFull : settings.prompterFaceSmall
  if (cue.size === 'small' && cue.position) return { action: 'place', spot: cue.position }
  if (choice.startsWith('scene:') && sceneById(settings, choice.slice(6))) {
    return { action: 'scene', sceneId: choice.slice(6) }
  }
  if (cue.size === 'full') return { action: 'fullscreen' }
  if (COMPACT_SPOTS.includes(choice)) return { action: 'place', spot: choice }
  return { action: 'compact' }
}

export function linkStatusBody(settings, version) {
  return { app: 'camframe', version: String(version), scenes: settings.presets.map((scene) => scene.name) }
}

function readBody(request) {
  return new Promise((resolve, reject) => {
    let size = 0
    const chunks = []
    request.on('data', (chunk) => {
      size += chunk.length
      if (size > MAX_BODY_BYTES) {
        request.removeAllListeners('data')
        request.resume()
        reject(Object.assign(new Error('too large'), { status: 413 }))
        return
      }
      chunks.push(chunk)
    })
    request.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')))
    request.on('error', reject)
  })
}

// Runs the endpoint. `status()` returns the status body, `applyCue(cue)` applies a checked cue and
// returns `{ ok: true }` or `{ error, status }`, and `onState(state)` hears
// `{ state: 'off' | 'starting' | 'on' | 'error', port, message }` for Inline settings.
export function createPrompterLink({
  createServer = createHttpServer,
  host = PROMPTER_LINK_HOST,
  port = PROMPTER_LINK_PORT,
  status,
  applyCue,
  onState = () => {},
}) {
  let server
  let state = { state: 'off', port, message: '' }

  const setState = (next) => {
    state = { port, message: '', ...next }
    onState({ ...state })
  }

  function send(response, code, body, headers = {}) {
    const text = body === undefined ? '' : JSON.stringify(body)
    response.writeHead(code, {
      'Cache-Control': 'no-store',
      'X-Content-Type-Options': 'nosniff',
      ...(body === undefined ? {} : { 'Content-Type': 'application/json; charset=utf-8' }),
      ...headers,
    })
    response.end(text)
  }

  async function handle(request, response) {
    const origin = request.headers.origin
    const listeningPort = server?.address()?.port ?? port
    if (!hostAllowed(request.headers.host, listeningPort)) {
      send(response, 403, { ok: false, error: 'Wrong host.' })
      return
    }
    if (!originAllowed(origin)) {
      send(response, 403, { ok: false, error: 'This page may not control CamFrame.' })
      return
    }
    const cors = origin === undefined ? {} : { 'Access-Control-Allow-Origin': origin, Vary: 'Origin' }
    const path = new URL(request.url, 'http://camframe.invalid').pathname

    if (request.method === 'OPTIONS') {
      send(response, 204, undefined, {
        ...cors,
        'Access-Control-Allow-Methods': 'GET, POST',
        'Access-Control-Allow-Headers': 'Content-Type',
        'Access-Control-Max-Age': '600',
        // Chrome's Private Network Access preflight for a public page reaching this computer.
        ...(request.headers['access-control-request-private-network'] === 'true'
          ? { 'Access-Control-Allow-Private-Network': 'true' }
          : {}),
      })
      return
    }
    if (path === '/camframe/status') {
      if (request.method !== 'GET') {
        send(response, 405, { ok: false, error: 'Use GET.' }, { ...cors, Allow: 'GET' })
        return
      }
      send(response, 200, status(), cors)
      return
    }
    if (path !== '/camframe/cue') {
      send(response, 404, { ok: false, error: 'Not found.' }, cors)
      return
    }
    if (request.method !== 'POST') {
      send(response, 405, { ok: false, error: 'Use POST.' }, { ...cors, Allow: 'POST' })
      return
    }
    if (!/^application\/json\s*(?:;|$)/i.test(request.headers['content-type'] ?? '')) {
      send(response, 415, { ok: false, error: 'Send JSON.' }, cors)
      return
    }
    let body
    try {
      body = JSON.parse(await readBody(request))
    } catch (error) {
      if (error.status === 413) {
        send(response, 413, { ok: false, error: 'Cue too large.' }, { ...cors, Connection: 'close' })
      } else send(response, 400, { ok: false, error: 'Not valid JSON.' }, cors)
      return
    }
    const parsed = parseCue(body)
    if (parsed.error) {
      send(response, 400, { ok: false, error: parsed.error }, cors)
      return
    }
    const result = applyCue(parsed.cue) ?? { ok: true }
    if (result.error) {
      send(response, result.status ?? 400, { ok: false, error: result.error }, cors)
      return
    }
    send(response, 200, { ok: true, cue: parsed.cue }, cors)
  }

  function start() {
    if (server) return
    setState({ state: 'starting' })
    const next = createServer((request, response) => {
      handle(request, response).catch(() => {
        if (!response.headersSent) send(response, 500, { ok: false, error: 'CamFrame could not apply the cue.' })
        else response.destroy()
      })
    })
    next.requestTimeout = 5000
    next.headersTimeout = 5000
    next.keepAliveTimeout = 2000
    server = next
    next.on('error', (error) => {
      if (server !== next) return
      server = undefined
      next.close()
      setState({
        state: 'error',
        message:
          error.code === 'EADDRINUSE'
            ? `Port ${port} is in use by another app.`
            : `CamFrame could not listen on port ${port} (${error.code ?? 'error'}).`,
      })
    })
    next.listen(port, host, () => {
      if (server !== next) return
      setState({ state: 'on', port: next.address().port })
    })
  }

  function stop() {
    const current = server
    server = undefined
    if (current) {
      current.close()
      current.closeAllConnections?.()
    }
    if (state.state !== 'off') setState({ state: 'off' })
  }

  return {
    setEnabled(enabled) {
      if (enabled) start()
      else stop()
    },
    close: stop,
    state: () => ({ ...state }),
    address: () => server?.address(),
  }
}
