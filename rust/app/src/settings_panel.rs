//! Inline Camera and Style controls. Settings changes share one path with toolbar actions.
use super::*;
use camframe_core::settings::{FrameEffect, Resolution};
use serde_json::{Value, json};

#[derive(Clone, Copy, PartialEq, Eq)]
pub(super) enum SettingsTab {
    Camera,
    Style,
    Scenes,
}

#[derive(Clone)]
pub(super) enum Control {
    Patch(Value),
    Tab(SettingsTab),
    Close,
    Scene(super::scenes_panel::SceneAction),
    GuideNext,
    GuideFinish,
}

// CamFrame 0.9.0's dark surface tokens.
const PANEL: u32 = 0x0c0c0d;
const CONTROL: u32 = 0x19191b;
const EDGE: u32 = 0x343438;
const TEXT: u32 = 0xe5e5e5;

impl BubbleOverlay {
    pub(super) fn patch_settings(&mut self, patch: Value, window: &mut Window, cx: &mut Context<Self>) {
        let previous = self.settings.clone();
        self.settings = self.settings.with_patch(&patch);
        self.settings =
            self.scene_edits.follow(&previous, self.settings.clone(), &self.active_scene_id, &patch, self.now_ms());
        if patch.get("effectColor").is_some() {
            let color = self.settings.effect_color.clone();
            self.color_input.update(cx, |input, cx| input.set_text(color, cx));
        }
        if previous.always_on_top != self.settings.always_on_top {
            platform::set_always_on_top(window, self.settings.always_on_top);
        }
        self.sync_capture_view(window);
        self.save_at = Some(self.now_ms() + POSITION_SAVE_DELAY_MS);
        cx.notify();
    }

    pub(super) fn toggle_settings(&mut self, window: &mut Window, cx: &mut Context<Self>) {
        self.settings_tab = if self.settings_tab.is_some() { None } else { Some(SettingsTab::Camera) };
        self.framing = false;
        if self.presentation.fullscreen {
            cx.notify();
            return;
        }
        let mut bounds = self.guide_base_bounds(window);
        let (width, height) = overlay_dimensions_for(self.settings.shape, self.size());
        bounds.width = i64::from(width);
        bounds.height = i64::from(if self.settings_tab.is_some() { height.max(390) } else { height });
        platform::set_bounds(window, self.with_guide_bounds(bounds));
        cx.notify();
    }

    fn run_control(&mut self, control: &Control, window: &mut Window, cx: &mut Context<Self>) {
        match control {
            Control::Patch(patch) => self.patch_settings(patch.clone(), window, cx),
            Control::Tab(tab) => {
                self.settings_tab = Some(*tab);
                cx.notify();
            }
            Control::Close => self.toggle_settings(window, cx),
            Control::Scene(action) => self.run_scene_action(action.clone(), window, cx),
            Control::GuideNext => self.advance_guide(window, cx),
            Control::GuideFinish => self.finish_guide(window, cx),
        }
    }

    pub(super) fn control(
        &self,
        id: String,
        label: String,
        selected: bool,
        control: Control,
        cx: &mut Context<Self>,
    ) -> gpui::Stateful<gpui::Div> {
        let key_control = control.clone();
        div()
            .id(SharedString::from(id))
            .role(gpui::Role::Button)
            .aria_label(label.clone())
            .tab_index(0)
            .px(px(8.0))
            .py(px(7.0))
            .rounded(px(6.0))
            .border_1()
            .border_color(rgb(if selected || self.high_contrast { TEXT } else { EDGE }))
            .bg(rgb(CONTROL))
            .text_xs()
            .min_w_0()
            .truncate()
            .text_color(rgb(TEXT))
            .cursor_pointer()
            .hover(|s| s.bg(rgb(0x2a2a2d)))
            .focus(|s| s.border_color(rgb(0xffffff)))
            .on_click(cx.listener(move |this, _, window, cx| this.run_control(&control, window, cx)))
            .on_key_down(cx.listener(move |this, event: &gpui::KeyDownEvent, window, cx| {
                if matches!(event.keystroke.key.as_str(), "enter" | "space") {
                    cx.stop_propagation();
                    this.run_control(&key_control, window, cx);
                }
            }))
            .child(label)
    }

    fn numeric(
        &self,
        key: &'static str,
        label: &'static str,
        value: u32,
        min: u32,
        max: u32,
        cx: &mut Context<Self>,
    ) -> gpui::Div {
        div().flex().flex_col().gap(px(4.0)).child(format!("{label}  {value}")).child(
            div()
                .id(key)
                .role(gpui::Role::Slider)
                .aria_label(label)
                .aria_numeric_value(f64::from(value))
                .aria_min_numeric_value(f64::from(min))
                .aria_max_numeric_value(f64::from(max))
                .aria_numeric_value_step(1.0)
                .tab_index(0)
                .h(px(22.0))
                .w_full()
                .rounded(px(6.0))
                .border_1()
                .border_color(rgb(EDGE))
                .bg(rgb(CONTROL))
                .focus(|s| s.border_color(rgb(TEXT)))
                .on_mouse_down(
                    MouseButton::Left,
                    cx.listener(move |this, event: &MouseDownEvent, window, cx| {
                        this.slider_drag = Some((key, min, max));
                        this.update_slider(f64::from(event.position.x), window, cx);
                    }),
                )
                .on_mouse_move(cx.listener(move |this, event: &gpui::MouseMoveEvent, window, cx| {
                    if event.dragging() && this.slider_drag.is_some_and(|drag| drag.0 == key) {
                        this.update_slider(f64::from(event.position.x), window, cx);
                    }
                }))
                .on_mouse_up(
                    MouseButton::Left,
                    cx.listener(|this, _, _, _| {
                        this.slider_drag = None;
                    }),
                )
                .on_key_down(cx.listener(move |this, event: &gpui::KeyDownEvent, window, cx| {
                    let next = match event.keystroke.key.as_str() {
                        "left" | "down" => value.saturating_sub(1).max(min),
                        "right" | "up" => value.saturating_add(1).min(max),
                        "home" => min,
                        "end" => max,
                        _ => return,
                    };
                    cx.stop_propagation();
                    this.patch_settings(json!({key:next}), window, cx);
                }))
                .child(
                    div()
                        .h_full()
                        .w(gpui::relative((value - min) as f32 / (max - min) as f32))
                        .rounded(px(5.0))
                        .bg(rgb(0x8b8b90)),
                ),
        )
    }

    fn update_slider(&mut self, x: f64, window: &mut Window, cx: &mut Context<Self>) {
        let Some((key, min, max)) = self.slider_drag else { return };
        let width = f64::from(dimensions_for(self.settings.shape, self.size()).0) - 26.0;
        let share = ((x - f64::from(OVERLAY_CHROME.left) - 13.0) / width).clamp(0.0, 1.0);
        self.patch_settings(json!({key:(f64::from(min)+share*f64::from(max-min)).round() as u32}), window, cx);
    }

    pub(super) fn render_settings(&self, cx: &mut Context<Self>) -> gpui::Stateful<gpui::Div> {
        let width = dimensions_for(self.settings.shape, self.size()).0 as f32;
        let (_, height) = overlay_dimensions_for(self.settings.shape, self.size());
        let mut body = div().flex().flex_col().gap(px(10.0));
        if self.settings_tab == Some(SettingsTab::Camera) {
            body = body.child("Camera");
            if !self.camera_notice.is_empty() {
                body = body.child(self.camera_notice.clone());
            }
            for error in &self.shortcut_errors {
                body = body.child(format!("Shortcut unavailable: {error}"));
            }
            let cameras = lock_unpoisoned(&self.slot.devices).clone();
            body = body.child(self.control(
                "default-camera".into(),
                "Default camera".into(),
                self.settings.camera_id.is_empty(),
                Control::Patch(json!({"cameraId":"", "cameraLabel":"Default camera"})),
                cx,
            ));
            for camera in cameras {
                body = body.child(self.control(
                    format!("camera-{}", camera.id),
                    camera.label.clone(),
                    self.settings.camera_id == camera.id,
                    Control::Patch(json!({"cameraId":camera.id, "cameraLabel":camera.label})),
                    cx,
                ));
            }
            body = body.child("Camera quality").child(div().flex().flex_wrap().gap(px(4.0)).children(
                Resolution::ALL.into_iter().map(|resolution| {
                    self.control(
                        format!("quality-{}", resolution.key()),
                        resolution.key().into(),
                        self.settings.overlay_resolution == resolution,
                        Control::Patch(json!({"overlayResolution":resolution})),
                        cx,
                    )
                }),
            ));
            for (key, label, checked) in [
                ("mirror", "Mirror camera", self.settings.mirror),
                ("alwaysOnTop", "Always on top", self.settings.always_on_top),
            ] {
                body = body.child(self.control(
                    key.into(),
                    format!("{label}  {}", if checked { "On" } else { "Off" }),
                    checked,
                    Control::Patch(json!({key:!checked})),
                    cx,
                ));
            }
        } else if self.settings_tab == Some(SettingsTab::Scenes) {
            body = self.render_scenes(cx);
        } else {
            body = body.child("Frame effect");
            for (effect, name) in
                [(FrameEffect::None, "None"), (FrameEffect::Glow, "Glow"), (FrameEffect::Blur, "Progressive blur")]
            {
                body = body.child(self.control(
                    format!("effect-{name}"),
                    name.into(),
                    self.settings.frame_effect == effect,
                    Control::Patch(json!({"frameEffect":effect})),
                    cx,
                ));
            }
            if self.settings.frame_effect == FrameEffect::Glow {
                body = body
                    .child("Effect color")
                    .child(self.color_input.clone())
                    .when(self.color_error, |body| body.child("Use #RGB or #RRGGBB."))
                    .child(
                        div().flex().flex_wrap().gap(px(4.0)).children(
                            [
                                ("Orange", "#fb923c"),
                                ("Cyan", "#22d3ee"),
                                ("Violet", "#8b5cf6"),
                                ("Pink", "#ec4899"),
                                ("Green", "#22c55e"),
                                ("White", "#ffffff"),
                            ]
                            .into_iter()
                            .map(|(name, color)| {
                                self.control(
                                    format!("color-{name}"),
                                    name.into(),
                                    self.settings.effect_color == color,
                                    Control::Patch(json!({"effectColor":color})),
                                    cx,
                                )
                            }),
                        ),
                    );
                body = body
                    .child(self.numeric("glowStrength", "Strength", self.settings.glow_strength, 10, 100, cx))
                    .child(self.numeric("glowSpread", "Spread", self.settings.glow_spread, 4, 18, cx));
            }
            if self.settings.frame_effect == FrameEffect::Blur {
                body = body
                    .child(self.numeric("blurAmount", "Blur", self.settings.blur_amount, 4, 18, cx))
                    .child(self.numeric("blurOpacity", "Opacity", self.settings.blur_opacity, 10, 100, cx));
            }
            body = body.child(self.numeric("borderWidth", "Frame", self.settings.border_width, 0, 12, cx));
        }
        div()
            .id("inline-settings")
            .absolute()
            .left(px(OVERLAY_CHROME.left as f32))
            .top(px(OVERLAY_CHROME.top as f32 + self.guide_reserve() as f32))
            .w(px(width))
            .h(px(height.max(390) as f32 - OVERLAY_CHROME.top as f32 - 18.0))
            .bg(rgb(PANEL))
            .border_1()
            .border_color(rgb(if self.high_contrast { TEXT } else { EDGE }))
            .rounded(px(12.0))
            .p(px(12.0))
            .flex()
            .flex_col()
            .gap(px(12.0))
            .text_xs()
            .text_color(rgb(TEXT))
            .child(
                div()
                    .flex()
                    .flex_wrap()
                    .gap(px(4.0))
                    .child(self.control(
                        "camera-tab".into(),
                        "Camera".into(),
                        self.settings_tab == Some(SettingsTab::Camera),
                        Control::Tab(SettingsTab::Camera),
                        cx,
                    ))
                    .child(self.control(
                        "style-tab".into(),
                        "Style".into(),
                        self.settings_tab == Some(SettingsTab::Style),
                        Control::Tab(SettingsTab::Style),
                        cx,
                    ))
                    .child(self.control(
                        "scenes-tab".into(),
                        "Scenes".into(),
                        self.settings_tab == Some(SettingsTab::Scenes),
                        Control::Tab(SettingsTab::Scenes),
                        cx,
                    ))
                    .child(self.control("close-settings".into(), "Close".into(), false, Control::Close, cx)),
            )
            .child(div().id("settings-scroll").flex_1().min_h_0().overflow_y_scroll().child(body))
    }
}
