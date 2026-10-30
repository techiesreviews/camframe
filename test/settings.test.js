import test from 'node:test'
import assert from 'node:assert/strict'
import {
  DEFAULT_SETTINGS,
  dimensionsFor,
  overlayDimensionsFor,
  sanitizeSettings,
  settingsForPreset,
  settingsPatchChangesOverlayGeometry,
} from '../src/settings.js'

// Sanitizing and loading rules are covered by the shared fixtures in preferences-contract.test.js.

test('Preferences use schema 13', () => {
  assert.equal(DEFAULT_SETTINGS.schemaVersion, 13)
  assert.equal(sanitizeSettings({ schemaVersion: 3 }).schemaVersion, 13)
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
    launchAtLogin: true,
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
