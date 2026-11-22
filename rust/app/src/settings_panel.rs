//! Inline controls using the same measurements, hierarchy and controls as 0.9.0.
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
    Select(&'static str),
    Scene(super::scenes_panel::SceneAction),
    GuideNext,
    GuideBack,
    GuideFinish,
}

const PANEL: u32 = 0x0c0c0d;
const CONTROL: u32 = 0x202023;
const EDGE: u32 = 0x343438;
const TEXT: u32 = 0xf4f4f5;
const MUTED: u32 = 0xa1a1aa;

impl BubbleOverlay {
    pub(super) fn toggle_framing(&mut self, window: &mut Window, cx: &mut Context<Self>) {
        if self.settings_tab.is_some() {
            self.toggle_settings(window, cx);
        }
        self.framing = !self.framing;
        cx.notify();
    }
    pub(super) fn sync_color_input(&mut self, cx: &mut Context<Self>) {
        if self.color_input.read(cx).text != self.settings.effect_color {
            let color = self.settings.effect_color.clone();
            self.color_input.update(cx, |input, cx| input.set_text(color, cx));
        }
    }
    pub(super) fn patch_settings(&mut self, patch: Value, window: &mut Window, cx: &mut Context<Self>) {
        self.open_select = None;
        let previous = self.settings.clone();
        self.settings = self.settings.with_patch(&patch);
        self.settings =
            self.scene_edits.follow(&previous, self.settings.clone(), &self.active_scene_id, &patch, self.now_ms());
        if patch.get("effectColor").is_some() {
            self.sync_color_input(cx);
        }
        if patch.get("cameraId").is_some() || patch.get("overlayResolution").is_some() {
            self.camera_notice.clear();
        }
        if previous.always_on_top != self.settings.always_on_top {
            platform::set_always_on_top(window, self.settings.always_on_top);
        }
        self.sync_capture_view(window, cx);
        self.save_at = Some(self.now_ms() + POSITION_SAVE_DELAY_MS);
        cx.notify();
    }
    pub(super) fn toggle_settings(&mut self, _window: &mut Window, cx: &mut Context<Self>) {
        self.settings_tab = if self.settings_tab.is_some() { None } else { Some(SettingsTab::Camera) };
        self.open_select = None;
        self.settings_scroll.set_offset(point(px(0.0), px(0.0)));
        self.settings_scrollbar.set(false);
        self.framing = false;
        cx.notify();
    }
    fn run_control(&mut self, control: &Control, window: &mut Window, cx: &mut Context<Self>) {
        match control {
            Control::Patch(patch) => self.patch_settings(patch.clone(), window, cx),
            Control::Tab(tab) => {
                self.settings_tab = Some(*tab);
                self.settings_scroll.set_offset(point(px(0.0), px(0.0)));
                self.settings_scrollbar.set(false);
                self.open_select = None;
                cx.notify();
            }
            Control::Select(key) => {
                if *key == "camera" && lock_unpoisoned(&self.slot.devices).is_empty() {
                    return;
                }
                self.open_select = if self.open_select == Some(key) { None } else { Some(key) };
                cx.notify();
            }
            Control::Scene(action) => self.run_scene_action(action.clone(), window, cx),
            Control::GuideNext => self.advance_guide(window, cx),
            Control::GuideBack => self.back_guide(cx),
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
        div()
            .id(SharedString::from(id))
            .role(gpui::Role::Button)
            .aria_label(label.clone())
            .tab_index(0)
            .px(px(7.0))
            .h(px(28.0))
            .flex()
            .items_center()
            .rounded(px(6.0))
            .border_1()
            .border_color(if self.high_contrast { rgb(TEXT).into() } else { transparent_black() })
            .bg(rgb(if selected { 0x27272a } else { CONTROL }))
            .text_size(px(11.0))
            .min_w_0()
            .truncate()
            .text_color(rgb(TEXT))
            .cursor_pointer()
            .hover(|s| s.bg(rgb(0x27272a)))
            .focus(|s| s.border_color(rgb(0xfb923c)))
            .on_click(cx.listener(move |this, _, window, cx| {
                cx.stop_propagation();
                this.run_control(&control, window, cx);
            }))
            .when(!label.is_empty(), |button| button.child(label))
    }
    fn select(
        &self,
        key: &'static str,
        label: &str,
        value: String,
        options: Vec<(String, Value)>,
        width: f32,
        cx: &mut Context<Self>,
    ) -> gpui::Div {
        let selected_index = options.iter().position(|(label, _)| *label == value).unwrap_or(0);
        let keyboard_options = options.clone();
        let field = self
            .control(format!("{key}-select"), value, false, Control::Select(key), cx)
            .on_mouse_down(MouseButton::Left, |_, _, cx| cx.stop_propagation())
            .role(gpui::Role::ComboBox)
            .aria_label(label.to_owned())
            .aria_expanded(self.open_select == Some(key))
            .when(options.is_empty(), |field| field.opacity(0.42).tab_index(-1).cursor(CursorStyle::Arrow))
            .h(px(30.0))
            .w_full()
            .relative()
            .pr(px(24.0))
            .border_color(rgb(EDGE))
            .on_key_down(cx.listener(move |this, event: &gpui::KeyDownEvent, window, cx| {
                let next = match event.keystroke.key.as_str() {
                    "up" => selected_index.saturating_sub(1),
                    "down" => (selected_index + 1).min(keyboard_options.len().saturating_sub(1)),
                    "home" => 0,
                    "end" => keyboard_options.len().saturating_sub(1),
                    _ => return,
                };
                cx.stop_propagation();
                if let Some((_, patch)) = keyboard_options.get(next) {
                    this.patch_settings(patch.clone(), window, cx);
                }
            }))
            .child(div().absolute().right(px(8.0)).text_color(rgb(MUTED)).child("⌄"));
        let mut group = div()
            .relative()
            .flex()
            .flex_col()
            .gap(px(if key == "quality" { 4.0 } else { 6.0 }))
            .min_w_0()
            .flex_shrink_0()
            .child(div().text_color(rgb(MUTED)).child(label.to_owned()))
            .child(div().relative().child(field));
        if self.open_select == Some(key) {
            let menu = div()
                .id(SharedString::from(format!("{key}-options")))
                .role(gpui::Role::ListBox)
                .occlude()
                .w(px(width))
                .max_h(px(180.0))
                .overflow_y_scroll()
                .flex()
                .flex_col()
                .gap(px(1.0))
                .p(px(3.0))
                .rounded(px(7.0))
                .bg(rgb(CONTROL))
                .border_1()
                .border_color(rgb(EDGE))
                .on_mouse_down(MouseButton::Left, |_, _, cx| cx.stop_propagation())
                .children(options.into_iter().enumerate().map(|(i, (label, patch))| {
                    self.control(format!("{key}-option-{i}"), label, i == selected_index, Control::Patch(patch), cx)
                        .flex_shrink_0()
                }));
            group = group.child(
                gpui::deferred(
                    gpui::anchored()
                        .position_mode(gpui::AnchoredPositionMode::Local)
                        .position(point(px(0.0), px(52.0)))
                        .snap_to_window()
                        .child(menu),
                )
                .with_priority(1),
            );
        }
        group
    }
    fn switch(
        &self,
        key: &'static str,
        label: &'static str,
        checked: bool,
        cx: &mut Context<Self>,
    ) -> gpui::Stateful<gpui::Div> {
        self.control(key.into(), String::new(), checked, Control::Patch(json!({key:!checked})), cx)
            .role(gpui::Role::Switch)
            .aria_label(label)
            .aria_toggled(if checked { accesskit::Toggled::True } else { accesskit::Toggled::False })
            .w_full()
            .h(px(if key == "alwaysOnTop" { 31.0 } else { 30.0 }))
            .px(px(0.0))
            .bg(transparent_black())
            .border_0()
            .when(key == "alwaysOnTop", |row| row.border_t_1().border_color(rgb(0x1b1b1c)))
            .rounded_none()
            .justify_between()
            .child(div().text_color(rgb(MUTED)).child(label))
            .child(
                div()
                    .relative()
                    .w(px(28.0))
                    .h(px(16.0))
                    .rounded_full()
                    .bg(rgb(if checked { TEXT } else { 0x3f3f46 }))
                    .child(
                        div()
                            .absolute()
                            .left(px(if checked { 14.0 } else { 2.0 }))
                            .top(px(2.0))
                            .size(px(12.0))
                            .rounded_full()
                            .bg(rgb(if checked { PANEL } else { MUTED })),
                    ),
            )
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
        let share = (value - min) as f32 / (max - min) as f32;
        let unit = if matches!(key, "glowStrength" | "blurOpacity") { "%" } else { " px" };
        div()
            .flex()
            .flex_col()
            .gap(px(6.0))
            .flex_shrink_0()
            .child(
                div()
                    .flex()
                    .justify_between()
                    .text_color(rgb(MUTED))
                    .child(label)
                    .child(div().text_size(px(10.0)).text_color(rgb(0x71717a)).child(format!("{value}{unit}"))),
            )
            .child(
                div()
                    .id(key)
                    .role(gpui::Role::Slider)
                    .aria_label(label)
                    .aria_numeric_value(f64::from(value))
                    .aria_min_numeric_value(f64::from(min))
                    .aria_max_numeric_value(f64::from(max))
                    .aria_numeric_value_step(1.0)
                    .tab_index(0)
                    .h(px(14.0))
                    .w_full()
                    .relative()
                    .cursor_pointer()
                    .focus(|s| s.bg(rgb(0x343438)))
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
                    .on_mouse_up(MouseButton::Left, cx.listener(|this, _, _, _| this.slider_drag = None))
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
                    .child(div().absolute().top(px(5.5)).w_full().h(px(3.0)).rounded_full().bg(rgb(0x3f3f46)))
                    .child(
                        div()
                            .absolute()
                            .left(gpui::relative(share))
                            .ml(px(-12.0 * share))
                            .top(px(1.0))
                            .size(px(12.0))
                            .rounded_full()
                            .bg(rgb(TEXT)),
                    ),
            )
    }
    fn update_slider(&mut self, x: f64, window: &mut Window, cx: &mut Context<Self>) {
        let Some((key, min, max)) = self.slider_drag else { return };
        let native = rect_of(window.bounds());
        let bounds = camframe_core::chrome::settings_bounds(
            native.width as u32,
            native.height as u32,
            self.presentation.fullscreen,
            self.guide_reserve(),
        );
        let mut range_bounds = bounds;
        if self.settings_scrollbar.get() {
            range_bounds.width -= 17;
        }
        self.patch_settings(json!({key:camframe_core::chrome::slider_value(range_bounds,x,min,max)}), window, cx);
    }
    pub(super) fn update_settings_scroll(&mut self, y: f32, cx: &mut Context<Self>) {
        let Some(grab) = self.settings_scroll_drag else { return };
        let bounds = self.settings_scroll.bounds();
        let height = f32::from(bounds.size.height).max(1.0);
        let max = f32::from(self.settings_scroll.max_offset().y).max(0.0);
        let track = (height - 34.0).max(1.0);
        let thumb = (track * height / (height + max)).max(18.0).min(track);
        let share = ((y - f32::from(bounds.top()) - 17.0 - grab) / (track - thumb).max(1.0)).clamp(0.0, 1.0);
        self.settings_scroll.set_offset(point(px(0.0), px(-share * max)));
        cx.notify();
    }

    pub(super) fn render_settings(&self, window: &Window, cx: &mut Context<Self>) -> gpui::Stateful<gpui::Div> {
        let native = rect_of(window.bounds());
        let bounds = camframe_core::chrome::settings_bounds(
            native.width as u32,
            native.height as u32,
            self.presentation.fullscreen,
            self.guide_reserve(),
        );
        let scroll_height = f32::from(self.settings_scroll.bounds().size.height);
        let max_scroll = f32::from(self.settings_scroll.max_offset().y);
        let rows = (self.settings.presets.len() + 1).div_ceil(2) as f32;
        let width_correction = if self.settings_scrollbar.get()
            && self.settings_tab == Some(SettingsTab::Scenes)
            && self.settings.scene_view == camframe_core::settings::SceneView::Grid
        {
            17.0 * rows * 9.0 / 32.0
        } else {
            0.0
        };
        let show_scrollbar = cfg!(target_os = "windows")
            && scroll_height + max_scroll + width_correction > bounds.height as f32 - 2.0 + 0.5;
        self.settings_scrollbar.set(show_scrollbar);
        let rail = if show_scrollbar { 17.0 } else { 0.0 };
        let available = bounds.width as f32 - 22.0 - rail;
        let mut body = div().flex().flex_col().gap(px(8.0)).min_w_0();
        match self.settings_tab {
            Some(SettingsTab::Camera) => {
                let cameras = lock_unpoisoned(&self.slot.devices).clone();
                let choices = cameras
                    .iter()
                    .map(|camera| (camera.label.clone(), json!({"cameraId":camera.id,"cameraLabel":camera.label})))
                    .collect::<Vec<_>>();
                let selected = cameras
                    .iter()
                    .find(|camera| camera.id == self.settings.camera_id)
                    .or_else(|| cameras.first())
                    .map(|camera| camera.label.clone())
                    .unwrap_or_else(|| "No cameras found".into());
                body = body.child(self.select("camera", "Camera", selected, choices, available, cx));
                let resolutions = Resolution::ALL
                    .into_iter()
                    .map(|r| {
                        ((if r == Resolution::R2160 { "4K" } else { r.key() }).into(), json!({"overlayResolution":r}))
                    })
                    .collect();
                body = body
                    .child(
                        div()
                            .flex()
                            .flex_col()
                            .gap(px(0.0))
                            .child(div().text_color(rgb(MUTED)).child("Camera quality"))
                            .child(
                                self.select(
                                    "quality",
                                    "Resolution",
                                    (if self.settings.overlay_resolution == Resolution::R2160 {
                                        "4K"
                                    } else {
                                        self.settings.overlay_resolution.key()
                                    })
                                    .into(),
                                    resolutions,
                                    available,
                                    cx,
                                ),
                            ),
                    )
                    .child(
                        div()
                            .flex()
                            .flex_col()
                            .border_t_1()
                            .border_b_1()
                            .border_color(rgb(0x202021))
                            .child(self.switch("mirror", "Mirror camera", self.settings.mirror, cx))
                            .child(self.switch("alwaysOnTop", "Always on top", self.settings.always_on_top, cx)),
                    );
                if !self.camera_notice.is_empty() {
                    body = body.child(self.camera_notice.clone());
                }
                for error in &self.shortcut_errors {
                    body = body.child(error.clone());
                }
            }
            Some(SettingsTab::Scenes) => body = self.render_scenes(window, available, cx),
            _ => {
                let effects =
                    [(FrameEffect::None, "None"), (FrameEffect::Glow, "Glow"), (FrameEffect::Blur, "Progressive blur")];
                let selected = effects.iter().find(|(effect, _)| *effect == self.settings.frame_effect).unwrap().1;
                body = body.child(self.select(
                    "effect",
                    "Frame effect",
                    selected.into(),
                    effects.into_iter().map(|(effect, name)| (name.into(), json!({"frameEffect":effect}))).collect(),
                    available,
                    cx,
                ));
                if self.settings.frame_effect == FrameEffect::Glow {
                    body = body
                        .child(
                            div()
                                .flex()
                                .flex_col()
                                .gap(px(6.0))
                                .child(div().text_color(rgb(MUTED)).child("Effect color"))
                                .child(
                                    div()
                                        .flex()
                                        .items_center()
                                        .gap(px(8.0))
                                        .child(div().w(px(68.0)).flex_shrink_0().child(self.color_input.clone()))
                                        .child(
                                            div().flex().flex_wrap().justify_end().gap(px(4.0)).children(
                                                [
                                                    ("Orange", "#fb923c"),
                                                    ("Cyan", "#22d3ee"),
                                                    ("Violet", "#8b5cf6"),
                                                    ("Pink", "#ec4899"),
                                                    ("Green", "#22c55e"),
                                                    ("White", "#ffffff"),
                                                ]
                                                .into_iter()
                                                .map(
                                                    |(name, color)| {
                                                        self.control(
                                                            format!("color-{name}"),
                                                            String::new(),
                                                            self.settings.effect_color == color,
                                                            Control::Patch(json!({"effectColor":color})),
                                                            cx,
                                                        )
                                                        .aria_label(name)
                                                        .aria_toggled(if self.settings.effect_color == color {
                                                            accesskit::Toggled::True
                                                        } else {
                                                            accesskit::Toggled::False
                                                        })
                                                        .size(px(18.0))
                                                        .p(px(0.0))
                                                        .rounded(px(5.0))
                                                        .border_2()
                                                        .border_color(rgb(if self.settings.effect_color == color {
                                                            TEXT
                                                        } else {
                                                            CONTROL
                                                        }))
                                                        .bg(rgb(hex_color(color).unwrap()))
                                                    },
                                                ),
                                            ),
                                        ),
                                )
                                .when(self.color_error, |body| body.child("Use #RGB or #RRGGBB.")),
                        )
                        .child(
                            div()
                                .flex()
                                .flex_col()
                                .gap(px(10.0))
                                .child(self.numeric(
                                    "glowStrength",
                                    "Glow strength",
                                    self.settings.glow_strength,
                                    10,
                                    100,
                                    cx,
                                ))
                                .child(self.numeric("glowSpread", "Glow spread", self.settings.glow_spread, 4, 18, cx)),
                        );
                }
                if self.settings.frame_effect == FrameEffect::Blur {
                    body = body.child(
                        div()
                            .flex()
                            .flex_col()
                            .gap(px(10.0))
                            .child(self.numeric("blurAmount", "Blur", self.settings.blur_amount, 4, 18, cx))
                            .child(self.numeric("blurOpacity", "Opacity", self.settings.blur_opacity, 10, 100, cx)),
                    );
                }
                body = body.child(self.numeric("borderWidth", "Frame", self.settings.border_width, 0, 12, cx));
            }
        }
        let tabs = div().flex().gap(px(3.0)).p(px(3.0)).rounded(px(9.0)).bg(rgb(0x181819)).children(
            [(SettingsTab::Camera, "Camera"), (SettingsTab::Style, "Style"), (SettingsTab::Scenes, "Scenes")]
                .into_iter()
                .map(|(tab, name)| {
                    self.control(
                        format!("{}-tab", name.to_lowercase()),
                        name.into(),
                        self.settings_tab == Some(tab),
                        Control::Tab(tab),
                        cx,
                    )
                    .flex_1()
                    .justify_center()
                    .bg(if self.settings_tab == Some(tab) { rgb(0x27272a).into() } else { transparent_black() })
                    .text_color(rgb(if self.settings_tab == Some(tab) { 0xfafafa } else { 0x71717a }))
                    .font_weight(gpui::FontWeight::SEMIBOLD)
                }),
        );
        let panel = div()
            .id("inline-settings")
            .absolute()
            .left(px(bounds.x as f32))
            .top(px(bounds.y as f32))
            .w(px(bounds.width as f32))
            .max_h(px(bounds.height as f32))
            .bg(if self.high_contrast { rgb(PANEL) } else { gpui::rgba(0x0c0c0df5) })
            .when(!self.high_contrast, |panel| {
                panel.shadow(vec![
                    gpui::BoxShadow::new(px(0.0), px(12.0), gpui::rgba(0x0000006b).into()).blur_radius(px(32.0)),
                ])
            })
            .border_1()
            .border_color(rgb(if self.high_contrast { TEXT } else { 0x252526 }))
            .rounded(px(12.0))
            .flex()
            .text_size(px(11.0))
            .line_height(px(16.0))
            .text_color(rgb(TEXT))
            .child(
                div()
                    .id("settings-scroll")
                    .flex_1()
                    .min_w_0()
                    .min_h_0()
                    .max_h(px(bounds.height as f32 - 2.0))
                    .overflow_y_scroll()
                    .track_scroll(&self.settings_scroll)
                    .p(px(10.0))
                    .flex()
                    .flex_col()
                    .gap(px(8.0))
                    .on_scroll(cx.listener(|_, _, _, cx| cx.notify()))
                    .child(tabs.flex_shrink_0())
                    .child(body.flex_shrink_0()),
            );
        if !show_scrollbar {
            return panel;
        }
        let height = scroll_height.max(1.0);
        let track = (height - 34.0).max(1.0);
        let thumb = (track * height / (height + max_scroll.max(0.0))).max(18.0).min(track);
        let top = 17.0
            + if max_scroll > 0.0 {
                -f32::from(self.settings_scroll.offset().y) / max_scroll * (track - thumb)
            } else {
                0.0
            };
        panel.child(
            div()
                .id("settings-scrollbar")
                .relative()
                .w(px(17.0))
                .flex_shrink_0()
                .h(px(height))
                .bg(rgb(0xf1f1f1))
                .on_mouse_down(
                    MouseButton::Left,
                    cx.listener(move |this, event: &MouseDownEvent, _, cx| {
                        cx.stop_propagation();
                        let local = f32::from(event.position.y) - f32::from(this.settings_scroll.bounds().top());
                        if local >= top && local <= top + thumb && max_scroll > 0.0 {
                            this.settings_scroll_drag = Some(local - top);
                            this.update_settings_scroll(f32::from(event.position.y), cx);
                        } else {
                            let delta = if local < 17.0 {
                                20.0
                            } else if local > height - 17.0 {
                                -20.0
                            } else if local < top {
                                height
                            } else {
                                -height
                            };
                            let offset =
                                (f32::from(this.settings_scroll.offset().y) + delta).clamp(-max_scroll.max(0.0), 0.0);
                            this.settings_scroll.set_offset(point(px(0.0), px(offset)));
                            cx.notify();
                        }
                    }),
                )
                .when(max_scroll > 0.0, |bar| {
                    bar.child(div().absolute().left(px(2.0)).top(px(top)).w(px(13.0)).h(px(thumb)).bg(rgb(0xc1c1c1)))
                })
                .child(
                    div()
                        .absolute()
                        .top_0()
                        .w_full()
                        .h(px(17.0))
                        .bg(rgb(0xf1f1f1))
                        .flex()
                        .items_center()
                        .justify_center()
                        .text_size(px(8.0))
                        .text_color(rgb(0x5e5e5e))
                        .child("▲"),
                )
                .child(
                    div()
                        .absolute()
                        .bottom_0()
                        .w_full()
                        .h(px(17.0))
                        .bg(rgb(0xf1f1f1))
                        .flex()
                        .items_center()
                        .justify_center()
                        .text_size(px(8.0))
                        .text_color(rgb(0x5e5e5e))
                        .child("▼"),
                ),
        )
    }
}
