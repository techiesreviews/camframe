# Verification run: Mac Full screen repaint without pointer input

- **Commit:** 2a72a3476a9c34aa9d72f611db680ba6b274cf47 (clean app source including the review correction; native result pending at write time).
- **Version:** Rust 0.1.0 test app beside Electron 0.9.0.
- **Observer:** GPT Sol; failed ARM captures and renderer snapshots inspected locally.
- **Environment:** Linux x64/Rust 1.98.1 for portable checks. Failing native runs: macOS 15.8.2 ARM, 1024 × 768, backing/capture scale 1.
- **Cameras:** Synthetic pattern only. No physical-camera or real-Mac human observation.
- **Related change/PR:** https://github.com/techiesreviews/camframe/pull/72. No merge or release.

## Automated checks

| Command/check | Result | Evidence/notes |
| --- | --- | --- |
| `kit doctor` | Pass | 12/12 checks. |
| `kit rust` on clean app source | Pass | `.scratch/kit-jobs/p7-clean-checks/log`: 72 test functions, formatting and Clippy. Linux does not compile the native Mac shim or Swift verifier. |
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

Opus found a rare deferral edge in this synchronous display route: GPUI's generic low-power or
thermal interval could skip the last repaint and hand it back to the same display link. Mac
overlay windows now set those two intervals to `None`, alongside the existing unrestricted
inactive-window interval. Thus a dirty resize repaint cannot take that throttle branch. Windows
window options stay unchanged. The animation still uses its original 280 ms duration and curves.

The six-trip verifier is retained without relaxed thresholds, extra pointer events or longer
settling delays. It checks four camera corners, toolbar scale, exact Compact return bounds and
clear Compact margins plus camera centre, raw and packaged. The 280 ms curves and the one-time
0 px/white frame migration stay unchanged. All diagnostic timers and logs are removed before
this source is tested, so a native pass will apply to the clean app.

Failure PNG upload remains `if: always()` under the native verification artifact. Side-by-side
comparison upload is conditional on comparison PNGs existing; a failed native check no longer
adds a misleading missing-comparison error.

## Follow-up, 2026-11-23: one stale entry in twelve, and a trace to explain it

Observer: Claude Fable 5.2, from the uploaded captures of
[run 45079004090](https://github.com/techiesreviews/camframe/actions/runs/45079004090) at
`86a9f1a`. Mac Intel passed. Mac ARM failed in
[job 137382731519](https://github.com/techiesreviews/camframe/actions/runs/45079004090/job/137382731519).

What the captures show:

- Only one of the twelve ARM entries failed: round 3 of six. `fullscreen-round-3.png` is the
  whole Compact scene stretched to 1024 × 768. Not one frame drawn after the click reached the
  screen, although the forced display ran on every resize step.
- `fullscreen-toolbar-round-3.png`, taken after the next pointer move, is correct. Every
  return to Compact is correct.
- The verifier captures about 1.2 s after the mouse button is released (500 ms inside the click
  helper, then 700 ms), so the stale picture is not a capture taken too early.

What is still unknown: why that one move was never shown. Three earlier readings do not hold up
as evidence:

- The app installs no `log` backend, so every GPUI warning or error (a skipped frame, a
  failed window update, a missing drawable) was dropped. `camframe-rust-output.txt` is empty.
- The earlier "dirty" and "woken" snapshot values were sampled while the demo camera marks the
  window dirty about 30 times a second. They do not show that the display link was silent.
- GPUI's forced display path stops the display link, presents one frame with the Core
  Animation transaction, then attaches a new display link, on every resize step. The frame
  only reached the screen at the next implicit transaction commit, after the new link existed.

Change in this follow-up (Mac only; Windows, the 280 ms curves, the 0 px/white frame defaults
and the verifier are untouched):

1. After the forced display, the shim commits the Core Animation transaction at once
   (`[CATransaction flush]`). The new window size and its picture now reach the screen in one
   step, before the re-attached display link can present anything. This is a reasoned
   mitigation, not a proven repair.
2. With `--demo-pattern` only, the app prints a resize trace to stderr, which the verifier
   already saves as `camframe-rust-output.txt`:
   - `[resize-trace] T ms: WxH frame A ms, paint B ms, drew N`: one line per native resize.
     `drew 0` means the forced display did not render. A large `paint` or a gap between lines
     means the main thread stalled.
   - `[resize-trace] T ms: settled, N renders since the last resize, …`: 150 ms and 350 ms
     after the last resize of a move, with GPUI's frame-source and renderer state. `0 renders`
     means no display-link frame arrived on its own.
   - `[gpui-log] …`: GPUI warnings and errors.

How to read the next ARM result: a stale entry with `drew 0` or a `[gpui-log]` error points at
GPUI skipping the draw. A stale entry with normal `drew 1` lines and rising settled renders means
frames are drawn but not shown, which points at the presentation path or the virtual display.
A stale entry with `0 renders` after settling points at the display link.

Checks for this follow-up: `kit doctor` 12/12; `kit rust` pass; `kit unit --affected` none
affected; `kit ux` blocked as before (no `docs/agents/features.md`). Linux cannot compile the
Mac shim (the Objective-C build script needs an Apple compiler), so only the native CI jobs
compile and run this change. No portable test can fail first for a Mac-only presentation
change; the six-trip native verifier is the failing test.

One green ARM run is weak proof: `86a9f1a` failed one entry in twelve, so an unrepaired build
would still pass a whole run about one time in three. Repeat the ARM job before trusting it.

## Follow-up 2, 2026-11-23: frames are drawn, one entry still stays stale

Observer: Claude Fable 5.2, from the captures and `camframe-rust-output.txt` of
[run 45083634125](https://github.com/techiesreviews/camframe/actions/runs/45083634125) at
`8b31e26` (the transaction commit and the trace above). Mac ARM failed in
[job 137397171158](https://github.com/techiesreviews/camframe/actions/runs/45083634125/job/137397171158)
on the raw binary; the packaged app was not reached. Mac Intel was still running and is not
read here.

What the run shows:

- Entry 2 of six failed (`fullscreen-round-2.png`): the Compact scene stretched to 1024 × 768.
  The other five entries, all six returns to Compact, and the capture after the next pointer
  move (`fullscreen-toolbar-round-2.png`) are correct.
- The trace line for the failing entry is the same as for the passing ones:
  `27893 ms: 1024x768 frame 0 ms, paint 4 ms, drew 1`, then 3 and 4 overlay renders 178 ms and
  380 ms later, display link attached and not paused, drawable size 1024 × 768. The only
  `[gpui-log]` line of the run is at startup. So the forced display drew, GPUI kept drawing, and
  GPUI reported no skipped frame and no missing drawable. In the reading guide above this is
  the second case: drawn but not shown.
- The transaction commit added at `c8f1b14` is therefore not a repair on its own.
- Each change of mode printed one resize line, at the final size. The 280 ms window move did
  not run on this runner, which fits Reduce Motion being on there. The stale entry does not
  need the animation.
- The stale picture shows the Full screen button with its keyboard-focus border. Focus goes
  back to the window on every change of mode, so that border only exists after this round's
  mouse-down: the picture was drawn in the 60 ms between mouse-down and the click taking
  effect, and it was on screen 1.2 s later. A frame drawn just before the resize ended up
  above the resize frame.
- In the five passing entries the test picture's moving ring advances by 110° to 122° between
  the Full screen capture and the toolbar capture. That only fits a live picture at both
  captures; a picture frozen at the resize would be about 18° behind. So in a passing entry
  display-link frames do reach the screen without pointer input, and the failing entry is a
  stuck state, not the normal one.

What is still unknown: why the frames drawn after the stale one did not replace it until a
pointer event arrived. The evidence fits a late present from the display link that the resize
stops, followed by a display link that presents nothing visible; it does not prove it. No real
Mac has shown this fault. It has only been seen on the virtual 1024 × 768 ARM runner.

Change in this follow-up (Mac only; Windows, the 280 ms curves, the 0 px/white frame defaults
and the verifier are untouched):

1. After the last resize of a move, the shim shows the picture again: 150 ms and 500 ms later
   it marks the GPUI window for a redraw and repeats the forced display and the transaction
   commit. A newer resize, applied or still queued, cancels the repeats. The first repeat comes
   several display frames after the move, when a late frame from the old display link would
   have landed; the second is one more chance. This is redundancy against a lost frame, not a
   repair of the cause.
2. The trace (`--demo-pattern` only) changes:
   - The resize line ends with `reduce motion true|false`, the value the app acts on.
   - `[resize-trace] T ms: shown again, paint B ms, drew N, R renders before it, …`: one line per
     repeat. `R` counts overlay renders since the display before it, and the state is sampled
     just before the repeat draws. `drew 0` means the repeat did not render.
   - `[resize-trace] T ms: not shown again, the window is closed or in use`: a repeat that
     could not enter the GPUI window. Only that repeat is skipped.
   - `[resize-trace] T ms: settled, N renders since it was last shown, …`: once, 1000 ms after
     the last resize, without drawing.

How to read the next ARM result: a stale entry with two normal `shown again … drew 1` lines
means a forced, committed frame can itself fail to reach the screen, and the fault is below
the app (window server or virtual display); repeating is then no cure and the next step is a
different way of resizing, not more repaints. A stale entry with `drew 0` or a `[gpui-log]`
error points at GPUI not drawing the repeat. A run without a stale entry proves little alone,
as before.

Checks for this follow-up, run on `3180d1a` and again after each of the two review-fix commits
that follow it: `kit rust` pass (tests, formatting and Clippy on Linux);
`kit unit --affected` none affected; `kit ux` fails as before (no `docs/agents/features.md`),
not counted as a pass. Linux still cannot compile the Mac shim: a check for the
`aarch64-apple-darwin` target stops in the Objective-C build script. So only the native CI jobs
compile and run this change, and no portable test can fail first.

## Follow-up 3, 2026-11-23: the repeat display never drew

Observer: Claude Fable 5.2, from the captures and `camframe-rust-output.txt` of
[run 45087539195](https://github.com/techiesreviews/camframe/actions/runs/45087539195) at
`5125ddd` (follow-up 2). Mac ARM failed in
[job 137409470258](https://github.com/techiesreviews/camframe/actions/runs/45087539195/job/137409470258)
on the raw binary; the packaged app was not reached.

What the run shows:

- Three of twelve moves kept the previous picture, stretched or shrunk to the new window size:
  Full screen entries 1 and 3 (`fullscreen.png`, `fullscreen-round-3.png`: the Compact scene
  over 1024 × 768) and the return to Compact in round 6 (`compact-after-escape-round-6.png`:
  the Full screen scene inside the Compact window). The verifier's "Escape did not repaint the
  Compact camera" is this same fault in the other direction, not a second fault. After the next
  pointer move both failed entries show the Full screen camera at the right size. In entry 1
  that capture, 400 ms after the move, still lacks the toolbar (the verifier's "reuses a scaled
  Compact scene" line; the camera in it is repainted, not scaled). In entry 3 it is correct.
- Every resize line after startup still reads `drew 1`.
- Every `shown again` line reads `paint 0 ms, drew 0`. The repeat displays of follow-up 2 never
  drew, so follow-up 2 was not tested by this run and its reading guide could not apply.
- The cause is a fault in the shim, not in GPUI. `display_now` asked the layer of the window's
  content view to display. GPUI's view is a subview of that content view
  (`gpui-pre-macos` 0.3.13, `window.rs`: `addSubview`), and its own backing layer is the Metal
  layer. Displaying the content view's layer draws nothing. The display right after a resize
  only drew because the Metal layer's bounds had changed and the transaction commit that
  follows displayed it.
- In 10 of the 12 moves, all six Full screen entries among them, the `settled` line, about
  500 ms after the second repeat marked the window for a redraw, reads
  `0 renders since it was last shown` with `dirty: true`, display link attached, not paused
  and woken. The window asked for a frame and the display link handed none out for half a
  second or more. Before that, 1 to 7 renders arrived between the two repeats. This happens in
  entries whose capture is correct too, so it does not explain the stale picture alone. The
  run before this one, without repeats, already showed only 4 to 5 renders in the first 450 ms
  after a move, for a test picture that changes 30 times a second. So slow or stopped frame
  delivery after a resize was there before follow-up 2.
- The one `[gpui-log]` error (`handling resize … RefCell already borrowed`) is the first line
  of the output, before the first resize line at 893 ms, and is the same first line in run
  45083634125. It is a resize callback at startup, not the repeat display: the first repeat
  cannot run until 150 ms after a resize line. The repeat already runs in a task on GPUI's
  foreground executor, between GPUI updates.

What is still unknown: why the display link stops handing out frames after a resize on this
runner, and why the frames drawn before it stops do not replace the stale picture. No real Mac
has shown the fault.

Change in this follow-up (Mac only; Windows, the 280 ms curves, the 0 px/white frame defaults
and the verifier are untouched):

1. `display_now` takes GPUI's own view, has that view's Metal layer displayed and commits the
   transaction. GPUI's displayLayer delegate draws with the transaction, without the display
   link, and attaches a fresh display link. The display after a resize and both repeats use it.
2. While it displays, the Metal layer may give up waiting for a free drawable after one second.
   GPUI normally waits without limit; if the stopped display link means that no drawable is
   free, the repeat would otherwise freeze the app. Follow-up 2 rejected this guard because the
   trace then showed drawables arriving; the `settled` lines above are the reason to add it.
3. After review (`342df14`): `display_now` displays the Metal layer itself before it commits,
   so the draw runs while the one-second limit is on, and afterwards it puts back the limit
   setting it found. This is a precaution; no trace has shown a draw outside the limit.

How to read the next ARM result:

- `shown again … drew 1` with a paint time of a few milliseconds on every line, and no stale
  capture: the repeat works as redundancy. Repeat the job two or three times before trusting it.
- A stale capture although both of its `shown again` lines read `drew 1` and no `[gpui-log]`
  error follows them: a frame drawn and committed by the app does not reach the screen. The
  fault is then below the app (window server or virtual display) and cannot be repaired from
  the app; the next step is a check on a real Apple Silicon Mac, not another repaint.
- `shown again` with a paint time near 1000 ms and
  `[gpui-log] ERROR … failed to retrieve next drawable`: the system holds every drawable. The
  count in `drew` is 1 in this case too, because it counts the scene being built, not the
  frame being presented. This also puts the fault below the app.
- `drew 0` again: the display did not reach GPUI's drawing. The trace does not say why; the
  shim is the first place to look.

Checks for this follow-up, run on `13e1f64` and again on `342df14`: `kit rust` pass (tests,
formatting and Clippy on Linux);
`kit unit --affected` none affected; `kit ux` fails as before (no `docs/agents/features.md`),
not counted as a pass. Linux cannot compile the Mac shim, so only the native CI jobs compile
and run this change, and no portable test can fail first.

## Review ledger

Earlier Opus reviews returned P3 findings and validation gaps; they did not prove native
correctness. Those historical approved review verdicts do not override the failed CI runs.
The clean native shim at `097d44c` received an immutable-commit Opus review: only a P3 throttling
edge and native-validation gaps, evidence `.scratch/reviews/fleet-lead/20261122T223758Z` in the
main checkout. The small Mac-only window-option correction at `2a72a34` addresses that edge;
it has local checks and awaits the final native jobs, without another nit round. No native
validation gap is claimed closed by review. A non-GPT second look was unavailable because Grok's weekly budget and OpenCode's free
usage were exhausted. No GPT fallback is authorized or used.

## Release decision

- **Decision:** No-go.
- **Reason:** Clean native repeated results and Lex's visual judgment are still required.
- **Known exceptions accepted by:** None added.
- **Follow-ups:** Run three native targets; inspect all ARM/Intel repeated raw and packaged captures; report the clean head. If this last repair fails, escalate to the lead with the trace evidence above.
- **Follow-ups after 2026-11-23:** Repeat the ARM job two or three times on the follow-up head and read `camframe-rust-output.txt` each time, pass or fail. Remove the resize trace, the `log` dependency and the render counter once the cause is settled. Ask for the fault to be looked for on a real Apple Silicon Mac: every sighting so far is on the virtual runner.
- **Follow-ups after follow-up 3:** Read the next ARM trace with the four readings in follow-up 3. If an entry is stale although its repeats drew, or no drawable is free, stop repainting from the app and take the real-Mac check to Lex.
