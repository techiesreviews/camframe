//! The Compact Overlay: the floating camera bubble with its hover toolbar and corner handles.
//!
//! Layout follows CamFrame 0.9.0 (`src/overlay.html` and `src/overlay.css`): a transparent window
//! with 84 px of room above the camera surface and 18 px on the other sides. The toolbar and the
//! corner handles show while the pointer is on the bubble and hide 220 ms after it leaves.
//!
//! Clicks go through the window wherever nothing is drawn under the pointer (one of the three
//! allowed improvements over 0.9.0). The window cannot see the pointer while clicks pass through
//! it, so the pointer is read from the system about 30 times a second and the window is switched
//! between taking and passing clicks only when that changes.

use std::path::PathBuf;
use std::sync::Arc;
use std::time::{Duration, Instant};

use camframe_core::geometry::{self, Corner, Rect};
use camframe_core::interaction::{Interaction, Target, target_at, toolbar_box};
use camframe_core::settings::{OVERLAY_CHROME, Point, Settings, Shape, dimensions_for, overlay_dimensions_for};
use gpui::prelude::FluentBuilder;
use gpui::{
    App, AppContext, AssetSource, Bounds, Context, CursorStyle, FocusHandle, Focusable, InteractiveElement,
    IntoElement, KeyBinding, MouseButton, MouseDownEvent, ParentElement, Pixels, Render, RenderImage, SharedString,
    StatefulInteractiveElement, Styled, StyledImage, Window, WindowBackgroundAppearance, WindowBounds,
    WindowControlArea, WindowKind, WindowOptions, actions, div, img, point, px, rgb, size, svg, transparent_black,
};
use smallvec::SmallVec;

use crate::camera::{CameraSlot, CameraStatus, CameraWorker, OutputView, lock_unpoisoned};
#[cfg(target_os = "macos")]
use crate::mac_overlay as platform;
use crate::prefs::Prefs;
use crate::tray::{Tray, TrayCommand};
#[path = "guide.rs"]
mod guide;
#[path = "presentation.rs"]
mod presentation;
#[path = "prompter_control.rs"]
mod prompter_control;
#[path = "scenes_panel.rs"]
mod scenes_panel;
#[path = "settings_panel.rs"]
mod settings_panel;
#[cfg(not(target_os = "macos"))]
use crate::win32_overlay as platform;
use settings_panel::SettingsTab;

/// How often the pointer is read while idle, and while a corner is being dragged.
const POINTER_POLL: Duration = Duration::from_millis(33);
const POINTER_POLL_RESIZING: Duration = Duration::from_millis(16);
/// A moved window is saved once it has stood still this long.
const POSITION_SAVE_DELAY_MS: u64 = 400;

// 0.9.0's toolbar buttons (`.hover-toolbar` in `src/overlay.css`); the toolbar box is
// `camframe_core::interaction::toolbar_box`.
const TOOLBAR_BUTTON: f32 = 36.0;
const TOOLBAR_ICON: f32 = 20.0;
const HANDLE_SIZE: f32 = 14.0;

actions!(camframe, [ShapeCircle, ShapeRounded, ShapePortrait, ShapeLandscape]);

pub struct LaunchConfig {
    pub demo_pattern: bool,
    pub position: Option<(i32, i32)>,
    pub metrics_file: Option<PathBuf>,
    pub launch_instant: Instant,
    pub settings_dir: Option<PathBuf>,
    pub settings_panel: Option<String>,
}

/// The toolbar icons: Phosphor (regular), the same set 0.9.0 uses, as SVG files in the binary.
pub struct Icons;

impl AssetSource for Icons {
    fn load(&self, path: &str) -> anyhow::Result<Option<std::borrow::Cow<'static, [u8]>>> {
        let bytes: &'static [u8] = match path {
            "icons/list.svg" => include_bytes!("../assets/icons/list.svg"),
            "icons/squares-four.svg" => include_bytes!("../assets/icons/squares-four.svg"),
            "icons/pencil-simple.svg" => include_bytes!("../assets/icons/pencil-simple.svg"),
            "icons/trash.svg" => include_bytes!("../assets/icons/trash.svg"),
            "icons/dots-six-vertical.svg" => include_bytes!("../assets/icons/dots-six-vertical.svg"),
            "icons/check.svg" => include_bytes!("../assets/icons/check.svg"),
            "icons/plus.svg" => include_bytes!("../assets/icons/plus.svg"),
            "icons/arrow-counter-clockwise.svg" => include_bytes!("../assets/icons/arrow-counter-clockwise.svg"),
            "icons/x.svg" => include_bytes!("../assets/icons/x.svg"),
            "icons/download-simple.svg" => include_bytes!("../assets/icons/download-simple.svg"),
            "icons/upload-simple.svg" => include_bytes!("../assets/icons/upload-simple.svg"),
            "icons/warning.svg" => include_bytes!("../assets/icons/warning.svg"),
            "icons/x-circle.svg" => include_bytes!("../assets/icons/x-circle.svg"),
            "icons/circle.svg" => include_bytes!("../assets/icons/circle.svg"),
            "icons/corners-in.svg" => include_bytes!("../assets/icons/corners-in.svg"),
            "icons/corners-out.svg" => include_bytes!("../assets/icons/corners-out.svg"),
            "icons/crosshair.svg" => include_bytes!("../assets/icons/crosshair.svg"),
            "icons/scroll.svg" => include_bytes!("../assets/icons/scroll.svg"),
            "icons/sliders-horizontal.svg" => include_bytes!("../assets/icons/sliders-horizontal.svg"),
            _ => return Ok(None),
        };
        Ok(Some(std::borrow::Cow::Borrowed(bytes)))
    }

    fn list(&self, _path: &str) -> anyhow::Result<Vec<SharedString>> {
        Ok(Vec::new())
    }
}

/// The number keys 1 to 4 pick a shape, but only with `--demo-pattern`: the automated Windows
/// and macOS checks use them. 0.9.0 has no such keys, so normal starts do not bind them.
pub fn bind_test_keys(cx: &mut App) {
    cx.bind_keys([
        KeyBinding::new("1", ShapeCircle, None),
        KeyBinding::new("2", ShapeRounded, None),
        KeyBinding::new("3", ShapePortrait, None),
        KeyBinding::new("4", ShapeLandscape, None),
    ]);
}

pub fn open(config: LaunchConfig, cx: &mut App) -> anyhow::Result<()> {
    let (prefs, mut settings) = Prefs::open(config.settings_dir.clone());
    if config.demo_pattern {
        let patch = match config.settings_panel.as_deref() {
            Some("small-menu") => serde_json::json!({"shape":"portrait","size":180}),
            Some("large-menu") => serde_json::json!({"shape":"landscape","size":640}),
            Some("style-glow") => serde_json::json!({"frameEffect":"glow"}),
            Some("style-blur") => serde_json::json!({"frameEffect":"blur"}),
            Some("scenes-list") => serde_json::json!({"sceneView":"list"}),
            _ => serde_json::json!({}),
        };
        settings = settings.with_patch(&patch);
    }
    let (areas, primary) = work_areas(cx);
    let (mut bounds, healed) = geometry::opening_compact_bounds(
        settings.shape,
        settings.size,
        settings.position,
        settings.prompter_margin,
        &areas,
        primary,
    );
    if let Some((x, y)) = config.position {
        // A pinned place (automated checks) is never saved.
        bounds = bounds.at(Point { x: i64::from(x), y: i64::from(y) });
    } else if let Some(position) = healed {
        settings.position = Some(position);
        prefs.save(&settings);
    }

    let options = WindowOptions {
        window_bounds: Some(WindowBounds::Windowed(gpui_bounds(bounds))),
        titlebar: None,
        focus: true,
        show: settings.overlay_visible,
        kind: WindowKind::PopUp,
        is_movable: true,
        app_owns_titlebar_drag: true,
        is_resizable: false,
        is_minimizable: false,
        // Keep the camera moving while another app has focus.
        inactive_frame_interval: None,
        window_background: WindowBackgroundAppearance::Transparent,
        app_id: Some("camframe-rust".into()),
        ..WindowOptions::default()
    };

    let position = config.position;
    cx.open_window(options, |window, cx| {
        if let Err(err) = platform::configure_transparent_overlay(window, position) {
            eprintln!("CamFrame: transparent window setup failed: {err}");
        }
        platform::set_bounds(window, bounds, cx);
        cx.new(|cx| BubbleOverlay::new(config, prefs, settings, window, cx))
    })?;
    Ok(())
}

/// A corner drag in progress: where it started, and the size and place it has reached.
#[derive(Debug, Clone, Copy)]
struct Resize {
    corner: Corner,
    start_cursor: (f64, f64),
    start_size: u32,
    start_window: Rect,
    size: u32,
    origin: Point,
}

pub struct BubbleOverlay {
    settings: Settings,
    prefs: Prefs,
    interaction: Interaction,
    clock: Instant,
    /// The click mode last given to the window: `Some(true)` while clicks pass through.
    click_through: Option<bool>,
    resize: Option<Resize>,
    /// Where the window was at the last poll, to notice a drag.
    last_origin: Option<Point>,
    save_at: Option<u64>,
    /// `--position` was given (automated checks): the place is not saved.
    pinned_position: bool,
    focus: FocusHandle,
    slot: Arc<CameraSlot>,
    _worker: CameraWorker,
    frame: Option<Arc<RenderImage>>,
    halo: Option<Arc<RenderImage>>,
    status: CameraStatus,
    tray: Option<Tray>,
    launch_instant: Instant,
    metrics_file: Option<PathBuf>,
    startup_recorded: bool,
    settings_tab: Option<SettingsTab>,
    framing: bool,
    open_select: Option<&'static str>,
    settings_scroll: gpui::ScrollHandle,
    settings_scrollbar: std::cell::Cell<bool>,
    overlay_scrollbars: bool,
    settings_scroll_until: u64,
    settings_scroll_drag: Option<f32>,
    framing_drag: Option<((f64, f64), camframe_core::settings::CameraPosition)>,
    color_input: gpui::Entity<crate::text_field::TextField>,
    color_error: bool,
    slider_drag: Option<(&'static str, u32, u32)>,
    presentation: presentation::Presentation,
    _shortcuts: Option<crate::shortcuts::Shortcuts>,
    shortcut_errors: Vec<String>,
    active_scene_id: String,
    scene_edits: camframe_core::scenes::SceneEdits,
    scene_input: gpui::Entity<crate::text_field::TextField>,
    scene_rename: Option<String>,
    scene_status: String,
    scene_status_until: u64,
    scene_status_ok: bool,
    scene_status_action: Option<&'static str>,
    scene_save_open: bool,
    scene_drag: Option<String>,
    scene_focus: [FocusHandle; 6],
    scene_undo_focus: FocusHandle,
    camera_notice: String,
    link: Option<crate::prompter::Link>,
    link_commands: async_channel::Sender<crate::prompter::Command>,
    link_generation: u64,
    link_message: String,
    high_contrast: bool,
    accessibility_scan: Instant,
    guide_step: Option<usize>,
    demo_pattern: bool,
    announcement: String,
}

impl BubbleOverlay {
    fn new(
        config: LaunchConfig,
        prefs: Prefs,
        settings: Settings,
        window: &mut Window,
        cx: &mut Context<Self>,
    ) -> Self {
        let focus = cx.focus_handle();
        focus.focus(window, cx);
        let color_input =
            cx.new(|cx| crate::text_field::TextField::new(settings.effect_color.clone(), "Effect color", cx));
        cx.subscribe_in(&color_input, window, |this, _, event: &crate::text_field::Submitted, window, cx| {
            this.color_error = hex_color(&event.0).is_none();
            if !this.color_error {
                this.patch_settings(serde_json::json!({"effectColor":event.0}), window, cx);
            }
            cx.notify();
        })
        .detach();
        let scene_input = cx.new(|cx| crate::text_field::TextField::new(String::new(), "Scene name", cx));
        cx.subscribe_in(&scene_input, window, |_, _, _: &crate::text_field::Changed, _, cx| cx.notify()).detach();
        cx.subscribe_in(&scene_input, window, |this, _, event: &crate::text_field::Submitted, window, cx| {
            this.save_scene_name(&event.0, window, cx);
        })
        .detach();

        let slot = Arc::new(CameraSlot::default());
        *lock_unpoisoned(&slot.request) = crate::camera::CaptureRequest {
            device: settings.camera_id.clone(),
            label: settings.camera_label.clone(),
            resolution: settings.overlay_resolution,
        };
        let (wake_tx, wake_rx) = async_channel::bounded::<()>(1);
        let initial_view = output_view(&settings, settings.size, window.scale_factor());
        let worker = CameraWorker::start(config.demo_pattern, initial_view, Arc::clone(&slot), wake_tx);
        *lock_unpoisoned(&slot.effect) = (settings.frame_effect == camframe_core::settings::FrameEffect::Blur)
            .then_some((settings.shape, settings.size, settings.blur_amount, settings.blur_opacity));

        cx.spawn_in(window, async move |entity, cx| {
            while wake_rx.recv().await.is_ok() {
                if entity.update_in(cx, |this, window, cx| this.pull_camera_update(window, cx)).is_err() {
                    break;
                }
            }
        })
        .detach();

        cx.spawn_in(window, async move |entity, cx| {
            loop {
                let Ok(resizing) = entity.update_in(cx, |this, window, cx| {
                    this.poll_pointer(window, cx);
                    this.resize.is_some()
                        || this.presentation.transition.is_some()
                        || this.presentation.surface_transition.is_some()
                }) else {
                    break;
                };
                let wait = if resizing { POINTER_POLL_RESIZING } else { POINTER_POLL };
                cx.background_executor().timer(wait).await;
            }
        })
        .detach();

        let (tray_tx, tray_rx) = async_channel::unbounded::<TrayCommand>();
        let (shortcuts, shortcut_errors) = crate::shortcuts::Shortcuts::new(tray_tx.clone());
        let tray = match Tray::new(settings.overlay_visible, tray_tx) {
            Ok(tray) => Some(tray),
            Err(error) => {
                eprintln!("CamFrame: no tray icon: {error:#}");
                None
            }
        };
        if let Some(tray) = &tray {
            tray.set_scenes(&settings.presets, "");
        }
        cx.spawn_in(window, async move |entity, cx| {
            while let Ok(command) = tray_rx.recv().await {
                if entity.update_in(cx, |this, window, cx| this.run_tray_command(command, window, cx)).is_err() {
                    break;
                }
            }
        })
        .detach();
        let (link_commands, link_rx) = async_channel::bounded::<crate::prompter::Command>(8);
        cx.spawn_in(window, async move |entity, cx| {
            while let Ok(command) = link_rx.recv().await {
                if entity
                    .update_in(cx, |this, window, cx| {
                        if command.generation != this.link_generation
                            || command.cancelled.load(std::sync::atomic::Ordering::Relaxed)
                        {
                            return;
                        }
                        let result = this.run_link_command(&command.kind, &command.body, window, cx);
                        let _ = command.reply.send(result);
                    })
                    .is_err()
                {
                    break;
                }
            }
        })
        .detach();
        let (link, link_message) = if settings.prompter_link {
            match crate::prompter::Link::start(link_commands.clone(), 0) {
                Ok(link) => (Some(link), String::new()),
                Err(message) => (None, message),
            }
        } else {
            (None, String::new())
        };

        cx.on_app_quit(|this: &mut Self, _cx| {
            this.save_now();
            async {}
        })
        .detach();

        Self {
            settings,
            prefs,
            interaction: Interaction::default(),
            clock: Instant::now(),
            click_through: None,
            resize: None,
            last_origin: None,
            save_at: None,
            pinned_position: config.position.is_some(),
            focus,
            slot,
            _worker: worker,
            frame: None,
            halo: None,
            status: CameraStatus::Starting,
            tray,
            launch_instant: config.launch_instant,
            metrics_file: config.metrics_file,
            startup_recorded: false,
            settings_tab: if config.demo_pattern {
                match config.settings_panel.as_deref() {
                    Some("camera") => Some(SettingsTab::Camera),
                    Some("style" | "style-glow" | "style-blur") => Some(SettingsTab::Style),
                    Some("scenes" | "scenes-list") => Some(SettingsTab::Scenes),
                    _ => None,
                }
            } else {
                None
            },
            framing: false,
            open_select: None,
            settings_scroll: gpui::ScrollHandle::new(),
            settings_scrollbar: std::cell::Cell::new(false),
            overlay_scrollbars: platform::uses_overlay_scrollbars(),
            settings_scroll_until: 0,
            settings_scroll_drag: None,
            framing_drag: None,
            color_input,
            color_error: false,
            slider_drag: None,
            presentation: presentation::Presentation::default(),
            _shortcuts: shortcuts,
            shortcut_errors,
            active_scene_id: String::new(),
            scene_edits: camframe_core::scenes::SceneEdits::default(),
            scene_input,
            scene_rename: None,
            scene_status: String::new(),
            scene_status_until: 0,
            scene_status_ok: false,
            scene_status_action: None,
            scene_save_open: false,
            scene_drag: None,
            scene_focus: std::array::from_fn(|_| cx.focus_handle()),
            scene_undo_focus: cx.focus_handle(),
            camera_notice: String::new(),
            link,
            link_commands,
            link_generation: 0,
            link_message,
            high_contrast: false,
            accessibility_scan: Instant::now() - Duration::from_secs(2),
            guide_step: None,
            demo_pattern: config.demo_pattern,
            announcement: String::new(),
        }
    }

    fn current_bounds(&self, window: &Window) -> Rect {
        platform::pending_bounds(window).unwrap_or_else(|| rect_of(window.bounds()))
    }

    fn now_ms(&self) -> u64 {
        self.clock.elapsed().as_millis() as u64
    }

    /// The size shown now: the live size while a corner is dragged.
    fn size(&self) -> u32 {
        self.resize.map_or(self.settings.size, |resize| resize.size)
    }

    fn save_now(&mut self) {
        self.save_at = None;
        self.prefs.save(&self.settings);
    }

    fn pull_camera_update(&mut self, window: &mut Window, cx: &mut Context<Self>) {
        let rejection = lock_unpoisoned(&self.slot.rejection).take();
        if let Some((rejected, resolution, message)) = rejection {
            self.camera_notice = message;
            if self.settings.camera_id == rejected.device && self.settings.overlay_resolution == rejected.resolution {
                self.settings.overlay_resolution = resolution;
                self.sync_capture_view(window, cx);
                self.save_at = Some(self.now_ms() + POSITION_SAVE_DELAY_MS);
            }
        }
        if let Some(status) = lock_unpoisoned(&self.slot.status).take() {
            self.status = status;
        }
        if !self.demo_pattern
            && self.guide_step.is_none()
            && self.settings.completed_onboarding_version < 1
            && !matches!(self.status, CameraStatus::Starting)
        {
            self.show_guide(window, cx);
        }
        if let Some(bgra) = lock_unpoisoned(&self.slot.halo).take()
            && let Some(buffer) = image::RgbaImage::from_raw(bgra.width, bgra.height, bgra.bytes)
        {
            let next = Arc::new(RenderImage::new(SmallVec::from_elem(image::Frame::new(buffer), 1)));
            if let Some(previous) = self.halo.replace(next) {
                let _ = window.drop_image(previous);
            }
        }
        if let Some(bgra) = lock_unpoisoned(&self.slot.frame).take()
            && let Some(buffer) = image::RgbaImage::from_raw(bgra.width, bgra.height, bgra.bytes)
        {
            let frames = SmallVec::from_elem(image::Frame::new(buffer), 1);
            let next = Arc::new(RenderImage::new(frames));
            if let Some(previous) = self.frame.replace(next) {
                let _ = window.drop_image(previous);
            }
        }
        cx.notify();
    }

    fn sync_capture_view(&self, window: &Window, cx: &App) {
        let mut view = output_view(&self.settings, self.size(), window.scale_factor());
        if self.presentation.fullscreen {
            let target = self.presentation.transition.map_or_else(
                || {
                    window
                        .display(cx)
                        .map(|display| rect_of(display.bounds()))
                        .unwrap_or_else(|| rect_of(window.bounds()))
                },
                |(_, to, _)| to,
            );
            view.width = (target.width as f32 * window.scale_factor()).round().max(1.0) as u32;
            view.height = (target.height as f32 * window.scale_factor()).round().max(1.0) as u32;
        }
        *lock_unpoisoned(&self.slot.view) = Some(view);
        *lock_unpoisoned(&self.slot.request) = crate::camera::CaptureRequest {
            device: self.settings.camera_id.clone(),
            label: self.settings.camera_label.clone(),
            resolution: self.settings.overlay_resolution,
        };
        *lock_unpoisoned(&self.slot.effect) = (self.settings.frame_effect
            == camframe_core::settings::FrameEffect::Blur)
            .then_some((self.settings.shape, self.size(), self.settings.blur_amount, self.settings.blur_opacity));
        if self.presentation.fullscreen {
            *lock_unpoisoned(&self.slot.effect) = None;
        }
    }

    /// Reads the pointer, moves a corner drag on, shows or hides the chrome, switches the click mode,
    /// and notices when the window was dragged somewhere new.
    fn poll_pointer(&mut self, window: &mut Window, cx: &mut Context<Self>) {
        if self.accessibility_scan.elapsed() >= Duration::from_secs(1) {
            self.accessibility_scan = Instant::now();
            let (reduced, contrast) = platform::accessibility_preferences();
            // Re-read AppKit alongside the existing live preference scan; no notification owner is needed.
            let overlay_scrollbars = platform::uses_overlay_scrollbars();
            if overlay_scrollbars != self.overlay_scrollbars {
                self.overlay_scrollbars = overlay_scrollbars;
                self.settings_scroll_drag = None;
                cx.notify();
            }
            cx.set_reduce_motion(reduced);
            if reduced {
                self.presentation.surface_transition = None;
            }
            if reduced && let Some((_, target, _)) = self.presentation.transition.take() {
                platform::set_bounds(window, target, cx);
                self.sync_capture_view(window, cx);
            }
            if contrast != self.high_contrast {
                self.high_contrast = contrast;
                self.color_input.update(cx, |input, cx| {
                    input.high_contrast = contrast;
                    cx.notify();
                });
                self.scene_input.update(cx, |input, cx| {
                    input.high_contrast = contrast;
                    cx.notify();
                });
                cx.notify();
            }
        }
        if !self.settings.overlay_visible {
            return;
        }
        let now = self.now_ms();
        if self.settings_scroll_until != 0 && now >= self.settings_scroll_until {
            self.settings_scroll_until = 0;
            cx.notify();
        }
        if self.save_at.is_some_and(|at| now >= at) {
            self.save_now();
        }
        if self.settings_tab == Some(SettingsTab::Scenes) {
            cx.notify();
        }
        self.tick_presentation(window, cx);
        self.track_position(window, now);
        let Some(cursor) = platform::cursor_position(window) else {
            // Linux (development only): GPUI's own hover drives the chrome; see `render`.
            if self.interaction.tick(now) {
                cx.notify();
            }
            return;
        };
        if self.settings_scroll_drag.is_some() {
            if platform::primary_button_down() {
                self.update_settings_scroll((cursor.1 - f64::from(window.bounds().origin.y)) as f32, cx);
            } else {
                self.settings_scroll_drag = None;
            }
        }
        if self.presentation.fullscreen {
            let bounds = window.bounds();
            let local = (cursor.0 - f64::from(bounds.origin.x), cursor.1 - f64::from(bounds.origin.y));
            if camframe_core::interaction::fullscreen_toolbar_hotspot(local, f64::from(bounds.size.width)) {
                self.presentation.chrome_at = now;
                if !self.presentation.chrome_shown {
                    self.presentation.chrome_shown = true;
                    cx.notify();
                }
            } else if self.presentation.chrome_shown
                && now.saturating_sub(self.presentation.chrome_at)
                    >= camframe_core::interaction::FULLSCREEN_TOOLBAR_HIDE_DELAY_MS
            {
                self.presentation.chrome_shown = false;
                cx.notify();
            }
            platform::set_click_through(window, false);
            self.click_through = Some(false);
            return;
        }

        if let Some(mut resize) = self.resize {
            let delta = (cursor.0 - resize.start_cursor.0, cursor.1 - resize.start_cursor.1);
            let (next, origin) = geometry::resize_from_corner(
                self.settings.shape,
                resize.start_size,
                resize.start_window,
                resize.corner,
                delta,
            );
            if next != resize.size || origin != resize.origin {
                resize.size = next;
                resize.origin = origin;
                self.resize = Some(resize);
                let (width, height) = overlay_dimensions_for(self.settings.shape, next);
                platform::set_bounds(
                    window,
                    self.with_guide_bounds(Rect::new(origin.x, origin.y, i64::from(width), i64::from(height))),
                    cx,
                );
                self.last_origin = Some(origin);
                self.sync_capture_view(window, cx);
                cx.notify();
            }
            if !platform::primary_button_down() {
                self.finish_resize(window, cx);
            }
        }

        let origin = window.bounds().origin;
        let local = (cursor.0 - f64::from(origin.x), cursor.1 - f64::from(origin.y) - f64::from(self.guide_reserve()));
        let was_hovered = self.interaction.hovered();
        let target = target_at(self.settings.shape, self.size(), local, was_hovered);
        self.interaction.pointer(target != Target::Nothing, now);
        let through = self.guide_step.is_none()
            && self.settings_tab.is_none()
            && !self.framing
            && !self.interaction.interactive(target);
        if self.click_through != Some(through) {
            platform::set_click_through(window, through);
            self.click_through = Some(through);
        }
        if was_hovered != self.interaction.hovered() {
            cx.notify();
        }
    }

    /// A window dragged to a new place is saved once it stands still.
    fn track_position(&mut self, window: &Window, now: u64) {
        if self.presentation.fullscreen || self.presentation.transition.is_some() {
            return;
        }
        let origin = self.guide_base_bounds(window).origin();
        let moved = self.last_origin.is_some_and(|last| last != origin);
        self.last_origin = Some(origin);
        if moved && !self.pinned_position && self.resize.is_none() {
            let before = self.settings.clone();
            self.settings.position = Some(origin);
            self.settings = self.scene_edits.follow(
                &before,
                self.settings.clone(),
                &self.active_scene_id,
                &serde_json::json!({"position":origin}),
                now,
            );
            self.save_at = Some(now + POSITION_SAVE_DELAY_MS);
        }
        if self.save_at.is_some_and(|at| now >= at) {
            self.save_now();
        }
    }

    fn start_resize(&mut self, corner: Corner, window: &mut Window, cx: &mut Context<Self>) {
        let Some(cursor) = platform::cursor_position(window) else { return };
        let start_window = self.guide_base_bounds(window);
        self.resize = Some(Resize {
            corner,
            start_cursor: cursor,
            start_size: self.settings.size,
            start_window,
            size: self.settings.size,
            origin: start_window.origin(),
        });
        self.interaction.resizing = true;
        cx.notify();
    }

    fn finish_resize(&mut self, window: &mut Window, cx: &mut Context<Self>) {
        let Some(resize) = self.resize.take() else { return };
        self.interaction.resizing = false;
        let mut next = self.settings.after_hand_resize(&serde_json::json!({ "size": resize.size }));
        if !self.pinned_position {
            next.position = Some(resize.origin);
        }
        let before = self.settings.clone();
        self.settings = next;
        self.settings = self.scene_edits.follow(
            &before,
            self.settings.clone(),
            &self.active_scene_id,
            &serde_json::json!({"size":self.settings.size,"position":self.settings.position}),
            self.now_ms(),
        );
        self.save_now();
        self.sync_capture_view(window, cx);
        cx.notify();
    }

    /// Changes the shape and keeps the window's centre where it was, as 0.9.0 does.
    fn set_shape(&mut self, shape: Shape, window: &mut Window, cx: &mut Context<Self>) {
        if (shape == self.settings.shape && !self.presentation.fullscreen) || self.resize.is_some() {
            return;
        }
        let (areas, primary) = work_areas(cx);
        let leaving_full = self.presentation.fullscreen;
        let current = self
            .presentation
            .compact
            .or(self.presentation.transition.map(|(_, to, _)| to))
            .unwrap_or_else(|| self.guide_base_bounds(window));
        self.presentation.change_mode(false, cx.reduce_motion(), Instant::now());
        self.presentation.compact = None;
        self.presentation.transition = None;
        let mut base = geometry::compact_base_bounds(shape, self.settings.size, None, Some(current), primary, true);
        if !areas.is_empty() {
            base = geometry::on_screen_base(base, &areas, primary, self.settings.prompter_margin);
        }
        if leaving_full {
            self.move_to(base, window, cx);
        } else {
            platform::set_bounds(window, self.with_guide_bounds(base), cx);
        }
        self.last_origin = Some(base.origin());
        let before = self.settings.clone();
        self.settings.shape = shape;
        if !self.pinned_position {
            self.settings.position = Some(base.origin());
        }
        self.settings = self.scene_edits.follow(
            &before,
            self.settings.clone(),
            &self.active_scene_id,
            &serde_json::json!({"shape":shape,"position":self.settings.position}),
            self.now_ms(),
        );
        self.save_now();
        self.sync_capture_view(window, cx);
        cx.notify();
    }

    fn set_overlay_visible(&mut self, visible: bool, window: &mut Window, cx: &mut Context<Self>) {
        if visible == self.settings.overlay_visible {
            return;
        }
        platform::set_visible(window, visible);
        self.settings.overlay_visible = visible;
        if let Some(tray) = &self.tray {
            tray.set_camera_shown(visible);
        }
        self.save_now();
        cx.notify();
    }

    fn run_tray_command(&mut self, command: TrayCommand, window: &mut Window, cx: &mut Context<Self>) {
        match command {
            TrayCommand::ToggleCamera => {
                let visible = !self.settings.overlay_visible;
                self.set_overlay_visible(visible, window, cx);
            }
            TrayCommand::Quit => cx.quit(),
            TrayCommand::Controls => {
                self.set_overlay_visible(true, window, cx);
                if self.settings_tab.is_none() {
                    self.toggle_settings(window, cx);
                }
                window.activate_window();
            }
            TrayCommand::Fullscreen => self.set_fullscreen(!self.presentation.fullscreen, window, cx),
            TrayCommand::CycleScene => {
                let current = self.settings.presets.iter().position(|s| s.id == self.active_scene_id);
                if !self.settings.presets.is_empty() {
                    self.apply_scene_at(current.map_or(0, |i| (i + 1) % self.settings.presets.len()), window, cx);
                }
            }
            TrayCommand::Scene(index) => self.apply_scene_at(index, window, cx),
            TrayCommand::Help => self.show_guide(window, cx),
        }
    }

    fn record_startup_if_needed(&mut self, window: &mut Window) {
        if self.startup_recorded {
            return;
        }
        self.startup_recorded = true;
        let launch_instant = self.launch_instant;
        let metrics_file = self.metrics_file.clone();
        window.on_next_frame(move |_window, _cx| {
            let elapsed_ms = launch_instant.elapsed().as_secs_f64() * 1000.0;
            if let Some(path) = metrics_file {
                let _ = std::fs::write(path, format!("STARTUP_FIRST_FRAME_MS={elapsed_ms:.2}\n"));
            }
        });
    }

    fn render_toolbar(&self, window_width: f32, cx: &mut Context<Self>) -> impl IntoElement {
        let (mut left, top, mut width, height) = toolbar_box(self.settings.shape, self.size());
        if self.presentation.fullscreen {
            width = camframe_core::interaction::TOOLBAR_MAX_WIDTH;
            left = (f64::from(window_width) - width) / 2.0;
        }
        let button_width = camframe_core::chrome::toolbar_button_width(width) as f32;
        let bar = div()
            .id("hover-toolbar")
            .absolute()
            .top(px(top as f32 + self.guide_reserve() as f32))
            .left(px(left as f32))
            .w(px(width as f32))
            .h(px(height as f32))
            .flex()
            .items_center()
            .justify_center()
            .gap(px(if self.framing { 8.0 } else { 2.0 }))
            .p(px(4.0))
            .rounded(px(10.0))
            .bg(rgb(0x0c0c0d));
        if self.framing {
            return bar
                .child(
                    toolbar_button("position-button", "icons/crosshair.svg", 36.0, true, cx)
                        .on_click(cx.listener(|this, _, window, cx| this.toggle_framing(window, cx))),
                )
                .child(
                    div()
                        .flex_1()
                        .min_w_0()
                        .text_size(px(9.0))
                        .line_height(px(12.0))
                        .text_color(rgb(0xa1a1aa))
                        .child(
                            div()
                                .text_size(px(11.0))
                                .text_color(rgb(0xf4f4f5))
                                .child(format!("Zoom {}%", self.settings.camera_zoom)),
                        )
                        .child("Drag · Scroll · Double-click resets"),
                );
        }
        bar.child(
            toolbar_button("close-button", "icons/x-circle.svg", button_width, false, cx)
                .on_click(|_, _, cx| cx.quit()),
        )
        .child(
            toolbar_button(
                "fullscreen-button",
                if self.presentation.fullscreen { "icons/corners-in.svg" } else { "icons/corners-out.svg" },
                button_width,
                self.presentation.fullscreen,
                cx,
            )
            .on_click(
                cx.listener(|this, _, window, cx| this.set_fullscreen(!this.presentation.fullscreen, window, cx)),
            ),
        )
        .child(
            toolbar_button("shape-button", "icons/circle.svg", button_width, false, cx)
                .on_click(cx.listener(|this, _, window, cx| this.set_shape(this.settings.shape.next(), window, cx))),
        )
        .child(
            toolbar_button("position-button", "icons/crosshair.svg", button_width, false, cx)
                .on_click(cx.listener(|this, _, window, cx| this.toggle_framing(window, cx))),
        )
        .child(
            toolbar_button("prompter-button", "icons/scroll.svg", button_width, self.link.is_some(), cx)
                .aria_label(if self.link.is_some() {
                    "Prompter link: on"
                } else if self.link_message.is_empty() {
                    "Prompter link: off"
                } else {
                    self.link_message.as_str()
                })
                .on_click(cx.listener(|this, _, _, cx| this.toggle_link(cx)))
                .when(self.link.is_some() || !self.link_message.is_empty(), |button| {
                    button.child(
                        div()
                            .absolute()
                            .right(px(6.0))
                            .top(px(6.0))
                            .size(px(7.0))
                            .rounded_full()
                            .bg(rgb(if self.link.is_some() { 0x22c55e } else { 0xf97316 })),
                    )
                }),
        )
        .child(
            toolbar_button(
                "controls-button",
                "icons/sliders-horizontal.svg",
                button_width,
                self.settings_tab.is_some(),
                cx,
            )
            .on_click(cx.listener(|this, _, window, cx| this.toggle_settings(window, cx))),
        )
    }

    fn render_camera(&self, layout: presentation::CameraLayout, cx: &mut Context<Self>) -> impl IntoElement {
        let radius = layout.radius;
        let status_label: Option<SharedString> = match &self.status {
            CameraStatus::Starting if self.frame.is_none() => Some("Starting camera.".into()),
            CameraStatus::Unavailable(message) if self.frame.is_none() => Some(message.clone().into()),
            _ => None,
        };

        let mut camera = div()
            .id("camera-surface")
            .absolute()
            .left(px(layout.left))
            .top(px(layout.top))
            .w(px(layout.width))
            .h(px(layout.height))
            .rounded(px(radius))
            .overflow_hidden()
            .bg(rgb(0x18181b))
            .cursor_grab()
            .when(!self.presentation.fullscreen && !self.framing && self.settings_tab.is_none(), |camera| {
                camera.window_control_area(WindowControlArea::Drag)
            })
            .on_mouse_down(
                MouseButton::Left,
                cx.listener(|this, event: &MouseDownEvent, window, cx| {
                    if !this.framing {
                        return;
                    }
                    cx.stop_propagation();
                    if event.click_count == 2 {
                        let (position, zoom) = camframe_core::framing::centered_framing();
                        this.patch_settings(
                            serde_json::json!({"cameraPosition":position,"cameraZoom":zoom}),
                            window,
                            cx,
                        );
                    } else {
                        this.framing_drag = Some((
                            (f64::from(event.position.x), f64::from(event.position.y)),
                            this.settings.camera_position,
                        ));
                    }
                }),
            )
            .on_mouse_move(cx.listener(|this, event: &gpui::MouseMoveEvent, window, cx| {
                if !this.framing || !event.dragging() {
                    this.framing_drag = None;
                    return;
                }
                let Some((start, position)) = this.framing_drag else { return };
                let (width, height) = if this.presentation.fullscreen {
                    (f64::from(window.bounds().size.width), f64::from(window.bounds().size.height))
                } else {
                    let (w, h) = dimensions_for(this.settings.shape, this.size());
                    (f64::from(w), f64::from(h))
                };
                let next = camframe_core::framing::camera_position_after_drag(
                    position,
                    (f64::from(event.position.x) - start.0, f64::from(event.position.y) - start.1),
                    (width, height),
                    this.settings.mirror,
                    this.settings.camera_zoom,
                );
                this.patch_settings(serde_json::json!({"cameraPosition":next}), window, cx);
            }))
            .on_scroll(cx.listener(|this, event: &gpui::ScrollEvent, window, cx| {
                if this.framing {
                    cx.stop_propagation();
                    let zoom = camframe_core::framing::camera_zoom_after_wheel(
                        this.settings.camera_zoom,
                        -f64::from(event.delta.pixel_delta(px(20.0)).y),
                    );
                    this.patch_settings(serde_json::json!({"cameraZoom":zoom}), window, cx);
                }
            }));

        // `gpui_macos` ignores `WindowControlArea::Drag`, so on macOS the bubble starts the native
        // window drag itself.
        #[cfg(target_os = "macos")]
        {
            if !self.presentation.fullscreen && !self.framing && self.settings_tab.is_none() {
                camera = camera.on_mouse_down(MouseButton::Left, |_event, window, _cx| {
                    window.start_window_move();
                });
            }
        }

        if let Some(frame) = self.frame.clone() {
            camera = camera.child(
                img(frame)
                    .absolute()
                    .inset_0()
                    .w_full()
                    .h_full()
                    .object_fit(gpui::ObjectFit::Cover)
                    .rounded(px(radius)),
            );
            if let CameraStatus::Unavailable(message) = &self.status {
                camera = camera.child(
                    div()
                        .absolute()
                        .inset_0()
                        .bg(rgb(0x18181b))
                        .flex()
                        .items_center()
                        .justify_center()
                        .p(px(16.0))
                        .text_xs()
                        .text_color(rgb(0xf4f4f5))
                        .child(message.clone()),
                );
            }
        } else if let Some(message) = status_label {
            camera = camera
                .flex()
                .items_center()
                .justify_center()
                .p(px(16.0))
                .child(div().text_xs().text_color(rgb(0xf4f4f5)).child(message));
        }

        // 0.9.0 draws the border inside the surface (`box-shadow: inset`).
        if !self.presentation.fullscreen && self.settings.border_width > 0 {
            camera = camera.child(
                div()
                    .absolute()
                    .inset_0()
                    .rounded(px(radius))
                    .border(px(self.settings.border_width as f32))
                    .border_color(rgb(hex_color(&self.settings.border_color).unwrap_or(0xffffff))),
            );
        }
        if !self.high_contrast
            && !self.presentation.fullscreen
            && self.settings.frame_effect == camframe_core::settings::FrameEffect::Glow
        {
            let color = hex_color(&self.settings.effect_color).unwrap_or(0xfb923c);
            let opacity = self.settings.glow_strength as f32 / 100.0;
            camera = camera.shadow(vec![
                gpui::BoxShadow::new(px(0.0), px(0.0), gpui::rgba((color << 8) | (opacity * 224.0) as u32).into())
                    .blur_radius(px(self.settings.glow_spread as f32 * 0.4)),
                gpui::BoxShadow::new(px(0.0), px(0.0), gpui::rgba((color << 8) | (opacity * 148.0) as u32).into())
                    .blur_radius(px(self.settings.glow_spread as f32)),
            ]);
        }
        camera
    }

    fn render_handles(&self, camera_width: f32, camera_height: f32, cx: &mut Context<Self>) -> Vec<gpui::AnyElement> {
        let left = OVERLAY_CHROME.left as f32;
        let top = OVERLAY_CHROME.top as f32 + self.guide_reserve() as f32;
        let corners = [
            ("corner-top-left", Corner::TopLeft, left, top),
            ("corner-top-right", Corner::TopRight, left + camera_width, top),
            ("corner-bottom-left", Corner::BottomLeft, left, top + camera_height),
            ("corner-bottom-right", Corner::BottomRight, left + camera_width, top + camera_height),
        ];
        corners
            .into_iter()
            .map(|(id, corner, x, y)| {
                let cursor = if matches!(corner, Corner::TopLeft | Corner::BottomRight) {
                    CursorStyle::ResizeUpLeftDownRight
                } else {
                    CursorStyle::ResizeUpRightDownLeft
                };
                div()
                    .id(id)
                    .absolute()
                    .left(px(x - HANDLE_SIZE / 2.0))
                    .top(px(y - HANDLE_SIZE / 2.0))
                    .w(px(HANDLE_SIZE))
                    .h(px(HANDLE_SIZE))
                    .rounded(px(3.0))
                    .border(px(2.0))
                    .border_color(gpui::rgba(0xf4f4f5eb))
                    .bg(rgb(0x18181b))
                    .cursor(cursor)
                    .on_mouse_down(
                        MouseButton::Left,
                        cx.listener(move |this, _event: &MouseDownEvent, window, cx| {
                            cx.stop_propagation();
                            this.start_resize(corner, window, cx);
                        }),
                    )
                    .into_any_element()
            })
            .collect()
    }
}

impl Focusable for BubbleOverlay {
    fn focus_handle(&self, _cx: &App) -> FocusHandle {
        self.focus.clone()
    }
}

impl Render for BubbleOverlay {
    fn render(&mut self, window: &mut Window, cx: &mut Context<Self>) -> impl IntoElement {
        self.record_startup_if_needed(window);

        let shape = self.settings.shape;
        let (camera_width, camera_height) = if self.presentation.fullscreen {
            (f32::from(window.bounds().size.width) as u32, f32::from(window.bounds().size.height) as u32)
        } else {
            dimensions_for(shape, self.size())
        };
        let viewport = window.viewport_size();
        let (window_width, window_height) = (f32::from(viewport.width), f32::from(viewport.height));
        let (camera_width, camera_height) = (camera_width as f32, camera_height as f32);
        let show_chrome = if self.presentation.fullscreen {
            self.presentation.chrome_shown || self.settings_tab.is_some() || self.framing
        } else {
            self.interaction.hovered()
                || self.resize.is_some()
                || self.settings_tab.is_some()
                || self.framing
                || self.guide_step.is_some()
        };

        div()
            .id("overlay-root")
            .track_focus(&self.focus)
            .relative()
            .font_family(if cfg!(target_os = "windows") { "Segoe UI Variable" } else { "Arial" })
            .font_weight(gpui::FontWeight::MEDIUM)
            .text_size(px(11.0))
            .line_height(px(16.0))
            .w(px(window_width))
            .h(px(window_height))
            .bg(transparent_black())
            .on_mouse_down(
                MouseButton::Left,
                cx.listener(|this, _, _, cx| {
                    if this.open_select.take().is_some() {
                        cx.notify();
                    }
                }),
            )
            .on_mouse_up(
                MouseButton::Left,
                cx.listener(|this, _, _, _| {
                    this.scene_drag = None;
                    this.slider_drag = None;
                    this.settings_scroll_drag = None;
                }),
            )
            .on_mouse_up_out(
                MouseButton::Left,
                cx.listener(|this, _, _, _| {
                    this.scene_drag = None;
                    this.slider_drag = None;
                    this.settings_scroll_drag = None;
                }),
            )
            .when(cfg!(target_os = "linux"), |root| {
                root.on_hover(cx.listener(|this, &hovered: &bool, _window, cx| {
                    let now = this.now_ms();
                    this.interaction.pointer(hovered, now);
                    cx.notify();
                }))
            })
            .on_action(cx.listener(|this, _: &ShapeCircle, window, cx| this.set_shape(Shape::Circle, window, cx)))
            .on_action(cx.listener(|this, _: &ShapeRounded, window, cx| this.set_shape(Shape::Rounded, window, cx)))
            .on_action(cx.listener(|this, _: &ShapePortrait, window, cx| this.set_shape(Shape::Portrait, window, cx)))
            .on_action(cx.listener(|this, _: &ShapeLandscape, window, cx| this.set_shape(Shape::Landscape, window, cx)))
            .on_key_down(cx.listener(|this, event: &gpui::KeyDownEvent, window, cx| {
                if event.keystroke.key == "z"
                    && (event.keystroke.modifiers.control || event.keystroke.modifiers.platform)
                    && this.settings_tab == Some(SettingsTab::Scenes)
                    && this.scene_rename.is_none()
                    && !this.scene_save_open
                {
                    cx.stop_propagation();
                    this.run_scene_action(scenes_panel::SceneAction::UndoLatest, window, cx);
                    return;
                }
                if event.keystroke.key == "escape" {
                    if this.guide_step.is_some() {
                        this.finish_guide(window, cx);
                        return;
                    }
                    if this.scene_save_open {
                        this.scene_save_open = false;
                        cx.notify();
                        return;
                    }
                    if let Some(id) = this.scene_rename.take() {
                        this.scene_input.update(cx, |input, cx| input.set_text(String::new(), cx));
                        if let Some(index) = this.settings.presets.iter().position(|s| s.id == id) {
                            this.scene_focus[index].focus(window, cx);
                        }
                        cx.notify();
                        return;
                    }
                    if this.open_select.take().is_some() {
                        cx.notify();
                        return;
                    }
                    if this.presentation.fullscreen {
                        this.set_fullscreen(false, window, cx);
                    }
                    if this.settings_tab.is_some() {
                        this.toggle_settings(window, cx);
                    }
                    this.framing = false;
                    cx.notify();
                }
            }))
            .when(
                !self.presentation.fullscreen
                    && !self.high_contrast
                    && self.settings.frame_effect == camframe_core::settings::FrameEffect::Blur,
                |root| {
                    root.children(self.halo.clone().map(|halo| {
                        img(halo)
                            .absolute()
                            .left(px(-2.0))
                            .top(px(64.0 + self.guide_reserve() as f32))
                            .w(px(camera_width + 40.0))
                            .h(px(camera_height + 40.0))
                    }))
                },
            )
            .child(self.render_camera(
                self.presentation.camera_layout(
                    (window_width, window_height),
                    shape,
                    self.size(),
                    self.guide_reserve(),
                    Instant::now(),
                ),
                cx,
            ))
            .when(show_chrome, |root| {
                root.child(self.render_toolbar(window_width, cx)).when(!self.presentation.fullscreen, |root| {
                    root.children(self.render_handles(camera_width, camera_height, cx))
                })
            })
            .when(self.settings_tab.is_some(), |root| root.child(self.render_settings(window, cx)))
            .when(self.guide_step.is_some(), |root| root.child(self.render_guide(cx)))
            .child({
                let announcement = self.announcement.clone();
                div().id("announcements").role(gpui::Role::Status).a11y_synthetic_children(move |tree| {
                    let id = tree.synthetic_node_id("live-status");
                    let mut node = accesskit::Node::new(accesskit::Role::Status);
                    node.set_live(accesskit::Live::Polite);
                    node.set_label(announcement);
                    tree.push_child(id, node);
                })
            })
    }
}

fn toolbar_button(
    id: &'static str,
    icon: &'static str,
    width: f32,
    selected: bool,
    _cx: &mut Context<BubbleOverlay>,
) -> gpui::Stateful<gpui::Div> {
    let label = match id {
        "close-button" => "Quit CamFrame",
        "fullscreen-button" => "Full screen",
        "shape-button" => "Change camera shape",
        "position-button" => "Frame camera",
        "prompter-button" => "Prompter link",
        _ => "Open camera controls",
    };
    div()
        .id(id)
        .role(gpui::Role::Button)
        .aria_label(label)
        .accessibility_id(id)
        .tab_index(0)
        .border_1()
        .border_color(if selected { rgb(0xeeeeef).into() } else { transparent_black() })
        .aria_toggled(if selected { accesskit::Toggled::True } else { accesskit::Toggled::False })
        .focus(|style| style.border_color(rgb(0xffffff)))
        .w(px(width))
        .min_w_0()
        .flex_shrink_0()
        .h(px(TOOLBAR_BUTTON))
        .flex()
        .items_center()
        .justify_center()
        .rounded(px(8.0))
        .cursor_pointer()
        .text_color(rgb(0x8b8b90))
        .group("toolbar-button")
        .hover(|style| style.bg(rgb(0x19191b)).text_color(rgb(0xe5e5e5)))
        .child(
            svg()
                .path(icon)
                .size(px(TOOLBAR_ICON))
                .flex_shrink_0()
                .text_color(rgb(if selected { 0xe8e8e8 } else { 0x8b8b90 }))
                .group_hover("toolbar-button", |s| s.text_color(rgb(0xe5e5e5))),
        )
}

/// The capture size in device pixels and the framing from Preferences.
fn output_view(settings: &Settings, size: u32, scale_factor: f32) -> OutputView {
    let (width, height) = dimensions_for(settings.shape, size);
    let scale = f64::from(scale_factor.clamp(1.0, 3.0));
    OutputView {
        width: (f64::from(width) * scale).round().max(1.0) as u32,
        height: (f64::from(height) * scale).round().max(1.0) as u32,
        mirror: settings.mirror,
        position: settings.camera_position,
        zoom: settings.camera_zoom,
    }
}

fn rect_of(bounds: Bounds<Pixels>) -> Rect {
    let value = |pixels: Pixels| f64::from(pixels).round() as i64;
    Rect::new(value(bounds.origin.x), value(bounds.origin.y), value(bounds.size.width), value(bounds.size.height))
}

fn gpui_bounds(rect: Rect) -> Bounds<Pixels> {
    Bounds::new(point(px(rect.x as f32), px(rect.y as f32)), size(px(rect.width as f32), px(rect.height as f32)))
}

/// The usable area of every display (without task bar or menu bar), and that of the main one.
fn work_areas(cx: &App) -> (Vec<Rect>, Rect) {
    let areas: Vec<Rect> = cx.displays().iter().map(|display| rect_of(display.visible_bounds())).collect();
    let primary = cx
        .primary_display()
        .map(|display| rect_of(display.visible_bounds()))
        .or_else(|| areas.first().copied())
        .unwrap_or(Rect::new(0, 0, 1920, 1080));
    (areas, primary)
}

/// `#rrggbb` or `#rgb` as a number for `rgb()`.
fn hex_color(text: &str) -> Option<u32> {
    let digits = text.strip_prefix('#')?;
    match digits.len() {
        6 => u32::from_str_radix(digits, 16).ok(),
        3 => {
            let short = u32::from_str_radix(digits, 16).ok()?;
            let (r, g, b) = ((short >> 8) & 0xf, (short >> 4) & 0xf, short & 0xf);
            Some((r * 0x11) << 16 | (g * 0x11) << 8 | (b * 0x11))
        }
        _ => None,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn border_colours_read_like_css() {
        assert_eq!(hex_color("#ffffff"), Some(0xffffff));
        assert_eq!(hex_color("#f80"), Some(0xff8800));
        assert_eq!(hex_color("white"), None);
    }

    #[test]
    fn the_capture_matches_the_surface_in_device_pixels() {
        let settings = Settings { shape: Shape::Landscape, ..Settings::default() };
        let view = output_view(&settings, 288, 2.0);
        assert_eq!((view.width, view.height), (576, 324));
        assert_eq!(view.zoom, settings.camera_zoom);
    }
}
