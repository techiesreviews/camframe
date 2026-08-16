# ADR 0002: Remove Edge bloom

## Status

Accepted

## Context

The initial frame-effect set included Glow, Progressive blur, and Edge bloom. Edge bloom overlapped visually and functionally with Glow without adding enough value to justify a separate setting.

## Decision

Remove Edge bloom from CamFrame's settings, persisted-value whitelist, CSS recipes, and tests. Keep Glow as the color-driven effect and Progressive blur as the camera-derived effect.

## Consequences

- The frame-effect selector contains None, Glow, and Progressive blur.
- The effect-color editor appears only for Glow.
- Previously persisted `edge` values safely fall back to None during settings sanitization.
