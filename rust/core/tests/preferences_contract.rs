//! The language-neutral Preferences contract (`test/fixtures/preferences`). CamFrame 0.9.0 passes
//! every case in `test/preferences-contract.test.js` and `test/scenes.test.js`; the Rust app must
//! pass the same cases.

use std::path::PathBuf;

use camframe_core::scenes::{SceneLibrary, import_scenes};
use camframe_core::settings::{preferences_from_document, sanitize_settings};
use serde_json::{Value, json};

fn fixture(name: &str) -> Vec<Value> {
    let path = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../../test/fixtures/preferences").join(name);
    let text = std::fs::read_to_string(&path).unwrap_or_else(|error| panic!("{path:?}: {error}"));
    let document: Value = serde_json::from_str(&text).expect("fixture is JSON");
    document["cases"].as_array().expect("cases").clone()
}

fn name(case: &Value) -> &str {
    case["name"].as_str().unwrap_or("unnamed case")
}

#[test]
fn sanitize_contract() {
    let cases = fixture("sanitize.json");
    assert!(!cases.is_empty());
    let mut failures = Vec::new();
    for case in &cases {
        let actual = serde_json::to_value(sanitize_settings(&case["input"])).unwrap();
        if actual != case["expected"] {
            failures.push(format!("{}\n  got:  {actual}\n  want: {}", name(case), case["expected"]));
        }
    }
    assert!(failures.is_empty(), "{} of {} cases failed:\n{}", failures.len(), cases.len(), failures.join("\n"));
}

#[test]
fn load_contract() {
    let cases = fixture("load.json");
    assert!(!cases.is_empty());
    let mut failures = Vec::new();
    for case in &cases {
        let text = match (case.get("documentText"), case.get("document")) {
            (Some(Value::String(text)), _) => Some(text.clone()),
            (_, Some(document)) => Some(document.to_string()),
            _ => None,
        };
        let actual = serde_json::to_value(preferences_from_document(text.as_deref())).unwrap();
        if actual != case["expected"] {
            failures.push(format!("{}\n  got:  {actual}\n  want: {}", name(case), case["expected"]));
        }
    }
    assert!(failures.is_empty(), "{} of {} cases failed:\n{}", failures.len(), cases.len(), failures.join("\n"));
}

#[test]
fn scene_import_contract() {
    let cases = fixture("scene-import.json");
    assert!(!cases.is_empty());
    let mut failures = Vec::new();
    for case in &cases {
        let text = match case.get("payloadText") {
            Some(Value::String(text)) => text.clone(),
            _ => case["payload"].to_string(),
        };
        let library = SceneLibrary {
            settings: sanitize_settings(&json!({ "presets": case["existing"] })),
            active_scene_id: String::new(),
        };
        let actual = match import_scenes(&library, &text) {
            Ok(result) => json!({
                "scenes": serde_json::to_value(&result.library.settings.presets).unwrap(),
                "importedCount": result.imported_count,
            }),
            Err(error) => json!({ "error": error }),
        };
        if actual != case["expected"] {
            failures.push(format!("{}\n  got:  {actual}\n  want: {}", name(case), case["expected"]));
        }
    }
    assert!(failures.is_empty(), "{} of {} cases failed:\n{}", failures.len(), cases.len(), failures.join("\n"));
}
