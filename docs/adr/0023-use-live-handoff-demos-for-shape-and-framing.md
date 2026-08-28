# ADR 0023: Use live handoff demos for Shape and framing

## Status

Accepted

## Related work

- Stable step entry: ADR 0017
- Post-paint settings reveal: ADR 0022
- Implementation slice: [GitHub issue 13](https://github.com/techiesreviews/camframe/issues/13)

## Context

Shape and framing remained abstract until users activated their controls. Unlike Camera and Scenes, these capabilities are direct manipulations whose value is easiest to understand through motion. A prerecorded tutorial would not demonstrate the live Overlay or hand control to the user at the current result.

Automatic demonstrations must not fight the real pointer, trap users in animation, or silently leave altered product state when the user advances without participating.

## Decision

After the coach mark has been visible for 320 ms, use one non-interactive ghost mouse over the live Overlay:

- **Shape:** play three ghost clicks on Shape, cycling through the next three real frame shapes. Hovering, focusing, or clicking Shape stops immediately and adopts the current shape for continued interaction.
- **Framing:** enter framing and loop a real pan, scroll-zoom, and double-click reset demonstration. Hovering the camera/Crosshair or attempting pointer, wheel, double-click, or keyboard interaction stops immediately, commits the current crop/zoom, and leaves framing active for handoff.

Capture the starting shape or framing values. If the user advances, goes back, skips, or closes without taking over, restore those starting values. Once the user stops the demo through hover/focus/interaction, clear the snapshot so their adopted state survives navigation.

The ghost mouse is `aria-hidden`, never accepts pointer events, and does not generate synthetic user events. Do not start either live demo when `prefers-reduced-motion: reduce` is active; the normal highlighted controls remain usable.

This supersedes ADR 0017's user-activation requirement for the automated Shape/framing demonstration only. Its coach-mark-first ordering and real-control interactivity remain in force.

## Consequences

- Users see the actual camera geometry and crop behavior rather than a disconnected tutorial.
- Hover creates a predictable handoff before the user's first click or drag.
- Demo-owned state is reversible; user-adopted state is retained.
- Timers, intervals, and Web Animations must be cleared on handoff, navigation, and dismissal.
- Visual verification must cover all three Shape clicks, pan/zoom/reset phases, reduced motion, and both restore/adopt branches.
