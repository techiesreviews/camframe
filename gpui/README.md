# CamFrame on GPUI (experiment)

A native Rust port of the CamFrame Overlay built on [GPUI](https://www.gpui.rs) and [GPUI Kit](https://gpui-kit.com). The Electron app in the repository root is still the product. The hypothesis, platform gaps, and evidence for this port are tracked in [`docs/experiments/2026-09-30-gpui-port.md`](../docs/experiments/2026-09-30-gpui-port.md).

## Run

Ubuntu/Debian build dependencies:

```bash
sudo apt install pkg-config libfontconfig-dev libfreetype-dev libxkbcommon-dev libxkbcommon-x11-dev \
  libwayland-dev libx11-xcb-dev libxcb1-dev libvulkan-dev libasound2-dev libzstd-dev clang libclang-dev cmake
```

Then run from this directory:

```bash
cargo run --release
cargo test
cargo clippy --all-targets -- -D warnings
```

On Windows you don't need a local toolchain: every push to `experiment/gpui-port` that touches `gpui/` runs the "Build GPUI experiment (Windows)" workflow, which uploads `camframe.exe` as the `camframe-gpui-windows-x64` artifact on the run page. GPUI compiles its shaders with the Windows SDK's `fxc.exe`, so the port cannot be cross-compiled from Linux. A console window opens alongside the Overlay and shows any errors.

Preferences use the Electron `preferences.json` format, stored separately under `~/.config/camframe-gpui/` (Linux), `%APPDATA%\camframe-gpui\` (Windows), or `~/Library/Application Support/camframe-gpui/` (macOS). To try it with your existing Scenes, copy the Electron document there.

## What is ported

- Transparent, frameless PopUp Overlay with Circle/Square/Portrait/Wide shapes, drag-to-move, and corner resize.
- Live camera with the Camera quality setting, ADR 0028 mode preference, Mirror, camera framing (drag to pan, scroll to zoom in 5% steps, double-click to reset), frame width, Glow, and an approximated Progressive blur.
- Inline settings (Camera, Style, and Scenes) built from GPUI Kit components. Scenes support save/update, apply, reorder, delete, import, and export in the Electron formats.
- Native Full screen with the auto-hiding toolbar and its 12 px recovery hotspot.
- In-window shortcuts: `Ctrl/Cmd+Shift+F`, `P`, `C`, `1`–`6`, and `Esc`.

Not ported: tray, global shortcuts, Start at login, onboarding, high-contrast styling, animated transitions, and runtime Always-on-top changes. See the experiment record for the GPUI limitations behind each gap.
