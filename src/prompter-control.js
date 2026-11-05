import { overlayDimensionsFor, sanitizeSettings } from './settings.js'
import * as sceneLibrary from './scenes.js'
import { cameraRectFor, planCompactLayout } from './overlay-geometry.js'
import { cueAction, linkStatusBody, sceneDetail } from './prompter-link.js'

// What the Prompter link's checked requests do to the Overlay. Main supplies the live pieces:
// `geometry()` returns the Overlay geometry (or undefined before its window exists),
// `sceneState()` returns `{ settings, activeSceneId }`, and `commit(result)` stores a Scene
// library style result (`settings`, `activeSceneId`, optional `notice`), broadcasts and saves it.
// This module moves the window after each commit, so the geometry reads the new settings.
export function createPrompterControl({ geometry, sceneState, commit, version }) {
  const notReady = { error: 'CamFrame is not ready yet.', code: 'not-ready', status: 503 }

  // Compact bounds to keep the centre of: where the window is heading, or the place Full screen
  // returns to (a position a Scene stored while in Full screen, else where the Overlay was before Full screen).
  function compactReference(overlay) {
    return overlay.isFullscreen() ? overlay.fullscreenReturnBounds() : overlay.targetBounds()
  }

  const sceneContext = (overlay) => ({
    workArea: overlay.currentWorkArea(),
    workAreaAt: (point) => overlay.workAreaAt(point),
  })

  function view() {
    const overlay = geometry()
    const target = overlay?.targetBounds()
    if (!overlay || !target) return null
    const { settings } = sceneState()
    const fullscreen = overlay.isFullscreen()
    return {
      mode: fullscreen ? 'fullscreen' : 'compact',
      visible: settings.overlayVisible,
      settled: overlay.isSettled(),
      size: settings.size,
      shape: settings.shape,
      camera: fullscreen ? { ...target } : cameraRectFor(target),
      window: { ...target },
      // The display the window is heading to, so it matches `camera` and `window` at once.
      workArea: overlay.workAreaFor(target),
    }
  }

  function status() {
    const { settings, activeSceneId } = sceneState()
    return linkStatusBody(settings, version(), { activeSceneId, view: view() })
  }

  // A point plans on the display it is on; a place on the display the Overlay is on or heading to;
  // neither (a bare size, or "current") on the display of the place the camera keeps, which from Full
  // screen can be another display than the Full screen one.
  function areaFor(overlay, { point, spot, current }) {
    if (point) return overlay.workAreaAt(point)
    if (spot || !current) return overlay.currentWorkArea()
    return overlay.workAreaFor(current)
  }

  // `keepActive`: when the plan lands exactly where the Overlay is or returns to (same size and
  // place), nothing is committed, so the Active Scene stays (a bare "small" back from Full screen).
  function place(overlay, plan, { keepActive = false } = {}) {
    const { settings } = sceneState()
    const current = compactReference(overlay)
    const workArea = areaFor(overlay, { point: plan.point, spot: plan.spot, current })
    const layout = planCompactLayout(
      {
        shape: settings.shape,
        size: plan.size,
        spot: plan.spot,
        point: plan.point,
        margin: plan.margin ?? (plan.spot ? settings.prompterMargin : 0),
        withinRight: plan.withinRight,
      },
      { workArea, current },
    )
    if (layout.error) return { ...layout, status: 422 }
    const unchanged =
      layout.size === settings.size && layout.position.x === current?.x && layout.position.y === current?.y
    const keepBase = keepActive && unchanged
    if (!keepBase) {
      commit(sceneLibrary.patchSettings(sceneState(), { size: layout.size, position: layout.position }))
    }
    overlay.showCompact({ keepBase })
    return { size: layout.size, requestedSize: layout.requestedSize, clamped: layout.clamped }
  }

  function applyScene(overlay, id) {
    const result = sceneLibrary.applyScene(sceneState(), id, sceneContext(overlay))
    if (!result) return { error: 'That Scene is gone.', code: 'unknown-scene', status: 404 }
    commit(result)
    overlay.showCompact()
    const { size, requestedSize = size, clamped } = result.layout ?? { size: result.settings.size, clamped: false }
    return { size, requestedSize, clamped }
  }

  // Back to the previous Compact place at the small size, keeping its centre: from Full screen the
  // place it returns to, in Compact mode where it is. Both plan the size like any other cue, so the
  // whole window stays inside the work area and `clamped` says when the size had to shrink. Back at
  // the same size and place, the Active Scene stays, as it does in Compact mode at the same size.
  function restoreCompact(overlay, size) {
    const { settings } = sceneState()
    if (!overlay.isFullscreen() && settings.size === size) return { size, requestedSize: size, clamped: false }
    return place(overlay, { size }, { keepActive: true })
  }

  function applyCue(cue) {
    const overlay = geometry()
    if (!overlay) return notReady
    const plan = cueAction(cue, sceneState().settings)
    if (plan.error) return plan
    let layout
    if (plan.action === 'fullscreen') overlay.setFullscreen(true)
    else if (plan.action === 'compact') layout = restoreCompact(overlay, plan.size)
    else if (plan.action === 'scene') layout = applyScene(overlay, plan.sceneId)
    else layout = place(overlay, plan)
    if (layout?.error) return layout
    return { ok: true, ...(layout ? { layout } : {}), view: view() }
  }

  function saveScene(request) {
    const overlay = geometry()
    if (!overlay) return notReady
    const { settings } = sceneState()
    const point = typeof request.position === 'object' ? request.position : undefined
    const spot = typeof request.position === 'string' && request.position !== 'current' ? request.position : undefined
    const current = compactReference(overlay)
    const workArea = areaFor(overlay, { point, spot, current })
    const size =
      request.size === 'small'
        ? settings.prompterSmallSize
        : request.size === 'current'
          ? settings.size
          : request.size
    const margin = request.margin ?? (spot ? settings.prompterMargin : 0)
    const planned = planCompactLayout(
      { shape: settings.shape, size, spot, point, margin, withinRight: request.withinRight },
      { workArea, current },
    )
    if (planned.error) return { ...planned, status: 422 }
    const layout = { size: request.size === 'small' ? 'small' : size }
    if (spot) layout.position = spot
    if (request.margin !== undefined) layout.margin = request.margin
    if (request.withinRight !== undefined) layout.withinRight = request.withinRight
    const saved = sceneLibrary.saveLayoutScene(sceneState(), {
      name: request.name,
      size: planned.size,
      position: planned.position,
      layout,
      replace: request.replace,
    })
    if (saved.error) return saved
    commit(saved)
    const answer = {
      ok: true,
      scene: sceneDetail(saved.scene, { smallSize: saved.settings.prompterSmallSize }),
      replaced: saved.replaced,
      saved: {
        size: planned.size,
        requestedSize: size,
        clamped: planned.clamped,
        camera: cameraRectFor({ ...planned.position, ...overlayDimensionsFor(saved.scene.settings) }),
        workArea,
      },
    }
    if (!request.apply) return answer
    const applied = applyScene(overlay, saved.scene.id)
    if (applied.error) return applied
    return { ...answer, layout: applied, view: view() }
  }

  function setSmallSize(request) {
    const { settings, activeSceneId } = sceneState()
    const size = request.size === 'current' ? settings.size : request.size
    commit({ settings: sanitizeSettings({ ...settings, prompterSmallSize: size }), activeSceneId })
    return { ok: true, smallSize: sceneState().settings.prompterSmallSize }
  }

  return { status, view, applyCue, saveScene, setSmallSize }
}
