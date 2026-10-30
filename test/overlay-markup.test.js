import test from 'node:test'
import assert from 'node:assert/strict'
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { BRIDGE_CONTRACT } from '../src/bridge.js'
import { ONBOARDING_STEP_COUNT } from '../src/onboarding.js'

// Static contracts for markup, styles, and Electron wiring that have no testable interface.
// Behavior lives in the module suites; keep these to what only the source text can show.

const sourceRoot = join(import.meta.dirname, '..', 'src')
const read = (file) => readFileSync(join(sourceRoot, file), 'utf8')
const overlayHtml = read('overlay.html')
const overlayCss = read('overlay.css')
const overlaySource = read('overlay.js')
const mainSource = read('main.js')

test('onboarding is reachable through the Overlay and tray Help', () => {
  assert.match(overlayHtml, /class="onboarding-coachmark"[^>]*id="onboarding-panel"[^>]*role="dialog"/)
  assert.doesNotMatch(overlayHtml, /id="onboarding-panel"[^>]*aria-modal="true"/)
  assert.match(overlayHtml, /id="onboarding-title"[^>]*tabindex="-1"/)
  assert.match(overlayHtml, /id="onboarding-progress-label">Getting started<\/p>/)
  assert.match(overlayHtml, /id="onboarding-progress"[^>]*role="progressbar"[^>]*aria-valuenow="1"/)
  assert.match(overlayHtml, /id="onboarding-demo-mouse"[^>]*aria-hidden="true"[^>]*hidden/)
  assert.equal((overlayHtml.match(/data-onboarding-progress=/g) ?? []).length, ONBOARDING_STEP_COUNT)
  assert.match(mainSource, /label: 'Help & onboarding', click: showOnboarding/)
})

test('the onboarding coach mark sits above the toolbar in the reserved space', () => {
  assert.match(overlaySource, /const toolbarTop = onboardingOffset \+ 22/)
  assert.match(overlaySource, /onboardingPanel\.dataset\.placement = 'above'/)
  assert.match(overlaySource, /new ResizeObserver\(\(\) => tour\.relayout\(\)\)\.observe\(overlay\)/)
  assert.doesNotMatch(overlaySource, /Getting started · Step/)
  assert.match(overlayCss, /top:\s*calc\(22px \+ var\(--onboarding-offset\)\)/)
  assert.match(overlayCss, /top:\s*var\(--settings-top\)/)
  assert.match(overlayCss, /max-height:\s*calc\(100% - var\(--settings-top\)\)/)
  assert.match(overlayCss, /\.overlay\[data-onboarding='true'\] \.hover-toolbar\s*\{[^}]*transform:\s*none[^}]*transition:\s*none/s)
})

test('onboarding highlights, progress, and the demo cursor have their visual contract', () => {
  assert.match(overlayCss, /\.hover-toolbar button\[data-onboarding-target='true'\][^{]*\{[^}]*color:\s*#e5e5e5[^}]*outline:\s*2px solid #fb923c[^}]*background:\s*#19191b/s)
  assert.match(overlayCss, /\.onboarding-progress\s*\{[^}]*display:\s*grid/s)
  assert.match(overlayCss, /\.onboarding-demo-mouse\s*\{[^}]*pointer-events:\s*none/s)
  assert.match(overlayCss, /@media \(prefers-reduced-motion: reduce\)[\s\S]*\.onboarding-demo-mouse\s*\{\s*display:\s*none/s)
})

test('Camera quality is one control used in Compact mode and Full screen', () => {
  assert.match(overlayHtml, /<legend>Camera quality<\/legend>/)
  assert.equal((overlayHtml.match(/id="overlay-resolution-select"/g) ?? []).length, 1)
  assert.doesNotMatch(overlayHtml, /fullscreen-resolution-select/)
})

test('toolbar centering does not depend on the animated transform', () => {
  const toolbarRule = overlayCss.match(/(?:^|\n)\.hover-toolbar\s*\{([^}]+)\}/)?.[1] ?? ''

  assert.match(toolbarRule, /--toolbar-width:\s*min\(196px,/)
  assert.match(toolbarRule, /var\(--active-camera-left\)/)
  assert.match(toolbarRule, /var\(--active-camera-width\)/)
  assert.doesNotMatch(toolbarRule, /translateX/)
})

test('every camera shape is clipped in CSS', () => {
  assert.match(overlayCss, /\.overlay\[data-shape='circle'\] \.camera-surface\s*\{[^}]*clip-path:\s*inset\(0 round 50%\)/s)
  assert.match(overlayCss, /\.overlay\[data-shape='rounded'\] \.camera-surface\s*\{[^}]*clip-path:\s*inset\(0 round 16%\)/s)
  assert.match(overlayCss, /\.overlay\[data-shape='portrait'\] \.camera-surface[^}]*clip-path:\s*inset\(0 round 12%\)/s)
  assert.match(overlayCss, /\.overlay\[data-fullscreen='true'\] \.camera-surface\s*\{[^}]*clip-path:\s*inset\(0\)/s)
})

test('Scene controls are available in the reachable Overlay', () => {
  assert.match(overlayHtml, /id="overlay-preset-name"/)
  assert.match(overlayHtml, /id="overlay-preset-select"/)
})

test('Inline settings use tabs instead of one long control stack', () => {
  assert.match(overlayHtml, /data-settings-tab="camera" aria-pressed="true"/)
  assert.match(overlayHtml, /data-settings-tab="appearance" aria-pressed="false"/)
  assert.match(overlayHtml, /data-settings-tab="presets" aria-pressed="false"/)
  assert.match(overlayHtml, /data-settings-panel="camera"/)
  assert.match(overlayHtml, /data-settings-panel="appearance"/)
  assert.match(overlayHtml, /data-settings-panel="presets"/)
  assert.match(overlaySource, /inlineSettings\.dataset\.activePanel = panel/)
})

test('framing uses the target tool without duplicate size or zoom controls', () => {
  assert.match(overlayHtml, /id="position-button"[^>]*title="[^"]*scroll to zoom"/)
  assert.match(overlayHtml, /class="framing-support"[^>]*aria-live="polite"/)
  assert.match(overlayHtml, /Zoom <span id="framing-zoom">100%<\/span>/)
  assert.match(overlayHtml, /Drag · Scroll · Double-click resets/)
  assert.doesNotMatch(overlayHtml, /id="overlay-(?:size|zoom)-range"/)
  assert.match(overlaySource, /cameraSurface\.addEventListener\(\s*'wheel'/)
  assert.match(overlaySource, /cameraZoomAfterWheel\(state\.cameraZoom, event\.deltaY\)/)
  assert.match(overlaySource, /cameraFramingStyles\(framing\)/)
  assert.match(overlaySource, /const framing = centeredFraming\(\)/)
})

test('presentation controls expose shortcuts, startup, tray Scenes, and notices', () => {
  assert.match(overlayHtml, /id="overlay-launch-toggle"/)
  assert.match(overlayHtml, /id="presentation-toast"[^>]*aria-live="polite"/)
  assert.match(mainSource, /label: 'Scenes', submenu: presetMenu/)
  assert.match(mainSource, /CommandOrControl\+Shift\+H/)
  assert.match(mainSource, /CommandOrControl\+Shift\+F/)
  assert.match(mainSource, /CommandOrControl\+Shift\+P/)
  assert.match(mainSource, /CommandOrControl\+Shift\+\$\{index \+ 1\}/)
})

test('the mirror control lives in Inline settings instead of the toolbar', () => {
  const toolbar = overlayHtml.match(/<nav class="hover-toolbar"[\s\S]*?<\/nav>/)?.[0] ?? ''
  const settings = overlayHtml.match(/<section class="inline-settings"[\s\S]*?<\/section>/)?.[0] ?? ''

  assert.doesNotMatch(toolbar, /mirror-button/)
  assert.match(settings, /id="overlay-mirror-toggle"/)
})

test('Frame effects expose CSS tuning variables and outside-only recipes', () => {
  assert.match(overlayCss, /--effect-glow-near:/)
  assert.match(overlayCss, /--effect-glow-far:/)
  assert.match(overlayCss, /--effect-blur-radius:/)
  assert.match(overlayCss, /--effect-color:/)
  assert.match(overlayCss, /\.overlay\[data-effect='glow'\] \.camera-effect-layer/)
  assert.match(overlayCss, /\.overlay\[data-effect='blur'\] \.camera-effect-layer/)
  assert.doesNotMatch(overlayCss, /data-effect='edge'/)
})

test('effect colors stay in-app instead of opening a native color dialog', () => {
  assert.match(overlayHtml, /id="overlay-effect-color"[^>]+type="text"/)
  assert.match(overlayHtml, /data-effect-color="#fb923c"/)
  assert.doesNotMatch(overlayHtml, /id="overlay-effect-color"[^>]+type="color"/)
})

test('effect tuning controls are contextual and drive CSS variables', () => {
  assert.match(overlayHtml, /id="overlay-glow-controls"[^>]*hidden/)
  assert.match(overlayHtml, /id="overlay-blur-controls"[^>]*hidden/)
  assert.match(overlaySource, /glowControls\.hidden = state\.frameEffect !== 'glow'/)
  assert.match(overlaySource, /blurControls\.hidden = state\.frameEffect !== 'blur'/)
  assert.match(overlaySource, /--effect-glow-opacity/)
  assert.match(overlaySource, /--effect-blur-radius/)
})

test('the unreachable separate Controller and its privileged bridge stay removed', () => {
  for (const file of ['control.html', 'control.css', 'control.js']) {
    assert.equal(existsSync(join(sourceRoot, file)), false, file)
  }
  assert.doesNotMatch(mainSource, /createControlWindow|controlWindow|controller:show|overlay:center/)
  const bridgeMethods = BRIDGE_CONTRACT.map(({ method }) => method)
  for (const removed of ['onDevicesChanged', 'onCameraError', 'showController', 'centerOverlay']) {
    assert.equal(bridgeMethods.includes(removed), false, removed)
  }
})

test('leaving Full screen hides the compact chrome while the window shrinks', () => {
  const applyFullscreen = overlaySource.match(/function applyFullscreen\(nextFullscreen\) \{[\s\S]*?\n\}/)?.[0] ?? ''

  assert.match(applyFullscreen, /else interaction\.hideChrome\(\)/)
  assert.match(applyFullscreen, /fullscreen \? 'Exit full screen' : 'Enter full screen'/)
  assert.match(overlayHtml, /id="fullscreen-button" aria-label="Enter full screen"/)
})

test('window focus loss clears hover and transient Overlay controls outside onboarding', () => {
  const blurHandler = overlaySource.match(/function handleWindowBlur\(\) \{[\s\S]*?\n\}/)?.[0] ?? ''

  assert.match(blurHandler, /if \(!tour\.isOpen\)/)
  assert.match(blurHandler, /if \(interaction\.controlsOpen\) setControlsOpen\(false\)/)
  assert.match(blurHandler, /if \(interaction\.positioning\) setPositioning\(false\)/)
  assert.match(blurHandler, /interaction\.hideChrome\(\)/)
  assert.match(overlaySource, /window\.addEventListener\('blur', handleWindowBlur\)/)
})

test('live accessibility preferences reach the Overlay, main process, and onboarding', () => {
  assert.match(overlaySource, /matchMedia\('\(prefers-reduced-motion: reduce\)'\)/)
  assert.match(overlaySource, /matchMedia\('\(forced-colors: active\)'\)/)
  assert.match(overlaySource, /matchMedia\('\(prefers-contrast: more\)'\)/)
  assert.match(overlaySource, /dataset\.reducedMotion = String\(preferences\.reducedMotion\)/)
  assert.match(overlaySource, /dataset\.highContrast = String\(preferences\.highContrast\)/)
  assert.match(overlaySource, /tour\.reducedMotionChanged\(preferences\.reducedMotion\)/)
  assert.match(overlaySource, /reportAccessibilityPreferences\(preferences\)/)
  assert.match(overlaySource, /addEventListener\('change', syncAccessibilityPreferences\)/)
  assert.match(
    overlayCss,
    /\.overlay\[data-reduced-motion='true'\] \*[\s\S]*animation:\s*none !important;[\s\S]*transition:\s*none !important;/,
  )
})

test('high contrast preserves boundaries, selection, focus, and status without effect colors', () => {
  const highContrast =
    overlayCss.match(/\.overlay\[data-high-contrast='true'\][\s\S]*?@media \(prefers-reduced-motion: reduce\)/)?.[0] ??
    ''

  assert.match(highContrast, /CanvasText/)
  assert.match(highContrast, /ButtonFace/)
  assert.match(highContrast, /HighlightText/)
  assert.match(highContrast, /\.hover-toolbar button\.selected/)
  assert.match(highContrast, /\.settings-tabs button\[aria-pressed='true'\]/)
  assert.match(highContrast, /\.effect-color-swatches button\[aria-pressed='true'\]::after/)
  assert.match(highContrast, /:focus-visible/)
  assert.match(highContrast, /\.camera-state/)
  assert.match(highContrast, /\.presentation-toast/)
  assert.doesNotMatch(highContrast, /var\(--effect-color\)/)
})

test('the Prompter link is an opt-in Scenes setting that closes with the app', () => {
  const scenesPanel = overlayHtml.match(/<div class="inline-prompter" data-settings-panel="presets">[\s\S]*?<\/div>\n {8}<\/div>/)?.[0] ?? ''
  assert.match(scenesPanel, /id="overlay-prompter-toggle"[^>]*type="checkbox"/)
  assert.doesNotMatch(scenesPanel, /id="overlay-prompter-toggle"[^>]*checked/)
  assert.match(scenesPanel, /id="overlay-prompter-status"[^>]*aria-live="polite"/)
  assert.match(scenesPanel, /id="overlay-prompter-options" hidden/)
  assert.match(scenesPanel, /id="overlay-prompter-full"/)
  assert.match(scenesPanel, /id="overlay-prompter-small"/)
  assert.match(scenesPanel, /id="overlay-prompter-margin"[^>]*min="0" max="160"/)
  assert.match(mainSource, /prompterLink\.setEnabled\(settings\.prompterLink\)/)
  assert.match(mainSource, /if \(Object\.hasOwn\(patch, 'prompterLink'\)\) prompterLink\?\.setEnabled\(settings\.prompterLink\)/)
  assert.match(mainSource, /app\.on\('before-quit', \(\) => \{\n {2}app\.isQuitting = true\n {2}prompterLink\?\.close\(\)/)
})
