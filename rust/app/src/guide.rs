//! The requested simpler four-tip guide. No ghost mouse or automatic camera edits.
use super::*;
use settings_panel::Control;
const RESERVE: u32 = 220;
const TIPS: [(&str, &str); 4] = [
    ("Camera", "Choose which camera CamFrame shows. Only your picture is used, never your microphone."),
    ("Shape", "Use Shape to choose your camera shape. Drag the picture to move it; drag a corner to resize."),
    ("Framing", "Choose the crosshair. Drag to pan, scroll to zoom, and double-click to reset. Escape leaves framing."),
    ("Scenes", "Open Settings, then Scenes. Save your look and place; choose a Scene to return to it."),
];

impl BubbleOverlay {
    pub(super) fn guide_reserve(&self) -> u32 {
        if self.guide_step.is_some() { RESERVE } else { 0 }
    }
    pub(super) fn guide_base_bounds(&self, window: &Window) -> Rect {
        let mut bounds = rect_of(window.bounds());
        let reserve = i64::from(self.guide_reserve());
        bounds.y += reserve;
        bounds.height -= reserve;
        bounds
    }
    pub(super) fn with_guide_bounds(&self, mut base: Rect) -> Rect {
        let reserve = i64::from(self.guide_reserve());
        base.y -= reserve;
        base.height += reserve;
        base
    }
    pub(super) fn show_guide(&mut self, window: &mut Window, cx: &mut Context<Self>) {
        if self.guide_step.is_some() {
            return;
        }
        self.set_fullscreen(false, window, cx);
        if self.settings_tab.is_some() {
            self.toggle_settings(window, cx);
        }
        let base = self.presentation.transition.take().map_or_else(|| rect_of(window.bounds()), |(_, to, _)| to);
        self.guide_step = Some(0);
        self.framing = false;
        self.settings_tab = Some(SettingsTab::Camera);
        self.set_overlay_visible(true, window, cx);
        platform::set_bounds(window, self.with_guide_bounds(base), cx);
        self.announcement = "Camera. Tip 1 of 4.".into();
        cx.notify();
    }
    pub(super) fn finish_guide(&mut self, window: &mut Window, cx: &mut Context<Self>) {
        if self.guide_step.is_none() {
            return;
        }
        let base = self.guide_base_bounds(window);
        self.guide_step = None;
        self.settings_tab = None;
        self.open_select = None;
        self.framing = false;
        self.settings.completed_onboarding_version = 1;
        if !self.pinned_position {
            self.settings.position = Some(base.origin());
        }
        platform::set_bounds(window, base, cx);
        self.last_origin = Some(base.origin());
        self.save_now();
        cx.notify();
    }
    pub(super) fn advance_guide(&mut self, window: &mut Window, cx: &mut Context<Self>) {
        let Some(step) = self.guide_step else { return };
        if step == 3 {
            self.finish_guide(window, cx);
        } else {
            self.guide_step = Some(step + 1);
            self.settings_tab = if step + 1 == 3 { Some(SettingsTab::Scenes) } else { None };
            self.framing = false;
            self.announcement = format!("{}. Tip {} of 4.", TIPS[step + 1].0, step + 2);
            cx.notify();
        }
    }
    pub(super) fn back_guide(&mut self, cx: &mut Context<Self>) {
        let step = self.guide_step.unwrap_or(0).saturating_sub(1);
        self.guide_step = Some(step);
        self.announcement = format!("{}. Tip {} of 4.", TIPS[step].0, step + 1);
        self.settings_tab = if step == 0 { Some(SettingsTab::Camera) } else { None };
        self.framing = false;
        cx.notify();
    }
    pub(super) fn render_guide(&self, cx: &mut Context<Self>) -> impl IntoElement {
        let step = self.guide_step.unwrap_or(0);
        let (title, text) = TIPS[step];
        let window_width = overlay_dimensions_for(self.settings.shape, self.size()).0 as f32;
        let width = 244.0_f32.min(window_width - 16.0);
        div()
            .id("first-run-guide")
            .role(gpui::Role::Dialog)
            .aria_label(format!("{title}. Tip {} of 4", step + 1))
            .absolute()
            .left(px((window_width - width) / 2.0))
            .top(px(40.0))
            .w(px(width))
            .h(px(190.0))
            .p(px(8.0))
            .rounded(px(12.0))
            .bg(rgb(0x0c0c0d))
            .border_1()
            .border_color(rgb(if self.high_contrast { 0xf4f4f5 } else { 0x29292a }))
            .flex()
            .flex_col()
            .gap(px(6.0))
            .text_color(rgb(0xf4f4f5))
            .child(
                div()
                    .flex()
                    .items_center()
                    .justify_between()
                    .h(px(24.0))
                    .flex_shrink_0()
                    .child(div().text_size(px(11.0)).text_color(rgb(0xa1a1aa)).child("Getting started"))
                    .child(
                        self.control("skip-guide".into(), "Skip".into(), false, Control::GuideFinish, cx)
                            .h(px(24.0))
                            .bg(transparent_black()),
                    ),
            )
            .child(
                div()
                    .id("guide-progress")
                    .role(gpui::Role::ProgressIndicator)
                    .aria_label("Onboarding progress")
                    .aria_numeric_value((step + 1) as f64)
                    .aria_min_numeric_value(1.0)
                    .aria_max_numeric_value(4.0)
                    .flex()
                    .gap(px(4.0))
                    .h(px(3.0))
                    .flex_shrink_0()
                    .children((0..4).map(|i| {
                        div().flex_1().h(px(3.0)).rounded_full().bg(rgb(if i <= step { 0xfb923c } else { 0x3f3f46 }))
                    })),
            )
            .child(div().text_size(px(18.0)).line_height(px(22.0)).font_weight(gpui::FontWeight::SEMIBOLD).child(title))
            .child(div().flex_1().text_size(px(14.0)).line_height(px(19.0)).child(text))
            .child(
                div()
                    .flex()
                    .justify_between()
                    .h(px(34.0))
                    .flex_shrink_0()
                    .when(step > 0, |row| {
                        row.child(
                            self.control("back-guide".into(), "Back".into(), false, Control::GuideBack, cx).h(px(34.0)),
                        )
                    })
                    .child(
                        self.control(
                            "next-guide".into(),
                            if step == 3 { "Done" } else { "Next" }.into(),
                            false,
                            if step == 3 { Control::GuideFinish } else { Control::GuideNext },
                            cx,
                        )
                        .h(px(34.0))
                        .bg(rgb(0xfb923c))
                        .text_color(rgb(0x0c0c0d)),
                    ),
            )
    }
}
