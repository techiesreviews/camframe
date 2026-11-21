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
use camframe_core::interaction::{Interaction, Target, target_at};
use camframe_core::settings::{OVERLAY_CHROME, Point, Settings, Shape, dimensions_for, overlay_dimensions_for};
use gpui::prelude::FluentBuilder;
use gpui::{
    App, AppContext, AssetSource, Bounds, Context, CursorStyle, FocusHandle, Focusable, InteractiveElement,
    IntoElement, KeyBinding, MouseButton, MouseDownEvent, ParentElement, Pixels, Render, RenderImage, SharedString,
    StatefulInteractiveElement, Styled, Window, WindowBackgroundAppearance, WindowBounds, WindowControlArea,
    WindowKind, WindowOptions, actions, div, img, point, px, rgb, size, svg, transparent_black,
};
use smallvec::SmallVec;

use crate::camera::{CameraSlot, CameraStatus, CameraWorker, OutputView, lock_unpoisoned};
#[cfg(target_os = "macos")]
use crate::mac_overlay as platform;
use crate::prefs::Prefs;
use crate::tray::{Tray, TrayCommand};
#[cfg(not(target_os = "macos"))]
use crate::win32_overlay as platform;

/// How often the pointer is read while idle, and while a corner is being dragged.
const POINTER_POLL: Duration = Duration::from_millis(33);
const POINTER_POLL_RESIZING: Duration = Duration::from_millis(16);
/// A moved window is saved once it has stood still this long.
const POSITION_SAVE_DELAY_MS: u64 = 400;

// 0.9.0's toolbar (`.hover-toolbar` in `src/overlay.css`).
const TOOLBAR_TOP: f32 = 22.0;
const TOOLBAR_MAX_WIDTH: f32 = 234.0;
const TOOLBAR_HEIGHT: f32 = 44.0;
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
}

/// The toolbar icons: Phosphor (regular), the same set 0.9.0 uses, as SVG files in the binary.
pub struct Icons;

impl AssetSource for Icons {
    fn load(&self, path: &str) -> anyhow::Result<Option<std::borrow::Cow<'static, [u8]>>> {
        let bytes: &'static [u8] = match path {
            "icons/x-circle.svg" => include_bytes!("../assets/icons/x-circle.svg"),
            "icons/circle.svg" => include_bytes!("../assets/icons/circle.svg"),
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
    status: CameraStatus,
    tray: Option<Tray>,
    launch_instant: Instant,
    metrics_file: Option<PathBuf>,
    startup_recorded: bool,
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

        let slot = Arc::new(CameraSlot::default());
        let (wake_tx, wake_rx) = async_channel::bounded::<()>(1);
        let initial_view = output_view(&settings, settings.size, window.scale_factor());
        let worker = CameraWorker::start(config.demo_pattern, initial_view, Arc::clone(&slot), wake_tx);

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
                }) else {
                    break;
                };
                let wait = if resizing { POINTER_POLL_RESIZING } else { POINTER_POLL };
                cx.background_executor().timer(wait).await;
            }
        })
        .detach();

        let (tray_tx, tray_rx) = async_channel::unbounded::<TrayCommand>();
        let tray = match Tray::new(settings.overlay_visible, tray_tx) {
            Ok(tray) => Some(tray),
            Err(error) => {
                eprintln!("CamFrame: no tray icon: {error:#}");
                None
            }
        };
        cx.spawn_in(window, async move |entity, cx| {
            while let Ok(command) = tray_rx.recv().await {
                if entity.update_in(cx, |this, window, cx| this.run_tray_command(command, window, cx)).is_err() {
                    break;
                }
            }
        })
        .detach();

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
            status: CameraStatus::Starting,
            tray,
            launch_instant: config.launch_instant,
            metrics_file: config.metrics_file,
            startup_recorded: false,
        }
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
        if let Some(status) = lock_unpoisoned(&self.slot.status).take() {
            self.status = status;
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

    fn sync_capture_view(&self, window: &Window) {
        *lock_unpoisoned(&self.slot.view) = Some(output_view(&self.settings, self.size(), window.scale_factor()));
    }

    /// Reads the pointer, moves a corner drag on, shows or hides the chrome, switches the click mode,
    /// and notices when the window was dragged somewhere new.
    fn poll_pointer(&mut self, window: &mut Window, cx: &mut Context<Self>) {
        if !self.settings.overlay_visible {
            return;
        }
        let now = self.now_ms();
        self.track_position(window, now);
        let Some(cursor) = platform::cursor_position(window) else {
            // Linux (development only): GPUI's own hover drives the chrome; see `render`.
            if self.interaction.tick(now) {
                cx.notify();
            }
            return;
        };

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
                platform::set_bounds(window, Rect::new(origin.x, origin.y, i64::from(width), i64::from(height)));
                self.last_origin = Some(origin);
                self.sync_capture_view(window);
                cx.notify();
            }
            if !platform::primary_button_down() {
                self.finish_resize(window, cx);
            }
        }

        let origin = window.bounds().origin;
        let local = (cursor.0 - f64::from(origin.x), cursor.1 - f64::from(origin.y));
        let was_hovered = self.interaction.hovered();
        let target = target_at(self.settings.shape, self.size(), local, was_hovered);
        self.interaction.pointer(target != Target::Nothing, now);
        let through = !self.interaction.interactive(target);
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
        let origin = rect_of(window.bounds()).origin();
        let moved = self.last_origin.is_some_and(|last| last != origin);
        self.last_origin = Some(origin);
        if moved && !self.pinned_position && self.resize.is_none() {
            self.settings.position = Some(origin);
            self.save_at = Some(now + POSITION_SAVE_DELAY_MS);
        }
        if self.save_at.is_some_and(|at| now >= at) {
            self.save_now();
        }
    }

    fn start_resize(&mut self, corner: Corner, window: &mut Window, cx: &mut Context<Self>) {
        let Some(cursor) = platform::cursor_position(window) else { return };
        let start_window = rect_of(window.bounds());
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
        self.settings = next;
        self.save_now();
        self.sync_capture_view(window);
        cx.notify();
    }

    /// Changes the shape and keeps the window's centre where it was, as 0.9.0 does.
    fn set_shape(&mut self, shape: Shape, window: &mut Window, cx: &mut Context<Self>) {
        if shape == self.settings.shape || self.resize.is_some() {
            return;
        }
        let (areas, primary) = work_areas(cx);
        let current = rect_of(window.bounds());
        let mut base = geometry::compact_base_bounds(shape, self.settings.size, None, Some(current), primary, true);
        if !areas.is_empty() {
            base = geometry::on_screen_base(base, &areas, primary, self.settings.prompter_margin);
        }
        platform::set_bounds(window, base);
        self.last_origin = Some(base.origin());
        self.settings.shape = shape;
        if !self.pinned_position {
            self.settings.position = Some(base.origin());
        }
        self.save_now();
        self.sync_capture_view(window);
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

    fn render_toolbar(&self, camera_width: f32, cx: &mut Context<Self>) -> impl IntoElement {
        let width = TOOLBAR_MAX_WIDTH.min(camera_width - 8.0);
        let left = OVERLAY_CHROME.left as f32 + (camera_width - width) / 2.0;
        div()
            .id("hover-toolbar")
            .absolute()
            .top(px(TOOLBAR_TOP))
            .left(px(left))
            .w(px(width))
            .h(px(TOOLBAR_HEIGHT))
            .flex()
            .items_center()
            .justify_center()
            .gap(px(2.0))
            .p(px(4.0))
            .rounded(px(10.0))
            .bg(rgb(0x0c0c0d))
            .child(toolbar_button("close-button", "icons/x-circle.svg").on_click(|_, _, cx| cx.quit()))
            .child(toolbar_button("shape-button", "icons/circle.svg").on_click(cx.listener(|this, _, window, cx| {
                let next = this.settings.shape.next();
                this.set_shape(next, window, cx);
            })))
    }

    fn render_camera(&self, camera_width: f32, camera_height: f32, cx: &mut Context<Self>) -> impl IntoElement {
        let radius = geometry::corner_radius(self.settings.shape, self.size()) as f32;
        let status_label: Option<SharedString> = match &self.status {
            CameraStatus::Starting if self.frame.is_none() => Some("Starting camera.".into()),
            CameraStatus::Unavailable(message) if self.frame.is_none() => Some(message.clone().into()),
            _ => None,
        };

        let mut camera = div()
            .id("camera-surface")
            .absolute()
            .left(px(OVERLAY_CHROME.left as f32))
            .top(px(OVERLAY_CHROME.top as f32))
            .w(px(camera_width))
            .h(px(camera_height))
            .rounded(px(radius))
            .overflow_hidden()
            .bg(rgb(0x18181b))
            .cursor_grab()
            .window_control_area(WindowControlArea::Drag);

        // `gpui_macos` ignores `WindowControlArea::Drag`, so on macOS the bubble starts the native
        // window drag itself.
        #[cfg(target_os = "macos")]
        {
            camera = camera.on_mouse_down(MouseButton::Left, |_event, window, _cx| {
                window.start_window_move();
            });
        }

        if let Some(frame) = self.frame.clone() {
            camera = camera.child(img(frame).w(px(camera_width)).h(px(camera_height)).rounded(px(radius)));
        } else if let Some(message) = status_label {
            camera = camera
                .flex()
                .items_center()
                .justify_center()
                .p(px(16.0))
                .child(div().text_xs().text_color(rgb(0xf4f4f5)).child(message));
        }

        // 0.9.0 draws the border inside the surface (`box-shadow: inset`).
        if self.settings.border_width > 0 {
            camera = camera.child(
                div()
                    .absolute()
                    .inset_0()
                    .rounded(px(radius))
                    .border(px(self.settings.border_width as f32))
                    .border_color(rgb(hex_color(&self.settings.border_color).unwrap_or(0xffffff))),
            );
        }
        let _ = cx;
        camera
    }

    fn render_handles(&self, camera_width: f32, camera_height: f32, cx: &mut Context<Self>) -> Vec<gpui::AnyElement> {
        let left = OVERLAY_CHROME.left as f32;
        let top = OVERLAY_CHROME.top as f32;
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
        let (camera_width, camera_height) = dimensions_for(shape, self.size());
        let (window_width, window_height) = overlay_dimensions_for(shape, self.size());
        let (camera_width, camera_height) = (camera_width as f32, camera_height as f32);
        let show_chrome = self.interaction.hovered() || self.resize.is_some();

        div()
            .id("overlay-root")
            .track_focus(&self.focus)
            .relative()
            .w(px(window_width as f32))
            .h(px(window_height as f32))
            .bg(transparent_black())
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
            .child(self.render_camera(camera_width, camera_height, cx))
            .when(show_chrome, |root| {
                root.child(self.render_toolbar(camera_width, cx)).children(self.render_handles(
                    camera_width,
                    camera_height,
                    cx,
                ))
            })
    }
}

fn toolbar_button(id: &'static str, icon: &'static str) -> gpui::Stateful<gpui::Div> {
    div()
        .id(id)
        .w(px(TOOLBAR_BUTTON))
        .h(px(TOOLBAR_BUTTON))
        .flex()
        .items_center()
        .justify_center()
        .rounded(px(8.0))
        .cursor_pointer()
        .text_color(rgb(0x8b8b90))
        .hover(|style| style.bg(rgb(0x19191b)).text_color(rgb(0xe5e5e5)))
        .child(svg().path(icon).size(px(TOOLBAR_ICON)).text_color(rgb(0x8b8b90)))
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
