# ADR 0030: Deep modules behind injected adapters

## Status

Accepted — 2026-10-11.

## Context

Most CamFrame behavior lived in two long files. `main.js` held the native window state in 13 module-level variables and four mode flags referenced 37 times. `overlay.js` held camera capture, chrome visibility, the onboarding tour, and framing in 29 variables and three timer sets. Neither could be loaded without Electron or a DOM, so 17 of the 51 tests read their source text with 133 regular expressions instead of exercising behavior.

That structure hid defects. Pressing `Ctrl/Cmd+Shift+F` while onboarding was open, then closing the tour in Full screen, left the onboarding reserve flag set. Leaving Full screen then put the compact Overlay 220 px too high, and the native `moved` handler stopped saving its position. No test could express the sequence. A second implementation of Preferences (the GPUI experiment) had already drifted in five places, and nothing checked that the two agree.

## Decision

Organize behavior into deep modules whose interface is small, whose platform dependencies are passed in, and whose tests use that same interface:

| Module | Owns | Adapter seam |
| --- | --- | --- |
| `settings.js` | Preferences schema, sanitizing, loading (`preferencesFromDocument`), dimensions | — |
| `scenes.js` | Scene library: save/apply/cycle/delete/reorder/import/export, ids, the Scene limit, the active Scene | — (returns the next state and a notice) |
| `overlay-geometry.js` | Overlay window geometry: Compact placement, Full screen, onboarding reserve, drag/resize, bounds animation, z-order, mouse pass-through | `window`, `screen`, `timers` |
| `bridge.js` | Bridge contract: every main↔Overlay channel, its transport, and its argument check | `ipcMain`; the preload is a hand-written adapter checked against the table |
| `camera-session.js` | Camera session: the one MediaStream, reuse, stale results, Camera quality, the halo video, device scans | `mediaDevices`, video elements |
| `overlay-interaction.js` | Overlay interaction: when the chrome shows and when the window accepts the mouse | `timers` |
| `onboarding.js` | Onboarding versioning and the tour: steps, reveals, demos, hand-over, completion | an Overlay port, a view, `timers` |
| `camera-framing.js` | Camera framing math and the one CSS rendering of framing | — |

`main.js` and `overlay.js` become composition roots. They wire Electron and the DOM to these modules and keep only behavior that has no seam yet.

Three rules come with this structure:

1. **Language-neutral Preferences contract.** `test/fixtures/preferences/*.json` defines sanitizing, loading, and Scene import as input/expected pairs. Every implementation of Preferences must pass them. A behavior change updates the fixtures in the same change.
2. **One bridge contract.** Every renderer→main channel is registered from `BRIDGE_CONTRACT`, accepts only the Overlay renderer, and checks its arguments. Renderer settings patches cannot change `presets`, `completedOnboardingVersion`, or `schemaVersion`; those change only through Scene and onboarding operations.
3. **The onboarding reserve follows the window, not the renderer.** It opens only in settled Compact mode, because the renderer offsets its layout by the returned height. It closes in every mode, and Full screen remembers compact bounds without the reserve.

## Consequences

- 155 tests, 136 of which exercise behavior through module interfaces with fake windows, clocks, media devices, and ports. The remaining 19 static tests cover markup, CSS, and Electron wiring that has no interface.
- The onboarding reserve defect above is fixed and covered by sequence tests in `test/overlay-geometry.test.js`.
- Some ordering inside `main.js` and `overlay.js` is still checked only by source text or by the Windows Electron smoke (KG-05).
- The sandboxed preload cannot import `bridge.js`. Adding a channel means editing the table and `preload.cjs`; `test/bridge.test.js` fails until both agree.
- Renderer interactivity is now derived from one rule (chrome shown, or any of settings, onboarding, framing, resizing, dragging, or crop-dragging active). Previously six call sites each used a different subset. The result differs only when one of those activities ends while another is still active. Now the Overlay stays interactive in that case.
