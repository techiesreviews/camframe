//! GPUI adapter for checked Prompter link requests. Uses the same Scene and geometry rules as UI.
use super::*;
use camframe_core::{
    prompter, scenes,
    settings::{LayoutSize, Scene, SceneLayout, Spot},
};
use serde_json::{Value, json};

fn rect(rect: Rect) -> Value {
    json!({"x":rect.x,"y":rect.y,"width":rect.width,"height":rect.height})
}
fn error(status: u16, code: &str, message: &str) -> (u16, Value) {
    (status, json!({"ok":false,"code":code,"error":message}))
}
fn pixels(value: &Value) -> u32 {
    value.as_f64().unwrap_or(288.0) as u32
}

impl BubbleOverlay {
    pub(super) fn toggle_link(&mut self, cx: &mut Context<Self>) {
        self.link_generation = self.link_generation.wrapping_add(1);
        self.link.take();
        self.link_message.clear();
        self.settings.prompter_link = !self.settings.prompter_link;
        if self.settings.prompter_link {
            match crate::prompter::Link::start(self.link_commands.clone(), self.link_generation) {
                Ok(link) => self.link = Some(link),
                Err(message) => self.link_message = message,
            }
        }
        self.save_now();
        cx.notify();
    }
    fn link_view(&self, window: &Window, cx: &App) -> Value {
        let target = self.presentation.transition.map_or_else(|| self.guide_base_bounds(window), |(_, to, _)| to);
        let (areas, primary) = work_areas(cx);
        let area = scenes::work_area_at(target.origin(), &areas, primary);
        json!({"mode":if self.presentation.fullscreen{"fullscreen"}else{"compact"},"visible":self.settings.overlay_visible,"settled":self.presentation.transition.is_none(),"size":self.size(),"shape":self.settings.shape,
            "camera":rect(if self.presentation.fullscreen{target}else{geometry::camera_rect_for(target)}),"window":rect(target),"workArea":rect(area)})
    }
    pub(super) fn run_link_command(
        &mut self,
        kind: &str,
        body: &Value,
        window: &mut Window,
        cx: &mut Context<Self>,
    ) -> (u16, Value) {
        match kind {
            "status" => (
                200,
                json!({"app":"camframe","version":env!("CARGO_PKG_VERSION"),"api":2,"sceneLimit":6,"scenes":self.settings.presets.iter().map(|s|s.name.clone()).collect::<Vec<_>>(),
                "smallSize":self.settings.prompter_small_size,"margin":self.settings.prompter_margin,"activeScene":self.settings.presets.iter().find(|s|s.id==self.active_scene_id).map(|s|s.name.clone()),
                "view":self.link_view(window,cx),"look":prompter::look(&self.settings),"sceneDetails":self.settings.presets.iter().map(|s|prompter::scene_detail(s,&self.settings)).collect::<Vec<_>>()}),
            ),
            "small-size" => {
                self.settings.prompter_small_size =
                    if body["size"] == "current" { self.size() } else { pixels(&body["size"]) };
                self.save_now();
                (200, json!({"ok":true,"smallSize":self.settings.prompter_small_size}))
            }
            "cue" => self.apply_link_cue(body, window, cx),
            "scenes" => self.save_link_scene(body, window, cx),
            _ => error(404, "not-found", "Not found."),
        }
    }
    fn compact_reference(&self, window: &Window) -> Rect {
        self.presentation
            .compact
            .or(self.presentation.transition.map(|(_, to, _)| to))
            .unwrap_or_else(|| self.guide_base_bounds(window))
    }
    fn link_plan(&self, body: &Value, window: &Window, cx: &App) -> Result<(geometry::LayoutPlan, Rect), String> {
        let current = self.compact_reference(window);
        let (areas, primary) = work_areas(cx);
        let point = body["position"]
            .as_object()
            .map(|p| Point { x: p["x"].as_f64().unwrap_or(0.0) as i64, y: p["y"].as_f64().unwrap_or(0.0) as i64 });
        let spot = body["position"].as_str().and_then(Spot::parse);
        let size = match body["size"].as_str() {
            Some("small") => self.settings.prompter_small_size,
            Some("current") => self.settings.size,
            _ => pixels(&body["size"]),
        };
        let area = scenes::work_area_at(point.unwrap_or(current.origin()), &areas, primary);
        let request = geometry::LayoutRequest {
            shape: self.settings.shape,
            size,
            spot,
            point,
            margin: body.get("margin").map_or(if spot.is_some() { self.settings.prompter_margin } else { 0 }, pixels),
            within_right: body["withinRight"].as_f64(),
        };
        geometry::plan_compact_layout(request, area, Some(current)).map(|plan| (plan, area)).map_err(|error| error.0)
    }
    fn apply_link_cue(&mut self, body: &Value, window: &mut Window, cx: &mut Context<Self>) -> (u16, Value) {
        let mut cue = body.clone();
        let mut scene = body["scene"].as_str().map(str::to_string);
        let bare = body.get("position").is_none() && body["size"] == "small";
        if scene.is_none() && (body["size"] == "full" || bare) {
            let choice = if body["size"] == "full" {
                &self.settings.prompter_face_full
            } else {
                &self.settings.prompter_face_small
            };
            if let Some(id) = choice.strip_prefix("scene:") {
                scene = self.settings.presets.iter().find(|s| s.id == id).map(|s| s.name.clone());
            } else if bare && Spot::parse(choice).is_some() {
                cue["position"] = json!(choice);
            }
        }
        if let Some(name) = scene {
            let Some(index) = self.settings.presets.iter().position(|s| scenes::same_name(s.name.trim(), &name)) else {
                return error(404, "unknown-scene", &format!("CamFrame has no Scene named \"{name}\"."));
            };
            self.apply_scene_at(index, window, cx);
            return (
                200,
                json!({"ok":true,"cue":body,"layout":{"size":self.size(),"requestedSize":self.size(),"clamped":false},"view":self.link_view(window,cx)}),
            );
        }
        if body["size"] == "full" {
            self.set_fullscreen(true, window, cx);
            return (200, json!({"ok":true,"cue":body,"view":self.link_view(window,cx)}));
        }
        let same_bare =
            bare && cue.get("position").is_none() && self.settings.size == self.settings.prompter_small_size;
        if same_bare && !self.presentation.fullscreen {
            return (
                200,
                json!({"ok":true,"cue":body,"layout":{"size":self.size(),"requestedSize":self.size(),"clamped":false},"view":self.link_view(window,cx)}),
            );
        }
        let (plan, _) = match self.link_plan(&cue, window, cx) {
            Ok(plan) => plan,
            Err(message) => return error(422, "does-not-fit", &message),
        };
        self.finish_guide(window, cx);
        let current = self.compact_reference(window);
        let keep = bare && plan.size == self.size() && plan.position == current.origin();
        self.presentation.fullscreen = false;
        self.presentation.compact = None;
        self.settings.size = plan.size;
        self.settings.position = Some(plan.position);
        if !keep {
            self.active_scene_id.clear();
            self.scene_edits.clear_change();
        }
        self.set_overlay_visible(true, window, cx);
        self.move_to(geometry::window_size(self.settings.shape, self.size()).at(plan.position), window, cx);
        self.sync_capture_view(window);
        self.save_now();
        self.update_tray_scenes();
        (
            200,
            json!({"ok":true,"cue":body,"layout":{"size":plan.size,"requestedSize":plan.requested_size,"clamped":plan.clamped},"view":self.link_view(window,cx)}),
        )
    }
    fn save_link_scene(&mut self, body: &Value, window: &mut Window, cx: &mut Context<Self>) -> (u16, Value) {
        let name = body["name"].as_str().unwrap_or("");
        let existing = self.settings.presets.iter().position(|s| scenes::same_name(&s.name, name));
        if existing.is_some() && body["replace"] != true {
            return error(
                409,
                "scene-exists",
                "A Scene with that name already exists. Send replace: true to save over it.",
            );
        }
        if existing.is_none() && self.settings.presets.len() >= 6 {
            return error(
                409,
                "scene-limit",
                "CamFrame keeps at most 6 Scenes. Delete one or replace an existing name.",
            );
        }
        let (plan, area) = match self.link_plan(body, window, cx) {
            Ok(plan) => plan,
            Err(message) => return error(422, "does-not-fit", &message),
        };
        let saved = self.settings.with_patch(&json!({"size":plan.size,"position":plan.position}));
        let requested_size = if body["size"] == "small" {
            LayoutSize::Small
        } else {
            LayoutSize::Pixels(if body["size"] == "current" { self.size() } else { pixels(&body["size"]) })
        };
        let layout = SceneLayout {
            size: requested_size,
            position: body["position"].as_str().and_then(Spot::parse),
            margin: body.get("margin").map(pixels),
            within_right: body["withinRight"].as_f64(),
        };
        let id = existing.map_or_else(
            || format!("preset-{}-{}", std::process::id(), self.clock.elapsed().as_nanos()),
            |i| self.settings.presets[i].id.clone(),
        );
        let scene = Scene { id: id.clone(), name: name.into(), settings: saved.scene_settings(), layout: Some(layout) };
        let index = existing.unwrap_or(self.settings.presets.len());
        if existing.is_some() {
            self.settings.presets[index] = scene.clone();
        } else {
            self.settings.presets.push(scene.clone());
        }
        if self.active_scene_id == id {
            self.active_scene_id.clear();
            self.scene_edits.clear_change();
        }
        self.scene_edits.clear_delete();
        self.save_now();
        self.update_tray_scenes();
        cx.notify();
        let mut answer = json!({"ok":true,"scene":prompter::scene_detail(&scene,&self.settings),"replaced":existing.is_some(),"saved":{"size":plan.size,"requestedSize":plan.requested_size,"clamped":plan.clamped,
            "camera":rect(geometry::camera_rect_for(geometry::window_size(self.settings.shape,plan.size).at(plan.position))),"workArea":rect(area)}});
        if body["apply"] == true {
            self.apply_scene_at(index, window, cx);
            answer["layout"] = json!({"size":plan.size,"requestedSize":plan.requested_size,"clamped":plan.clamped});
            answer["view"] = self.link_view(window, cx);
        }
        (200, answer)
    }
}
