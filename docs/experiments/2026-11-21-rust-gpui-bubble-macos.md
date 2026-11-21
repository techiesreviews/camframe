# Experiment: Rust GPUI bubble on macOS

- **Date started:** 2026-11-21
- **Owner:** fleet (Claude Opus 5.5 helper)
- **Status:** Running
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
| A | pending CI | none | pending |

## Interpretation

Pending. CI runners have no camera, so the real-camera path and the permission prompt are not proven by CI.

## Disposition

Pending.
