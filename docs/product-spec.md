# Product specification: CamFrame unreleased after v0.4.3

## Product promise

CamFrame is a small Electron desktop application for Windows and macOS that keeps a live camera surface available as a movable presentation layer above other applications. The product favors direct manipulation and unobtrusive controls over a conventional, permanently visible application window.

This specification describes the current working tree based on git commit `fe8e6c6`, plus the unreleased onboarding, accessibility, settings-surface, and stable Camera quality decisions accepted through ADR 0026. “Must” statements are reconstruction requirements. Evidence is source inspection unless a verification reference is given.

## Reachable surfaces

### Overlay

The Overlay is the primary and only reachable application surface. It is a frameless, transparent, fixed-size native window that:

- starts visible and always on top on every launch, regardless of the previous session's visibility/topmost values;
- is hidden from the taskbar and, on macOS, from the Dock;
- contains one visible camera video, an optional second video using the same stream for Progressive blur, a five-button hover toolbar, four resize handles, Inline settings, versioned onboarding, status text, and temporary Scene notices;
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

- **Camera**: camera device; one Camera quality used in Compact and Full screen; Mirror camera; Always on top.
- **Style**: frame effect and contextual effect controls; frame width.
- **Scenes**: create/update/apply/reorder/delete/import/export Scenes; Start at login; shortcut reference.

Camera is the default section. Opening settings keeps the Overlay interactive. Saving, applying, or deleting a Scene closes Inline settings.

### Onboarding and Help

New installations show a four-step contextual coach-mark tour inside the Overlay after camera startup reaches either a working or error state. It covers camera access and selection, moving/resizing the Overlay, manual camera framing, and Scenes. Platform-appropriate presentation shortcuts remain available in the opened Scenes panel.

- Every step first paints against the unchanged five-button Toolbar with settings closed and framing off. The coach mark points to Settings, Shape, Crosshair, or Settings again.
- The current target keeps the Toolbar's real hover colors for the duration of its step, in addition to the orange target outline. The header says only “Getting started”; four orange/neutral line segments provide visible progress while progressbar semantics expose the numeric step to assistive technology.
- Coach marks are modeless and the highlighted control remains operable. After the coach mark has been eligible to paint, Camera and Scenes steps automatically open Inline settings with the matching section selected. After 320 ms, Shape and framing use an `aria-hidden`, non-interactive ghost mouse to demonstrate the live control.
- Shape performs three automatic clicks through real shapes. Hovering, focusing, or clicking Shape stops the animation and hands over at the current shape. Framing demonstrates pan, scroll zoom, and reset; entering the Camera/Crosshair or attempting real interaction stops it and hands over with framing active at the current crop/zoom.
- Advancing or dismissing without takeover restores the values from before the automatic demo. Hover/focus/interaction adopts the demonstrated state, so it survives later navigation. Reduced-motion users receive no automatic Shape/framing motion.
- Advancing or returning resets settings/framing opened for the demonstration before displaying the next coach mark. Explicit changes to camera, Scene, crop, zoom, shape, size, or Overlay position are retained.
- Opening and step changes move focus to the current coach-mark heading. `Tab` may leave the coach mark to reach the demonstrated UI. During the framing demonstration, clicking Crosshair again or pressing `Escape` exits framing while keeping the guide open; otherwise `Escape` dismisses the tour. Closing restores the invoking element when one exists.
- Skip and final completion both persist onboarding version 1 globally. The completion field is not captured by Scenes.
- Existing Preferences documents that predate schema 12 migrate as completed, so existing users are not interrupted.
- Tray “Help & onboarding” shows the Overlay, focuses it, and reopens the guide without clearing completion state.
- The coach mark occupies a temporary 220 px transparent reserve added above the compact Overlay. The renderer shifts all ordinary content down by the same amount inside the enlarged native window, preserving the Toolbar, Camera, resize handles, and Inline settings at their established screen coordinates. The coach mark ends 12 px above the unchanged five-button Toolbar. If the user opens Camera or Scenes, Inline settings starts 12 px below the Toolbar and scrolls in the remaining space. Opening and closing the tour must not produce an intermediate frame in which the ordinary UI jumps.
- The Scenes step explains that each Scene retains its selected camera source, screen position, shape, framing, and style. The opened Scenes panel provides the complete controls and shortcut reference.

## Camera behavior

- Only video is requested; audio is always disabled.
- Device choice uses an exact `deviceId` when one is saved. If the device no longer exists, CamFrame clears the selection and retries the default camera.
- Unlabeled video inputs are displayed as `Camera N`.
- The renderer reuses the active stream when the requested ID already resolves to the active physical device.
- The video uses `object-fit: cover`; camera framing changes transform scale/origin rather than the native Overlay bounds.
- The track content hint is `motion` when supported.
- A first request that is overconstrained is retried without the 30 fps minimum.
- Permission blocked, device busy, and generic failures have distinct status messages. Permission recovery copy names Windows Settings/desktop-app permission on Windows and System Settings/CamFrame permission on macOS.
- Device changes trigger a fresh enumeration.

Camera quality is one setting shared by Compact mode and Full screen. It defaults to 720p (1280×720), offers 480p, 720p, 1080p, and 2160p, and requests ideal 60/minimum 30/maximum 60 fps; the overconstrained retry may omit the minimum. Changing modes never calls `MediaStreamTrack.applyConstraints()`. A user Camera quality change is serialized on the existing stream, and an unsupported profile leaves the current working track in place.

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
- Border color remains accepted in Preferences and Scenes for compatibility, but Inline settings exposes frame width only.

## Full screen

- Full screen uses the entire display matching the compact Overlay's saved bounds, not the display work area.
- The app does not use Electron's native fullscreen mode; it animates native bounds over 280 ms with cubic ease-in-out unless reduced motion is active, when it applies final bounds immediately.
- Renderer camera geometry transitions over the same 280 ms to an unrounded, display-filling surface, or changes immediately under reduced motion.
- Full screen is always visible, topmost, focused, and interactive. `Esc`, the toolbar button, or `Ctrl/Cmd+Shift+F` exits.
- Entering or leaving Full screen preserves the current camera track profile; only window and renderer geometry change.
- Compact bounds, requested visibility, and topmost preference are restored after the exit animation.
- The toolbar appears on entry and hides after 200 ms of inactivity. Its invisible recovery hotspot is the toolbar rectangle plus 12 px. Settings, framing, and resizing keep it visible.
- Compact chrome is hidden immediately while the native window shrinks on exit.

## Scenes and presentation controls

The UI calls saved layouts **Scenes** while persistence uses `presets`.

- At most six Scenes exist, in user-controlled order.
- Saving captures camera identity/label, shape, size, Camera quality, frame/effect styling, mirror, camera zoom/crop, and compact Overlay position.
- Saving does not capture visibility, Always on top, Start at login, current Full screen state, active Scene, or other Scenes.
- Saving with a selected ID updates that Scene. A case-insensitive name match also replaces an existing Scene. Adding beyond six retains the latest five and adds the new Scene.
- Applying a Scene immediately applies its settings, shows its name for 1.6 seconds, and animates compact bounds when visible unless reduced motion is active.
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
| Tray “Help & onboarding” | Show/focus Overlay and reopen onboarding |
| Tray “Quit CamFrame” | Quit process |

## Contrast and reduced motion

- The Overlay follows live OS/Chromium `prefers-reduced-motion`, forced-colors, and increased-contrast signals; neither preference is persisted or captured by Scenes.
- Reduced motion disables renderer animations and transitions for the whole Overlay, suppresses onboarding demonstrations, and makes Full screen and visible compact Scene bounds changes complete immediately at their final geometry.
- Turning reduced motion on during a native bounds transition finishes that transition immediately rather than leaving intermediate geometry.
- High contrast uses system colors and explicit borders for controls, settings, onboarding, status, and notices. Selected controls have a structural border/fill treatment, focused controls keep a separate outline, and the selected effect-color swatch shows a check mark.
- The Overlay exposes `data-reduced-motion` and `data-high-contrast` to its scoped visual descendants so future Custom effects can respond without receiving native APIs.

Global shortcut registration failures are not surfaced. Tray actions remain the visible fallback.

## Persistence and startup

Preferences are stored per OS user as `preferences.json` under Electron's `app.getPath('userData')`. Writes are debounced by 120 ms and forced synchronously before quit. Invalid or missing files fall back to defaults. A pre-schema-3 migration resets frame width and size. A schema-12 onboarding migration marks existing Preferences documents complete when the new field is absent.

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
