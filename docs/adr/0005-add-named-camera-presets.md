# ADR 0005: Add named camera presets

## Status

Accepted

## Context

CamFrame already restores the most recently used configuration from its preferences file. That is useful for resuming work, but it does not let someone switch quickly between intentionally different camera layouts.

## Decision

Add up to six named presets to both settings surfaces. Saving a preset captures the selected camera, shape, size, compact and fullscreen resolutions, frame styling and effect tuning, mirroring, camera crop position, and overlay position.

Selecting a preset applies it immediately. Saving with an existing name replaces that preset, and presets can be deleted.

Presets are stored alongside the existing preferences. They do not capture temporary visibility or always-on-top state; startup continues to make the camera visible and topmost.

## Consequences

- People can switch between reusable layouts without losing automatic last-state restoration.
- Presets remain local to the computer and operating-system user account.
- The six-preset limit keeps the compact settings UI manageable.
- Applying a preset can move and resize the overlay because position and size are intentional parts of a layout.
