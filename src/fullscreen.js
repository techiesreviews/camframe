export function fullscreenButtonCopy(fullscreen) {
  return fullscreen ? 'Exit full screen' : 'Enter full screen'
}

export const FULLSCREEN_TOOLBAR_HIDE_DELAY_MS = 200

export function pointIsInToolbarHotspot(point, rect, padding = 12) {
  if (![point?.x, point?.y, rect?.left, rect?.top, rect?.right, rect?.bottom].every(Number.isFinite)) {
    return false
  }
  return (
    point.x >= rect.left - padding &&
    point.x <= rect.right + padding &&
    point.y >= rect.top - padding &&
    point.y <= rect.bottom + padding
  )
}

export function isFullscreenExitInput(input = {}) {
  return input.type === 'keyDown' && input.key === 'Escape'
}

export function alwaysOnTopLevelFor(platform) {
  return platform === 'win32' ? 'screen-saver' : 'floating'
}

export function fullscreenWindowPlan({
  fullscreen,
  normalBounds,
  displayBounds,
  alwaysOnTop,
  visible,
}) {
  return {
    bounds: { ...(fullscreen ? displayBounds : normalBounds) },
    alwaysOnTop: Boolean(fullscreen || alwaysOnTop),
    visible: Boolean(fullscreen || visible),
  }
}

export function easeFullscreenTransition(progress) {
  const value = Math.min(1, Math.max(0, Number(progress) || 0))
  return value < 0.5 ? 4 * value ** 3 : 1 - (-2 * value + 2) ** 3 / 2
}

export function interpolateWindowBounds(from, to, progress) {
  const eased = easeFullscreenTransition(progress)
  return Object.fromEntries(
    ['x', 'y', 'width', 'height'].map((key) => [
      key,
      Math.round(from[key] + (to[key] - from[key]) * eased),
    ]),
  )
}
