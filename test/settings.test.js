import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import {
  DEFAULT_SETTINGS,
  cameraPositionAfterDrag,
  cameraZoomAfterWheel,
  dimensionsFor,
  mergePresets,
  overlayDimensionsFor,
  overlayRegionsFor,
  regionsFor,
  resizeOverlayFromCorner,
  reorderPresets,
  sanitizeSettings,
  settingsForPreset,
  settingsWithLivePosition,
  settingsPatchChangesOverlayGeometry,
  startupSettings,
} from '../src/settings.js'
import {
  applyCameraTrackProfile,
  cameraConstraintsFor,
  cameraOptionsFrom,
  cameraTrackConstraintsFor,
  canReuseCameraStream,
  configureCameraTrack,
} from '../src/cameras.js'
import {
  FULLSCREEN_TOOLBAR_HIDE_DELAY_MS,
  alwaysOnTopLevelFor,
  fullscreenButtonCopy,
  fullscreenWindowPlan,
  interpolateWindowBounds,
  isFullscreenExitInput,
  pointIsInToolbarHotspot,
} from '../src/fullscreen.js'

test('places the Windows camera above the taskbar without changing macOS layering', () => {
  assert.equal(alwaysOnTopLevelFor('win32'), 'screen-saver')
  assert.equal(alwaysOnTopLevelFor('darwin'), 'floating')
})

test('sanitizes untrusted settings and keeps safe values', () => {
  const result = sanitizeSettings({
    shape: 'triangle',
    size: 900,
    borderWidth: -4,
    borderColor: 'red',
    mirror: false,
    cameraZoom: 999,
    cameraPosition: { x: -20, y: 138.42 },
    position: { x: 12, y: 34 },
  })

  assert.equal(result.shape, DEFAULT_SETTINGS.shape)
  assert.equal(result.size, 640)
  assert.equal(result.borderWidth, 0)
  assert.equal(result.borderColor, DEFAULT_SETTINGS.borderColor)
  assert.equal(result.mirror, false)
  assert.equal(result.cameraZoom, 250)
  assert.deepEqual(result.cameraPosition, { x: 0, y: 100 })
  assert.deepEqual(result.position, { x: 12, y: 34 })
})

test('sanitizes compact and fullscreen capture resolutions independently', () => {
  const valid = sanitizeSettings({
    overlayResolution: '1080p',
    fullscreenResolution: '720p',
    frameEffect: 'blur',
    effectColor: '#22c55e',
    glowStrength: 64,
    glowSpread: 16,
    blurAmount: 8,
    blurOpacity: 55,
  })
  const invalid = sanitizeSettings({
    overlayResolution: '12k',
    fullscreenResolution: 'automatic',
    frameEffect: 'edge',
    effectColor: 'green',
    glowStrength: 1000,
    glowSpread: -4,
    blurAmount: 100,
    blurOpacity: 0,
  })

  assert.equal(valid.overlayResolution, '1080p')
  assert.equal(valid.fullscreenResolution, '720p')
  assert.equal(valid.frameEffect, 'blur')
  assert.equal(valid.effectColor, '#22c55e')
  assert.equal(valid.glowStrength, 64)
  assert.equal(valid.glowSpread, 16)
  assert.equal(valid.blurAmount, 8)
  assert.equal(valid.blurOpacity, 55)
  assert.equal(invalid.overlayResolution, DEFAULT_SETTINGS.overlayResolution)
  assert.equal(invalid.fullscreenResolution, DEFAULT_SETTINGS.fullscreenResolution)
  assert.equal(invalid.frameEffect, DEFAULT_SETTINGS.frameEffect)
  assert.equal(invalid.effectColor, DEFAULT_SETTINGS.effectColor)
  assert.equal(invalid.glowStrength, 100)
  assert.equal(invalid.glowSpread, 4)
  assert.equal(invalid.blurAmount, 18)
  assert.equal(invalid.blurOpacity, 10)
})

test('capture quality changes do not reapply native overlay bounds', () => {
  assert.equal(settingsPatchChangesOverlayGeometry({ overlayResolution: '2160p' }), false)
  assert.equal(settingsPatchChangesOverlayGeometry({ fullscreenResolution: '1080p' }), false)
  assert.equal(settingsPatchChangesOverlayGeometry({ mirror: false }), false)
  assert.equal(settingsPatchChangesOverlayGeometry({ alwaysOnTop: false }), false)
  assert.equal(settingsPatchChangesOverlayGeometry({ size: 420 }), true)
  assert.equal(settingsPatchChangesOverlayGeometry({ shape: 'landscape' }), true)
  assert.equal(settingsPatchChangesOverlayGeometry({ position: { x: 10, y: 20 } }), true)
})

test('camera positioning follows drag direction and respects mirroring', () => {
  const center = { x: 50, y: 50 }
  const surface = { width: 200, height: 200 }

  assert.deepEqual(cameraPositionAfterDrag(center, { x: 40, y: -20 }, surface), {
    x: 30,
    y: 60,
  })
  assert.deepEqual(cameraPositionAfterDrag(center, { x: 40, y: -20 }, surface, true), {
    x: 70,
    y: 60,
  })
  assert.deepEqual(cameraPositionAfterDrag(center, { x: -500, y: 500 }, surface), {
    x: 100,
    y: 0,
  })
  assert.deepEqual(cameraPositionAfterDrag(center, { x: 20, y: -10 }, surface, false, 150), {
    x: 30,
    y: 60,
  })
})

test('camera zoom is sanitized independently from overlay size', () => {
  assert.equal(sanitizeSettings({ cameraZoom: 80 }).cameraZoom, 100)
  assert.equal(sanitizeSettings({ cameraZoom: 175 }).cameraZoom, 175)
  assert.equal(sanitizeSettings({ cameraZoom: 400 }).cameraZoom, 250)
})

test('camera wheel zoom uses stable steps and respects framing limits', () => {
  assert.equal(cameraZoomAfterWheel(100, -120), 105)
  assert.equal(cameraZoomAfterWheel(245, -120), 250)
  assert.equal(cameraZoomAfterWheel(250, -120), 250)
  assert.equal(cameraZoomAfterWheel(105, 120), 100)
  assert.equal(cameraZoomAfterWheel(100, 120), 100)
  assert.equal(cameraZoomAfterWheel(175, 0), 175)
})

test('corner resizing preserves aspect ratio and anchors the opposite corner', () => {
  const circle = { ...DEFAULT_SETTINGS, shape: 'circle', size: 300 }
  const bounds = { x: 100, y: 200, width: 336, height: 402 }

  assert.deepEqual(resizeOverlayFromCorner(circle, bounds, 'bottom-right', { x: 80, y: 40 }), {
    size: 380,
    position: { x: 100, y: 200 },
  })
  assert.deepEqual(resizeOverlayFromCorner(circle, bounds, 'top-left', { x: -80, y: -40 }), {
    size: 380,
    position: { x: 20, y: 120 },
  })

  const wide = { ...DEFAULT_SETTINGS, shape: 'landscape', size: 320 }
  const resized = resizeOverlayFromCorner(wide, bounds, 'bottom-right', { x: 64, y: 36 })
  assert.deepEqual(resized, { size: 384, position: { x: 100, y: 200 } })
  assert.deepEqual(dimensionsFor({ ...wide, size: resized.size }), { width: 384, height: 216 })
})

test('computes dimensions for every aspect ratio', () => {
  assert.deepEqual(dimensionsFor({ shape: 'circle', size: 320 }), { width: 320, height: 320 })
  assert.deepEqual(dimensionsFor({ shape: 'portrait', size: 320 }), { width: 240, height: 320 })
  assert.deepEqual(dimensionsFor({ shape: 'landscape', size: 320 }), { width: 320, height: 180 })
})

test('every launch starts visible and always on top', () => {
  const result = startupSettings({ overlayVisible: false, alwaysOnTop: false, size: 360 })

  assert.equal(result.overlayVisible, true)
  assert.equal(result.alwaysOnTop, true)
  assert.equal(result.size, 360)
})

test('launch-at-login is persisted but never captured inside a camera preset', () => {
  const settings = sanitizeSettings({ launchAtLogin: true })
  const preset = settingsForPreset(settings)

  assert.equal(settings.launchAtLogin, true)
  assert.equal(Object.hasOwn(preset, 'launchAtLogin'), false)
})

test('window regions stay inside the requested bounds', () => {
  const width = 320
  const height = 180
  const regions = regionsFor('landscape', width, height)

  assert.ok(regions.length > 1)
  for (const region of regions) {
    assert.ok(region.x >= 0)
    assert.ok(region.y >= 0)
    assert.ok(region.width > 0)
    assert.ok(region.height > 0)
    assert.ok(region.x + region.width <= width)
    assert.ok(region.y + region.height <= height)
  }
})

test('overlay reserves room for hover controls without expanding on hover', () => {
  const settings = { ...DEFAULT_SETTINGS, size: 320, shape: 'circle' }
  const bounds = overlayDimensionsFor(settings)
  const normal = overlayRegionsFor(settings, false)
  const hovered = overlayRegionsFor(settings, true)
  const controlsOpen = overlayRegionsFor(settings, true, true)

  assert.deepEqual(bounds, { width: 356, height: 422 })
  assert.deepEqual(dimensionsFor(settings), { width: 320, height: 320 })
  assert.ok(hovered.length > normal.length)
  assert.ok(controlsOpen.length > hovered.length)
  for (const region of controlsOpen) {
    assert.ok(region.x >= 0 && region.y >= 0)
    assert.ok(region.x + region.width <= bounds.width)
    assert.ok(region.y + region.height <= bounds.height)
  }
})

test('camera discovery keeps video inputs even before labels are available', () => {
  assert.deepEqual(
    cameraOptionsFrom([
      { kind: 'audioinput', deviceId: 'mic', label: 'Microphone' },
      { kind: 'videoinput', deviceId: 'cam-link', label: 'Cam Link 4K' },
      { kind: 'videoinput', deviceId: 'camera-2', label: '' },
    ]),
    [
      { deviceId: 'cam-link', label: 'Cam Link 4K' },
      { deviceId: 'camera-2', label: 'Camera 2' },
    ],
  )
})

test('reuses an active capture when default and selected IDs resolve to the same camera', () => {
  assert.equal(canReuseCameraStream('', '', 'cam-link'), true)
  assert.equal(canReuseCameraStream('cam-link', '', 'cam-link'), true)
  assert.equal(canReuseCameraStream('camera-2', '', 'cam-link'), false)
})

test('uses the verified low-latency camera profile', () => {
  assert.deepEqual(cameraConstraintsFor('cam-link'), {
    audio: false,
    video: {
      deviceId: { exact: 'cam-link' },
      width: { ideal: 1280 },
      height: { ideal: 720 },
      frameRate: { ideal: 60, min: 30, max: 60 },
    },
  })

  const track = { contentHint: 'detail' }
  configureCameraTrack(track)
  assert.equal(track.contentHint, 'motion')
})

test('switches between 4K fullscreen and 720p overlay capture profiles', async () => {
  assert.deepEqual(cameraTrackConstraintsFor(true), {
    width: { ideal: 3840 },
    height: { ideal: 2160 },
    frameRate: { ideal: 30, max: 30 },
  })
  assert.deepEqual(cameraTrackConstraintsFor(false), {
    width: { ideal: 1280 },
    height: { ideal: 720 },
    frameRate: { ideal: 60, min: 30, max: 60 },
  })
  assert.deepEqual(cameraConstraintsFor('cam-link', { fullscreen: true }), {
    audio: false,
    video: {
      deviceId: { exact: 'cam-link' },
      width: { ideal: 3840 },
      height: { ideal: 2160 },
      frameRate: { ideal: 30, max: 30 },
    },
  })

  const applied = []
  const track = { applyConstraints: async (constraints) => applied.push(constraints) }
  assert.equal(await applyCameraTrackProfile(track, true), true)
  assert.equal(await applyCameraTrackProfile(track, false), true)
  assert.deepEqual(applied, [cameraTrackConstraintsFor(true), cameraTrackConstraintsFor(false)])

  const unsupportedTrack = {
    applyConstraints: async () => {
      throw new DOMException('Unsupported profile', 'OverconstrainedError')
    },
  }
  assert.equal(await applyCameraTrackProfile(unsupportedTrack, true), false)
})

test('uses the selected capture resolution for each camera mode', async () => {
  assert.deepEqual(cameraTrackConstraintsFor(false, { resolution: '1080p' }), {
    width: { ideal: 1920 },
    height: { ideal: 1080 },
    frameRate: { ideal: 60, min: 30, max: 60 },
  })
  assert.deepEqual(cameraTrackConstraintsFor(true, { resolution: '720p' }), {
    width: { ideal: 1280 },
    height: { ideal: 720 },
    frameRate: { ideal: 30, max: 30 },
  })

  const applied = []
  const track = { applyConstraints: async (constraints) => applied.push(constraints) }
  assert.equal(await applyCameraTrackProfile(track, false, '1080p'), true)
  assert.deepEqual(applied, [cameraTrackConstraintsFor(false, { resolution: '1080p' })])
})

test('toolbar centering does not depend on the animated transform', () => {
  const css = readFileSync(join(import.meta.dirname, '..', 'src', 'overlay.css'), 'utf8')
  const toolbarRule = css.match(/(?:^|\n)\.hover-toolbar\s*\{([^}]+)\}/)?.[1] ?? ''

  assert.match(toolbarRule, /--toolbar-width:\s*min\(196px,/)
  assert.match(toolbarRule, /var\(--active-camera-left\)/)
  assert.match(toolbarRule, /var\(--active-camera-width\)/)
  assert.doesNotMatch(toolbarRule, /translateX/)
})

test('every compact camera shape has an explicit compositor clip mask', () => {
  const css = readFileSync(join(import.meta.dirname, '..', 'src', 'overlay.css'), 'utf8')

  assert.match(
    css,
    /\.overlay\[data-shape='circle'\] \.camera-surface\s*\{[^}]*clip-path:\s*inset\(0 round 50%\)/s,
  )
  assert.match(
    css,
    /\.overlay\[data-shape='rounded'\] \.camera-surface\s*\{[^}]*clip-path:\s*inset\(0 round 16%\)/s,
  )
  assert.match(
    css,
    /\.overlay\[data-shape='portrait'\] \.camera-surface[^}]*clip-path:\s*inset\(0 round 12%\)/s,
  )
  assert.match(
    css,
    /\.overlay\[data-fullscreen='true'\] \.camera-surface\s*\{[^}]*clip-path:\s*inset\(0\)/s,
  )
})

test('camera presets retain reusable settings but exclude transient window state', () => {
  const preset = settingsForPreset({
    shape: 'landscape',
    size: 420,
    overlayResolution: '1080p',
    fullscreenResolution: '2160p',
    frameEffect: 'glow',
    effectColor: '#22c55e',
    mirror: false,
    cameraZoom: 175,
    cameraPosition: { x: 32, y: 68 },
    position: { x: 120, y: 80 },
    alwaysOnTop: false,
    overlayVisible: false,
    presets: [{ id: 'nested', name: 'Nested', settings: {} }],
  })

  assert.equal(preset.shape, 'landscape')
  assert.equal(preset.size, 420)
  assert.equal(preset.overlayResolution, '1080p')
  assert.equal(preset.fullscreenResolution, '2160p')
  assert.equal(preset.frameEffect, 'glow')
  assert.equal(preset.effectColor, '#22c55e')
  assert.equal(preset.mirror, false)
  assert.equal(preset.cameraZoom, 175)
  assert.deepEqual(preset.cameraPosition, { x: 32, y: 68 })
  assert.deepEqual(preset.position, { x: 120, y: 80 })
  assert.equal(Object.hasOwn(preset, 'alwaysOnTop'), false)
  assert.equal(Object.hasOwn(preset, 'overlayVisible'), false)
  assert.equal(Object.hasOwn(preset, 'presets'), false)
})

test('saving a scene snapshots the live compact window position', () => {
  const stale = { ...DEFAULT_SETTINGS, position: { x: 10, y: 20 } }

  assert.deepEqual(
    settingsWithLivePosition(stale, { x: 420, y: 260, width: 320, height: 320 }, false)
      .position,
    { x: 420, y: 260 },
  )
  assert.deepEqual(
    settingsWithLivePosition(stale, { x: 0, y: 0, width: 1920, height: 1080 }, true).position,
    { x: 10, y: 20 },
  )
})

test('sanitizes, limits, and restores named camera presets', () => {
  const presets = Array.from({ length: 8 }, (_, index) => ({
    id: `preset-${index}`,
    name: ` Setup ${index} `,
    settings: { size: 200 + index, shape: index === 0 ? 'triangle' : 'circle' },
  }))
  presets[1] = { id: '', name: 'Invalid', settings: {} }
  presets[2] = { id: 'blank-name', name: '   ', settings: {} }

  const result = sanitizeSettings({ presets })

  assert.equal(result.presets.length, 4)
  assert.equal(result.presets[0].name, 'Setup 0')
  assert.equal(result.presets[0].settings.shape, DEFAULT_SETTINGS.shape)
  assert.equal(result.presets[0].settings.size, 200)
  assert.equal(result.presets.at(-1).id, 'preset-5')
})

test('scene order controls define the numbered shortcut order', () => {
  const scenes = [
    { id: 'one', name: 'One', settings: {} },
    { id: 'two', name: 'Two', settings: {} },
    { id: 'three', name: 'Three', settings: {} },
  ]

  assert.deepEqual(
    reorderPresets(scenes, 'two', -1).map((scene) => scene.id),
    ['two', 'one', 'three'],
  )
  assert.deepEqual(
    reorderPresets(scenes, 'two', 1).map((scene) => scene.id),
    ['one', 'three', 'two'],
  )
  assert.deepEqual(reorderPresets(scenes, 'one', -1), scenes)
})

test('imported scenes merge by name and respect the six-scene limit', () => {
  const scene = (id, name, size) => ({ id, name, settings: settingsForPreset({ size }) })
  const existing = [scene('desk', 'Desk', 240), scene('wide', 'Wide', 320)]
  const imported = [scene('other-id', 'Desk', 480), scene('portrait', 'Portrait', 360)]
  const merged = mergePresets(existing, imported)

  assert.equal(merged.length, 3)
  assert.equal(merged[0].id, 'desk')
  assert.equal(merged[0].settings.size, 480)
  assert.equal(merged[2].name, 'Portrait')

  const full = Array.from({ length: 6 }, (_, index) => scene(`scene-${index}`, `Scene ${index}`, 200))
  assert.equal(mergePresets(full, [scene('extra', 'Extra', 300)]).length, 6)
})

test('preset controls are available in both settings surfaces', () => {
  const overlayHtml = readFileSync(join(import.meta.dirname, '..', 'src', 'overlay.html'), 'utf8')
  const controlHtml = readFileSync(join(import.meta.dirname, '..', 'src', 'control.html'), 'utf8')

  assert.match(overlayHtml, /id="overlay-preset-name"/)
  assert.match(overlayHtml, /id="overlay-preset-select"/)
  assert.match(controlHtml, /id="preset-name"/)
  assert.match(controlHtml, /id="preset-select"/)
})

test('settings use progressive disclosure instead of one long control stack', () => {
  const overlayHtml = readFileSync(join(import.meta.dirname, '..', 'src', 'overlay.html'), 'utf8')
  const controlHtml = readFileSync(join(import.meta.dirname, '..', 'src', 'control.html'), 'utf8')
  const overlaySource = readFileSync(join(import.meta.dirname, '..', 'src', 'overlay.js'), 'utf8')
  const controlSource = readFileSync(join(import.meta.dirname, '..', 'src', 'control.js'), 'utf8')

  for (const html of [overlayHtml, controlHtml]) {
    assert.match(html, /data-settings-tab="camera" aria-pressed="true"/)
    assert.match(html, /data-settings-tab="appearance" aria-pressed="false"/)
    assert.match(html, /data-settings-tab="presets" aria-pressed="false"/)
    assert.match(html, /data-settings-panel="camera"/)
    assert.match(html, /data-settings-panel="appearance"/)
    assert.match(html, /data-settings-panel="presets"/)
  }
  assert.match(overlaySource, /inlineSettings\.dataset\.activePanel = panel/)
  assert.match(controlSource, /settingsRoot\.dataset\.activePanel = panel/)
})

test('smart framing uses the target tool without duplicate size or zoom controls', () => {
  const overlayHtml = readFileSync(join(import.meta.dirname, '..', 'src', 'overlay.html'), 'utf8')
  const controlHtml = readFileSync(join(import.meta.dirname, '..', 'src', 'control.html'), 'utf8')
  const overlaySource = readFileSync(join(import.meta.dirname, '..', 'src', 'overlay.js'), 'utf8')

  assert.match(overlayHtml, /id="position-button"[^>]*title="[^"]*scroll to zoom"/)
  assert.match(overlayHtml, /class="framing-support"[^>]*aria-live="polite"/)
  assert.match(overlayHtml, /Zoom <span id="framing-zoom">100%<\/span>/)
  assert.match(overlayHtml, /Drag · Scroll · Double-click resets/)
  assert.doesNotMatch(overlayHtml, /id="overlay-(?:size|zoom)-range"/)
  assert.doesNotMatch(controlHtml, /id="(?:size|zoom)-range"/)
  assert.match(overlaySource, /cameraSurface\.addEventListener\(\s*'wheel'/)
  assert.match(overlaySource, /cameraZoomAfterWheel\(state\.cameraZoom, event\.deltaY\)/)
  assert.match(overlaySource, /state\.cameraZoom \/ 100/)
  assert.match(overlaySource, /camera\.style\.transformOrigin = cameraOrigin/)
  assert.match(overlaySource, /camFrame\.updateState\(\{ cameraPosition, cameraZoom: 100 \}\)/)
})

test('presentation controls expose shortcuts, startup, tray presets, and notices', () => {
  const overlayHtml = readFileSync(join(import.meta.dirname, '..', 'src', 'overlay.html'), 'utf8')
  const controlHtml = readFileSync(join(import.meta.dirname, '..', 'src', 'control.html'), 'utf8')
  const mainSource = readFileSync(join(import.meta.dirname, '..', 'src', 'main.js'), 'utf8')
  const preloadSource = readFileSync(join(import.meta.dirname, '..', 'src', 'preload.cjs'), 'utf8')

  assert.match(overlayHtml, /id="overlay-launch-toggle"/)
  assert.match(overlayHtml, /id="presentation-toast"[^>]*aria-live="polite"/)
  assert.match(controlHtml, /id="launch-toggle"/)
  assert.match(mainSource, /label: 'Scenes', submenu: presetMenu/)
  assert.match(mainSource, /CommandOrControl\+Shift\+H/)
  assert.match(mainSource, /CommandOrControl\+Shift\+F/)
  assert.match(mainSource, /CommandOrControl\+Shift\+P/)
  assert.match(mainSource, /CommandOrControl\+Shift\+\$\{index \+ 1\}/)
  assert.match(mainSource, /animateOverlayBounds\(targetBounds\)/)
  assert.match(preloadSource, /onPresentationNotice/)
  assert.match(preloadSource, /exportPresets/)
  assert.match(preloadSource, /importPresets/)
})

test('mirror control lives in inline settings instead of the quick toolbar', () => {
  const html = readFileSync(join(import.meta.dirname, '..', 'src', 'overlay.html'), 'utf8')
  const toolbar = html.match(/<nav class="hover-toolbar"[\s\S]*?<\/nav>/)?.[0] ?? ''
  const settings = html.match(/<section class="inline-settings"[\s\S]*?<\/section>/)?.[0] ?? ''

  assert.doesNotMatch(toolbar, /mirror-button/)
  assert.match(settings, /id="overlay-mirror-toggle"/)
})

test('frame effect changes refresh the native overlay mask', () => {
  assert.equal(settingsPatchChangesOverlayGeometry({ frameEffect: 'glow' }), true)
})

test('frame effects expose CSS tuning variables and outside-only recipes', () => {
  const css = readFileSync(join(import.meta.dirname, '..', 'src', 'overlay.css'), 'utf8')

  assert.match(css, /--effect-glow-near:/)
  assert.match(css, /--effect-glow-far:/)
  assert.match(css, /--effect-blur-radius:/)
  assert.match(css, /--effect-color:/)
  assert.match(css, /\.overlay\[data-effect='glow'\] \.camera-effect-layer/)
  assert.match(css, /\.overlay\[data-effect='blur'\] \.camera-effect-layer/)
  assert.doesNotMatch(css, /data-effect='edge'/)
})

test('effect colors stay in-app instead of opening a native color dialog', () => {
  const overlayHtml = readFileSync(join(import.meta.dirname, '..', 'src', 'overlay.html'), 'utf8')
  const controlHtml = readFileSync(join(import.meta.dirname, '..', 'src', 'control.html'), 'utf8')

  assert.match(overlayHtml, /id="overlay-effect-color"[^>]+type="text"/)
  assert.match(controlHtml, /id="effect-color"[^>]+type="text"/)
  assert.match(overlayHtml, /data-effect-color="#fb923c"/)
  assert.match(controlHtml, /data-effect-color="#22d3ee"/)
  assert.doesNotMatch(overlayHtml, /id="overlay-effect-color"[^>]+type="color"/)
  assert.doesNotMatch(controlHtml, /id="effect-color"[^>]+type="color"/)
})

test('effect tuning controls are contextual and drive CSS variables', () => {
  const overlayHtml = readFileSync(join(import.meta.dirname, '..', 'src', 'overlay.html'), 'utf8')
  const overlaySource = readFileSync(join(import.meta.dirname, '..', 'src', 'overlay.js'), 'utf8')

  assert.match(overlayHtml, /id="overlay-glow-controls"[^>]*hidden/)
  assert.match(overlayHtml, /id="overlay-blur-controls"[^>]*hidden/)
  assert.match(overlaySource, /glowControls\.hidden = state\.frameEffect !== 'glow'/)
  assert.match(overlaySource, /blurControls\.hidden = state\.frameEffect !== 'blur'/)
  assert.match(overlaySource, /--effect-glow-opacity/)
  assert.match(overlaySource, /--effect-blur-radius/)
})

test('fullscreen copy and Escape behavior stay in sync', () => {
  assert.equal(fullscreenButtonCopy(false), 'Enter full screen')
  assert.equal(fullscreenButtonCopy(true), 'Exit full screen')
  assert.equal(isFullscreenExitInput({ type: 'keyDown', key: 'Escape' }), true)
  assert.equal(isFullscreenExitInput({ type: 'keyUp', key: 'Escape' }), false)
  assert.equal(isFullscreenExitInput({ type: 'keyDown', key: 'Enter' }), false)
})

test('leaving fullscreen hides compact chrome while the window shrinks', () => {
  const source = readFileSync(join(import.meta.dirname, '..', 'src', 'overlay.js'), 'utf8')
  const applyFullscreenSource =
    source.match(/function applyFullscreen\(nextFullscreen\) \{[\s\S]*?\n\}/)?.[0] ?? ''

  assert.match(applyFullscreenSource, /else setHovered\(false\)/)
})

test('window focus loss clears hover and transient overlay controls', () => {
  const source = readFileSync(join(import.meta.dirname, '..', 'src', 'overlay.js'), 'utf8')
  const blurHandlerSource =
    source.match(/function handleWindowBlur\(\) \{[\s\S]*?\n\}/)?.[0] ?? ''

  assert.match(blurHandlerSource, /if \(controlsOpen\) setControlsOpen\(false\)/)
  assert.match(blurHandlerSource, /if \(positioning\) setPositioning\(false\)/)
  assert.match(blurHandlerSource, /setHovered\(false\)/)
  assert.match(source, /window\.addEventListener\('blur', handleWindowBlur\)/)
})

test('fullscreen toolbar uses an inactivity delay and a padded hover hotspot', () => {
  const toolbar = { left: 100, top: 20, right: 340, bottom: 64 }

  assert.equal(FULLSCREEN_TOOLBAR_HIDE_DELAY_MS, 200)
  assert.equal(pointIsInToolbarHotspot({ x: 220, y: 42 }, toolbar), true)
  assert.equal(pointIsInToolbarHotspot({ x: 92, y: 42 }, toolbar), true)
  assert.equal(pointIsInToolbarHotspot({ x: 80, y: 42 }, toolbar), false)
  assert.equal(pointIsInToolbarHotspot({ x: 220, y: 80 }, toolbar), false)
})

test('leaving fullscreen restores the live topmost camera window', () => {
  const normalBounds = { x: 120, y: 80, width: 356, height: 422 }
  const displayBounds = { x: 0, y: 0, width: 1920, height: 1080 }

  assert.deepEqual(
    fullscreenWindowPlan({
      fullscreen: false,
      normalBounds,
      displayBounds,
      alwaysOnTop: true,
      visible: true,
    }),
    {
      bounds: normalBounds,
      alwaysOnTop: true,
      visible: true,
    },
  )
})

test('fullscreen bounds animate smoothly in either direction', () => {
  const small = { x: 120, y: 80, width: 360, height: 420 }
  const large = { x: 0, y: 0, width: 1920, height: 1080 }

  assert.deepEqual(interpolateWindowBounds(small, large, 0), small)
  assert.deepEqual(interpolateWindowBounds(small, large, 0.5), {
    x: 60,
    y: 40,
    width: 1140,
    height: 750,
  })
  assert.deepEqual(interpolateWindowBounds(small, large, 1), large)
  assert.deepEqual(interpolateWindowBounds(large, small, 1), small)
})
