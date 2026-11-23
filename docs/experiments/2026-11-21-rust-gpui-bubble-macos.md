# Experiment: Rust GPUI bubble on macOS

- **Date started:** 2026-11-21
- **Owner:** fleet (Claude Opus 5.5 helper)
- **Status:** Inconclusive (the see-through window passed in CI; real-Mac camera check still open)
- **Related issue/PR/ADR:** Orbit TOOLS-394; trial branch `trial/rust-gpui-bubble` (TRIAL ONLY, never merged); no PR
- **Baseline commit/version:** 4d600c8 (Windows-only Rust GPUI trial)

## Question

Can the Rust GPUI trial bubble show the camera in a see-through, always-on-top circle on macOS, with live shape switching, like it does on Windows?

## Hypothesis and success threshold

GPUI's macOS backend can do it once its pop-up `NSPanel` is made borderless, shadowless and clear. Pass: on a GitHub `macos-15` runner, with a magenta window behind the bubble, the window corners, the circle corner probe (48,86) and a point just below the bubble show magenta; the centre does not; a real right-click switches to the rounded square (probe no longer magenta, corners still magenta) and on through portrait and landscape; the window layer is above normal windows.

## Baseline

Commit 4d600c8 builds and passes its pixel check on Windows only. On macOS GPUI (gpui-pre-macos 0.3.13) creates `WindowKind::PopUp` as an `NSPanel` with a *titled*, full-size-content style mask, so macOS keeps a window shadow and title-bar area, and `hidesOnDeactivate` is on. The macOS backend's window-control hit test is a no-op, so `WindowControlArea::Drag` does not move the window.

## Variants

- **A (245c9b6 and its review fixes):** `rust-trial/src/mac_overlay.rs` sets the panel to borderless and non-activating, no shadow, not opaque, clear background, pop-up level, every Space and full-screen apps, and not hidden on deactivate. A left mouse-down on the bubble calls `Window::start_window_move()`. On macOS the capture thread asks for camera permission and falls back to the demo pattern only when there is no camera or access is denied.

## Method

Automated only (no Mac hardware with a camera in this loop): `.github/workflows/trial-rust-gpui-macos.yml` runs `cargo test`, Clippy, a release build, then `rust-trial/scripts/verify-macos.swift` against the raw binary and against the ad-hoc-signed `CamFrame Trial.app` binary. It saves screenshots and `benchmark.json` (size, window-visible time, first-frame time, memory).

## Results

| Variant | Automated evidence | Manual evidence | Outcome |
| --- | --- | --- | --- |
| Baseline | macOS not built | none | n/a |
| A | macOS run 44898391800 and Windows run 44898391899 at a97c64b, both green | none | Pass |

Run 44898391800 (macOS 15.8.2, Apple Silicon), raw binary / signed app binary:

- Every see-through probe read the backdrop, rgb(255,64,255) (the runner's colour profile shifts pure magenta): circle corners, circle corner probe (48,86), 8 pt and 6 pt below the bubble, rounded-square corners, portrait side strip, landscape top and bottom strips. Every centre read the demo pattern, rgb(51,146,183).
- A real right-click switched circle → rounded square (probe became rgb(33,107,210)) → portrait → landscape.
- Window layer 101 (above normal windows), size 324×362 (no title bar), one window. With Finder active and its window behind the bubble, the corners showed Finder and the bubble stayed on top.
- Drag moved the window by exactly (120, 60).
- Binary 6.86 MB (zipped app 2.96 MB). Window visible after 1290 / 617 ms, first frame 1119 / 505 ms. Memory 29.8 / 29.2 MB resident, 19 / 22 MB footprint.

Earlier runs 44897326133 and 44897861894 failed only on the verifier's own reference checks (magenta threshold, Finder window behind the bubble); their screenshots showed the same correct bubble.

## Interpretation

GPUI's Metal renderer handles per-pixel transparency on macOS once the panel is borderless, shadowless and clear. Not proven by CI: the real camera (runners have none), the camera permission prompt, and Gatekeeper on a downloaded app. Two quirks seen in the screenshots: the hover pill stays visible after a synthetic mouse leaves the bubble, and the `1` key change was drawn only after the next event (`keyboardShapeSwitch: false` in the report, though the later screenshot shows the circle). Both may come from synthetic events on a runner and need a check on a real Mac.

## Disposition

Inconclusive: the see-through, always-on-top bubble and the shape switch passed on a macOS CI desktop, but the real camera, the permission prompt and Gatekeeper are unproven. The code stays on `trial/rust-gpui-bubble` only (TRIAL ONLY, never merged into main or dev). Code: `rust-trial/src/mac_overlay.rs`, macOS parts of `camera.rs` and `overlay.rs`, `rust-trial/scripts/verify-macos.swift`, `.github/workflows/trial-rust-gpui-macos.yml`. Artifacts: the CI run's `camframe-rust-gpui-trial-macos-arm64` and `camframe-rust-gpui-trial-verification-macos` downloads. Next discriminating test: open the downloaded app on a real Mac with a camera and check the Gatekeeper steps, the permission prompt, live video and that the hover pill hides when the mouse leaves.

## Follow-up

2026-11-21: the trial code moved on into the full Rust rebuild (Orbit TOOLS-393, ADR 0041). Its successor lives in `rust/` (`rust/app/src/mac_overlay.rs`, `rust/scripts/verify-macos.swift`) and is checked by `.github/workflows/rust-macos.yml`; the open questions above (real camera, permission prompt, Gatekeeper, hover pill hiding) are carried over to that work.


### 2026-11-22: Full screen repaint without mouse input

The successor app at `edff3b7` still failed on ARM even after deferring `setFrame` and explicitly
calling GPUI `bounds_changed` (`cd87fcf` / `9b4a120`). [Run 45065633844](https://github.com/techiesreviews/camframe/actions/runs/45065633844)
shows a correctly sized 1024 × 768 native window containing the old Compact scene stretched to
fill it. Its bottom corners remain magenta; moving the pointer produces the correct scene.
Synchronization alone is therefore insufficient; the failing capture scale is 1.

Variant B (`e9c45f5`) adds an explicit GPUI next-frame callback after native resize. GPUI's
Metal source is demand driven; the callback calls both `schedule_frame` and the platform
waker, then refreshes the scene. Pass threshold: all four corners show the demo camera in the
first Full screen capture before any further pointer event, and the toolbar stays normal size.

ARM [push run 45075229896](https://github.com/techiesreviews/camframe/actions/runs/45075229896)
passes for the raw binary and packaged app. GPT Sol inspected both Full screen PNGs and both
toolbar PNGs: no transparent corners or stretched Compact controls. A small follow-up at
`43b0ca1` adds the reverse check: after Escape, Compact must repaint before another pointer
event. Final Windows/ARM/Intel results and artifact links are recorded on PR #72.

Disposition at the single-run checkpoint (superseded by the later failures below): retain the explicit frame-demand attempt for further testing. The frame-bounds sync stays;
no change to the 280 ms motion curve or frame-default migration. Physical-camera and real-Mac
permission/Gatekeeper checks remain open, as above.

The reverse probe added at `43b0ca1` failed on ARM in run `45075847277`, but the image shows
correct Compact rendering over Finder. The probe expected the magenta window that Finder had
covered earlier. The follow-up restores the controlled backdrop before the round trip and
retains the strict transparency assertion; it does not change the app or insert pointer input
after Escape. The failing image and diagnosis are recorded in the Metal verification run.

The next ARM run (`45076554787`, source `94d66ec`) again captured a stretched Compact scene on
entry, even with explicit frame demand. The corrected Escape fixture passed. The earlier
single-run pass is therefore insufficient evidence for the frame-demand-only repair.

Variant C (`e953c3c`) sets the native window frame with `display: NO` instead of asking AppKit
to display immediately. GPUI then presents after viewport synchronization. Temporary demo-only
window/frame diagnostics distinguish failed deferred updates from stale cache/presentation.
The verifier now runs six round trips per raw and packaged app. Native results are pending;
remove the temporary diagnostics after evaluating the captured evidence. This supersedes the
earlier confidence in variant B; no reliable Full screen result is claimed until this run passes.


Variant C failed every ARM entry in `45077351007` at `052a5df`. The 24 diagnostic snapshots
showed correct native/content/viewport/drawable dimensions and scale, no failed deferred window
updates, and an attached, unpaused Metal source. Nevertheless, 21 snapshots were dirty, and
there were no transition renders. Deferring immediate AppKit display alone is rejected as a
repair. The earlier variant B single pass remains inconclusive, not evidence of reliability.

Variant D (`097d44c`) explicitly invalidates and displays the native backing layer after the
GPUI viewport update has returned. This uses GPUI's AppKit `displayLayer` path without waiting
for a display-link update or re-entering a borrowed GPUI window. The six strict round trips
remain. All temporary diagnostic timers/logs were removed before this source is tested.
Status: native validation pending; no reliable repair is yet claimed. The current dated run is
[the Metal repaint verification](../verification/runs/2026-11-22-rust-metal-fullscreen.md).

Opus's immutable review of variant D identified a P3 edge where GPUI's generic low-power or
thermal frame interval could defer the final synchronous repaint to the stalled link. The
small Mac-only correction at `2a72a34` sets those intervals to `None`; Windows options are
unchanged. All temporary traces are removed. Final repeated native results remain pending.

### 2026-11-23: variant D fails one entry in twelve

Variant D with the pacing correction (`86a9f1a`) passed Mac Intel and failed Mac ARM in run
`45079004090`: one entry of twelve (round 3) showed the Compact scene stretched over the full
window until the next pointer move. Forced display on every resize step is therefore better
than the display link alone (which failed every entry) but not reliable.

The cause is not proven. The earlier diagnostics could not prove it: the app had no `log`
backend, so GPUI's own errors were dropped, and the dirty/woken snapshots were taken while the
demo camera kept the window dirty.

Variant E keeps variant D and commits the Core Animation transaction straight after the forced
display, so each new window size reaches the screen together with its picture and before
GPUI's re-attached display link can present. It also adds a `--demo-pattern`-only resize trace
and a stderr logger for GPUI warnings, described in
[the Metal repaint verification](../verification/runs/2026-11-22-rust-metal-fullscreen.md).
Status: uncertain. Native results pending; one green ARM run would not prove reliability,
because variant D alone passes a whole run about one time in three.

Rejected without a trial in this round: animating inside a window that is already full size
(changes both move directions and the 0.9.0 window motion), extra repaint requests after the
move (later frames did not reach the screen either, so this would only hide the cause), and any
relaxed or longer verifier step.

### 2026-11-23: variant E fails one entry in six

Variant E (`c8f1b14`, tested at `8b31e26`) failed Mac ARM in run `45083634125`: entry 2 of six
on the raw binary showed the stretched Compact scene until the next pointer move. Disposition:
rejected as a repair on its own. The transaction commit stays: it is harmless and variant F
reuses it.

The trace settled one question. For the failing entry it reads like every passing one: the
forced display drew one frame in 4 ms, GPUI drew 3 and then 4 more overlay renders, the display
link was attached and not paused, and GPUI logged no skipped frame or missing drawable. Frames
are drawn and handed to the system, and one entry is still not shown. Two details from the
captures narrow it further: the stale picture carries the focus border that only this round's
mouse-down can produce, so it was drawn within 60 ms before the resize and ended up above the
resize frame; and in passing entries the moving ring of the test picture shows that display-link
frames reach the screen without pointer input. Details are in
[the Metal repaint verification](../verification/runs/2026-11-22-rust-metal-fullscreen.md).

Variant F keeps variant E and shows the picture again after the last resize of a move: 150 ms
and 500 ms later the shim marks the GPUI window for a redraw and repeats the forced display and
the transaction commit. A newer resize cancels the repeats. The trace gains a line per repeat,
a late sample without drawing, and the Reduce Motion state.

This revises the rejection above of "extra repaint requests after the move". That rejection
was about asking the display link for more frames, which variants B and C had already shown to
be unreliable. Variant F repeats the one path that has put the right picture on screen in
every observed passing entry (a synchronous draw committed with its transaction), at a moment
when a late frame from the old display link has landed. The objection that it does not explain
the cause still stands: variant F is redundancy against a lost frame. If a stale entry appears
with two normal repeat lines in the trace, repainting is ruled out as a cure and the fault is
below the app.

Status: uncertain. Native results pending. One green ARM run is weak proof, as before. The
fault has only been seen on the virtual 1024 × 768 ARM runner, with Reduce Motion apparently
on, so the 280 ms window move itself is not exercised there.

Rejected without a trial in this round: keeping every present inside a transaction (GPUI's
renderer owns that switch and resets it after each forced display), a temporary next-drawable
timeout around the repeats (the trace shows drawables are available, so it would guard against
a fault not seen), an extra AppKit window display pass (no evidence it differs from the layer
display), and any change to the verifier.

### 2026-11-23: variant F was never exercised; variant G

Variant F (tested at `5125ddd`) failed Mac ARM in run `45087539195`: three stale moves of
twelve, two Full screen entries and one return to Compact. Disposition: void, not rejected.
Every repeat line in the trace reads `drew 0`. The shim asked the layer of the window's content
view to display, and GPUI's Metal layer belongs to GPUI's own view, a subview of that content
view. The repeats therefore drew nothing, and the run says nothing about whether a repeated
display helps.

The same trace adds one finding. In 10 of 12 moves the window was still marked for a redraw
about 500 ms after the second repeat, with the display link attached, not paused and woken, and
no frame had been drawn in that time. Frame delivery stops after a resize on this runner, in
entries that pass too. The run before it, without repeats, already showed slow delivery, so the
repeats did not cause it.

Variant G is variant F with the display aimed at the right layer: the shim has the Metal layer
of GPUI's view displayed and commits the transaction, for the display after a resize and for
both repeats. It also lets the Metal layer give up waiting for a free drawable after one second
while it displays. This revises the rejection of that timeout above: a display link that hands
out no frames may mean that no drawable is free, and GPUI's wait without limit would then
freeze the app in the repeat. The timeout is a guard against that freeze, not a repair.

Status: uncertain. Native results pending. The next ARM trace decides between four readings,
listed in
[the Metal repaint verification](../verification/runs/2026-11-22-rust-metal-fullscreen.md): the
repeat draws and no entry is stale; the repeat draws and an entry is still stale; no drawable
is free; or `drew 0` again, which means the display did not reach GPUI's drawing. The second
and third put the fault below the app, and a check on a real Apple Silicon Mac is then the next
step rather than another repaint.

### 2026-11-23: trace removal requested

The latest lead brief supersedes the pending trace-reading plan above. Commit
`ade5371473c4572b28c13624e4991abf4e70d50f` removes the temporary trace, stderr logger,
diagnostic counters/timers and direct `log` dependency while retaining variant G's repaint
code. New ARM runs use the existing stale-frame assertions and captures, without the four
trace readings. This cleanup does not settle the virtual-runner cause. Native checks remain
pending at write time; PR #72 stays open for Lex's main-PC check and release decision.
