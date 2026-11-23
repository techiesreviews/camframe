# CamFrame Rust

The Rust app's Phosphor icon assets use the MIT license; their copyright notice and the complete
terms are in the included LICENSE.txt (downloads) and the repository [LICENSE](https://github.com/techiesreviews/camframe/blob/dev/LICENSE). The older Electron icons retain their own notice.

CamFrame rebuilt in Rust with GPUI: the floating camera bubble, for Windows (`camframe-rust.exe`)
and macOS (`CamFrame Rust.app`, beta until a person has tried it). It is being built feature by
feature to match CamFrame 0.9.0 (TOOLS-393); this file lists what works so far.

- **Runs beside CamFrame 0.9.0.** It keeps its own Preferences in a "CamFrame Rust" folder next to
  0.9.0's "CamFrame" folder (`%APPDATA%` on Windows, `~/Library/Application Support` on macOS). On
  its first start it copies 0.9.0's Preferences once; 0.9.0's file is only read, never changed.
  The camera frame starts at 0 px, white. Imported settings and earlier Rust test settings reset
  only that frame once; a frame chosen afterwards survives restarts (ADR 0043).
- **Unsigned test downloads.** No release or auto-update. The macOS app carries only the ad-hoc
  signature Apple Silicon needs to start a program.

## What works now

- The camera in a see-through, always-on-top bubble, in the same four shapes, sizes, border and
  window layout as 0.9.0 (84 px of room above the camera for the toolbar, 18 px on the other
  sides). Drag the camera to move it; the place is saved.
- Hover the bubble: the toolbar and four corner handles appear. The six buttons are Quit, Full
  screen, Shape, Camera framing, Prompter link and Settings. Shape steps through Circle, Rounded
  square, Portrait and Landscape, keeping the centre. Drag a corner handle to resize.
- Clicks pass through the empty corners around the circle, the room around the toolbar and every
  other empty part of the window (allowed improvement 1). Only the camera shape, the toolbar and
  the handles take clicks.
- Camera messages in the bubble, in 0.9.0's words: "Starting camera.", or why the camera cannot
  start (blocked, busy, or none found). The moving test picture appears only with
  `--demo-pattern`.
- The tray (menu bar on macOS): controls, Help & onboarding, Show camera, Scenes with the active
  Scene marked, and Quit. Windows double-click opens the controls.

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

The Scenes tab includes starter Scenes, apply, Save look and Replace, autosave with 10-second Undo,
delete with 6-second Undo, rename, reorder, list/grid and import/export. Its miniatures use the
same display-opening rules as applying a Scene. Keyboard controls include arrows, Enter, F2,
Delete, Ctrl/Cmd+Z and Escape; Alt+arrows reorder. Global Ctrl/Cmd+Shift+P cycles Scenes, and 1–6
apply by number. The other global shortcuts remain C (controls), H (show/hide), F (Full screen).

Prompter link implements API 2 on 127.0.0.1:47833, off by default, from its toolbar button. Status,
view cues, layout Scene saves and small-size changes use the same Scene and geometry rules as the
controls. Host/Origin checks and the restricted `Origin: null` responses follow 0.9.0. Only one of
the two CamFrame apps can use that port at a time.

The simpler first-run guide has four tips and progress, Back, Skip and Done, and no ghost mouse. Skip/Done is remembered, and Back returns to the previous tip,
and Help reopens it. Native reduced-motion and high-contrast settings are checked while running.
Controls expose names, states and focus to screen readers; Scene changes have a live announcement.
NVDA and VoiceOver still require a human check.

CI produces a Windows per-user NSIS installer and a single-file Portable executable, and Mac DMG
and ZIP downloads for both ARM and Intel. These remain test downloads with a separate identity.
Installation and uninstallation do not remove 0.9.0 or either settings folder. Switch-over and
cleanup of 0.9.0's old login entry wait for Lex's try and go; no release is published by these jobs.

Real camera quality, hot-plug recovery and effect appearance still need Windows and Mac hardware
checks; Linux tests exercise the portable rules and drawing inputs. Resampling remains on the
capture thread, so 2160p smoothness and full-app size/startup/memory claims need real-camera
measurements. Electron's camera ids are origin-specific; a copied selection falls back to a
matching camera label, then the default if that is unavailable or ambiguous. Rust selections use
the native device's stable id afterwards.

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

## 0.9.0 parity checks

The native verifiers now exercise the Full screen toolbar button, all four display corners,
Escape back to Compact and a real corner resize. Native window changes explicitly synchronize
GPUI's viewport: synchronous native resize callbacks cannot re-enter a window already in use.
On macOS the window also draws itself again 150 ms and 500 ms after a move ends, because a
frame drawn just before a resize has stayed on screen in CI.
Settings keep 0.9.0's 240 px maximum width, three tabs, selects, switches and sliders, and scroll
inside the current native window. They do not enlarge the window.

Full screen animates the native bounds and camera surface together for 280 ms. Camera offsets,
size and corners change continuously; the surface follows 0.9.0's CSS easing, while the window
keeps its original cubic curve. Reduced motion skips both geometry animations. The camera has
no additional high-contrast outline; its frame is controlled by the Frame setting.

`kit parity <output> <native captures>` captures the unchanged 0.9.0 Electron source beside the
Rust app on each CI desktop. The test-only `--demo-pattern --settings-panel` values are `camera`,
`style`, `style-glow`, `style-blur`, `scenes`, `scenes-list`, `small-menu` and `large-menu`.
The latter two show the 180 px Portrait and 640 px Landscape toolbar. Native text/icon pixel
checks reject blank selected tabs and missing toolbar icons. Synthetic video sources differ;
this is not proof of physical-camera quality or exact pixel equality across rendering engines.

Downloads include `LICENSE.txt`. The Mac application also includes it in `Contents/Resources`.
