# ADR 0028: Prefer smooth camera modes without frame-rate limits

## Status

Accepted — 2026-09-26. Supersedes the frame-rate sentence of ADR 0026; the single stable Camera quality is unchanged.

## Context

The Overlay sometimes felt delayed. Measuring the live track with `MediaStreamTrack.stats` and `requestVideoFrameCallback` on Windows 11 (Electron 43 and 44, RTX 5070 Ti, 60 Hz displays) showed the camera producing about 60 fps while only about 53 fps reached the video element. Roughly one frame in nine was discarded before display, which reads as periodic judder and stale motion. It reproduced with the Elgato Virtual Camera, a Cam Link 4K, and Chromium's synthetic 60 fps camera, and did not depend on the frame effect.

Chromium's `SelectVideoTrackAdapterSettings` turns any `frameRate.max`, and any basic `frameRate.ideal`, into a track frame-rate limit. `VideoTrackAdapter::MaybeDropFrame` then discards every frame that arrives more than 20% earlier than that target. Real and virtual cameras delivering "60 fps" jitter enough to trip this constantly. Every tested variant with an ideal or maximum (ideal 60/max 60, ideal 60/max 120, ideal 120, min 30/max 60) still discarded frames; `resizeMode: 'none'` did not change the result. Only minimum-only frame-rate constraints delivered every frame.

Removing the frame-rate preference entirely is not acceptable because Chromium breaks ties toward its 30 fps default, so a camera offering both 30 and 60 fps modes could open at 30.

## Decision

The capture profile never contains a frame-rate `ideal`, `max`, or `exact` in any constraint set. It requests:

- Basic: ideal width/height for the selected Camera quality, and `frameRate.min` 30 unless retrying slower.
- Advanced, in order: the requested size or larger at 50 fps or faster; the requested size or larger; 50 fps or faster.

Advanced sets are optional and are skipped when unsatisfiable, so they never cause `OverconstrainedError`. Their order keeps an explicit Camera quality ahead of frame rate: a camera with 4K30 and 1080p60 still opens at 4K when 2160p is selected, while a 1080p-only camera asked for 2160p opens at its 60 fps mode instead of a 30 fps one.

`npm run probe:camera` measures source, delivered, discarded, and presented frame rates plus capture-to-display latency. Set `CAMFRAME_E2E_REAL_CAMERA=1`, `CAMFRAME_PROBE_CAMERA=<label substring>`, `CAMFRAME_PROBE_QUALITY`, and `CAMFRAME_PROBE_EFFECT` to probe physical devices.

## Consequences

- Every captured frame reaches the Overlay; measured discards fell from about 6.5 per second to 0 with presented rate at about 60 fps.
- A camera faster than 60 fps is no longer decimated to 60. Minimum-only selection breaks ties toward the lowest qualifying rate, so 60 fps modes remain preferred over 120 fps modes.
- When 60 fps is only available at a larger size than requested, CamFrame may capture that larger mode and scale it down.
- Capture-to-display latency was already about one display refresh (17 ms p50 at 60 Hz) and is unchanged; the remaining delay is camera, driver, and HDMI capture time outside CamFrame.
