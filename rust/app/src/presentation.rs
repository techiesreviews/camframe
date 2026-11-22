//! One native camera window moves between Compact and Full screen; capture is never restarted.
use super::*;

#[derive(Default)]
pub(super) struct Presentation {
    pub fullscreen: bool,
    pub compact: Option<Rect>,
    pub transition: Option<(Rect, Rect, Instant)>,
    pub surface_transition: Option<(f64, Instant)>,
    pub chrome_shown: bool,
    pub chrome_at: u64,
    areas: Vec<Rect>,
}

#[derive(Clone, Copy, Debug, PartialEq)]
pub(super) struct CameraLayout {
    pub left: f32,
    pub top: f32,
    pub width: f32,
    pub height: f32,
    pub radius: f32,
}

impl Presentation {
    pub fn capture_bounds(&self, fallback: Rect) -> Option<Rect> {
        (self.fullscreen || self.surface_transition.is_some()).then(|| {
            self.transition.map_or(fallback, |(from, to, _)| Rect {
                width: from.width.max(to.width),
                height: from.height.max(to.height),
                ..to
            })
        })
    }

    pub fn change_mode(&mut self, fullscreen: bool, reduced_motion: bool, now: Instant) {
        if fullscreen == self.fullscreen {
            return;
        }
        let compact = self.compactness(now);
        self.fullscreen = fullscreen;
        self.surface_transition = (!reduced_motion).then_some((compact, now));
    }

    fn compactness(&self, now: Instant) -> f64 {
        let target = if self.fullscreen { 0.0 } else { 1.0 };
        let Some((from, start)) = self.surface_transition else { return target };
        let progress =
            now.saturating_duration_since(start).as_secs_f64() * 1000.0 / geometry::OVERLAY_BOUNDS_TRANSITION_MS as f64;
        from + (target - from) * surface_easing(progress)
    }

    pub fn camera_layout(
        &self,
        viewport: (f32, f32),
        shape: Shape,
        size: u32,
        reserve: u32,
        now: Instant,
    ) -> CameraLayout {
        let (width, height) = dimensions_for(shape, size);
        let compact = self.compactness(now) as f32;
        // CSS interpolates fixed Compact dimensions against 100% of the *current* viewport.
        // Using only the target window size makes exit snap small before the window shrinks.
        let width = width as f32 * compact + viewport.0 * (1.0 - compact);
        let height = height as f32 * compact + viewport.1 * (1.0 - compact);
        let (compact_width, compact_height) = dimensions_for(shape, size);
        let radius_share = geometry::corner_radius(shape, size) as f32 / compact_width.min(compact_height) as f32;
        CameraLayout {
            left: OVERLAY_CHROME.left as f32 * compact,
            top: (OVERLAY_CHROME.top + reserve) as f32 * compact,
            width,
            height,
            radius: width.min(height) * radius_share * compact,
        }
    }
}

/// 0.9.0's camera CSS uses cubic-bezier(0.65, 0, 0.35, 1), independently of the window curve.
fn surface_easing(progress: f64) -> f64 {
    let progress = progress.clamp(0.0, 1.0);
    if progress == 0.0 || progress == 1.0 {
        return progress;
    }
    let (mut low, mut high) = (0.0_f64, 1.0_f64);
    for _ in 0..24 {
        let t = (low + high) / 2.0;
        let x = 3.0 * (1.0 - t).powi(2) * t * 0.65 + 3.0 * (1.0 - t) * t * t * 0.35 + t * t * t;
        if x < progress { low = t } else { high = t }
    }
    let t = (low + high) / 2.0;
    3.0 * (1.0 - t) * t * t + t * t * t
}

impl BubbleOverlay {
    pub(super) fn tick_presentation(&mut self, window: &mut Window, cx: &mut Context<Self>) {
        if let Some((_, start)) = self.presentation.surface_transition {
            if start.elapsed().as_millis() >= u128::from(geometry::OVERLAY_BOUNDS_TRANSITION_MS) {
                self.presentation.surface_transition = None;
                self.sync_capture_view(window, cx);
            }
            cx.notify();
        }
        if let Some((from, to, start)) = self.presentation.transition {
            let progress =
                (start.elapsed().as_secs_f64() * 1000.0 / geometry::OVERLAY_BOUNDS_TRANSITION_MS as f64).min(1.0);
            platform::set_bounds(window, geometry::interpolate_bounds(from, to, progress), cx);
            if progress >= 1.0 {
                self.presentation.transition = None;
                self.sync_capture_view(window, cx);
            }
            cx.notify();
        }
        let (areas, primary) = work_areas(cx);
        if areas != self.presentation.areas {
            self.presentation.areas = areas.clone();
            if !self.presentation.fullscreen && self.presentation.transition.is_none() {
                let current = self.guide_base_bounds(window);
                let healed = geometry::restore_compact(current, &areas, primary, self.settings.prompter_margin);
                if healed != current {
                    platform::set_bounds(window, self.with_guide_bounds(healed), cx);
                    self.last_origin = Some(healed.origin());
                    self.settings.position = Some(healed.origin());
                    self.save_now();
                }
            } else if self.presentation.fullscreen && self.presentation.transition.is_none() {
                let target = window.display(cx).map(|display| rect_of(display.bounds())).unwrap_or(primary);
                platform::set_bounds(window, target, cx);
                self.sync_capture_view(window, cx);
            }
        }
    }

    pub(super) fn move_to(&mut self, target: Rect, window: &mut Window, cx: &mut Context<Self>) {
        if cx.reduce_motion() {
            self.presentation.transition = None;
            platform::set_bounds(window, target, cx);
        } else {
            self.presentation.transition = Some((self.current_bounds(window), target, Instant::now()));
        }
        self.last_origin = Some(target.origin());
        cx.notify();
    }

    pub(super) fn set_fullscreen(&mut self, fullscreen: bool, window: &mut Window, cx: &mut Context<Self>) {
        if fullscreen {
            self.finish_guide(window, cx);
        }
        if fullscreen == self.presentation.fullscreen {
            return;
        }
        if self.settings_tab.is_some() {
            self.toggle_settings(window, cx);
        }
        self.framing = false;
        let target = if fullscreen {
            self.presentation.compact = Some(self.current_bounds(window));
            window.display(cx).map(|display| rect_of(display.bounds())).unwrap_or(work_areas(cx).1)
        } else {
            let (areas, primary) = work_areas(cx);
            geometry::restore_compact(
                self.presentation
                    .compact
                    .take()
                    .unwrap_or_else(|| geometry::window_size(self.settings.shape, self.size())),
                &areas,
                primary,
                self.settings.prompter_margin,
            )
        };
        self.presentation.change_mode(fullscreen, cx.reduce_motion(), Instant::now());
        if self.demo_pattern {
            eprintln!("[DEBUG-p6] mode full={fullscreen} target={target:?}");
            for delay in [400, 1000] {
                let app = cx.to_async();
                cx.foreground_executor()
                    .spawn(async move {
                        app.background_executor().timer(Duration::from_millis(delay)).await;
                        app.update(|cx| {
                            let state = cx.debug_state();
                            eprintln!("[DEBUG-p6] full={fullscreen} after={delay} windows={}", state["windows"]);
                        });
                    })
                    .detach();
            }
        }
        // The hover toolbar can disappear after activation. Keep Escape routed to the root.
        self.focus.focus(window, cx);
        if fullscreen {
            window.activate_window();
        }
        self.presentation.chrome_at = self.now_ms();
        self.presentation.chrome_shown = true;
        self.set_overlay_visible(true, window, cx);
        self.move_to(target, window, cx);
        self.sync_capture_view(window, cx);
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn entering_fullscreen_keeps_the_starting_surface_then_morphs_it() {
        let start = Instant::now();
        let mut presentation = Presentation::default();
        presentation.change_mode(true, false, start);
        let surface = presentation.camera_layout((324.0, 390.0), Shape::Circle, 288, 0, start);
        assert!((surface.left - 18.0).abs() < 1.0, "camera must not jump to the window edge");
        assert!((surface.top - 84.0).abs() < 1.0);
        assert!((surface.radius - 144.0).abs() < 1.0, "circle must not snap square");
        // Samples from unchanged 0.9.0 CSS in Chromium, with the window on its cubic curve.
        for (ms, viewport, left, top, width, height) in [
            (70, (424.0, 433.0), 16.7257, 78.0531, 297.625, 298.25),
            (140, (1122.0, 735.0), 9.0, 42.0, 705.0, 511.5),
            (210, (1820.0, 1037.0), 1.27434, 5.94692, 1711.53, 983.969),
            (280, (1920.0, 1080.0), 0.0, 0.0, 1920.0, 1080.0),
        ] {
            let surface =
                presentation.camera_layout(viewport, Shape::Circle, 288, 0, start + Duration::from_millis(ms));
            for (actual, expected) in
                [(surface.left, left), (surface.top, top), (surface.width, width), (surface.height, height)]
            {
                assert!((actual - expected).abs() < 0.03, "{ms} ms: {surface:?}");
            }
        }
        let halfway = start + Duration::from_millis(140);
        let before = presentation.camera_layout((1122.0, 735.0), Shape::Circle, 288, 0, halfway);
        presentation.change_mode(false, false, halfway);
        assert_eq!(
            presentation.camera_layout((1122.0, 735.0), Shape::Circle, 288, 0, halfway),
            before,
            "reversal stays continuous"
        );
    }

    #[test]
    fn exiting_fullscreen_keeps_the_full_surface_at_the_start() {
        let start = Instant::now();
        let mut presentation = Presentation { fullscreen: true, ..Default::default() };
        presentation.change_mode(false, false, start);
        let full = Rect::new(0, 0, 1920, 1080);
        let compact = Rect::new(120, 140, 324, 390);
        presentation.transition = Some((full, compact, start));
        assert_eq!(
            presentation.capture_bounds(compact).map(|bounds| (bounds.width, bounds.height)),
            Some((1920, 1080)),
            "keep sharp Full screen frames during exit"
        );
        let surface = presentation.camera_layout((1920.0, 1080.0), Shape::Circle, 288, 0, start);
        assert!((surface.width - 1920.0).abs() < 1.0, "camera must shrink with the window, not snap to 288px");
        assert!(surface.radius < 1.0);
        let halfway =
            presentation.camera_layout((1122.0, 735.0), Shape::Circle, 288, 0, start + Duration::from_millis(140));
        assert!((halfway.width - 705.0).abs() < 0.03);
        assert!((halfway.top - 42.0).abs() < 0.03);
        presentation.change_mode(true, true, start);
        assert!(presentation.surface_transition.is_none(), "reduced motion skips geometry animation");
        assert_eq!(presentation.camera_layout((1920.0, 1080.0), Shape::Circle, 288, 0, start).radius, 0.0);
    }
}
