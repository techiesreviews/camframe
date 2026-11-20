import { OVERLAY_CHROME, overlayDimensionsFor } from './settings.js'
import { isOnScreen, keepOnWorkArea, planCompactLayout } from './overlay-geometry.js'

// A Layout request is a size ("small", "current" or pixels), a spot or a point, a margin and
// withinRight, before it is planned on a display. This module turns a request plus the displays into
// the size and place the camera really gets, records what a layout Scene asked for, and answers where
// and how big a saved Scene really opens: applying a Scene and drawing its Scenes tab tile use the
// same answer. Saved places stay absolute screen points (ADR 0038); layouts stay exact (ADR 0035).

// The request in pixels: "small" is the small size and "current" the live size. A spot gets the
// Prompter margin unless the request gives one; a point or no place gets none.
export function resolveLayoutRequest({ size, spot, point, margin, withinRight }, settings) {
  return {
    size: size === 'small' ? settings.prompterSmallSize : size === 'current' ? settings.size : size,
    spot,
    point,
    margin: margin ?? (spot ? settings.prompterMargin : 0),
    withinRight,
  }
}

// Plans a request with the live shape on `workArea` (keeping the centre of `current` when the
// request has no place): `{ size, position, requestedSize, clamped }`, or `{ error, code }`.
export function planLayoutRequest(request, settings, { workArea, current } = {}) {
  return planCompactLayout({ shape: settings.shape, ...resolveLayoutRequest(request, settings) }, { workArea, current })
}

// The `layout` a layout Scene stores for a request: "small" stays "small", so the Scene follows the
// small size; a point is not stored (the Scene's saved place is its point).
export function layoutToSave({ size, spot, margin, withinRight }, settings) {
  const layout = { size: size === 'small' ? 'small' : resolveLayoutRequest({ size }, settings).size }
  if (spot) layout.position = spot
  if (margin !== undefined) layout.margin = margin
  if (withinRight !== undefined) layout.withinRight = withinRight
  return layout
}

// The displays a Scene is fitted to, from the Overlay geometry: the work area the Overlay is on or
// heading to (`workArea`), the work area nearest a point (`workAreaAt`), and every connected work
// area (`workAreas`). Empty before the geometry exists.
export function sceneDisplays(geometry) {
  if (!geometry) return {}
  return {
    workArea: geometry.currentWorkArea(),
    workAreaAt: (point) => geometry.workAreaAt(point),
    workAreas: geometry.workAreas?.(),
  }
}

const cameraPoint = (position) => ({ x: position.x + OVERLAY_CHROME.left, y: position.y + OVERLAY_CHROME.top })

// A layout Scene, planned with the live shape; else its saved size and place (no work area known, or
// the display is too small even for the smallest camera), the place kept inside the work area when
// one is known. A layout with a place is planned on `workArea`; one without a place keeps its saved
// camera point on the display nearest that point (`workAreaAt`), shrunk and kept on screen there.
function layoutSceneOpening(scene, settings, { workArea, workAreaAt }) {
  const { layout } = scene
  const saved = { size: scene.settings.size, position: scene.settings.position }
  const point = !layout.position && saved.position ? cameraPoint(saved.position) : undefined
  const area = point && workAreaAt ? workAreaAt(point) : workArea
  const request = { size: layout.size, spot: layout.position, point, margin: layout.margin, withinRight: layout.withinRight }
  const plan = area && (layout.position || point) ? planLayoutRequest(request, settings, { workArea: area }) : undefined
  if (plan && !plan.error) return { size: plan.size, position: plan.position, requestedSize: plan.requestedSize, clamped: plan.clamped }
  const requestedSize = resolveLayoutRequest(request, settings).size
  const window = overlayDimensionsFor({ shape: settings.shape, size: saved.size })
  const position = area && saved.position ? keepOnWorkArea(saved.position, window, area) : saved.position
  // `clamped` is also true when the Scene's rule could not be met (no room even for the smallest
  // camera in its place), so a cue answer never reports a clean fit for the fallback.
  return { ...saved, position, requestedSize, clamped: Boolean(plan?.error) || saved.size !== requestedSize }
}

// A snapshot Scene opens at its saved size and place, or, when that place is not on screen on the
// connected displays (`workAreas`, the `isOnScreen` rule), with the place kept wholly on the display
// nearest its camera (`workAreaAt`), so a Scene saved on a display that is gone, or at a higher
// resolution, opens on screen (TOOLS-156). The Scene keeps its saved place; only where it opens moves.
function snapshotSceneOpening(sceneSettings, { workAreas, workAreaAt }) {
  const { size, position: saved } = sceneSettings
  const opens = { size, position: saved, requestedSize: size, clamped: false }
  if (!saved || !workAreas || !workAreaAt) return opens
  const window = overlayDimensionsFor(sceneSettings)
  if (isOnScreen({ ...saved, ...window }, workAreas)) return opens
  const area = workAreaAt(cameraPoint(saved))
  return area ? { ...opens, position: keepOnWorkArea(saved, window, area) } : opens
}

// Where and how big a saved Scene really opens now, with the live `settings` (a layout Scene keeps
// the live shape): `{ size, position, requestedSize, clamped }`. `position` is the Compact window's
// top-left, or null for a Scene without a place. `context` is `sceneDisplays()`.
export function sceneOpening(scene, settings, context = {}) {
  return scene.layout ? layoutSceneOpening(scene, settings, context) : snapshotSceneOpening(scene.settings, context)
}
