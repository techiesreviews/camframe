# Verification run: Rust scrollbar and contrast fixes — 2026-11-22

- **Commit:** 64fa88b3847b2a5e0ac75fa023821ee5266de1f4 (implementation; the accompanying evidence commit has identical Rust source).
- **Version:** Rust 0.1.0 test app beside Electron 0.9.0.
- **Observer:** GPT Sol; one focused Claude Opus 5.5 high review requested after local checks.
- **Environment:** Linux x64, Rust 1.98.1, Node 24; Windows/Mac native CI not yet completed at write time.
- **Cameras:** Synthetic patterns only.
- **Related change/PR:** https://github.com/techiesreviews/camframe/pull/72

## Automated checks

| Command | Result | Counts/duration | Evidence/notes |
| --- | --- | --- | --- |
| `kit doctor` | Pass | 12/12 | Project runner guide remains absent. |
| `kit rust` before fix | Fail as expected | 18 app tests passed; 2 new regressions failed | `.scratch/kit-jobs/p2-tests-red2/log`: legacy rail selected instead of hidden overlay; file edge contrast below 7:1. The first test attempt had a corrected test-only color-conversion compile error. |
| `kit rust` after fix | Pass | 67 test functions, fmt and Clippy | `.scratch/kit-jobs/p2-tests-green2/log` |
| `kit unit --affected` | Pass | None affected | Rust uses `kit rust`. |
| `kit shots` | Pass | 25 Electron baseline captures | `.scratch/shots/2026-11-22T15-33-16-654Z` |
| `kit ux` | Blocked | Missing feature list | `docs/agents/features.md` does not exist; not counted as a pass. |
| `git diff --check` | Pass | | |

## Build and artifact checks

| Target/check | Result | Artifact/hash/notes |
| --- | --- | --- |
| Windows Portable and NSIS | Not run | New-head CI provides the test artifacts. |
| Mac ARM DMG/ZIP | Not run | Real AppKit captures cover both scrollbar settings. |
| Mac Intel DMG/ZIP | Not run | Same checks as ARM. |

## Manual checks

| ID | Result | Observation/evidence |
| --- | --- | --- |
| R11-32 | Portable policy test passes; native captures not yet completed | Read `NSScroller.preferredScrollerStyle` at launch and in the existing one-second live preference scan. Legacy reserves 15 px; Overlay reserves no width, displays a thin thumb during scrolling/drag and hides it after 750 ms idle. Reusing the existing scan avoids a separate notification observer's ownership/lifetime. |
| R11-33 | Pass in regression test | File buttons use the shared TEXT token in high contrast. The test composites the edge on the panel and requires at least 7:1 contrast, while retaining the faint normal-theme edge. |
| Physical cameras, NVDA/VoiceOver and contrast themes | Not run | Existing release gates remain open. |

## Regressions and surprises

- Windows retains its existing 17 px reserved rail; the preference getter returns false there.
- Mac native verifier adds `scenes-overlay-panel.png` and `scenes-legacy-panel.png`. It uses AppKit's standard `-AppleShowScrollBars` argument-domain setting, without changing the user's stored global preference. A rail-edge pixel (x=280, outside the thumb) must be dark for WhenScrolling and white for Always. The first probe was at x=274, which a correct grey thumb can cover; the coordinate was corrected without changing application code.
- The previous run's R11-32/R11-33 open ledger is historical. This follow-up is the lead-authorized correction and asks Opus to mark those exact IDs resolved, reviewing only changes since `1599459`.

## Focused review

One Claude Opus 5.5 high review of the changed lines since `1599459` completed at `cab71cc`.
It explicitly marks R11-32, R11-33, and their policy/contrast tests resolved; no functional
findings remain. Evidence: `.scratch/reviews/fleet-lead/20261122T153804Z` in the main checkout.
Only P3 documentation notes and validation gaps remain. After review, only this evidence
and the native screenshot probe coordinate were corrected; application code is unchanged.
A track-click thumb timeout nit and broader interaction tests remain non-blocking follow-ups.

## Release decision

- **Decision:** No-go
- **Reason:** Test build only; no merge or release authorized.
- **Known exceptions accepted by:** Existing ADR 0042 scope remains unchanged.
- **Follow-ups:** Focused review, new-head native CI and artifact links are reported in PR #72. Physical-device release gates still require human validation.
