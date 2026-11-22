//! Geometry copied from 0.9.0's `.hover-toolbar` and `.inline-settings` rules.
use camframe_core::chrome::{settings_bounds, toolbar_button_width};
use camframe_core::geometry::Rect;
use camframe_core::interaction::toolbar_box;
use camframe_core::settings::{Shape, overlay_dimensions_for};

#[test]
fn all_six_toolbar_buttons_fit_every_supported_shape_and_size() {
    for shape in [Shape::Circle, Shape::Rounded, Shape::Portrait, Shape::Landscape] {
        for size in [180, 288, 640] {
            let (_, _, width, _) = toolbar_box(shape, size);
            let button = toolbar_button_width(width);
            assert!(button * 6.0 + 5.0 * 2.0 + 8.0 <= width + 0.001, "{shape:?} {size}");
            assert!(button <= 36.0);
        }
    }
}

#[test]
fn settings_match_090_and_scroll_inside_the_current_window() {
    assert_eq!(settings_bounds(324, 390, false, 0), Rect::new(42, 76, 240, 314));
    assert_eq!(settings_bounds(171, 282, false, 0), Rect::new(32, 76, 107, 206));
    assert_eq!(settings_bounds(1920, 1080, true, 0), Rect::new(840, 76, 240, 1004));
    assert_eq!(settings_bounds(324, 610, false, 220), Rect::new(42, 296, 240, 314));
    for shape in [Shape::Circle, Shape::Portrait, Shape::Landscape] {
        for size in [180, 288, 640] {
            let (w, h) = overlay_dimensions_for(shape, size);
            let panel = settings_bounds(w, h, false, 0);
            assert_eq!(panel.y + panel.height, i64::from(h));
        }
    }
}
