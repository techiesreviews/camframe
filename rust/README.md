# CamFrame Rust

CamFrame rebuilt in Rust with GPUI: the floating camera bubble, for Windows (`camframe-rust.exe`)
and macOS (`CamFrame Rust.app`, beta until a person has tried it). It is being built feature by
feature to match CamFrame 0.9.0 (TOOLS-393); this file lists what works so far.

- **Runs beside CamFrame 0.9.0.** It keeps its own Preferences in a "CamFrame Rust" folder next to
  0.9.0's "CamFrame" folder (`%APPDATA%` on Windows, `~/Library/Application Support` on macOS). On
  its first start it copies 0.9.0's Preferences once; 0.9.0's file is only read, never changed.
- **Unsigned.** No release, no installer, no auto-update. The macOS app carries only the ad-hoc
  signature Apple Silicon needs to start a program.

## What works now

- The camera in a see-through, always-on-top bubble, in the same four shapes, sizes, border and
  window layout as 0.9.0 (84 px of room above the camera for the toolbar, 18 px on the other
  sides). Drag the camera to move it; the place is saved.
- Hover the bubble: the toolbar and the four corner handles appear. The toolbar has **Close** and
  **Shape** (steps through Circle, Rounded square, Portrait, Landscape and keeps the bubble's
  centre). Drag a corner handle to resize, as in 0.9.0.
- Clicks pass through the empty corners around the circle, the room around the toolbar and every
  other empty part of the window (allowed improvement 1). Only the camera shape, the toolbar and
  the handles take clicks.
- Camera messages in the bubble, in 0.9.0's words: "Starting camera.", or why the camera cannot
  start (blocked, busy, or none found). The moving test picture appears only with
  `--demo-pattern`.
- The tray (menu bar on macOS): **Show camera** and **Quit CamFrame**.

Part 2 adds inline Camera and Style controls: camera selection with a default fallback and device
rescans, 480p through 2160p quality requests, Mirror, Always on top, the frame width, Glow with
custom hex colour and presets, and Progressive blur. Changes to quality settle for 200 ms before
the capture thread applies them; a refused format restores the previous format. The crosshair
button switches to framing: drag to pan, scroll to zoom, double-click to reset, Escape to leave.
The camera thread keeps only the newest frame. Blur works on a small shaped copy of that frame.
The sliders also take arrow, Home and End keys. The custom colour field takes native text input,
including IME composition, and applies on Enter.

Part 3 adds Full screen without reopening the camera, return to Compact, animated moves,
display-change recovery, global shortcuts and the expanded tray menu. Shortcut registration
failures appear in Camera settings. The old Shape click checks follow the expanded toolbar.

Not yet: Scenes, the Prompter link and first-run tips. They come in the
next parts of TOOLS-393. Real camera quality, hot-plug recovery and effect appearance still need
Windows and Mac hardware checks; the Linux tests exercise the portable rules and drawing inputs.

## Layout

- `core/`: everything that does not touch a window: Preferences (read, cleaned and written exactly
  like 0.9.0's `preferences.json`), shapes and window geometry, framing, Scenes, the pointer rules.
  Its tests run on any machine (`kit rust`).
- `app/`: the GPUI app: the bubble (`overlay.rs`), the camera (`camera.rs`), the tray, Preferences
  on disk, and the Windows and macOS window fixes (`win32_overlay.rs`, `mac_overlay.rs`).
- `scripts/verify-windows.ps1`, `scripts/verify-macos.swift`: real-desktop checks the CI jobs run.

## Checks

- `scripts/agents/kit rust` runs the tests and Clippy (Linux covers `core/` and the portable app
  code).
- `.github/workflows/rust-windows.yml` and `rust-macos.yml` build, test and check the app on real
  Windows and macOS desktops. A magenta window sits behind the bubble and the checks read real
  screen pixels: everything around each shape is see-through, hovering shows the toolbar and
  handles, the empty corner and the room beside the toolbar let clicks through, real clicks on the Shape button switch the shape
  with the centre kept, the last shape is saved in the app's own Preferences file, and on macOS
  the bubble stays visible with another app active and moves when dragged. They also measure size,
  start time and memory against CamFrame 0.9.0 and upload the unsigned builds.
- Command-line options for the checks: `--demo-pattern` (a moving test picture instead of the
  camera, and the 1 to 4 keys switch shapes), `--position x,y` (open there and never save the
  place), `--metrics-file path` and `--settings-dir path`.

## macOS first start

From the macOS CI run, download `camframe-rust-macos-arm64-beta`, unzip it and the zip inside it,
and open `CamFrame Rust.app`.

- The app is not signed with an Apple Developer ID or notarized, so macOS blocks it the first
  time. Double-click it and press **Done**, then open System Settings → Privacy & Security, press
  **Open Anyway** next to "CamFrame Rust" and confirm. On macOS 14 or older, right-click the app
  and choose **Open**.
- macOS asks once for camera access. Until you answer, the bubble says "Starting camera.".

## Why transparency works in GPUI

**Windows.** GPUI's `WindowKind::PopUp` created the window with `WS_OVERLAPPED`, so Windows 11 drew
a rounded border and shadow, and its transparent background mode painted an opaque black backdrop.
`app/src/win32_overlay.rs` fixes both right after the window is created: `WS_POPUP`, no DWM
non-client rendering, corner rounding, border colour or system backdrop, and
`SetWindowCompositionAttribute` reset to `ACCENT_DISABLED`, while GPUI's DirectComposition swap
chain keeps clearing to transparent. Every shape is clipped per pixel on the GPU, so no window
region is needed and everything outside the shape stays see-through. Click-through switches the
window's `WS_EX_TRANSPARENT` style on and off as the pointer moves over empty or drawn parts.

**macOS.** GPUI makes a pop-up an `NSPanel` with the titled style, so macOS keeps a shadow and a
hidden title-bar area. `app/src/mac_overlay.rs` makes it borderless and non-activating, without a
shadow, clear, visible when another app is active, at the pop-up level and on every Space.
Click-through uses `setIgnoresMouseEvents`. The macOS backend ignores GPUI's drag areas, so a left
mouse-down on the camera starts a native window drag.
