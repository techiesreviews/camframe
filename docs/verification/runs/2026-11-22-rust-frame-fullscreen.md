# Verification run: Rust frame defaults and Full screen motion — 2026-11-22

- **Commit:** 22e453d370bdad0df5fcb472ed55a18d4d6a001d (final application source; later documentation commits do not change it).
- **Version:** Rust 0.1.0 test app beside Electron 0.9.0.
- **Observer:** GPT Sol; Claude Opus 5.5 high performed the independent review.
- **Environment:** Linux x64, Rust 1.98.1, Node 24; native CI results below.
- **Cameras:** Synthetic patterns only; no physical camera observed.
- **Related change/PR:** https://github.com/techiesreviews/camframe/pull/72 (no merge or release).

## Automated checks

| Command | Result | Evidence/notes |
| --- | --- | --- |
| `kit doctor` | Pass | 12/12 checks. Project runner guide absent. |
| `kit rust` before implementation | Fail as expected | `.scratch/kit-jobs/p3-all-red/log`: four regressions fail. Imported and earlier Rust files both retain `(6, "#ff8800")`; entering jumps to the edge and snaps square; leaving snaps to 288 px. |
| `kit rust` after implementation | Pass | `.scratch/kit-jobs/p3-green3/log`: formatting, 72 test functions and Clippy. |
| `kit rust` before exit-resolution fix | Fail as expected | `.scratch/kit-jobs/p3-exit-red/log`: no Full screen capture size during the shrink. |
| `kit rust` after exit-resolution fix | Pass | `.scratch/kit-jobs/p3-final-check2/log`: formatting, all 72 test functions and Clippy. |
| `kit unit --affected` | Pass | No affected Node suites; Rust uses `kit rust`. |
| `kit shots` | Pass | 25 Electron baseline captures in `.scratch/shots/2026-11-22T20-08-26-654Z`. Repeated after the exit-resolution fix: `.scratch/shots/2026-11-22T20-15-39-714Z`. This does not prove Rust motion. |
| `kit ux --base 1caa0dd` | Blocked | Missing `docs/agents/features.md`; repeated after the final visible change. Not counted as a pass. |
| `git diff --check` | Pass | Before each implementation commit. |
| `kit review --base 1caa0dd --pr 72` | Pass with P3 findings only | Claude Opus 5.5 high; `.scratch/reviews/fleet-lead/20261122T201355Z` in the main checkout. |
| `kit review --second-look` | Blocked | Non-GPT table only: Grok 8/8 weekly budget; OpenCode free usage limit. Skipped explicitly; no GPT fallback. |

The file tests exercise fresh settings, imported 0.9.0 settings, an earlier Rust file, a second
launch after migration, and a newly chosen 4 px `#123456` frame surviving restart. Other
preferences are retained; the original Electron file is unchanged.

Motion tests exercise the same camera-layout function used by rendering with deterministic
timestamps. Unchanged 0.9.0 CSS was sampled in Chromium by pausing its actual transitions at
0/70/140/210/280 ms while resizing the viewport along its original cubic window curve. At
140 ms both directions have camera `(left 9, top 42, width 705, height 511.5)` in viewport
`1122 × 735`. All position and size samples differ by less than 0.03 px. Reversal stays
continuous; starting with reduced motion has no surface animation. The exit test also requires
Full screen capture dimensions throughout the shrink, before restoring Compact capture.

## Build and artifact checks

| Target/check | Result | Artifact/notes |
| --- | --- | --- |
| Windows Portable and NSIS | Not run | Final-source [CI run](https://github.com/techiesreviews/camframe/actions/runs/45065412086) pending; download `camframe-rust-windows-x64` after it passes. |
| Mac ARM DMG/ZIP and packaged app | Not run | Final-source [CI run](https://github.com/techiesreviews/camframe/actions/runs/45065412071) pending; download `camframe-rust-macos-arm64-beta` after it passes. |
| Mac Intel DMG/ZIP and packaged app | Not run | Same Mac run; download `camframe-rust-macos-x64-beta` after it passes. |

## Manual checks

| ID | Result | Observation/evidence |
| --- | --- | --- |
| Live camera, 0 px frame, Full screen motion | Not run | Lex's next test build; no claim of physical-device proof. |
| All 71 features, NVDA/VoiceOver | Not run | Existing release gates remain open. |

## Regressions and surprises

- The prior [Mac ARM run](https://github.com/techiesreviews/camframe/actions/runs/45039459141) reported two transparent Full screen corners. A prior packaged-app capture in `.scratch/p2-arm-failed.zip` shows a stretched cached Compact scene, including oversized toolbar and corner handles. The resize fix explicitly synchronizes GPUI after AppKit applies the frame; native results determine whether it repairs that failure.
- The first Mac CI for `cd87fcf` caught a method-name clash: the raw handle trait won over GPUI's inherent `window_handle`. Commit `9b4a120` qualifies `Window::window_handle(window)`. [Failing Mac build](https://github.com/techiesreviews/camframe/actions/runs/45064880323).
- Local intermediate checks caught a float type annotation and test-module ordering; both were corrected before the passing checks. The first exit-resolution test compared unused rectangle origins as well as dimensions; it now checks the capture dimensions alone.
- GPUI uses a scalar corner radius. Intermediate rounded corners approximate CSS's elliptical radii; duration, position and dimensions match. Lex still needs to judge the visible motion beside 0.9.0.

## Review ledger

Reviewed with review-loop: 13 rounds with claude-opus-5-5. Verdict: approved.
This follow-up used one independent review; the kit numbers it round 13 because PR #72 retains
its earlier history. The report contains no P0, P1 or P2 findings. Nits do not trigger another round.

| Finding | Severity | Outcome |
| --- | --- | --- |
| R13-36 | P3 | Fixed: keep the larger capture size and suppress the Blur halo until the surface settles; regression failed first and now passes. |
| R13-37 | P3 | Fixed: this note now follows the dated verification template. |
| R13-38 | P3 | Declined: moving the pure helpers into core adds a structural refactor to two narrow visual fixes. App tests already execute the exact functions used by rendering. |
| R13-39 | Validation gap | Native results and final artifact links are recorded after the builds finish. |
| R13-40 | Validation gap | Deferred: existing code clears the surface transition and completes window bounds when reduced motion changes live; only reduced-motion starts are covered by these unit tests. |
| R13-41 | Validation gap | Deferred: existing native captures cover small/large menus and shape changes, but do not measure toolbar width immediately after every shape change. |
| Earlier R13-1 through R13-35 | P3 or validation gap | Historical findings outside this follow-up; not claimed resolved. |

Declined: R13-38 — keep the tested geometry helpers next to their only consumer for this narrow
fix; a core-module move does not change behavior. The optional handle-position nit is deferred:
0.9.0 also displays Compact handles during the shrink; changing it would add a new difference.
Second look: skipped (Grok weekly review budget exhausted; OpenCode free usage limit reached).

Done when 1: not met — frame reset and camera-layout regressions are proven locally; complete
71-feature Windows/Mac parity and physical-camera checks remain open.
Done when 2: not met — no new real-camera size/startup/memory comparison in this follow-up.
Done when 3: not met — Lex has not approved release; PR #72 remains unmerged.

## Kit result lines

```text
RESULT: ok doctor 12/12 checks passed
RESULT: fail cargo test
RESULT: fail cargo clippy
RESULT: pass cargo test and clippy (rust/)
RESULT: ok unit none affected
RESULT: ok shots 25 screenshots evidence /home/ubulex/Projects/camframe-tools-393-sol/.scratch/shots/2026-11-22T20-15-39-714Z
RESULT: fail ux ENOENT: no such file or directory, open '/home/ubulex/Projects/camframe-tools-393-sol/docs/agents/features.md'
RESULT: ok review git diff 1caa0dd14757159ce46f916e720cfab52b3784d0...HEAD evidence /home/ubulex/Projects/camframe/.scratch/reviews/fleet-lead/20261122T201355Z
RESULT: skip second look (grok-4.7 grok review budget used up: 8/8 in 2026-W47; raise ASE_REVIEW_BUDGET_GROK to override; opencode/deepseek-v4.1-flash-free opencode usage limit: Free usage limit reached. Connect a provider or subscribe to OpenCode Go to keep going, or switch models.)
RESULT: fail status cut
```

Repeated identical failure/result lines are listed once. The failed `kit status --help` recovery
probe reports a removed command; it is not a project validation failure. Main review evaluated
`cd87fcf`; follow-ups qualify the Mac handle and fix its P3 exit-resolution finding. The final
small corrections have local regression checks and await native CI; they have no separate review.

## Release decision

- **Decision:** No-go.
- **Reason:** Test build only; no merge or release authorized.
- **Known exceptions accepted by:** Existing ADR 0042 scope; lead approved the one-time frame reset in ADR 0043.
- **Follow-ups:** Final native CI and test downloads, then Lex's side-by-side trial.
