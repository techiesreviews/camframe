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
