//! Overlay geometry without a window: Compact placement, the on-screen rule, places for Prompter
//! cues, layout planning, corner resize and the bounds animation curve. Mirrors the pure part of
//! `src/overlay-geometry.js` in CamFrame 0.9.0. Bounds are screen points (logical pixels).

use crate::js;
use crate::settings::{
    CAMERA_SIZE_MAX, CAMERA_SIZE_MIN, OVERLAY_CHROME, Point, Shape, Spot, dimensions_for, overlay_dimensions_for,
};

pub const OVERLAY_BOUNDS_TRANSITION_MS: u64 = 280;
/// A first launch opens this far from the bottom-right corner of the main display.
pub const COMPACT_SCREEN_MARGIN: i64 = 36;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Default)]
pub struct Rect {
    pub x: i64,
    pub y: i64,
    pub width: i64,
    pub height: i64,
}

impl Rect {
    pub fn new(x: i64, y: i64, width: i64, height: i64) -> Rect {
        Rect { x, y, width, height }
    }

    pub fn origin(&self) -> Point {
        Point { x: self.x, y: self.y }
    }

    pub fn at(self, point: Point) -> Rect {
        Rect { x: point.x, y: point.y, ..self }
    }

    pub fn contains(&self, point: (f64, f64)) -> bool {
        point.0 >= self.x as f64
            && point.0 < (self.x + self.width) as f64
            && point.1 >= self.y as f64
            && point.1 < (self.y + self.height) as f64
    }

    pub fn center(&self) -> (f64, f64) {
        (self.x as f64 + self.width as f64 / 2.0, self.y as f64 + self.height as f64 / 2.0)
    }
}

/// The Compact window size for a shape and size, as a rect at the origin.
pub fn window_size(shape: Shape, size: u32) -> Rect {
    let (width, height) = overlay_dimensions_for(shape, size);
    Rect::new(0, 0, i64::from(width), i64::from(height))
}

/// `keepInside`: the start that keeps a window of `window_length` inside `[start, start + length]`.
pub fn keep_inside(value: f64, start: i64, length: i64, window_length: i64) -> i64 {
    js::round(value.min((start + length - window_length) as f64).max(start as f64)) as i64
}

/// `compactBaseBounds`: Compact bounds for a shape and size. Without `current` the saved place is
/// used, or a first launch near the bottom-right of `work_area`; with `current` and `keep_center`
/// the new size keeps the live window's centre.
pub fn compact_base_bounds(
    shape: Shape,
    size: u32,
    position: Option<Point>,
    current: Option<Rect>,
    work_area: Rect,
    keep_center: bool,
) -> Rect {
    let window = window_size(shape, size);
    match current {
        None => {
            let fallback = Point {
                x: work_area.x + work_area.width - window.width - COMPACT_SCREEN_MARGIN,
                y: work_area.y + work_area.height - window.height - COMPACT_SCREEN_MARGIN,
            };
            window.at(position.unwrap_or(fallback))
        }
        Some(current) if !keep_center => window.at(position.unwrap_or(current.origin())),
        Some(current) => Rect {
            x: js::round(current.x as f64 + (current.width - window.width) as f64 / 2.0) as i64,
            y: js::round(current.y as f64 + (current.height - window.height) as f64 / 2.0) as i64,
            ..window
        },
    }
}

/// The share (0–1) of `rect` that lies on the work areas.
pub fn visible_share(rect: Rect, areas: &[Rect]) -> f64 {
    let total = (rect.width * rect.height) as f64;
    if total <= 0.0 {
        return 0.0;
    }
    let visible: i64 = areas
        .iter()
        .map(|area| {
            let width = (rect.x + rect.width).min(area.x + area.width) - rect.x.max(area.x);
            let height = (rect.y + rect.height).min(area.y + area.height) - rect.y.max(area.y);
            if width > 0 && height > 0 { width * height } else { 0 }
        })
        .sum();
    (visible as f64 / total).min(1.0)
}

/// Where the camera surface is for Compact bounds.
pub fn camera_rect_for(base: Rect) -> Rect {
    Rect {
        x: base.x + i64::from(OVERLAY_CHROME.left),
        y: base.y + i64::from(OVERLAY_CHROME.top),
        width: base.width - i64::from(OVERLAY_CHROME.left + OVERLAY_CHROME.right),
        height: base.height - i64::from(OVERLAY_CHROME.top + OVERLAY_CHROME.bottom),
    }
}

/// `isOnScreen`: at least half the window, and half its camera surface, on the connected displays.
pub fn is_on_screen(base: Rect, work_areas: &[Rect]) -> bool {
    visible_share(base, work_areas) >= 0.5 && visible_share(camera_rect_for(base), work_areas) >= 0.5
}

/// The place that keeps a window wholly inside `work_area`, moved as little as possible.
pub fn keep_on_work_area(position: Point, window: Rect, work_area: Rect) -> Point {
    Point {
        x: keep_inside(position.x as f64, work_area.x, work_area.width, window.width),
        y: keep_inside(position.y as f64, work_area.y, work_area.height, window.height),
    }
}

/// `onScreenBase`: `base` when it is on screen, else the same size at the bottom right of the main
/// display, `margin` from its edges (ADR 0038).
pub fn on_screen_base(base: Rect, work_areas: &[Rect], primary_work_area: Rect, margin: u32) -> Rect {
    if is_on_screen(base, work_areas) {
        return base;
    }
    base.at(compact_position_at(Spot::BottomRight, primary_work_area, base, margin))
}

/// `openingCompactBounds`: where the Compact window opens at startup. The second value is the new
/// place when it had to move on screen (Preferences store it; no Scene takes it).
pub fn opening_compact_bounds(
    shape: Shape,
    size: u32,
    position: Option<Point>,
    margin: u32,
    work_areas: &[Rect],
    primary_work_area: Rect,
) -> (Rect, Option<Point>) {
    let saved = compact_base_bounds(shape, size, position, None, primary_work_area, false);
    if work_areas.is_empty() {
        return (saved, None);
    }
    let bounds = on_screen_base(saved, work_areas, primary_work_area, margin);
    (bounds, (bounds != saved).then(|| bounds.origin()))
}

/// `compactPositionAt`: the window position that puts the camera surface at `spot`, `margin` from
/// the edges it touches, with the whole window kept inside the work area.
pub fn compact_position_at(spot: Spot, work_area: Rect, window: Rect, margin: u32) -> Point {
    let camera_width = window.width - i64::from(OVERLAY_CHROME.left + OVERLAY_CHROME.right);
    let camera_height = window.height - i64::from(OVERLAY_CHROME.top + OVERLAY_CHROME.bottom);
    let margin = f64::from(margin);
    let along = |start_side: bool, end_side: bool, start: i64, length: i64, camera: i64| {
        if start_side {
            start as f64 + margin
        } else if end_side {
            (start + length) as f64 - margin - camera as f64
        } else {
            start as f64 + (length - camera) as f64 / 2.0
        }
    };
    Point {
        x: keep_inside(
            along(spot.is_left(), spot.is_right(), work_area.x, work_area.width, camera_width)
                - f64::from(OVERLAY_CHROME.left),
            work_area.x,
            work_area.width,
            window.width,
        ),
        y: keep_inside(
            along(spot.is_top(), spot.is_bottom(), work_area.y, work_area.height, camera_height)
                - f64::from(OVERLAY_CHROME.top),
            work_area.y,
            work_area.height,
            window.height,
        ),
    }
}

/// What a Compact layout asks for (`planCompactLayout`'s request).
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct LayoutRequest {
    pub shape: Shape,
    pub size: u32,
    pub spot: Option<Spot>,
    pub point: Option<Point>,
    pub margin: u32,
    pub within_right: Option<f64>,
}

#[derive(Debug, Clone, Copy, PartialEq)]
pub struct LayoutPlan {
    pub size: u32,
    pub position: Point,
    pub requested_size: u32,
    pub clamped: bool,
}

#[derive(Debug, Clone, PartialEq)]
pub struct DoesNotFit(pub String);

/// `planCompactLayout`: the camera size (shrunk, never grown, until the window fits) and the window
/// position for a request on `work_area`.
pub fn plan_compact_layout(
    request: LayoutRequest,
    work_area: Rect,
    current: Option<Rect>,
) -> Result<LayoutPlan, DoesNotFit> {
    let LayoutRequest { shape, size, spot, point, margin, within_right } = request;
    let right_gap = margin.max(OVERLAY_CHROME.right);
    let centred = spot.is_some_and(|spot| !spot.is_top() && !spot.is_bottom());
    let centred_height = work_area.height - 2 * i64::from(OVERLAY_CHROME.top);
    let fits = |candidate: u32| {
        let (camera_width, camera_height) = dimensions_for(shape, candidate);
        let (window_width, window_height) = overlay_dimensions_for(shape, candidate);
        if i64::from(window_width) > work_area.width || i64::from(window_height) > work_area.height {
            return false;
        }
        if centred && i64::from(camera_height) > centred_height {
            return false;
        }
        if let Some(share) = within_right
            && f64::from(camera_width + right_gap) > share * work_area.width as f64
        {
            return false;
        }
        true
    };
    let (factor_width, factor_height) = dimensions_for(shape, 1000);
    let factor_width = f64::from(factor_width) / 1000.0;
    let factor_height = f64::from(factor_height) / 1000.0;
    let mut limits = vec![
        (work_area.width - i64::from(OVERLAY_CHROME.left + OVERLAY_CHROME.right)) as f64 / factor_width,
        (work_area.height - i64::from(OVERLAY_CHROME.top + OVERLAY_CHROME.bottom)) as f64 / factor_height,
    ];
    if let Some(share) = within_right {
        limits.push((share * work_area.width as f64 - f64::from(right_gap)) / factor_width);
    }
    if centred {
        limits.push(centred_height as f64 / factor_height);
    }
    let limit = limits.into_iter().fold(f64::INFINITY, f64::min).floor();
    let mut fitted = i64::from(size.min(CAMERA_SIZE_MAX)).min(limit as i64);
    while fitted >= i64::from(CAMERA_SIZE_MIN) && !fits(fitted as u32) {
        fitted -= 1;
    }
    if fitted < i64::from(CAMERA_SIZE_MIN) {
        return Err(DoesNotFit(match within_right {
            None => format!("This display is too small for the smallest camera ({CAMERA_SIZE_MIN} px)."),
            Some(share) => format!(
                "The right {}% of this display is too narrow for the smallest camera ({CAMERA_SIZE_MIN} px) and the {right_gap} px gap at the right edge.",
                js::round(share * 100.0)
            ),
        }));
    }
    let fitted = fitted as u32;
    let window = window_size(shape, fitted);
    let position = match spot {
        Some(spot) => compact_position_at(spot, work_area, window, margin),
        None => {
            let wanted = match point {
                Some(point) => {
                    Point { x: point.x - i64::from(OVERLAY_CHROME.left), y: point.y - i64::from(OVERLAY_CHROME.top) }
                }
                None => compact_base_bounds(shape, fitted, None, current, work_area, true).origin(),
            };
            keep_on_work_area(wanted, window, work_area)
        }
    };
    Ok(LayoutPlan { size: fitted, position, requested_size: size, clamped: fitted != size })
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Corner {
    TopLeft,
    TopRight,
    BottomLeft,
    BottomRight,
}

impl Corner {
    pub fn is_left(self) -> bool {
        matches!(self, Corner::TopLeft | Corner::BottomLeft)
    }

    pub fn is_top(self) -> bool {
        matches!(self, Corner::TopLeft | Corner::TopRight)
    }
}

/// `resizeFromCorner`: the size and window place after dragging a corner by `delta` from a start of
/// `size` at `window`. The opposite corner stays put.
pub fn resize_from_corner(shape: Shape, size: u32, window: Rect, corner: Corner, delta: (f64, f64)) -> (u32, Point) {
    let (start_width, start_height) = dimensions_for(shape, size);
    let scale_x = f64::from(start_width) / f64::from(size);
    let scale_y = f64::from(start_height) / f64::from(size);
    let horizontal = if corner.is_left() { -1.0 } else { 1.0 };
    let vertical = if corner.is_top() { -1.0 } else { 1.0 };
    let horizontal_change = horizontal * delta.0 / scale_x;
    let vertical_change = vertical * delta.1 / scale_y;
    let change = if horizontal_change.abs() >= vertical_change.abs() { horizontal_change } else { vertical_change };
    let next =
        js::round(js::clamp(f64::from(size) + change, f64::from(CAMERA_SIZE_MIN), f64::from(CAMERA_SIZE_MAX))) as u32;
    let (next_width, next_height) = dimensions_for(shape, next);
    let position = Point {
        x: window.x + if corner.is_left() { i64::from(start_width) - i64::from(next_width) } else { 0 },
        y: window.y + if corner.is_top() { i64::from(start_height) - i64::from(next_height) } else { 0 },
    };
    (next, position)
}

/// The corner radius of the camera surface (`docs/visual-spec.md`): a circle is round, a rounded
/// square 16% of its side, portrait and landscape 12% of the short side.
pub fn corner_radius(shape: Shape, size: u32) -> f64 {
    let (width, height) = dimensions_for(shape, size);
    let short_side = f64::from(width.min(height));
    let share = match shape {
        Shape::Circle => 0.5,
        Shape::Rounded => 0.16,
        Shape::Portrait | Shape::Landscape => 0.12,
    };
    js::round(short_side * share)
}

/// Whether a point (relative to the top-left of the camera surface) is on the visible camera
/// shape. Clicks outside it, such as the empty corners around a circle, go to the window below.
pub fn is_inside_camera(shape: Shape, size: u32, point: (f64, f64)) -> bool {
    let (width, height) = dimensions_for(shape, size);
    let (half_width, half_height) = (f64::from(width) / 2.0, f64::from(height) / 2.0);
    let radius = corner_radius(shape, size);
    let dx = (point.0 - half_width).abs() - (half_width - radius);
    let dy = (point.1 - half_height).abs() - (half_height - radius);
    dx.max(0.0).hypot(dy.max(0.0)) + dx.max(dy).min(0.0) - radius <= 0.0
}

/// The Overlay's bounds animation curve.
pub fn ease_in_out_cubic(progress: f64) -> f64 {
    let value = js::clamp(progress, 0.0, 1.0);
    if value < 0.5 { 4.0 * value.powi(3) } else { 1.0 - (-2.0 * value + 2.0).powi(3) / 2.0 }
}

pub fn interpolate_bounds(from: Rect, to: Rect, progress: f64) -> Rect {
    let eased = ease_in_out_cubic(progress);
    let step = |a: i64, b: i64| js::round(a as f64 + (b - a) as f64 * eased) as i64;
    Rect {
        x: step(from.x, to.x),
        y: step(from.y, to.y),
        width: step(from.width, to.width),
        height: step(from.height, to.height),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    const AREA: Rect = Rect { x: 0, y: 0, width: 1920, height: 1040 };

    #[test]
    fn first_launch_opens_near_the_bottom_right() {
        let bounds = compact_base_bounds(Shape::Circle, 288, None, None, AREA, false);
        assert_eq!(bounds, Rect::new(1920 - 324 - 36, 1040 - 390 - 36, 324, 390));
    }

    #[test]
    fn a_size_change_keeps_the_centre() {
        let current = Rect::new(100, 100, 324, 390);
        let bounds = compact_base_bounds(Shape::Circle, 388, None, Some(current), AREA, true);
        assert_eq!(bounds, Rect::new(50, 50, 424, 490));
    }

    #[test]
    fn a_lost_place_heals_to_the_bottom_right() {
        let (bounds, healed) =
            opening_compact_bounds(Shape::Circle, 288, Some(Point { x: 5000, y: 10 }), 32, &[AREA], AREA);
        assert_eq!(healed, Some(bounds.origin()));
        assert_eq!(camera_rect_for(bounds).x + 288, 1920 - 32);
        let (kept, none) =
            opening_compact_bounds(Shape::Circle, 288, Some(Point { x: 1700, y: 10 }), 32, &[AREA], AREA);
        assert_eq!((kept.x, none), (1700, None), "more than half on screen stays");
    }

    #[test]
    fn spots_keep_the_toolbar_on_screen() {
        let window = window_size(Shape::Circle, 288);
        assert_eq!(compact_position_at(Spot::TopLeft, AREA, window, 32), Point { x: 14, y: 0 });
        assert_eq!(
            compact_position_at(Spot::BottomRight, AREA, window, 32),
            Point { x: 1920 - 32 - 288 - 18, y: 1040 - 32 - 288 - 84 }
        );
    }

    #[test]
    fn planning_shrinks_to_fit() {
        let request = LayoutRequest {
            shape: Shape::Circle,
            size: 640,
            spot: Some(Spot::Right),
            point: None,
            margin: 32,
            within_right: Some(0.25),
        };
        let plan = plan_compact_layout(request, AREA, None).unwrap();
        assert!(plan.clamped && plan.size + 32 <= 480);
        let tiny = Rect::new(0, 0, 200, 200);
        assert!(plan_compact_layout(request, tiny, None).is_err());
    }

    #[test]
    fn corner_resize_keeps_the_opposite_corner() {
        let window = Rect::new(100, 100, 324, 390);
        let (size, position) = resize_from_corner(Shape::Circle, 288, window, Corner::TopLeft, (-40.0, -10.0));
        assert_eq!((size, position), (328, Point { x: 60, y: 60 }));
        let (size, _) = resize_from_corner(Shape::Portrait, 288, window, Corner::BottomRight, (2000.0, 0.0));
        assert_eq!(size, CAMERA_SIZE_MAX);
    }

    #[test]
    fn corner_radii_follow_the_visual_spec() {
        assert_eq!(corner_radius(Shape::Circle, 288), 144.0);
        assert_eq!(corner_radius(Shape::Rounded, 288), 46.0);
        assert_eq!(corner_radius(Shape::Portrait, 288), 26.0);
        assert_eq!(corner_radius(Shape::Landscape, 288), 19.0);
    }

    #[test]
    fn the_empty_corners_around_a_circle_are_not_part_of_the_camera() {
        // 30 px in from the top-left of the 288 px surface: inside the rounded square only.
        assert!(!is_inside_camera(Shape::Circle, 288, (30.0, 30.0)));
        assert!(is_inside_camera(Shape::Rounded, 288, (30.0, 30.0)));
        for shape in Shape::ALL {
            let (width, height) = dimensions_for(shape, 288);
            assert!(is_inside_camera(shape, 288, (f64::from(width) / 2.0, f64::from(height) / 2.0)));
            assert!(!is_inside_camera(shape, 288, (-1.0, f64::from(height) / 2.0)));
            assert!(!is_inside_camera(shape, 288, (f64::from(width) / 2.0, f64::from(height) + 1.0)));
        }
    }

    #[test]
    fn the_curve_starts_and_ends_still() {
        assert_eq!(ease_in_out_cubic(0.0), 0.0);
        assert_eq!(ease_in_out_cubic(0.5), 0.5);
        assert_eq!(ease_in_out_cubic(1.0), 1.0);
    }
}
