//! Port of `src/settings.js`: Preferences defaults, sanitization, Scene helpers, and geometry.
//!
//! Sanitization works on untrusted `serde_json::Value` input exactly like the JavaScript
//! version, so the two implementations share one `preferences.json` document format.

use serde::Serialize;
use serde_json::{Map, Value};

pub const SCHEMA_VERSION: u32 = 12;
pub const CURRENT_ONBOARDING_VERSION: u32 = 1;
pub const MAX_SCENES: usize = 6;
pub const MIN_SIZE: f64 = 180.0;
pub const MAX_SIZE: f64 = 640.0;

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum Shape {
    Circle,
    Rounded,
    Portrait,
    Landscape,
}

impl Shape {
    pub const ALL: [Shape; 4] = [Shape::Circle, Shape::Rounded, Shape::Portrait, Shape::Landscape];

    fn parse(value: &str) -> Option<Self> {
        Self::ALL.into_iter().find(|shape| shape.token() == value)
    }

    pub fn token(self) -> &'static str {
        match self {
            Shape::Circle => "circle",
            Shape::Rounded => "rounded",
            Shape::Portrait => "portrait",
            Shape::Landscape => "landscape",
        }
    }

    /// Circle → Square → Portrait → Wide → Circle.
    pub fn next(self) -> Self {
        match self {
            Shape::Circle => Shape::Rounded,
            Shape::Rounded => Shape::Portrait,
            Shape::Portrait => Shape::Landscape,
            Shape::Landscape => Shape::Circle,
        }
    }

    /// Corner radius for a surface of the given size, matching the CSS treatment.
    pub fn radius(self, width: f32, height: f32) -> f32 {
        let short = width.min(height);
        match self {
            Shape::Circle => short / 2.0,
            Shape::Rounded => short * 0.16,
            Shape::Portrait | Shape::Landscape => short * 0.12,
        }
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize)]
pub enum Resolution {
    #[serde(rename = "480p")]
    P480,
    #[serde(rename = "720p")]
    P720,
    #[serde(rename = "1080p")]
    P1080,
    #[serde(rename = "2160p")]
    P2160,
}

impl Resolution {
    pub const ALL: [Resolution; 4] = [Self::P480, Self::P720, Self::P1080, Self::P2160];

    fn parse(value: &str) -> Option<Self> {
        Self::ALL.into_iter().find(|resolution| resolution.token() == value)
    }

    pub fn token(self) -> &'static str {
        match self {
            Self::P480 => "480p",
            Self::P720 => "720p",
            Self::P1080 => "1080p",
            Self::P2160 => "2160p",
        }
    }

    pub fn label(self) -> &'static str {
        match self {
            Self::P2160 => "4K",
            other => other.token(),
        }
    }

    pub fn dimensions(self) -> (u32, u32) {
        match self {
            Self::P480 => (854, 480),
            Self::P720 => (1280, 720),
            Self::P1080 => (1920, 1080),
            Self::P2160 => (3840, 2160),
        }
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum FrameEffect {
    None,
    Glow,
    Blur,
}

impl FrameEffect {
    pub const ALL: [FrameEffect; 3] = [Self::None, Self::Glow, Self::Blur];

    fn parse(value: &str) -> Option<Self> {
        Self::ALL.into_iter().find(|effect| effect.token() == value)
    }

    pub fn token(self) -> &'static str {
        match self {
            Self::None => "none",
            Self::Glow => "glow",
            Self::Blur => "blur",
        }
    }

    pub fn label(self) -> &'static str {
        match self {
            Self::None => "None",
            Self::Glow => "Glow",
            Self::Blur => "Progressive blur",
        }
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Serialize)]
pub struct CameraPosition {
    pub x: f64,
    pub y: f64,
}

impl Default for CameraPosition {
    fn default() -> Self {
        Self { x: 50.0, y: 50.0 }
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize)]
pub struct ScreenPosition {
    pub x: i32,
    pub y: i32,
}

/// The reusable subset captured by a Scene, in `PRESET_SETTING_KEYS` order.
#[derive(Clone, Debug, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SceneSettings {
    pub camera_id: String,
    pub camera_label: String,
    pub shape: Shape,
    pub size: u32,
    pub overlay_resolution: Resolution,
    pub frame_effect: FrameEffect,
    pub effect_color: String,
    pub glow_strength: u32,
    pub glow_spread: u32,
    pub blur_amount: u32,
    pub blur_opacity: u32,
    pub border_width: u32,
    pub border_color: String,
    pub mirror: bool,
    pub camera_zoom: u32,
    pub camera_position: CameraPosition,
    pub position: Option<ScreenPosition>,
}

#[derive(Clone, Debug, PartialEq, Serialize)]
pub struct Scene {
    pub id: String,
    pub name: String,
    pub settings: SceneSettings,
}

#[derive(Clone, Debug, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Settings {
    pub schema_version: u32,
    #[serde(flatten)]
    pub scene: SceneSettings,
    pub always_on_top: bool,
    pub overlay_visible: bool,
    pub launch_at_login: bool,
    pub completed_onboarding_version: u32,
    #[serde(rename = "presets")]
    pub scenes: Vec<Scene>,
}

impl Default for SceneSettings {
    fn default() -> Self {
        Self {
            camera_id: String::new(),
            camera_label: "Default camera".into(),
            shape: Shape::Circle,
            size: 288,
            overlay_resolution: Resolution::P720,
            frame_effect: FrameEffect::None,
            effect_color: "#fb923c".into(),
            glow_strength: 90,
            glow_spread: 13,
            blur_amount: 12,
            blur_opacity: 72,
            border_width: 0,
            border_color: "#ffffff".into(),
            mirror: true,
            camera_zoom: 100,
            camera_position: CameraPosition::default(),
            position: None,
        }
    }
}

impl Default for Settings {
    fn default() -> Self {
        Self {
            schema_version: SCHEMA_VERSION,
            scene: SceneSettings::default(),
            always_on_top: true,
            overlay_visible: true,
            launch_at_login: false,
            completed_onboarding_version: 0,
            scenes: Vec::new(),
        }
    }
}

fn finite(value: Option<&Value>) -> Option<f64> {
    value.and_then(Value::as_f64).filter(|number| number.is_finite())
}

fn clamp_round(value: f64, min: f64, max: f64) -> u32 {
    value.clamp(min, max).round() as u32
}

fn round_tenth(value: f64) -> f64 {
    (value * 10.0).round() / 10.0
}

pub fn is_hex_color(value: &str) -> bool {
    value.len() == 7
        && value.starts_with('#')
        && value[1..].chars().all(|character| character.is_ascii_hexdigit())
}

fn truncate(value: &str, max_chars: usize) -> String {
    value.chars().take(max_chars).collect()
}

fn sanitize_scene_settings(input: &Map<String, Value>) -> SceneSettings {
    let mut settings = SceneSettings::default();
    let text = |key: &str| input.get(key).and_then(Value::as_str);

    if let Some(id) = text("cameraId") {
        settings.camera_id = truncate(id, 512);
    }
    if let Some(label) = text("cameraLabel") {
        settings.camera_label = truncate(label, 120);
    }
    if let Some(shape) = text("shape").and_then(Shape::parse) {
        settings.shape = shape;
    }
    if let Some(size) = finite(input.get("size")) {
        settings.size = clamp_round(size, MIN_SIZE, MAX_SIZE);
    }
    if let Some(resolution) = text("overlayResolution").and_then(Resolution::parse) {
        settings.overlay_resolution = resolution;
    }
    if let Some(effect) = text("frameEffect").and_then(FrameEffect::parse) {
        settings.frame_effect = effect;
    }
    if let Some(color) = text("effectColor").filter(|color| is_hex_color(color)) {
        settings.effect_color = color.into();
    }
    if let Some(value) = finite(input.get("glowStrength")) {
        settings.glow_strength = clamp_round(value, 10.0, 100.0);
    }
    if let Some(value) = finite(input.get("glowSpread")) {
        settings.glow_spread = clamp_round(value, 4.0, 18.0);
    }
    if let Some(value) = finite(input.get("blurAmount")) {
        settings.blur_amount = clamp_round(value, 4.0, 18.0);
    }
    if let Some(value) = finite(input.get("blurOpacity")) {
        settings.blur_opacity = clamp_round(value, 10.0, 100.0);
    }
    if let Some(value) = finite(input.get("borderWidth")) {
        settings.border_width = clamp_round(value, 0.0, 12.0);
    }
    if let Some(color) = text("borderColor").filter(|color| is_hex_color(color)) {
        settings.border_color = color.into();
    }
    if let Some(mirror) = input.get("mirror").and_then(Value::as_bool) {
        settings.mirror = mirror;
    }
    if let Some(zoom) = finite(input.get("cameraZoom")) {
        settings.camera_zoom = clamp_round(zoom, 100.0, 250.0);
    }
    if let Some(position) = input.get("cameraPosition").and_then(Value::as_object) {
        if let Some(x) = finite(position.get("x")) {
            settings.camera_position.x = round_tenth(x.clamp(0.0, 100.0));
        }
        if let Some(y) = finite(position.get("y")) {
            settings.camera_position.y = round_tenth(y.clamp(0.0, 100.0));
        }
    }
    if let Some(position) = input.get("position").and_then(Value::as_object) {
        let integer = |key: &str| {
            position
                .get(key)
                .and_then(Value::as_f64)
                .filter(|value| value.fract() == 0.0 && value.is_finite())
                .map(|value| value as i32)
        };
        if let (Some(x), Some(y)) = (integer("x"), integer("y")) {
            settings.position = Some(ScreenPosition { x, y });
        }
    }
    settings
}

fn is_truthy(value: &Value) -> bool {
    match value {
        Value::Null => false,
        Value::Bool(flag) => *flag,
        Value::Number(number) => number.as_f64().is_some_and(|n| n != 0.0 && !n.is_nan()),
        Value::String(text) => !text.is_empty(),
        Value::Array(_) | Value::Object(_) => true,
    }
}

fn sanitize_scene(value: &Value) -> Option<Scene> {
    let record = value.as_object()?;
    let id = truncate(record.get("id")?.as_str()?, 64);
    let name = truncate(record.get("name")?.as_str()?.trim(), 40);
    // Electron accepts any truthy `settings` value and sanitizes missing fields to defaults.
    let settings = record.get("settings").filter(|value| is_truthy(value))?;
    if id.is_empty() || name.is_empty() {
        return None;
    }
    let empty = Map::new();
    let settings = settings.as_object().unwrap_or(&empty);
    Some(Scene { id, name, settings: sanitize_scene_settings(settings) })
}

/// Mirrors `sanitizeSettings()`: defaults first, then each known and valid field.
pub fn sanitize(input: &Value) -> Settings {
    let empty = Map::new();
    let input = input.as_object().unwrap_or(&empty);
    let mut settings = Settings {
        scene: sanitize_scene_settings(input),
        ..Settings::default()
    };
    let flag = |key: &str| input.get(key).and_then(Value::as_bool);
    if let Some(value) = flag("alwaysOnTop") {
        settings.always_on_top = value;
    }
    if let Some(value) = flag("overlayVisible") {
        settings.overlay_visible = value;
    }
    if let Some(value) = flag("launchAtLogin") {
        settings.launch_at_login = value;
    }
    settings.completed_onboarding_version = finite(input.get("completedOnboardingVersion"))
        .map(|value| clamp_round(value, 0.0, CURRENT_ONBOARDING_VERSION as f64))
        .unwrap_or(0);
    if let Some(scenes) = input.get("presets").and_then(Value::as_array) {
        // Only the first six input records are considered, before invalid ones are dropped.
        settings.scenes = scenes.iter().take(MAX_SCENES).filter_map(sanitize_scene).collect();
    }
    settings
}

/// Mirrors main-process loading: legacy migration, onboarding migration, then startup override.
pub fn startup_settings_from_document(document: Option<Value>) -> Settings {
    let has_document = document.is_some();
    let mut input = document.unwrap_or(Value::Object(Map::new()));
    if let Some(object) = input.as_object_mut() {
        let schema = object.get("schemaVersion").and_then(Value::as_f64).unwrap_or(0.0);
        if schema < 3.0 {
            object.insert("borderWidth".into(), 0.into());
            object.insert("size".into(), 288.into());
        }
        if has_document && !object.contains_key("completedOnboardingVersion") {
            object.insert("completedOnboardingVersion".into(), CURRENT_ONBOARDING_VERSION.into());
        }
    }
    let mut settings = sanitize(&input);
    settings.always_on_top = true;
    settings.overlay_visible = true;
    settings
}

pub fn to_document(settings: &Settings) -> serde_json::Result<Value> {
    serde_json::to_value(settings)
}

/// Re-applies every sanitization rule after an in-memory edit.
pub fn resanitize(settings: &Settings) -> Settings {
    to_document(settings).map_or_else(|_| settings.clone(), |document| sanitize(&document))
}

// MARK: Scenes

pub fn new_scene_id(now_ms: u128) -> String {
    const DIGITS: &[u8] = b"0123456789abcdefghijklmnopqrstuvwxyz";
    let mut value = now_ms;
    let mut encoded = Vec::new();
    loop {
        encoded.push(char::from(DIGITS[(value % 36) as usize]));
        value /= 36;
        if value == 0 {
            break;
        }
    }
    format!("preset-{}", encoded.iter().rev().collect::<String>())
}

/// Save/update: match the requested ID first, then a case-insensitive name. A new
/// Scene beyond the limit drops the oldest one.
pub fn save_scene(
    scenes: &[Scene],
    name: &str,
    requested_id: Option<&str>,
    settings: SceneSettings,
    new_id: String,
) -> (Vec<Scene>, String) {
    let name = truncate(name.trim(), 40);
    let mut next = scenes.to_vec();
    let lower = name.to_lowercase();
    let existing = requested_id
        .and_then(|id| next.iter().position(|scene| scene.id == id))
        .or_else(|| next.iter().position(|scene| scene.name.to_lowercase() == lower));
    match existing {
        Some(index) => {
            next[index].name = name;
            next[index].settings = settings;
            let id = next[index].id.clone();
            (next, id)
        }
        None => {
            if next.len() >= MAX_SCENES {
                next.drain(..next.len() + 1 - MAX_SCENES);
            }
            next.push(Scene { id: new_id.clone(), name, settings });
            (next, new_id)
        }
    }
}

pub fn reorder_scenes(scenes: &[Scene], id: &str, direction: i32) -> Vec<Scene> {
    let mut next = scenes.to_vec();
    let Some(index) = next.iter().position(|scene| scene.id == id) else {
        return next;
    };
    let target = index as i64 + i64::from(direction.signum());
    if target < 0 || target >= next.len() as i64 {
        return next;
    }
    next.swap(index, target as usize);
    next
}

pub fn merge_scenes(existing: &[Scene], imported: &[Scene]) -> Vec<Scene> {
    let mut next = existing.to_vec();
    for scene in imported {
        let lower = scene.name.to_lowercase();
        let found = next
            .iter()
            .position(|local| local.id == scene.id || local.name.to_lowercase() == lower);
        if let Some(index) = found {
            let id = next[index].id.clone();
            next[index] = Scene { id, ..scene.clone() };
        } else if next.len() < MAX_SCENES {
            let id = if next.iter().any(|local| local.id == scene.id) {
                truncate(&format!("imported-{}-{}", next.len() + 1, scene.id), 64)
            } else {
                scene.id.clone()
            };
            next.push(Scene { id, ..scene.clone() });
        }
    }
    next.truncate(MAX_SCENES);
    next
}

/// Accepts the canonical export, a legacy `presets` document, or a bare array.
pub fn scenes_from_import(document: &Value) -> Vec<Scene> {
    let records = document
        .as_array()
        .or_else(|| document.get("scenes").and_then(Value::as_array))
        .or_else(|| document.get("presets").and_then(Value::as_array));
    // Like `sanitizeSettings()`, only the first six records are considered before filtering.
    records
        .map(|records| records.iter().take(MAX_SCENES).filter_map(sanitize_scene).collect())
        .unwrap_or_default()
}

pub fn scenes_export_document(scenes: &[Scene]) -> serde_json::Result<String> {
    serde_json::to_string_pretty(&serde_json::json!({
        "format": "camframe-scenes",
        "version": 1,
        "scenes": scenes,
    }))
}

// MARK: Geometry

pub const CHROME_TOP: f32 = 84.0;
pub const CHROME_SIDE: f32 = 18.0;
pub const CHROME_BOTTOM: f32 = 18.0;

pub fn camera_dimensions(shape: Shape, size: u32) -> (f32, f32) {
    let size = size as f32;
    match shape {
        Shape::Portrait => ((size * 0.75).round(), size),
        Shape::Landscape => (size, (size * 0.5625).round()),
        Shape::Circle | Shape::Rounded => (size, size),
    }
}

pub fn overlay_dimensions(shape: Shape, size: u32) -> (f32, f32) {
    let (width, height) = camera_dimensions(shape, size);
    (width + CHROME_SIDE * 2.0, height + CHROME_TOP + CHROME_BOTTOM)
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Corner {
    TopLeft,
    TopRight,
    BottomLeft,
    BottomRight,
}

impl Corner {
    pub const ALL: [Corner; 4] =
        [Corner::TopLeft, Corner::TopRight, Corner::BottomLeft, Corner::BottomRight];

    pub fn is_left(self) -> bool {
        matches!(self, Corner::TopLeft | Corner::BottomLeft)
    }

    pub fn is_top(self) -> bool {
        matches!(self, Corner::TopLeft | Corner::TopRight)
    }
}

/// Mirrors `resizeOverlayFromCorner()`. Returns the new size and the outer-window origin
/// shift that keeps the opposite corner anchored.
pub fn resize_from_corner(shape: Shape, size: u32, corner: Corner, delta: (f32, f32)) -> (u32, (f32, f32)) {
    let (start_width, start_height) = camera_dimensions(shape, size);
    let scale_x = start_width / size as f32;
    let scale_y = start_height / size as f32;
    let horizontal = if corner.is_left() { -delta.0 } else { delta.0 } / scale_x;
    let vertical = if corner.is_top() { -delta.1 } else { delta.1 } / scale_y;
    let change = if horizontal.abs() >= vertical.abs() { horizontal } else { vertical };
    let next = clamp_round(size as f64 + change as f64, MIN_SIZE, MAX_SIZE);
    let (next_width, next_height) = camera_dimensions(shape, next);
    let shift_x = if corner.is_left() { start_width - next_width } else { 0.0 };
    let shift_y = if corner.is_top() { start_height - next_height } else { 0.0 };
    (next, (shift_x, shift_y))
}

/// Mirrors `cameraPositionAfterDrag()`.
pub fn camera_position_after_drag(
    position: CameraPosition,
    delta: (f32, f32),
    surface: (f32, f32),
    mirrored: bool,
    zoom: u32,
) -> CameraPosition {
    let width = surface.0.max(1.0) as f64;
    let height = surface.1.max(1.0) as f64;
    let overflow = zoom as f64 / 100.0 - 1.0;
    let overflow_scale = if overflow > 0.0 { overflow } else { 1.0 };
    let dx = if mirrored { delta.0 } else { -delta.0 } as f64;
    CameraPosition {
        x: round_tenth((position.x + dx / (width * overflow_scale) * 100.0).clamp(0.0, 100.0)),
        y: round_tenth((position.y - delta.1 as f64 / (height * overflow_scale) * 100.0).clamp(0.0, 100.0)),
    }
}

/// Mirrors `cameraZoomAfterWheel()`: stable 5% steps from 100–250%.
pub fn camera_zoom_after_wheel(zoom: u32, delta_y: f32) -> u32 {
    if delta_y == 0.0 || !delta_y.is_finite() {
        return zoom;
    }
    let step = if delta_y < 0.0 { 5.0 } else { -5.0 };
    clamp_round(zoom as f64 + step, 100.0, 250.0)
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn defaults_match_the_electron_contract() {
        let settings = sanitize(&json!({}));
        assert_eq!(settings, Settings::default());
        assert_eq!(overlay_dimensions(Shape::Circle, 288), (324.0, 390.0));
    }

    #[test]
    fn sanitization_clamps_and_rejects_invalid_values() {
        let settings = sanitize(&json!({
            "shape": "hexagon",
            "size": 9000,
            "overlayResolution": "8k",
            "effectColor": "orange",
            "borderColor": "#ABCDEF",
            "glowSpread": 1,
            "cameraZoom": 251.4,
            "cameraPosition": { "x": 12.345, "y": -3 },
            "position": { "x": 10.5, "y": 20 },
            "completedOnboardingVersion": 9,
            "unknown": true
        }));
        assert_eq!(settings.scene.shape, Shape::Circle);
        assert_eq!(settings.scene.size, 640);
        assert_eq!(settings.scene.overlay_resolution, Resolution::P720);
        assert_eq!(settings.scene.effect_color, "#fb923c");
        assert_eq!(settings.scene.border_color, "#ABCDEF");
        assert_eq!(settings.scene.glow_spread, 4);
        assert_eq!(settings.scene.camera_zoom, 250);
        assert_eq!(settings.scene.camera_position, CameraPosition { x: 12.3, y: 0.0 });
        assert_eq!(settings.scene.position, None);
        assert_eq!(settings.completed_onboarding_version, 1);
    }

    #[test]
    fn documents_round_trip_with_electron_field_names() {
        let mut settings = Settings::default();
        settings.scene.position = Some(ScreenPosition { x: 40, y: -12 });
        settings.scenes.push(Scene {
            id: "preset-a".into(),
            name: "Desk".into(),
            settings: settings.scene.clone(),
        });
        let document = to_document(&settings).unwrap();
        assert_eq!(document["overlayResolution"], "720p");
        assert_eq!(document["presets"][0]["settings"]["cameraZoom"], 100);
        assert_eq!(document["schemaVersion"], 12);
        assert_eq!(sanitize(&document), settings);
    }

    #[test]
    fn startup_migrates_legacy_documents_and_forces_visibility() {
        let settings = startup_settings_from_document(Some(json!({
            "schemaVersion": 2, "size": 400, "borderWidth": 6,
            "alwaysOnTop": false, "overlayVisible": false
        })));
        assert_eq!(settings.scene.size, 288);
        assert_eq!(settings.scene.border_width, 0);
        assert!(settings.always_on_top && settings.overlay_visible);
        assert_eq!(settings.completed_onboarding_version, CURRENT_ONBOARDING_VERSION);
        assert_eq!(startup_settings_from_document(None).completed_onboarding_version, 0);
    }

    #[test]
    fn scene_saves_update_by_id_or_name_and_keep_six() {
        let base = SceneSettings::default();
        let mut scenes = Vec::new();
        for index in 0..6 {
            (scenes, _) = save_scene(&scenes, &format!("S{index}"), None, base.clone(), format!("id-{index}"));
        }
        let (renamed, id) = save_scene(&scenes, "s2", None, base.clone(), "unused".into());
        assert_eq!((renamed.len(), id.as_str()), (6, "id-2"));
        let (overflow, _) = save_scene(&scenes, "New", None, base, "id-new".into());
        assert_eq!(overflow.len(), 6);
        assert_eq!(overflow.first().unwrap().id, "id-1");
        assert_eq!(overflow.last().unwrap().id, "id-new");
    }

    #[test]
    fn reorder_and_merge_follow_the_js_rules() {
        let scene = |id: &str, name: &str| Scene { id: id.into(), name: name.into(), settings: SceneSettings::default() };
        let scenes = vec![scene("a", "One"), scene("b", "Two")];
        assert_eq!(reorder_scenes(&scenes, "b", -1)[0].id, "b");
        assert_eq!(reorder_scenes(&scenes, "a", -1), scenes);
        let merged = merge_scenes(&scenes, &[scene("x", "two"), scene("a", "Other")]);
        assert_eq!(merged.iter().map(|s| (s.id.as_str(), s.name.as_str())).collect::<Vec<_>>(),
            vec![("a", "Other"), ("b", "two")]);
        let imported = scenes_from_import(&json!({ "presets": [{ "id": "z", "name": " Z ", "settings": {} }] }));
        assert_eq!(imported[0].name, "Z");
    }

    #[test]
    fn import_considers_only_six_truthy_records() {
        let record = |id: &str, settings: Value| json!({ "id": id, "name": id, "settings": settings });
        let mut records = vec![record("bad", json!(null)), record("one", json!(1))];
        records.extend((0..6).map(|index| record(&format!("s{index}"), json!({}))));
        let ids: Vec<_> = scenes_from_import(&Value::Array(records)).into_iter().map(|scene| scene.id).collect();
        assert_eq!(ids, ["one", "s0", "s1", "s2", "s3"]);
    }

    #[test]
    fn resize_anchors_the_opposite_corner() {
        assert_eq!(resize_from_corner(Shape::Circle, 288, Corner::BottomRight, (20.0, 5.0)), (308, (0.0, 0.0)));
        assert_eq!(resize_from_corner(Shape::Circle, 288, Corner::TopLeft, (20.0, 0.0)), (268, (20.0, 20.0)));
        assert_eq!(resize_from_corner(Shape::Circle, 200, Corner::BottomRight, (-100.0, 0.0)).0, 180);
    }

    #[test]
    fn framing_follows_the_visible_image() {
        let centered = CameraPosition::default();
        let moved = camera_position_after_drag(centered, (10.0, 0.0), (200.0, 200.0), true, 150);
        assert_eq!(moved.x, 60.0);
        let unmirrored = camera_position_after_drag(centered, (10.0, 10.0), (200.0, 200.0), false, 100);
        assert_eq!(unmirrored, CameraPosition { x: 45.0, y: 45.0 });
        assert_eq!(camera_zoom_after_wheel(100, -1.0), 105);
        assert_eq!(camera_zoom_after_wheel(100, 3.0), 100);
        assert_eq!(camera_zoom_after_wheel(250, -3.0), 250);
    }

    #[test]
    fn scene_ids_use_base36_time() {
        assert_eq!(new_scene_id(35), "preset-z");
        assert_eq!(new_scene_id(36), "preset-10");
    }
}
