# ADR 0019: Reserve native space above onboarding

## Status

Accepted

## Related work

- Contextual coach marks: ADR 0016
- Stable entry and user-controlled reveal: ADR 0017
- Earlier above-Toolbar placement: ADR 0018
- Implementation slice: [GitHub issue 13](https://github.com/techiesreviews/camframe/issues/13)

## Context

ADR 0018 put the coach mark above the Toolbar by moving the Toolbar downward inside the compact Overlay window. Although the Camera geometry did not change, the Toolbar visibly jumped from its established screen position and then covered the Camera. That violated the tour's stable-entry rule: the UI changed before the user activated the highlighted feature.

The coach mark still needs to sit physically above the Toolbar. The compact BrowserWindow has no room above the Toolbar's normal y=22 position.

## Decision

While onboarding is open, expand the transparent native Overlay window upward by a fixed 220 px reserve and shift the existing renderer content down by the same amount inside that enlarged window. The native window origin moves up 220 px, so the Toolbar, Camera, resize handles, and normal Inline-settings position retain their existing screen coordinates.

Place the coach mark in the new transparent reserve, 12 px above the Toolbar. When Camera or Scenes is opened by the user, place Inline settings 12 px below the Toolbar at its normal screen position. Use a synchronous IPC handshake when opening or closing onboarding so the native bounds change and renderer offset are applied within the same renderer task, before an intermediate frame can paint.

Treat stored position, Scene snapshots, centering, resizing, and geometry updates as compact-base coordinates. The onboarding reserve is transient and must never be persisted. Closing onboarding removes both the native reserve and renderer offset without moving the visible UI.

This supersedes ADR 0018's decision to move the Toolbar beneath a top-anchored coach mark. ADR 0018's requirement that the coach mark remain above the Toolbar and that settings follow it by a 12 px gap remains in force.

## Consequences

- The coach mark can sit above the Toolbar without moving or covering the Toolbar or Camera on screen.
- Opening and closing onboarding temporarily changes native window bounds, but not the visible compact UI's screen coordinates or persisted position.
- Browser-only QA uses the same 220 px renderer offset in a taller page; native invariance still requires Electron/manual verification.
- Full screen closes onboarding first because the transient compact reserve is not part of Full screen geometry.
