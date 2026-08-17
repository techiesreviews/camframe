# ADR 0011: Auto-hide the full-screen toolbar

## Status

Accepted

## Context

The quick-action toolbar remains visible over the camera in full screen because every pointer movement occurs on the full-screen camera surface and is treated as hover activity. This is useful in compact mode but distracting during a full-screen presentation.

## Decision

In full screen only, show the toolbar on entry and fade it after 0.2 seconds of inactivity. Treat the toolbar bounds plus a 12-pixel invisible margin as its hover hotspot so moving the pointer back to its location reveals it immediately even while it is transparent and click-through.

Do not restart the timer for repeated pointer movement outside the toolbar hotspot. Keep the toolbar visible while inline settings, resizing, or camera-framing mode is active.

Keep compact-mode hover behavior unchanged.

## Consequences

- Full-screen video becomes unobstructed shortly after controls are no longer needed.
- The toolbar remains easy to recover without clicking or knowing a shortcut.
- Settings and active framing interactions do not disappear mid-task.
- The same toolbar markup and actions serve compact and full-screen modes.
