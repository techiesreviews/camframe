# Data and interface contracts

## Preferences schema

Preferences are the only durable application state. `sanitizeSettings()` always starts from defaults, selectively accepts known values, deep-copies nested objects, and drops unknown keys. The current schema version is 12.

| Field | Default | Accepted/sanitized value | Persisted | In Scene |
| --- | --- | --- | --- | --- |
| `schemaVersion` | `12` | Always current default; input is not copied | Yes | No |
| `cameraId` | `""` | String, first 512 characters | Yes | Yes |
| `cameraLabel` | `"Default camera"` | String, first 120 characters | Yes | Yes |
| `shape` | `"circle"` | `circle`, `rounded`, `portrait`, `landscape` | Yes | Yes |
| `size` | `288` | Finite number, rounded/clamped 180?640 | Yes | Yes |
| `overlayResolution` | `"720p"` | `480p`, `720p`, `1080p`, `2160p`; compatibility key for the single Camera quality used in both modes | Yes | Yes |
| `frameEffect` | `"none"` | `none`, `glow`, `blur` | Yes | Yes |
| `effectColor` | `"#fb923c"` | Six-digit hex with leading `#` | Yes | Yes |
| `glowStrength` | `90` | Integer 10?100 | Yes | Yes |
| `glowSpread` | `13` | Integer 4?18 | Yes | Yes |
| `blurAmount` | `12` | Integer 4?18 | Yes | Yes |
| `blurOpacity` | `72` | Integer 10?100 | Yes | Yes |
| `borderWidth` | `0` | Integer 0?12 | Yes | Yes |
| `borderColor` | `"#ffffff"` | Six-digit hex with leading `#` | Yes | Yes |
| `mirror` | `true` | Boolean | Yes | Yes |
| `cameraZoom` | `100` | Integer 100?250 | Yes | Yes |
| `cameraPosition` | `{x:50,y:50}` | Each finite coordinate rounded to 0.1 and clamped 0?100 | Yes | Yes |
| `alwaysOnTop` | `true` | Boolean; forced `true` at every startup | Yes | No |
| `overlayVisible` | `true` | Boolean; forced `true` at every startup | Yes | No |
| `launchAtLogin` | `false` | Boolean | Yes | No |
| `completedOnboardingVersion` | `0` | Finite number rounded/clamped 0?1 | Yes | No |
| `position` | `null` | `null` or integer `{x,y}` in screen coordinates | Yes | Yes |
| `presets` | `[]` | Up to six valid Scene records | Yes | No (no nesting) |

Colors retain input case in persisted state when accepted. The live hex text editors send lowercase; the UI renders uppercase text. Numbers are sanitized even when the corresponding control is not currently visible.

### Startup override

`startupSettings()` sanitizes Preferences, then always sets `alwaysOnTop` and `overlayVisible` to `true`. The stored values can change during a session and are written, but false values are intentionally not restored on launch.

The integration harness is the only exception to the normal user-data path: in an unpackaged build, when `CAMFRAME_E2E=1` and `CAMFRAME_E2E_USER_DATA_DIR` is absolute, main selects that isolated directory before reading Preferences and enables Chromium's synthetic video device/permission switches. These process-environment hooks are not exposed through preload, persisted, or honored by packaged launches.

### Legacy migration

Before sanitization, a loaded document with `schemaVersion < 3` receives `borderWidth = 0` and `size = 288`. A successfully loaded Preferences document without `completedOnboardingVersion` receives the current onboarding version so existing users are not interrupted. A missing or invalid Preferences document retains the default version 0. Explicit saved version 0 remains incomplete across restart. Legacy `fullscreenResolution` values are ignored; `overlayResolution` becomes the one retained Camera quality. Other fields continue to rely on defaults and sanitization for forward compatibility.

## Scene record

```json
{
  "id": "preset-l2abc123",
  "name": "Desk close-up",
  "settings": {
    "cameraId": "device-id",
    "cameraLabel": "Camera name",
    "shape": "circle",
    "size": 288,
    "overlayResolution": "720p",
    "frameEffect": "none",
    "effectColor": "#fb923c",
    "glowStrength": 90,
    "glowSpread": 13,
    "blurAmount": 12,
    "blurOpacity": 72,
    "borderWidth": 0,
    "borderColor": "#ffffff",
    "mirror": true,
    "cameraZoom": 100,
    "cameraPosition": { "x": 50, "y": 50 },
    "position": { "x": 120, "y": 80 }
  }
}
```

- ID: non-empty string truncated to 64 characters. New IDs are `preset-` plus `Date.now().toString(36)`.
- Name: trimmed, non-empty string truncated to 40 characters.
- Settings: the exact ordered key list exported by `PRESET_SETTING_KEYS`; nested position objects are copied.
- Invalid records are dropped. Sanitization considers only the first six input records before filtering invalid ones, so invalid early records can reduce the resulting count.
- Reorder moves one slot according to the sign of `direction`; invalid/boundary moves are no-ops.
- Save/update matches requested ID first, then case-insensitive name. A seventh new save drops the oldest Scene and keeps the newest six.

## Scene export/import document

Canonical export:

```json
{
  "format": "camframe-scenes",
  "version": 1,
  "scenes": []
}
```

Import also accepts a bare array or an object with `presets`. The current importer does not enforce `format` or `version`. Merge rules are:

1. Match by exact ID or locale-aware case-insensitive name.
2. A match replaces settings/name but preserves the local matched ID.
3. A non-match appends if fewer than six local Scenes exist.
4. A colliding imported ID is prefixed with `imported-{slot}-` and truncated to 64 characters.
5. Unrelated local Scenes are retained; import never performs a full replacement.

The import result count is the number of valid imported input records, not necessarily the number appended or changed.

## Camera constraints

Resolution mapping:

| Token | Ideal dimensions |
| --- | --- |
| `480p` | 854?480 |
| `720p` | 1280?720 |
| `1080p` | 1920?1080 |
| `2160p` | 3840?2160 |

`cameraConstraintsFor(id, options)` returns `{audio:false, video:{...}}`; non-empty IDs become `{deviceId:{exact:id}}`. The chosen Camera quality is used in Compact mode and Full screen with ideal 60/minimum 30/maximum 60 fps unless retrying slower. These dimensions are preferences, not guarantees; browsers and drivers may choose another supported profile. Mode changes never apply new track constraints.

## Geometry contracts

Camera surface dimensions:

```text
circle/rounded: width = size, height = size
portrait:       width = round(size ? 0.75), height = size
landscape:      width = size, height = round(size ? 0.5625)
```

Outer Overlay dimensions add `left 18 + right 18` and `top 84 + bottom 18`. `position` is the outer window's top-left screen coordinate.

Corner resize converts horizontal and vertical pointer deltas back to the base `size`, chooses whichever has larger absolute change, clamps, and adjusts `position` only for left/top handles so the opposite corner stays anchored.

Camera pan uses the visible surface dimensions and zoom overflow. At 100% it uses an overflow scale of 1 to keep the crop-origin control defined. Horizontal pan negates drag unless mirrored; vertical pan always negates drag.

## Preload/IPC contract

Renderers receive only `window.camFrame`. Sends are fire-and-forget; `getState`, import, and export are request/response invocations.

| Bridge method/event | Main channel | Direction | Payload/result |
| --- | --- | --- | --- |
| `getState()` | `state:get` | invoke ? handle | Full Preferences plus runtime `activePresetId` |
| `updateState(patch)` | `state:update` | send ? on | Partial untrusted settings patch |
| `reportAccessibilityPreferences(preferences)` | `accessibility:preferences` | send ? on | Live `{reducedMotion,highContrast}` booleans; main accepts known CamFrame renderers and retains reduced motion only; not persisted |
| `onStateChanged(cb)` | `state:changed` | main ? renderer | Full state snapshot |
| `savePreset(name,id)` | `preset:save` | send ? on | Name and optional Scene ID |
| `applyPreset(id)` | `preset:apply` | send ? on | Scene ID |
| `deletePreset(id)` | `preset:delete` | send ? on | Scene ID |
| `reorderPreset(id,direction)` | `preset:reorder` | send ? on | Scene ID and numeric direction |
| `exportPresets()` | `preset:export` | invoke ? handle | `{canceled}` or `{canceled:false,count}` |
| `importPresets()` | `preset:import` | invoke ? handle | `{canceled}`, count, or error string |
| `setOverlayInteractive(bool)` | `overlay:interactive` | send ? on | Whole-window mouse acceptance |
| `setOverlaySettingsOpen(bool)` | `overlay:settings-open` | send ? on | `true` forces interactivity; `false` has no main-side action |
| `setOverlayOnboardingOpen(bool)` | `overlay:onboarding-open` | synchronous send ? on | Opens/closes the transient native top reserve; returns applied reserve px (`220` or `0`). `true` also shows/focuses the Overlay and forces interactivity |
| `completeOnboarding()` | `onboarding:complete` | send ? on | Persists the current onboarding version without clearing the active Scene |
| `startOverlayDrag()` / `stopOverlayDrag()` | `overlay:drag-start/stop` | send ? on | No payload |
| `startOverlayResize(handle)` / `stopOverlayResize()` | `overlay:resize-start/stop` | send ? on | One of four corner tokens |
| `toggleFullscreen()` / `exitFullscreen()` | `overlay:fullscreen-toggle/exit` | send ? on | No payload |
| `onFullscreenChanged(cb)` | `fullscreen:changed` | main ? renderer | Boolean |
| `onShowControls(cb)` | `controls:show` | main ? renderer | No payload |
| `onShowOnboarding(cb)` | `onboarding:show` | main ? renderer | No payload; tray Help requests the guide |
| `onPresentationNotice(cb)` | `presentation:notice` | main ? renderer | Message string, max 80 chars |
| `quit()` | `app:quit` | send ? on | Marks quitting and exits |

Callback registration returns an unsubscribe function. Current renderer code registers these for the page lifetime and relies on page destruction rather than invoking the returned functions.

## Window definitions

### Overlay BrowserWindow

- Initial bounds: computed outer Overlay bounds and restored/fallback position.
- `show:false`, frameless, transparent, non-resizable, movable, non-minimizable/maximizable, non-fullscreenable, taskbar-skipped, no shadow.
- Transparent background and disabled background throttling.
- Context isolation and sandbox enabled; Node integration disabled.

There is no separate settings BrowserWindow. Tray and shortcut control entry points show the Overlay and emit `controls:show` so Inline settings opens there.
