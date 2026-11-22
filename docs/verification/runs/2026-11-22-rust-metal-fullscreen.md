# Verification run: Mac Full screen repaint without pointer input

- **Commit:** edff3b718d594fb1a32be55b998bb81f67182938 (failing baseline; the accompanying implementation commit contains the correction).
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

## Build and artifact checks

| Target/check | Result at commit | Artifact/notes |
| --- | --- | --- |
| Windows | Not run | New-head CI must pass unchanged Windows checks. |
| Mac ARM | Not run | New-head CI must pass before claiming the repaint corrected. |
| Mac Intel | Not run | Same native verifier, including the packaged app. |

Final native results, screenshot inspection and download links are reported on PR #72 after the
builds complete, so recording the outcome does not start another native build.

## Manual checks

| ID | Result | Observation/evidence |
| --- | --- | --- |
| Baseline ARM screenshots | Fail | Downloaded [verification artifact](https://github.com/techiesreviews/camframe/actions/runs/45065633844/artifacts/14771217250). `fullscreen.png` stretches the old Compact camera, toolbar and handles across the new window. Top corners are `(218,218,218)` and bottom corners `(253,0,253)`. `fullscreen-toolbar.png`, taken after pointer movement, fills the screen with a normal-size toolbar. |
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
unchanged. Native CI tests the hypothesis against the original failing first Full screen capture.

The native verifier now records all four Full screen pixel values and rejects Finder/menu-bar
pixels as well as the magenta backdrop. It still takes its first Full screen image before the
next pointer movement. The pre-fix ARM image fails this stronger check at all four corners.

Failure PNGs were already uploaded by the workflow's final `if: always()` native-verification
step; that is how the failing image was obtained. That upload remains. The comparison upload
now runs only when comparison PNGs exist, so an earlier native failure does not add a second,
misleading missing-`verification-parity/*.png` error.

## Release decision

- **Decision:** No-go.
- **Reason:** Test build only; native results and Lex's try remain necessary.
- **Known exceptions accepted by:** None added.
- **Follow-ups:** Three green native jobs, inspect Full screen/toolbar captures, then report downloads to the lead.
