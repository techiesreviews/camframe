//! Preferences: the settings CamFrame keeps in `preferences.json`, how untrusted input is cleaned
//! (`sanitize_settings`), and how a saved file becomes launch settings (`preferences_from_document`).
//! Mirrors `src/settings.js` of CamFrame 0.9.0 (schema 15, `docs/data-contracts.md`).

use serde::{Deserialize, Serialize};
use serde_json::{Map, Value, json};

use crate::js;

pub const SCHEMA_VERSION: u32 = 15;
pub const SCENE_LIMIT: usize = 6;
pub const CAMERA_SIZE_MIN: u32 = 180;
pub const CAMERA_SIZE_MAX: u32 = 640;
pub const CAMERA_ZOOM_MIN: u32 = 100;
pub const CAMERA_ZOOM_MAX: u32 = 250;
pub const PROMPTER_MARGIN_MIN: u32 = 0;
pub const PROMPTER_MARGIN_MAX: u32 = 160;
pub const WITHIN_RIGHT_MIN: f64 = 0.1;
pub const WITHIN_RIGHT_MAX: f64 = 1.0;
pub const CURRENT_ONBOARDING_VERSION: u32 = 1;
/// The first schema that may have no Scenes on purpose (everything deleted).
const STARTER_SCENES_SCHEMA: f64 = 15.0;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize, Default)]
#[serde(rename_all = "lowercase")]
pub enum Shape {
    #[default]
    Circle,
    Rounded,
    Portrait,
    Landscape,
}

impl Shape {
    pub const ALL: [Shape; 4] = [Shape::Circle, Shape::Rounded, Shape::Portrait, Shape::Landscape];

    pub fn parse(text: &str) -> Option<Shape> {
        Shape::ALL.into_iter().find(|shape| shape.key() == text)
    }

    pub fn key(self) -> &'static str {
        match self {
            Shape::Circle => "circle",
            Shape::Rounded => "rounded",
            Shape::Portrait => "portrait",
            Shape::Landscape => "landscape",
        }
    }

    /// The name people see (Shape button, Style tab, screen readers).
    pub fn label(self) -> &'static str {
        match self {
            Shape::Circle => "Circle",
            Shape::Rounded => "Rounded square",
            Shape::Portrait => "Portrait",
            Shape::Landscape => "Landscape",
        }
    }

    /// The next shape for the toolbar's Shape button.
    pub fn next(self) -> Shape {
        let index = Shape::ALL.iter().position(|shape| *shape == self).unwrap_or(0);
        Shape::ALL[(index + 1) % Shape::ALL.len()]
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Default)]
pub enum Resolution {
    #[serde(rename = "480p")]
    R480,
    #[default]
    #[serde(rename = "720p")]
    R720,
    #[serde(rename = "1080p")]
    R1080,
    #[serde(rename = "2160p")]
    R2160,
}

impl Resolution {
    pub const ALL: [Resolution; 4] = [Resolution::R480, Resolution::R720, Resolution::R1080, Resolution::R2160];

    pub fn key(self) -> &'static str {
        match self {
            Resolution::R480 => "480p",
            Resolution::R720 => "720p",
            Resolution::R1080 => "1080p",
            Resolution::R2160 => "2160p",
        }
    }

    pub fn parse(text: &str) -> Option<Resolution> {
        Resolution::ALL.into_iter().find(|value| value.key() == text)
    }

    /// The capture size the camera is asked for (`cameraTrackConstraintsFor`).
    pub fn size(self) -> (u32, u32) {
        match self {
            Resolution::R480 => (854, 480),
            Resolution::R720 => (1280, 720),
            Resolution::R1080 => (1920, 1080),
            Resolution::R2160 => (3840, 2160),
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Default)]
#[serde(rename_all = "lowercase")]
pub enum FrameEffect {
    #[default]
    None,
    Glow,
    Blur,
}

impl FrameEffect {
    pub fn parse(text: &str) -> Option<FrameEffect> {
        match text {
            "none" => Some(FrameEffect::None),
            "glow" => Some(FrameEffect::Glow),
            "blur" => Some(FrameEffect::Blur),
            _ => None,
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Default)]
#[serde(rename_all = "lowercase")]
pub enum SceneView {
    #[default]
    Grid,
    List,
}

/// The places a Prompter link cue can put the Compact Overlay on its current display.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum Spot {
    TopLeft,
    TopRight,
    BottomLeft,
    BottomRight,
    Left,
    Right,
    Center,
}

impl Spot {
    pub const ALL: [Spot; 7] =
        [Spot::TopLeft, Spot::TopRight, Spot::BottomLeft, Spot::BottomRight, Spot::Left, Spot::Right, Spot::Center];

    pub fn key(self) -> &'static str {
        match self {
            Spot::TopLeft => "top-left",
            Spot::TopRight => "top-right",
            Spot::BottomLeft => "bottom-left",
            Spot::BottomRight => "bottom-right",
            Spot::Left => "left",
            Spot::Right => "right",
            Spot::Center => "center",
        }
    }

    pub fn parse(text: &str) -> Option<Spot> {
        Spot::ALL.into_iter().find(|spot| spot.key() == text)
    }

    pub fn is_left(self) -> bool {
        self.key().ends_with("left")
    }

    pub fn is_right(self) -> bool {
        self.key().ends_with("right")
    }

    pub fn is_top(self) -> bool {
        self.key().starts_with("top")
    }

    pub fn is_bottom(self) -> bool {
        self.key().starts_with("bottom")
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Serialize, Deserialize)]
pub struct CameraPosition {
    #[serde(serialize_with = "js::serialize_number")]
    pub x: f64,
    #[serde(serialize_with = "js::serialize_number")]
    pub y: f64,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub struct Point {
    pub x: i64,
    pub y: i64,
}

/// The Preferences document. Field order is the order 0.9.0 writes.
#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Settings {
    pub schema_version: u32,
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
    pub always_on_top: bool,
    pub overlay_visible: bool,
    pub scene_view: SceneView,
    pub completed_onboarding_version: u32,
    pub position: Option<Point>,
    pub prompter_link: bool,
    pub prompter_face_full: String,
    pub prompter_face_small: String,
    pub prompter_margin: u32,
    pub prompter_small_size: u32,
    pub presets: Vec<Scene>,
}

impl Default for Settings {
    fn default() -> Self {
        Settings {
            schema_version: SCHEMA_VERSION,
            camera_id: String::new(),
            camera_label: "Default camera".into(),
            shape: Shape::Circle,
            size: 288,
            overlay_resolution: Resolution::R720,
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
            camera_position: CameraPosition { x: 50.0, y: 50.0 },
            always_on_top: true,
            overlay_visible: true,
            scene_view: SceneView::Grid,
            completed_onboarding_version: 0,
            position: None,
            prompter_link: false,
            prompter_face_full: "fullscreen".into(),
            prompter_face_small: "previous".into(),
            prompter_margin: 32,
            prompter_small_size: 288,
            presets: Vec::new(),
        }
    }
}

/// What a Scene stores (`PRESET_SETTING_KEYS`), in that order.
#[derive(Debug, Clone, PartialEq, Serialize)]
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
    pub position: Option<Point>,
}

/// The size a layout Scene asks for: the small size, or pixels.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum LayoutSize {
    Small,
    Pixels(u32),
}

impl Serialize for LayoutSize {
    fn serialize<S: serde::Serializer>(&self, serializer: S) -> Result<S::Ok, S::Error> {
        match self {
            LayoutSize::Small => serializer.serialize_str("small"),
            LayoutSize::Pixels(size) => serializer.serialize_u32(*size),
        }
    }
}

/// A layout Scene's rule (saved through the Prompter link): a size and a place, applied with the
/// live look.
#[derive(Debug, Clone, Copy, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SceneLayout {
    pub size: LayoutSize,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub position: Option<Spot>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub margin: Option<u32>,
    #[serde(skip_serializing_if = "Option::is_none", serialize_with = "js::serialize_optional_number")]
    pub within_right: Option<f64>,
}

#[derive(Debug, Clone, PartialEq, Serialize)]
pub struct Scene {
    pub id: String,
    pub name: String,
    pub settings: SceneSettings,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub layout: Option<SceneLayout>,
}

impl Settings {
    /// `settingsForPreset`: the part of these settings a Scene stores.
    pub fn scene_settings(&self) -> SceneSettings {
        SceneSettings {
            camera_id: self.camera_id.clone(),
            camera_label: self.camera_label.clone(),
            shape: self.shape,
            size: self.size,
            overlay_resolution: self.overlay_resolution,
            frame_effect: self.frame_effect,
            effect_color: self.effect_color.clone(),
            glow_strength: self.glow_strength,
            glow_spread: self.glow_spread,
            blur_amount: self.blur_amount,
            blur_opacity: self.blur_opacity,
            border_width: self.border_width,
            border_color: self.border_color.clone(),
            mirror: self.mirror,
            camera_zoom: self.camera_zoom,
            camera_position: self.camera_position,
            position: self.position,
        }
    }

    /// These settings as a JSON object, for merging patches the way 0.9.0 spreads objects.
    pub fn to_json(&self) -> Map<String, Value> {
        match serde_json::to_value(self) {
            Ok(Value::Object(map)) => map,
            _ => Map::new(),
        }
    }

    /// `sanitizeSettings({ ...settings, ...patch })`.
    pub fn with_patch(&self, patch: &Value) -> Settings {
        let mut merged = self.to_json();
        if let Value::Object(patch) = patch {
            for (key, value) in patch {
                merged.insert(key.clone(), value.clone());
            }
        }
        sanitize_settings(&Value::Object(merged))
    }

    /// `settingsAfterHandResize`: a corner resize by hand also sets the small size.
    pub fn after_hand_resize(&self, patch: &Value) -> Settings {
        let mut next = self.with_patch(patch);
        if js::finite(patch.get("size")).is_some() && next.size != self.size {
            next.prompter_small_size = next.size;
        }
        next
    }
}

impl SceneSettings {
    pub fn to_json(&self) -> Map<String, Value> {
        match serde_json::to_value(self) {
            Ok(Value::Object(map)) => map,
            _ => Map::new(),
        }
    }

    /// The camera size on screen for these settings.
    pub fn dimensions(&self) -> (u32, u32) {
        dimensions_for(self.shape, self.size)
    }
}

fn is_hex_colour(text: &str) -> bool {
    let bytes = text.as_bytes();
    bytes.len() == 7 && bytes[0] == b'#' && bytes[1..].iter().all(u8::is_ascii_hexdigit)
}

/// `/^scene:[\s\S]{1,64}$/`: a Scene choice of 1–64 UTF-16 units.
fn is_scene_choice(text: &str) -> bool {
    text.strip_prefix("scene:").is_some_and(|rest| (1..=64).contains(&js::len_utf16(rest)))
}

fn clamped(value: Option<&Value>, min: u32, max: u32) -> Option<u32> {
    js::finite(value).map(|number| js::round(js::clamp(number, f64::from(min), f64::from(max))) as u32)
}

fn string(value: Option<&Value>) -> Option<&str> {
    value.and_then(Value::as_str)
}

static EMPTY: std::sync::LazyLock<Map<String, Value>> = std::sync::LazyLock::new(Map::new);

fn object(value: &Value) -> &Map<String, Value> {
    value.as_object().unwrap_or(&EMPTY)
}

/// `sanitizeSettings(input)`: every value from untrusted input checked, clamped or dropped.
pub fn sanitize_settings(input: &Value) -> Settings {
    sanitize(input, true)
}

/// `settingsForPreset(input)`.
pub fn scene_settings_from(input: &Value) -> SceneSettings {
    sanitize(input, false).scene_settings()
}

fn sanitize(input: &Value, include_scenes: bool) -> Settings {
    let input = object(input);
    let get = |key: &str| input.get(key);
    let mut settings = Settings::default();

    if let Some(text) = string(get("cameraId")) {
        settings.camera_id = js::slice_utf16(text, 512);
    }
    if let Some(text) = string(get("cameraLabel")) {
        settings.camera_label = js::slice_utf16(text, 120);
    }
    if let Some(shape) = string(get("shape")).and_then(Shape::parse) {
        settings.shape = shape;
    }
    if let Some(size) = clamped(get("size"), CAMERA_SIZE_MIN, CAMERA_SIZE_MAX) {
        settings.size = size;
    }
    if let Some(resolution) = string(get("overlayResolution")).and_then(Resolution::parse) {
        settings.overlay_resolution = resolution;
    }
    if let Some(effect) = string(get("frameEffect")).and_then(FrameEffect::parse) {
        settings.frame_effect = effect;
    }
    if let Some(colour) = string(get("effectColor")).filter(|text| is_hex_colour(text)) {
        settings.effect_color = colour.to_string();
    }
    if let Some(value) = clamped(get("glowStrength"), 10, 100) {
        settings.glow_strength = value;
    }
    if let Some(value) = clamped(get("glowSpread"), 4, 18) {
        settings.glow_spread = value;
    }
    if let Some(value) = clamped(get("blurAmount"), 4, 18) {
        settings.blur_amount = value;
    }
    if let Some(value) = clamped(get("blurOpacity"), 10, 100) {
        settings.blur_opacity = value;
    }
    if let Some(value) = clamped(get("borderWidth"), 0, 12) {
        settings.border_width = value;
    }
    if let Some(colour) = string(get("borderColor")).filter(|text| is_hex_colour(text)) {
        settings.border_color = colour.to_string();
    }
    if let Some(Value::Bool(mirror)) = get("mirror") {
        settings.mirror = *mirror;
    }
    if let Some(zoom) = clamped(get("cameraZoom"), CAMERA_ZOOM_MIN, CAMERA_ZOOM_MAX) {
        settings.camera_zoom = zoom;
    }
    if js::truthy(get("cameraPosition")) {
        let position = get("cameraPosition").map(object).unwrap_or(&EMPTY);
        let tenth = |value: f64| js::round(js::clamp(value, 0.0, 100.0) * 10.0) / 10.0;
        if let Some(x) = js::finite(position.get("x")) {
            settings.camera_position.x = tenth(x);
        }
        if let Some(y) = js::finite(position.get("y")) {
            settings.camera_position.y = tenth(y);
        }
    }
    if let Some(Value::Bool(flag)) = get("alwaysOnTop") {
        settings.always_on_top = *flag;
    }
    if let Some(Value::Bool(flag)) = get("overlayVisible") {
        settings.overlay_visible = *flag;
    }
    match string(get("sceneView")) {
        Some("grid") => settings.scene_view = SceneView::Grid,
        Some("list") => settings.scene_view = SceneView::List,
        _ => {}
    }
    if let Some(Value::Bool(flag)) = get("prompterLink") {
        settings.prompter_link = *flag;
    }
    if let Some(face) = string(get("prompterFaceFull")).filter(|face| *face == "fullscreen" || is_scene_choice(face)) {
        settings.prompter_face_full = face.to_string();
    }
    if let Some(face) = string(get("prompterFaceSmall"))
        .filter(|face| *face == "previous" || Spot::parse(face).is_some() || is_scene_choice(face))
    {
        settings.prompter_face_small = face.to_string();
    }
    if let Some(margin) = clamped(get("prompterMargin"), PROMPTER_MARGIN_MIN, PROMPTER_MARGIN_MAX) {
        settings.prompter_margin = margin;
    }
    settings.prompter_small_size =
        clamped(get("prompterSmallSize"), CAMERA_SIZE_MIN, CAMERA_SIZE_MAX).unwrap_or(settings.size);
    settings.completed_onboarding_version = sanitize_completed_onboarding_version(get("completedOnboardingVersion"));
    if js::truthy(get("position")) {
        let position = get("position").map(object).unwrap_or(&EMPTY);
        if let (Some(x), Some(y)) = (js::integer(position.get("x")), js::integer(position.get("y"))) {
            settings.position = Some(Point { x, y });
        }
    }

    if include_scenes && let Some(Value::Array(scenes)) = get("presets") {
        settings.presets = scenes.iter().take(SCENE_LIMIT).filter_map(sanitize_scene).collect();
    }
    settings
}

fn sanitize_scene(input: &Value) -> Option<Scene> {
    let id = string(input.get("id")).map(|id| js::slice_utf16(id, 64)).unwrap_or_default();
    let name = string(input.get("name")).map(|name| js::slice_utf16(js::trim(name), 40)).unwrap_or_default();
    if id.is_empty() || name.is_empty() || !js::truthy(input.get("settings")) {
        return None;
    }
    let settings = scene_settings_from(input.get("settings").unwrap_or(&Value::Null));
    Some(Scene { id, name, settings, layout: input.get("layout").and_then(sanitize_scene_layout) })
}

/// `sanitizeSceneLayout`: anything invalid drops the layout, so the Scene stays an ordinary Scene.
pub fn sanitize_scene_layout(input: &Value) -> Option<SceneLayout> {
    let input = input.as_object()?;
    let size = match input.get("size") {
        Some(Value::String(text)) if text == "small" => LayoutSize::Small,
        value => {
            let size = js::integer(value)?;
            if size < i64::from(CAMERA_SIZE_MIN) || size > i64::from(CAMERA_SIZE_MAX) {
                return None;
            }
            LayoutSize::Pixels(size as u32)
        }
    };
    let mut layout = SceneLayout { size, position: None, margin: None, within_right: None };
    if let Some(position) = input.get("position") {
        layout.position = Some(string(Some(position)).and_then(Spot::parse)?);
    }
    if let Some(margin) = input.get("margin") {
        let margin = js::integer(Some(margin))?;
        if margin < i64::from(PROMPTER_MARGIN_MIN)
            || margin > i64::from(PROMPTER_MARGIN_MAX)
            || layout.position.is_none()
        {
            return None;
        }
        layout.margin = Some(margin as u32);
    }
    if let Some(share) = input.get("withinRight") {
        let share = js::finite(Some(share)).filter(|share| is_within_right_share(*share))?;
        if !layout.position.is_some_and(Spot::is_right) {
            return None;
        }
        layout.within_right = Some(share);
    }
    Some(layout)
}

pub fn is_within_right_share(value: f64) -> bool {
    value.is_finite() && (WITHIN_RIGHT_MIN..=WITHIN_RIGHT_MAX).contains(&value)
}

pub fn sanitize_completed_onboarding_version(value: Option<&Value>) -> u32 {
    clamped(value, 0, CURRENT_ONBOARDING_VERSION).unwrap_or(0)
}

/// The Scenes a new installation starts with (ADR 0037).
pub fn starter_scenes() -> Vec<Scene> {
    let starters = json!([
        {
            "id": "starter-small-bottom",
            "name": "Small bottom",
            "settings": { "size": 288 },
            "layout": { "size": 288, "position": "bottom-right" },
        },
        {
            "id": "starter-big-right",
            "name": "Big right",
            "settings": { "size": 540 },
            "layout": { "size": 540, "position": "right" },
        },
    ]);
    sanitize_settings(&json!({ "presets": starters })).presets
}

fn startup_settings(input: &Value) -> Settings {
    let mut settings = sanitize_settings(input);
    let schema = js::number_or_zero(object(input).get("schemaVersion"));
    if settings.presets.is_empty() && schema < STARTER_SCENES_SCHEMA {
        settings.presets = starter_scenes();
    }
    settings.always_on_top = true;
    settings.overlay_visible = true;
    settings
}

/// `preferencesFromDocument`: the raw `preferences.json` text (None when the file is missing) as
/// launch settings.
pub fn preferences_from_document(text: Option<&str>) -> Settings {
    let Some(saved) = text.and_then(|text| serde_json::from_str::<Value>(text).ok()) else {
        return startup_settings(&Value::Null);
    };
    let mut saved = match saved {
        Value::Object(map) => map,
        // A JSON array is an object to JavaScript: it loads like a document with no settings.
        Value::Array(_) => Map::new(),
        _ => return startup_settings(&Value::Null),
    };
    if js::number_or_zero(saved.get("schemaVersion")) < 3.0 {
        saved.insert("borderWidth".into(), json!(0));
        saved.insert("size".into(), json!(Settings::default().size));
    }
    // A file without the onboarding field was written before onboarding existed: count it as done.
    let onboarding = match saved.get("completedOnboardingVersion") {
        Some(value) => sanitize_completed_onboarding_version(Some(value)),
        None => CURRENT_ONBOARDING_VERSION,
    };
    saved.insert("completedOnboardingVersion".into(), json!(onboarding));
    startup_settings(&Value::Object(saved))
}

/// Whether a saved file had the retired Start at login switch on.
pub fn legacy_launch_at_login(text: &str) -> bool {
    serde_json::from_str::<Value>(text).is_ok_and(|value| value.get("launchAtLogin") == Some(&Value::Bool(true)))
}

/// The camera surface size for a shape and size: portrait is 3:4, landscape 16:9.
pub fn dimensions_for(shape: Shape, size: u32) -> (u32, u32) {
    let size_f = f64::from(size);
    match shape {
        Shape::Portrait => (js::round(size_f * 0.75) as u32, size),
        Shape::Landscape => (size, js::round(size_f * 0.5625) as u32),
        Shape::Circle | Shape::Rounded => (size, size),
    }
}

/// The transparent room around the camera surface: the hover toolbar sits in the top part.
#[derive(Debug, Clone, Copy)]
pub struct Chrome {
    pub top: u32,
    pub right: u32,
    pub bottom: u32,
    pub left: u32,
}

pub const OVERLAY_CHROME: Chrome = Chrome { top: 84, right: 18, bottom: 18, left: 18 };

/// The Compact window size for a shape and size.
pub fn overlay_dimensions_for(shape: Shape, size: u32) -> (u32, u32) {
    let (width, height) = dimensions_for(shape, size);
    (width + OVERLAY_CHROME.left + OVERLAY_CHROME.right, height + OVERLAY_CHROME.top + OVERLAY_CHROME.bottom)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn dimensions_follow_the_shape() {
        assert_eq!(dimensions_for(Shape::Portrait, 288), (216, 288));
        assert_eq!(dimensions_for(Shape::Landscape, 288), (288, 162));
        assert_eq!(overlay_dimensions_for(Shape::Circle, 288), (324, 390));
    }

    #[test]
    fn a_hand_resize_sets_the_small_size() {
        let settings = sanitize_settings(&json!({ "size": 300, "prompterSmallSize": 250 }));
        assert_eq!(settings.after_hand_resize(&json!({ "size": 360 })).prompter_small_size, 360);
        assert_eq!(settings.after_hand_resize(&json!({ "size": 300 })).prompter_small_size, 250);
        assert_eq!(settings.with_patch(&json!({ "size": 360 })).prompter_small_size, 250);
    }

    #[test]
    fn shape_cycles_through_all_four() {
        assert_eq!(Shape::Circle.next(), Shape::Rounded);
        assert_eq!(Shape::Landscape.next(), Shape::Circle);
    }
}
