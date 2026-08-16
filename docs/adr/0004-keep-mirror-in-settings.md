# ADR 0004: Keep Mirror camera in settings

## Status

Accepted

## Context

The overlay's quick-action toolbar should prioritize actions used during presentation: close, full screen, shape, camera positioning, and opening settings. Mirror camera is a persistent preference rather than a frequent moment-to-moment action.

## Decision

Remove Mirror camera from the quick-action toolbar and place it with Always on top in inline settings. Keep the existing Mirror camera control in the separate controller.

## Consequences

- The quick-action toolbar is less crowded and remains centered.
- Mirror camera is consistently presented as a setting in both control surfaces.
- The persisted mirror behavior and keyboard-independent access remain unchanged.
