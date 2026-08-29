# Architecture

## System shape

CamFrame is a single-process Electron application with sandboxed renderer processes. The Electron main process owns all native/window state and persistence. The Overlay renderer owns camera capture and interaction state. A context-isolated preload is the only renderer-to-main bridge.

```text
global shortcuts / tray
          │
          ▼
  Electron main process ───── preferences.json
  src/main.js                  per-user local file
     │        ▲
 IPC │        │ state/fullscreen/onboarding/accessibility/notices
     ▼        │
  preload.cjs bridge
     │
     ▼
  Overlay renderer ───────── navigator.mediaDevices
  overlay.html/js/css          one MediaStream, one or two <video>s
```

## Module and caller map

| Module | Owns | Direct callers / consumers |
| --- | --- | --- |
| `src/main.js` | App lifecycle, Preferences I/O, Overlay definition, tray/Help, global shortcuts, native bounds/z-order, reduced-motion-aware drag/resize/fullscreen animations, onboarding completion, Scene operations, IPC | Electron entry point from `package.json` |
| `src/preload.cjs` | `window.camFrame` API and event subscriptions | Loaded by the Overlay BrowserWindow |
| `src/overlay.js` | Camera acquisition, device enumeration, render state, hover/interactivity, direct camera framing, onboarding, Inline settings and Scene UI | `overlay.html`; imports `cameras.js`, `fullscreen.js`, `onboarding.js`, and selected `settings.js` helpers |
| `src/overlay.html` / `.css` | Reachable UI semantics and visual implementation | Loaded by the Overlay BrowserWindow; can render in a browser with the QA fallback |
| `src/settings.js` | Defaults, sanitization, Scene snapshots/merge/reorder, camera and window geometry, region calculations | Main imports most state/geometry helpers; Overlay imports pan/zoom helpers; tests import pure contracts |
| `src/cameras.js` | Capture constraints, track profile application, device option normalization, stream reuse check | Overlay and tests |
| `src/fullscreen.js` | Fullscreen copy/input, toolbar hotspot, z-order level, transition plan/interpolation | Main, Overlay, and tests |
| `src/onboarding.js` | Current onboarding version, migration/show predicates, bounded step navigation, platform permission copy, and coach-mark target/reveal content | Main, Overlay, Settings, and tests |
| `test/settings.test.js` | Pure unit tests plus static source/markup/CSS contract assertions | `npm test` / CI |
| `scripts/electron-smoke.mjs` | Windows-scoped real Electron lifecycle, preload/IPC, synthetic-camera, Full screen/profile, accessibility-emulation, and screenshot smoke | `npm run test:electron` / Windows CI; uses main-process-only `CAMFRAME_E2E*` environment hooks |
| `.github/workflows/build-desktop.yml` | Tagged Windows/macOS build and GitHub release | Manual dispatch or `v*` tag |

## State ownership

### Main-process persisted state

`settings` is the authoritative Preferences object. Every renderer patch passes through `sanitizeSettings()`. The main process applies native effects, emits the full state to renderers, refreshes the tray, and schedules persistence.

`activePresetId` is runtime-only. It identifies the most recently saved/applied Scene for the UI and tray. Any ordinary settings patch clears it.

`completedOnboardingVersion` is global persisted state excluded from Scenes. A dedicated completion IPC path updates it without clearing `activePresetId` or reapplying Overlay geometry.

### Main-process transient state

- Overlay/Tray object references.
- Mouse interactivity flag.
- Global-cursor drag/resize timers and start snapshots.
- Full screen flag, remembered compact bounds, bounds-animation target/callback/timer, transition flag, and live renderer-reported reduced-motion boolean.
- Onboarding-layout flag used to normalize the temporary 220 px native top reserve back to compact-base coordinates.
- Preferences write timer.

### Overlay-renderer transient state

- Active MediaStream and requested/actual camera IDs.
- Monotonic request numbers that discard stale camera/device results.
- Full screen, hovered, interactive, dragging, resizing, framing, settings-open, and active crop-drag state.
- Serialized Promise chain for camera-quality updates.
- Selected Scene ID and notice/hover timers.
- Onboarding open/step/camera-known/auto-offered state, current highlighted target, dynamic coach-mark placement, optional focus-return element, and live-demo type/snapshot/timers/intervals/animations.
- Live reduced-motion, forced-colors, and increased-contrast media queries reflected as Overlay data attributes.

## Startup sequence

1. Electron becomes ready and hides the macOS Dock icon when available.
2. Main loads JSON Preferences, applies the one legacy migration, sanitizes, then forces startup visibility and topmost to `true`.
3. Packaged builds apply Start at login.
4. IPC handlers and Overlay-only media permission handlers are registered.
5. Main creates the transparent Overlay and tray.
6. Global shortcuts are registered without checking or reporting registration success.
7. When Overlay is ready, main emits state/fullscreen state and shows it without focus.
8. Overlay reflects live accessibility media queries, reports reduced motion to main, requests state, starts the saved/default camera, and enumerates devices locally.
9. After camera startup reaches a working or error state, Overlay offers onboarding when the persisted completed version is older than the current onboarding version.

Existing Preferences documents without the schema-12 onboarding field are treated as completed. Missing/invalid Preferences use the default incomplete version and follow the new-install path.

## State update flow

```text
Overlay interaction
  → preload `state:update` send
  → main merges patch and sanitizes the entire Preferences object
  → native bounds/z-order/visibility update as needed
  → `state:changed` full snapshot to live renderers
  → tray rebuild
  → debounced Preferences write (120 ms)
```

There is no optimistic main-process state. The Overlay sometimes updates local framing styles immediately for smooth pan/zoom, then converges on the emitted sanitized state.

Onboarding completion is a narrow exception to the general renderer patch flow: main writes only the current onboarding version, emits state, and schedules persistence. Reopening Help is transient and does not change completion state.

Onboarding step rendering is contextual. Opening the guide performs a synchronous IPC handshake: main expands the transparent native Overlay 220 px upward and returns that reserve, then the renderer offsets all ordinary content down by 220 px in the same JavaScript task. Their screen coordinates therefore stay fixed while the coach mark uses the new space 12 px above the Toolbar. Every step first paints with the standard Toolbar and no demonstrated feature open. Camera and Scenes schedule a guarded 80 ms task that selects the matching section and opens Inline settings; stale callbacks no-op when the guide closes or its step/reveal token changes. When opened, Inline settings starts another 12 px below the 44 px Toolbar at its normal screen position.

Shape and framing schedule guarded live demonstrations after 320 ms unless reduced motion is requested. The renderer owns an `aria-hidden`, pointer-transparent ghost mouse plus all demo timers, intervals, and Web Animations. Shape invokes three normal state patches. Framing updates local crop/zoom continuously and commits at phase boundaries or handoff. Hover/focus/interaction clears automation and its starting snapshot, adopting the current state. Back/Next/dismissal restores the snapshot only when the user did not take over, then clears all demo resources. Escape exits active framing before a subsequent Escape may dismiss the guide.

## Accessibility preference coordination

Overlay owns the browser media-query listeners. It combines `forced-colors: active` and `prefers-contrast: more` into `data-high-contrast`, reflects `prefers-reduced-motion: reduce` as `data-reduced-motion`, and sends the two booleans through the preload bridge. CSS responds directly to those attributes, so changes do not wait for a main-process round trip.

Main accepts accessibility messages only from a known CamFrame renderer and retains only reduced motion. The pure Overlay-bounds transition plan returns 280 ms normally or zero duration under reduced motion. A zero-duration request sets exact final bounds and runs the normal completion path synchronously; a live switch to reduced motion finishes any current target/callback. This single path covers Full screen and visible compact Scene applications. Nothing is persisted or added to Scene snapshots.

Main normalizes transient enlarged bounds before centering, resizing, saving a Scene, or deriving new Overlay geometry. Closing onboarding synchronously shrinks the native window and removes the renderer offset without persisting the reserve. Camera geometry and persisted Camera/Scene values are not patched by tour transitions.

## Camera flow

1. Overlay computes constraints from camera ID and the single Camera quality resolution setting.
2. `getUserMedia()` requests one video stream and no audio.
3. `OverconstrainedError` retries with no 30 fps minimum.
4. A stale async result is stopped instead of installed.
5. The primary `<video>` receives the stream and begins playback. The track receives `contentHint = 'motion'` where supported.
6. Progressive blur conditionally attaches the same stream to the second video; other effects detach and pause it.
7. Enumeration after capture obtains permission-revealed labels and renders normalized device options locally.

Mode changes do not touch the track profile. A Camera quality change appends one `applyConstraints()` operation to a Promise chain so rapid user changes settle in order. Failures are swallowed and preserve the working profile.

## Native Overlay interaction

The BrowserWindow starts with ignored mouse events and forwarded movement. Renderer hover logic sends `overlay:interactive`, which makes the whole outer window accept or ignore input. Compact hide delay is 220 ms; Full screen toolbar delay is 200 ms.

Dragging and resizing are main-process operations because the renderer cannot directly control native screen coordinates:

- drag captures the cursor-to-window offset and calls `setPosition()` every 16 ms;
- resize snapshots cursor, bounds, and settings, computes an aspect-preserving patch every 16 ms, sanitizes it, applies bounds without recentering, and emits state;
- the asynchronous native `moved` event persists compact position, but Scene save synchronously snapshots current bounds to avoid event lag.

`settings.js` contains native-region generation helpers, but main does not import or apply them. CSS clips the visible camera shapes. See `known-gaps.md` before changing input-region behavior.

## Full screen coordination

Main and Overlay coordinate, but neither uses Electron native fullscreen:

- Main remembers compact bounds, derives the matching display bounds, forces visible/topmost/focus, emits the mode, and interpolates `x/y/width/height` every 16 ms for 280 ms, or applies final bounds immediately under reduced motion.
- Overlay receives the mode, switches CSS data attributes, updates button copy, closes settings, controls toolbar visibility, and disables geometry transitions under reduced motion. It does not renegotiate the camera track.
- Exit reverses the bounds animation and only then restores requested visibility and topmost behavior.
- `before-input-event` in main and renderer key handling both recognize Escape, providing a native-side fallback.

## Scene flow

Scene writes and imports run in main so file dialogs and Preferences remain privileged. Renderers only send IDs/names or invoke import/export. Applying a visible compact Scene emits visual state before transitioning native bounds, allowing CSS surface geometry and BrowserWindow movement to change together; both complete immediately under reduced motion.

## Packaging and release flow

`npm ci` restores the exactly pinned lockfile. `npm test` runs before each CI platform build; Windows also runs the Playwright Electron smoke and uploads its screenshots. Electron Builder creates Windows x64 NSIS/portable outputs and macOS arm64/x64 DMG/ZIP outputs. A tag beginning with `v` makes the release job merge artifacts and create a GitHub release. Code signing discovery is disabled; the macOS identity is explicitly null.

## Architectural constraints worth preserving

- Main owns all native and filesystem capabilities.
- Renderer input is untrusted and sanitized as a full settings snapshot.
- Camera frames stay in native video elements; no canvas/frame-copy loop is part of the retained design.
- Compact and Full screen use one stable Camera quality profile; Full screen and Scene transitions reuse the camera stream without applying track constraints.
- Temporary presentation state is distinct from reusable Scene state.
- Direct manipulation owns Overlay size/position and camera framing; settings do not duplicate Size/Zoom sliders.
- `presets` remains the storage key even though the product term is Scene.
