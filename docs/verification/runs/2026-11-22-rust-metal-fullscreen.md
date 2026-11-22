# Verification run: Mac Full screen repaint without pointer input

- **Commit:** 097d44ce2d10e9ca5ab1eb48c6a3fd94eda1ec27 (clean app source; native result pending at write time).
- **Version:** Rust 0.1.0 test app beside Electron 0.9.0.
- **Observer:** GPT Sol; failed ARM captures and renderer snapshots inspected locally.
- **Environment:** Linux x64/Rust 1.98.1 for portable checks. Failing native runs: macOS 15.8.2 ARM, 1024 × 768, backing/capture scale 1.
- **Cameras:** Synthetic pattern only. No physical-camera or real-Mac human observation.
- **Related change/PR:** https://github.com/techiesreviews/camframe/pull/72. No merge or release.

## Automated checks

| Command/check | Result | Evidence/notes |
| --- | --- | --- |
| `kit doctor` | Pass | 12/12 checks. |
| `kit rust` on clean app source | Pass | `.scratch/kit-jobs/p7-checks/log`: 72 test functions, formatting and Clippy. Linux does not compile the native Mac shim or Swift verifier. |
| `kit unit --affected` | Pass | No affected Node suites. |
| `kit ux --base 052a5df` | Blocked | Existing missing `docs/agents/features.md`; not counted as a pass. |
| `git diff --check` | Pass | Before the clean implementation commit. |
| Runtime diagnostic cleanup | Pass | No `[DEBUG-p6]` code remains under `rust/app/src`; timers and transition logging removed. |
| Six native round trips on the clean source | Not run | Pending new-head CI; no success claimed at commit time. |

## Build and artifact checks

| Target/check | Result on clean source | Evidence/notes |
| --- | --- | --- |
| Windows Portable/NSIS | Not run | Final native workflow pending. App timing/defaults unchanged. |
| Mac ARM raw/packaged app | Not run | Must pass all six enter/Escape trips in each binary. |
| Mac Intel raw/packaged app | Not run | Same strict repeated checks. |

Final native job links, all repeated pixel values, capture inspection and test-download links
are recorded on PR #72 once the jobs finish. These results must name this clean app source,
not the earlier instrumented candidate.

## Manual checks

| ID | Result | Observation/evidence |
| --- | --- | --- |
| ARM entry on `edff3b7` | Fail | [Run 45065633844](https://github.com/techiesreviews/camframe/actions/runs/45065633844/job/137341151579): full-size native frame contains a stretched Compact scene. |
| ARM entry on `e9c45f5`, one run only | Inconclusive | [Artifact 14774943715](https://github.com/techiesreviews/camframe/actions/runs/45075229896/artifacts/14774943715) showed correct raw/packaged images, but later identical app code failed again. This single pass does not prove a reliable repair. |
| Reverse probe on `e200df8` | Fail in fixture | [Artifact 14775193395](https://github.com/techiesreviews/camframe/actions/runs/45075847277/artifacts/14775193395): Compact camera already correct; white corner is Finder covering the magenta backdrop. Corrected at `94d66ec` by restoring the known backdrop before the round trip, without changing assertions. |
| ARM entry on `94d66ec` | Fail | [Run 45076554787](https://github.com/techiesreviews/camframe/actions/runs/45076554787/job/137375053918): stretched Compact scene recurs despite the valid backdrop correction. |
| Six ARM trips on instrumented `052a5df` | Fail | [Artifact 14776420043](https://github.com/techiesreviews/camframe/actions/runs/45077351007/artifacts/14776420043): every entry fails. Images and `camframe-rust-output.txt` inspected locally under `.scratch/p7-arm-before/`. |
| Final clean images and physical camera | Not run | Pending native CI and Lex's real-Mac comparison. |

## Regressions and surprises

The instrumented run narrows the failure beyond the native window frame:

- All 24 renderer snapshots report content size equal to viewport size, and both equal to the
  requested native frame. Full screen is 1024 × 768; Compact is 324 × 264.
- `CAMetalLayer.drawableSize` also matches those dimensions; cached/platform/contents scales
  are all 1. This rules out a missing drawable-size or Retina-scale update in this failure.
- No deferred GPUI window update failed. The Metal frame source is attached and reports
  unpaused in all 24 snapshots, yet 21 snapshots retain a dirty scene.
- No transition render was recorded during any of the six 280 ms moves. Raising the backdrop
  did not fix the enlarged Compact controls. This remains an app frame-delivery failure.

Earlier attempts synchronized GPUI and requested a future Metal frame. `display: NO` alone
also failed every repeated entry. The clean repair keeps that ordering but explicitly requests
AppKit backing-layer display **after** `handle.update` returns. GPUI's `displayLayer` delegate
can then draw the synchronized scene through its native display path instead of waiting for a
Metal display-link update. Running it inside the GPUI window update would re-enter a borrowed
window; running it before synchronization would display the old geometry. The clean shim
therefore applies bounds, synchronizes GPUI, releases that borrow, then invalidates and displays
the retained window's backing layer. No manual change to drawable size or scale is needed.

The six-trip verifier is retained without relaxed thresholds, extra pointer events or longer
settling delays. It checks four camera corners, toolbar scale, exact Compact return bounds and
clear Compact margins plus camera centre, raw and packaged. The 280 ms curves and the one-time
0 px/white frame migration stay unchanged. All diagnostic timers and logs are removed before
this source is tested, so a native pass will apply to the clean app.

Failure PNG upload remains `if: always()` under the native verification artifact. Side-by-side
comparison upload is conditional on comparison PNGs existing; a failed native check no longer
adds a misleading missing-comparison error.

## Review ledger

Earlier Opus reviews returned P3 findings and validation gaps; they did not prove native
correctness. Those historical approved review verdicts do not override the failed CI runs.
The clean implementation has a separate immutable-commit review; its result is reported on
PR #72. A non-GPT second look was unavailable because Grok's weekly budget and OpenCode's free
usage were exhausted. No GPT fallback is authorized or used.

## Release decision

- **Decision:** No-go.
- **Reason:** Clean native repeated results and Lex's visual judgment are still required.
- **Known exceptions accepted by:** None added.
- **Follow-ups:** Run three native targets; inspect all ARM/Intel repeated raw and packaged captures; report the clean head. If this last repair fails, escalate to the lead with the trace evidence above.
