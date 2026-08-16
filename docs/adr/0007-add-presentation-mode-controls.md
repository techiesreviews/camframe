# ADR 0007: Add presentation mode controls

## Status

Accepted

## Context

CamFrame can save reusable layouts, but applying them through the settings panel interrupts a live presentation. Visibility and full screen also require interacting with the overlay or tray.

## Decision

Add global shortcuts for showing or hiding the camera, entering or exiting full screen, and cycling through saved presets. Expose saved presets directly in the system tray and mark the most recently applied preset.

Show a brief, non-interactive label on the camera when a preset is applied. Add an optional start-at-login preference, and place its control and the shortcut reference in the Presets settings section to avoid crowding the primary Camera view.

Use these shortcuts:

- `Ctrl/Cmd + Shift + H`: show or hide the camera
- `Ctrl/Cmd + Shift + F`: enter or exit full screen
- `Ctrl/Cmd + Shift + P`: switch to the next preset

## Consequences

- Common presentation actions no longer require opening settings.
- Tray-based preset switching provides a visible fallback when a shortcut is unavailable.
- Shortcut registration can fail when another application already owns the same combination; the tray remains usable in that case.
- Start at login is applied to packaged builds so development runs do not register Electron itself as a startup application.
