//! One native camera window moves between Compact and Full screen; capture is never restarted.
use super::*;

#[derive(Default)]
pub(super) struct Presentation {
    pub fullscreen: bool,
    pub compact: Option<Rect>,
    pub transition: Option<(Rect, Rect, Instant)>,
    pub chrome_shown: bool,
    pub chrome_at: u64,
    areas: Vec<Rect>,
}

impl BubbleOverlay {
    pub(super) fn tick_presentation(&mut self, window: &mut Window, cx: &mut Context<Self>) {
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
            self.presentation.transition = Some((rect_of(window.bounds()), target, Instant::now()));
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
            self.presentation.compact = Some(rect_of(window.bounds()));
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
        self.presentation.fullscreen = fullscreen;
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
