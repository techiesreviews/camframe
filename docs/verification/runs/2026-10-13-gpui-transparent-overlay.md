# Verification run: GPUI transparent Overlay — 2026-10-13

- **Commit:** final Windows CI tested `bfe884b539bbb83090303539de90657ebc7f256a`, branch `experiment/gpui-port`; initial CI tested `4c39f49a5b2390f632818c9eb00e1beb1a646cb7`
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

### Initial Windows CI

[Run 38368888574](https://github.com/techiesreviews/camframe/actions/runs/38368888574) tested `4c39f49` after the local checks above.

| Check | Result | Evidence/notes |
| --- | --- | --- |
| `cargo build --release --locked` | Pass | Windows application code compiled. |
| `cargo test --release --locked` | Pass | All 23 tests passed, including the Root paint regression with its opaque baseline control and the dialog layer regression. |
| `cargo clippy --all-targets --locked -- -D warnings` | Fail | Sole diagnostic: unused import `gpui` at `gpui/src/overlay.rs:1445:128`. The redundant explicit test import was removed in `bfe884b`; the final run below verifies the correction. |

### Final Windows CI

[Run 38370012546](https://github.com/techiesreviews/camframe/actions/runs/38370012546) tested `bfe884b` and completed successfully on 2026-10-13. Its `windows-latest` runner used Rust `1.98.1` as specified by the workflow.

| Check | Result | Evidence/notes |
| --- | --- | --- |
| `cargo build --release --locked` | Pass | Optimized Windows application compiled in 44.99 seconds. |
| `cargo test --release --locked` | Pass | 23 passed, 0 failed; both new Overlay tests passed. Test compilation took 4 minutes 15 seconds; execution took 0.01 seconds. |
| `cargo clippy --all-targets --locked -- -D warnings` | Pass | No warnings; completed in 43.25 seconds. |
| Independent source review | No findings | Read-only `codex exec`, GPT-6.1-Sol/medium, reviewed immutable `f7ba709..4c39f49`. Confirmed Root style ordering, retained Kit layers, test APIs, and unchanged runtime versions/checksums. The later cleanup only removes the test import flagged by CI. |

These paint tests verify scene composition through the production startup helper and the opaque-fill baseline. They do not demonstrate native compositor transparency or resolve the gray outline on Lex's Windows desktop.

## Source inspection

- The Kit opener wraps application content in Base Root. The component plugin paints the theme background on that Root unless an explicit Root style overrides it.
- The production startup helper now constructs Base Root with `.bg(transparent_black())`. This retains Kit's input and component overlay layers.
- The regression compares the unmodified Kit opener against that helper using `Window::draw` and `Window::painted_quads`; the opaque camera fixture ensures the scene actually paints. A separate test opens a Kit dialog and checks its layer is visible.
- Native options retain transparent background appearance, `titlebar: None`, PopUp, and Client decorations. Changing the decoration request to Server would risk native frames on Linux, and Windows does not map that request. The gray rounded outer outline has not been traced to a verified native cause.

## Build and artifact checks

| Target/check | Result | Notes |
| --- | --- | --- |
| Windows GPUI runtime build | Pass (CI) | Final run 38370012546 compiled `camframe.exe`, passed all 23 tests, and passed Clippy. |
| Historical Windows x64 artifact | Pass (CI metadata) | `camframe-gpui-windows-x64`, artifact ID `11797999468`, archive size 9,226,353 bytes, GitHub artifact archive SHA-256 `0b2d15e167c251f63b36da8a74501ea79cb3ffc20720fcf9407c95a5f976ae1e`. The archive contained the workflow's `gpui/target/release/camframe.exe`; it was not downloaded or launched on this Linux host. Build removal and external artifact cleanup are tracked in the [removal run](2026-10-13-gpui-build-removal.md). |
| Windows compositor transparency | Fail (user reported) | Lex reported the corrected build was “Still the same.” Exact executable, Windows version, and GPU configuration were not supplied. |

## Manual checks

| Check | Result | Observation/evidence |
| --- | --- | --- |
| Original Windows Circle overlay | Fail (reported) | Lex's private screenshot shows a black rectangular surround and gray rounded outer outline. Exact Windows/GPU configuration was not supplied. The screenshot is not copied into the repository. |
| Rebuilt Windows Overlay | Fail (user reported) | Lex reported “Still the same” after the corrected build and requested build removal. No new screenshot or exact artifact/device match was supplied. |
| Square, Portrait, Wide, and frame effects | Not run | Confirm transparent chrome and shape/effect edges on Windows. |
| Inline settings, Select popup, tooltip, dialogs | Not run | Confirm component layers remain usable after the Root override. |
| Full screen entry/exit | Not run | Confirm no opaque surround appears after returning to Compact mode. |
| Linux Wayland/X11 decoration behavior | Not run | Existing Kit client frames remain a known gap; no native decoration behavior change is claimed. |

## Release decision

- **Decision:** experiment abandoned; GPUI build removed
- **Reason:** Final Windows CI passed the runtime build, all 23 tests, and Clippy, but Lex reported the corrected Windows build still showed the same problem and requested removal. Headless tests did not prove native transparency.
- **Follow-ups:** stop GPUI repair and automated builds. Keep source and evidence archived. Track external workflow and artifact cleanup in the [removal run](2026-10-13-gpui-build-removal.md).
