# CamFrame context

CamFrame is an Electron desktop application that displays a movable, always-on-top camera overlay.

## Domain language

- **Overlay**: the transparent Electron window containing the live camera and its hover controls.
- **Camera surface**: the visible, shapeable camera region inside the overlay.
- **Frame**: the solid inner border around the camera surface.
- **Frame effect**: an optional visual treatment rendered outside the camera surface.
- **Compact mode**: the normal movable camera overlay.
- **Full screen**: the camera expanded to the active display bounds.
- **Inline settings**: settings opened directly over the camera overlay.
- **Camera quality**: the single capture-resolution preference used unchanged in Compact mode and Full screen. Its persisted compatibility key is `overlayResolution`.
- **Onboarding**: the versioned four-step contextual coach-mark tour rendered inside the Overlay and reopenable from tray Help.
- **Scene**: a named, ordered size and compact position; a **snapshot Scene** also applies its saved camera, appearance and framing (see **Layout Scene**). The persisted field remains `presets` for compatibility.
- **Preferences**: the sanitized settings document stored as `preferences.json` in Electron's per-user data directory.
- **Camera framing**: the zoom and crop origin of the video inside the overlay, independent from overlay size and position.
- **Active Scene**: the Scene most recently applied, or saved from Inline settings (a Prompter link save without `apply` does not make it active), shown in Inline settings and the tray. Runtime only (`activePresetId` on the wire). A hand change of the look keeps it active and is saved into it (**Autosave**); a Prompter link cue that moves the camera clears it.
- **Autosave**: the active Scene follows hand changes of the live look (Inline settings, Shape, dragging, a corner resize) and saves itself; the camera and its quality are not followed (ADR 0037).
- **Undo**: in the Scenes tab, for 10 seconds after the active Scene saved itself (its look back to how it was when it went on camera), and for 6 seconds after a delete (the Scene back in its place). Main keeps both windows.
- **Starter Scenes**: "Small bottom" and "Big right", the layout Scenes a new installation (and an older file without Scenes) starts with.
- **Onboarding reserve**: the temporary 220 px of transparent window added above the compact Overlay while Onboarding is open. It is never persisted. **Compact bounds** are the Overlay window bounds without it.
- **Chrome**: the toolbar, selection corners, and resize handles shown while the pointer is over the Overlay. The Overlay is **interactive** (accepts the mouse) while the chrome shows or an activity such as Inline settings, Onboarding, framing, resizing, or dragging holds it.
- **Prompter link**: the opt-in HTTP endpoint on `127.0.0.1:47833` through which the Techies prompter switches Full screen, Compact size and position, or a Scene at camera cue lines, and saves layout Scenes (ADR 0031, ADR 0035). Off by default.
- **Small size**: the camera size a Prompter link `"small"` cue restores (`prompterSmallSize`). Scenes and Prompter cues never change it; resizing the Overlay by hand and `POST /camframe/small-size` do (ADR 0035).
- **Layout Scene**: a Scene saved through the Prompter link. Applying it changes only the Overlay size and place, planned on the display the Overlay is on or heading to (a place) or the display nearest its saved point (no place), and keeps the live camera, shape, appearance and framing. Its record has a `layout`; any other Scene is a **snapshot Scene** (ADR 0035).
- **Demo hand-over**: the moment the user reaches for the control an Onboarding demo is showing. The demo stops and the user keeps the shape or framing it left.

Retired term: **Compositor mask** (native window regions). The unapplied helpers were removed by ADR 0029.

## Source map

`src/main.js` and `src/overlay.js` are composition roots. They wire Electron and the DOM to the modules below (ADR 0030).

- `src/main.js`: Electron lifecycle, Preferences file I/O, tray, global shortcuts, dialogs, and bridge handlers.
- `src/overlay.*`: Overlay markup, styles, DOM rendering, and event wiring.
- `src/preload.cjs`: the sandboxed `window.camFrame` adapter for the bridge contract.
- `src/bridge.js`: the bridge contract between main and the Overlay: channels, transports, argument checks, main registration, and the browser QA fake.
- `src/prompter-link.js`: the Prompter link server, its origin/host/request checks, what a cue means (`cueAction`), and the status body.
- `src/prompter-control.js`: what a checked Prompter link request does to the Overlay and the Scenes, against injected geometry and state.
- `src/prompter-link-view.js`: what the toolbar's Prompter link button and its hidden status description show, and the one request the button flips.
- `src/settings.js`: the Preferences schema, sanitizing, loading (`preferencesFromDocument`), and camera/window dimensions.
- `src/scenes.js`: the Scene library: save, apply, cycle, delete and restore, reorder, rename, autosave, Undo windows, tile previews, import, export, and the active Scene.
- `src/scenes-panel.js`: the Scenes tab: list and grid, the Save look slot, rename, delete and Undo, keyboard and drag.
- `src/overlay-geometry.js`: Overlay window geometry in main: Compact placement, Full screen, the onboarding reserve, drag/resize, bounds animation, z-order, and mouse pass-through.
- `src/overlay-interaction.js`: when the Overlay chrome shows and when the window is interactive.
- `src/camera-session.js`: the camera session: one MediaStream, Camera quality, the blur halo video, device scans, and camera error copy.
- `src/cameras.js`: capture constraints (ADR 0028).
- `src/camera-framing.js`: Camera framing math and its CSS rendering.
- `src/onboarding.js`: onboarding version and migration rules, step content, and the tour controller.
- `test/`: Node tests per module, `test/fixtures/preferences/` (the language-neutral Preferences contract), static markup/CSS/wiring contracts in `overlay-markup.test.js`, and the release version agreement check and the tag hold (ADR 0034) in `release-version.test.js`.

The reconstruction documentation index is `docs/README.md`. When it conflicts with accepted ADRs, add a superseding ADR. When prose conflicts with executable behavior, record the mismatch in `docs/known-gaps.md` and treat the checked-in source and tests as the current implementation evidence.
