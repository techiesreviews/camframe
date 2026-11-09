# ADR 0038: Keep absolute positions and bring a lost Overlay back on screen

## Status

Accepted — 2026-11-09 (Orbit TOOLS-156).

## Context

On Lex's Windows laptop CamFrame ran with its camera on but no window in sight. The saved place in `%APPDATA%\CamFrame\preferences.json` was off every connected display: CamFrame trusted it blindly at startup (`sanitizeSettings` keeps any integer `{x, y}`, `compactBaseBounds` uses it as is). Ctrl+Shift+F brought the window back; renaming `preferences.json` fixed it, but also hid his Scenes.

How places are stored today:

- `position` in Preferences, and `settings.position` in every Scene, is the Overlay window's top-left (the outer window, 18 px left of and 84 px above the camera) in absolute virtual-desktop coordinates (Electron DIPs). No display id is stored; the coordinates alone say which display it was on.
- A layout Scene (ADR 0035, both starter Scenes) already stores a place relative to the display: a place name (`bottom-right`, `right`, …) and an optional margin, planned on the display the Overlay is on when applied. Small bottom is "bottom right, Corner margin (32 px) from the edges", the CSS-like `bottom: 32px; right: 32px` Lex asked about. A layout Scene without a place keeps an absolute point, kept on the display nearest it.
- The Prompter link reports and accepts absolute points: `sceneDetails[].savedPosition` (the window's top-left), `sceneDetails[].position` for a Scene without a place (the camera's top-left), cue and Scene-save `position: {x, y}`, and `view.window` / `view.camera` in the status (`docs/prompter-link-api.md`).

Lex asked whether CamFrame could position the camera relative to a screen corner (like `bottom: 20px; right: 20px`) instead.

## Decision

- **Places stay absolute screen points.** The stored shape of `position` does not change and there is no schema bump. A corner-plus-margin form would need to remember which display it belongs to, and Electron's display ids are not stable across docking, reboots and driver changes on Windows; without a display, a corner-relative place cannot tell two monitors apart. Changing the shape would also change what the Prompter link reports (`savedPosition`) and accepts, and what Scene exports hold, which an older CamFrame and the prompter read as absolute points. Corner-relative places already exist where they help most: layout Scenes and Prompter cues with a place name.
- **A lost Overlay comes back by itself.** Compact window bounds count as on screen when at least half of the window and at least half of its camera surface (the part that is dragged) lie on the work areas of the connected displays (`isOnScreen`, `visibleShare` in `overlay-geometry.js`). Bounds that are not on screen move to the bottom right of the main display, Corner margin (`prompterMargin`, default 32 px) from its edges, keeping their size (`onScreenBase`): the same corner and margin as the Small bottom starter Scene. This is checked:
  - at startup, before the window is created (main stores the new place);
  - whenever the window is shown or its Compact bounds are applied (`apply`, `showScene`, leaving Full screen and the place Full screen returns to);
  - when a display is added or removed or its metrics change (resolution, scale, work area, docking): `screen` `display-added`, `display-removed` and `display-metrics-changed` call `ensureOnScreen()`. A Full screen window on a display that is gone covers the nearest display instead.
  A drag, a corner drag or a move animation in progress is left alone. The new place is stored in Preferences only; no Scene is changed by it (a place the window was moved to by itself is not a hand change, ADR 0037).
- **Scenes open on screen.** An exact (snapshot) Scene's saved place is kept wholly on the display nearest its camera when applied (`keepOnWorkArea`, the same rule a layout Scene without a place already follows). The Scene itself keeps its saved place, so it opens where it was saved once that display is back.

## Consequences

- Old Preferences files and Scene exports load unchanged. A file whose place is off every display (Lex's renamed `preferences.old.json`) now opens with the camera at the bottom right of the main display and all its Scenes.
- A place that is partly off screen but still at least half visible is kept: someone who parks the camera half over an edge on purpose keeps it there.
- A Scene saved straddling two displays opens wholly on the nearest one.
- Not part of this decision, kept as suggestions in TOOLS-156: showing the window anyway when it has not painted after a few seconds, a safe-mode switch, a log file, and a single-instance lock.
