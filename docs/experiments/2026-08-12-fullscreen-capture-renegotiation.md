# Experiment: Fullscreen camera-profile renegotiation

- **Date started:** 2026-08-12 (backfilled 2026-08-28)
- **Owner:** Original CamFrame development session; backfill from repository evidence
- **Status:** Inconclusive for dynamic switching; canvas workaround rejected
- **Related issue/PR/ADR:** [PR 4](https://github.com/techiesreviews/camframe/pull/4), [issue 5](https://github.com/techiesreviews/camframe/issues/5)
- **Baseline version:** v0.2.14 fixed profile; dynamic behavior introduced in v0.2.15

## Question

Can CamFrame increase the existing camera track from a low-latency compact profile to a detailed Full screen profile and back without recreating the stream or exposing wrong, stale, or black frames?

## Hypothesis and intended threshold

Serial `MediaStreamTrack.applyConstraints()` calls on the same selected track should preserve device identity, settle rapid toggles in final-state order, keep unsupported cameras working, and show no visual discontinuity.

The issue's later acceptance threshold was stricter: zero wrong-camera, black, unrelated stale, or intermediate-profile frames; stable device identity; correct rapid-toggle settling; and manual Windows verification with multiple devices including Elgato hardware.

## Baseline

The earlier fixed-profile build reportedly transitioned more smoothly. Exact hardware measurements, captures, and repetition counts were not preserved.

## Variants

### Shipped dynamic profile switching

- Compact default: ideal 1280×720, ideal 60/minimum 30/maximum 60 fps.
- Full screen default: ideal 3840×2160, ideal/maximum 30 fps.
- Reuse the same MediaStreamTrack.
- Serialize profile requests.
- Swallow unsupported-constraint failures and retain the working stream.

### Uncommitted canvas hold-frame workaround

- Capture and hold the last valid frame on a canvas.
- Wait for fresh video frames after renegotiation.
- Coalesce rapid Full screen requests.

No implementation diff or artifact for this variant was retained.

## Results

| Variant | Automated evidence | Manual evidence | Outcome |
| --- | --- | --- | --- |
| Dynamic same-track switching | Constraint/profile and serialized-state tests passed at introduction | Windows with multiple cameras/Elgato showed wrong, stale, or black frames during transitions | Functional contract retained, visual continuity unproven |
| Canvas hold-frame | A local race regression reportedly passed | The visual problem still appeared manually | Rejected; never committed |

The issue notes that the transition did not intentionally call `getUserMedia()` again or select another device. It could not identify whether the visible failure came from the driver, Chromium capture pipeline, or Electron compositor.

## Interpretation

The experiment demonstrated that ordering and fallback can be unit-tested, but those tests do not predict frame provenance or compositor continuity on real hardware. Passing the race test was insufficient. The canvas workaround added complexity without meeting the user-visible threshold.

## Disposition

The canvas workaround was rejected and is out of scope. Dynamic switching remains in v0.4.3 and later gained user-configurable resolutions, but the visual hypothesis remains inconclusive. GitHub issue 5 was closed without comments or linked resolution; closure is not treated as success evidence.

Next discriminating work should instrument selected/requested device IDs, track settings, video dimensions, frame timestamps, and toggle sequence; compare a fixed-profile control against dynamic switching; and record repeated manual runs on Windows with multiple devices including Elgato plus a non-4K camera.
