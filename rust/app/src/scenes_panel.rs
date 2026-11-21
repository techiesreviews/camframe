//! Scenes UI, dialogs and the window adapter around the portable Scene library.
use super::*;
use camframe_core::{scenes, settings::SceneView};
use settings_panel::Control;

#[derive(Clone)]
pub(super) enum SceneAction {
    Apply(usize),
    Save,
    Rename(usize),
    Delete(usize),
    Move(usize, i32),
    Undo,
    UndoDelete,
    Import,
    Export,
    View,
}

impl BubbleOverlay {
    pub(super) fn apply_scene_at(&mut self, index: usize, window: &mut Window, cx: &mut Context<Self>) {
        self.finish_guide(window, cx);
        let Some(scene) = self.settings.presets.get(index).cloned() else { return };
        let compact = self.presentation.compact.unwrap_or_else(|| rect_of(window.bounds()));
        self.set_fullscreen(false, window, cx);
        let (areas, primary) = work_areas(cx);
        self.settings = scenes::apply_scene(&self.settings, &scene, compact, &areas, primary);
        self.active_scene_id = scene.id;
        self.announcement = scene.name;
        self.scene_edits.clear_change();
        let mut bounds = geometry::window_size(self.settings.shape, self.size())
            .at(self.settings.position.unwrap_or(compact.origin()));
        if self.settings_tab.is_some() {
            bounds.height = bounds.height.max(390);
        }
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
                self.scene_status = "Saved".into();
                self.scene_rename = None;
                if !renaming {
                    self.scene_edits.clear_change();
                    self.scene_edits.clear_delete();
                }
                self.save_now();
                self.update_tray_scenes();
            }
            Err(error) => self.scene_status = error,
        }
        cx.notify();
    }

    pub(super) fn run_scene_action(&mut self, action: SceneAction, window: &mut Window, cx: &mut Context<Self>) {
        match action {
            SceneAction::Apply(i) => self.apply_scene_at(i, window, cx),
            SceneAction::Save => {
                let name = self.scene_input.read(cx).text.clone();
                self.save_scene_name(&name, window, cx);
            }
            SceneAction::Rename(i) => {
                if let Some(scene) = self.settings.presets.get(i) {
                    self.scene_rename = Some(scene.id.clone());
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
                        self.save_now();
                        self.update_tray_scenes();
                    }
                }
            }
            SceneAction::Move(i, offset) => {
                if let Some(scene) = self.settings.presets.get(i) {
                    self.settings =
                        scenes::reorder_scene(&self.settings, &scene.id, (i as i32 + offset).max(0) as usize);
                    self.save_now();
                    self.update_tray_scenes();
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
                    self.settings = settings;
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
            SceneAction::View => {
                self.settings.scene_view =
                    if self.settings.scene_view == SceneView::Grid { SceneView::List } else { SceneView::Grid };
                self.save_now();
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
                        this.scene_status = format!("Imported {} Scenes", imported.imported_count);
                        this.scene_edits.clear_delete();
                        this.save_now();
                        this.update_tray_scenes();
                    }
                    Err(error) => this.scene_status = error,
                }
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
        cx.spawn_in(window, async move |entity, cx| {
            let Ok(Ok(Some(path))) = choose.await else { return };
            let result = std::fs::write(path, text);
            let _ = entity.update_in(cx, |this, _, cx| {
                this.scene_status = match result {
                    Ok(()) => "Exported".into(),
                    Err(error) => format!("Export failed: {error}"),
                };
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

    pub(super) fn render_scenes(&self, cx: &mut Context<Self>) -> gpui::Div {
        let mut list = div().flex().flex_wrap().gap(px(6.0));
        let (areas, primary) = work_areas(cx);
        for (i, scene) in self.settings.presets.iter().enumerate() {
            let available = dimensions_for(self.settings.shape, self.size()).0 as f32 - 26.0;
            let row_width =
                if self.settings.scene_view == SceneView::Grid { (available - 6.0) / 2.0 } else { available };
            let active = scene.id == self.active_scene_id;
            let scene_id = scene.id.clone();
            let current = geometry::window_size(self.settings.shape, self.size())
                .at(self.settings.position.unwrap_or(primary.origin()));
            let opening = scenes::apply_scene(&self.settings, scene, current, &areas, primary);
            let area = scenes::work_area_at(opening.position.unwrap_or(primary.origin()), &areas, primary);
            let camera = geometry::camera_rect_for(
                geometry::window_size(opening.shape, opening.size).at(opening.position.unwrap_or(area.origin())),
            );
            let scale = (row_width - 10.0) / area.width.max(1) as f32;
            let tile = div()
                .relative()
                .w(px(row_width - 10.0))
                .h(px(area.height as f32 * scale))
                .rounded(px(4.0))
                .bg(rgb(0x252528))
                .child(
                    div()
                        .absolute()
                        .left(px((camera.x - area.x) as f32 * scale))
                        .top(px((camera.y - area.y) as f32 * scale))
                        .w(px(camera.width as f32 * scale))
                        .h(px(camera.height as f32 * scale))
                        .rounded(px(geometry::corner_radius(opening.shape, opening.size) as f32 * scale))
                        .bg(rgb(0x8b8b90)),
                );
            let mut row = div()
                .id(SharedString::from(format!("scene-row-{}", scene.id)))
                .w(px(row_width))
                .min_w_0()
                .overflow_hidden()
                .track_focus(&self.scene_focus[i])
                .tab_index(0)
                .role(gpui::Role::ListItem)
                .aria_label(scene.name.clone())
                .focus(|style| style.border_color(rgb(0xffffff)))
                .flex()
                .flex_col()
                .gap(px(4.0))
                .p(px(4.0))
                .border_1()
                .border_color(rgb(if active { 0xffffff } else { 0x343438 }))
                .rounded(px(6.0))
                .on_key_down(cx.listener(move |this, event: &gpui::KeyDownEvent, window, cx| {
                    let key = event.keystroke.key.as_str();
                    let action = match key {
                        "f2" => SceneAction::Rename(i),
                        "delete" | "backspace" => SceneAction::Delete(i),
                        "enter" | "space" => SceneAction::Apply(i),
                        "up" | "left" | "down" | "right" => {
                            let delta = if matches!(key, "up" | "left") { -1 } else { 1 };
                            if event.keystroke.modifiers.alt {
                                SceneAction::Move(i, delta)
                            } else {
                                let next = (i as i32 + delta)
                                    .clamp(0, this.settings.presets.len().saturating_sub(1) as i32)
                                    as usize;
                                this.scene_focus[next].focus(window, cx);
                                cx.stop_propagation();
                                return;
                            }
                        }
                        "z" if event.keystroke.modifiers.control || event.keystroke.modifiers.platform => {
                            SceneAction::Undo
                        }
                        _ => return,
                    };
                    cx.stop_propagation();
                    this.run_scene_action(action, window, cx);
                }))
                .on_mouse_down(
                    MouseButton::Left,
                    cx.listener(move |this, _, _, _| {
                        this.scene_drag = Some(scene_id.clone());
                    }),
                )
                .on_mouse_up(
                    MouseButton::Left,
                    cx.listener(move |this, _, _, cx| {
                        if let Some(id) = this.scene_drag.take() {
                            this.settings = scenes::reorder_scene(&this.settings, &id, i);
                            this.save_now();
                            this.update_tray_scenes();
                            cx.notify();
                        }
                    }),
                );
            if self.settings.scene_view == SceneView::Grid {
                row = row.child(tile);
            }
            row = row
                .child(self.control(
                    format!("scene-{}", scene.id),
                    format!("{}{}", scene.name, if active { " ✓" } else { "" }),
                    active,
                    Control::Scene(SceneAction::Apply(i)),
                    cx,
                ))
                .child(
                    div().flex().flex_wrap().gap(px(4.0)).children(
                        [
                            ("Rename", SceneAction::Rename(i)),
                            ("Delete", SceneAction::Delete(i)),
                            ("↑", SceneAction::Move(i, -1)),
                            ("↓", SceneAction::Move(i, 1)),
                        ]
                        .into_iter()
                        .map(|(label, action)| {
                            self.control(
                                format!("{}-{label}", scene.id),
                                label.into(),
                                false,
                                Control::Scene(action),
                                cx,
                            )
                        }),
                    ),
                );
            list = list.child(row);
        }
        let replacing =
            self.settings.presets.iter().any(|s| scenes::same_name(&s.name, &self.scene_input.read(cx).text));
        let mut body = div()
            .flex()
            .flex_col()
            .gap(px(8.0))
            .child(list)
            .child(self.scene_input.clone())
            .child(
                self.control(
                    "save-scene".into(),
                    if self.scene_rename.is_some() {
                        "Rename"
                    } else if replacing {
                        "Replace"
                    } else if self.settings.presets.len() >= 6 {
                        "Full"
                    } else {
                        "Save look"
                    }
                    .into(),
                    false,
                    Control::Scene(SceneAction::Save),
                    cx,
                ),
            )
            .child(
                div().flex().flex_wrap().gap(px(4.0)).children(
                    [
                        ("Import", SceneAction::Import),
                        ("Export", SceneAction::Export),
                        ("List / grid", SceneAction::View),
                    ]
                    .into_iter()
                    .map(|(name, action)| self.control(name.into(), name.into(), false, Control::Scene(action), cx)),
                ),
            );
        if self.scene_edits.can_undo_change(&self.active_scene_id, self.now_ms()) {
            body = body.child(self.control(
                "undo-scene".into(),
                "Undo change".into(),
                false,
                Control::Scene(SceneAction::Undo),
                cx,
            ));
        }
        if self.scene_edits.can_undo_delete(self.now_ms()) {
            body = body.child(self.control(
                "undo-delete".into(),
                "Undo delete".into(),
                false,
                Control::Scene(SceneAction::UndoDelete),
                cx,
            ));
        }
        if !self.scene_status.is_empty() {
            body = body.child(self.scene_status.clone());
        }
        body
    }
}
