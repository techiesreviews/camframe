//! Prompter link API 2: request validation and privacy boundaries, without sockets or windows.
use crate::settings::{LayoutSize, Scene, Settings, Spot};
use regex::Regex;
use serde_json::{Value, json};
use sha2::{Digest, Sha256};
use std::sync::OnceLock;

pub fn host_allowed(host: &str) -> bool {
    matches!(host, "127.0.0.1:47833" | "localhost:47833")
}
pub fn origin_allowed(origin: Option<&str>) -> bool {
    let Some(origin) = origin else { return true };
    static LOCAL: OnceLock<Regex> = OnceLock::new();
    matches!(origin, "null" | "https://prompter.techies.tools")
        || LOCAL
            .get_or_init(|| Regex::new(r"^http://(?:localhost|127\.0\.0\.1)(?::[0-9]{1,5})?$").expect("origin regex"))
            .is_match(origin)
}
fn integer(value: &Value, min: f64, max: f64) -> bool {
    value.as_f64().is_some_and(|n| n.is_finite() && n.fract() == 0.0 && n >= min && n <= max)
}
fn camera_size(value: &Value) -> bool {
    integer(value, 180.0, 640.0)
}
fn position(value: &Value, current: bool) -> bool {
    value.as_str().is_some_and(|s| Spot::parse(s).is_some() || (current && s == "current"))
        || value.as_object().is_some_and(|p| {
            p.len() == 2
                && p.get("x").is_some_and(|v| integer(v, -100000.0, 100000.0))
                && p.get("y").is_some_and(|v| integer(v, -100000.0, 100000.0))
        })
}
fn valid_name(name: &str) -> bool {
    let name = name.trim();
    if name.is_empty()
        || name.encode_utf16().count() > 40
        || name.starts_with(['\u{200c}', '\u{200d}'])
        || name.ends_with(['\u{200c}', '\u{200d}'])
    {
        return false;
    }
    static INVISIBLE: OnceLock<Regex> = OnceLock::new();
    let invisible = INVISIBLE
        .get_or_init(|| Regex::new(r"[\p{Cc}\p{Zl}\p{Zp}\p{Default_Ignorable_Code_Point}]").expect("name regex"));
    let permitted = |ch: char| matches!(ch,'\u{200c}'|'\u{200d}'|'\u{fe00}'..='\u{fe0f}'|'\u{e0020}'..='\u{e007f}'|'\u{e0100}'..='\u{e01ef}');
    if name.chars().any(|ch| !permitted(ch) && invisible.is_match(&ch.to_string())) {
        return false;
    }
    name.chars().any(|ch| !ch.is_whitespace() && ch != '\u{2800}' && !invisible.is_match(&ch.to_string()))
}

pub fn validate(kind: &str, input: &Value) -> Result<Value, String> {
    let Some(body) = input.as_object() else { return Err("Send a JSON object.".into()) };
    let keys: &[&str] = match kind {
        "cue" => &["size", "position", "scene", "margin", "withinRight"],
        "scenes" => &["name", "size", "position", "margin", "withinRight", "replace", "apply"],
        "small-size" => &["size"],
        _ => return Err("Not found.".into()),
    };
    let unknown = body.keys().filter(|key| !keys.contains(&key.as_str())).cloned().collect::<Vec<_>>();
    if !unknown.is_empty() {
        return Err(format!("Unknown {kind} field: {}.", unknown.join(", ")));
    }
    let mut checked = input.clone();
    if kind == "small-size" {
        if input["size"] != "current" && !camera_size(&input["size"]) {
            return Err("size must be current or a whole number from 180 to 640.".into());
        }
        return Ok(checked);
    }
    if kind == "cue"
        && let Some(scene) = body.get("scene")
    {
        let name = scene
            .as_str()
            .map(str::trim)
            .filter(|name| !name.is_empty() && name.encode_utf16().count() <= 40)
            .ok_or("scene must be a Scene name of 1 to 40 characters.")?;
        if body.contains_key("position")
            || body.contains_key("margin")
            || body.contains_key("withinRight")
            || body.get("size").is_some_and(|s| s != "small")
        {
            return Err("A Scene has its own size and place.".into());
        }
        return Ok(json!({"size":"small","scene":name}));
    }
    if kind == "scenes" {
        let name = input["name"]
            .as_str()
            .filter(|name| valid_name(name))
            .ok_or("A Scene needs a visible name of 1 to 40 characters, without line breaks.")?;
        checked["name"] = json!(name.trim());
        for key in ["replace", "apply"] {
            if let Some(value) = body.get(key) {
                if !value.is_boolean() {
                    return Err("replace and apply must be true or false.".into());
                }
            } else {
                checked[key] = json!(false);
            }
        }
        if !body.contains_key("size") {
            checked["size"] = json!("current");
        }
        if !body.contains_key("position") {
            checked["position"] = json!("current");
        }
    }
    let size = &checked["size"];
    let allowed_string = if kind == "cue" { ["full", "small"] } else { ["current", "small"] };
    if !camera_size(size) && !size.as_str().is_some_and(|size| allowed_string.contains(&size)) {
        return Err("size must be an allowed size or a whole number from 180 to 640.".into());
    }
    if kind == "cue" && size == "full" {
        if body.contains_key("position") || body.contains_key("margin") || body.contains_key("withinRight") {
            return Err("position, margin and withinRight go only with a compact size.".into());
        }
        return Ok(checked);
    }
    if let Some(value) = checked.get("position")
        && !position(value, kind == "scenes")
    {
        return Err("position must be a place name or {x,y} in whole screen pixels.".into());
    }
    let spot = checked["position"].as_str().and_then(Spot::parse);
    if let Some(margin) = body.get("margin")
        && (!integer(margin, 0.0, 160.0) || spot.is_none())
    {
        return Err("margin must be 0 to 160 and goes only with a place name.".into());
    }
    if let Some(share) = body.get("withinRight")
        && (!share.as_f64().is_some_and(crate::settings::is_within_right_share) || !spot.is_some_and(Spot::is_right))
    {
        return Err("withinRight must be 0.1 to 1 and goes only with a right-hand place.".into());
    }
    Ok(checked)
}

pub fn look(settings: &Settings) -> Value {
    let mut look = settings.scene_settings().to_json();
    look.remove("size");
    look.remove("position");
    let bytes = serde_json::to_vec(&look).expect("look serializes");
    let signature = format!("{:x}", Sha256::digest(bytes));
    look.remove("cameraId");
    look.insert("signature".into(), json!(&signature[..16]));
    Value::Object(look)
}
pub fn scene_detail(scene: &Scene, settings: &Settings) -> Value {
    use crate::settings::{OVERLAY_CHROME, Point};
    let point = scene
        .settings
        .position
        .map(|p| Point { x: p.x + i64::from(OVERLAY_CHROME.left), y: p.y + i64::from(OVERLAY_CHROME.top) });
    let mut result = json!({"id":scene.id,"name":scene.name,"kind":if scene.layout.is_some(){"layout"}else{"snapshot"},"size":scene.settings.size,"position":point,"savedSize":scene.settings.size,"savedPosition":scene.settings.position,"keepsLiveLook":scene.layout.is_some()});
    if let Some(layout) = scene.layout {
        result["size"] = json!(match layout.size {
            LayoutSize::Small => settings.prompter_small_size,
            LayoutSize::Pixels(size) => size,
        });
        result["followsSmallSize"] = json!(layout.size == LayoutSize::Small);
        if let Some(spot) = layout.position {
            result["position"] = json!(spot);
        }
        if let Some(margin) = layout.margin {
            result["margin"] = json!(margin);
        }
        if let Some(share) = layout.within_right {
            result["withinRight"] = json!(share);
        }
    } else {
        result["look"] = look(&settings.with_patch(&serde_json::to_value(&scene.settings).expect("Scene serializes")));
    }
    result
}
#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;
    #[test]
    fn only_loopback_hosts_and_the_existing_prompter_origins_are_allowed() {
        assert!(host_allowed("127.0.0.1:47833"));
        assert!(host_allowed("localhost:47833"));
        assert!(!host_allowed("evil.example:47833"));
        assert!(!host_allowed("127.0.0.1:80"));
        for origin in [None, Some("null"), Some("https://prompter.techies.tools"), Some("http://localhost:8123")] {
            assert!(origin_allowed(origin));
        }
        for origin in [
            "https://evil.example",
            "https://prompter.techies.tools.evil.example",
            "http://127.0.0.1.evil.example:47833",
            "http://[::1]:123",
        ] {
            assert!(!origin_allowed(Some(origin)));
        }
    }
    #[test]
    fn cues_are_strict_and_scene_cues_normalize_to_small() {
        assert_eq!(validate("cue", &json!({"scene":" Desk "})).unwrap(), json!({"size":"small","scene":"Desk"}));
        for value in [
            json!({"size":"full","position":"right"}),
            json!({"size":400,"withinRight":0.3}),
            json!({"size":400,"position":{"x":1.5,"y":2}}),
            json!({"size":400,"surprise":true}),
            json!({"size":179}),
        ] {
            assert!(validate("cue", &value).is_err());
        }
        assert!(validate("cue", &json!({"size":432,"position":"right","withinRight":0.3})).is_ok());
    }
    #[test]
    fn scene_saves_reject_invisible_names_and_non_boolean_replace() {
        for name in ["\u{200b}", "x\nY", "\u{200d}Desk", "Desk\u{2060}", "\u{2800}"] {
            assert!(validate("scenes", &json!({"name":name})).is_err(), "{name:?}");
        }
        assert!(validate("scenes", &json!({"name":"👩‍💻 Desk"})).is_ok());
        assert!(validate("scenes", &json!({"name":"Desk","replace":"true"})).is_err());
        assert!(validate("small-size", &json!({"size":"current"})).is_ok());
    }
}
