# ADR 0017: Reveal onboarding features only after user action

## Status

Accepted

## Related work

- Versioned onboarding: ADR 0012
- Contextual coach marks: ADR 0016
- Implementation slice: [GitHub issue 13](https://github.com/techiesreviews/camframe/issues/13)

## Context

ADR 0016 replaced the centered onboarding modal with contextual coach marks and initially revealed each demonstrated context as its step appeared. Automatically opening settings or activating framing made the compact Overlay change before users had time to understand the explanation. Activating framing also collapsed the five-button Toolbar, weakening its role as a stable spatial reference.

## Decision

Every onboarding step must first render against the unchanged standard five-button Toolbar. Showing a coach mark may highlight a control and make the Overlay interactive, but must not open Inline settings, activate framing, or otherwise change visible feature state.

The user may activate the highlighted live control after reading the coach mark. Only that explicit action reveals the feature:

1. Settings opens the Camera section.
2. Shape cycles using its normal behavior.
3. Crosshair activates framing using its normal behavior.
4. Settings opens the Scenes section.

When Camera or Scenes opens, retain the already-visible coach mark below the Toolbar and position the scrollable settings panel 12 px beneath it. Back or Next closes settings and exits framing before showing the next coach mark. Explicit product-value changes made while trying a feature remain in place.

This supersedes ADR 0016 only where it automatically revealed transient feature context on step entry. The contextual targets, modeless interaction, four-step count, and onboarding version remain unchanged.

## Consequences

- Users see an explanation before any Toolbar or settings transition.
- The five-button Toolbar is a stable reference at the beginning of every step.
- Camera and Scenes share the Settings target but route to different sections after activation.
- Tests and manual verification must distinguish step entry from explicit target activation.
