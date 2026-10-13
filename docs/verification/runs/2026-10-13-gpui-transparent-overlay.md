# Verification run: GPUI transparent Overlay — 2026-10-13

- **Commit:** working tree based on `f7ba709c101f6f20e546d5830f0d47f16f0590a6`, branch `experiment/gpui-port`
- **Version:** GPUI experiment `0.1.0`; Electron unchanged by this experiment fix
- **Observer:** Codex GPT-6.1-Sol implementation agent; Lex supplied the Windows defect screenshot
- **Environment:** Linux `7.0.0-38-generic`, x86_64; rustc `1.98.1`, Cargo `1.98.1`; no native Windows compositor available
- **Cameras:** tests use a painted fixture without camera hardware; no live capture check on this host
- **Related change:** [GPUI experiment record](../../experiments/2026-09-30-gpui-port.md#2026-10-13-opaque-outer-background-report)

## Automated checks

Commands run in `gpui/`, except `git diff --check` in the repository root.

| Command | Result | Evidence/notes |
| --- | --- | --- |
| `cargo test --locked overlay::tests::overlay_root_does_not_paint_an_opaque_window_background -- --nocapture` before the background override | Blocked | `yeslogic-fontconfig-sys` cannot execute `pkg-config`; the red assertion was not reached. |
| `cargo test --locked` | Blocked | Same missing Linux build prerequisite; no Rust compilation or test assertion result claimed for the changed application code. |
| `cargo clippy --all-targets --locked -- -D warnings` | Blocked | Same dependency build failure; linting the changed application code did not run. |
| `git diff --check` | Pass | No whitespace errors. |

Adding the development `test-support` feature required updating `gpui/Cargo.lock` with 11 additional packages. The runtime GPUI/Kit pins remain `0.3.7`/`0.7.0`. No system packages or platform dependency patches were installed. A preliminary locked invocation rejected the missing development dependencies; the lockfile was then regenerated and the required packages fetched before the commands above.

## Source inspection

- The Kit opener wraps application content in Base Root. The component plugin paints the theme background on that Root unless an explicit Root style overrides it.
- The production startup helper now constructs Base Root with `.bg(transparent_black())`. This retains Kit's input and component overlay layers.
- The regression compares the unmodified Kit opener against that helper using `Window::draw` and `Window::painted_quads`; the opaque camera fixture ensures the scene actually paints. A separate test opens a Kit dialog and checks its layer is visible.
- Native options retain transparent background appearance, `titlebar: None`, PopUp, and Client decorations. Changing the decoration request to Server would risk native frames on Linux, and Windows does not map that request. The gray rounded outer outline has not been traced to a verified native cause.

## Build and artifact checks

| Target/check | Result | Notes |
| --- | --- | --- |
| Windows GPUI executable | Not run locally | Linux cannot cross-compile GPUI's Windows shaders; Windows CI build and test results are pending. |
| Windows compositor transparency | Not run | Requires the rebuilt executable on Windows. |

## Manual checks

| Check | Result | Observation/evidence |
| --- | --- | --- |
| Original Windows Circle overlay | Fail (reported) | Lex's private screenshot shows a black rectangular surround and gray rounded outer outline. Exact Windows/GPU configuration was not supplied. The screenshot is not copied into the repository. |
| Rebuilt Circle idle/hover | Not run | Confirm desktop remains visible above, beside, and around the Circle; inspect the gray outer outline separately. |
| Square, Portrait, Wide, and frame effects | Not run | Confirm transparent chrome and shape/effect edges on Windows. |
| Inline settings, Select popup, tooltip, dialogs | Not run | Confirm component layers remain usable after the Root override. |
| Full screen entry/exit | Not run | Confirm no opaque surround appears after returning to Compact mode. |
| Linux Wayland/X11 decoration behavior | Not run | Existing Kit client frames remain a known gap; no native decoration behavior change is claimed. |

## Release decision

- **Decision:** experiment fix awaiting verification
- **Reason:** the opaque Root fill is directly evidenced in dependency source, but local build prerequisites block automated execution and native Windows behavior is unverified.
- **Follow-ups:** run locked tests and Clippy on a configured build host, build a fresh Windows artifact, and repeat the checks above. Investigate the gray outline only if it persists after the Root fill override.
