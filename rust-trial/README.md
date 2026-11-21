# CamFrame Rust + GPUI Bubble Trial

Small trial binary (`camframe-trial.exe`) showing your webcam in a borderless, see-through, always-on-top window with live shape switching.

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
