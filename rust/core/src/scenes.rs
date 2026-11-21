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

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn names_match_across_case_accents_and_joiners() {
        assert!(same_name("Desk", "DESK"));
        assert!(same_name("Caf\u{e9}", "Cafe\u{301}"));
        assert!(same_name("👍\u{fe0f}", "👍"));
        assert!(!same_name("Desk", "Desk 2"));
    }
}
