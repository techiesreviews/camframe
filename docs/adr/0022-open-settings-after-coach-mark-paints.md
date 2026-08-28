# ADR 0022: Open settings after the coach mark paints

## Status

Accepted

## Related work

- Stable step entry: ADR 0017
- Stable Toolbar placement: ADR 0019
- Implementation slice: [GitHub issue 13](https://github.com/techiesreviews/camframe/issues/13)

## Context

ADR 0017 required every feature to remain closed until the user activated its highlighted control. This kept the Toolbar stable but left the Camera and Scenes steps describing settings that were not visible. Those two steps are clearer when the exact settings section is already open, provided the interface does not change before the explanation appears.

Shape and framing alter direct-manipulation state and still benefit from explicit user activation. Camera and Scenes are explanatory settings surfaces rather than modes.

## Decision

Every step first paints its coach mark against the standard five-button Toolbar with settings closed and framing off. After that paint, Camera steps automatically open Inline settings with Camera selected, and Scenes steps automatically open Inline settings with Scenes selected.

Schedule the settings reveal 80 ms after the coach mark is rendered. This gives a visible renderer several paint opportunities before the later task opens settings and remains deterministic when animation frames are throttled in a background preview. Guard the callback with the captured step and reveal token so rapid navigation or dismissal cannot open a stale panel.

Shape and framing remain closed until the user activates their highlighted controls. Back/Next still reset the previous demonstration before the next coach mark paints.

This supersedes ADR 0017 only for the Camera and Scenes settings reveal. Its stable first paint and user-controlled Shape/framing rules remain in force.

## Consequences

- Camera and Scenes steps show the exact panel they explain without requiring an extra click.
- The explanation remains visible before any automatic settings transition.
- Navigation and dismissal must cancel stale scheduled reveals through state guards.
- Visual verification must observe both the stable first frame and the settled selected-panel state.
