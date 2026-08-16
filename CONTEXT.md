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
- **Compositor mask**: the native window shape that determines which transparent overlay pixels Windows renders and accepts.

## Source map

- `src/main.js`: Electron windows, native bounds, IPC, persistence, and compositor masks.
- `src/overlay.*`: camera overlay markup, presentation, and renderer behavior.
- `src/control.*`: separate controller window.
- `src/settings.js`: settings defaults, sanitization, geometry, and native regions.
- `src/cameras.js`: capture constraints and camera-track configuration.
- `test/`: Node tests for settings, camera behavior, and UI contracts.
