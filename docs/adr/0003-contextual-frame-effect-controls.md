# ADR 0003: Use contextual frame-effect controls

## Status

Accepted

## Context

Glow and Progressive blur expose different visual concepts. A single generic effect-strength setting would be ambiguous, while showing every possible control at once would clutter both the controller and inline settings.

The compositor mask provides 18 pixels of space outside the camera surface, which bounds useful effect spread without resizing the overlay window.

## Decision

Persist separate settings for each effect and display only the controls relevant to the selected frame effect:

- Glow: color, strength, and spread.
- Progressive blur: blur amount and opacity.

Limit Glow spread and blur amount to 18 pixels so their rendered output stays inside the existing compositor mask.

## Consequences

- Switching effects restores the last values used for each effect.
- The settings interface remains compact and task-specific.
- New effects should define their own named settings instead of reusing ambiguous generic values.
- Effects that need more than 18 pixels of overscan require a separate overlay-geometry decision.
