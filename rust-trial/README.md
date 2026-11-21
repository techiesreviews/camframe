# CamFrame Rust + GPUI Bubble Trial

Small trial binary (`camframe-trial.exe` on Windows, `CamFrame Trial.app` on macOS) showing your webcam in a borderless, see-through, always-on-top window with live shape switching.

## Controls

- **Drag camera:** move the bubble anywhere on screen
- **Hover over bubble:** shows the floating pill toolbar at the top:
  - Circle (`1`) / Rounded square (`2`) / Portrait (`3`) / Wide (`4`)
  - `B`: toggle white inner border
  - `M`: toggle mirror
  - `×`: close
- **Right-click bubble** (or press `Space` / `S`): cycle to the next shape
- **`Esc` or `Q`:** close

## Why transparency and shape switching work in GPUI on Windows now

The previous GPUI experiment (2026-10-13) showed a black rectangular box with a gray rounded border behind the circle on Windows 11. Two Windows backend behaviors in `gpui_windows` caused it:

1. `WindowKind::PopUp` created the HWND with `dwstyle = 0` (`WS_OVERLAPPED`), not `WS_POPUP`, so Windows 11 DWM drew a rounded border and drop shadow around the rectangular window.
2. `WindowBackgroundAppearance::Transparent` called `SetWindowCompositionAttribute(..., ACCENT_ENABLE_TRANSPARENTGRADIENT, 0x00000000)`, which paints an opaque black DWM backdrop behind `WS_EX_NOREDIRECTIONBITMAP` windows on Windows 11.

`src/win32_overlay.rs` fixes both on the GPUI `HWND` right after creation: switches the style to `WS_POPUP`, disables DWM non-client rendering / corner rounding / border color / system backdrop, and resets `SetWindowCompositionAttribute` to `ACCENT_DISABLED` while GPUI's `DirectXRenderer` keeps clearing its premultiplied-alpha DirectComposition swap chain to `[0, 0, 0, 0]`. Every shape is then clipped per-pixel on the GPU with antialiased signed-distance corner radii, so changing shape never needs Win32 region clipping (`SetWindowRgn`) and leaves everything outside the shape 100% see-through.

## macOS (Apple Silicon)

Controls are the same as on Windows. Download `CamFrame-Trial-macOS-arm64.zip` from the macOS trial CI run, unzip it and open `CamFrame Trial.app`.

- **First start:** the app is only ad-hoc signed (no Apple Developer ID, not notarized), so macOS blocks a double-click. Right-click the app, choose **Open**, then **Open** again (or allow it in System Settings → Privacy & Security).
- **Camera permission:** macOS asks once for camera access. Until you answer, and if you say no, the bubble shows the moving demo pattern. Turn it on later in System Settings → Privacy & Security → Camera.
- No camera at all also falls back to the demo pattern.

### Why transparency works in GPUI on macOS

GPUI creates `WindowKind::PopUp` as an `NSPanel` with a full-size content view but still with the *titled* style, so macOS keeps a window shadow and a hidden title-bar area. `src/mac_overlay.rs` changes the panel right after creation: borderless non-activating style, no shadow, not opaque with a clear background, pop-up window level, shown on every Space and over full-screen apps, and not hidden when another app is active. GPUI's Metal renderer already draws with alpha, so everything outside the shape stays see-through. Because the macOS backend ignores GPUI's drag hit-test areas, a left mouse-down on the bubble starts a native window drag instead.

The macOS CI job (`.github/workflows/trial-rust-gpui-macos.yml`) checks this on a real macOS desktop with `scripts/verify-macos.swift`: a magenta window behind the bubble, screen pixels around the circle and the other shapes, a real right-click shape switch, a drag, plus size, start time and memory.
