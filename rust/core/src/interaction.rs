//! Whether the Overlay chrome shows ("hovered") and whether the window takes the mouse
//! ("interactive"). Mirrors the Compact part of `src/overlay-interaction.js` in CamFrame 0.9.0, with
//! one allowed improvement: 0.9.0 took clicks on the whole window while the chrome showed; here only
//! the camera shape, the toolbar and the corner handles take them, so clicks go through the empty
//! corners around a circle and the room around the toolbar.
//!
//! Time is passed in as milliseconds so the rules can be tested without a clock.

use crate::geometry::is_inside_camera;
use crate::settings::{OVERLAY_CHROME, Shape, dimensions_for};

pub const COMPACT_CHROME_HIDE_DELAY_MS: u64 = 220;
/// Half the size of a corner resize handle (14 px in 0.9.0), plus a little room for the pointer.
pub const CORNER_HANDLE_REACH: f64 = 9.0;
/// The hover toolbar in 0.9.0 (`src/overlay.css`): 22 px from the window top, 44 px high, at most
/// 234 px wide and never closer than 4 px to the camera's sides.
pub const TOOLBAR_TOP: f64 = 22.0;
pub const TOOLBAR_HEIGHT: f64 = 44.0;
pub const TOOLBAR_MAX_WIDTH: f64 = 234.0;
pub const FULLSCREEN_TOOLBAR_HIDE_DELAY_MS: u64 = 200;

pub fn fullscreen_toolbar_hotspot(point: (f64, f64), window_width: f64) -> bool {
    let left = (window_width - TOOLBAR_MAX_WIDTH) / 2.0;
    point.0 >= left - 12.0
        && point.0 <= left + TOOLBAR_MAX_WIDTH + 12.0
        && point.1 >= TOOLBAR_TOP - 12.0
        && point.1 <= TOOLBAR_TOP + TOOLBAR_HEIGHT + 12.0
}

/// The toolbar's box in window coordinates: (left, top, width, height), centred over the camera.
pub fn toolbar_box(shape: Shape, size: u32) -> (f64, f64, f64, f64) {
    let camera_width = f64::from(dimensions_for(shape, size).0);
    let width = TOOLBAR_MAX_WIDTH.min(camera_width - 8.0);
    let left = f64::from(OVERLAY_CHROME.left) + (camera_width - width) / 2.0;
    (left, TOOLBAR_TOP, width, TOOLBAR_HEIGHT)
}

/// Which part of the Compact window a point (relative to the window's top-left) is on.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Target {
    Nothing,
    Camera,
    Toolbar,
    /// The empty room above the camera, around the toolbar: it keeps the chrome shown (so the
    /// pointer can travel from the camera to the toolbar) but lets clicks through.
    ToolbarRoom,
    Corner(crate::geometry::Corner),
}

/// What is under the pointer. The toolbar, the room around it and the corner handles only count
/// while the chrome shows (`hovered`), because they are invisible otherwise.
pub fn target_at(shape: Shape, size: u32, point: (f64, f64), hovered: bool) -> Target {
    use crate::geometry::Corner;
    let (width, height) = dimensions_for(shape, size);
    let left = f64::from(OVERLAY_CHROME.left);
    let top = f64::from(OVERLAY_CHROME.top);
    let (width, height) = (f64::from(width), f64::from(height));
    if hovered {
        let corners = [
            (Corner::TopLeft, left, top),
            (Corner::TopRight, left + width, top),
            (Corner::BottomLeft, left, top + height),
            (Corner::BottomRight, left + width, top + height),
        ];
        for (corner, x, y) in corners {
            if (point.0 - x).abs() <= CORNER_HANDLE_REACH && (point.1 - y).abs() <= CORNER_HANDLE_REACH {
                return Target::Corner(corner);
            }
        }
    }
    if is_inside_camera(shape, size, (point.0 - left, point.1 - top)) {
        return Target::Camera;
    }
    let window_width = width + left + f64::from(OVERLAY_CHROME.right);
    if hovered && point.1 >= 0.0 && point.1 < top && point.0 >= 0.0 && point.0 < window_width {
        let (bar_left, bar_top, bar_width, bar_height) = toolbar_box(shape, size);
        let on_bar = point.0 >= bar_left
            && point.0 < bar_left + bar_width
            && point.1 >= bar_top
            && point.1 < bar_top + bar_height;
        return if on_bar { Target::Toolbar } else { Target::ToolbarRoom };
    }
    Target::Nothing
}

#[derive(Debug, Clone, Default)]
pub struct Interaction {
    hovered: bool,
    hide_at: Option<u64>,
    pub resizing: bool,
}

impl Interaction {
    pub fn hovered(&self) -> bool {
        self.hovered
    }

    /// The window takes the mouse while the pointer is on the camera, the toolbar or a handle, or
    /// while a resize holds it. (A drag needs nothing extra: the pointer stays on the camera.)
    pub fn interactive(&self, target: Target) -> bool {
        !matches!(target, Target::Nothing | Target::ToolbarRoom) || self.resizing
    }

    /// The pointer moved (or was polled) at `now`; `over` is whether it is on the camera, toolbar or
    /// a handle. Leaving starts the hide delay; coming back cancels it. A resize keeps the chrome.
    pub fn pointer(&mut self, over: bool, now: u64) {
        if over {
            self.hovered = true;
            self.hide_at = None;
        } else if self.hovered && self.hide_at.is_none() && !self.resizing {
            self.hide_at = Some(now + COMPACT_CHROME_HIDE_DELAY_MS);
        }
        self.tick(now);
    }

    /// Hides the chrome once the delay has passed. Returns whether `hovered` changed.
    pub fn tick(&mut self, now: u64) -> bool {
        if let Some(at) = self.hide_at
            && now >= at
            && !self.resizing
        {
            self.hide_at = None;
            self.hovered = false;
            return true;
        }
        false
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::geometry::Corner;

    #[test]
    fn full_screen_toolbar_hotspot_stays_at_the_top_centre() {
        assert!(fullscreen_toolbar_hotspot((960.0, 44.0), 1920.0));
        assert!(!fullscreen_toolbar_hotspot((100.0, 44.0), 1920.0));
        assert!(!fullscreen_toolbar_hotspot((960.0, 100.0), 1920.0));
    }

    #[test]
    fn the_empty_corner_around_a_circle_lets_clicks_through_even_with_the_chrome_shown() {
        // 30 px into the camera square, diagonally: outside the circle.
        let point = (18.0 + 30.0, 84.0 + 30.0);
        assert_eq!(target_at(Shape::Circle, 288, point, true), Target::Nothing);
        assert_eq!(target_at(Shape::Rounded, 288, point, true), Target::Camera);
        assert_eq!(target_at(Shape::Circle, 288, (18.0 + 144.0, 84.0 + 144.0), false), Target::Camera);
    }

    #[test]
    fn the_toolbar_box_matches_090() {
        // Circle 288: 234 wide, centred over the camera (18 + (288 - 234) / 2 = 45), 22 down, 44 high.
        assert_eq!(toolbar_box(Shape::Circle, 288), (45.0, 22.0, 234.0, 44.0));
        // Portrait 288 is 216 wide, so the toolbar is 216 - 8 = 208 wide.
        assert_eq!(toolbar_box(Shape::Portrait, 288), (22.0, 22.0, 208.0, 44.0));
    }

    #[test]
    fn only_the_toolbar_box_takes_clicks_and_the_room_around_it_keeps_the_chrome_shown() {
        let interaction = Interaction::default();
        // Inside the toolbar box.
        assert_eq!(target_at(Shape::Circle, 288, (50.0, 30.0), true), Target::Toolbar);
        assert!(interaction.interactive(Target::Toolbar));
        // Above, beside and below the box, but still above the camera.
        for point in [(162.0, 10.0), (20.0, 44.0), (300.0, 44.0), (162.0, 75.0)] {
            assert_eq!(target_at(Shape::Circle, 288, point, true), Target::ToolbarRoom, "{point:?}");
        }
        assert!(!interaction.interactive(Target::ToolbarRoom), "clicks go through the room around the toolbar");
        assert_eq!(target_at(Shape::Circle, 288, (162.0, 10.0), false), Target::Nothing);
    }

    #[test]
    fn the_toolbar_and_handles_only_take_clicks_while_shown() {
        assert_eq!(target_at(Shape::Circle, 288, (162.0, 40.0), false), Target::Nothing);
        assert_eq!(target_at(Shape::Circle, 288, (162.0, 40.0), true), Target::Toolbar);
        assert_eq!(target_at(Shape::Circle, 288, (18.0, 84.0), false), Target::Nothing);
        assert_eq!(target_at(Shape::Circle, 288, (20.0, 86.0), true), Target::Corner(Corner::TopLeft));
        assert_eq!(target_at(Shape::Circle, 288, (306.0, 372.0), true), Target::Corner(Corner::BottomRight));
    }

    #[test]
    fn the_chrome_hides_a_moment_after_the_pointer_leaves() {
        let mut interaction = Interaction::default();
        interaction.pointer(true, 0);
        assert!(interaction.hovered());
        interaction.pointer(false, 100);
        assert!(interaction.hovered(), "still shown during the delay");
        interaction.pointer(true, 200);
        interaction.pointer(false, 250);
        assert!(!interaction.tick(250 + COMPACT_CHROME_HIDE_DELAY_MS - 1));
        assert!(interaction.tick(250 + COMPACT_CHROME_HIDE_DELAY_MS));
        assert!(!interaction.hovered());
    }

    #[test]
    fn a_resize_keeps_the_window_taking_the_mouse() {
        let mut interaction = Interaction { resizing: true, ..Interaction::default() };
        assert!(interaction.interactive(Target::Nothing));
        interaction.pointer(true, 0);
        interaction.pointer(false, 10);
        assert!(!interaction.tick(10_000), "a resize keeps the chrome");
        interaction.resizing = false;
        assert!(!interaction.interactive(Target::Nothing));
    }
}
