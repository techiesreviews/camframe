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
 IPC │        │ state/devices/errors/fullscreen/notices
     ▼        │
  preload.cjs bridge
     │
     ▼
  Overlay renderer ───────── navigator.mediaDevices
  overlay.html/js/css          one MediaStream, one or two <video>s

  Dormant Controller renderer
  control.html/js/css          implemented but never instantiated in v0.4.3
```

## Module and caller map

| Module | Owns | Direct callers / consumers |
| --- | --- | --- |
| `src/main.js` | App lifecycle, Preferences I/O, Overlay/Controller definitions, tray, global shortcuts, native bounds/z-order, drag/resize/fullscreen animations, Scene operations, IPC | Electron entry point from `package.json` |
| `src/preload.cjs` | `window.camFrame` API and event subscriptions | Loaded by both BrowserWindow definitions; live use is Overlay only |
| `src/overlay.js` | Camera acquisition, device enumeration, render state, hover/interactivity, direct camera framing, Inline settings and Scene UI | `overlay.html`; imports `cameras.js`, `fullscreen.js`, selected `settings.js` helpers |
| `src/overlay.html` / `.css` | Reachable UI semantics and visual implementation | Loaded by the Overlay BrowserWindow; can render in a browser with the QA fallback |
| `src/control.js` | Dormant Controller rendering and controls | `control.html` only; requires preload API |
| `src/control.html` / `.css` | Dormant separate settings UI | Defined for `createControlWindow()`, which has no caller |
| `src/settings.js` | Defaults, sanitization, Scene snapshots/merge/reorder, camera and window geometry, region calculations | Main imports most state/geometry helpers; Overlay imports pan/zoom helpers; tests import pure contracts |
| `src/cameras.js` | Capture constraints, track profile application, device option normalization, stream reuse check | Overlay and tests |
| `src/fullscreen.js` | Fullscreen copy/input, toolbar hotspot, z-order level, transition plan/interpolation | Main, Overlay, and tests |
| `test/settings.test.js` | Pure unit tests plus static source/markup/CSS contract assertions | `npm test` / CI |
| `.github/workflows/build-desktop.yml` | Tagged Windows/macOS build and GitHub release | Manual dispatch or `v*` tag |

## State ownership

### Main-process persisted state

`settings` is the authoritative Preferences object. Every renderer patch passes through `sanitizeSettings()`. The main process applies native effects, emits the full state to renderers, refreshes the tray, and schedules persistence.

`activePresetId` is runtime-only. It identifies the most recently saved/applied Scene for the UI and tray. Any ordinary settings patch clears it.

### Main-process transient state

- Overlay/Controller/Tray object references.
- Discovered camera list relayed from Overlay.
- Mouse interactivity flag.
- Global-cursor drag/resize timers and start snapshots.
- Full screen flag, remembered compact bounds, bounds-animation timer, and transition flag.
- Preferences write timer.

### Overlay-renderer transient state

- Active MediaStream and requested/actual camera IDs.
- Monotonic request numbers that discard stale camera/device results.
- Full screen, hovered, interactive, dragging, resizing, framing, settings-open, and active crop-drag state.
- Serialized Promise chain for camera-quality updates.
- Selected Scene ID and notice/hover timers.

## Startup sequence

1. Electron becomes ready and hides the macOS Dock icon when available.
2. Main loads JSON Preferences, applies the one legacy migration, sanitizes, then forces startup visibility and topmost to `true`.
3. Packaged builds apply Start at login.
4. IPC handlers and Overlay-only media permission handlers are registered.
5. Main creates the transparent Overlay and tray; it does not create the Controller.
6. Global shortcuts are registered without checking or reporting registration success.
7. When Overlay is ready, main emits state/fullscreen state and shows it without focus.
8. Overlay requests state, starts the saved/default camera, enumerates devices, and reports the device list to main.

## State update flow

```text
control interaction
  → preload `state:update` send
  → main merges patch and sanitizes the entire Preferences object
  → native bounds/z-order/visibility update as needed
  → `state:changed` full snapshot to live renderers
  → tray rebuild
  → debounced Preferences write (120 ms)
```

There is no optimistic main-process state. The Overlay sometimes updates local framing styles immediately for smooth pan/zoom, then converges on the emitted sanitized state.

## Camera flow

1. Overlay computes constraints from camera ID, current mode, and the corresponding resolution setting.
2. `getUserMedia()` requests one video stream and no audio.
3. `OverconstrainedError` retries with no compact-mode minimum frame rate.
4. A stale async result is stopped instead of installed.
5. The primary `<video>` receives the stream and begins playback. The track receives `contentHint = 'motion'` where supported.
6. Progressive blur conditionally attaches the same stream to the second video; other effects detach and pause it.
7. Enumeration after capture obtains permission-revealed labels and reports normalized devices to main.

Mode/resolution changes do not recreate the stream. They append an `applyConstraints()` operation to a Promise chain so rapid changes settle in order. Failures are swallowed and preserve the working profile.

## Native Overlay interaction

The BrowserWindow starts with ignored mouse events and forwarded movement. Renderer hover logic sends `overlay:interactive`, which makes the whole outer window accept or ignore input. Compact hide delay is 220 ms; Full screen toolbar delay is 200 ms.

Dragging and resizing are main-process operations because the renderer cannot directly control native screen coordinates:

- drag captures the cursor-to-window offset and calls `setPosition()` every 16 ms;
- resize snapshots cursor, bounds, and settings, computes an aspect-preserving patch every 16 ms, sanitizes it, applies bounds without recentering, and emits state;
- the asynchronous native `moved` event persists compact position, but Scene save synchronously snapshots current bounds to avoid event lag.

`settings.js` contains native-region generation helpers, but main does not import or apply them. CSS clips the visible camera shapes. See `known-gaps.md` before changing input-region behavior.

## Full screen coordination

Main and Overlay coordinate, but neither uses Electron native fullscreen:

- Main remembers compact bounds, derives the matching display bounds, forces visible/topmost/focus, emits the mode, and interpolates `x/y/width/height` every 16 ms for 280 ms.
- Overlay receives the mode, queues the matching camera track profile, switches CSS data attributes, updates button copy, closes settings, and controls toolbar visibility.
- Exit reverses the bounds animation and only then restores requested visibility and topmost behavior.
- `before-input-event` in main and renderer key handling both recognize Escape, providing a native-side fallback.

## Scene flow

Scene writes and imports run in main so file dialogs and Preferences remain privileged. Renderers only send IDs/names or invoke import/export. Applying a visible compact Scene emits visual state before animating native bounds, allowing CSS surface geometry and BrowserWindow movement to transition together.

## Packaging and release flow

`npm ci` restores the lockfile. `npm test` runs before each CI platform build. Electron Builder creates Windows x64 NSIS/portable outputs and macOS arm64/x64 DMG/ZIP outputs. A tag beginning with `v` makes the release job merge artifacts and create a GitHub release. Code signing discovery is disabled; the macOS identity is explicitly null.

## Architectural constraints worth preserving

- Main owns all native and filesystem capabilities.
- Renderer input is untrusted and sanitized as a full settings snapshot.
- Camera frames stay in native video elements; no canvas/frame-copy loop is part of the retained design.
- Full screen and Scene transitions reuse the camera stream.
- Temporary presentation state is distinct from reusable Scene state.
- Direct manipulation owns Overlay size/position and camera framing; settings do not duplicate Size/Zoom sliders.
- `presets` remains the storage key even though the product term is Scene.
