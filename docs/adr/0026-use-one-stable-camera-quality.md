# ADR 0026: Use one stable camera quality

## Status

Accepted — 2026-08-29

## Context

CamFrame previously stored separate Compact and Full screen resolutions and called `MediaStreamTrack.applyConstraints()` whenever the mode changed. Windows testing with multiple cameras, including Elgato hardware, reported stale, black, or wrong frames during that renegotiation. A canvas-held-frame experiment did not solve the hardware failure.

Using the same capture profile at small and large Overlay sizes avoids the failing mode-change trigger while preserving one live MediaStream.

## Decision

Expose one **Camera quality** resolution setting and use it unchanged in Compact mode and Full screen. Keep `overlayResolution` as the persisted compatibility key and remove `fullscreenResolution` from current Preferences and Scene snapshots. Old documents containing `fullscreenResolution` remain loadable because unknown fields are ignored during sanitization.

Entering or leaving Full screen must not call `applyConstraints()`. A user camera-quality change may apply the chosen profile to the existing track, and a camera start/restart requests that same profile. The shared frame-rate preference is ideal 60 fps, minimum 30 fps, maximum 60 fps; the overconstrained retry may omit the minimum.

## Consequences

- Full screen changes native/renderer geometry without renegotiating the camera track.
- Compact mode may carry a higher capture cost when the user chooses a high quality; Full screen may look softer when the user chooses a low quality.
- Existing separate Full screen selections are intentionally discarded on the next sanitized save.
- Hardware verification still checks continuity, but it no longer tests a mode-specific profile switch.
