export const COMPACT_CHROME_HIDE_DELAY_MS = 220
export const FULLSCREEN_TOOLBAR_HIDE_DELAY_MS = 200
const TOOLBAR_HOTSPOT_PADDING = 12

const systemTimers = {
  setTimeout: (callback, ms) => setTimeout(callback, ms),
  clearTimeout: (timer) => clearTimeout(timer),
}

function pointIsInToolbarHotspot(point, rect) {
  if (![point?.x, point?.y, rect?.left, rect?.top, rect?.right, rect?.bottom].every(Number.isFinite)) {
    return false
  }
  return (
    point.x >= rect.left - TOOLBAR_HOTSPOT_PADDING &&
    point.x <= rect.right + TOOLBAR_HOTSPOT_PADDING &&
    point.y >= rect.top - TOOLBAR_HOTSPOT_PADDING &&
    point.y <= rect.bottom + TOOLBAR_HOTSPOT_PADDING
  )
}

// Decides whether the Overlay chrome is shown ("hovered") and whether the window accepts the mouse
// ("interactive"). Activities go in through `set()`; pointer movement through the pointer events.
// The window is interactive while the chrome shows or any activity holds it open, and hides the
// chrome after a short delay once nothing does. Full screen uses the toolbar hotspot instead of the
// camera surface and its own delay.
export function createOverlayInteraction({
  timers = systemTimers,
  onHoveredChange = () => {},
  onInteractiveChange = () => {},
} = {}) {
  const activity = {
    fullscreen: false,
    controlsOpen: false,
    onboardingOpen: false,
    dragging: false,
    positioning: false,
    resizing: false,
    repositioning: false,
  }
  let hovered = false
  let interactive = false
  let hideTimer

  const holdsChromeOpen = () =>
    activity.controlsOpen || activity.onboardingOpen || activity.positioning || activity.resizing

  function sync() {
    const next =
      hovered ||
      holdsChromeOpen() ||
      activity.dragging ||
      activity.repositioning
    if (next === interactive) return
    interactive = next
    onInteractiveChange(interactive)
  }

  function cancelHide() {
    if (hideTimer !== undefined) timers.clearTimeout(hideTimer)
    hideTimer = undefined
  }

  function setHovered(nextHovered) {
    cancelHide()
    if (hovered !== nextHovered) {
      hovered = nextHovered
      onHoveredChange(hovered)
    }
    sync()
  }

  function hideAfter(delay) {
    hideTimer = timers.setTimeout(() => {
      hideTimer = undefined
      setHovered(false)
    }, delay)
  }

  // Full screen keeps a pending hide instead of restarting it on every pointer move.
  function scheduleFullscreenHide() {
    if (!activity.fullscreen || holdsChromeOpen() || hideTimer !== undefined) return
    hideAfter(FULLSCREEN_TOOLBAR_HIDE_DELAY_MS)
  }

  function scheduleHide() {
    if (activity.fullscreen) {
      scheduleFullscreenHide()
      return
    }
    if (holdsChromeOpen()) return
    cancelHide()
    hideAfter(COMPACT_CHROME_HIDE_DELAY_MS)
  }

  return {
    get hovered() {
      return hovered
    },
    get interactive() {
      return interactive
    },
    get fullscreen() {
      return activity.fullscreen
    },
    get controlsOpen() {
      return activity.controlsOpen
    },
    get onboardingOpen() {
      return activity.onboardingOpen
    },
    get dragging() {
      return activity.dragging
    },
    get positioning() {
      return activity.positioning
    },
    get resizing() {
      return activity.resizing
    },

    set(changes) {
      for (const [name, value] of Object.entries(changes)) {
        if (!Object.hasOwn(activity, name)) throw new Error(`Unknown Overlay activity: ${name}`)
        activity[name] = Boolean(value)
      }
      sync()
    },

    showChrome: () => setHovered(true),
    hideChrome: () => setHovered(false),
    scheduleHide,

    // `overSurface`: the pointer is over the camera, toolbar, Inline settings, or a coach mark.
    pointerMoved({ point, toolbarRect, overSurface }) {
      if (activity.fullscreen) {
        if (activity.controlsOpen || pointIsInToolbarHotspot(point, toolbarRect)) setHovered(true)
        else scheduleFullscreenHide()
        return
      }
      if (overSurface) setHovered(true)
      else if (!activity.dragging) scheduleHide()
    },

    pointerLeft() {
      if (activity.fullscreen || holdsChromeOpen()) scheduleHide()
      else setHovered(false)
    },
  }
}
