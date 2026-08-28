# Product specification: CamFrame v0.4.3

## Product promise

CamFrame is a small Electron desktop application for Windows and macOS that keeps a live camera surface available as a movable presentation layer above other applications. The product favors direct manipulation and unobtrusive controls over a conventional, permanently visible application window.

This specification describes the reachable behavior at git commit `fe8e6c6`. “Must” statements are reconstruction requirements. Evidence is source inspection unless a verification reference is given.

## Reachable surfaces

### Overlay

The Overlay is the primary and, in v0.4.3, only reachable application surface. It is a frameless, transparent, fixed-size native window that:

- starts visible and always on top on every launch, regardless of the previous session's visibility/topmost values;
- is hidden from the taskbar and, on macOS, from the Dock;
- contains one visible camera video, an optional second video using the same stream for Progressive blur, a five-button hover toolbar, four resize handles, inline settings, status text, and temporary Scene notices;
- normally ignores mouse events while forwarding pointer movement, then becomes interactive while its controls or direct-manipulation modes are active;
- keeps background throttling disabled so the camera renderer continues while unfocused.

The toolbar order and actions are:

1. Quit CamFrame.
2. Enter or exit Full screen.
3. Cycle shape: Circle → Square → Portrait → Wide → Circle.
4. Enter or exit camera-framing mode.
5. Open or close Inline settings.

The normal toolbar is 196 px or the camera width minus 8 px, whichever is smaller. It is 44 px high, centered over the camera, and positioned 22 px from the top of the outer window. In framing mode it expands up to 240 px to show the zoom value and “Drag · Scroll · Double-click resets” guidance.

### Inline settings

Inline settings open over the Overlay and use three mutually exclusive sections:

- **Camera**: camera device; compact and Full screen capture resolution; Mirror camera; Always on top.
- **Style**: frame effect and contextual effect controls; frame width.
- **Scenes**: create/update/apply/reorder/delete/import/export Scenes; Start at login; shortcut reference.

Camera is the default section. Opening settings keeps the Overlay interactive. Saving, applying, or deleting a Scene closes Inline settings.

### Dormant Controller

`src/control.html`, `src/control.css`, `src/control.js`, and `createControlWindow()` implement a separate Controller with similar settings plus border color, show/hide, Center, and Quit actions. No reachable v0.4.3 code calls `createControlWindow()`. Tray “Open controls”, tray double-click, `Ctrl/Cmd+Shift+C`, and the `controller:show` IPC route reveal Inline settings instead. An exact rebuild must not accidentally make the dormant Controller appear unless a new product decision explicitly activates it.

## Camera behavior

- Only video is requested; audio is always disabled.
- Device choice uses an exact `deviceId` when one is saved. If the device no longer exists, CamFrame clears the selection and retries the default camera.
- Unlabeled video inputs are displayed as `Camera N`.
- The renderer reuses the active stream when the requested ID already resolves to the active physical device.
- The video uses `object-fit: cover`; camera framing changes transform scale/origin rather than the native Overlay bounds.
- The track content hint is `motion` when supported.
- A first request that is overconstrained is retried without the compact-mode 30 fps minimum.
- Permission blocked, device busy, and generic failures have distinct status messages. The blocked-permission copy currently names Windows even in the macOS build.
- Device changes trigger a fresh enumeration.

Capture profiles are independent settings:

| Mode | Default | Resolution choices | Frame-rate preference |
| --- | --- | --- | --- |
| Compact mode | 720p (1280×720) | 480p, 720p, 1080p, 2160p | ideal 60, minimum 30, maximum 60; retry may omit minimum |
| Full screen | 2160p (3840×2160) | 480p, 720p, 1080p, 2160p | ideal/maximum 30 |

Changing modes serializes `MediaStreamTrack.applyConstraints()` calls on the existing stream. Unsupported profiles leave the current working track in place. This is not proven visually seamless; see `known-gaps.md`.

## Compact-mode geometry and manipulation

`size` is the long/base dimension and is clamped to 180–640 px.

| Shape | Camera width | Camera height | CSS corner treatment |
| --- | --- | --- | --- |
| Circle | `size` | `size` | 50% |
| Square (`rounded`) | `size` | `size` | 16% |
| Portrait | `0.75 × size` | `size` | 12% |
| Wide (`landscape`) | `size` | `0.5625 × size` | 12% |

The transparent native window reserves 18 px on the left/right, 84 px above, and 18 px below the camera surface. At the default 288 px Circle this makes the outer window 324×390 px.

- Dragging the camera surface moves the native Overlay by polling the global cursor every 16 ms.
- Four 14 px corner handles resize while preserving aspect ratio and anchor the opposite corner.
- Shape, size, position, and frame-effect changes may reapply native bounds. Resolution, framing, mirror, and topmost changes must not resize the window.
- Center positions the camera surface, not merely the outer window, on the display nearest the pointer. This command currently exists only in the dormant Controller.

## Camera framing

Camera framing is active only after selecting the target/crosshair tool.

- Drag pans the crop origin from 0–100% on each axis.
- Horizontal movement reverses when Mirror camera is enabled so manipulation follows the visible image.
- Scroll changes zoom in stable 5% steps from 100–250%.
- Double-click restores 100% zoom and a centered `{x: 50, y: 50}` crop.
- The visible camera and Progressive blur source receive the same transform and origin.
- Camera framing never moves or resizes the Overlay.

## Frame and effects

- Frame is a solid inner border, 0–12 px, default 0 px, default color white.
- None is the default frame effect.
- Glow uses a six-digit hex color, strength 10–100%, and spread 4–18 px. Defaults: orange `#fb923c`, 90%, 13 px.
- Progressive blur uses the live camera as its source, blur 4–18 px, opacity 10–100%, and saturation 1.18. Defaults: 12 px and 72%.
- Effect controls are contextual. Glow alone shows the in-app hex editor and six swatches. Progressive blur shows no artificial color.
- Effects render outside the camera surface and are disabled in Full screen.
- Edge bloom is intentionally absent.
- Border color remains implemented in Preferences and the dormant Controller, but Inline settings exposes frame width only.

## Full screen

- Full screen uses the entire display matching the compact Overlay's saved bounds, not the display work area.
- The app does not use Electron's native fullscreen mode; it animates native bounds over 280 ms with cubic ease-in-out.
- Renderer camera geometry transitions over the same 280 ms to an unrounded, display-filling surface.
- Full screen is always visible, topmost, focused, and interactive. `Esc`, the toolbar button, or `Ctrl/Cmd+Shift+F` exits.
- Compact bounds, requested visibility, and topmost preference are restored after the exit animation.
- The toolbar appears on entry and hides after 200 ms of inactivity. Its invisible recovery hotspot is the toolbar rectangle plus 12 px. Settings, framing, and resizing keep it visible.
- Compact chrome is hidden immediately while the native window shrinks on exit.

## Scenes and presentation controls

The UI calls saved layouts **Scenes** while persistence uses `presets`.

- At most six Scenes exist, in user-controlled order.
- Saving captures camera identity/label, shape, size, both capture resolutions, frame/effect styling, mirror, camera zoom/crop, and compact Overlay position.
- Saving does not capture visibility, Always on top, Start at login, current Full screen state, active Scene, or other Scenes.
- Saving with a selected ID updates that Scene. A case-insensitive name match also replaces an existing Scene. Adding beyond six retains the latest five and adds the new Scene.
- Applying a Scene immediately applies its settings, shows its name for 1.6 seconds, and animates compact bounds when visible.
- Reordering controls the numeric direct-shortcut order.
- Export writes a versioned JSON document. Import accepts that document, a legacy `presets` property, or a bare array, then merges by ID or case-insensitive name without deleting unrelated local Scenes or exceeding six.
- Full screen is transient and is not entered/exited by applying a Scene.

Presentation entry points:

| Entry point | Behavior |
| --- | --- |
| `Ctrl/Cmd+Shift+C` | Show Overlay and open Inline settings |
| `Ctrl/Cmd+Shift+H` | Show/hide Overlay |
| `Ctrl/Cmd+Shift+F` | Enter/exit Full screen |
| `Ctrl/Cmd+Shift+P` | Apply next Scene, wrapping to the first |
| `Ctrl/Cmd+Shift+1`…`6` | Apply the Scene in that ordered slot |
| Tray “Show camera” | Toggle Overlay visibility |
| Tray “Scenes” | Apply a Scene and indicate the active one |
| Tray “Open controls” / double-click | Show Overlay and open Inline settings |
| Tray “Quit CamFrame” | Quit process |

Global shortcut registration failures are not surfaced. Tray actions remain the visible fallback.

## Persistence and startup

Preferences are stored per OS user as `preferences.json` under Electron's `app.getPath('userData')`. Writes are debounced by 120 ms and forced synchronously before quit. Invalid or missing files fall back to defaults. A limited pre-schema-3 migration resets frame width and size before current sanitization.

Start at login is applied only in packaged builds. Development runs never register Electron itself. The application remains alive with no normal windows because `window-all-closed` intentionally does nothing; the tray is the process anchor.

## Security and packaging constraints

- Both BrowserWindow definitions use context isolation, sandboxing, and no Node integration.
- The preload exposes a narrow IPC bridge; renderers do not receive `ipcRenderer` directly.
- Media permission is granted only to the Overlay web contents and only for `media`.
- Release contents are limited to `src/**/*` and `package.json` inside ASAR, with English Chromium locale only.
- Windows targets are NSIS and portable executables. macOS targets are unsigned DMG and ZIP for Intel and Apple Silicon and include the camera usage description.
- GPU acceleration remains enabled.

## Explicit non-goals in this baseline

- Audio capture or recording.
- Streaming/virtual-camera output.
- Automatic face tracking.
- Cloud synchronization of Preferences or Scenes.
- More than six Scenes.
- Native signing/notarization.
- Edge bloom or a generic effect-strength control.
