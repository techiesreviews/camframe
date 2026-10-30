# Data and interface contracts

## Preferences schema

Preferences are the only durable application state. `sanitizeSettings()` always starts from defaults, selectively accepts known values, deep-copies nested objects, and drops unknown keys. The current schema version is 13.

The executable form of this section is `test/fixtures/preferences/`: `sanitize.json`, `load.json`, and `scene-import.json` hold input/expected cases that any implementation of Preferences must pass (ADR 0030). Their `README.md` describes the format. Strings are measured in UTF-16 code units and numbers round half away from zero. When this section and the fixtures disagree, the fixtures and source are the current behavior.

| Field | Default | Accepted/sanitized value | Persisted | In Scene |
| --- | --- | --- | --- | --- |
| `schemaVersion` | `13` | Always current default; input is not copied | Yes | No |
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
| `prompterLink` | `false` | Boolean; the Prompter link listens only while `true` | Yes | No |
| `prompterFaceFull` | `"fullscreen"` | `fullscreen` or `scene:<Scene id>` (id 1–64 characters) | Yes | No |
| `prompterFaceSmall` | `"previous"` | `previous`, a place (`top-left`, `top-right`, `bottom-left`, `bottom-right`, `left`, `right`, `center`), or `scene:<Scene id>` | Yes | No |
| `prompterMargin` | `32` | Finite number rounded/clamped 0–160 (px from the camera surface to the work-area edge) | Yes | No |
| `presets` | `[]` | Up to six valid Scene records | Yes | No (no nesting) |

Colors retain input case in persisted state when accepted. The live hex text editors send lowercase; the UI renders uppercase text. Numbers are sanitized even when the corresponding control is not currently visible.

### Startup override

`preferencesFromDocument(text)` turns the raw file text (undefined when missing) into launch settings. It applies the legacy migrations below, sanitizes, then always sets `alwaysOnTop` and `overlayVisible` to `true`. Missing files, invalid JSON, and non-object documents start a new installation. The stored values can change during a session and are written, but false values are intentionally not restored on launch.

The integration harness is the only exception to the normal user-data path: in an unpackaged build, when `CAMFRAME_E2E=1` and `CAMFRAME_E2E_USER_DATA_DIR` is absolute, main selects that isolated directory before reading Preferences and enables Chromium's synthetic video device/permission switches. These process-environment hooks are not exposed through preload, persisted, or honored by packaged launches.

### Legacy migration

Before sanitization, a loaded document with `schemaVersion < 3` receives `borderWidth = 0` and `size = 288`. A successfully loaded Preferences document without `completedOnboardingVersion` receives the current onboarding version so existing users are not interrupted. A missing or invalid Preferences document retains the default version 0. Explicit saved version 0 remains incomplete across restart. Legacy `fullscreenResolution` values are ignored; `overlayResolution` becomes the one retained Camera quality. Other fields continue to rely on defaults and sanitization for forward compatibility.

Schema 13 added the four `prompter*` fields. Older documents load with their defaults, so the link stays off until the user turns it on.

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
3. A non-match appends if fewer than six local Scenes exist. Because ID matches are found first, an appended Scene's ID never collides. The former `imported-{slot}-` renaming branch was unreachable and was removed.
4. Unrelated local Scenes are retained; import never performs a full replacement.

The import result count is the number of valid imported input records, not necessarily the number appended or changed.

## Camera constraints

Resolution mapping:

| Token | Ideal dimensions |
| --- | --- |
| `480p` | 854?480 |
| `720p` | 1280?720 |
| `1080p` | 1920?1080 |
| `2160p` | 3840?2160 |

`cameraConstraintsFor(id, options)` returns `{audio:false, video:{...}}`; non-empty IDs become `{deviceId:{exact:id}}`. The chosen Camera quality is used in Compact mode and Full screen with minimum 30 fps unless retrying slower, plus optional advanced sets that prefer the requested size at 50 fps or faster, then the requested size, then 50 fps or faster. No constraint set contains a frame-rate ideal, maximum, or exact value because Chromium would discard early frames (ADR 0028). These dimensions are preferences, not guarantees; browsers and drivers may choose another supported profile. Mode changes never apply new track constraints.

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

`BRIDGE_CONTRACT` in `src/bridge.js` is the single list of these channels. Main registers one handler per entry and refuses to start if its handlers drift from the list. Every renderer→main channel accepts only the Overlay renderer and checks its arguments first: `send` messages with invalid arguments are dropped, `invoke` calls reject, and `sendSync` returns the entry's `rejected` value (`0` for the onboarding reserve). `updateState` patches must be plain objects and lose `presets`, `completedOnboardingVersion`, and `schemaVersion`, so a renderer can change those only through Scene and onboarding operations. `reorderPreset` requires a finite direction, `startOverlayResize` a string handle, and Scene names/IDs are coerced to strings. The sandboxed preload cannot import the contract; `test/bridge.test.js` runs `preload.cjs` against a fake Electron and checks every method's channel and transport.

| Bridge method/event | Main channel | Direction | Payload/result |
| --- | --- | --- | --- |
| `getState()` | `state:get` | invoke ? handle | Full Preferences plus runtime `activePresetId` and `prompterLinkStatus` `{state,port,message}` (`state`: `off`, `starting`, `on` or `error`) |
| `updateState(patch)` | `state:update` | send ? on | Partial untrusted settings patch |
| `reportAccessibilityPreferences(preferences)` | `accessibility:preferences` | send ? on | Live `{reducedMotion,highContrast}` booleans; main retains reduced motion only; not persisted |
| `onStateChanged(cb)` | `state:changed` | main ? renderer | Full state snapshot, the same shape as `getState()` (with `activePresetId` and `prompterLinkStatus`) |
| `savePreset(name,id)` | `preset:save` | send ? on | Name and optional Scene ID |
| `applyPreset(id)` | `preset:apply` | send ? on | Scene ID |
| `deletePreset(id)` | `preset:delete` | send ? on | Scene ID |
| `reorderPreset(id,direction)` | `preset:reorder` | send ? on | Scene ID and numeric direction |
| `exportPresets()` | `preset:export` | invoke ? handle | `{canceled}` or `{canceled:false,count}` |
| `importPresets()` | `preset:import` | invoke ? handle | `{canceled}`, count, or error string |
| `setOverlayInteractive(bool)` | `overlay:interactive` | send ? on | Whole-window mouse acceptance |
| `setOverlaySettingsOpen(bool)` | `overlay:settings-open` | send ? on | `true` forces interactivity; `false` has no main-side action |
| `setOverlayOnboardingOpen(bool)` | `overlay:onboarding-open` | synchronous send ? on | Opens/closes the transient native top reserve; returns applied reserve px (`220` or `0`). The reserve opens only in settled Compact mode and closes in every mode. `true` also shows/focuses the Overlay and forces interactivity |
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

## Prompter link HTTP contract

Served by `src/prompter-link.js` only while `prompterLink` is `true`, on `http://127.0.0.1:47833` (never another interface). ADR 0031 records the decision.

| Request | Answer |
| --- | --- |
| `GET /camframe/status` | `200 {"app":"camframe","version":"<app version>","scenes":["<Scene name>", …]}` |
| `POST /camframe/cue`, `Content-Type: application/json`, body ≤ 1024 bytes | `200 {"ok":true,"cue":{…}}` after applying it; `400 {"ok":false,"error":…}` for a malformed cue; `404` for an unknown Scene; `413` too large; `415` not JSON |
| `OPTIONS` (CORS preflight) | `204` with `Access-Control-Allow-Origin: <origin>`, `-Methods: GET, POST`, `-Headers: Content-Type`, `-Max-Age: 600`, and `Access-Control-Allow-Private-Network: true` when the request asks for it (Chrome Private Network Access) |
| Wrong method / other path | `405` with `Allow` / `404` |
| `Host` other than `127.0.0.1:47833` or `localhost:47833` | `403` (DNS-rebinding guard) |
| `Origin` other than `https://prompter.techies.tools`, `http://localhost[:port]`, `http://127.0.0.1[:port]`, or `null` | `403`, no CORS headers. A request without `Origin` (a local program) is allowed. |

A cue is a JSON object with only these fields: `size` (`"full"` or `"small"`), `position` (one of the seven places, only with `"small"`), and `scene` (a Scene name, 1–40 characters after trimming; no `position`; `size` absent or `"small"`). It needs `size` or `scene`. Anything else is a `400`. What a valid cue does follows `prompterFaceFull`, `prompterFaceSmall`, and `prompterMargin` (`cueAction()` and `compactPositionAt()`; see the product specification).

## Window definitions

### Overlay BrowserWindow

- Initial bounds: computed outer Overlay bounds and restored/fallback position.
- `show:false`, frameless, transparent, non-resizable, movable, non-minimizable/maximizable, non-fullscreenable, taskbar-skipped, no shadow.
- Transparent background and disabled background throttling.
- Context isolation and sandbox enabled; Node integration disabled.

There is no separate settings BrowserWindow. Tray and shortcut control entry points show the Overlay and emit `controls:show` so Inline settings opens there.
