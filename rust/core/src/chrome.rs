//! Shared measurements from CamFrame 0.9.0's `src/overlay.css`.
use crate::geometry::Rect;
use crate::settings::OVERLAY_CHROME;

/// Six equally flexible buttons, 4 px padding and five 2 px gaps. The icons must never
/// make a small Portrait toolbar wider than its own hit area.
pub fn toolbar_button_width(toolbar_width: f64) -> f64 {
    ((toolbar_width - 8.0 - 10.0) / 6.0).clamp(0.0, 36.0)
}

/// The panel never enlarges the native window. Its content scrolls inside the available height.
pub fn settings_bounds(window_width: u32, window_height: u32, fullscreen: bool, reserve: u32) -> Rect {
    let camera_left = if fullscreen { 0 } else { i64::from(OVERLAY_CHROME.left) };
    let camera_width = i64::from(window_width) - 2 * camera_left;
    let width = 240.min((camera_width - 28).max(1));
    let top = 76 + i64::from(reserve);
    Rect::new(camera_left + (camera_width - width) / 2, top, width, (i64::from(window_height) - top).max(1))
}
