//! The Scene library: naming, ids, the Scene limit, ordering, import and export, and which Scene is
//! active. Mirrors `src/scenes.js` of CamFrame 0.9.0. Each operation takes the current library and
//! returns the next one when something changed.

use serde_json::{Value, json};
use unicode_normalization::UnicodeNormalization;

use crate::settings::{SCENE_LIMIT, Scene, Settings, sanitize_settings};

pub const SCENE_EXPORT_FORMAT: &str = "camframe-scenes";
pub const SCENE_EXPORT_VERSION: u32 = 1;
pub const SCENE_IMPORT_ERROR: &str = "That file is not a valid CamFrame scene export.";
pub const NO_VALID_SCENES: &str = "No valid scenes found.";

/// The Preferences plus the id of the Scene on camera ('' for none).
#[derive(Debug, Clone, PartialEq)]
pub struct SceneLibrary {
    pub settings: Settings,
    pub active_scene_id: String,
}

pub struct ImportResult {
    pub library: SceneLibrary,
    pub imported_count: usize,
}

/// Joiners, variation selectors and emoji tags: invisible, so two names with and without them look
/// the same.
fn invisible_when_matching(character: char) -> bool {
    matches!(character, '\u{200c}' | '\u{200d}' | '\u{fe00}'..='\u{fe0f}' | '\u{e0020}'..='\u{e007f}' | '\u{e0100}'..='\u{e01ef}')
}

fn name_key(name: &str) -> String {
    name.nfc().filter(|character| !invisible_when_matching(*character)).collect::<String>().to_lowercase()
}

/// Scene names match without regard to case, composed versus decomposed accents, or invisible marks.
pub fn same_name(left: &str, right: &str) -> bool {
    name_key(left) == name_key(right)
}

fn with_scenes(settings: &Settings, scenes: &[Scene]) -> Settings {
    settings.with_patch(&json!({ "presets": scenes }))
}

fn merge_scenes(existing: &[Scene], imported: &[Scene]) -> Vec<Scene> {
    let mut next = existing.to_vec();
    for scene in imported {
        if let Some(index) =
            next.iter().position(|candidate| candidate.id == scene.id || same_name(&candidate.name, &scene.name))
        {
            next[index] = Scene { id: next[index].id.clone(), ..scene.clone() };
        } else if next.len() < SCENE_LIMIT {
            next.push(scene.clone());
        }
    }
    sanitize_settings(&json!({ "presets": next })).presets
}

/// `importScenes`: accepts an export object (`scenes`, or the older `presets`) or a bare array. The
/// format and version fields are not checked (known gap KG-09).
pub fn import_scenes(library: &SceneLibrary, text: &str) -> Result<ImportResult, String> {
    let payload: Value = serde_json::from_str(text).map_err(|_| SCENE_IMPORT_ERROR.to_string())?;
    let source = match &payload {
        Value::Array(_) => payload.clone(),
        Value::Object(map) => match map.get("scenes") {
            Some(scenes) if !scenes.is_null() => scenes.clone(),
            _ => map.get("presets").cloned().unwrap_or(Value::Null),
        },
        // `null.scenes` throws in JavaScript; a number or string has no Scenes.
        Value::Null => return Err(SCENE_IMPORT_ERROR.into()),
        _ => Value::Null,
    };
    let imported = sanitize_settings(&json!({ "presets": source })).presets;
    if imported.is_empty() {
        return Err(NO_VALID_SCENES.into());
    }
    let scenes = merge_scenes(&library.settings.presets, &imported);
    Ok(ImportResult {
        library: SceneLibrary {
            settings: with_scenes(&library.settings, &scenes),
            active_scene_id: library.active_scene_id.clone(),
        },
        imported_count: imported.len(),
    })
}

/// `sceneExport`: the file Export writes.
pub fn scene_export(settings: &Settings) -> Value {
    json!({ "format": SCENE_EXPORT_FORMAT, "version": SCENE_EXPORT_VERSION, "scenes": settings.presets })
}

pub fn save_look(settings: &Settings, name: &str, id: &str) -> Result<(Settings, String), String> {
    let name = crate::js::slice_utf16(crate::js::trim(name), 40);
    if name.is_empty() {
        return Err("A Scene needs a name.".into());
    }
    let existing = settings.presets.iter().find(|scene| same_name(&scene.name, &name));
    if existing.is_none() && settings.presets.len() >= SCENE_LIMIT {
        return Err("Full: delete a Scene to save a new one.".into());
    }
    let id = existing.map_or_else(|| id.to_string(), |scene| scene.id.clone());
    let scene = Scene { id: id.clone(), name, settings: settings.scene_settings(), layout: None };
    let mut scenes = settings.presets.clone();
    if let Some(index) = scenes.iter().position(|s| s.id == id) {
        scenes[index] = scene;
    } else {
        scenes.push(scene);
    }
    Ok((with_scenes(settings, &scenes), id))
}

pub fn rename_scene(settings: &Settings, id: &str, name: &str) -> Result<Settings, String> {
    let name = crate::js::slice_utf16(crate::js::trim(name), 40);
    if name.is_empty() {
        return Err("A Scene needs a name.".into());
    }
    if settings.presets.iter().any(|s| s.id != id && same_name(&s.name, &name)) {
        return Err("That name is already used.".into());
    }
    let mut scenes = settings.presets.clone();
    if let Some(scene) = scenes.iter_mut().find(|s| s.id == id) {
        scene.name = name;
    }
    Ok(with_scenes(settings, &scenes))
}

pub fn reorder_scene(settings: &Settings, id: &str, target: usize) -> Settings {
    let mut scenes = settings.presets.clone();
    if let Some(index) = scenes.iter().position(|scene| scene.id == id) {
        let moved = scenes.remove(index);
        scenes.insert(target.min(scenes.len()), moved);
    }
    with_scenes(settings, &scenes)
}

/// The nearest usable display, including when the display at a saved point was unplugged.
pub fn work_area_at(
    point: crate::settings::Point,
    areas: &[crate::geometry::Rect],
    primary: crate::geometry::Rect,
) -> crate::geometry::Rect {
    areas
        .iter()
        .min_by_key(|area| {
            let dx = (area.x - point.x).max(0).max(point.x - area.x - area.width);
            let dy = (area.y - point.y).max(0).max(point.y - area.y - area.height);
            i128::from(dx) * i128::from(dx) + i128::from(dy) * i128::from(dy)
        })
        .copied()
        .unwrap_or(primary)
}

/// Applying a Scene and drawing its miniature use this same opening.
pub fn apply_scene(
    settings: &Settings,
    scene: &Scene,
    current: crate::geometry::Rect,
    areas: &[crate::geometry::Rect],
    primary: crate::geometry::Rect,
) -> Settings {
    use crate::geometry::{self, LayoutRequest};
    use crate::settings::{LayoutSize, OVERLAY_CHROME, Point};
    if let Some(layout) = scene.layout {
        let point = if layout.position.is_none() {
            scene
                .settings
                .position
                .map(|p| Point { x: p.x + i64::from(OVERLAY_CHROME.left), y: p.y + i64::from(OVERLAY_CHROME.top) })
        } else {
            None
        };
        let area = work_area_at(point.unwrap_or(current.origin()), areas, primary);
        let size = match layout.size {
            LayoutSize::Small => settings.prompter_small_size,
            LayoutSize::Pixels(size) => size,
        };
        let request = LayoutRequest {
            shape: settings.shape,
            size,
            spot: layout.position,
            point,
            margin: layout.margin.unwrap_or(if layout.position.is_some() { settings.prompter_margin } else { 0 }),
            within_right: layout.within_right,
        };
        if (request.spot.is_some() || point.is_some())
            && let Ok(plan) = geometry::plan_compact_layout(request, area, None)
        {
            return settings.with_patch(&json!({"size":plan.size,"position":plan.position}));
        }
        let position = scene
            .settings
            .position
            .map(|p| geometry::keep_on_work_area(p, geometry::window_size(settings.shape, scene.settings.size), area));
        settings.with_patch(&json!({"size":scene.settings.size,"position":position}))
    } else {
        let mut next = settings.with_patch(&serde_json::to_value(&scene.settings).expect("Scene settings serialize"));
        if let Some(saved) = scene.settings.position {
            let bounds = geometry::window_size(next.shape, next.size).at(saved);
            if !geometry::is_on_screen(bounds, areas) {
                let area = work_area_at(saved, areas, primary);
                next.position = Some(geometry::keep_on_work_area(saved, bounds, area));
            }
        } else {
            next.position = Some(current.origin());
        }
        next
    }
}

struct Change {
    scene: Scene,
    look: crate::settings::SceneSettings,
    until: u64,
}
struct Removal {
    scene: Scene,
    index: usize,
    active: bool,
    until: u64,
}
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum UndoKind {
    Delete,
    Change,
}

#[derive(Default)]
pub struct SceneEdits {
    change: Option<Change>,
    removal: Option<Removal>,
}

impl SceneEdits {
    pub fn clear_change(&mut self) {
        self.change = None;
    }
    pub fn clear_delete(&mut self) {
        self.removal = None;
    }
    pub fn undo_target(&self, active_id: &str, now: u64) -> Option<UndoKind> {
        if self.can_undo_delete(now) {
            Some(UndoKind::Delete)
        } else if self.can_undo_change(active_id, now) {
            Some(UndoKind::Change)
        } else {
            None
        }
    }
    pub fn removal_preview(&self, now: u64) -> Option<(&Scene, usize, u64)> {
        self.removal.as_ref().filter(|r| now < r.until).map(|r| (&r.scene, r.index, r.until - now))
    }
    pub fn change_remaining(&self, id: &str, now: u64) -> Option<u64> {
        self.change.as_ref().filter(|c| c.scene.id == id && now < c.until).map(|c| c.until - now)
    }
    pub fn can_undo_change(&self, id: &str, now: u64) -> bool {
        self.change.as_ref().is_some_and(|c| c.scene.id == id && now < c.until)
    }
    pub fn can_undo_delete(&self, now: u64) -> bool {
        self.removal.as_ref().is_some_and(|r| now < r.until)
    }
    pub fn follow(&mut self, before: &Settings, next: Settings, id: &str, patch: &Value, now: u64) -> Settings {
        let Some(scene) = before.presets.iter().find(|s| s.id == id) else { return next };
        let keys = patch.as_object().map(|m| m.keys().map(String::as_str).collect::<Vec<_>>()).unwrap_or_default();
        let reference =
            if scene.layout.is_some() { before.scene_settings().to_json() } else { scene.settings.to_json() };
        let live = next.scene_settings().to_json();
        let changed: serde_json::Map<String, Value> = live
            .into_iter()
            .filter(|(key, value)| {
                !["cameraId", "cameraLabel", "overlayResolution"].contains(&key.as_str())
                    && keys.contains(&key.as_str())
                    && reference.get(key) != Some(value)
            })
            .collect();
        if changed.is_empty() {
            return next;
        }
        if let Some(change) = &mut self.change
            && change.scene.id == id
        {
            change.until = now + 10000;
        } else {
            self.change = Some(Change { scene: scene.clone(), look: before.scene_settings(), until: now + 10000 });
        }
        let settings = if scene.layout.is_some() {
            next.scene_settings()
        } else {
            let mut saved = scene.settings.to_json();
            saved.extend(changed);
            crate::settings::scene_settings_from(&Value::Object(saved))
        };
        let mut scenes = next.presets.clone();
        if let Some(target) = scenes.iter_mut().find(|s| s.id == id) {
            target.settings = settings;
            target.layout = None;
        }
        with_scenes(&next, &scenes)
    }
    pub fn undo_change(&mut self, settings: &Settings, id: &str, now: u64) -> Option<Settings> {
        if !self.can_undo_change(id, now) {
            return None;
        }
        let change = self.change.take()?;
        let current = settings.presets.iter().find(|s| s.id == id)?;
        let mut scene = change.scene;
        scene.name = current.name.clone();
        let mut next = settings.clone();
        if scene.layout.is_some() {
            let mut look = change.look.to_json();
            for key in ["cameraId", "cameraLabel", "overlayResolution", "size", "position"] {
                look.remove(key);
            }
            next = next.with_patch(&Value::Object(look));
        }
        let scenes =
            next.presets.iter().map(|s| if s.id == id { scene.clone() } else { s.clone() }).collect::<Vec<_>>();
        Some(with_scenes(&next, &scenes))
    }
    pub fn delete(&mut self, settings: &Settings, id: &str, active: bool, now: u64) -> Option<Settings> {
        let index = settings.presets.iter().position(|s| s.id == id)?;
        self.removal = Some(Removal { scene: settings.presets[index].clone(), index, active, until: now + 6000 });
        let scenes = settings.presets.iter().filter(|s| s.id != id).cloned().collect::<Vec<_>>();
        Some(with_scenes(settings, &scenes))
    }
    pub fn restore_delete(&mut self, settings: &Settings, now: u64) -> Option<(Settings, Option<String>)> {
        if !self.can_undo_delete(now) {
            self.removal = None;
            return None;
        }
        let removed = self.removal.take()?;
        if settings.presets.len() >= SCENE_LIMIT
            || settings.presets.iter().any(|s| s.id == removed.scene.id || same_name(&s.name, &removed.scene.name))
        {
            return None;
        }
        let mut scenes = settings.presets.clone();
        let id = removed.scene.id.clone();
        scenes.insert(removed.index.min(scenes.len()), removed.scene);
        Some((with_scenes(settings, &scenes), removed.active.then_some(id)))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn keyboard_undo_restores_a_delete_before_an_active_scene_change() {
        let (settings, id) = save_look(&Settings::default(), "Desk", "desk").unwrap();
        let (settings, other) = save_look(&settings, "Other", "other").unwrap();
        let mut edits = SceneEdits::default();
        let next = settings.with_patch(&json!({"shape":"portrait"}));
        let changed = edits.follow(&settings, next, &id, &json!({"shape":"portrait"}), 10);
        let _deleted = edits.delete(&changed, &other, false, 20).unwrap();
        assert_eq!(edits.undo_target(&id, 30), Some(UndoKind::Delete));
        assert_eq!(edits.removal_preview(30).map(|(_, i, remaining)| (i, remaining)), Some((1, 5990)));
        assert_eq!(edits.change_remaining(&id, 30), Some(9980));
        assert!(edits.removal_preview(6020).is_none());
        assert_eq!(edits.undo_target(&id, 6020), Some(UndoKind::Change));
        assert_eq!(edits.undo_target("another", 6020), None);
        assert_eq!(edits.change_remaining("another", 30), None);
        assert_eq!(edits.undo_target(&id, 10010), None);
        assert_eq!(edits.change_remaining(&id, 10010), None);
    }

    #[test]
    fn saving_a_seventh_scene_refuses_without_eviction() {
        let mut settings = Settings::default();
        for i in 0..6 {
            settings = save_look(&settings, &format!("Scene {i}"), &format!("id-{i}")).unwrap().0;
        }
        assert!(save_look(&settings, "Seventh", "seventh").is_err());
        assert_eq!(settings.presets.len(), 6);
        let (replaced, id) = save_look(&settings, "SCENE 0", "other-id").unwrap();
        assert_eq!(id, "id-0");
        assert_eq!(replaced.presets.len(), 6);
    }

    #[test]
    fn autosave_excludes_camera_quality_and_undo_keeps_a_later_rename() {
        let (settings, id) = save_look(&Settings::default(), "Desk", "desk").unwrap();
        let mut edits = SceneEdits::default();
        let next =
            settings.with_patch(&json!({"shape":"portrait","cameraId":"new-camera","overlayResolution":"2160p"}));
        let next = edits.follow(
            &settings,
            next,
            &id,
            &json!({"shape":"portrait","cameraId":"new-camera","overlayResolution":"2160p"}),
            10,
        );
        assert_eq!(next.presets[0].settings.shape, crate::settings::Shape::Portrait);
        assert_eq!(next.presets[0].settings.camera_id, "");
        let next = rename_scene(&next, &id, "Studio").unwrap();
        let restored = edits.undo_change(&next, &id, 20).unwrap();
        assert_eq!(restored.presets[0].name, "Studio");
        assert_eq!(restored.presets[0].settings.shape, crate::settings::Shape::Circle);
        assert!(edits.undo_change(&restored, &id, 21).is_none());
    }

    #[test]
    fn deletion_undo_expires_and_never_overwrites_a_new_namesake() {
        let (settings, id) = save_look(&Settings::default(), "Desk", "desk").unwrap();
        let mut edits = SceneEdits::default();
        let deleted = edits.delete(&settings, &id, true, 100).unwrap();
        assert!(edits.restore_delete(&deleted, 6100).is_none());
        let deleted = edits.delete(&settings, &id, true, 100).unwrap();
        let (namesake, _) = save_look(&deleted, "Desk", "new").unwrap();
        assert!(edits.restore_delete(&namesake, 101).is_none());
    }

    #[test]
    fn names_match_across_case_accents_and_joiners() {
        assert!(same_name("Desk", "DESK"));
        assert!(same_name("Caf\u{e9}", "Cafe\u{301}"));
        assert!(same_name("👍\u{fe0f}", "👍"));
        assert!(!same_name("Desk", "Desk 2"));
    }
}
