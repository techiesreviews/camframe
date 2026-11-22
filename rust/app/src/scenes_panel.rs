//! Scenes UI, dialogs and the window adapter around the portable Scene library.
use super::*;
use camframe_core::{scenes, settings::SceneView};
use settings_panel::Control;

#[derive(Clone, Debug, PartialEq, Eq)]
pub(super) enum SceneAction {
    Apply(usize),
    Focus(usize),
    Save,
    Rename(usize),
    Delete(usize),
    Move(usize, i32),
    Undo,
    UndoLatest,
    UndoDelete,
    Import,
    Export,
    View(SceneView),
    SaveOpen,
    CancelEdit,
}

fn scene_row_key(
    key: &str,
    modifiers: gpui::Modifiers,
    renaming: bool,
    index: usize,
    count: usize,
) -> Option<SceneAction> {
    if renaming {
        return None;
    }
    Some(match key {
        "f2" => SceneAction::Rename(index),
        "delete" | "backspace" => SceneAction::Delete(index),
        "enter" | "space" => SceneAction::Apply(index),
        "up" | "left" | "down" | "right" => {
            let delta = if matches!(key, "up" | "left") { -1 } else { 1 };
            if modifiers.alt {
                SceneAction::Move(index, delta)
            } else {
                SceneAction::Focus((index as i32 + delta).clamp(0, count.saturating_sub(1) as i32) as usize)
            }
        }
        "z" if modifiers.control || modifiers.platform => SceneAction::UndoLatest,
        _ => return None,
    })
}
impl BubbleOverlay {
    pub(super) fn apply_scene_at(&mut self, index: usize, window: &mut Window, cx: &mut Context<Self>) {
        self.finish_guide(window, cx);
        let Some(scene) = self.settings.presets.get(index).cloned() else { return };
        let compact = self.presentation.compact.unwrap_or_else(|| rect_of(window.bounds()));
        self.set_fullscreen(false, window, cx);
        let (areas, primary) = work_areas(cx);
        self.settings = scenes::apply_scene(&self.settings, &scene, compact, &areas, primary);
        self.sync_color_input(cx);
        self.camera_notice.clear();
        self.active_scene_id = scene.id;
        self.announcement = scene.name;
        self.scene_edits.clear_change();
        let bounds = geometry::window_size(self.settings.shape, self.size())
            .at(self.settings.position.unwrap_or(compact.origin()));
        self.move_to(bounds, window, cx);
        self.sync_capture_view(window);
        self.save_now();
        self.update_tray_scenes();
        cx.notify();
    }

    pub(super) fn save_scene_name(&mut self, name: &str, window: &mut Window, cx: &mut Context<Self>) {
        let renaming = self.scene_rename.is_some();
        let result = if let Some(id) = self.scene_rename.clone() {
            scenes::rename_scene(&self.settings, &id, name).map(|settings| (settings, self.active_scene_id.clone()))
        } else {
            if !self.presentation.fullscreen {
                self.settings.position = Some(self.guide_base_bounds(window).origin());
            }
            let id = format!("preset-{}-{}", std::process::id(), self.clock.elapsed().as_nanos());
            scenes::save_look(&self.settings, name, &id)
        };
        match result {
            Ok((settings, id)) => {
                self.settings = settings;
                self.active_scene_id = id;
                self.scene_status.clear();
                self.scene_save_open = false;
                self.scene_rename = None;
                if !renaming {
                    self.scene_edits.clear_change();
                    self.scene_edits.clear_delete();
                }
                self.save_now();
                self.update_tray_scenes();
            }
            Err(error) => {
                self.scene_status_action = None;
                self.scene_status = error;
            }
        }
        cx.notify();
    }

    pub(super) fn run_scene_action(&mut self, action: SceneAction, window: &mut Window, cx: &mut Context<Self>) {
        match action {
            SceneAction::Apply(i) => self.apply_scene_at(i, window, cx),
            SceneAction::Focus(i) => {
                if let Some(focus) = self.scene_focus.get(i) {
                    focus.focus(window, cx);
                }
            }
            SceneAction::Save => {
                let name = self.scene_input.read(cx).text.clone();
                self.save_scene_name(&name, window, cx);
            }
            SceneAction::Rename(i) => {
                if let Some(scene) = self.settings.presets.get(i) {
                    self.scene_rename = Some(scene.id.clone());
                    self.scene_status.clear();
                    self.scene_status_action = None;
                    let name = scene.name.clone();
                    self.scene_input.update(cx, |input, cx| input.set_text(name, cx));
                    self.scene_input.focus_handle(cx).focus(window, cx);
                }
            }
            SceneAction::Delete(i) => {
                if let Some(scene) = self.settings.presets.get(i) {
                    let id = scene.id.clone();
                    if let Some(next) =
                        self.scene_edits.delete(&self.settings, &id, self.active_scene_id == id, self.now_ms())
                    {
                        self.settings = next;
                        if self.active_scene_id == id {
                            self.active_scene_id.clear();
                        }
                        self.scene_undo_focus.focus(window, cx);
                        self.save_now();
                        self.update_tray_scenes();
                    }
                }
            }
            SceneAction::Move(i, offset) => {
                if let Some(scene) = self.settings.presets.get(i) {
                    let target =
                        (i as i32 + offset).clamp(0, self.settings.presets.len().saturating_sub(1) as i32) as usize;
                    self.settings = scenes::reorder_scene(&self.settings, &scene.id, target);
                    self.scene_focus[target].focus(window, cx);
                    self.save_now();
                    self.update_tray_scenes();
                }
            }
            SceneAction::UndoLatest => {
                let target = self.scene_edits.undo_target(&self.active_scene_id, self.now_ms());
                match target {
                    Some(scenes::UndoKind::Delete) => self.run_scene_action(SceneAction::UndoDelete, window, cx),
                    Some(scenes::UndoKind::Change) => self.run_scene_action(SceneAction::Undo, window, cx),
                    None => {}
                }
            }
            SceneAction::Undo => {
                if let Some(settings) =
                    self.scene_edits.undo_change(&self.settings, &self.active_scene_id, self.now_ms())
                {
                    self.settings = settings;
                    if let Some(i) = self.settings.presets.iter().position(|s| s.id == self.active_scene_id) {
                        self.apply_scene_at(i, window, cx);
                    }
                }
            }
            SceneAction::UndoDelete => {
                if let Some((settings, active)) = self.scene_edits.restore_delete(&self.settings, self.now_ms()) {
                    let restored_index = settings
                        .presets
                        .iter()
                        .position(|scene| !self.settings.presets.iter().any(|old| old.id == scene.id));
                    self.settings = settings;
                    if let Some(index) = restored_index {
                        self.scene_focus[index].focus(window, cx);
                    }
                    if self.active_scene_id.is_empty()
                        && let Some(id) = active
                        && let Some(i) = self.settings.presets.iter().position(|s| s.id == id)
                    {
                        self.apply_scene_at(i, window, cx);
                    }
                    self.save_now();
                    self.update_tray_scenes();
                }
            }
            SceneAction::View(view) => {
                self.settings.scene_view = view;
                self.save_now();
            }
            SceneAction::SaveOpen => {
                if self.settings.presets.len() < 6 {
                    self.scene_save_open = true;
                    self.scene_status.clear();
                    self.scene_status_action = None;
                    self.scene_input.update(cx, |input, cx| input.set_text(String::new(), cx));
                    self.scene_input.focus_handle(cx).focus(window, cx);
                }
            }
            SceneAction::CancelEdit => {
                self.scene_save_open = false;
                self.scene_rename = None;
                self.scene_status.clear();
            }
            SceneAction::Import => self.import_scene_file(window, cx),
            SceneAction::Export => self.export_scene_file(window, cx),
        }
        cx.notify();
    }

    fn import_scene_file(&mut self, window: &mut Window, cx: &mut Context<Self>) {
        let choose = cx.prompt_for_paths(gpui::PathPromptOptions {
            files: true,
            directories: false,
            multiple: false,
            prompt: None,
        });
        cx.spawn_in(window, async move |entity, cx| {
            let Ok(Ok(Some(paths))) = choose.await else { return };
            let Some(path) = paths.first() else { return };
            let text = std::fs::metadata(path).and_then(|metadata| {
                if metadata.len() > 1024 * 1024 {
                    Err(std::io::Error::other("Scene file is too large."))
                } else {
                    std::fs::read_to_string(path)
                }
            });
            let _ = entity.update_in(cx, |this, _, cx| {
                let result = text.map_err(|e| e.to_string()).and_then(|text| {
                    scenes::import_scenes(
                        &scenes::SceneLibrary {
                            settings: this.settings.clone(),
                            active_scene_id: this.active_scene_id.clone(),
                        },
                        &text,
                    )
                });
                match result {
                    Ok(imported) => {
                        this.settings = imported.library.settings;
                        this.sync_color_input(cx);
                        this.scene_status = format!("Imported {}", imported.imported_count);
                        this.scene_status_ok = true;
                        this.scene_edits.clear_delete();
                        this.save_now();
                        this.update_tray_scenes();
                    }
                    Err(error) => {
                        this.scene_status = error;
                        this.scene_status_ok = false;
                    }
                }
                this.announcement = this.scene_status.clone();
                this.scene_status_action = Some("Import");
                this.scene_status_until = this.now_ms() + 2400;
                cx.notify();
            });
        })
        .detach();
    }
    fn export_scene_file(&mut self, window: &mut Window, cx: &mut Context<Self>) {
        let choose = cx.prompt_for_new_path(
            &std::env::current_dir().unwrap_or_else(|_| PathBuf::from(".")),
            Some("camframe-scenes.json"),
        );
        let text =
            serde_json::to_string_pretty(&scenes::scene_export(&self.settings)).expect("Scene export serializes");
        let exported_count = self.settings.presets.len();
        cx.spawn_in(window, async move |entity, cx| {
            let Ok(Ok(Some(path))) = choose.await else { return };
            let result = std::fs::write(path, text);
            let _ = entity.update_in(cx, |this, _, cx| {
                this.scene_status_ok = result.is_ok();
                this.scene_status = match result {
                    Ok(()) => format!("Exported {exported_count}"),
                    Err(error) => format!("Export failed: {error}"),
                };
                this.announcement = this.scene_status.clone();
                this.scene_status_action = Some("Export");
                this.scene_status_until = this.now_ms() + 2400;
                cx.notify();
            });
        })
        .detach();
    }

    pub(super) fn update_tray_scenes(&self) {
        if let Some(tray) = &self.tray {
            tray.set_scenes(&self.settings.presets, &self.active_scene_id);
        }
    }

    fn scene_icon(
        &self,
        id: String,
        label: String,
        icon: &'static str,
        action: SceneAction,
        cx: &mut Context<Self>,
    ) -> gpui::Stateful<gpui::Div> {
        self.control(id, String::new(), false, Control::Scene(action), cx)
            .aria_label(label)
            .size(px(24.0))
            .p(px(0.0))
            .justify_center()
            .bg(transparent_black())
            .focus(|s| s.opacity(1.0).border_color(rgb(0xfb923c)))
            .child(svg().path(icon).size(px(14.0)).text_color(rgb(0xa1a1aa)))
    }
    pub(super) fn render_scenes(&self, window: &Window, available: f32, cx: &mut Context<Self>) -> gpui::Div {
        let grid = self.settings.scene_view == SceneView::Grid;
        let now = self.now_ms();
        let mut list = div().flex().flex_wrap().gap(px(if grid { 6.0 } else { 2.0 }));
        let (areas, primary) = work_areas(cx);
        let row_width = if grid { (available - 6.0) / 2.0 } else { available };
        let removal = self.scene_edits.removal_preview(now);
        for slot in 0..self.settings.presets.len() + usize::from(removal.is_some()) {
            if let Some((scene, index, remaining)) = removal
                && slot == index
            {
                list = list.child(
                    div()
                        .relative()
                        .w(px(row_width))
                        .h(px(if grid { 82.0 } else { 40.0 }))
                        .p(px(5.0))
                        .rounded(px(8.0))
                        .bg(rgb(0x151516))
                        .flex()
                        .items_center()
                        .justify_between()
                        .gap(px(4.0))
                        .child(
                            div()
                                .min_w_0()
                                .truncate()
                                .text_color(rgb(0x71717a))
                                .child(format!("{} deleted", scene.name)),
                        )
                        .child(
                            self.scene_icon(
                                "undo-delete".into(),
                                "Undo delete".into(),
                                "icons/arrow-counter-clockwise.svg",
                                SceneAction::UndoDelete,
                                cx,
                            )
                            .track_focus(&self.scene_undo_focus),
                        )
                        .when(!cx.reduce_motion(), |row| {
                            row.child(
                                div()
                                    .absolute()
                                    .bottom_0()
                                    .left_0()
                                    .h(px(2.0))
                                    .w(gpui::relative(remaining as f32 / 6000.0))
                                    .bg(rgb(0xa1a1aa)),
                            )
                        }),
                );
                continue;
            }
            let i = slot - usize::from(removal.is_some_and(|(_, index, _)| slot > index));
            let scene = &self.settings.presets[i];
            let active = scene.id == self.active_scene_id;
            let focused = self.scene_focus[i].contains_focused(window, cx);
            let undo = self.scene_edits.change_remaining(&scene.id, now);
            let saved_flash = undo.is_some_and(|remaining| remaining > 8200);
            let scene_id = scene.id.clone();
            let current = geometry::window_size(self.settings.shape, self.size())
                .at(self.settings.position.unwrap_or(primary.origin()));
            let opening = scenes::apply_scene(&self.settings, scene, current, &areas, primary);
            let area = scenes::work_area_at(opening.position.unwrap_or(primary.origin()), &areas, primary);
            let camera = geometry::camera_rect_for(
                geometry::window_size(opening.shape, opening.size).at(opening.position.unwrap_or(area.origin())),
            );
            let screen_width = (row_width - 12.0).max(1.0);
            let screen_height = screen_width * 9.0 / 16.0;
            let tile = div()
                .relative()
                .w(px(screen_width))
                .h(px(screen_height))
                .rounded(px(5.0))
                .overflow_hidden()
                .bg(rgb(0x0f0f11))
                .child(
                    div()
                        .absolute()
                        .left(gpui::relative(0.08))
                        .top(gpui::relative(0.14))
                        .w(gpui::relative(0.46))
                        .h(gpui::relative(0.26))
                        .rounded(px(2.0))
                        .bg(rgb(0x1d1d1f)),
                )
                .child(
                    div()
                        .absolute()
                        .left(px((camera.x - area.x) as f32 / area.width.max(1) as f32 * screen_width))
                        .top(px((camera.y - area.y) as f32 / area.height.max(1) as f32 * screen_height))
                        .w(px(camera.width as f32 / area.width.max(1) as f32 * screen_width))
                        .h(px(camera.height as f32 / area.width.max(1) as f32 * screen_width))
                        .rounded(px(geometry::corner_radius(opening.shape, opening.size) as f32
                            / area.width.max(1) as f32
                            * screen_width))
                        .border(px(if opening.border_width >= 6 {
                            2.0
                        } else if opening.border_width > 0 {
                            1.0
                        } else {
                            0.0
                        }))
                        .border_color(rgb(0xffffff))
                        .bg(rgb(0x71717a))
                        .when(opening.frame_effect == camframe_core::settings::FrameEffect::Glow, |camera| {
                            camera.shadow(vec![
                                gpui::BoxShadow::new(
                                    px(0.0),
                                    px(0.0),
                                    rgb(hex_color(&opening.effect_color).unwrap_or(0xfb923c)).into(),
                                )
                                .blur_radius(px((opening.glow_spread as f32 / 2.0).round().max(3.0))),
                            ])
                        }),
                );
            let badge = div()
                .size(px(18.0))
                .flex_shrink_0()
                .rounded(px(5.0))
                .flex()
                .items_center()
                .justify_center()
                .text_size(px(10.0))
                .bg(rgb(if undo.is_some() {
                    0x86efac
                } else if active {
                    0xf4f4f5
                } else {
                    0x18181b
                }))
                .text_color(rgb(if active || saved_flash { 0x0c0c0d } else { 0xa1a1aa }))
                .child(if saved_flash { "✓".to_string() } else { (i + 1).to_string() });
            let mut row = div()
                .id(SharedString::from(format!("scene-row-{}", scene.id)))
                .relative()
                .w(px(row_width))
                .min_w_0()
                .overflow_hidden()
                .track_focus(&self.scene_focus[i])
                .tab_index(0)
                .role(gpui::Role::Button)
                .aria_label(scene.name.clone())
                .aria_selected(active)
                .border_1()
                .border_color(if active && grid { rgb(0xeeeeef).into() } else { transparent_black() })
                .rounded(px(if grid { 9.0 } else { 8.0 }))
                .bg(if active {
                    rgb(0x27272a).into()
                } else if grid {
                    rgb(0x18181b).into()
                } else {
                    transparent_black()
                })
                .focus(|s| s.border_color(rgb(0xfb923c)))
                .hover(|s| s.bg(rgb(0x1c1c1f)))
                .cursor_pointer()
                .on_click(cx.listener(move |this, _, window, cx| {
                    if this.scene_rename.as_deref() != this.settings.presets.get(i).map(|s| s.id.as_str()) {
                        this.apply_scene_at(i, window, cx);
                    }
                }))
                .capture_key_down(cx.listener(move |this, event: &gpui::KeyDownEvent, window, _cx| {
                    if matches!(event.keystroke.key.as_str(), "enter" | "space")
                        && this.scene_focus[i].is_focused(window)
                    {
                        window.prevent_default();
                    }
                }))
                .on_key_down(cx.listener(move |this, event: &gpui::KeyDownEvent, window, cx| {
                    if matches!(event.keystroke.key.as_str(), "enter" | "space")
                        && !this.scene_focus[i].is_focused(window)
                    {
                        return;
                    }
                    let Some(action) = scene_row_key(
                        event.keystroke.key.as_str(),
                        event.keystroke.modifiers,
                        this.scene_rename.as_deref() == this.settings.presets.get(i).map(|s| s.id.as_str()),
                        i,
                        this.settings.presets.len(),
                    ) else {
                        return;
                    };
                    cx.stop_propagation();
                    this.run_scene_action(action, window, cx);
                }))
                .on_mouse_down(
                    MouseButton::Left,
                    cx.listener(move |this, _, _, _| {
                        if this.scene_rename.as_deref() != Some(scene_id.as_str()) {
                            this.scene_drag = Some(scene_id.clone());
                        }
                    }),
                )
                .on_mouse_up(
                    MouseButton::Left,
                    cx.listener(move |this, _, _, cx| {
                        if let Some(id) = this.scene_drag.take()
                            && this.settings.presets.get(i).is_some_and(|scene| scene.id != id)
                        {
                            this.settings = scenes::reorder_scene(&this.settings, &id, i);
                            this.save_now();
                            this.update_tray_scenes();
                            cx.notify();
                        }
                    }),
                );
            if self.scene_rename.as_deref() == Some(scene.id.as_str()) {
                row = row
                    .flex()
                    .flex_col()
                    .gap(px(4.0))
                    .p(px(5.0))
                    .child(self.scene_input.clone())
                    .when(!self.scene_status.is_empty() && self.scene_status_action.is_none(), |row| {
                        row.child(div().text_color(rgb(0xf97316)).child(self.scene_status.clone()))
                    })
                    .child(
                        div()
                            .flex()
                            .gap(px(3.0))
                            .child(self.scene_icon(
                                format!("rename-ok-{}", scene.id),
                                "Save name".into(),
                                "icons/check.svg",
                                SceneAction::Save,
                                cx,
                            ))
                            .child(self.scene_icon(
                                format!("rename-cancel-{}", scene.id),
                                "Cancel rename".into(),
                                "icons/x.svg",
                                SceneAction::CancelEdit,
                                cx,
                            ))
                            .child(self.scene_icon(
                                format!("delete-{}", scene.id),
                                "Delete Scene".into(),
                                "icons/trash.svg",
                                SceneAction::Delete(i),
                                cx,
                            )),
                    );
            } else {
                let name = div()
                    .min_w_0()
                    .truncate()
                    .font_weight(gpui::FontWeight::SEMIBOLD)
                    .text_size(px(11.0))
                    .line_height(px(15.0))
                    .child(scene.name.clone());
                if grid {
                    row = row
                        .flex()
                        .flex_col()
                        .gap(px(5.0))
                        .p(px(5.0))
                        .child(tile)
                        .child(div().flex().items_center().gap(px(5.0)).child(badge).child(name))
                        .child(
                            self.scene_icon(
                                format!("rename-{}", scene.id),
                                "Rename Scene".into(),
                                "icons/pencil-simple.svg",
                                SceneAction::Rename(i),
                                cx,
                            )
                            .absolute()
                            .top(px(7.0))
                            .right(px(7.0))
                            .bg(rgb(0x0c0c0d))
                            .opacity(if focused { 1.0 } else { 0.0 })
                            .group_hover("scene", |s| s.opacity(1.0)),
                        );
                } else {
                    let shape = match opening.shape {
                        camframe_core::settings::Shape::Circle => "Circle",
                        camframe_core::settings::Shape::Rounded => "Rounded",
                        camframe_core::settings::Shape::Portrait => "Portrait",
                        camframe_core::settings::Shape::Landscape => "Landscape",
                    };
                    row = row
                        .flex()
                        .items_center()
                        .h(px(40.0))
                        .gap(px(8.0))
                        .pl(px(14.0))
                        .pr(px(4.0))
                        .child(badge)
                        .child(div().flex_1().min_w_0().child(name).child(
                            div().text_size(px(10.0)).line_height(px(13.0)).text_color(rgb(0x71717a)).truncate().child(
                                {
                                    let third = |start: i64, length: i64, total: i64| {
                                        let centre = (start as f64 + length as f64 / 2.0) / total.max(1) as f64;
                                        if centre < 1.0 / 3.0 {
                                            0
                                        } else if centre > 2.0 / 3.0 {
                                            2
                                        } else {
                                            1
                                        }
                                    };
                                    let across = third(camera.x - area.x, camera.width, area.width);
                                    let down = third(camera.y - area.y, camera.height, area.height);
                                    let place = match (down, across) {
                                        (0, 0) => "Top left",
                                        (0, 1) => "Top",
                                        (0, 2) => "Top right",
                                        (1, 0) => "Left",
                                        (1, 1) => "Center",
                                        (1, 2) => "Right",
                                        (2, 0) => "Bottom left",
                                        (2, 1) => "Bottom",
                                        _ => "Bottom right",
                                    };
                                    let effect = match opening.frame_effect {
                                        camframe_core::settings::FrameEffect::Glow => " · Glow",
                                        camframe_core::settings::FrameEffect::Blur => " · Blur",
                                        _ => "",
                                    };
                                    let border = if opening.border_width > 0 { " · Border" } else { "" };
                                    format!("{shape} · {} · {place}{effect}{border}", opening.size)
                                },
                            ),
                        ))
                        .child(
                            div()
                                .absolute()
                                .right(px(if undo.is_some() { 30.0 } else { 3.0 }))
                                .top(px(8.0))
                                .flex()
                                .gap(px(1.0))
                                .bg(rgb(0x1c1c1f))
                                .opacity(if focused { 1.0 } else { 0.0 })
                                .group_hover("scene", |s| s.opacity(1.0))
                                .child(self.scene_icon(
                                    format!("rename-{}", scene.id),
                                    "Rename Scene".into(),
                                    "icons/pencil-simple.svg",
                                    SceneAction::Rename(i),
                                    cx,
                                ))
                                .child(self.scene_icon(
                                    format!("delete-{}", scene.id),
                                    "Delete Scene".into(),
                                    "icons/trash.svg",
                                    SceneAction::Delete(i),
                                    cx,
                                )),
                        );
                }
            }
            if let Some(remaining) = undo {
                row = row
                    .child(
                        self.scene_icon(
                            format!("undo-{}", scene.id),
                            "Undo changes".into(),
                            "icons/arrow-counter-clockwise.svg",
                            SceneAction::Undo,
                            cx,
                        )
                        .absolute()
                        .bottom(px(4.0))
                        .right(px(4.0))
                        .bg(rgb(0x0c0c0d)),
                    )
                    .when(!cx.reduce_motion(), |row| {
                        row.child(
                            div()
                                .absolute()
                                .bottom_0()
                                .left_0()
                                .h(px(2.0))
                                .w(gpui::relative(remaining as f32 / 10000.0))
                                .bg(rgb(0xa1a1aa)),
                        )
                    });
            }
            list = list.child(row.group("scene"));
        }
        if self.scene_save_open {
            let replacing =
                self.settings.presets.iter().any(|s| scenes::same_name(&s.name, &self.scene_input.read(cx).text));
            list = list.child(
                div()
                    .w(px(available))
                    .flex()
                    .gap(px(6.0))
                    .p(px(6.0))
                    .rounded(px(8.0))
                    .bg(rgb(0x27272a))
                    .child(div().flex_1().min_w_0().child(self.scene_input.clone()))
                    .child(
                        self.control(
                            "save-scene".into(),
                            if replacing { "Replace" } else { "✓" }.into(),
                            false,
                            Control::Scene(SceneAction::Save),
                            cx,
                        )
                        .bg(rgb(0xf4f4f5))
                        .text_color(rgb(0x0c0c0d)),
                    ),
            );
            if !self.scene_status.is_empty() && self.scene_status_action.is_none() {
                list = list.child(div().text_color(rgb(0xf97316)).child(self.scene_status.clone()));
            }
        } else {
            let full = self.settings.presets.len() >= 6;
            let mut add = self
                .control("save-scene".into(), String::new(), false, Control::Scene(SceneAction::SaveOpen), cx)
                .w(px(if grid { row_width } else { available }))
                .h(px(if grid { (row_width - 12.0) * 9.0 / 16.0 + 35.0 } else { 40.0 }))
                .p(px(5.0))
                .gap(px(5.0))
                .bg(transparent_black())
                .border_1()
                .border_dashed()
                .border_color(rgb(0x343438))
                .when(full, |button| button.opacity(0.5).tab_index(-1).cursor(CursorStyle::Arrow));
            if grid {
                let live_bounds = self.presentation.compact.unwrap_or_else(|| self.guide_base_bounds(window));
                let area = scenes::work_area_at(live_bounds.origin(), &areas, primary);
                let camera = geometry::camera_rect_for(
                    geometry::window_size(self.settings.shape, self.size()).at(live_bounds.origin()),
                );
                let width = (row_width - 12.0).max(1.0);
                add = add.flex_col().items_start().child(
                    div()
                        .relative()
                        .w(px(width))
                        .h(px(width * 9.0 / 16.0))
                        .rounded(px(5.0))
                        .overflow_hidden()
                        .bg(rgb(0x0f0f11))
                        .child(
                            div()
                                .absolute()
                                .left(gpui::relative(0.08))
                                .top(gpui::relative(0.14))
                                .w(gpui::relative(0.46))
                                .h(gpui::relative(0.26))
                                .rounded(px(2.0))
                                .bg(rgb(0x1d1d1f)),
                        )
                        .child(
                            div()
                                .absolute()
                                .left(px((camera.x - area.x) as f32 / area.width.max(1) as f32 * width))
                                .top(px((camera.y - area.y) as f32 / area.height.max(1) as f32 * width * 9.0 / 16.0))
                                .w(px(camera.width as f32 / area.width.max(1) as f32 * width))
                                .h(px(camera.height as f32 / area.width.max(1) as f32 * width))
                                .rounded(px(geometry::corner_radius(self.settings.shape, self.size()) as f32
                                    / area.width.max(1) as f32
                                    * width))
                                .bg(rgb(0xa1a1aa)),
                        ),
                );
            }
            list = list.child(
                add.child(
                    div()
                        .flex()
                        .items_center()
                        .gap(px(5.0))
                        .child(
                            div()
                                .size(px(18.0))
                                .flex_shrink_0()
                                .border_1()
                                .border_dashed()
                                .border_color(rgb(0x52525b))
                                .rounded(px(5.0))
                                .flex()
                                .items_center()
                                .justify_center()
                                .text_size(px(10.0))
                                .child((self.settings.presets.len() + 1).to_string()),
                        )
                        .child(if full { "Full" } else { "Save look" }),
                ),
            );
        }
        let mut body = div()
            .flex()
            .flex_col()
            .gap(px(8.0))
            .child(
                div()
                    .flex()
                    .justify_between()
                    .items_center()
                    .child(div().font_weight(gpui::FontWeight::SEMIBOLD).text_size(px(12.0)).child("Scenes"))
                    .child(
                        div().flex().p(px(2.0)).gap(px(2.0)).rounded(px(7.0)).bg(rgb(0x181819)).children(
                            [
                                (SceneView::List, "List view", "icons/list.svg"),
                                (SceneView::Grid, "Grid view", "icons/squares-four.svg"),
                            ]
                            .into_iter()
                            .map(|(view, label, icon)| {
                                self.scene_icon(label.into(), label.into(), icon, SceneAction::View(view), cx)
                                    .w(px(26.0))
                                    .h(px(22.0))
                                    .aria_selected(self.settings.scene_view == view)
                                    .bg(if self.settings.scene_view == view {
                                        rgb(0x27272a).into()
                                    } else {
                                        transparent_black()
                                    })
                            }),
                        ),
                    ),
            )
            .child(list);
        let mut files = div().flex().gap(px(6.0)).border_t_1().border_color(rgb(0x252526)).pt(px(8.0));
        for (label, icon, action) in [
            ("Import", "icons/download-simple.svg", SceneAction::Import),
            ("Export", "icons/upload-simple.svg", SceneAction::Export),
        ] {
            let status = self.scene_status_action == Some(label) && now < self.scene_status_until;
            files = files.child(
                self.control(
                    label.into(),
                    if status {
                        if self.scene_status_ok {
                            self.scene_status.clone()
                        } else {
                            format!("Not {}", label.to_lowercase() + "ed")
                        }
                    } else {
                        label.into()
                    },
                    false,
                    Control::Scene(action),
                    cx,
                )
                .aria_description(if status { self.scene_status.clone() } else { String::new() })
                .h(px(26.0))
                .text_color(rgb(if status { if self.scene_status_ok { 0x86efac } else { 0xf97316 } } else { 0xd4d4d8 }))
                .flex_1()
                .justify_center()
                .gap(px(5.0))
                .text_size(px(10.0))
                .child(
                    svg()
                        .path(if status {
                            if self.scene_status_ok { "icons/check.svg" } else { "icons/warning.svg" }
                        } else {
                            icon
                        })
                        .size(px(13.0))
                        .text_color(rgb(0xa1a1aa)),
                ),
            );
        }
        body = body.child(files);
        body
    }
}

#[cfg(test)]
mod parity_tests {
    use super::*;
    #[test]
    fn typing_a_scene_name_never_runs_row_commands() {
        for key in ["space", "backspace", "delete", "up", "down", "f2", "z"] {
            let modifiers = gpui::Modifiers { control: true, ..Default::default() };
            assert_eq!(scene_row_key(key, modifiers, true, 1, 3), None, "{key}");
        }
        assert_eq!(scene_row_key("space", gpui::Modifiers::default(), false, 1, 3), Some(SceneAction::Apply(1)));
        assert_eq!(scene_row_key("up", gpui::Modifiers::default(), false, 0, 3), Some(SceneAction::Focus(0)));
        assert_eq!(scene_row_key("down", gpui::Modifiers::default(), false, 2, 3), Some(SceneAction::Focus(2)));
    }
}
