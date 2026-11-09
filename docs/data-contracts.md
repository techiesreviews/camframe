# Data and interface contracts

## Preferences schema

Preferences are the only durable application state. `sanitizeSettings()` always starts from defaults, selectively accepts known values, deep-copies nested objects, and drops unknown keys. The current schema version is 15.

The executable form of this section is `test/fixtures/preferences/`: `sanitize.json`, `load.json`, and `scene-import.json` hold input/expected cases that any implementation of Preferences must pass (ADR 0030). Their `README.md` describes the format. Strings are measured in UTF-16 code units and numbers round half away from zero. When this section and the fixtures disagree, the fixtures and source are the current behavior.

| Field | Default | Accepted/sanitized value | Persisted | In Scene |
| --- | --- | --- | --- | --- |
| `schemaVersion` | `15` | Always current default; input is not copied | Yes | No |
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
| `sceneView` | `"grid"` | `grid` or `list`: how the Scenes tab shows Scenes (ADR 0037) | Yes | No |
| `completedOnboardingVersion` | `0` | Finite number rounded/clamped 0?1 | Yes | No |
| `position` | `null` | `null` or integer `{x,y}` in screen coordinates | Yes | Yes |
| `prompterLink` | `false` | Boolean; the Prompter link listens only while `true` | Yes | No |
| `prompterFaceFull` | `"fullscreen"` | `fullscreen` or `scene:<Scene id>` (id 1–64 characters) | Yes | No |
| `prompterFaceSmall` | `"previous"` | `previous`, a place (`top-left`, `top-right`, `bottom-left`, `bottom-right`, `left`, `right`, `center`), or `scene:<Scene id>` | Yes | No |
| `prompterMargin` | `32` | Finite number rounded/clamped 0–160 (px from the camera surface to the work-area edge) | Yes | No |
| `prompterSmallSize` | `size` | Finite number rounded/clamped 180–640; missing or not a number means the sanitized `size`. The camera size a Prompter link `"small"` cue restores. Set by resizing the Overlay by hand (a held corner reports no resize until the pointer moves) and by `POST /camframe/small-size`; Scenes and Prompter cues never change it. Renderer patches may not set it. | Yes | No |
| `presets` | `[]` (a loaded file: see the starters below) | Up to six valid Scene records | Yes | No (no nesting) |

Colors retain input case in persisted state when accepted. The live hex text editors send lowercase; the UI renders uppercase text. Numbers are sanitized even when the corresponding control is not currently visible.

### Startup override

`preferencesFromDocument(text)` turns the raw file text (undefined when missing) into launch settings. It applies the legacy migrations below, sanitizes, then always sets `alwaysOnTop` and `overlayVisible` to `true`. Missing files, invalid JSON, and non-object documents start a new installation. The stored values can change during a session and are written, but false values are intentionally not restored on launch.

The integration harness is the only exception to the normal user-data path: in an unpackaged build, when `CAMFRAME_E2E=1` and `CAMFRAME_E2E_USER_DATA_DIR` is absolute, main selects that isolated directory before reading Preferences and enables Chromium's synthetic video device/permission switches. These process-environment hooks are not exposed through preload, persisted, or honored by packaged launches.

### Legacy migration

Before sanitization, a loaded document with `schemaVersion < 3` receives `borderWidth = 0` and `size = 288`. A successfully loaded Preferences document without `completedOnboardingVersion` receives the current onboarding version so existing users are not interrupted. A missing or invalid Preferences document retains the default version 0. Explicit saved version 0 remains incomplete across restart. Legacy `fullscreenResolution` values are ignored; `overlayResolution` becomes the one retained Camera quality. Other fields continue to rely on defaults and sanitization for forward compatibility.

Schema 13 added the four `prompter*` fields. Older documents load with their defaults, so the link stays off until the user turns it on.

Schema 15 (ADR 0037) removed `launchAtLogin` (an old file still loads; the field is ignored and dropped at the next save, and a packaged build turns the old login item off once when it was `true`, `legacyLaunchAtLogin()`), added `sceneView`, and gives a new installation and a document below schema 15 without valid Scenes the two starter layout Scenes (`STARTER_SCENES`): `starter-small-bottom` "Small bottom" `{size: 288, position: "bottom-right"}` and `starter-big-right` "Big right" `{size: 540, position: "right"}`. A document with Scenes keeps exactly those; from schema 15 on an empty `presets` stays empty. The Prompter link fields keep their values and defaults although their controls are gone.

Schema 14 added `prompterSmallSize` and the optional Scene `layout`. A document without `prompterSmallSize` loads with its own `size`, so an upgrade keeps the user's compact size as the small size. An older CamFrame build does not read either field, so a layout Scene opens there as an ordinary Scene with its saved size and position; and the first time that build saves its Preferences it drops both fields, because its sanitizer rebuilds each Scene as `{ id, name, settings }` and knows no `prompterSmallSize`. Opened in API 2 again, those layout Scenes stay ordinary (snapshot) Scenes and the small size starts again from `size` (KG-14).

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

A **layout Scene** (saved through the Prompter link, ADR 0035) also has `layout`:

```json
{ "id": "preset-mw20pcij", "name": "Live right large", "settings": { "…": "as above, size 432, position {x:1438,y:220}" },
  "layout": { "size": 432, "position": "right", "withinRight": 0.3 } }
```

- `layout.size`: integer 180–640, or `"small"` (resolved from `prompterSmallSize` when applied), required. `layout.position`: optional place name. `layout.margin`: optional integer 0–160, only with a place. `layout.withinRight`: optional number 0.1–1, only with `right`, `top-right` or `bottom-right`. Any invalid part drops the whole `layout` (`sanitizeSceneLayout`), leaving an ordinary Scene.
- Applying a layout Scene (`applyScene` with the current display's work area) changes only `size` and `position`, planned by `planCompactLayout` with the live `shape` and `layout.margin ?? prompterMargin`; `withinRight` counts at least the 18 px of right chrome as the gap. Without a place it plans the layout size at its saved camera point on the display nearest that point (`workAreaAt`, Electron's `getDisplayNearestPoint`), shrinking and keeping it on screen there. Without a work area, or when even 180 px cannot fit, it uses `settings.size` and `settings.position` (kept inside the work area when one is known), reports the requested size and sets `clamped` to `true` when a work area was known (the Scene's rule could not be met). Camera, shape, appearance and framing stay live (`LOOK_SETTING_KEYS`).
- `settings` is still a full snapshot taken at save time, so export, import and older builds keep working.

- ID: non-empty string truncated to 64 characters. New IDs are `preset-` plus `Date.now().toString(36)`.
- Name: trimmed, non-empty string truncated to 40 characters.
- Settings: the exact ordered key list exported by `PRESET_SETTING_KEYS`; nested position objects are copied.
- Invalid records are dropped. Sanitization considers only the first six input records before filtering invalid ones, so invalid early records can reduce the resulting count.
- Reorder moves a Scene `direction` slots (truncated to an integer, kept inside the list); a zero, non-numeric or boundary move is a no-op.
- Save/update matches requested ID first, then case-insensitive name. A seventh new save drops the oldest Scene and keeps the newest six (the Scenes tab shows "Full" at six, so it never sends one).
- Rename (`renameScene`) changes only the name; an empty name, the same name or a missing Scene is a no-op, and a name another Scene has (case-insensitive) is refused with `{error: "name-taken"}`.
- **Autosave** (`followLiveLook`, ADR 0037): a hand change from the Overlay (`updateState` without `demo`, a corner resize, the end of a move-drag) writes each key of `FOLLOWED_SETTING_KEYS` (every Scene key except `cameraId`, `cameraLabel` and `overlayResolution`) that the change set and whose value differs from the active Scene into it, which stays active (a resize sets `size` and `position`, a drag `position`; a place the window was moved to by itself is not saved); a layout Scene, which stores no look, changes only when the hand change changed a followed value, and then becomes a snapshot of the live settings. An `updateState` that sets no followed key (the Scenes view, Always on top, the Prompter link) saves nothing. Prompter cues use `patchSettings`, which clears the active Scene; onboarding demo steps (`updateState(patch, {demo: true})`) are stored without touching the active Scene.
- Delete returns `deleted: {scene, index, wasActive}`; `restoreScene` puts it back at that index unless the library is full or its id or name is taken, and applies it (its look and place come back) when it was on camera and no other Scene is. `undoSceneChange` puts a Scene's look back from `createSceneEdits().takeChange()` (`{scene, look}`: the Scene as it went on camera and the live look then; a layout Scene also gets that live look back), keeps its current name, and applies it. The change window's starting point stays until another Scene goes on camera, the Scene is applied again, or it is saved over on purpose; the window itself lasts 10 s after the last change.

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
| `getState()` | `state:get` | invoke ? handle | Full Preferences plus runtime `activePresetId`, `prompterLinkStatus` `{state,port,message}` (`state`: `off`, `starting`, `on` or `error`), and the Scenes tab's `sceneUndo` (`{id, endsAt}` or `null`: Undo for the active Scene's changes, 10 s), `sceneDeleted` (`{id, name, index, endsAt}` or `null`: Undo for the last delete, 6 s), `sceneSaved` (`{id, at}` or `null`: the last Scene saved, for its check) and `scenePreviews` (`{live, scenes: {id: rect}}`, each rect the camera surface as shares 0–1 of its display's bounds; `null` before the window exists). Times are `Date.now()` milliseconds (ADR 0037) |
| `updateState(patch, options)` | `state:update` | send ? on | Partial untrusted settings patch; `options.demo` (boolean) marks an onboarding demo step that is never saved into the active Scene (ADR 0037) |
| `reportAccessibilityPreferences(preferences)` | `accessibility:preferences` | send ? on | Live `{reducedMotion,highContrast}` booleans; main retains reduced motion only; not persisted |
| `onStateChanged(cb)` | `state:changed` | main ? renderer | Full state snapshot, the same shape as `getState()` (with `activePresetId` and `prompterLinkStatus`) |
| `savePreset(name,id)` | `preset:save` | send ? on | Name and optional Scene ID |
| `applyPreset(id)` | `preset:apply` | send ? on | Scene ID |
| `deletePreset(id)` | `preset:delete` | send ? on | Scene ID |
| `reorderPreset(id,direction)` | `preset:reorder` | send ? on | Scene ID and the number of slots to move (negative is up) |
| `renamePreset(id,name)` | `preset:rename` | send ? on | Scene ID and new name; keeps the look |
| `undoPresetChange()` | `preset:undo-change` | send ? on | No payload; main checks the active Scene's 10 s window |
| `undoPresetDelete()` | `preset:undo-delete` | send ? on | No payload; main checks the last delete's 6 s window |
| `exportPresets()` | `preset:export` | invoke ? handle | `{canceled}` or `{canceled:false,count}`; the Export button shows the result, no notice |
| `importPresets()` | `preset:import` | invoke ? handle | `{canceled}`, count, or error string |
| `setOverlayInteractive(bool)` | `overlay:interactive` | send ? on | Whole-window mouse acceptance |
| `setOverlaySettingsOpen(bool)` | `overlay:settings-open` | send ? on | `true` forces interactivity; `false` has no main-side action |
| `setOverlayOnboardingOpen(bool)` | `overlay:onboarding-open` | synchronous send ? on | Opens/closes the transient native top reserve; returns applied reserve px (`220` or `0`). The reserve opens only in settled Compact mode and closes in every mode. `true` also shows/focuses the Overlay and forces interactivity |
| `completeOnboarding()` | `onboarding:complete` | send ? on | Persists the current onboarding version without clearing the active Scene |
| `startOverlayDrag()` / `stopOverlayDrag()` | `overlay:drag-start/stop` | send ? on | No payload; stopping a drag that ran saves the new place into the active Scene |
| `startOverlayResize(handle)` / `stopOverlayResize()` | `overlay:resize-start/stop` | send ? on | One of four corner tokens |
| `toggleFullscreen()` / `exitFullscreen()` | `overlay:fullscreen-toggle/exit` | send ? on | No payload |
| `onFullscreenChanged(cb)` | `fullscreen:changed` | main ? renderer | Boolean |
| `onShowControls(cb)` | `controls:show` | main ? renderer | No payload |
| `onShowOnboarding(cb)` | `onboarding:show` | main ? renderer | No payload; tray Help requests the guide |
| `onPresentationNotice(cb)` | `presentation:notice` | main ? renderer | Message string, max 80 chars |
| `onSceneAnnouncement(cb)` | `scene:announce` | main ? renderer | Scene name, max 80 chars, for the hidden screen-reader region only (ADR 0036); sent each time a Scene is applied or saved |
| `quit()` | `app:quit` | send ? on | Marks quitting and exits |

Callback registration returns an unsubscribe function. Current renderer code registers these for the page lifetime and relies on page destruction rather than invoking the returned functions.

## Prompter link HTTP contract

Served by `src/prompter-link.js` only while `prompterLink` is `true`, on `http://127.0.0.1:47833` (never another interface). ADR 0031 records the link, ADR 0035 API 2. `docs/prompter-link-api.md` has real payloads and the livestream cues.

| Request | Answer |
| --- | --- |
| `GET /camframe/status` | `Origin: null` gets only `app`, `version`, `scenes`, `api`. Others: `200` with `app`, `version`, `scenes` (names; unchanged since ADR 0031), and since API 2: `api` (`2`), `sceneLimit` (6), `smallSize`, `margin`, `activeScene` (name or `null`), `view` (`null` before the window exists, else `{mode: "compact"\|"fullscreen", visible, settled, size, shape, camera, window, workArea}`; `camera`, `window` and `workArea` are where the window is heading, `settled` is false during its animation), `look` (`LOOK_SETTING_KEYS` without `cameraId`, plus `signature`, the first 16 hex of SHA-256 over all of them including `cameraId`), `sceneDetails` (`{id, name, kind: "layout"\|"snapshot", size, followsSmallSize? (layout only), position (a place name, else the camera's top-left point), margin?, withinRight?, savedSize, savedPosition, keepsLiveLook, look?}`; `look` only for snapshot Scenes) |
| `POST /camframe/cue` | `200 {"ok":true,"cue":{…},"layout"?:{size,requestedSize,clamped},"view":{…}}` (only `ok` and `cue` for `Origin: null`); `400 bad-request`; `404 unknown-scene`; `422 does-not-fit`; `503 not-ready` |
| `POST /camframe/scenes` | `200 {"ok":true,"scene":{sceneDetail},"replaced":bool,"saved":{size,requestedSize,clamped,camera,workArea},"layout"?,"view"?}`; `400 bad-request`; `403` for `Origin: null` (file:// copies, sandboxed frames); `409 scene-exists` or `scene-limit`; `422 does-not-fit`; `503 not-ready` |
| `POST /camframe/small-size` | `200 {"ok":true,"smallSize":n}`; `400 bad-request`; `403` for `Origin: null` |
| Any `POST` | `Content-Type: application/json`, body ≤ 1024 bytes; `413` too large; `415` not JSON; `400` invalid JSON |
| `OPTIONS` (CORS preflight) | `204` with `Access-Control-Allow-Origin: <origin>`, `-Methods: GET, POST`, `-Headers: Content-Type`, `-Max-Age: 600`, and `Access-Control-Allow-Private-Network: true` when the request asks for it (Chrome Private Network Access) |
| Wrong method / other path | `405` with `Allow` / `404` |
| `Host` other than `127.0.0.1:47833` or `localhost:47833` | `403` (DNS-rebinding guard) |
| `Origin` other than `https://prompter.techies.tools`, `http://localhost[:port]`, `http://127.0.0.1[:port]`, or `null` | `403`, no CORS headers. A request without `Origin` (a local program) is allowed. |

Refusals are `{"ok":false,"error":"…","code":"…"}`; the transport errors (`403`, `404` path, `405`, `413`, `415`, invalid JSON) have no `code`.

A cue is a JSON object with only `size`, `position`, `scene`, `margin` and `withinRight` (`parseCue`):

- `size`: `"full"`, `"small"`, or an integer 180–640. `position`: one of the seven places or `{x, y}` (exactly those two integer keys, |value| ≤ 100000; the camera surface's top-left), only with `"small"` or a number. `margin`: integer 0–160, only with a place. `withinRight`: number 0.1–1, only with `right`, `top-right` or `bottom-right`.
- `scene`: a Scene name, 1–40 characters after trimming; `size` absent or `"small"`; nothing else. It needs `size` or `scene`.
- `cueAction()` decides: `"small"` always means `prompterSmallSize`. A `"small"` or numeric cue with a position, and any numeric cue, is `place` (planned by `planCompactLayout`: a place name on the display the Overlay is on or heading to, a point on the display nearest it, and a bare size on the display of the place the camera keeps, which from Full screen is where Full screen returns to; margin `margin ?? prompterMargin` for a place, else 0; without a position it keeps the current or Full-screen-return centre). A bare `"small"` follows `prompterFaceSmall` (a Scene, a place at the small size, or `previous`: leave Full screen to the previous place at the small size, or in Compact mode resize to it around the current centre). `"full"` follows `prompterFaceFull`.

A Scene request (`parseSceneSave`) has only `name` (1–40 after trimming, no line breaks, control or invisible characters (zero-width space, soft hyphen, word joiner, byte order mark, filler); joiners U+200C and U+200D, variation selectors and emoji tags are allowed; joiners may not start or end a name; names match case-insensitively, across composed and decomposed accents, and ignoring joiners, variation selectors and emoji tags), `size` (`"small"`, `"current"` or 180–640; default `"current"`), `position` (place, `{x,y}` or `"current"`; default `"current"`), `margin`, `withinRight` (as for a cue), `replace` and `apply` (booleans, default `false`). It stores `layout.size` as asked (`"small"` stays `"small"`; a number is kept unclamped), `layout.position` only for a place, and `settings` as the live settings at the planned size and window position. `saveLayoutScene` refuses a new name at `SCENE_LIMIT` and an existing name (case-insensitive) without `replace`; replacing keeps the id and order, and every other Scene is left unchanged.

A small-size request (`parseSmallSize`) has only `size`: `"current"` or 180–640.

## Window definitions

### Overlay BrowserWindow

- Initial bounds: computed outer Overlay bounds and restored/fallback position.
- `show:false`, frameless, transparent, non-resizable, movable, non-minimizable/maximizable, non-fullscreenable, taskbar-skipped, no shadow.
- Transparent background and disabled background throttling.
- Context isolation and sandbox enabled; Node integration disabled.

There is no separate settings BrowserWindow. Tray and shortcut control entry points show the Overlay and emit `controls:show` so Inline settings opens there.
