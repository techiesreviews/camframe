# Verification run: Rust final review fixes — 2026-11-21

- **Commit:** fixes after 467f236; final review round 2.
- **Version:** 0.1.0, unreleased Rust test app.
- **Observer:** implementation agent; independent review by Claude Opus 5.5 high.
- **Environment:** Linux x64, Rust 1.98.1, GPUI 0.3.13; native screenshots from Windows and Mac CI.
- **Cameras:** test picture only.
- **Related change/PR:** TOOLS-393, PR pending.

## Automated checks

| Command | Result | Counts/duration | Evidence/notes |
| --- | --- | --- | --- |
| `kit rust` | Pass | 39 core tests, 3 fixture suites, 17 app tests | Formatting and Clippy included. |
| `kit panel-text <old Mac camera capture>` | Fail, expected | 0 bright text pixels | Catches the missing native text that the old shape check missed. |
| `kit panel-text <Windows Camera/Style/Scenes captures>` | Pass | 86 text pixels each | Same probe on all three tabs. |

The new capture-selection test failed first with a missing `choose_device` function. It proves
that capture waits for the first inventory, uses native identity after list reordering, accepts
a unique trimmed imported name and falls back to the default when names are ambiguous.

## Build and artifact checks

| Target/check | Result | Artifact/hash/notes |
| --- | --- | --- |
| Windows complete build at 467f236 | Pass | Run 44940333124; native panels and installer checked. |
| Mac complete build at 467f236 | Shape checks passed; text failed inspection | Run 44940333101; the backend compiled without `font-kit` and used `NoopTextSystem`. |
| Fixed Mac native text | Pending | Enable the platform `font-kit` feature and add the pixel assertion to both native workflows. |

The missing-text cause is explicit in `gpui-pre-macos` 0.3.13's platform constructor: without
`font-kit` it selects `NoopTextSystem`. The feature is off by default in `gpui-pre-platform`.
The [upstream direct-GPUI instructions](https://github.com/longbridge/gpui-component/blob/fix/text-host-api/website/docs/getting-started.md#macos-text-rendering-font-kit)
document the same requirement. The app now enables it. Final native captures must pass the new
assertion before handoff; older Mac captures are regression evidence, not verification of labels.

## Manual checks

| ID | Result | Observation/evidence |
| --- | --- | --- |
| Real-camera quality rejection | Not run | Driver behavior still needs a physical camera. |
| Pointer and keyboard Scene reorder | Not run | The stale-drag path is corrected; native manual judgment remains. |
| NVDA / VoiceOver | Not run | No person or assistive technology attached here. |

## Review ledger

Round 2 evidence: `camframe/.scratch/reviews/fleet-lead/20261121T192506Z`. Only one main reviewer.

| ID | Severity | Outcome |
| --- | --- | --- |
| R2-1 | Test gap | Covered by the new identity/reordering test. |
| R2-2 | Test gap | Deferred: quality negotiation needs a driver seam. |
| R2-3 | Test gap | Deferred: shortcut table coverage; native CI compiles both adapters. |
| R2-4 | Test gap | Deferred: complete presentation decision table; geometry and hotspot tests remain. |
| R2-5 | P3 | Deferred: unused old PNG. The generated tray glyph is used. |
| R2-6 | P3 | Deferred: early run-document templates. Evidence remains factual. |
| R2-7 | P3 | Deferred: duplicate shortcut-error prefix. |
| R2-8 | P1 | Fixed: wait for the first camera inventory before attempting capture. |
| R2-9 | P3 | Fixed: imported camera names match only if unique after trimming. |
| R2-10 | P2 | Fixed: clear an old refusal notice on a fresh camera/quality request or Scene apply. |
| R2-11 | P2 | Fixed: synchronize the hex field after Scene apply, Undo, import and cue changes. |
| R2-12 | P2 | Fixed: clear pending Scene drag on release within or outside the root. |
| R2-13 | P3 | Fixed: retain the last successful quality separately from rejected requests. |
| R2-14 | P3 | Fixed: Compact cues keep the 390-pixel settings reserve. |
| R2-15 | Test gap | Covered by the new initial-inventory test. |
| R2-16 | Test gap | Deferred: complete cue application adapter tests. Validation and origin refusals are tested. |
| R2-17 | Test gap | Deferred: drag dispatch adapter test. |
| R2-18 | Test gap | Deferred: more transport refusal cases; host/origin validation tests remain. |

Keyboard framing now follows the same geometry path as the toolbar. Scene keyboard actions
retain focus, controls show focus in high contrast, and cue metadata reports requested size and
clamping consistently. These changes address adjacent behavior, without expanding the feature set.

## Regressions and surprises

CI shape, transparency and hit-testing checks did not detect invisible Mac text. The native
settings screenshot probe now prevents that false pass. It examines pixels inside the Camera
tab, excluding its border, at the native verifier's fixed crop size.

## Release decision

- **Decision:** No-go.
- **Reason:** Fixed native captures, final independent reviews, real-camera checks and Lex's try remain.
- **Known exceptions accepted by:** lead accepted R1-3 and R1-4; Part 4 records their reasons.
- **Follow-ups:** native CI, round 3, another-family second look, one PR without merging.
