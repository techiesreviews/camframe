# Verification run: Mac Full screen repaint without pointer input

- **Commit:** 43b0ca16978cbeeb8e5250cb8bb3e419c7e56667 (checked app source, including the small review corrections). The repaint repair was independently reviewed at e9c45f5d8ba7eaf575346d00bd2b395e9b8fd6b6; failing baseline edff3b718d594fb1a32be55b998bb81f67182938.
- **Version:** Rust 0.1.0 test app beside Electron 0.9.0.
- **Observer:** GPT Sol; native screenshots inspected locally.
- **Environment:** Local Linux x64, Rust 1.98.1; failing CI macOS 15.8.2 ARM at 1024 × 768, capture scale 1. Intel at 1920 × 1080 passed.
- **Cameras:** Synthetic camera pattern only.
- **Related change/PR:** https://github.com/techiesreviews/camframe/pull/72

## Automated checks

| Command/check | Result | Evidence/notes |
| --- | --- | --- |
| Baseline ARM native verifier | Fail | [Run 45065633844](https://github.com/techiesreviews/camframe/actions/runs/45065633844/job/137341151579): two transparent Full screen corners. |
| `kit doctor` | Pass | 12/12 checks. |
| `kit rust` | Pass | `.scratch/kit-jobs/p4-checks/log`: 72 tests, formatting and Clippy. |
| `kit unit --affected` | Pass | No affected Node tests. |
| `kit ux --base edff3b7` | Blocked | Existing missing `docs/agents/features.md`; not counted as a pass. |
| `git diff --check` | Pass | Before committing the correction. |
| `kit rust` after review corrections | Pass | `.scratch/kit-jobs/p4-final-rust/log`: 72 tests, formatting and Clippy. |
| `kit shots` | Pass | 25 baseline captures, `.scratch/shots/2026-11-22T22-00-38-525Z`; repeated after the small guard correction. |
| `kit review --base edff3b7 --pr 72` | Pass with P3 only | Opus 5.5 high; main checkout `.scratch/reviews/fleet-lead/20261122T220431Z`. |
| Non-GPT second look | Blocked | Grok weekly budget 8/8; OpenCode free usage limit; skipped explicitly, no GPT fallback. |

## Build and artifact checks

| Target/check | Result at commit | Artifact/notes |
| --- | --- | --- |
| Windows | Not run | New-head CI must pass unchanged Windows checks. |
| Mac ARM | Pass at e9c45f5 | [Push run 45075229896](https://github.com/techiesreviews/camframe/actions/runs/45075229896/job/137370883310), both the raw binary and packaged app. The final follow-up also checks Compact repaint after Escape. |
| Mac Intel | Not run | Same native verifier, including the packaged app. |

Final native results for all three platforms, screenshot inspection and download links are reported on PR #72 after the
builds complete, so recording the outcome does not start another native build.

## Manual checks

| ID | Result | Observation/evidence |
| --- | --- | --- |
| Baseline ARM screenshots | Fail | Downloaded [verification artifact](https://github.com/techiesreviews/camframe/actions/runs/45065633844/artifacts/14771217250). `fullscreen.png` stretches the old Compact camera, toolbar and handles across the new window. Top corners are `(218,218,218)` and bottom corners `(253,0,253)`. `fullscreen-toolbar.png`, taken after pointer movement, fills the screen with a normal-size toolbar. |
| Repaired ARM screenshots | Pass | Inspected [artifact 14774943715](https://github.com/techiesreviews/camframe/actions/runs/45075229896/artifacts/14774943715): `fullscreen.png` and `fullscreen-toolbar.png`, raw and packaged. All corners show the gradient: top `(24,72,207)` / `(59,72,207)`, bottom `(24,181,128)` / `(59,181,128)` in PNG bytes. Native profile-converted samples also pass. Toolbar stays normal size. |
| Baseline Intel screenshots | Pass | [Verification artifact](https://github.com/techiesreviews/camframe/actions/runs/45065633844/artifacts/14770904592): four corners contain the camera gradient. |
| Physical camera and Lex's animation comparison | Not run | Remain human checks; no release or merge authorized. |

## Regressions and surprises

The failure is a stale drawn scene, not an undersized native frame, a corner-radius calculation
at the end of the morph, or Retina scaling. The native Full screen size check passes, the ARM
capture scale is 1, and the same scene becomes correct after pointer input without resizing.

Source inspection shows GPUI's Metal frame source pauses when a callback consumes no drawable
and asks for no further frame. Ordinary invalidation wakes it only on the clean-to-dirty edge.
An explicit next-frame callback after `bounds_changed` adds frame demand, wakes the platform,
and refreshes the whole scene without depending on another input event. This is the only app
behavior change in this correction. The 280 ms bounds/surface curves and frame defaults stay
unchanged. Native ARM CI now passes the original failing first Full screen capture, before pointer movement, both raw and packaged. The earlier failed synchronization-only attempt and this repair are recorded in [the Mac experiment](../../experiments/2026-11-21-rust-gpui-bubble-macos.md).

The native verifier now records all four Full screen pixel values and rejects Finder/menu-bar
pixels as well as the magenta backdrop. It still takes its first Full screen image before the
next pointer movement. The pre-fix ARM image fails this stronger check at all four corners.

Failure PNGs were already uploaded by the workflow's final `if: always()` native-verification
step; that is how the failing image was obtained. That upload remains. The comparison upload
now runs only when comparison PNGs exist, so an earlier native failure does not add a second,
misleading missing-`verification-parity/*.png` error.

## Review ledger

Reviewed with review-loop: 14 rounds with claude-opus-5-5. Verdict: approved.
The kit includes previous PR history; this repair used one focused independent review and
stopped when only P3 findings remained.

- R14-40 (P3): fixed the existing Blur draw guard so the cached halo stays hidden during the surface transition, matching capture suppression.
- R14-41/R14-42/R14-43 (P3): corrected commit metadata, recorded the failed ARM baseline, and added experiment outcomes.
- R14-44 (validation gap): the native verifier now captures Compact after Escape before moving the pointer and checks a transparent corner plus the drawn camera centre.
- R14-45 (validation gap): deferred pure halo-policy extraction and extra tests; the guard is a direct one-line correction. Existing motion/capture tests and native checks remain in force.
- Older inherited nits/gaps remain historical; none is claimed resolved here.

Second look: skipped (Grok weekly budget exhausted; OpenCode free usage limit). The small
review corrections were checked locally and by the final native jobs, without another nit round.

## Release decision

- **Decision:** No-go.
- **Reason:** Test build only; native results and Lex's try remain necessary.
- **Known exceptions accepted by:** None added.
- **Follow-ups:** Three green native jobs, inspect Full screen/toolbar captures, then report downloads to the lead.
