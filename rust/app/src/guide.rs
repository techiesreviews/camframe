//! The requested simpler four-tip guide. No ghost mouse or automatic camera edits.
use super::*;
use settings_panel::Control;
const RESERVE: u32 = 220;
const TIPS: [(&str, &str); 4] = [
    ("Camera", "Choose your camera in Camera settings. CamFrame uses the picture only, never the microphone."),
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
        self.settings_tab = None;
        self.set_overlay_visible(true, window, cx);
        platform::set_bounds(window, self.with_guide_bounds(base));
        self.announcement = "Camera. Tip 1 of 4.".into();
        cx.notify();
    }
    pub(super) fn finish_guide(&mut self, window: &mut Window, cx: &mut Context<Self>) {
        if self.guide_step.is_none() {
            return;
        }
        let base = self.guide_base_bounds(window);
        self.guide_step = None;
        self.settings.completed_onboarding_version = 1;
        if !self.pinned_position {
            self.settings.position = Some(base.origin());
        }
        platform::set_bounds(window, base);
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
            self.announcement = format!("{}. Tip {} of 4.", TIPS[step + 1].0, step + 2);
            cx.notify();
        }
    }
    pub(super) fn render_guide(&self, cx: &mut Context<Self>) -> impl IntoElement {
        let step = self.guide_step.unwrap_or(0);
        let (title, text) = TIPS[step];
        let width = dimensions_for(self.settings.shape, self.size()).0 as f32;
        div()
            .id("first-run-guide")
            .role(gpui::Role::Dialog)
            .aria_label(format!("{title}. Tip {} of 4", step + 1))
            .absolute()
            .left(px(18.0))
            .top(px(8.0))
            .w(px(width))
            .h(px(190.0))
            .p(px(12.0))
            .rounded(px(12.0))
            .bg(rgb(0x0c0c0d))
            .border_1()
            .border_color(rgb(0x8b8b90))
            .flex()
            .flex_col()
            .gap(px(8.0))
            .text_xs()
            .text_color(rgb(0xe5e5e5))
            .child(format!("{} of 4 · {title}", step + 1))
            .child(text)
            .child(div().flex_1())
            .child(div().h(px(3.0)).w(gpui::relative((step + 1) as f32 / 4.0)).bg(rgb(0xffffff)))
            .child(
                div()
                    .flex()
                    .flex_wrap()
                    .gap(px(6.0))
                    .child(self.control("skip-guide".into(), "Skip".into(), false, Control::GuideFinish, cx))
                    .child(self.control(
                        "next-guide".into(),
                        if step == 3 { "Finish" } else { "Next" }.into(),
                        true,
                        Control::GuideNext,
                        cx,
                    )),
            )
    }
}
