import { ONBOARDING_TOP_RESERVE } from './onboarding.js'
import { dimensionsFor, overlayDimensionsFor } from './settings.js'

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
  const size = Math.round(clamp(settings.size + sizeChange, 180, 640))
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
    stopAnimation()
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
    compactBase ??= baseFromWindow(window.getBounds())
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

  function exitFullscreen() {
    const current = settings()
    const base = compactBase
      ? { ...compactBase, ...overlayDimensionsFor(current) }
      : compactBaseBounds({
          settings: current,
          current: baseFromWindow(window.getBounds()),
          workArea: screen.getPrimaryDisplay().workArea,
          keepCenter: false,
        })
    const stayOnTop = current.alwaysOnTop
    const visible = current.overlayVisible
    fullscreen = false
    applyZOrder({ stayOnTop: true })
    window.show()
    onFullscreenChanged(false)
    animateTo(windowFromBase(base), () => {
      if (fullscreen || !alive()) return
      applyZOrder({ stayOnTop })
      if (visible) {
        window.showInactive()
        applyZOrder({ raise: true })
      } else window.hide()
      compactBase = undefined
    })
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

    // Moves a Compact Overlay to the current settings' Scene geometry, animated when visible.
    showScene() {
      if (!alive()) return
      if (fullscreen || !settings().overlayVisible) {
        apply({ keepCenter: false })
        return
      }
      const target = compactWindowBounds({ keepCenter: false })
      applyZOrder()
      window.showInactive()
      animateTo(target)
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
      const start = {
        cursor: screen.getCursorScreenPoint(),
        bounds: baseFromWindow(window.getBounds()),
        settings: { ...settings() },
      }
      resize = {
        timer: timers.setInterval(() => {
          if (!alive()) {
            stopResize()
            return
          }
          const cursor = screen.getCursorScreenPoint()
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
    },
  }
}
