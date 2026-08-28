# ADR 0016: Use contextual onboarding coach marks

## Status

Accepted

## Related work

- Base onboarding decision: ADR 0012
- Accessibility contract: ADR 0013
- Implementation slice: [GitHub issue 13](https://github.com/techiesreviews/camframe/issues/13)

## Context

The first implementation of ADR 0012 presented all four onboarding steps in a centered modal panel. It described real Overlay capabilities, but hid the controls and Camera surface that the copy referred to. This made the guide feel separate from the direct-manipulation product it was explaining.

CamFrame already has compact, transient controls. First-run guidance should teach those controls in place without adding permanent chrome or requiring users to translate prose from a separate pre-product screen.

## Decision

Retain the four-step count, versioning, first-run eligibility, completion persistence, tray Help entry, and platform permission copy from ADR 0012. Replace the modal presentation with modeless contextual coach marks.

Each step reveals its real context and points to one live target:

1. Stack the coach mark above open Camera settings and target the settings panel.
2. Show normal direct-manipulation chrome and target Shape.
3. Activate framing mode and target the crosshair.
4. Open Scenes and target its tab.

The reveal operation may change transient UI visibility or mode, but it must not patch the active camera, Scene, crop, zoom, shape, size, or Overlay position. Explicit user interaction with the revealed UI remains allowed.

Stack settings-related coach marks above the open settings panel so the demonstrated controls remain visible. For toolbar steps, position the coach mark above or below the target. Clamp placement to the Overlay bounds and recompute after native bounds changes. Highlight the target with the existing orange focus accent. Do not dim, hide, or make the rest of the Overlay inert.

Keep the coach mark a managed focus region under ADR 0013, but do not trap `Tab`. Move focus to its heading for announcement, let keyboard users navigate into the demonstrated UI, let `Escape` dismiss the tour, and restore the invoker when possible.

This ADR supersedes only the modal/background-blocking presentation implied by ADR 0012. It does not increment onboarding content version 1 because the same feature set is being presented more directly before release.

## Consequences

- Users see each capability in its actual location and can try it during the tour.
- Onboarding placement now depends on live DOM measurement and native Overlay dimensions.
- Transient settings/framing state must be cleaned up when the tour closes or changes steps.
- Visual and keyboard verification must cover target alignment, above/below fallback, live interaction, and minimum-size shapes.
