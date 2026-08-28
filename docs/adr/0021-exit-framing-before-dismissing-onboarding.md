# ADR 0021: Exit framing before dismissing onboarding

## Status

Accepted

## Related work

- Contextual coach marks: ADR 0016
- User-controlled feature reveal: ADR 0017
- Implementation slice: [GitHub issue 13](https://github.com/techiesreviews/camframe/issues/13)

## Context

The framing step teaches a transient interaction mode. Its highlighted Crosshair button can toggle the mode off, and outside onboarding Escape exits framing. During onboarding, however, the guide consumed Escape first and dismissed the entire tour. That made the standard exit behavior unavailable exactly where it was being taught.

## Decision

State both framing exits in the step copy: click Crosshair again or press Escape. While onboarding is open and framing is active, the first Escape exits framing and keeps the coach mark open. A later Escape dismisses onboarding as usual.

The Scenes step must describe the saved-layout concept before shortcuts: each Scene retains its selected camera source, screen position, shape, framing, and style. Shortcut details remain available in the opened Scenes settings.

## Consequences

- Users can safely try framing and leave it without losing their place in the guide.
- Escape follows the most local active mode before dismissing the broader coach-mark flow.
- The Scene explanation matches the existing persisted snapshot contract, including per-Scene camera selection.
