import { ONBOARDING_TOP_RESERVE } from './onboarding.js'
import {
  CAMERA_SIZE_MAX,
  CAMERA_SIZE_MIN,
  COMPACT_SPOTS,
  OVERLAY_CHROME,
  dimensionsFor,
  overlayDimensionsFor,
} from './settings.js'

export const OVERLAY_BOUNDS_TRANSITION_MS = 280
const POINTER_POLL_MS = 16
const COMPACT_SCREEN_MARGIN = 36
const RESIZE_HANDLES = new Set(['top-left', 'top-right', 'bottom-left', 'bottom-right'])

const clamp = (value, min, max) => Math.min(max, Math.max(min, value))

const systemTimers = {
  now: () => Date.now(),
  setInterval: (callback, ms) => setInterval(callback, ms),
  clearInterval: (timer) => clearInterval(timer),
}

export function alwaysOnTopLevelFor(platform) {
  return platform === 'win32' ? 'screen-saver' : 'floating'
}

export function isFullscreenExitInput(input = {}) {
  return input.type === 'keyDown' && input.key === 'Escape'
}

function easeInOutCubic(progress) {
  const value = Math.min(1, Math.max(0, Number(progress) || 0))
  return value < 0.5 ? 4 * value ** 3 : 1 - (-2 * value + 2) ** 3 / 2
}

function interpolateBounds(from, to, progress) {
  const eased = easeInOutCubic(progress)
  return Object.fromEntries(
    ['x', 'y', 'width', 'height'].map((key) => [
      key,
      Math.round(from[key] + (to[key] - from[key]) * eased),
    ]),
  )
}

function resizeFromCorner(settings, windowBounds, handle, delta) {
  const startCamera = dimensionsFor(settings)
  const scaleX = startCamera.width / settings.size
  const scaleY = startCamera.height / settings.size
  const horizontalDirection = handle.includes('left') ? -1 : 1
  const verticalDirection = handle.includes('top') ? -1 : 1
  const horizontalChange = (horizontalDirection * delta.x) / scaleX
  const verticalChange = (verticalDirection * delta.y) / scaleY
  const sizeChange =
    Math.abs(horizontalChange) >= Math.abs(verticalChange) ? horizontalChange : verticalChange
  const size = Math.round(clamp(settings.size + sizeChange, CAMERA_SIZE_MIN, CAMERA_SIZE_MAX))
  const nextCamera = dimensionsFor({ ...settings, size })

  return {
    size,
    position: {
      x: windowBounds.x + (handle.includes('left') ? startCamera.width - nextCamera.width : 0),
      y: windowBounds.y + (handle.includes('top') ? startCamera.height - nextCamera.height : 0),
    },
  }
}

// Compact-mode bounds without the onboarding reserve ("base" bounds). `current` is the live
// base bounds when the window exists; `workArea` places a first launch near the bottom-right.
export function compactBaseBounds({ settings, current, workArea, keepCenter = true }) {
  const size = overlayDimensionsFor(settings)
  if (!current) {
    const fallback = {
      x: workArea.x + workArea.width - size.width - COMPACT_SCREEN_MARGIN,
      y: workArea.y + workArea.height - size.height - COMPACT_SCREEN_MARGIN,
    }
    return { ...size, ...(settings.position ?? fallback) }
  }
  if (!keepCenter) {
    return { ...size, ...(settings.position ?? { x: current.x, y: current.y }) }
  }
  return {
    x: Math.round(current.x + (current.width - size.width) / 2),
    y: Math.round(current.y + (current.height - size.height) / 2),
    ...size,
  }
}

export const keepInside = (value, start, length, windowLength) =>
  Math.round(Math.max(start, Math.min(value, start + length - windowLength)))

// The Compact window position that puts the camera surface at `spot` in `workArea`, `margin` px
// from the edges it touches. The whole window (with its transparent chrome) stays inside the work
// area so the hover toolbar is always reachable; at the top spots that keeps the camera a little
// lower than the margin. `size` is the Compact window size (`overlayDimensionsFor`).
export function compactPositionAt(spot, { workArea, size, margin }) {
  if (!COMPACT_SPOTS.includes(spot)) return undefined
  const camera = {
    width: size.width - OVERLAY_CHROME.left - OVERLAY_CHROME.right,
    height: size.height - OVERLAY_CHROME.top - OVERLAY_CHROME.bottom,
  }
  const horizontal = spot.endsWith('left') ? 'start' : spot.endsWith('right') ? 'end' : 'middle'
  const vertical = spot.startsWith('top') ? 'start' : spot.startsWith('bottom') ? 'end' : 'middle'
  const along = (alignment, start, length, cameraLength) =>
    alignment === 'start'
      ? start + margin
      : alignment === 'end'
        ? start + length - margin - cameraLength
        : start + (length - cameraLength) / 2
  return {
    x: keepInside(
      along(horizontal, workArea.x, workArea.width, camera.width) - OVERLAY_CHROME.left,
      workArea.x,
      workArea.width,
      size.width,
    ),
    y: keepInside(
      along(vertical, workArea.y, workArea.height, camera.height) - OVERLAY_CHROME.top,
      workArea.y,
      workArea.height,
      size.height,
    ),
  }
}

// Where the camera surface is for Compact window bounds (`base`, without the onboarding reserve).
export function cameraRectFor(base) {
  return {
    x: base.x + OVERLAY_CHROME.left,
    y: base.y + OVERLAY_CHROME.top,
    width: base.width - OVERLAY_CHROME.left - OVERLAY_CHROME.right,
    height: base.height - OVERLAY_CHROME.top - OVERLAY_CHROME.bottom,
  }
}

// Plans an exact Compact layout on `workArea`: the camera `size` (px, CAMERA_SIZE_MIN–MAX) at a
// place (`spot` with `margin`), with its camera surface's top-left at `point`, or keeping the
// centre of `current` (live Compact bounds). The size shrinks, never grows, until the whole window
// fits the work area and, with `withinRight` (a share 0.1–1, right-hand places only), until the
// camera and its margin fit inside that share of the work area's right side. Returns
// `{ size, position, requestedSize, clamped }` (`position` is the window's top-left), or
// `{ error, code: 'does-not-fit' }` when even the smallest camera cannot fit.
export function planCompactLayout({ shape, size, spot, point, margin = 0, withinRight }, { workArea, current }) {
  // The whole window stays on screen, so the camera never sits closer to the right edge than the
  // chrome's width, whatever the margin.
  const rightGap = Math.max(margin, OVERLAY_CHROME.right)
  // Left, right and center centre the camera vertically, which also needs the top chrome's height
  // free below it; a larger camera would be pushed down to keep the toolbar on screen.
  const centred = spot !== undefined && !spot.startsWith('top') && !spot.startsWith('bottom')
  const centredHeight = workArea.height - 2 * OVERLAY_CHROME.top
  const fits = (candidate) => {
    const camera = dimensionsFor({ shape, size: candidate })
    const window = overlayDimensionsFor({ shape, size: candidate })
    if (window.width > workArea.width || window.height > workArea.height) return false
    if (centred && camera.height > centredHeight) return false
    if (withinRight !== undefined && camera.width + rightGap > withinRight * workArea.width) return false
    return true
  }
  let fitted = Math.min(size, CAMERA_SIZE_MAX)
  // dimensionsFor rounds, so step down one pixel at a time from the largest size the shares allow.
  const factor = dimensionsFor({ shape, size: 1000 })
  const limits = [
    (workArea.width - OVERLAY_CHROME.left - OVERLAY_CHROME.right) / (factor.width / 1000),
    (workArea.height - OVERLAY_CHROME.top - OVERLAY_CHROME.bottom) / (factor.height / 1000),
  ]
  if (withinRight !== undefined) limits.push((withinRight * workArea.width - rightGap) / (factor.width / 1000))
  if (centred) limits.push(centredHeight / (factor.height / 1000))
  fitted = Math.min(fitted, Math.floor(Math.min(...limits)))
  while (fitted >= CAMERA_SIZE_MIN && !fits(fitted)) fitted -= 1
  if (fitted < CAMERA_SIZE_MIN) {
    return {
      error:
        withinRight === undefined
          ? `This display is too small for the smallest camera (${CAMERA_SIZE_MIN} px).`
          : `The right ${Math.round(withinRight * 100)}% of this display is too narrow for the smallest camera (${CAMERA_SIZE_MIN} px) and the ${rightGap} px gap at the right edge.`,
      code: 'does-not-fit',
    }
  }
  const windowSize = overlayDimensionsFor({ shape, size: fitted })
  let position
  if (spot) position = compactPositionAt(spot, { workArea, size: windowSize, margin })
  else {
    const wanted = point
      ? { x: point.x - OVERLAY_CHROME.left, y: point.y - OVERLAY_CHROME.top }
      : compactBaseBounds({ settings: { shape, size: fitted }, current, workArea, keepCenter: true })
    position = {
      x: keepInside(wanted.x, workArea.x, workArea.width, windowSize.width),
      y: keepInside(wanted.y, workArea.y, workArea.height, windowSize.height),
    }
  }
  return { size: fitted, position, requestedSize: size, clamped: fitted !== size }
}

// Owns the native Overlay window's geometry: Compact placement, Full screen, the onboarding
// reserve above the toolbar, pointer drag/resize polling, bounds animation, z-order, and mouse
// pass-through. Callers express intents; the mode rules and base/window conversions stay here.
//
// `window` and `screen` are Electron's BrowserWindow and screen (or test fakes). `settings()`
// returns current Preferences. Callbacks report changes the caller must persist or broadcast.
export function createOverlayGeometry({
  window,
  screen,
  settings,
  alwaysOnTopLevel = 'floating',
  timers = systemTimers,
  onResize = () => {},
  onCompactPositionChanged = () => {},
  onFullscreenChanged = () => {},
}) {
  let fullscreen = false
  let compactBase
  // True once a Scene applied in Full screen stored a position: that is where leaving Full screen
  // lands. Otherwise it lands where the Overlay was before Full screen (`compactBase`), because the
  // stored position can be older than the window (a hand drag saves it from the native `moved`
  // event, which can arrive late or, on Linux, never).
  let positionFromScene = false
  let reserveOpen = false
  let interactive = false
  let reducedMotion = false
  let animation
  let drag
  let resize

  const alive = () => !window.isDestroyed()

  const baseFromWindow = (bounds) =>
    reserveOpen
      ? {
          ...bounds,
          y: bounds.y + ONBOARDING_TOP_RESERVE,
          height: Math.max(1, bounds.height - ONBOARDING_TOP_RESERVE),
        }
      : { ...bounds }

  const windowFromBase = (bounds) =>
    reserveOpen
      ? {
          ...bounds,
          y: bounds.y - ONBOARDING_TOP_RESERVE,
          height: bounds.height + ONBOARDING_TOP_RESERVE,
        }
      : { ...bounds }

  function compactWindowBounds({ keepCenter }) {
    return windowFromBase(
      compactBaseBounds({
        settings: settings(),
        current: baseFromWindow(window.getBounds()),
        workArea: screen.getPrimaryDisplay().workArea,
        keepCenter,
      }),
    )
  }

  function applyZOrder({ raise = false, stayOnTop = fullscreen || settings().alwaysOnTop } = {}) {
    if (!alive()) return
    window.setAlwaysOnTop(stayOnTop, alwaysOnTopLevel)
    if (raise && stayOnTop) window.moveTop()
  }

  function setInteractive(nextInteractive) {
    const next = Boolean(nextInteractive)
    if (!alive() || interactive === next) return
    interactive = next
    window.setIgnoreMouseEvents(!next, { forward: !next })
  }

  function stopAnimation() {
    if (animation) timers.clearInterval(animation.timer)
    animation = undefined
  }

  function finishAnimation() {
    const finished = animation
    stopAnimation()
    if (!finished || !alive()) return
    window.setBounds(finished.target)
    finished.onComplete?.()
  }

  function animateTo(target, onComplete) {
    if (!alive()) return
    // A new animation replaces the running one, but its finishing step still runs (leaving Full
    // screen clears the saved Compact base and restores the z-order there), or a burst of moves
    // would keep a stale base for the next Full screen. Its z-order and raise apply now, while the
    // window is still on its way.
    const replaced = animation?.onComplete
    stopAnimation()
    replaced?.()
    if (reducedMotion) {
      window.setBounds({ ...target })
      onComplete?.()
      return
    }
    const start = window.getBounds()
    const startedAt = timers.now()
    animation = { target: { ...target }, onComplete }
    const frame = () => {
      if (!alive()) {
        stopAnimation()
        return
      }
      const progress = Math.min(1, (timers.now() - startedAt) / OVERLAY_BOUNDS_TRANSITION_MS)
      window.setBounds(interpolateBounds(start, target, progress))
      if (progress >= 1) finishAnimation()
    }
    animation.timer = timers.setInterval(frame, POINTER_POLL_MS)
    frame()
  }

  function stopDrag() {
    if (drag) timers.clearInterval(drag.timer)
    drag = undefined
  }

  function stopResize() {
    if (resize) timers.clearInterval(resize.timer)
    resize = undefined
  }

  // A Scene or cue moving the window ends a move-drag and a corner drag that has already moved,
  // so the drag cannot undo the move, save its own spot over the cue's, or save its size as the
  // small size. A corner only held keeps waiting and starts from the new size when the pointer moves.
  function endHandResize() {
    stopDrag()
    if (resize?.moved) stopResize()
  }

  function apply({ keepCenter = true, updateBounds = true } = {}) {
    if (!alive()) return
    if (updateBounds && !fullscreen && !animation) {
      window.setBounds(compactWindowBounds({ keepCenter }))
    }
    applyZOrder()
    if (settings().overlayVisible) window.showInactive()
    else {
      stopDrag()
      setInteractive(false)
      window.hide()
    }
  }

  function enterFullscreen() {
    if (!compactBase) {
      // Where the window is heading, so a Full screen cue right after a move cue returns to the move's target.
      compactBase = baseFromWindow(animation ? animation.target : window.getBounds())
      positionFromScene = false
    }
    fullscreen = true
    stopDrag()
    stopResize()
    const display = screen.getDisplayMatching(windowFromBase(compactBase)).bounds
    applyZOrder({ stayOnTop: true })
    window.show()
    setInteractive(true)
    onFullscreenChanged(true)
    window.focus()
    animateTo(display)
  }

  const storedPositionWins = () => positionFromScene && Boolean(settings().position)

  function exitFullscreen() {
    const current = settings()
    const base = compactBase && !storedPositionWins()
      ? { ...compactBase, ...overlayDimensionsFor(current) }
      : compactBaseBounds({
          settings: current,
          current: baseFromWindow(window.getBounds()),
          workArea: screen.getPrimaryDisplay().workArea,
          keepCenter: false,
        })
    fullscreen = false
    applyZOrder({ stayOnTop: true })
    window.show()
    onFullscreenChanged(false)
    animateTo(windowFromBase(base), () => {
      if (fullscreen || !alive()) return
      const { alwaysOnTop: stayOnTop, overlayVisible: visible } = settings()
      applyZOrder({ stayOnTop })
      if (visible) {
        window.showInactive()
        applyZOrder({ raise: true })
      } else window.hide()
      compactBase = undefined
    })
  }

  // Moves a Compact Overlay to the current settings' Scene geometry, animated when visible.
  // `base` places it there instead of at the settings' position (or the live bounds without one).
  function showScene({ base } = {}) {
    if (!alive()) return
    endHandResize()
    // In Full screen a Scene with a place is where leaving Full screen lands (Escape, toggle); the
    // place before Full screen is kept, for a later Scene without a position.
    if (fullscreen) positionFromScene = Boolean(settings().position)
    if (fullscreen || !settings().overlayVisible) {
      apply({ keepCenter: false })
      return
    }
    const target = base
      ? windowFromBase({ ...base, ...overlayDimensionsFor(settings()) })
      : compactWindowBounds({ keepCenter: false })
    applyZOrder()
    window.showInactive()
    animateTo(target)
  }

  applyZOrder()
  window.setIgnoreMouseEvents(true, { forward: true })

  return {
    apply,
    setInteractive,
    raise: () => applyZOrder({ raise: true }),

    isFullscreen: () => fullscreen,
    setFullscreen(nextFullscreen) {
      const next = Boolean(nextFullscreen)
      if (!alive() || next === fullscreen) return
      if (next) enterFullscreen()
      else exitFullscreen()
    },

    // The reserve opens only in settled Compact mode, because the Overlay renderer offsets its
    // layout by the returned height. It always closes, so Full screen exit restores the real
    // compact position.
    setOnboardingReserve(open) {
      if (!alive()) return 0
      if (open) {
        if (fullscreen || animation) return reserveOpen ? ONBOARDING_TOP_RESERVE : 0
        if (reserveOpen) return ONBOARDING_TOP_RESERVE
        const base = window.getBounds()
        reserveOpen = true
        window.setBounds(windowFromBase(base))
        return ONBOARDING_TOP_RESERVE
      }
      if (!reserveOpen) return 0
      finishAnimation()
      if (fullscreen) {
        reserveOpen = false
        return 0
      }
      const base = baseFromWindow(window.getBounds())
      reserveOpen = false
      onCompactPositionChanged({ x: base.x, y: base.y })
      window.setBounds({ ...base, ...overlayDimensionsFor(settings()) })
      return 0
    },

    showScene: () => showScene(),

    // Moves the Overlay to the current settings' Compact geometry, leaving Full screen first when
    // it is on. Unlike `showScene`, a Scene or position applied in Full screen lands in Compact mode.
    // `keepBase`: the caller found the plan equal to the place Full screen returns to and stored
    // nothing, so the stored position (possibly older than the window) must not decide the landing.
    showCompact({ keepBase = false } = {}) {
      if (!alive()) return
      endHandResize()
      // A Scene without a position keeps the place the Overlay had before Full screen, also
      // while the exit animation is still running (the saved base is cleared when it ends).
      if (!fullscreen) {
        showScene({ base: settings().position ? undefined : compactBase })
        return
      }
      if (settings().position && !keepBase) compactBase = undefined
      exitFullscreen()
    },

    // The work area of the display that best holds `bounds` (for example where the window is heading).
    workAreaFor(bounds) {
      const display = screen.getDisplayMatching(bounds)
      return { ...(display.workArea ?? display.bounds) }
    },

    // The work area of the display nearest a screen point (any display, also one the Overlay is not on).
    workAreaAt(point) {
      const display = screen.getDisplayNearestPoint?.(point) ?? screen.getDisplayMatching(window.getBounds())
      return { ...(display.workArea ?? display.bounds) }
    },

    // The work area of the display the Overlay is on now (the Full screen display in Full screen).
    // While the window is moving, that is the display it is heading to, so a cue that arrives
    // mid-move plans on the display the last answer reported.
    currentWorkArea() {
      const display = screen.getDisplayMatching(animation ? animation.target : window.getBounds())
      return { ...(display.workArea ?? display.bounds) }
    },

    // Where the window is heading: the running animation's target, else its live bounds, both
    // without the reserve (in Full screen the window is the whole display, reserve or not).
    // `isSettled()` is false while it is still on its way.
    targetBounds() {
      if (!alive()) return undefined
      const bounds = animation ? animation.target : window.getBounds()
      return fullscreen ? { ...bounds } : baseFromWindow(bounds)
    },
    isSettled: () => !animation,

    // Where leaving Full screen through `showCompact` puts the Compact window at the current size
    // (bounds without the reserve): a position a Scene stored while in Full screen, else the place the Overlay had before Full
    // screen. Undefined outside Full screen.
    fullscreenReturnBounds() {
      if (!alive() || !fullscreen) return undefined
      return compactBaseBounds({
        settings: compactBase && !storedPositionWins() ? { ...settings(), position: null } : settings(),
        current: compactBase,
        workArea: screen.getPrimaryDisplay().workArea,
        keepCenter: false,
      })
    },

    // Live Compact bounds without the reserve, or undefined in Full screen.
    compactBounds() {
      if (!alive() || fullscreen) return undefined
      return baseFromWindow(window.getBounds())
    },

    windowMoved() {
      if (!alive() || fullscreen || animation) return
      const base = baseFromWindow(window.getBounds())
      onCompactPositionChanged({ x: base.x, y: base.y })
    },

    setReducedMotion(nextReducedMotion) {
      const next = Boolean(nextReducedMotion)
      if (next === reducedMotion) return
      reducedMotion = next
      if (reducedMotion) finishAnimation()
    },

    startDrag() {
      if (!alive() || fullscreen) return
      stopDrag()
      setInteractive(true)
      const cursor = screen.getCursorScreenPoint()
      const [windowX, windowY] = window.getPosition()
      const offset = { x: cursor.x - windowX, y: cursor.y - windowY }
      drag = {
        timer: timers.setInterval(() => {
          if (!alive()) {
            stopDrag()
            return
          }
          const next = screen.getCursorScreenPoint()
          window.setPosition(next.x - offset.x, next.y - offset.y)
        }, POINTER_POLL_MS),
      }
    },
    stopDrag,

    startResize(handle) {
      if (!alive() || fullscreen || !RESIZE_HANDLES.has(handle)) return
      stopDrag()
      stopResize()
      setInteractive(true)
      const start = { cursor: screen.getCursorScreenPoint() }
      // Where the drag starts from: the size and place now (or where a move is heading).
      const snapshot = () => {
        start.bounds = baseFromWindow(animation ? animation.target : window.getBounds())
        start.settings = { ...settings() }
      }
      snapshot()
      resize = {
        moved: false,
        timer: timers.setInterval(() => {
          if (!alive()) {
            stopResize()
            return
          }
          const cursor = screen.getCursorScreenPoint()
          // A corner only held still resizes nothing, and the drag starts from the size and place
          // when the pointer first moves, so a size a cue set while the corner was held stays.
          if (!resize.moved) {
            snapshot()
            resize.moved = cursor.x !== start.cursor.x || cursor.y !== start.cursor.y
            if (!resize.moved) return
            // A move still running (a cue) ends at its target now, so it cannot paint over the
            // dragged size later and the size saved by hand is the size on screen.
            if (animation) {
              finishAnimation()
              snapshot()
            }
          }
          onResize(
            resizeFromCorner(start.settings, start.bounds, handle, {
              x: cursor.x - start.cursor.x,
              y: cursor.y - start.cursor.y,
            }),
          )
        }, POINTER_POLL_MS),
      }
    },
    stopResize,

    dispose() {
      stopDrag()
      stopResize()
      stopAnimation()
      fullscreen = false
      reserveOpen = false
      compactBase = undefined
      positionFromScene = false
    },
  }
}
