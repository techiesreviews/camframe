# Experiment: Rust GPUI bubble on macOS

- **Date started:** 2026-11-21
- **Owner:** fleet (Claude Opus 5.5 helper)
- **Status:** Adopted (on the trial branch only; nothing is merged)
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

Adopted on `trial/rust-gpui-bubble` only (TRIAL ONLY, never merged into main or dev). Code: `rust-trial/src/mac_overlay.rs`, macOS parts of `camera.rs` and `overlay.rs`, `rust-trial/scripts/verify-macos.swift`, `.github/workflows/trial-rust-gpui-macos.yml`. Artifacts: the CI run's `camframe-rust-gpui-trial-macos-arm64` and `camframe-rust-gpui-trial-verification-macos` downloads. Next step: try the app on a real Mac with a camera (permission prompt, live video, hover pill).
