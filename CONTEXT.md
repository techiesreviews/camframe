# CamFrame context

CamFrame is an Electron desktop application that displays a movable, always-on-top camera overlay.

## Domain language

- **Overlay**: the transparent Electron window containing the live camera and its hover controls.
- **Camera surface**: the visible, shapeable camera region inside the overlay.
- **Frame**: the solid inner border around the camera surface.
- **Frame effect**: an optional visual treatment rendered outside the camera surface.
- **Compact mode**: the normal movable camera overlay.
- **Full screen**: the camera expanded to the active display bounds.
- **Controller**: the separate CamFrame settings window.
- **Inline settings**: settings opened directly over the camera overlay.
- **Onboarding**: the versioned four-step contextual coach-mark tour rendered inside the Overlay and reopenable from tray Help.
- **Scene**: a named, ordered snapshot of reusable camera, appearance, framing, size, and compact-position settings. The persisted field remains `presets` for compatibility.
- **Preferences**: the sanitized settings document stored as `preferences.json` in Electron's per-user data directory.
- **Compositor mask**: a calculated set of native window regions intended to determine which transparent overlay pixels Windows renders and accepts. The helpers exist, but v0.4.3 does not apply them to the window; see `docs/known-gaps.md`.
- **Camera framing**: the zoom and crop origin of the video inside the overlay, independent from overlay size and position.

## Source map

- `src/main.js`: Electron lifecycle, native window bounds, IPC, persistence, tray, shortcuts, and presentation state.
- `src/overlay.*`: camera overlay markup, presentation, and renderer behavior.
- `src/control.*`: dormant separate Controller implementation; v0.4.3 does not instantiate it.
- `src/settings.js`: settings defaults, sanitization, geometry, Scene helpers, and currently unused native-region calculations.
- `src/cameras.js`: capture constraints and camera-track configuration.
- `src/onboarding.js`: onboarding version/migration rules, bounded step navigation, platform permission copy, and coach-mark targets/reveal actions.
- `test/`: Node tests for settings, camera behavior, and UI contracts.

The reconstruction documentation index is `docs/README.md`. When it conflicts with accepted ADRs, add a superseding ADR. When prose conflicts with executable behavior, record the mismatch in `docs/known-gaps.md` and treat the checked-in source and tests as the current implementation evidence.
