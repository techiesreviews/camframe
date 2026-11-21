//! Whether the Overlay chrome shows ("hovered") and whether the window takes the mouse
//! ("interactive"). Mirrors the Compact part of `src/overlay-interaction.js` in CamFrame 0.9.0, with
//! one allowed improvement: 0.9.0 took clicks on the whole window while the chrome showed; here only
//! the camera shape, the toolbar strip and the corner handles take them, so clicks go through the
//! empty corners around a circle.
//!
//! Time is passed in as milliseconds so the rules can be tested without a clock.

use crate::geometry::is_inside_camera;
use crate::settings::{OVERLAY_CHROME, Shape, dimensions_for};

pub const COMPACT_CHROME_HIDE_DELAY_MS: u64 = 220;
/// Half the size of a corner resize handle (14 px in 0.9.0), plus a little room for the pointer.
pub const CORNER_HANDLE_REACH: f64 = 9.0;

/// Which part of the Compact window a point (relative to the window's top-left) is on.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Target {
    Nothing,
    Camera,
    Toolbar,
    Corner(crate::geometry::Corner),
}

/// What is under the pointer. The toolbar strip and the corner handles only count while the chrome
/// shows (`hovered`), because they are invisible otherwise.
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
        return Target::Toolbar;
    }
    Target::Nothing
}

#[derive(Debug, Clone, Default)]
pub struct Interaction {
    hovered: bool,
    hide_at: Option<u64>,
    pub dragging: bool,
    pub resizing: bool,
}

impl Interaction {
    pub fn hovered(&self) -> bool {
        self.hovered
    }

    /// The window takes the mouse while the pointer is on something, or a drag or resize holds it.
    pub fn interactive(&self, target: Target) -> bool {
        target != Target::Nothing || self.dragging || self.resizing
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
    fn the_empty_corner_around_a_circle_lets_clicks_through_even_with_the_chrome_shown() {
        // 30 px into the camera square, diagonally: outside the circle.
        let point = (18.0 + 30.0, 84.0 + 30.0);
        assert_eq!(target_at(Shape::Circle, 288, point, true), Target::Nothing);
        assert_eq!(target_at(Shape::Rounded, 288, point, true), Target::Camera);
        assert_eq!(target_at(Shape::Circle, 288, (18.0 + 144.0, 84.0 + 144.0), false), Target::Camera);
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
    fn a_drag_or_resize_keeps_the_window_taking_the_mouse() {
        let mut interaction = Interaction { resizing: true, ..Interaction::default() };
        assert!(interaction.interactive(Target::Nothing));
        interaction.pointer(true, 0);
        interaction.pointer(false, 10);
        assert!(!interaction.tick(10_000), "a resize keeps the chrome");
        interaction.resizing = false;
        interaction.dragging = true;
        assert!(interaction.interactive(Target::Nothing));
    }
}
