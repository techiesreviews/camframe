//! The Overlay: port of `overlay.html/js/css` plus the window-owning parts of `main.js`.

use std::borrow::Cow;
use std::sync::Arc;
use std::time::{Duration, SystemTime, UNIX_EPOCH};

use gpui_kit::assets::IconName;
use gpui_kit::component::button::{Button, ButtonVariants};
use gpui_kit::component::input::{Input, InputEvent, InputState};
use gpui_kit::component::kbd::Kbd;
use gpui_kit::component::select::{Select, SelectEvent, SelectItem, SelectState};
use gpui_kit::component::slider::{Slider, SliderEvent, SliderState};
use gpui_kit::component::spinner::Spinner;
use gpui_kit::component::switch::Switch;
use gpui_kit::component::tab::{Tab, TabBar};
use gpui_kit::component::tooltip::Tooltip;
use gpui_kit::component::{Disableable, Icon, IndexPath, Selectable, Sizable};
use gpui_kit::prelude::*;
use gpui_kit::*;

use crate::camera::{self, CameraDevice, Capture, CaptureSlot, CaptureStatus, Halo, View, lock};
use crate::settings::{
    self, CHROME_SIDE, CHROME_TOP, Corner, FrameEffect, Resolution, Scene, Settings, Shape,
};
use crate::store;

const COMPACT_HIDE_DELAY: Duration = Duration::from_millis(220);
const FULLSCREEN_TOOLBAR_HIDE_DELAY: Duration = Duration::from_millis(200);
const NOTICE_LIFETIME: Duration = Duration::from_millis(1600);
const SAVE_DEBOUNCE: Duration = Duration::from_millis(120);
const TOOLBAR_TOP: f32 = 22.0;
const TOOLBAR_HEIGHT: f32 = 44.0;
const SETTINGS_TOP: f32 = 76.0;
const HANDLE_SIZE: f32 = 14.0;
const SWATCHES: [(&str, &str); 6] = [
    ("#fb923c", "Orange"),
    ("#22d3ee", "Cyan"),
    ("#8b5cf6", "Violet"),
    ("#ec4899", "Pink"),
    ("#22c55e", "Green"),
    ("#ffffff", "White"),
];

actions!(
    camframe,
    [ToggleFullscreen, Escape, NextScene, OpenControls, Scene1, Scene2, Scene3, Scene4, Scene5, Scene6]
);

pub fn bind_keys(cx: &mut App) {
    cx.bind_keys([
        KeyBinding::new("secondary-shift-f", ToggleFullscreen, None),
        KeyBinding::new("escape", Escape, Some("Overlay")),
        KeyBinding::new("secondary-shift-p", NextScene, None),
        KeyBinding::new("secondary-shift-c", OpenControls, None),
        KeyBinding::new("secondary-shift-1", Scene1, None),
        KeyBinding::new("secondary-shift-2", Scene2, None),
        KeyBinding::new("secondary-shift-3", Scene3, None),
        KeyBinding::new("secondary-shift-4", Scene4, None),
        KeyBinding::new("secondary-shift-5", Scene5, None),
        KeyBinding::new("secondary-shift-6", Scene6, None),
    ]);
}

// Toolbar icons beyond GPUI Kit's default component bundle.
gpui_kit::assets::icon_assets!(ToolbarIcons, [CircleX, Maximize, Minimize, Circle, Square, RectangleVertical, RectangleHorizontal, Crosshair, SlidersHorizontal]);

pub struct AppAssets;

impl AssetSource for AppAssets {
    fn load(&self, path: &str) -> Result<Option<Cow<'static, [u8]>>> {
        match ToolbarIcons.load(path)? {
            Some(bytes) => Ok(Some(bytes)),
            None => gpui_kit::assets::Assets.load(path),
        }
    }

    fn list(&self, path: &str) -> Result<Vec<SharedString>> {
        let mut paths = ToolbarIcons.list(path)?;
        paths.extend(gpui_kit::assets::Assets.list(path)?);
        Ok(paths)
    }
}

fn hex(color: u32) -> Hsla {
    rgb(color).into()
}

fn white(alpha: f32) -> Hsla {
    hsla(0.0, 0.0, 1.0, alpha)
}

fn parse_hex(value: &str) -> Hsla {
    u32::from_str_radix(value.trim_start_matches('#'), 16).map(hex).unwrap_or(hex(0xfb923c))
}

/// GNOME/KDE Wayland never report or accept global window positions.
fn positions_are_unavailable() -> bool {
    cfg!(any(target_os = "linux", target_os = "freebsd")) && std::env::var_os("WAYLAND_DISPLAY").is_some()
}

#[derive(Clone)]
struct Choice {
    value: SharedString,
    title: SharedString,
}

impl SelectItem for Choice {
    type Value = SharedString;

    fn title(&self) -> SharedString {
        self.title.clone()
    }

    fn value(&self) -> &SharedString {
        &self.value
    }
}

type ChoiceSelect = Entity<SelectState<Vec<Choice>>>;

/// Writes one slider's value into the settings document.
type SettingWriter = fn(&mut Settings, u32);

#[derive(Clone, Copy, PartialEq, Eq)]
enum SettingsTab {
    Camera,
    Style,
    Scenes,
}

enum CameraState {
    Starting,
    Live(SharedString),
    Failed(&'static str),
}

enum Drag {
    Resize { corner: Corner, start: Point<Pixels>, size: u32 },
    Pan { start: Point<Pixels>, position: settings::CameraPosition },
}

struct Controls {
    camera: ChoiceSelect,
    resolution: ChoiceSelect,
    effect: ChoiceSelect,
    scene: ChoiceSelect,
    glow_strength: Entity<SliderState>,
    glow_spread: Entity<SliderState>,
    blur_amount: Entity<SliderState>,
    blur_opacity: Entity<SliderState>,
    frame_width: Entity<SliderState>,
    effect_color: Entity<InputState>,
    scene_name: Entity<InputState>,
}

pub struct Overlay {
    settings: Settings,
    active_scene: Option<String>,
    selected_scene: Option<String>,
    scene_message: Option<SharedString>,
    devices: Vec<CameraDevice>,
    capture: Option<Capture>,
    slot: Arc<CaptureSlot>,
    wake: async_channel::Sender<()>,
    frame: Option<Arc<RenderImage>>,
    halo: Option<Arc<RenderImage>>,
    camera_state: CameraState,
    hovered: bool,
    toolbar_visible: bool,
    settings_open: bool,
    settings_tab: SettingsTab,
    framing: bool,
    fullscreen: bool,
    drag: Option<Drag>,
    notice: Option<SharedString>,
    input_region: Option<Vec<Bounds<Pixels>>>,
    focus: FocusHandle,
    controls: Controls,
    hide_task: Option<Task<()>>,
    notice_task: Option<Task<()>>,
    save_task: Option<Task<()>>,
    _subscriptions: Vec<Subscription>,
}

pub fn open(settings: Settings, cx: &mut App) -> Result<()> {
    let (width, height) = settings::overlay_dimensions(settings.scene.shape, settings.scene.size);
    let size = size(px(width), px(height));
    let bounds = match settings.scene.position {
        Some(position) if !positions_are_unavailable() => {
            Bounds::new(point(px(position.x as f32), px(position.y as f32)), size)
        }
        _ => Bounds::centered(None, size, cx),
    };
    let options = WindowOptions {
        window_bounds: Some(WindowBounds::Windowed(bounds)),
        titlebar: None,
        focus: false,
        show: true,
        // PopUp is topmost and taskbar-free on Windows and a floating panel on macOS.
        kind: WindowKind::PopUp,
        is_movable: true,
        app_owns_titlebar_drag: true,
        is_resizable: false,
        is_minimizable: false,
        // Keep the camera painting while another application is focused.
        inactive_frame_interval: None,
        window_background: WindowBackgroundAppearance::Transparent,
        app_id: Some("camframe".into()),
        window_decorations: Some(WindowDecorations::Client),
        ..WindowOptions::default()
    };
    gpui_kit::open_window(options, cx, |window, cx| cx.new(|cx| Overlay::new(settings, window, cx)))?;
    Ok(())
}

fn choices(items: impl IntoIterator<Item = (String, String)>) -> Vec<Choice> {
    items
        .into_iter()
        .map(|(value, title)| Choice { value: value.into(), title: title.into() })
        .collect()
}

fn select_state(items: Vec<Choice>, selected: &str, window: &mut Window, cx: &mut Context<Overlay>) -> ChoiceSelect {
    let index = items.iter().position(|item| item.value.as_ref() == selected).map(IndexPath::new);
    cx.new(|cx| SelectState::new(items, index, window, cx))
}

fn slider(min: f32, max: f32, value: u32, cx: &mut Context<Overlay>) -> Entity<SliderState> {
    cx.new(|_| SliderState::new().min(min).max(max).step(1.0).default_value(value as f32))
}

impl Overlay {
    fn new(settings: Settings, window: &mut Window, cx: &mut Context<Self>) -> Self {
        let scene = &settings.scene;
        let controls = Controls {
            camera: select_state(
                choices([(scene.camera_id.clone(), scene.camera_label.clone())]),
                &scene.camera_id,
                window,
                cx,
            ),
            resolution: select_state(
                choices(Resolution::ALL.map(|r| (r.token().into(), r.label().into()))),
                scene.overlay_resolution.token(),
                window,
                cx,
            ),
            effect: select_state(
                choices(FrameEffect::ALL.map(|e| (e.token().into(), e.label().into()))),
                scene.frame_effect.token(),
                window,
                cx,
            ),
            scene: select_state(Self::scene_choices(&settings.scenes), "", window, cx),
            glow_strength: slider(10.0, 100.0, scene.glow_strength, cx),
            glow_spread: slider(4.0, 18.0, scene.glow_spread, cx),
            blur_amount: slider(4.0, 18.0, scene.blur_amount, cx),
            blur_opacity: slider(10.0, 100.0, scene.blur_opacity, cx),
            frame_width: slider(0.0, 12.0, scene.border_width, cx),
            effect_color: cx.new(|cx| {
                InputState::new(window, cx).default_value(scene.effect_color.to_uppercase())
            }),
            scene_name: cx.new(|cx| InputState::new(window, cx).placeholder("Scene name")),
        };

        let mut subscriptions = vec![
            cx.subscribe_in(&controls.camera, window, |this, _, event: &SelectEvent<Vec<Choice>>, window, cx| {
                let SelectEvent::Confirm(Some(id)) = event else { return };
                let label = this
                    .devices
                    .iter()
                    .find(|device| device.id == id.as_ref())
                    .map(|device| device.label.clone())
                    .unwrap_or_else(|| "Default camera".into());
                let id = id.to_string();
                this.update(window, cx, |settings| {
                    settings.scene.camera_id = id;
                    settings.scene.camera_label = label;
                });
            }),
            cx.subscribe_in(&controls.resolution, window, |this, _, event: &SelectEvent<Vec<Choice>>, window, cx| {
                let SelectEvent::Confirm(Some(token)) = event else { return };
                if let Some(resolution) = Resolution::ALL.into_iter().find(|r| r.token() == token.as_ref()) {
                    this.update(window, cx, |settings| settings.scene.overlay_resolution = resolution);
                }
            }),
            cx.subscribe_in(&controls.effect, window, |this, _, event: &SelectEvent<Vec<Choice>>, window, cx| {
                let SelectEvent::Confirm(Some(token)) = event else { return };
                if let Some(effect) = FrameEffect::ALL.into_iter().find(|e| e.token() == token.as_ref()) {
                    this.update(window, cx, |settings| settings.scene.frame_effect = effect);
                }
            }),
            cx.subscribe_in(&controls.scene, window, |this, _, event: &SelectEvent<Vec<Choice>>, window, cx| {
                let SelectEvent::Confirm(Some(id)) = event else { return };
                this.apply_scene(id.as_ref(), window, cx);
            }),
            cx.subscribe_in(&controls.effect_color, window, |this, state, event: &InputEvent, window, cx| {
                if !matches!(event, InputEvent::Change) {
                    return;
                }
                let value = state.read(cx).value().to_lowercase();
                if settings::is_hex_color(&value) && value != this.settings.scene.effect_color.to_lowercase() {
                    this.update(window, cx, |settings| settings.scene.effect_color = value);
                }
            }),
            cx.subscribe(&controls.scene_name, |_, _, _: &InputEvent, cx| cx.notify()),
        ];
        let sliders: [(&Entity<SliderState>, SettingWriter); 5] = [
            (&controls.glow_strength, |s, v| s.scene.glow_strength = v),
            (&controls.glow_spread, |s, v| s.scene.glow_spread = v),
            (&controls.blur_amount, |s, v| s.scene.blur_amount = v),
            (&controls.blur_opacity, |s, v| s.scene.blur_opacity = v),
            (&controls.frame_width, |s, v| s.scene.border_width = v),
        ];
        for (state, apply) in sliders {
            subscriptions.push(cx.subscribe_in(state, window, move |this, _, event: &SliderEvent, window, cx| {
                let (SliderEvent::Change(value) | SliderEvent::Release(value)) = event;
                let value = value.start().round() as u32;
                this.update(window, cx, |settings| apply(settings, value));
            }));
        }
        subscriptions.push(cx.observe_window_bounds(window, |this, window, cx| {
            if this.fullscreen || positions_are_unavailable() {
                return;
            }
            let origin = window.bounds().origin;
            let position = settings::ScreenPosition { x: origin.x.as_f32() as i32, y: origin.y.as_f32() as i32 };
            if this.settings.scene.position != Some(position) {
                this.settings.scene.position = Some(position);
                this.schedule_save(cx);
            }
        }));

        // Capture threads wake the UI through a one-slot channel; frames never queue.
        let (wake, frames) = async_channel::bounded::<()>(1);
        cx.spawn_in(window, async move |this, cx| {
            while frames.recv().await.is_ok() {
                if this.update_in(cx, |this, window, cx| this.pull_capture(window, cx)).is_err() {
                    break;
                }
            }
        })
        .detach();

        let focus = cx.focus_handle();
        window.focus(&focus, cx);

        let mut overlay = Self {
            settings,
            active_scene: None,
            selected_scene: None,
            scene_message: None,
            devices: Vec::new(),
            capture: None,
            slot: Arc::default(),
            wake,
            frame: None,
            halo: None,
            camera_state: CameraState::Starting,
            hovered: false,
            toolbar_visible: false,
            settings_open: false,
            settings_tab: SettingsTab::Camera,
            framing: false,
            fullscreen: false,
            drag: None,
            notice: None,
            input_region: None,
            focus,
            controls,
            hide_task: None,
            notice_task: None,
            save_task: None,
            _subscriptions: subscriptions,
        };
        overlay.refresh_devices(true, window, cx);
        overlay
    }

    // MARK: State

    /// The single settings mutation path: sanitize the whole document, then apply effects.
    fn update(&mut self, window: &mut Window, cx: &mut Context<Self>, change: impl FnOnce(&mut Settings)) {
        let before = self.settings.clone();
        change(&mut self.settings);
        self.settings = settings::resanitize(&self.settings);
        self.active_scene = None;
        self.after_change(&before, window, cx);
    }

    fn after_change(&mut self, before: &Settings, window: &mut Window, cx: &mut Context<Self>) {
        let (now, then) = (&self.settings.scene, &before.scene);
        if !self.fullscreen && (now.shape != then.shape || now.size != then.size) {
            let (width, height) = settings::overlay_dimensions(now.shape, now.size);
            window.resize(size(px(width), px(height)));
        }
        if now.camera_id != then.camera_id || now.overlay_resolution != then.overlay_resolution {
            self.restart_camera(window, cx);
        }
        self.sync_controls(window, cx);
        self.schedule_save(cx);
        cx.notify();
    }

    /// Reflects settings changed elsewhere (Scenes, shortcuts) in the kit controls.
    fn sync_controls(&mut self, window: &mut Window, cx: &mut Context<Self>) {
        let scene = self.settings.scene.clone();
        let controls = &self.controls;
        let select = |state: &ChoiceSelect, value: &str, window: &mut Window, cx: &mut Context<Self>| {
            let value = SharedString::from(value.to_string());
            state.update(cx, |state, cx| state.set_selected_value(&value, window, cx));
        };
        select(&controls.camera, &scene.camera_id, window, cx);
        select(&controls.resolution, scene.overlay_resolution.token(), window, cx);
        select(&controls.effect, scene.frame_effect.token(), window, cx);
        for (state, value) in [
            (&controls.glow_strength, scene.glow_strength),
            (&controls.glow_spread, scene.glow_spread),
            (&controls.blur_amount, scene.blur_amount),
            (&controls.blur_opacity, scene.blur_opacity),
            (&controls.frame_width, scene.border_width),
        ] {
            if state.read(cx).value().start().round() as u32 != value {
                state.update(cx, |state, cx| state.set_value(value as f32, window, cx));
            }
        }
        let color = scene.effect_color.to_uppercase();
        if controls.effect_color.read(cx).value().to_uppercase() != color {
            controls.effect_color.update(cx, |state, cx| state.set_value(color, window, cx));
        }
    }

    fn schedule_save(&mut self, cx: &mut Context<Self>) {
        self.save_task = Some(cx.spawn(async move |this, cx| {
            cx.background_executor().timer(SAVE_DEBOUNCE).await;
            let _ = this.update(cx, |this, _| this.save_now());
        }));
    }

    fn save_now(&mut self) {
        self.save_task = None;
        if let Err(error) = store::save(&self.settings) {
            eprintln!("CamFrame could not save preferences: {error:#}");
        }
    }

    fn quit(&mut self, cx: &mut Context<Self>) {
        self.save_now();
        self.capture = None;
        cx.quit();
    }

    // MARK: Camera

    fn refresh_devices(&mut self, start: bool, window: &mut Window, cx: &mut Context<Self>) {
        let enumerate = cx.background_executor().spawn(async { camera::list_devices() });
        cx.spawn_in(window, async move |this, cx| {
            let devices = enumerate.await;
            let _ = this.update_in(cx, |this, window, cx| {
                this.devices = devices;
                let items = if this.devices.is_empty() {
                    choices([(String::new(), "No cameras found".to_string())])
                } else {
                    choices(this.devices.iter().map(|device| (device.id.clone(), device.label.clone())))
                };
                let selected = SharedString::from(this.settings.scene.camera_id.clone());
                this.controls.camera.update(cx, |state, cx| {
                    state.set_items(items, window, cx);
                    state.set_selected_value(&selected, window, cx);
                });
                if start {
                    this.restart_camera(window, cx);
                }
                cx.notify();
            });
        })
        .detach();
    }

    fn restart_camera(&mut self, window: &mut Window, cx: &mut Context<Self>) {
        let wanted = &self.settings.scene.camera_id;
        let device = self.devices.iter().find(|device| &device.id == wanted).cloned();
        if device.is_none() && !wanted.is_empty() {
            // The saved camera is gone: clear the selection and retry the default camera.
            self.settings.scene.camera_id.clear();
            self.settings.scene.camera_label = "Default camera".into();
            self.schedule_save(cx);
        }
        self.camera_state = CameraState::Starting;
        // Never present the previous camera's last frame as the new one.
        for image in [self.frame.take(), self.halo.take()].into_iter().flatten() {
            let _ = window.drop_image(image);
        }
        // A fresh slot per capture discards anything the previous thread still publishes.
        self.slot = Arc::default();
        let wake = self.wake.clone();
        let started = camera::start(
            self.capture.take(),
            device,
            self.settings.scene.overlay_resolution,
            self.slot.clone(),
            move || {
                let _ = wake.try_send(());
            },
        );
        match started {
            Ok(capture) => self.capture = Some(capture),
            Err(error) => {
                eprintln!("CamFrame could not start the capture thread: {error}");
                self.camera_state = CameraState::Failed(camera::CaptureError::Failed.message());
            }
        }
        cx.notify();
    }

    fn pull_capture(&mut self, window: &mut Window, cx: &mut Context<Self>) {
        let status = lock(&self.slot.status).take();
        if let Some(status) = status {
            self.camera_state = match status {
                CaptureStatus::Live(format) => CameraState::Live(
                    format!("{}×{} · {} fps · {}", format.width(), format.height(), format.frame_rate(), format.format()).into(),
                ),
                CaptureStatus::Failed(error) => CameraState::Failed(error.message()),
            };
        }
        let frame = lock(&self.slot.frame).take();
        let Some((frame, halo)) = frame else {
            cx.notify();
            return;
        };
        let image = |frame: camera::Frame| {
            let buffer = image::RgbaImage::from_raw(frame.width, frame.height, frame.bgra)?;
            Some(Arc::new(RenderImage::new(vec![image::Frame::new(buffer)])))
        };
        for (slot, next) in [(&mut self.frame, image(frame)), (&mut self.halo, halo.and_then(image))] {
            if let Some(previous) = std::mem::replace(slot, next) {
                let _ = window.drop_image(previous);
            }
        }
        cx.notify();
    }

    // MARK: Scenes

    fn scene_choices(scenes: &[Scene]) -> Vec<Choice> {
        choices(scenes.iter().enumerate().map(|(index, scene)| (scene.id.clone(), format!("{}. {}", index + 1, scene.name))))
    }

    fn sync_scene_choices(&mut self, window: &mut Window, cx: &mut Context<Self>) {
        let items = Self::scene_choices(&self.settings.scenes);
        let selected = self.selected_scene.clone().map(SharedString::from);
        self.controls.scene.update(cx, |state, cx| {
            state.set_items(items, window, cx);
            match selected {
                Some(id) => state.set_selected_value(&id, window, cx),
                None => state.set_selected_index(None, window, cx),
            }
        });
    }

    fn apply_scene(&mut self, id: &str, window: &mut Window, cx: &mut Context<Self>) {
        let Some(scene) = self.settings.scenes.iter().find(|scene| scene.id == id).cloned() else {
            return;
        };
        let before = self.settings.clone();
        // Screen position is captured but cannot be applied: GPUI has no window-move API.
        let position = self.settings.scene.position;
        self.settings.scene = scene.settings.clone();
        self.settings.scene.position = position;
        self.active_scene = Some(scene.id.clone());
        self.selected_scene = Some(scene.id.clone());
        self.settings_open = false;
        self.after_change(&before, window, cx);
        self.sync_scene_choices(window, cx);
        self.show_notice(scene.name, cx);
    }

    fn apply_scene_at(&mut self, index: usize, window: &mut Window, cx: &mut Context<Self>) {
        if let Some(id) = self.settings.scenes.get(index).map(|scene| scene.id.clone()) {
            self.apply_scene(&id, window, cx);
        }
    }

    fn next_scene(&mut self, window: &mut Window, cx: &mut Context<Self>) {
        let scenes = &self.settings.scenes;
        if scenes.is_empty() {
            return;
        }
        let current = self.active_scene.as_ref().and_then(|id| scenes.iter().position(|scene| &scene.id == id));
        let next = current.map_or(0, |index| (index + 1) % scenes.len());
        self.apply_scene_at(next, window, cx);
    }

    fn save_scene(&mut self, window: &mut Window, cx: &mut Context<Self>) {
        let name = self.controls.scene_name.read(cx).value().trim().to_string();
        if name.is_empty() {
            return;
        }
        let now = SystemTime::now().duration_since(UNIX_EPOCH).unwrap_or_default().as_millis();
        let (scenes, id) = settings::save_scene(
            &self.settings.scenes,
            &name,
            self.selected_scene.as_deref(),
            self.settings.scene.clone(),
            settings::new_scene_id(now),
        );
        self.settings.scenes = scenes;
        self.active_scene = Some(id.clone());
        self.selected_scene = Some(id);
        self.settings_open = false;
        self.sync_scene_choices(window, cx);
        self.schedule_save(cx);
        self.show_notice(name, cx);
    }

    fn change_scenes(&mut self, scenes: Vec<Scene>, window: &mut Window, cx: &mut Context<Self>) {
        self.settings.scenes = scenes;
        if !self.settings.scenes.iter().any(|scene| Some(&scene.id) == self.selected_scene.as_ref()) {
            self.selected_scene = None;
        }
        self.sync_scene_choices(window, cx);
        self.schedule_save(cx);
        cx.notify();
    }

    fn export_scenes(&mut self, cx: &mut Context<Self>) {
        let Ok(document) = settings::scenes_export_document(&self.settings.scenes) else {
            return;
        };
        let count = self.settings.scenes.len();
        let directory = dirs::document_dir().or_else(dirs::home_dir).unwrap_or_default();
        let path = cx.prompt_for_new_path(&directory, Some("camframe-scenes.json"));
        cx.spawn(async move |this, cx| {
            let message = match path.await {
                Ok(Ok(Some(path))) => match std::fs::write(path, document) {
                    Ok(()) => format!("Exported {count} scene{}.", if count == 1 { "" } else { "s" }),
                    Err(_) => "Scenes could not be exported.".into(),
                },
                _ => return,
            };
            let _ = this.update(cx, |this, cx| {
                this.scene_message = Some(message.into());
                cx.notify();
            });
        })
        .detach();
    }

    fn import_scenes(&mut self, window: &mut Window, cx: &mut Context<Self>) {
        let paths = cx.prompt_for_paths(PathPromptOptions {
            files: true,
            directories: false,
            multiple: false,
            prompt: Some("Import".into()),
        });
        cx.spawn_in(window, async move |this, cx| {
            let Ok(Ok(Some(paths))) = paths.await else { return };
            let Some(path) = paths.into_iter().next() else { return };
            let imported = std::fs::read_to_string(path)
                .ok()
                .and_then(|text| serde_json::from_str(&text).ok())
                .map(|document| settings::scenes_from_import(&document));
            let _ = this.update_in(cx, |this, window, cx| {
                this.scene_message = Some(match imported {
                    Some(scenes) if !scenes.is_empty() => {
                        let count = scenes.len();
                        let merged = settings::merge_scenes(&this.settings.scenes, &scenes);
                        this.change_scenes(merged, window, cx);
                        format!("Imported {count} scene{}.", if count == 1 { "" } else { "s" }).into()
                    }
                    _ => "That file does not contain CamFrame scenes.".into(),
                });
                cx.notify();
            });
        })
        .detach();
    }

    // MARK: Presentation

    fn show_notice(&mut self, message: String, cx: &mut Context<Self>) {
        self.notice = Some(message.chars().take(80).collect::<String>().into());
        self.notice_task = Some(cx.spawn(async move |this, cx| {
            cx.background_executor().timer(NOTICE_LIFETIME).await;
            let _ = this.update(cx, |this, cx| {
                this.notice = None;
                cx.notify();
            });
        }));
        cx.notify();
    }

    fn toggle_fullscreen(&mut self, window: &mut Window, cx: &mut Context<Self>) {
        self.settings_open = false;
        self.framing = false;
        self.drag = None;
        window.activate_window();
        window.toggle_fullscreen();
        cx.notify();
    }

    fn on_fullscreen_changed(&mut self, fullscreen: bool, window: &mut Window, cx: &mut Context<Self>) {
        self.fullscreen = fullscreen;
        if fullscreen {
            window.focus(&self.focus, cx);
            self.toolbar_visible = true;
            self.schedule_toolbar_hide(FULLSCREEN_TOOLBAR_HIDE_DELAY, cx);
        } else {
            // Native fullscreen restores the compact bounds; reassert them in case it did not.
            let (width, height) = settings::overlay_dimensions(self.settings.scene.shape, self.settings.scene.size);
            window.resize(size(px(width), px(height)));
        }
    }

    fn schedule_toolbar_hide(&mut self, delay: Duration, cx: &mut Context<Self>) {
        self.hide_task = Some(cx.spawn(async move |this, cx| {
            cx.background_executor().timer(delay).await;
            let _ = this.update(cx, |this, cx| {
                if !this.keeps_toolbar() {
                    this.toolbar_visible = false;
                    cx.notify();
                }
            });
        }));
    }

    fn keeps_toolbar(&self) -> bool {
        self.settings_open || self.framing || self.drag.is_some() || (!self.fullscreen && self.hovered)
    }

    fn set_hovered(&mut self, hovered: bool, cx: &mut Context<Self>) {
        self.hovered = hovered;
        if self.fullscreen {
            return;
        }
        if hovered {
            self.hide_task = None;
            self.toolbar_visible = true;
        } else {
            self.schedule_toolbar_hide(COMPACT_HIDE_DELAY, cx);
        }
        cx.notify();
    }

    fn escape(&mut self, window: &mut Window, cx: &mut Context<Self>) {
        if self.framing {
            self.framing = false;
        } else if self.settings_open {
            self.settings_open = false;
        } else if self.fullscreen {
            self.toggle_fullscreen(window, cx);
        }
        cx.notify();
    }

    // MARK: Pointer

    fn surface_bounds(&self, window: &Window) -> Bounds<Pixels> {
        if self.fullscreen {
            return Bounds::new(Point::default(), window.viewport_size());
        }
        let (width, height) = settings::camera_dimensions(self.settings.scene.shape, self.settings.scene.size);
        Bounds::new(point(px(CHROME_SIDE), px(CHROME_TOP)), size(px(width), px(height)))
    }

    fn toolbar_bounds(&self, surface: Bounds<Pixels>) -> Bounds<Pixels> {
        let limit = if self.framing { 240.0 } else { 196.0 };
        let width = (surface.size.width.as_f32() - 8.0).min(limit);
        let left = surface.origin.x.as_f32() + (surface.size.width.as_f32() - width) / 2.0;
        Bounds::new(point(px(left), px(TOOLBAR_TOP)), size(px(width), px(TOOLBAR_HEIGHT)))
    }

    fn drag_moved(&mut self, position: Point<Pixels>, window: &mut Window, cx: &mut Context<Self>) {
        match self.drag {
            Some(Drag::Resize { corner, start, size: start_size }) => {
                let delta = ((position.x - start.x).as_f32(), (position.y - start.y).as_f32());
                // GPUI can only resize from the window origin, so every corner grows toward
                // the bottom right; the opposite-corner anchor is not reproduced.
                let (next, _) = settings::resize_from_corner(self.settings.scene.shape, start_size, corner, delta);
                if next != self.settings.scene.size {
                    self.update(window, cx, |settings| settings.scene.size = next);
                }
            }
            Some(Drag::Pan { start, position: start_position }) => {
                let surface = self.surface_bounds(window).size;
                let scene = &self.settings.scene;
                let next = settings::camera_position_after_drag(
                    start_position,
                    ((position.x - start.x).as_f32(), (position.y - start.y).as_f32()),
                    (surface.width.as_f32(), surface.height.as_f32()),
                    scene.mirror,
                    scene.camera_zoom,
                );
                if next != scene.camera_position {
                    self.settings.scene.camera_position = next;
                    cx.notify();
                }
            }
            None => {}
        }
    }

    fn drag_ended(&mut self, cx: &mut Context<Self>) {
        if let Some(Drag::Pan { .. }) = self.drag.take() {
            self.active_scene = None;
        }
        self.schedule_save(cx);
        cx.notify();
    }

    fn update_input_region(&mut self, window: &mut Window, surface: Bounds<Pixels>) {
        // Transparent chrome passes clicks through until the Overlay is interactive.
        let region = if self.fullscreen || self.hovered || self.keeps_toolbar() {
            None
        } else {
            Some(vec![surface.dilate(px(3.0))])
        };
        if region != self.input_region {
            window.set_input_region(region.as_deref());
            self.input_region = region;
        }
    }

    // MARK: Rendering

    fn render_effect(&self, surface: Bounds<Pixels>, radius: Pixels) -> Option<AnyElement> {
        let scene = &self.settings.scene;
        let placed = |element: Div, bounds: Bounds<Pixels>| {
            element.absolute().left(bounds.origin.x).top(bounds.origin.y).w(bounds.size.width).h(bounds.size.height)
        };
        match scene.frame_effect {
            FrameEffect::None => None,
            FrameEffect::Glow => {
                let color = parse_hex(&scene.effect_color);
                let spread = scene.glow_spread as f32;
                let shadow = |blur: f32, alpha: f32| BoxShadow {
                    color: color.opacity(alpha),
                    offset: Point::default(),
                    blur_radius: px(blur),
                    spread_radius: px(0.0),
                    inset: false,
                };
                Some(
                    placed(div(), surface)
                        .rounded(radius)
                        .bg(color)
                        .opacity(scene.glow_strength as f32 / 100.0)
                        .shadow(vec![shadow((spread * 0.4).max(1.0) * 2.0, 0.88), shadow(spread * 2.0, 0.58)])
                        .into_any_element(),
                )
            }
            FrameEffect::Blur => {
                let halo = self.halo.clone()?;
                let content_width = halo.size(0).width.0 as f32 - camera::HALO_MARGIN as f32 * 2.0;
                let margin = surface.size.width.as_f32() / content_width.max(1.0) * camera::HALO_MARGIN as f32;
                Some(
                    placed(div(), surface.dilate(px(margin)))
                        .opacity(scene.blur_opacity as f32 / 100.0)
                        .child(img(ImageSource::Render(halo)).size_full().object_fit(ObjectFit::Fill))
                        .into_any_element(),
                )
            }
        }
    }

    fn render_camera(&self, surface: Bounds<Pixels>, radius: Pixels, cx: &mut Context<Self>) -> impl IntoElement {
        let scene = &self.settings.scene;
        let border = if self.fullscreen { 0 } else { scene.border_width };
        let state = match self.camera_state {
            CameraState::Live(_) if self.frame.is_some() => None,
            CameraState::Failed(message) => Some((false, message)),
            _ => Some((true, "Starting camera.")),
        };
        div()
            .id("camera-surface")
            .absolute()
            .left(surface.origin.x)
            .top(surface.origin.y)
            .w(surface.size.width)
            .h(surface.size.height)
            .rounded(radius)
            .bg(hex(0x18181b))
            .when(self.framing, |this| this.cursor_move())
            .when(!self.framing && !self.fullscreen, |this| this.cursor_grab())
            .when_some(self.frame.clone(), |this, frame| {
                this.child(img(ImageSource::Render(frame)).size_full().rounded(radius).object_fit(ObjectFit::Cover))
            })
            .when(border > 0, |this| {
                this.child(div().absolute().inset_0().rounded(radius).border(px(border as f32)).border_color(parse_hex(&scene.border_color)))
            })
            .when_some(state, |this, (busy, message)| {
                this.child(
                    div()
                        .absolute()
                        .inset_0()
                        .rounded(radius)
                        .bg(hex(0x18181b))
                        .flex()
                        .flex_col()
                        .items_center()
                        .justify_center()
                        .gap_2()
                        .p_4()
                        .text_size(px(13.0))
                        .text_color(white(1.0))
                        .text_center()
                        .when(busy, |this| this.child(Spinner::new().small()))
                        .child(message),
                )
            })
            .on_mouse_down(
                MouseButton::Left,
                cx.listener(|this, event: &MouseDownEvent, window, cx| {
                    cx.stop_propagation();
                    if this.framing {
                        if event.click_count >= 2 {
                            this.update(window, cx, |settings| {
                                settings.scene.camera_zoom = 100;
                                settings.scene.camera_position = settings::CameraPosition::default();
                            });
                        } else {
                            let position = this.settings.scene.camera_position;
                            this.drag = Some(Drag::Pan { start: event.position, position });
                        }
                    } else if !this.fullscreen {
                        window.start_window_move();
                    }
                }),
            )
            .on_scroll_wheel(cx.listener(|this, event: &ScrollWheelEvent, window, cx| {
                if !this.framing {
                    return;
                }
                let delta = event.delta.pixel_delta(px(16.0)).y.as_f32();
                // DOM wheel deltas are positive when scrolling down; GPUI's are the reverse.
                let zoom = settings::camera_zoom_after_wheel(this.settings.scene.camera_zoom, -delta);
                if zoom != this.settings.scene.camera_zoom {
                    this.update(window, cx, |settings| settings.scene.camera_zoom = zoom);
                }
            }))
    }

    fn render_handles(&self, surface: Bounds<Pixels>, cx: &mut Context<Self>) -> impl IntoElement {
        let visible = !self.fullscreen && !self.framing && (self.toolbar_visible || matches!(self.drag, Some(Drag::Resize { .. })));
        div().when(visible, |this| {
            this.children(Corner::ALL.map(|corner| {
                let x = if corner.is_left() { surface.left() } else { surface.right() };
                let y = if corner.is_top() { surface.top() } else { surface.bottom() };
                div()
                    .id(match corner {
                        Corner::TopLeft => "resize-top-left",
                        Corner::TopRight => "resize-top-right",
                        Corner::BottomLeft => "resize-bottom-left",
                        Corner::BottomRight => "resize-bottom-right",
                    })
                    .absolute()
                    .left(x - px(HANDLE_SIZE / 2.0))
                    .top(y - px(HANDLE_SIZE / 2.0))
                    .size(px(HANDLE_SIZE))
                    .rounded(px(3.0))
                    .bg(hex(0x18181b))
                    .border_2()
                    .border_color(white(0.92))
                    .map(|this| match corner {
                        Corner::TopLeft | Corner::BottomRight => this.cursor_nwse_resize(),
                        Corner::TopRight | Corner::BottomLeft => this.cursor_nesw_resize(),
                    })
                    .on_mouse_down(
                        MouseButton::Left,
                        cx.listener(move |this, event: &MouseDownEvent, _, cx| {
                            cx.stop_propagation();
                            this.drag = Some(Drag::Resize { corner, start: event.position, size: this.settings.scene.size });
                            cx.notify();
                        }),
                    )
            }))
        })
    }

    fn toolbar_button(&self, id: &'static str, icon: IconName, label: &'static str) -> Button {
        Button::new(id)
            .ghost()
            .icon(Icon::new(icon).size(px(20.0)))
            .tooltip(label)
            .accessibility_label(label)
            .w(px(36.0))
            .h(px(36.0))
            .rounded(px(8.0))
    }

    fn render_toolbar(&self, surface: Bounds<Pixels>, cx: &mut Context<Self>) -> impl IntoElement {
        let bounds = self.toolbar_bounds(surface);
        let shape_icon = match self.settings.scene.shape {
            Shape::Circle => IconName::Circle,
            Shape::Rounded => IconName::Square,
            Shape::Portrait => IconName::RectangleVertical,
            Shape::Landscape => IconName::RectangleHorizontal,
        };
        let framing = self
            .toolbar_button("frame", IconName::Crosshair, "Frame camera: drag to pan, scroll to zoom")
            .selected(self.framing)
            .on_click(cx.listener(|this, _, _, cx| {
                this.framing = !this.framing;
                this.settings_open = false;
                cx.notify();
            }));
        div()
            .id("toolbar")
            .absolute()
            .left(bounds.origin.x)
            .top(bounds.origin.y)
            .w(bounds.size.width)
            .h(bounds.size.height)
            .p_1()
            .gap(px(2.0))
            .flex()
            .items_center()
            .rounded(px(10.0))
            .bg(hex(0x0c0c0d))
            .text_color(hex(0xa1a1aa))
            .map(|this| {
                if self.framing {
                    this.gap_2().pr(px(10.0)).child(framing).child(
                        div()
                            .flex()
                            .flex_col()
                            .min_w_0()
                            .child(
                                div()
                                    .text_size(px(11.0))
                                    .font_weight(FontWeight::SEMIBOLD)
                                    .text_color(hex(0xf4f4f5))
                                    .child(format!("Zoom {}%", self.settings.scene.camera_zoom)),
                            )
                            .child(div().text_size(px(9.0)).truncate().child("Drag · Scroll · Double-click resets")),
                    )
                } else {
                    this.justify_center()
                        .child(
                            self.toolbar_button("quit", IconName::CircleX, "Close CamFrame")
                                .on_click(cx.listener(|this, _, _, cx| this.quit(cx))),
                        )
                        .child(
                            self.toolbar_button(
                                "fullscreen",
                                if self.fullscreen { IconName::Minimize } else { IconName::Maximize },
                                if self.fullscreen { "Exit full screen" } else { "Enter full screen" },
                            )
                            .on_click(cx.listener(|this, _, window, cx| this.toggle_fullscreen(window, cx))),
                        )
                        .child(
                            self.toolbar_button("shape", shape_icon, "Change camera shape")
                                .on_click(cx.listener(|this, _, window, cx| {
                                    let next = this.settings.scene.shape.next();
                                    this.update(window, cx, |settings| settings.scene.shape = next);
                                })),
                        )
                        .child(framing)
                        .child(
                            self.toolbar_button("controls", IconName::SlidersHorizontal, "Open camera controls")
                                .selected(self.settings_open)
                                .on_click(cx.listener(|this, _, window, cx| {
                                    this.settings_open = !this.settings_open;
                                    this.framing = false;
                                    if this.settings_open {
                                        this.refresh_devices(false, window, cx);
                                    }
                                    cx.notify();
                                })),
                        )
                }
            })
    }

    fn label(text: &'static str) -> Div {
        div().text_size(px(11.0)).font_weight(FontWeight::MEDIUM).text_color(hex(0xa1a1aa)).child(text)
    }

    fn slider_row(label: &'static str, value: String, state: &Entity<SliderState>) -> Div {
        div()
            .flex()
            .flex_col()
            .gap_1()
            .child(
                div()
                    .flex()
                    .justify_between()
                    .child(Self::label(label))
                    .child(div().text_size(px(10.0)).text_color(hex(0xf4f4f5)).child(value)),
            )
            .child(Slider::new(state))
    }

    fn render_camera_panel(&self, cx: &mut Context<Self>) -> Div {
        let scene = &self.settings.scene;
        div()
            .flex()
            .flex_col()
            .gap_2()
            .child(Self::label("Camera"))
            .child(Select::new(&self.controls.camera).small().accessibility_label("Camera").placeholder("Finding cameras..."))
            .child(Self::label("Camera quality"))
            .child(Select::new(&self.controls.resolution).small().accessibility_label("Resolution"))
            .when_some(
                match &self.camera_state {
                    CameraState::Live(mode) => Some(mode.clone()),
                    _ => None,
                },
                |this, mode| this.child(div().text_size(px(10.0)).text_color(hex(0x8b8b90)).child(mode)),
            )
            .child(
                Switch::new("mirror")
                    .label("Mirror camera")
                    .checked(scene.mirror)
                    .on_change(cx.listener(|this, checked: &bool, window, cx| {
                        let checked = *checked;
                        this.update(window, cx, |settings| settings.scene.mirror = checked);
                    })),
            )
            .child(
                Switch::new("always-on-top")
                    .label("Always on top")
                    .checked(true)
                    .disabled(true)
                    .tooltip("GPUI cannot change the window level after the window opens."),
            )
    }

    fn render_style_panel(&self, cx: &mut Context<Self>) -> Div {
        let scene = &self.settings.scene;
        let selected_color = scene.effect_color.to_lowercase();
        div()
            .flex()
            .flex_col()
            .gap_2()
            .child(Self::label("Frame effect"))
            .child(Select::new(&self.controls.effect).small().accessibility_label("Frame effect"))
            .when(scene.frame_effect == FrameEffect::Glow, |this| {
                this.child(Self::label("Effect color"))
                    .child(
                        div()
                            .flex()
                            .items_center()
                            .gap_2()
                            .child(div().w(px(76.0)).child(Input::new(&self.controls.effect_color).small().aria_label("Effect color")))
                            .child(div().flex().gap_1().children(SWATCHES.map(|(color, name)| {
                                let selected = selected_color == color;
                                div()
                                    .id(name)
                                    .size(px(18.0))
                                    .rounded(px(5.0))
                                    .bg(parse_hex(color))
                                    .cursor_pointer()
                                    .when(selected, |this| this.border_2().border_color(white(1.0)))
                                    .tooltip(move |window, cx| Tooltip::new(name).build(window, cx))
                                    .on_click(cx.listener(move |this, _, window, cx| {
                                        this.update(window, cx, |settings| settings.scene.effect_color = color.into());
                                    }))
                            }))),
                    )
                    .child(Self::slider_row("Glow strength", format!("{}%", scene.glow_strength), &self.controls.glow_strength))
                    .child(Self::slider_row("Glow spread", format!("{} px", scene.glow_spread), &self.controls.glow_spread))
            })
            .when(scene.frame_effect == FrameEffect::Blur, |this| {
                this.child(Self::slider_row("Blur", format!("{} px", scene.blur_amount), &self.controls.blur_amount))
                    .child(Self::slider_row("Opacity", format!("{}%", scene.blur_opacity), &self.controls.blur_opacity))
            })
            .child(Self::slider_row("Frame", format!("{} px", scene.border_width), &self.controls.frame_width))
    }

    fn render_scenes_panel(&self, cx: &mut Context<Self>) -> Div {
        let has_name = !self.controls.scene_name.read(cx).value().trim().is_empty();
        let selected = self.selected_scene.clone();
        let index = selected.as_ref().and_then(|id| self.settings.scenes.iter().position(|scene| &scene.id == id));
        let count = self.settings.scenes.len();
        let shortcut = |label: &'static str, keys: &str| {
            div()
                .flex()
                .justify_between()
                .items_center()
                .text_size(px(10.0))
                .text_color(hex(0x8b8b90))
                .child(label)
                .children(Keystroke::parse(keys).ok().map(Kbd::new))
        };
        div()
            .flex()
            .flex_col()
            .gap_2()
            .child(Self::label("Save current scene"))
            .child(
                div()
                    .flex()
                    .gap_1()
                    .child(div().flex_1().child(Input::new(&self.controls.scene_name).small().aria_label("Scene name")))
                    .child(
                        Button::new("save-scene")
                            .small()
                            .primary()
                            .label("Save")
                            .disabled(!has_name)
                            .on_click(cx.listener(|this, _, window, cx| this.save_scene(window, cx))),
                    ),
            )
            .child(Select::new(&self.controls.scene).small().accessibility_label("Load saved scene").placeholder(if count == 0 { "No saved scenes" } else { "Load a scene" }))
            .child(
                div()
                    .flex()
                    .gap_1()
                    .child(Button::new("scene-up").small().outline().label("Up").flex_1().disabled(!index.is_some_and(|i| i > 0)).on_click(cx.listener(|this, _, window, cx| {
                        if let Some(id) = this.selected_scene.clone() {
                            let scenes = settings::reorder_scenes(&this.settings.scenes, &id, -1);
                            this.change_scenes(scenes, window, cx);
                        }
                    })))
                    .child(Button::new("scene-down").small().outline().label("Down").flex_1().disabled(!index.is_some_and(|i| i + 1 < count)).on_click(cx.listener(|this, _, window, cx| {
                        if let Some(id) = this.selected_scene.clone() {
                            let scenes = settings::reorder_scenes(&this.settings.scenes, &id, 1);
                            this.change_scenes(scenes, window, cx);
                        }
                    })))
                    .child(Button::new("scene-delete").small().danger().label("Delete").flex_1().disabled(index.is_none()).on_click(cx.listener(|this, _, window, cx| {
                        if let Some(id) = this.selected_scene.take() {
                            let scenes = this.settings.scenes.iter().filter(|scene| scene.id != id).cloned().collect();
                            this.settings_open = false;
                            this.change_scenes(scenes, window, cx);
                        }
                    }))),
            )
            .child(
                div()
                    .flex()
                    .gap_1()
                    .child(Button::new("scene-import").small().outline().label("Import").flex_1().on_click(cx.listener(|this, _, window, cx| this.import_scenes(window, cx))))
                    .child(Button::new("scene-export").small().outline().label("Export").flex_1().disabled(count == 0).on_click(cx.listener(|this, _, _, cx| this.export_scenes(cx)))),
            )
            .when_some(self.scene_message.clone(), |this, message| {
                this.child(div().text_size(px(10.0)).text_color(hex(0xa1a1aa)).child(message))
            })
            .child(
                div()
                    .flex()
                    .flex_col()
                    .gap_1()
                    .pt_1()
                    .child(Self::label("Shortcuts while CamFrame is focused"))
                    .child(shortcut("Full screen", "secondary-shift-f"))
                    .child(shortcut("Next scene", "secondary-shift-p"))
                    .child(shortcut("Scene 1", "secondary-shift-1"))
                    .child(shortcut("Open controls", "secondary-shift-c")),
            )
    }

    fn render_settings(&self, surface: Bounds<Pixels>, window: &Window, cx: &mut Context<Self>) -> impl IntoElement {
        let width = (surface.size.width.as_f32() - 28.0).clamp(200.0, 240.0);
        let left = surface.origin.x.as_f32() + (surface.size.width.as_f32() - width) / 2.0;
        let max_height = window.viewport_size().height.as_f32() - SETTINGS_TOP - 8.0;
        let tab = self.settings_tab;
        let panel = match tab {
            SettingsTab::Camera => self.render_camera_panel(cx),
            SettingsTab::Style => self.render_style_panel(cx),
            SettingsTab::Scenes => self.render_scenes_panel(cx),
        };
        div()
            .id("inline-settings")
            .absolute()
            .left(px(left.max(4.0)))
            .top(px(SETTINGS_TOP))
            .w(px(width))
            .max_h(px(max_height))
            .overflow_y_scroll()
            .p(px(10.0))
            .flex()
            .flex_col()
            .gap_2()
            .rounded(px(12.0))
            .border_1()
            .border_color(white(0.10))
            .bg(hex(0x0c0c0d).opacity(0.96))
            .shadow_lg()
            .text_size(px(11.0))
            .on_mouse_down(MouseButton::Left, |_, _, cx| cx.stop_propagation())
            .child(
                TabBar::new("settings-tabs")
                    .segmented()
                    .small()
                    .selected_index(tab as usize)
                    .on_click(cx.listener(|this, index: &usize, _, cx| {
                        this.settings_tab = [SettingsTab::Camera, SettingsTab::Style, SettingsTab::Scenes][*index];
                        cx.notify();
                    }))
                    .child(Tab::new().label("Camera").flex_1())
                    .child(Tab::new().label("Style").flex_1())
                    .child(Tab::new().label("Scenes").flex_1()),
            )
            .child(panel)
    }

    fn render_notice(&self, surface: Bounds<Pixels>) -> impl IntoElement {
        div().when_some(self.notice.clone(), |this, message| {
            this.child(
                div()
                    .absolute()
                    .left(surface.origin.x + px(16.0))
                    .w(surface.size.width - px(32.0))
                    .top(surface.origin.y + surface.size.height - px(46.0))
                    .flex()
                    .justify_center()
                    .child(
                        div()
                            .max_w_full()
                            .px(px(10.0))
                            .py(px(7.0))
                            .rounded(px(8.0))
                            .border_1()
                            .border_color(white(0.10))
                            .bg(hex(0x0c0c0d).opacity(0.88))
                            .shadow_md()
                            .text_size(px(11.0))
                            .font_weight(FontWeight::SEMIBOLD)
                            .text_color(white(1.0))
                            .truncate()
                            .child(message),
                    ),
            )
        })
    }
}

impl Render for Overlay {
    fn render(&mut self, window: &mut Window, cx: &mut Context<Self>) -> impl IntoElement {
        let fullscreen = window.is_fullscreen();
        if fullscreen != self.fullscreen {
            self.on_fullscreen_changed(fullscreen, window, cx);
        }
        let surface = self.surface_bounds(window);
        let scene = &self.settings.scene;
        let (width, height) = (surface.size.width.as_f32(), surface.size.height.as_f32());
        let radius = if fullscreen { 0.0 } else { scene.shape.radius(width, height) };

        // Tell the capture thread how the surface shows the camera, in device pixels.
        let scale = window.scale_factor();
        let halo = (scene.frame_effect == FrameEffect::Blur && !fullscreen).then(|| Halo {
            resolution: (width.max(height) / scene.blur_amount as f32).round() as u32,
            radius: radius / width.min(height),
        });
        *lock(&self.slot.view) = Some(View {
            width: (width * scale).round() as u32,
            height: (height * scale).round() as u32,
            zoom: scene.camera_zoom as f32 / 100.0,
            origin: (scene.camera_position.x as f32 / 100.0, scene.camera_position.y as f32 / 100.0),
            mirror: scene.mirror,
            halo,
        });
        self.update_input_region(window, surface);

        let dragging = self.drag.is_some();
        let toolbar = self.toolbar_bounds(surface);
        div()
            .id("overlay")
            .key_context("Overlay")
            .track_focus(&self.focus)
            .size_full()
            .relative()
            .font_family(".SystemUIFont")
            .on_action(cx.listener(|this, _: &ToggleFullscreen, window, cx| this.toggle_fullscreen(window, cx)))
            .on_action(cx.listener(|this, _: &Escape, window, cx| this.escape(window, cx)))
            .on_action(cx.listener(|this, _: &NextScene, window, cx| this.next_scene(window, cx)))
            .on_action(cx.listener(|this, _: &OpenControls, _, cx| {
                this.settings_open = true;
                this.toolbar_visible = true;
                cx.notify();
            }))
            .on_action(cx.listener(|this, _: &Scene1, window, cx| this.apply_scene_at(0, window, cx)))
            .on_action(cx.listener(|this, _: &Scene2, window, cx| this.apply_scene_at(1, window, cx)))
            .on_action(cx.listener(|this, _: &Scene3, window, cx| this.apply_scene_at(2, window, cx)))
            .on_action(cx.listener(|this, _: &Scene4, window, cx| this.apply_scene_at(3, window, cx)))
            .on_action(cx.listener(|this, _: &Scene5, window, cx| this.apply_scene_at(4, window, cx)))
            .on_action(cx.listener(|this, _: &Scene6, window, cx| this.apply_scene_at(5, window, cx)))
            .on_hover(cx.listener(|this, hovered: &bool, _, cx| this.set_hovered(*hovered, cx)))
            .on_mouse_move(cx.listener(move |this, event: &MouseMoveEvent, _, cx| {
                if !this.fullscreen || this.drag.is_some() {
                    return;
                }
                // Full screen: the toolbar returns only inside its hotspot (toolbar + 12 px).
                if toolbar.dilate(px(12.0)).contains(&event.position) {
                    this.hide_task = None;
                    if !this.toolbar_visible {
                        this.toolbar_visible = true;
                        cx.notify();
                    }
                } else if this.toolbar_visible && this.hide_task.is_none() {
                    this.schedule_toolbar_hide(FULLSCREEN_TOOLBAR_HIDE_DELAY, cx);
                }
            }))
            .when_some(self.render_effect(surface, px(radius)).filter(|_| !fullscreen), |this, effect| this.child(effect))
            .child(self.render_camera(surface, px(radius), cx))
            .child(self.render_handles(surface, cx))
            .when(self.toolbar_visible || self.keeps_toolbar(), |this| this.child(self.render_toolbar(surface, cx)))
            .when(self.settings_open, |this| this.child(self.render_settings(surface, window, cx)))
            .child(self.render_notice(surface))
            .when(dragging, |this| {
                // Window-level listeners keep a drag alive outside the element that started it.
                let entity = cx.entity();
                this.child(canvas(|_, _, _| {}, move |_, _, window, _| {
                    let moved = entity.clone();
                    window.on_mouse_event(move |event: &MouseMoveEvent, phase, window, cx| {
                        if phase == DispatchPhase::Bubble {
                            moved.update(cx, |this, cx| this.drag_moved(event.position, window, cx));
                        }
                    });
                    window.on_mouse_event(move |_: &MouseUpEvent, phase, _, cx| {
                        if phase == DispatchPhase::Bubble {
                            entity.update(cx, |this, cx| this.drag_ended(cx));
                        }
                    });
                }).absolute().size_full())
            })
    }
}
