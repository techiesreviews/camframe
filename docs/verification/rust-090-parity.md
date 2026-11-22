# CamFrame 0.9.0 → Rust: 71-feature contract audit

Baseline: tag `v0.9.0`; `src/` and `package.json` are unchanged from that tag.
Audit date: 2026-11-22. Related PR: https://github.com/techiesreviews/camframe/pull/72.

“Yes” means the feature’s implementation contract is present and agrees with the inspected
0.9.0 source. It is not a claim that physical camera drivers, assistive technology or all OS
settings were tried. Native screenshot/interaction evidence is recorded in
[runs/2026-11-22-rust-090-controls.md](runs/2026-11-22-rust-090-controls.md).
“No” marks an approved scope difference or missing human/OS verification; those are not silently
counted as pixel-perfect parity. The three approved improvements are called out in their rows.

Inspected source pairs: `overlay.*` / GPUI overlay, settings/Scenes/guide;
`overlay-geometry.js` and `overlay-interaction.js` / core geometry and interaction plus native shims;
`camera-session.js`, `cameras.js`, `camera-framing.js` / native capture and core framing;
`scenes*.js`, `scene-session.js`, `layout-request.js` / core Scenes and GPUI adapter;
`main.js` / tray, shortcuts, presentation; `prompter*.js` / HTTP server and cue adapter;
`settings.js`, `preferences-store.js` / core settings/store and the shared fixture suites.

| # | Feature / 0.9.0 behavior | Rust behavior | Match |
| --- | --- | --- | --- |
| 1 | The camera floats on the screen with nothing around it: no frame, no title bar, no background. | Transparent GPUI popup and native frame/shadow removal. | Yes (contract) |
| 2 | It stays on top of other windows, also above the Windows taskbar. Can be switched off (Always on top). | Native topmost/window-level switch; startup forces on. | Yes (contract) |
| 3 | It does not show in the taskbar or the Dock. The tray icon keeps the app alive. | Tool window on Windows; accessory application on Mac. | Yes (contract) |
| 4 | Every start: the camera is visible and on top, even if it was hidden before. | Shared startup cleaning forces visible and topmost. | Yes (contract) |
| 5 | When the mouse is not on the camera, clicks go through to the app behind it. | Native pointer polling passes clicks outside drawn camera/chrome; empty corners also pass (approved improvement). | Yes (contract) |
| 6 | It keeps running smoothly when another app has the focus. | Capture worker and inactive-frame scheduling continue outside focus. | Yes (contract) |
| 7 | Four shapes: Circle, Square (rounded corners), Portrait, Wide. | Circle, Rounded, Portrait and Landscape use the same dimensions and radii. | Yes (contract) |
| 8 | Drag the camera to move it. The place is remembered. | Native drag; settled origin saves after 400 ms. | Yes (contract) |
| 9 | Four corner handles to resize, from 180 to 640. The shape keeps its proportions and the opposite corner stays put. | Four 14 px handles; shared 180–640 geometry preserves the opposite corner; viewport synchronized. | Yes (contract) |
| 10 | If the camera ends up off-screen (a display is unplugged, the scale changes), it comes back to the bottom right of the main display. | Display/work-area changes use shared on-screen recovery. | Yes (contract) |
| 11 | A toolbar appears when the mouse is on the camera and hides shortly after it leaves. | Pointer chrome state uses the same 220 ms hide delay. | Yes (contract) |
| 12 | Six buttons: Quit, Full screen, Shape, Camera framing, Prompter link, Settings. | Same six Phosphor icons/order; flexible button sizes and selected states. | Yes (contract) |
| 13 | The Shape button steps through the four shapes. | Shape.next cycles Circle, Rounded, Portrait, Landscape. | Yes (contract) |
| 14 | Pick which camera to use. Cameras without a name show as "Camera 1", "Camera 2". | Native camera selector; unnamed devices receive numbered labels. | Yes (contract) |
| 15 | If the saved camera is gone, the default camera starts. | Stable native id, then imported camera label, then default fallback. | Yes (contract) |
| 16 | Plugging a camera in or out updates the list. | Device inventory refreshes every two seconds and updates the selector. | Yes (contract) |
| 17 | Quality: 480p, 720p (default), 1080p, 2160p. Prefers a smooth picture (50 frames per second or more, at least 30). | Four quality levels; 50+ fps preference, 30 fps minimum; native capture needs hardware validation. | Yes (contract) |
| 18 | If a camera refuses a quality, the picture that works stays. Fast clicks on quality end in one switch to the last choice. | 200 ms settling; rejected quality restores the last working format. | Yes (contract) |
| 19 | Mirror on or off. | The crop is mirrored as a whole after framing. | Yes (contract) |
| 20 | Picture only. CamFrame never opens the microphone. | Nokhwa capture only; no audio/microphone API is opened. | Yes (contract) |
| 21 | Clear messages on the camera itself: blocked in the system settings, in use by another app, no camera, could not open. Different wording for Windows and Mac. | Source-matched Windows/Mac blocked, busy and failed messages. | Yes (contract) |
| 22 | The same camera keeps running when going to Full screen and back (no black flash, no other camera). | One capture worker survives Full screen/Compact transitions. | Yes (contract) |
| 23 | Framing mode (crosshair button): drag to move the picture inside the shape. Follows the mouse also when mirrored. | Framing drag uses the shared pan rules; mirrored off-center coverage fixed as approved. | Yes (contract) |
| 24 | Scroll to zoom from 100% to 250% in steps of 5%. | Wheel applies 5% steps, clamped to 100–250%. | Yes (contract) |
| 25 | Double-click puts it back to 100% and centre. | Double-click restores centered framing and 100%. | Yes (contract) |
| 26 | Frame (border) inside the shape: width 0 to 12, with a colour. | Inner border uses the saved width/color and shape radius. | Yes (contract) |
| 27 | Glow around the camera: colour (six swatches plus a colour code box), strength and spread. | Two glow shadows, source colors, six swatches, hex input, strength/spread. | Yes (contract) |
| 28 | Progressive blur: a soft blurred copy of the live camera around the shape, with blur amount and opacity. | Blurred live shaped copy with opacity and saturation outside the opaque picture; physical-camera comparison remains needed. | Yes (contract) |
| 29 | Effects sit outside the camera picture and are off in Full screen. | Effects and inner frame are omitted in Full screen. | Yes (contract) |
| 30 | The camera grows to fill the display with a short animation (0.28 seconds), and shrinks back to its old place. | Same window animates to display bounds in 280 ms and restores its Compact target; viewport updated each step. | Yes (contract) |
| 31 | Leave with Esc, the toolbar button or the shortcut. | Toolbar, global shortcut and Escape; persistent root receives Escape after toolbar hides. | Yes (contract) |
| 32 | In Full screen the toolbar hides by itself and comes back when the mouse goes to its spot. | Top-center hotspot and 200 ms hide delay. | Yes (contract) |
| 33 | Settings open inside the same window, with three tabs: Camera, Style, Scenes. | Same native window; Camera/Style/Scenes tabs, top 76 and width min(240,camera width−28); scrolls without enlarging window. | Yes (contract) |
| 34 | Camera tab: camera, quality, Mirror, Always on top. | Camera/Resolution selects and the two original switches. | Yes (contract) |
| 35 | Style tab: effect (none, Glow, Progressive blur) with its sliders, and frame width. | Effect select, source color swatches/tuning sliders and Frame slider. | Yes (contract) |
| 36 | Up to six Scenes. A Scene remembers the place, size, shape and look. | Shared Scene library caps at six and retains complete look/place. | Yes (contract) |
| 37 | Two starter Scenes on a fresh install: "Small bottom" and "Big right". | Shared startup fixtures create Small bottom and Big right. | Yes (contract) |
| 38 | Click a Scene to put it on camera; the camera moves there with an animation. Nothing is drawn on the camera picture. | Scene applies with the shared bounds animation and a hidden accessibility announcement. | Yes (contract) |
| 39 | Save look: save the current look as a new Scene. At six, the slot says Full. | Save look slot and inline name form; Full at six; replacement by name. | Yes (contract) |
| 40 | Autosave: changes made by hand go into the Scene that is on camera, with a green check. Undo for 10 seconds. | Shared follow/Undo state; 1.8 s saved check and 10 s Undo drain. | Yes (contract) |
| 41 | Delete with Undo for 6 seconds, no confirm box. | Deleted Scene keeps a placeholder and six-second Undo; no confirmation dialog. | Yes (contract) |
| 42 | Rename (F2) and reorder (drag, or Alt plus arrow keys). | F2 rename and row drag/Alt+arrow reordering; rename input is isolated from row commands. | Yes (contract) |
| 43 | List view or grid view. Each tile shows where the camera really lands on this display. | Two-column grid and compact list; miniature shape keeps its actual aspect and position. | Yes (contract) |
| 44 | Everything works from the keyboard (arrows, Enter, F2, Delete, Ctrl+Z, Escape). | Arrow focus, Enter, F2, Delete, Ctrl/Cmd+Z and Escape; rename regression tested. | Yes (contract) |
| 45 | Export Scenes to a file and import them, with rules for doubles and for more than six. | Native file dialogs and the shared import/export fixture contract. | Yes (contract) |
| 46 | "Layout" Scenes saved by the prompter: they keep place and size but leave the current look alone. | Layout Scenes apply geometry while retaining the live look. | Yes (contract) |
| 47 | Ctrl+Shift+C (Cmd on Mac): open the controls. | Platform modifier + Shift+C opens controls. | Yes (contract) |
| 48 | Ctrl+Shift+H: show or hide the camera. | Platform modifier + Shift+H toggles visibility. | Yes (contract) |
| 49 | Ctrl+Shift+F: Full screen. | Platform modifier + Shift+F toggles Full screen. | Yes (contract) |
| 50 | Ctrl+Shift+P: next Scene. | Platform modifier + Shift+P cycles saved Scenes. | Yes (contract) |
| 51 | Ctrl+Shift+1 to 6: Scene by number. | Platform modifier + Shift+1–6 applies by index. | Yes (contract) |
| 52 | Tray menu: Open controls, Help & onboarding, Show camera (tick), Scenes (with a mark on the active one), Quit CamFrame. | Open controls, Help & onboarding, Show camera, Scenes, separator, Quit in source order. | Yes (contract) |
| 53 | Double-click on the tray icon opens the controls. | Tray double-click dispatches Controls. | Yes (contract) |
| 54 | Four tips above the toolbar: Camera, Shape, Framing, Scenes, with a progress bar. | Four tips above toolbar with progress and original visual hierarchy; Back/Skip/Done. | Yes (contract) |
| 55 | A "ghost mouse" shows each thing live: steps through shapes, pans and zooms the picture. It stops as soon as you take over. | No ghost mouse or automatic camera edits: explicitly approved simpler guide (ADR 0042). | No — approved difference |
| 56 | Skip or finish is remembered. It can be opened again from the tray. | Completion persists; tray Help reopens; leaving closes guide settings. | Yes (contract) |
| 57 | Off by default. One toolbar button turns it on; a dot on the button shows on, starting or problem. | Off by default; toolbar toggles link; readiness/problem dot and selected ring. | Yes (contract) |
| 58 | When on, the prompter page (prompter.techies.tools) can switch the camera: Face full, Face small, a corner, a Scene by name, an exact size and place. | Loopback API 2 maps full/small/corner/Scene/size/place through shared layout rules. | Yes (contract) |
| 59 | The prompter can save two layout Scenes and set the small size. | Layout Scene save and small-size endpoints use the shared settings/Scene rules. | Yes (contract) |
| 60 | It only listens on this computer and only answers the prompter page and local pages. | 127.0.0.1 listener with checked Host/Origin and restricted null-origin status. | Yes (contract) |
| 61 | When the system says "less motion", animations stop at once, also while CamFrame is running. | Native accessibility preference scan stops an active transition at its final target. | Yes (contract) |
| 62 | High-contrast mode: clear edges, selection and focus. | Contrast mode uses explicit boundaries and focus, and disables effects; exact OS-palette/human comparison is unverified. | No — verification pending |
| 63 | Screen readers (NVDA, VoiceOver) can read the buttons and hear changes such as the Scene name. | AccessKit roles/states and a live Scene announcement exist; NVDA/VoiceOver not tried. | No — verification pending |
| 64 | Clear keyboard focus everywhere. | Focusable controls and visible orange focus; Scene edit icons show for focus within the row. | Yes (contract) |
| 65 | All settings are in one file per user, saved shortly after each change and again on quit. | One schema-15 file in a separate test identity, delayed save and quit save. | Yes (contract) |
| 66 | Safe saving: a broken or half-written file never loses your Scenes; a last good copy is used. | Atomic replacement, last-good copy, shared recovery fixtures. | Yes (contract) |
| 67 | Settings from older versions are upgraded on first start (five upgrade steps so far). | Same migrations and language-neutral Preferences fixtures. | Yes (contract) |
| 68 | A one-time clean-up of the old "Start at login" setting from before 0.8.0. | Old login registration is deliberately untouched until Lex approves switch-over (ADR 0042). | No — approved difference |
| 69 | Windows: an installer and a Portable version. | Unsigned per-user NSIS installer and Portable test download; license included. | Yes (contract) |
| 70 | Mac: DMG and ZIP, for Apple Silicon and for Intel. | Unsigned/ad-hoc-signed Mac beta DMG/ZIP for ARM and Intel; license in bundle. | Yes (contract) |
| 71 | A release is only published from a version tag, after a recorded "Go" from Lex. | These CI workflows upload test artifacts only; release/switch-over still requires Lex’s go. | Yes (contract) |

The source tray PNG is corrupt in both `src/main.js` and the unused Rust asset; the Rust tray
retains its working raster camera glyph. Native camera ids differ from Chromium’s origin-specific
ids, so imported selections use the camera label before falling back, as ADR 0042 records.

Remaining release gates: physical-camera quality, hot-plug and stream continuity on Windows/Mac;
exact high-contrast OS palette; NVDA/VoiceOver; real-camera size/start/memory measurements; Lex’s
try and release approval. Passing synthetic CI does not satisfy those gates.
