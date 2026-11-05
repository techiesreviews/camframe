import { createServer as createHttpServer } from 'node:http'
import { createHash } from 'node:crypto'
import {
  CAMERA_SIZE_MAX,
  CAMERA_SIZE_MIN,
  COMPACT_SPOTS,
  LOOK_SETTING_KEYS,
  OVERLAY_CHROME,
  PROMPTER_MARGIN_MAX,
  PROMPTER_MARGIN_MIN,
  SCENE_LIMIT,
  WITHIN_RIGHT_MAX,
  WITHIN_RIGHT_MIN,
  isWithinRightShare,
} from './settings.js'

// The Prompter link: an opt-in HTTP endpoint on this computer that lets the teleprompter
// (https://prompter.techies.tools, its preview https://preview.prompter.techies.tools, a local copy, or
// a file:// copy) switch the Overlay between Full screen, Compact mode at a chosen spot or exact
// size and place, and a saved Scene when its reading line reaches a cue line. It can also save
// layout Scenes and the size "small" restores, and reports the live view so the prompter can check
// what it got.
// It binds 127.0.0.1 only, answers only the prompter's origins, and never changes the camera
// itself. `prompter-control.js` (wired by main) acts on checked requests through `applyCue`,
// `saveScene` and `setSmallSize`; this module owns the wire protocol.

export const PROMPTER_LINK_HOST = '127.0.0.1'
export const PROMPTER_LINK_PORT = 47833
export const PROMPTER_SITE = 'https://prompter.techies.tools'
// The prompter's own test copy (its Worker techies-prompter-preview), where Lex tries a build first.
export const PROMPTER_PREVIEW_SITE = 'https://preview.prompter.techies.tools'
const MAX_BODY_BYTES = 1024
const SCENE_NAME_MAX = 40
// The version of this wire protocol in the status body. 2 added exact sizes and places, layout
// Scenes, the small size, and the live view in the status.
export const PROMPTER_LINK_API = 2
const CUE_KEYS = new Set(['size', 'position', 'scene', 'margin', 'withinRight'])
const SCENE_SAVE_KEYS = new Set(['name', 'size', 'position', 'margin', 'withinRight', 'replace', 'apply'])
const SIZES = new Set(['full', 'small'])
const POINT_LIMIT = 100000
const LOCAL_ORIGIN_PATTERN = /^http:\/\/(?:localhost|127\.0\.0\.1)(?::\d{1,5})?$/
const SIZE_RANGE = `a whole number of pixels from ${CAMERA_SIZE_MIN} to ${CAMERA_SIZE_MAX}`

const isPlainObject = (value) =>
  Boolean(value) && typeof value === 'object' && Object.getPrototypeOf(value) === Object.prototype

const PROMPTER_ORIGINS = new Set([PROMPTER_SITE, PROMPTER_PREVIEW_SITE, 'null'])

// Browsers send `Origin` on every cross-origin request. `null` is a file:// copy of the prompter.
// A request without `Origin` comes from a program on this computer, not from a web page.
export function originAllowed(origin) {
  if (origin === undefined) return true
  return PROMPTER_ORIGINS.has(origin) || LOCAL_ORIGIN_PATTERN.test(origin)
}

// Refuses DNS rebinding: a page whose own name points at 127.0.0.1 still sends its name as Host.
export function hostAllowed(host, port = PROMPTER_LINK_PORT) {
  return host === `${PROMPTER_LINK_HOST}:${port}` || host === `localhost:${port}`
}

const isCameraSize = (value) =>
  Number.isInteger(value) && value >= CAMERA_SIZE_MIN && value <= CAMERA_SIZE_MAX

// `position`: a place name, or `{ x, y }`, the screen point for the camera surface's top-left.
function parsePosition(position, { allowCurrent = false } = {}) {
  if (allowCurrent && position === 'current') return { position: 'current' }
  if (COMPACT_SPOTS.includes(position)) return { position }
  if (isPlainObject(position)) {
    const keys = Object.keys(position)
    const whole = (value) => Number.isInteger(value) && Math.abs(value) <= POINT_LIMIT
    if (keys.length === 2 && whole(position.x) && whole(position.y)) {
      return { position: { x: position.x, y: position.y } }
    }
  }
  return {
    error: `position must be one of: ${COMPACT_SPOTS.join(', ')}${allowCurrent ? ', current' : ''}; or { "x", "y" } in whole screen pixels.`,
  }
}

// `margin` and `withinRight` refine a place name; `withinRight` only a right-hand one.
function parsePlaceOptions({ position, margin, withinRight }) {
  const spot = typeof position === 'string' && COMPACT_SPOTS.includes(position) ? position : undefined
  const options = {}
  if (margin !== undefined) {
    if (!Number.isInteger(margin) || margin < PROMPTER_MARGIN_MIN || margin > PROMPTER_MARGIN_MAX) {
      return { error: `margin must be a whole number of pixels from ${PROMPTER_MARGIN_MIN} to ${PROMPTER_MARGIN_MAX}.` }
    }
    if (!spot) return { error: 'margin goes only with a place name such as "right".' }
    options.margin = margin
  }
  if (withinRight !== undefined) {
    if (!isWithinRightShare(withinRight)) {
      return { error: `withinRight must be a share of the display from ${WITHIN_RIGHT_MIN} to ${WITHIN_RIGHT_MAX}, such as 0.3.` }
    }
    if (!spot?.endsWith('right')) {
      return { error: 'withinRight goes only with "right", "top-right" or "bottom-right".' }
    }
    options.withinRight = withinRight
  }
  return { options }
}

const unknownFields = (body, keys, kind) => {
  const unknown = Object.keys(body).filter((key) => !keys.has(key))
  return unknown.length ? `Unknown ${kind} field: ${unknown.join(', ')}.` : undefined
}

// Checks a cue strictly. `size` is "full", "small" (the small size) or a camera size in pixels.
// `position` (a place name or `{ x, y }`) goes with "small" or a number; `margin` and
// `withinRight` refine a place name. A Scene cue may leave `size` out and takes nothing else.
export function parseCue(body) {
  if (!isPlainObject(body)) return { error: 'A cue is a JSON object.' }
  const unknown = unknownFields(body, CUE_KEYS, 'cue')
  if (unknown) return { error: unknown }
  const { size, position, scene, margin, withinRight } = body
  if (size !== undefined && !SIZES.has(size) && !isCameraSize(size)) {
    return { error: `size must be "full", "small", or ${SIZE_RANGE}.` }
  }
  if (scene !== undefined) {
    if (typeof scene !== 'string' || !scene.trim() || scene.trim().length > SCENE_NAME_MAX) {
      return { error: `scene must be a Scene name of 1 to ${SCENE_NAME_MAX} characters.` }
    }
    if (position !== undefined || margin !== undefined || withinRight !== undefined) {
      return { error: 'A Scene has its own size and place; leave position, margin and withinRight out.' }
    }
    if (size !== undefined && size !== 'small') {
      return { error: 'A Scene is a compact view; use size "small" or leave size out.' }
    }
    return { cue: { size: 'small', scene: scene.trim() } }
  }
  if (size === undefined) return { error: 'A cue needs size ("full", "small" or pixels) or scene.' }
  if (size === 'full') {
    if (position !== undefined || margin !== undefined || withinRight !== undefined) {
      return { error: 'position goes only with size "small" or a size in pixels.' }
    }
    return { cue: { size } }
  }
  const cue = { size }
  if (position !== undefined) {
    const parsed = parsePosition(position)
    if (parsed.error) return parsed
    cue.position = parsed.position
  }
  const place = parsePlaceOptions({ position, margin, withinRight })
  if (place.error) return place
  return { cue: { ...cue, ...place.options } }
}

// Checks a request to save a layout Scene: `name`, `size` ("small", "current" or pixels; default
// "current"), `position` (a place name, `{ x, y }` or "current"; default "current"), `margin`,
// `withinRight`, `replace` and `apply` (booleans, default false).
export function parseSceneSave(body) {
  if (!isPlainObject(body)) return { error: 'A Scene request is a JSON object.' }
  const unknown = unknownFields(body, SCENE_SAVE_KEYS, 'Scene')
  if (unknown) return { error: unknown }
  const { name, size = 'current', position = 'current', margin, withinRight, replace = false, apply = false } = body
  if (typeof name !== 'string' || !name.trim() || name.trim().length > SCENE_NAME_MAX) {
    return { error: `name must be a Scene name of 1 to ${SCENE_NAME_MAX} characters.` }
  }
  if (size !== 'small' && size !== 'current' && !isCameraSize(size)) {
    return { error: `size must be "small", "current", or ${SIZE_RANGE}.` }
  }
  const parsed = parsePosition(position, { allowCurrent: true })
  if (parsed.error) return parsed
  const place = parsePlaceOptions({ position, margin, withinRight })
  if (place.error) return place
  if (typeof replace !== 'boolean' || typeof apply !== 'boolean') {
    return { error: 'replace and apply must be true or false.' }
  }
  return {
    request: { name: name.trim(), size, position: parsed.position, ...place.options, replace, apply },
  }
}

// Checks a request to set the small size: `{ size: pixels | "current" }`.
export function parseSmallSize(body) {
  if (!isPlainObject(body)) return { error: 'A small-size request is a JSON object.' }
  const unknown = unknownFields(body, new Set(['size']), 'small-size')
  if (unknown) return { error: unknown }
  if (body.size !== 'current' && !isCameraSize(body.size)) {
    return { error: `size must be "current" or ${SIZE_RANGE}.` }
  }
  return { request: { size: body.size } }
}

const sceneById = (settings, id) => settings.presets.find((scene) => scene.id === id)
const sameName = (left, right) => left.toLocaleLowerCase() === right.toLocaleLowerCase()

// What a checked cue does with the current Preferences: `fullscreen`, `compact` (back to the
// previous Compact place at the small size), `place` (Compact at a size and a spot, a point, or the
// current centre), or `scene`. "small" always means the small size (`prompterSmallSize`), so a
// larger Scene or size never changes what "small" restores. Settings choose what "Face full" and
// a bare "Face small" do; a choice naming a deleted Scene falls back to the default.
export function cueAction(cue, settings) {
  if (cue.scene) {
    const scene = settings.presets.find((candidate) => sameName(candidate.name.trim(), cue.scene))
    return scene
      ? { action: 'scene', sceneId: scene.id }
      : { error: `CamFrame has no Scene named "${cue.scene}".`, code: 'unknown-scene', status: 404 }
  }
  const size = cue.size === 'small' ? settings.prompterSmallSize : cue.size
  if (cue.size !== 'full' && (cue.position || cue.size !== 'small')) {
    const place = { action: 'place', size }
    if (typeof cue.position === 'string') place.spot = cue.position
    else if (cue.position) place.point = { ...cue.position }
    if (cue.margin !== undefined) place.margin = cue.margin
    if (cue.withinRight !== undefined) place.withinRight = cue.withinRight
    return place
  }
  const choice = cue.size === 'full' ? settings.prompterFaceFull : settings.prompterFaceSmall
  if (choice.startsWith('scene:') && sceneById(settings, choice.slice(6))) {
    return { action: 'scene', sceneId: choice.slice(6) }
  }
  if (cue.size === 'full') return { action: 'fullscreen' }
  if (COMPACT_SPOTS.includes(choice)) return { action: 'place', size, spot: choice }
  return { action: 'compact', size }
}

// Everything a Scene stores except its size and place: camera, shape, appearance and framing.
// The camera's device id stays in CamFrame; `signature` changes whenever any of these, the camera
// included, changes, so the prompter can check that a layout left the look alone.
export function lookOf(settings) {
  const look = Object.fromEntries(
    LOOK_SETTING_KEYS.map((key) => {
      const value = settings[key]
      return [key, value && typeof value === 'object' ? { ...value } : value]
    }),
  )
  const signature = createHash('sha256').update(JSON.stringify(look)).digest('hex').slice(0, 16)
  delete look.cameraId
  return { ...look, signature }
}

// `size` and `position` are what the Scene asks for (`size` resolved from the small size when it
// follows it; `position` a place name, or else the camera's top-left point, the form a cue's point
// takes); `savedSize` and `savedPosition` (the window's top-left) are what it worked out on the
// display it was saved on.
export function sceneDetail(scene, { smallSize } = {}) {
  const { layout } = scene
  const followsSmall = layout?.size === 'small'
  const size = followsSmall ? (smallSize ?? scene.settings.size) : (layout?.size ?? scene.settings.size)
  const saved = scene.settings.position
  const cameraPoint = saved ? { x: saved.x + OVERLAY_CHROME.left, y: saved.y + OVERLAY_CHROME.top } : saved
  return {
    id: scene.id,
    name: scene.name,
    kind: layout ? 'layout' : 'snapshot',
    size,
    ...(layout ? { followsSmallSize: followsSmall } : {}),
    position: layout?.position ?? cameraPoint,
    ...(layout?.margin !== undefined ? { margin: layout.margin } : {}),
    ...(layout?.withinRight !== undefined ? { withinRight: layout.withinRight } : {}),
    savedSize: scene.settings.size,
    savedPosition: scene.settings.position,
    // A layout Scene keeps the live look; any other Scene applies the look it saved.
    keepsLiveLook: Boolean(layout),
    ...(layout ? {} : { look: lookOf(scene.settings) }),
  }
}

// The status body. `scenes` (names) is the original field; the rest came with API 2. `view` is
// what the Overlay shows, or null before its window exists.
export function linkStatusBody(settings, version, { activeSceneId = '', view = null } = {}) {
  const active = settings.presets.find((scene) => scene.id === activeSceneId)
  return {
    app: 'camframe',
    version: String(version),
    scenes: settings.presets.map((scene) => scene.name),
    api: PROMPTER_LINK_API,
    sceneLimit: SCENE_LIMIT,
    smallSize: settings.prompterSmallSize,
    margin: settings.prompterMargin,
    activeScene: active?.name ?? null,
    view,
    look: lookOf(settings),
    sceneDetails: settings.presets.map((scene) => sceneDetail(scene, { smallSize: settings.prompterSmallSize })),
  }
}

function readBody(request) {
  return new Promise((resolve, reject) => {
    let size = 0
    const chunks = []
    request.on('data', (chunk) => {
      size += chunk.length
      if (size > MAX_BODY_BYTES) {
        request.removeAllListeners('data')
        request.removeAllListeners('end')
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

// Runs the endpoint. `status()` returns the status body. `applyCue(cue)`, `saveScene(request)` and
// `setSmallSize(request)` act on a checked request and return `{ ok: true, …details }` or
// `{ error, status, code? }`; a route without its function answers 404. `onState(state)` hears
// `{ state: 'off' | 'starting' | 'on' | 'error', port, message }` for Inline settings.
export function createPrompterLink({
  createServer = createHttpServer,
  host = PROMPTER_LINK_HOST,
  port = PROMPTER_LINK_PORT,
  status,
  applyCue,
  saveScene,
  setSmallSize,
  onState = () => {},
}) {
  const routes = new Map([
    ['/camframe/cue', { parse: parseCue, run: applyCue, field: 'cue', tooLarge: 'Cue too large.' }],
    // Saving changes stored settings, so pages that send `Origin: null` (file:// copies, but also
    // sandboxed iframes on any site) may only switch the view.
    ['/camframe/scenes', { parse: parseSceneSave, run: saveScene, field: 'request', stores: true }],
    ['/camframe/small-size', { parse: parseSmallSize, run: setSmallSize, field: 'request', stores: true }],
  ].filter(([, route]) => typeof route.run === 'function'))
  let server
  // The server whose listen() has not called back yet.
  let pending
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
      // `Origin: null` is also a sandboxed iframe on any site: Scene names only, as before API 2.
      const body = status()
      send(
        response,
        200,
        origin === 'null' ? { app: body.app, version: body.version, scenes: body.scenes, api: body.api } : body,
        cors,
      )
      return
    }
    const route = routes.get(path)
    if (!route) {
      send(response, 404, { ok: false, error: 'Not found.' }, cors)
      return
    }
    if (request.method !== 'POST') {
      send(response, 405, { ok: false, error: 'Use POST.' }, { ...cors, Allow: 'POST' })
      return
    }
    if (route.stores && origin === 'null') {
      send(
        response,
        403,
        { ok: false, error: 'This page (a file:// copy or a sandboxed frame) may switch the view but not save. Use the prompter site, its preview, or localhost.' },
        cors,
      )
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
        send(response, 413, { ok: false, error: route.tooLarge ?? 'Request too large.' }, { ...cors, Connection: 'close' })
      } else send(response, 400, { ok: false, error: 'Not valid JSON.' }, cors)
      return
    }
    const parsed = route.parse(body)
    if (parsed.error) {
      send(response, 400, { ok: false, error: parsed.error, code: 'bad-request' }, cors)
      return
    }
    const checked = parsed[route.field]
    const result = route.run(checked) ?? { ok: true }
    if (result.error) {
      const { code } = result
      // A does-not-fit refusal to a null origin gets fixed text, without the share or margin.
      const error =
        origin === 'null' && code === 'does-not-fit' ? 'That size and place do not fit this display.' : result.error
      send(response, result.status ?? 400, { ok: false, error, ...(code ? { code } : {}) }, cors)
      return
    }
    const { ok: _ok, status: _status, ...details } = result
    // As in the status: a null origin does not learn the display layout from a reply (`layout`
    // gives it away too, through how far a size had to shrink).
    if (origin === 'null') {
      delete details.view
      delete details.layout
    }
    send(response, 200, { ok: true, ...(route.field === 'cue' ? { cue: checked } : {}), ...details }, cors)
  }

  function start() {
    if (server) return
    setState({ state: 'starting' })
    // Turned off and on again before its port opened: that server carries on.
    if (pending) {
      server = pending
      return
    }
    const next = createServer((request, response) => {
      handle(request, response).catch(() => {
        if (!response.headersSent) send(response, 500, { ok: false, error: 'CamFrame could not apply the request.' })
        else response.destroy()
      })
    })
    next.requestTimeout = 5000
    next.headersTimeout = 5000
    next.keepAliveTimeout = 2000
    server = next
    pending = next
    next.on('error', (error) => {
      if (pending === next) pending = undefined
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
      if (pending === next) pending = undefined
      // Turned off before the port opened: close it now instead of leaving an unseen listener.
      if (server !== next) {
        next.close()
        return
      }
      setState({ state: 'on', port: next.address().port })
    })
  }

  function stop() {
    const current = server
    server = undefined
    // A port that is not open yet (listen resolves the host on a later tick) is closed by its
    // listen callback: close() now would not stop every Node version from opening it, and an
    // "on" before then reuses it instead of racing it for the port.
    if (current && current !== pending) {
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
