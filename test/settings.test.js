import test from 'node:test'
import assert from 'node:assert/strict'
import {
  settingsAfterHandResize,
  DEFAULT_SETTINGS,
  STARTER_SCENES,
  legacyLaunchAtLogin,
  preferencesFromDocument,
  dimensionsFor,
  overlayDimensionsFor,
  sanitizeSettings,
  settingsForPreset,
  settingsPatchChangesOverlayGeometry,
} from '../src/settings.js'

// Sanitizing and loading rules are covered by the shared fixtures in preferences-contract.test.js.

test('Preferences use schema 15', () => {
  assert.equal(DEFAULT_SETTINGS.schemaVersion, 15)
  assert.equal(sanitizeSettings({ schemaVersion: 3 }).schemaVersion, 15)
})

test('Start at login is gone: the setting is no longer kept, and an old file still loads', () => {
  assert.equal(Object.hasOwn(DEFAULT_SETTINGS, 'launchAtLogin'), false)
  assert.equal(Object.hasOwn(sanitizeSettings({ launchAtLogin: true }), 'launchAtLogin'), false)
  // A schema-14 file from before: its Scenes stay, the retired switch is dropped, no starters are added.
  const old = JSON.stringify({
    schemaVersion: 14,
    launchAtLogin: true,
    completedOnboardingVersion: 1,
    presets: [{ id: 'mine', name: 'Mine', settings: { size: 300, position: { x: 10, y: 20 } } }],
  })
  const loaded = preferencesFromDocument(old)
  assert.equal(loaded.schemaVersion, 15)
  assert.equal(Object.hasOwn(loaded, 'launchAtLogin'), false)
  assert.deepEqual(loaded.presets.map(({ id }) => id), ['mine'])
  // Main turns the old login item off once, only for a file that had it on.
  assert.equal(legacyLaunchAtLogin(old), true)
  assert.equal(legacyLaunchAtLogin(JSON.stringify({ schemaVersion: 14, launchAtLogin: false })), false)
  assert.equal(legacyLaunchAtLogin(undefined), false)
  assert.equal(legacyLaunchAtLogin('{not json'), false)
})

test('a new installation and an older file without Scenes start with the two starter Scenes', () => {
  assert.deepEqual(STARTER_SCENES.map(({ name }) => name), ['Small bottom', 'Big right'])
  assert.deepEqual(STARTER_SCENES.map(({ layout }) => layout), [
    { size: 288, position: 'bottom-right' },
    { size: 540, position: 'right' },
  ])
  const fresh = preferencesFromDocument(undefined)
  assert.deepEqual(fresh.presets, sanitizeSettings({ presets: STARTER_SCENES }).presets)
  assert.deepEqual(preferencesFromDocument(JSON.stringify({ schemaVersion: 14 })).presets, fresh.presets)
  // From schema 15 on, an empty Scene list is the user's choice (all deleted) and stays empty.
  assert.deepEqual(preferencesFromDocument(JSON.stringify({ schemaVersion: 15, presets: [] })).presets, [])
})

test('the Scenes view is a list or a grid, grid by default', () => {
  assert.equal(DEFAULT_SETTINGS.sceneView, 'grid')
  assert.equal(sanitizeSettings({ sceneView: 'list' }).sceneView, 'list')
  assert.equal(sanitizeSettings({ sceneView: 'tiles' }).sceneView, 'grid')
})

test('only shape, size, and position changes move the native Overlay', () => {
  assert.equal(settingsPatchChangesOverlayGeometry({ overlayResolution: '2160p' }), false)
  assert.equal(settingsPatchChangesOverlayGeometry({ mirror: false }), false)
  assert.equal(settingsPatchChangesOverlayGeometry({ alwaysOnTop: false }), false)
  assert.equal(settingsPatchChangesOverlayGeometry({ frameEffect: 'glow' }), false)
  assert.equal(settingsPatchChangesOverlayGeometry({ size: 420 }), true)
  assert.equal(settingsPatchChangesOverlayGeometry({ shape: 'landscape' }), true)
  assert.equal(settingsPatchChangesOverlayGeometry({ position: { x: 10, y: 20 } }), true)
})

test('camera dimensions follow each shape aspect ratio', () => {
  assert.deepEqual(dimensionsFor({ shape: 'circle', size: 320 }), { width: 320, height: 320 })
  assert.deepEqual(dimensionsFor({ shape: 'rounded', size: 320 }), { width: 320, height: 320 })
  assert.deepEqual(dimensionsFor({ shape: 'portrait', size: 320 }), { width: 240, height: 320 })
  assert.deepEqual(dimensionsFor({ shape: 'landscape', size: 320 }), { width: 320, height: 180 })
})

test('the Overlay window reserves room for hover controls around the camera', () => {
  assert.deepEqual(overlayDimensionsFor({ shape: 'circle', size: 320 }), { width: 356, height: 422 })
})

test('Scene snapshots keep reusable settings and drop global or transient state', () => {
  const scene = settingsForPreset({
    shape: 'landscape',
    size: 420,
    overlayResolution: '1080p',
    frameEffect: 'glow',
    effectColor: '#22c55e',
    mirror: false,
    cameraZoom: 175,
    cameraPosition: { x: 32, y: 68 },
    position: { x: 120, y: 80 },
    alwaysOnTop: false,
    overlayVisible: false,
    sceneView: 'list',
    completedOnboardingVersion: 1,
    presets: [{ id: 'nested', name: 'Nested', settings: {} }],
  })

  assert.deepEqual(scene, {
    cameraId: '',
    cameraLabel: 'Default camera',
    shape: 'landscape',
    size: 420,
    overlayResolution: '1080p',
    frameEffect: 'glow',
    effectColor: '#22c55e',
    glowStrength: 90,
    glowSpread: 13,
    blurAmount: 12,
    blurOpacity: 72,
    borderWidth: 0,
    borderColor: '#ffffff',
    mirror: false,
    cameraZoom: 175,
    cameraPosition: { x: 32, y: 68 },
    position: { x: 120, y: 80 },
  })
})

test('a hand resize sets the small size only when the size really changed', () => {
  const large = sanitizeSettings({ size: 432, prompterSmallSize: 288 })
  // The same size again (for example the pointer back where it was) changes nothing.
  assert.equal(settingsAfterHandResize(large, { size: 432, position: { x: 1, y: 2 } }).prompterSmallSize, 288)
  const resized = settingsAfterHandResize(large, { size: 400, position: { x: 1, y: 2 } })
  assert.equal(resized.size, 400)
  assert.equal(resized.prompterSmallSize, 400)
})

test('an old Preferences file with a place off every screen still loads its place and Scenes unchanged (TOOLS-156)', () => {
  // Lex's renamed preferences.old.json: saved on a desk display that is not connected now. The window is
  // brought back on screen at startup (overlay-geometry `onScreenBase`), so nothing here is dropped.
  const old = {
    schemaVersion: 15,
    completedOnboardingVersion: 1,
    position: { x: 3712, y: -812 },
    presets: [
      { id: 'preset-desk', name: 'Desk', settings: { size: 320, position: { x: 3600, y: 200 } } },
      { id: 'starter-small-bottom', name: 'Small bottom', settings: { size: 288 }, layout: { size: 288, position: 'bottom-right' } },
    ],
  }
  const loaded = preferencesFromDocument(JSON.stringify(old))
  assert.equal(loaded.schemaVersion, DEFAULT_SETTINGS.schemaVersion)
  assert.deepEqual(loaded.position, { x: 3712, y: -812 })
  assert.deepEqual(loaded.presets.map((scene) => scene.name), ['Desk', 'Small bottom'])
  assert.deepEqual(loaded.presets[0].settings.position, { x: 3600, y: 200 })
  assert.deepEqual(loaded.presets[1].layout, { size: 288, position: 'bottom-right' })
})
