# ADR 0012: Add versioned Overlay onboarding

## Status

Accepted

## Related work

- Roadmap PRD: [GitHub issue 11](https://github.com/techiesreviews/camframe/issues/11)
- Implementation slice: [GitHub issue 13](https://github.com/techiesreviews/camframe/issues/13)

## Context

CamFrame favors direct manipulation and an unobtrusive Overlay. Important behavior such as corner resizing, camera framing, Scene shortcuts, and Full screen toolbar recovery is therefore not continuously visible. Camera-permission failures also need platform-specific recovery guidance.

The dormant Controller is not a reachable product surface and should not become a dependency of first-run guidance.

## Decision

Add a versioned onboarding flow inside the reachable Overlay. New installations show it on first launch after the camera state is known. The flow explains camera permission and selection, moving and resizing the Overlay, manual camera framing, Scenes, and presentation shortcuts.

Persist the completed onboarding version as a global Preference. It is not captured by Scenes. Incrementing the product's onboarding content version may introduce only materially new guidance; ordinary wording changes must not reopen onboarding.

Treat an existing Preferences document that predates onboarding as already completed during migration. Existing users can start the walkthrough explicitly from a new Help entry in the tray. Dismissing or completing onboarding records the current version, and Help can reopen it without clearing that record.

Keep the walkthrough non-destructive: demonstrations may highlight controls, but they do not change the active camera, Scene, framing, or Overlay geometry without an explicit user action. Make permission guidance platform-specific.

The onboarding surface follows the accessibility contract in ADR 0013. Opening it makes the Overlay interactive and moves keyboard focus into the walkthrough. Closing it restores focus to the invoking control when possible.

## Consequences

- New users can discover direct manipulation without adding permanent toolbar controls.
- Existing users are not interrupted when the feature first ships.
- Future onboarding revisions require an explicit version decision and Preferences migration behavior.
- The tray gains a durable Help entry even after onboarding is complete.
- The dormant Controller remains unreachable.
