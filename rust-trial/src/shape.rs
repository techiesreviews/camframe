//! Bubble shape geometry matching CamFrame 0.9.0 (`src/settings.js` and `docs/visual-spec.md`).

/// Default camera bubble diameter/side in logical pixels (matches CamFrame 0.9.0 `DEFAULT_SETTINGS.size`).
pub const DEFAULT_CAMERA_SIZE: f32 = 288.0;

/// Horizontal margin on each side of the camera stage inside the transparent window.
pub const MARGIN_SIDE: f32 = 18.0;

/// Space reserved above the camera stage for the hover shape pill.
pub const TOOLBAR_RESERVE_TOP: f32 = 56.0;

/// Bottom margin below the camera stage inside the transparent window.
pub const MARGIN_BOTTOM: f32 = 18.0;

/// Fixed transparent outer window width (288 + 18 + 18).
pub const OUTER_WIDTH: f32 = DEFAULT_CAMERA_SIZE + MARGIN_SIDE * 2.0;

/// Fixed transparent outer window height (56 + 288 + 18).
pub const OUTER_HEIGHT: f32 = TOOLBAR_RESERVE_TOP + DEFAULT_CAMERA_SIZE + MARGIN_BOTTOM;

#[derive(Clone, Copy, Debug, PartialEq, Eq, Hash)]
pub enum BubbleShape {
    Circle,
    RoundedSquare,
    Portrait,
    Landscape,
}

impl BubbleShape {
    #[cfg(test)]
    pub const ALL: [BubbleShape; 4] = [
        BubbleShape::Circle,
        BubbleShape::RoundedSquare,
        BubbleShape::Portrait,
        BubbleShape::Landscape,
    ];

    pub fn from_cli(value: &str) -> Option<Self> {
        match value.trim().to_ascii_lowercase().as_str() {
            "circle" | "1" => Some(Self::Circle),
            "rounded" | "square" | "rounded-square" | "2" => Some(Self::RoundedSquare),
            "portrait" | "3" => Some(Self::Portrait),
            "landscape" | "wide" | "4" => Some(Self::Landscape),
            _ => None,
        }
    }

    pub fn next(self) -> Self {
        match self {
            Self::Circle => Self::RoundedSquare,
            Self::RoundedSquare => Self::Portrait,
            Self::Portrait => Self::Landscape,
            Self::Landscape => Self::Circle,
        }
    }

    /// Logical `(width, height)` matching `dimensionsFor()` in CamFrame `src/settings.js`.
    pub fn dimensions(self, base_size: f32) -> (f32, f32) {
        match self {
            Self::Circle | Self::RoundedSquare => (base_size, base_size),
            Self::Portrait => ((base_size * 0.75).round(), base_size),
            Self::Landscape => (base_size, (base_size * 0.5625).round()),
        }
    }

    /// Corner radius in logical pixels matching `docs/visual-spec.md`:
    /// Circle = 50%, Rounded square = 16%, Portrait / Landscape = 12% of the short side.
    pub fn corner_radius(self, base_size: f32) -> f32 {
        let (w, h) = self.dimensions(base_size);
        let short_side = w.min(h);
        match self {
            Self::Circle => (short_side * 0.5).round(),
            Self::RoundedSquare => (short_side * 0.16).round(),
            Self::Portrait | Self::Landscape => (short_side * 0.12).round(),
        }
    }

    /// Top-left `(x, y)` and `(width, height)` of the camera bubble inside the fixed transparent window.
    #[cfg(test)]
    pub fn camera_rect(self) -> (f32, f32, f32, f32) {
        let (w, h) = self.dimensions(DEFAULT_CAMERA_SIZE);
        let x = MARGIN_SIDE + ((DEFAULT_CAMERA_SIZE - w) * 0.5).round();
        let y = TOOLBAR_RESERVE_TOP + ((DEFAULT_CAMERA_SIZE - h) * 0.5).round();
        (x, y, w, h)
    }

    /// Returns whether a logical point `(px, py)` relative to the outer window lies inside the shape.
    #[cfg(test)]
    pub fn contains_window_point(self, px: f32, py: f32) -> bool {
        let (x, y, w, h) = self.camera_rect();
        let radius = self.corner_radius(DEFAULT_CAMERA_SIZE);
        let half_w = w * 0.5;
        let half_h = h * 0.5;
        let dx = (px - (x + half_w)).abs() - (half_w - radius);
        let dy = (py - (y + half_h)).abs() - (half_h - radius);
        let outside = (dx.max(0.0).hypot(dy.max(0.0))) + dx.max(dy).min(0.0) - radius;
        outside <= 0.0
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn dimensions_match_camframe_090() {
        assert_eq!(BubbleShape::Circle.dimensions(288.0), (288.0, 288.0));
        assert_eq!(BubbleShape::RoundedSquare.dimensions(288.0), (288.0, 288.0));
        assert_eq!(BubbleShape::Portrait.dimensions(288.0), (216.0, 288.0));
        assert_eq!(BubbleShape::Landscape.dimensions(288.0), (288.0, 162.0));
    }

    #[test]
    fn corner_radii_match_visual_spec() {
        assert_eq!(BubbleShape::Circle.corner_radius(288.0), 144.0);
        assert_eq!(BubbleShape::RoundedSquare.corner_radius(288.0), 46.0);
        assert_eq!(BubbleShape::Portrait.corner_radius(288.0), 26.0);
        assert_eq!(BubbleShape::Landscape.corner_radius(288.0), 19.0);
    }

    #[test]
    fn circle_corner_is_transparent_but_rounded_square_covers_it() {
        // (18 + 30, 56 + 30) = (48, 86): inside the 288x288 stage and inside the 16% rounded square,
        // but outside the 144px radius circle (distance from center (162, 200) is ~161.2 > 144).
        let (tx, ty) = (48.0, 86.0);
        assert!(!BubbleShape::Circle.contains_window_point(tx, ty));
        assert!(BubbleShape::RoundedSquare.contains_window_point(tx, ty));
        // Outer window corner (6, 6) is always outside every shape.
        for shape in BubbleShape::ALL {
            assert!(!shape.contains_window_point(6.0, 6.0));
            assert!(shape.contains_window_point(162.0, 200.0));
        }
    }

    #[test]
    fn cycle_wraps_through_all_four_shapes() {
        let mut s = BubbleShape::Circle;
        s = s.next();
        assert_eq!(s, BubbleShape::RoundedSquare);
        s = s.next();
        assert_eq!(s, BubbleShape::Portrait);
        s = s.next();
        assert_eq!(s, BubbleShape::Landscape);
        s = s.next();
        assert_eq!(s, BubbleShape::Circle);
    }

    #[test]
    fn cli_parser_handles_names_and_numbers() {
        assert_eq!(BubbleShape::from_cli("circle"), Some(BubbleShape::Circle));
        assert_eq!(BubbleShape::from_cli("rounded"), Some(BubbleShape::RoundedSquare));
        assert_eq!(BubbleShape::from_cli("square"), Some(BubbleShape::RoundedSquare));
        assert_eq!(BubbleShape::from_cli("portrait"), Some(BubbleShape::Portrait));
        assert_eq!(BubbleShape::from_cli("wide"), Some(BubbleShape::Landscape));
        assert_eq!(BubbleShape::from_cli("unknown"), None);
    }
}
