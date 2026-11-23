//! Camera framing: the zoom and crop origin of the video inside the camera surface. Positions are
//! percentages of the video; zoom is a percentage from 100 to 250. Mirrors `src/camera-framing.js`.
//!
//! 0.9.0 drew framing with CSS (`object-position` plus a scale around the same origin, and the
//! mirror flip around that origin too), so a mirrored, off-centre origin could uncover an edge of
//! the camera surface (known gap KG-10). Here the visible part of the video is cut out first and
//! the cut-out is mirrored as a whole, so the surface is always covered.

use crate::js;
use crate::settings::{CAMERA_ZOOM_MAX, CAMERA_ZOOM_MIN, CameraPosition};

const CAMERA_ZOOM_STEP: f64 = 5.0;

/// Double-click resets framing to this.
pub fn centered_framing() -> (CameraPosition, u32) {
    (CameraPosition { x: 50.0, y: 50.0 }, CAMERA_ZOOM_MIN)
}

/// The part of a `source` frame (pixels) shown on a `surface` of the given size: the video covers
/// the surface (cropped to its aspect at `position`), then zooms around the same point.
pub fn visible_source_rect(
    source: (u32, u32),
    surface: (f64, f64),
    position: CameraPosition,
    zoom: u32,
) -> (f64, f64, f64, f64) {
    let (source_width, source_height) = (f64::from(source.0.max(1)), f64::from(source.1.max(1)));
    let (surface_width, surface_height) = (surface.0.max(1.0), surface.1.max(1.0));
    let scale = (surface_width / source_width).max(surface_height / source_height);
    let cover_width = (surface_width / scale).min(source_width);
    let cover_height = (surface_height / scale).min(source_height);
    let share_x = js::clamp(position.x, 0.0, 100.0) / 100.0;
    let share_y = js::clamp(position.y, 0.0, 100.0) / 100.0;
    let zoom = js::clamp(f64::from(zoom), f64::from(CAMERA_ZOOM_MIN), f64::from(CAMERA_ZOOM_MAX)) / 100.0;
    let left = (source_width - cover_width) * share_x + share_x * cover_width * (1.0 - 1.0 / zoom);
    let top = (source_height - cover_height) * share_y + share_y * cover_height * (1.0 - 1.0 / zoom);
    (left, top, cover_width / zoom, cover_height / zoom)
}

/// `cameraPositionAfterDrag`: the framing origin after dragging the picture by `delta` on a surface.
/// The picture follows the pointer, mirrored or not.
pub fn camera_position_after_drag(
    position: CameraPosition,
    delta: (f64, f64),
    surface: (f64, f64),
    mirrored: bool,
    zoom: u32,
) -> CameraPosition {
    let width = surface.0.max(1.0);
    let height = surface.1.max(1.0);
    let overflow = f64::from(zoom) / 100.0 - 1.0;
    let overflow_scale = if overflow > 0.0 { overflow } else { 1.0 };
    let dx = if mirrored { delta.0 } else { -delta.0 };
    let tenth = |value: f64| js::round(js::clamp(value, 0.0, 100.0) * 10.0) / 10.0;
    CameraPosition {
        x: tenth(position.x + dx / (width * overflow_scale) * 100.0),
        y: tenth(position.y - delta.1 / (height * overflow_scale) * 100.0),
    }
}

/// `cameraZoomAfterWheel`: 5% per wheel step, in towards a negative delta.
pub fn camera_zoom_after_wheel(zoom: u32, delta_y: f64) -> u32 {
    if delta_y == 0.0 || !delta_y.is_finite() {
        return zoom;
    }
    let step = if delta_y < 0.0 { CAMERA_ZOOM_STEP } else { -CAMERA_ZOOM_STEP };
    js::round(js::clamp(f64::from(zoom) + step, f64::from(CAMERA_ZOOM_MIN), f64::from(CAMERA_ZOOM_MAX))) as u32
}

#[cfg(test)]
mod tests {
    use super::*;

    const CENTRE: CameraPosition = CameraPosition { x: 50.0, y: 50.0 };

    #[test]
    fn a_square_surface_crops_the_middle_of_a_wide_frame() {
        let (left, top, width, height) = visible_source_rect((1280, 720), (288.0, 288.0), CENTRE, 100);
        assert_eq!((left, top, width, height), (280.0, 0.0, 720.0, 720.0));
    }

    #[test]
    fn the_visible_part_always_stays_inside_the_frame() {
        for x in [0.0, 13.7, 50.0, 100.0] {
            for zoom in [100, 180, 250] {
                let position = CameraPosition { x, y: 100.0 - x };
                let (left, top, width, height) = visible_source_rect((1280, 720), (216.0, 288.0), position, zoom);
                assert!(left >= 0.0 && top >= 0.0, "{x} {zoom}");
                assert!(left + width <= 1280.0 + 1e-9 && top + height <= 720.0 + 1e-9, "{x} {zoom}");
            }
        }
    }

    #[test]
    fn zoom_stays_on_the_framing_point() {
        let corner = CameraPosition { x: 0.0, y: 0.0 };
        let (left, top, width, _) = visible_source_rect((1000, 1000), (100.0, 100.0), corner, 200);
        assert_eq!((left, top, width), (0.0, 0.0, 500.0));
    }

    #[test]
    fn dragging_moves_the_picture_with_the_pointer() {
        let moved = camera_position_after_drag(CENTRE, (28.8, 0.0), (288.0, 288.0), false, 100);
        assert_eq!(moved.x, 40.0);
        let mirrored = camera_position_after_drag(CENTRE, (28.8, 0.0), (288.0, 288.0), true, 100);
        assert_eq!(mirrored.x, 60.0);
    }

    #[test]
    fn the_wheel_zooms_in_steps() {
        assert_eq!(camera_zoom_after_wheel(100, -1.0), 105);
        assert_eq!(camera_zoom_after_wheel(100, 3.0), 100);
        assert_eq!(camera_zoom_after_wheel(250, -1.0), 250);
    }
}
