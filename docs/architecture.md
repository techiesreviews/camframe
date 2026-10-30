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

`main.js` and `overlay.js` are composition roots: they connect Electron and the DOM to deep modules whose platform dependencies are passed in (ADR 0030). Tests use the same interfaces with fake windows, clocks, media devices, and ports.

| Module | Owns | Direct callers / consumers |
| --- | --- | --- |
| `src/main.js` | App lifecycle, Preferences file I/O, BrowserWindow creation, tray/Help, global shortcuts, file dialogs, bridge handlers | Electron entry point from `package.json` |
| `src/bridge.js` | The bridge contract: every channel, its transport (`invoke`, `send`, `sendSync`, `event`), argument checks, Overlay-only sender checks, event sending, and the browser QA fake | Main (registration, events), Overlay (QA fake), tests |
| `src/preload.cjs` | Sandboxed `window.camFrame` adapter. It cannot import `bridge.js`, so `test/bridge.test.js` checks it against the contract | Loaded by the Overlay BrowserWindow |
| `src/overlay-geometry.js` | Overlay window geometry: Compact placement, Full screen, the onboarding reserve, drag/resize polling, bounds animation with reduced motion, z-order, mouse pass-through | Main; injected `window`, `screen`, `timers` |
| `src/scenes.js` | Scene library: save, apply, numbered apply, cycle, delete, reorder, import parsing/merge, export, the Scene limit, the active Scene, notices | Main |
| `src/prompter-link.js` | The opt-in Prompter link: the `127.0.0.1:47833` HTTP server's lifecycle and state, origin/host/body checks, cue parsing, and what a cue does (`cueAction`) | Main; injected `createServer` |
| `src/settings.js` | Preferences schema, sanitization, loading/migration (`preferencesFromDocument`), Scene snapshots, camera/window dimensions | Main, Scene library, geometry, Overlay, tests |
| `src/overlay.js` | DOM rendering and event wiring for the Overlay, Inline settings, Scene UI, and the onboarding view | `overlay.html` |
| `src/overlay-interaction.js` | Whether the chrome shows and whether the window is interactive; compact and Full screen hide delays; the toolbar hotspot | Overlay |
| `src/camera-session.js` | The one MediaStream: acquisition with fallback, reuse, stale-result discard, ordered Camera quality changes, the blur halo video, device scans, error copy | Overlay; injected `mediaDevices` and video elements |
| `src/cameras.js` | Capture constraint builders (ADR 0028) | Camera session, tests |
| `src/camera-framing.js` | Camera framing pan/zoom math and its single CSS rendering | Overlay, onboarding, tests |
| `src/onboarding.js` | Onboarding version/migration predicates, step content, and the tour controller (steps, reveals, demos, hand-over, completion) | Settings, geometry, main, Overlay; the tour takes an Overlay port, a view, and `timers` |
| `src/overlay.html` / `.css` | Reachable UI semantics and visual implementation | Loaded by the Overlay BrowserWindow; can render in a browser with the QA fake |
| `test/*.test.js` | One suite per module, the Preferences fixture contract, and static markup/CSS/wiring contracts (`overlay-markup.test.js`) | `npm test` / CI |
| `test/fixtures/preferences/` | Language-neutral sanitize, load, and Scene import cases every Preferences implementation must pass | Node tests; future ports |
| `scripts/electron-smoke.mjs` | Real Electron lifecycle, preload/IPC, synthetic-camera, Full screen/profile, accessibility-emulation, and screenshot smoke | `npm run test:electron` / Windows CI; uses main-process-only `CAMFRAME_E2E*` environment hooks |
| `.github/workflows/build-desktop.yml` | Tagged Windows/macOS build and GitHub release | Manual dispatch or `v*` tag |

## State ownership

### Main-process persisted state

`settings` is the authoritative Preferences object. Every renderer patch passes the bridge's argument check, which drops `presets`, `completedOnboardingVersion`, and `schemaVersion`, then `sanitizeSettings()`. The main process applies native effects, emits the full state to renderers, refreshes the tray, and schedules persistence.

The active Scene (`activeSceneId` in main, `activePresetId` on the wire) is runtime-only. It identifies the most recently saved/applied Scene for the UI and tray. The Scene library clears it on any ordinary settings patch.

`completedOnboardingVersion` is global persisted state excluded from Scenes. A dedicated completion channel updates it without clearing the active Scene or reapplying Overlay geometry.

### Main-process transient state

- The Prompter link server and its status (`prompterLinkStatus`: off, starting, on, or error with a message). Main sends the status with every state update as a runtime-only field, like the active Scene.
- Overlay/Tray object references and the Preferences write timer in `main.js`.
- Inside Overlay window geometry: the mouse interactivity flag, drag/resize timers and start snapshots, the Full screen flag, remembered compact bounds (without the reserve), the bounds animation, the reduced-motion flag, and the onboarding reserve flag.

### Overlay-renderer transient state

- Inside the camera session: the active MediaStream, requested camera ID, monotonic request numbers that discard stale camera/device results, and the serialized Camera quality chain.
- Inside Overlay interaction: chrome shown, interactive, the hide timer, and the activities (Full screen, settings open, onboarding open, dragging, framing, resizing, crop-dragging).
- Inside the onboarding tour: open, step, reveal token, camera-settled/auto-offered flags, and the running demo with its snapshot, timers, and intervals. The view in `overlay.js` holds the highlighted target, focus-return element, and Web Animations.
- In `overlay.js`: the rendered state, selected Scene ID, the crop-drag pointer, and notice timers.
- Live reduced-motion, forced-colors, and increased-contrast media queries reflected as Overlay data attributes.

## Startup sequence

1. Electron becomes ready and hides the macOS Dock icon when available.
2. Main reads `preferences.json` and passes its text to `preferencesFromDocument()`, which applies the legacy migrations, sanitizes, then forces startup visibility and topmost to `true`.
3. Packaged builds apply Start at login.
4. Bridge handlers (one per contract entry, Overlay renderer only) and Overlay-only media permission handlers are registered.
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
  → bridge accepts only the Overlay renderer and drops non-patchable keys
  → Scene library merges the patch, sanitizes the entire Preferences object, clears the active Scene
  → native bounds/z-order/visibility update as needed
  → `state:changed` full snapshot to live renderers
  → tray rebuild
  → debounced Preferences write (120 ms)
```

There is no optimistic main-process state. The Overlay sometimes updates local framing styles immediately for smooth pan/zoom, then converges on the emitted sanitized state.

Onboarding completion is a narrow exception to the general renderer patch flow: main writes only the current onboarding version, emits state, and schedules persistence. Reopening Help is transient and does not change completion state.

The onboarding tour controller in `onboarding.js` owns the sequence below. It drives the Overlay through a narrow port (show chrome, open settings, framing on/off, state patches, framing preview) and draws through a view object in `overlay.js` (step content, coach-mark layout, demo cursor gestures).

Onboarding step rendering is contextual. Opening the guide performs a synchronous IPC handshake: main expands the transparent native Overlay 220 px upward and returns that reserve, then the renderer offsets all ordinary content down by 220 px in the same JavaScript task. Their screen coordinates therefore stay fixed while the coach mark uses the new space 12 px above the Toolbar. Every step first paints with the standard Toolbar and no demonstrated feature open. Camera and Scenes schedule a guarded 80 ms task that selects the matching section and opens Inline settings; stale callbacks no-op when the guide closes or its step/reveal token changes. When opened, Inline settings starts another 12 px below the 44 px Toolbar at its normal screen position.

Shape and framing schedule guarded live demonstrations after 320 ms unless reduced motion is requested. The renderer owns an `aria-hidden`, pointer-transparent ghost mouse plus all demo timers, intervals, and Web Animations. Shape invokes three normal state patches. Framing updates local crop/zoom continuously and commits at phase boundaries or handoff. Hover/focus/interaction clears automation and its starting snapshot, adopting the current state. Back/Next/dismissal restores the snapshot only when the user did not take over, then clears all demo resources. Escape exits active framing before a subsequent Escape may dismiss the guide.

## Accessibility preference coordination

Overlay owns the browser media-query listeners. It combines `forced-colors: active` and `prefers-contrast: more` into `data-high-contrast`, reflects `prefers-reduced-motion: reduce` as `data-reduced-motion`, and sends the two booleans through the preload bridge. CSS responds directly to those attributes, so changes do not wait for a main-process round trip.

Main accepts accessibility messages only from the Overlay renderer and passes reduced motion to Overlay window geometry. Bounds animations last 280 ms normally or complete immediately under reduced motion. A zero-duration request sets exact final bounds and runs the normal completion path synchronously; a live switch to reduced motion finishes any current target/callback. This single path covers Full screen and visible compact Scene applications. Nothing is persisted or added to Scene snapshots.

Overlay window geometry converts between window bounds and compact bounds (without the onboarding reserve) before centering, resizing, saving a Scene, saving a moved position, or entering Full screen. The reserve opens only in settled Compact mode, because the renderer offsets its layout by the returned height, and closes in every mode. Closing onboarding in Compact mode synchronously shrinks the native window, then the renderer removes its offset; the reserve is never persisted. Closing it in Full screen clears the reserve so leaving Full screen restores the compact position. Camera geometry and persisted Camera/Scene values are not patched by tour transitions.

## Camera flow

The camera session in `camera-session.js` owns this flow behind `update({cameraId, resolution, effect})`. Only what changed is acted on: a new camera restarts capture, a new Camera quality is applied to the running track, and a new Frame effect attaches or detaches the halo video.

1. The session computes constraints from camera ID and the single Camera quality resolution setting.
2. `getUserMedia()` requests one video stream and no audio.
3. `OverconstrainedError` retries with no 30 fps minimum.
4. A stale async result is stopped instead of installed.
5. The primary `<video>` receives the stream and begins playback. The track receives `contentHint = 'motion'` where supported.
6. Progressive blur conditionally attaches the same stream to the second video; other effects detach and pause it.
7. Enumeration after capture obtains permission-revealed labels and reports normalized device options for the Overlay to render. A selected camera that is missing falls back to the default camera.

Mode changes do not touch the track profile. A Camera quality change appends one `applyConstraints()` operation to a Promise chain so rapid user changes settle in order. Failures are swallowed and preserve the working profile.

## Native Overlay interaction

The BrowserWindow starts with ignored mouse events and forwarded movement. Overlay interaction derives one value, interactive while the chrome shows or settings, onboarding, framing, resizing, dragging, or crop-dragging is active, and sends `overlay:interactive` only when it changes. That makes the whole outer window accept or ignore input. Compact hide delay is 220 ms; Full screen toolbar delay is 200 ms.

Dragging and resizing are main-process operations because the renderer cannot directly control native screen coordinates:

- drag captures the cursor-to-window offset and calls `setPosition()` every 16 ms;
- resize snapshots cursor, bounds, and settings, computes an aspect-preserving patch every 16 ms, sanitizes it, applies bounds without recentering, and emits state;
- the asynchronous native `moved` event persists the compact position (outside Full screen and bounds animations, including while the onboarding reserve is open), but Scene save synchronously snapshots current compact bounds to avoid event lag.

CSS clips the visible camera shapes; there is no native input or render mask (ADR 0029).

## Full screen coordination

Main and Overlay coordinate, but neither uses Electron native fullscreen:

- Overlay window geometry remembers compact bounds without the onboarding reserve, derives the matching display bounds, forces visible/topmost/focus, emits the mode, and interpolates `x/y/width/height` every 16 ms for 280 ms, or applies final bounds immediately under reduced motion.
- Overlay receives the mode, switches CSS data attributes, updates button copy, closes settings, controls toolbar visibility, and disables geometry transitions under reduced motion. It does not renegotiate the camera track.
- Exit reverses the bounds animation and only then restores requested visibility and topmost behavior.
- `before-input-event` in main and renderer key handling both recognize Escape, providing a native-side fallback.

## Scene flow

Scene writes and imports run in main so file dialogs and Preferences remain privileged. Renderers only send IDs/names or invoke import/export. The Scene library computes each result (next Preferences, active Scene, notice); main only performs file I/O, applies Scene geometry, emits, and persists. Applying a visible compact Scene emits visual state before transitioning native bounds, allowing CSS surface geometry and BrowserWindow movement to change together; both complete immediately under reduced motion.

## Prompter link flow

`settings.prompterLink` starts the link at launch and every `updateState` patch that contains it turns the server on or off; `before-quit` closes it. A cue request passes the host, origin, method, content-type, size, and `parseCue()` checks inside `prompter-link.js`, then main's `applyPrompterCue()` asks `cueAction()` what to do and applies it with the existing paths: `setFullscreen(true/false)`, the Scene library's `applyScene()` committed with `showCompact()` (leaves Full screen), or a position from `compactPositionAt()` on `currentWorkArea()` committed like an ordinary settings patch and moved with `showCompact()`. A new bounds animation runs the finishing step of the one it replaces, so a burst of cues during the Full screen exit never leaves a stale saved Compact base. Every change still goes through `emitState()`, the tray refresh, and `saveSettings()`.

## Packaging and release flow

`npm ci` restores the exactly pinned lockfile. `npm test` runs before each CI platform build; Windows also runs the Playwright Electron smoke and uploads its screenshots. Electron Builder creates Windows x64 NSIS/portable outputs and macOS arm64/x64 DMG/ZIP outputs. A tag beginning with `v` makes the release job merge artifacts and create a GitHub release. Code signing discovery is disabled; the macOS identity is explicitly null.

## Architectural constraints worth preserving

- Main owns all native and filesystem capabilities.
- Renderer input is untrusted: every channel checks its sender and arguments, and settings patches are sanitized as a full snapshot.
- Camera frames stay in native video elements; no canvas/frame-copy loop is part of the retained design.
- Compact and Full screen use one stable Camera quality profile; Full screen and Scene transitions reuse the camera stream without applying track constraints.
- Temporary presentation state is distinct from reusable Scene state.
- Direct manipulation owns Overlay size/position and camera framing; settings do not duplicate Size/Zoom sliders.
- `presets` remains the storage key even though the product term is Scene.
- Every Preferences implementation passes `test/fixtures/preferences/`.
