# ADR 0018: Position onboarding above the Toolbar

## Status

Accepted

## Related work

- Contextual coach marks: ADR 0016
- User-controlled reveal timing: ADR 0017
- Implementation slice: [GitHub issue 13](https://github.com/techiesreviews/camframe/issues/13)

## Context

The first user-controlled coach-mark layout placed the tooltip beneath the five-button Toolbar. This made the explanation compete with the Camera and left too little visual separation between guidance and the settings it could reveal. The Toolbar is the stable spatial reference for the tour and should read as the object being explained, not as a header above the explanation.

The existing compact BrowserWindow has insufficient transparent space to fit the full coach mark above the Toolbar's normal y=22 position without either clipping the tooltip or changing native Camera geometry.

## Decision

While onboarding is open, place the coach mark 8 px from the Overlay top. Measure its rendered height, then place the unchanged five-button Toolbar 12 px below the coach-mark bottom. The Camera surface remains at its normal y=84 position; the teaching stack may overlay the Camera without moving or resizing it.

When the user explicitly opens Camera or Scenes, place Inline settings 12 px below the 44 px Toolbar and constrain it to the remaining Overlay height with its existing scrolling behavior.

Disable the Toolbar's normal translate transition during onboarding so measured 12 px gaps remain exact and the bar does not drift after placement. Recompute the stack when Overlay dimensions or coach-mark content change. Closing onboarding removes the transient Toolbar/settings offsets.

This supersedes ADR 0017 only where it described a coach mark below the Toolbar. Its stable-entry and user-controlled-reveal rules remain in force.

## Consequences

- The tooltip is always visually above the control bar it explains.
- Toolbar contents and Camera geometry remain unchanged; only transient Toolbar/settings y positions differ during the tour.
- At compact heights, opened settings rely on their existing vertical scrolling.
- Geometry verification must assert tooltip → Toolbar → settings ordering and exact gaps.
