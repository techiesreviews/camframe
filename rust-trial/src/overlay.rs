//! GPUI view for the floating transparent webcam bubble.

use std::path::PathBuf;
use std::sync::Arc;
use std::time::Instant;

use gpui::prelude::FluentBuilder;
use gpui::{
    App, AppContext, Bounds, Context, ElementId, FocusHandle, Focusable, Hsla, InteractiveElement,
    IntoElement, KeyBinding, MouseButton, MouseDownEvent, ParentElement, Render, RenderImage,
    SharedString, StatefulInteractiveElement, Styled, Window, WindowBackgroundAppearance,
    WindowBounds, WindowControlArea, WindowKind, WindowOptions, actions, div, hsla, img, point, px,
    rgb, size, transparent_black,
};
use smallvec::SmallVec;

use crate::camera::{CameraSlot, CameraStatus, CameraWorker, OutputView, lock_unpoisoned};
use crate::shape::{
    BubbleShape, DEFAULT_CAMERA_SIZE, OUTER_HEIGHT, OUTER_WIDTH, TOOLBAR_RESERVE_TOP,
};
use crate::win32_overlay;

actions!(
    camframe_trial,
    [
        CycleShape,
        ShapeCircle,
        ShapeSquare,
        ShapePortrait,
        ShapeLandscape,
        ToggleMirror,
        ToggleBorder,
        QuitApp,
    ]
);

pub struct LaunchConfig {
    pub initial_shape: BubbleShape,
    pub demo_pattern: bool,
    pub mirror: bool,
    pub border: bool,
    pub position: Option<(i32, i32)>,
    pub metrics_file: Option<PathBuf>,
    pub launch_instant: Instant,
}

pub fn bind_keys(cx: &mut App) {
    cx.bind_keys([
        KeyBinding::new("space", CycleShape, None),
        KeyBinding::new("s", CycleShape, None),
        KeyBinding::new("1", ShapeCircle, None),
        KeyBinding::new("2", ShapeSquare, None),
        KeyBinding::new("3", ShapePortrait, None),
        KeyBinding::new("4", ShapeLandscape, None),
        KeyBinding::new("m", ToggleMirror, None),
        KeyBinding::new("b", ToggleBorder, None),
        KeyBinding::new("escape", QuitApp, None),
        KeyBinding::new("q", QuitApp, None),
    ]);
}

pub fn open(config: LaunchConfig, cx: &mut App) -> anyhow::Result<()> {
    let window_size = size(px(OUTER_WIDTH), px(OUTER_HEIGHT));
    let bounds = match config.position {
        Some((x, y)) => Bounds::new(point(px(x as f32), px(y as f32)), window_size),
        None => Bounds::centered(None, window_size, cx),
    };

    let options = WindowOptions {
        window_bounds: Some(WindowBounds::Windowed(bounds)),
        titlebar: None,
        focus: true,
        show: true,
        kind: WindowKind::PopUp,
        is_movable: true,
        app_owns_titlebar_drag: true,
        is_resizable: false,
        is_minimizable: false,
        // Keep rendering smooth webcam frames even when another application has focus.
        inactive_frame_interval: None,
        window_background: WindowBackgroundAppearance::Transparent,
        app_id: Some("camframe-trial".into()),
        ..WindowOptions::default()
    };

    let position = config.position;
    cx.open_window(options, |window, cx| {
        if let Err(err) = win32_overlay::configure_transparent_overlay(window, position) {
            eprintln!("win32 transparent overlay configuration failed: {err}");
        }
        cx.new(|cx| BubbleOverlay::new(config, window, cx))
    })?;

    Ok(())
}

pub struct BubbleOverlay {
    shape: BubbleShape,
    mirror: bool,
    border: bool,
    hovered: bool,
    focus: FocusHandle,
    slot: Arc<CameraSlot>,
    _worker: CameraWorker,
    frame: Option<Arc<RenderImage>>,
    status: CameraStatus,
    launch_instant: Instant,
    metrics_file: Option<PathBuf>,
    startup_recorded: bool,
}

impl BubbleOverlay {
    fn new(config: LaunchConfig, window: &mut Window, cx: &mut Context<Self>) -> Self {
        let focus = cx.focus_handle();
        focus.focus(window, cx);

        let slot = Arc::new(CameraSlot::default());
        let (wake_tx, wake_rx) = async_channel::bounded::<()>(1);
        let initial_view = output_view_for(config.initial_shape, config.mirror, window.scale_factor());
        let worker = CameraWorker::start(config.demo_pattern, initial_view, Arc::clone(&slot), wake_tx);

        cx.spawn_in(window, async move |entity, cx| {
            while wake_rx.recv().await.is_ok() {
                let ok = entity.update_in(cx, |this, window, cx| {
                    this.pull_camera_update(window, cx);
                });
                if ok.is_err() {
                    break;
                }
            }
        })
        .detach();

        Self {
            shape: config.initial_shape,
            mirror: config.mirror,
            border: config.border,
            hovered: false,
            focus,
            slot,
            _worker: worker,
            frame: None,
            status: CameraStatus::Starting,
            launch_instant: config.launch_instant,
            metrics_file: config.metrics_file,
            startup_recorded: false,
        }
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
        let next = output_view_for(self.shape, self.mirror, window.scale_factor());
        *lock_unpoisoned(&self.slot.view) = Some(next);
    }

    fn set_shape(&mut self, shape: BubbleShape, window: &mut Window, cx: &mut Context<Self>) {
        if self.shape == shape {
            return;
        }
        self.shape = shape;
        self.sync_capture_view(window);
        cx.notify();
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
                let content = format!("STARTUP_FIRST_FRAME_MS={elapsed_ms:.2}\n");
                let _ = std::fs::write(path, content);
            }
        });
    }

    fn render_shape_button(
        &self,
        id: &'static str,
        target: BubbleShape,
        cx: &mut Context<Self>,
    ) -> impl IntoElement {
        let selected = self.shape == target;
        let glyph = match target {
            BubbleShape::Circle => div().w(px(14.0)).h(px(14.0)).rounded_full(),
            BubbleShape::RoundedSquare => div().w(px(14.0)).h(px(14.0)).rounded(px(3.5)),
            BubbleShape::Portrait => div().w(px(11.0)).h(px(15.0)).rounded(px(2.5)),
            BubbleShape::Landscape => div().w(px(16.0)).h(px(10.0)).rounded(px(2.5)),
        }
        .border_2()
        .border_color(if selected { rgb(0xf4f4f5) } else { rgb(0xa1a1aa) });

        let mut btn = div()
            .id(ElementId::Name(id.into()))
            .w(px(32.0))
            .h(px(32.0))
            .rounded(px(7.0))
            .flex()
            .items_center()
            .justify_center()
            .cursor_pointer()
            .hover(|s| s.bg(rgb(0x27272a)))
            .on_click(cx.listener(move |this, _, window, cx| {
                this.set_shape(target, window, cx);
            }))
            .child(glyph);

        if selected {
            btn = btn.border_1().border_color(rgb(0xeeeeef)).bg(rgb(0x1f1f23));
        }

        btn
    }

    fn render_hover_toolbar(&self, cx: &mut Context<Self>) -> impl IntoElement {
        let border_active = self.border;
        let mirror_active = self.mirror;

        div()
            .h(px(TOOLBAR_RESERVE_TOP))
            .w_full()
            .flex()
            .items_center()
            .justify_center()
            .child(
                div()
                    .flex()
                    .flex_row()
                    .items_center()
                    .gap(px(3.0))
                    .p(px(4.0))
                    .rounded(px(10.0))
                    .bg(rgb(0x0c0c0d))
                    .border_1()
                    .border_color(white_alpha(0.14))
                    .child(self.render_shape_button("shape-circle", BubbleShape::Circle, cx))
                    .child(self.render_shape_button("shape-square", BubbleShape::RoundedSquare, cx))
                    .child(self.render_shape_button("shape-portrait", BubbleShape::Portrait, cx))
                    .child(self.render_shape_button("shape-landscape", BubbleShape::Landscape, cx))
                    .child(
                        div()
                            .w(px(1.0))
                            .h(px(18.0))
                            .mx(px(2.0))
                            .bg(white_alpha(0.12)),
                    )
                    .child(
                        div()
                            .id("toggle-border")
                            .w(px(30.0))
                            .h(px(32.0))
                            .rounded(px(7.0))
                            .flex()
                            .items_center()
                            .justify_center()
                            .cursor_pointer()
                            .text_xs()
                            .text_color(if border_active { rgb(0xf4f4f5) } else { rgb(0xa1a1aa) })
                            .when(border_active, |s| s.border_1().border_color(rgb(0xeeeeef)).bg(rgb(0x1f1f23)))
                            .hover(|s| s.bg(rgb(0x27272a)))
                            .on_click(cx.listener(|this, _, _window, cx| {
                                this.border = !this.border;
                                cx.notify();
                            }))
                            .child("B"),
                    )
                    .child(
                        div()
                            .id("toggle-mirror")
                            .w(px(30.0))
                            .h(px(32.0))
                            .rounded(px(7.0))
                            .flex()
                            .items_center()
                            .justify_center()
                            .cursor_pointer()
                            .text_xs()
                            .text_color(if mirror_active { rgb(0xf4f4f5) } else { rgb(0xa1a1aa) })
                            .when(mirror_active, |s| s.border_1().border_color(rgb(0xeeeeef)).bg(rgb(0x1f1f23)))
                            .hover(|s| s.bg(rgb(0x27272a)))
                            .on_click(cx.listener(|this, _, window, cx| {
                                this.mirror = !this.mirror;
                                this.sync_capture_view(window);
                                cx.notify();
                            }))
                            .child("M"),
                    )
                    .child(
                        div()
                            .id("close-app")
                            .w(px(30.0))
                            .h(px(32.0))
                            .rounded(px(7.0))
                            .flex()
                            .items_center()
                            .justify_center()
                            .cursor_pointer()
                            .text_sm()
                            .text_color(rgb(0xa1a1aa))
                            .hover(|s| s.bg(rgb(0x3f1d1d)).text_color(rgb(0xffffff)))
                            .on_click(|_, _, cx| cx.quit())
                            .child("×"),
                    ),
            )
    }

    fn render_camera_bubble(&self, cx: &mut Context<Self>) -> impl IntoElement {
        let (cam_w, cam_h) = self.shape.dimensions(DEFAULT_CAMERA_SIZE);
        let radius = self.shape.corner_radius(DEFAULT_CAMERA_SIZE);
        let frame = self.frame.clone();
        let status_label: Option<SharedString> = match &self.status {
            CameraStatus::Starting if frame.is_none() => Some("Starting camera…".into()),
            CameraStatus::Unavailable(msg) if frame.is_none() => Some(msg.clone().into()),
            _ => None,
        };

        let mut bubble = div()
            .id("camera-bubble")
            .relative()
            .w(px(cam_w))
            .h(px(cam_h))
            .rounded(px(radius))
            .overflow_hidden()
            .bg(rgb(0x18181b))
            .cursor_grab()
            .window_control_area(WindowControlArea::Drag)
            .on_mouse_down(
                MouseButton::Right,
                cx.listener(|this, _event: &MouseDownEvent, window, cx| {
                    let next = this.shape.next();
                    this.set_shape(next, window, cx);
                }),
            );

        if let Some(render_image) = frame {
            bubble = bubble.child(
                img(render_image)
                    .w(px(cam_w))
                    .h(px(cam_h))
                    .rounded(px(radius)),
            );
        } else if let Some(message) = status_label {
            bubble = bubble.flex().items_center().justify_center().p(px(16.0)).child(
                div()
                    .text_xs()
                    .text_color(rgb(0xf4f4f5))
                    .child(message),
            );
        }

        if self.border {
            bubble = bubble.child(
                div()
                    .absolute()
                    .inset_0()
                    .rounded(px(radius))
                    .border(px(3.0))
                    .border_color(rgb(0xffffff)),
            );
        }

        bubble
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

        let show_toolbar = self.hovered;

        div()
            .id("overlay-root")
            .track_focus(&self.focus)
            .w(px(OUTER_WIDTH))
            .h(px(OUTER_HEIGHT))
            .bg(transparent_black())
            .flex()
            .flex_col()
            .items_center()
            .on_hover(cx.listener(|this, &hovered, _window, cx| {
                if this.hovered != hovered {
                    this.hovered = hovered;
                    cx.notify();
                }
            }))
            .on_action(cx.listener(|this, _: &CycleShape, window, cx| {
                let next = this.shape.next();
                this.set_shape(next, window, cx);
            }))
            .on_action(cx.listener(|this, _: &ShapeCircle, window, cx| {
                this.set_shape(BubbleShape::Circle, window, cx);
            }))
            .on_action(cx.listener(|this, _: &ShapeSquare, window, cx| {
                this.set_shape(BubbleShape::RoundedSquare, window, cx);
            }))
            .on_action(cx.listener(|this, _: &ShapePortrait, window, cx| {
                this.set_shape(BubbleShape::Portrait, window, cx);
            }))
            .on_action(cx.listener(|this, _: &ShapeLandscape, window, cx| {
                this.set_shape(BubbleShape::Landscape, window, cx);
            }))
            .on_action(cx.listener(|this, _: &ToggleMirror, window, cx| {
                this.mirror = !this.mirror;
                this.sync_capture_view(window);
                cx.notify();
            }))
            .on_action(cx.listener(|this, _: &ToggleBorder, _window, cx| {
                this.border = !this.border;
                cx.notify();
            }))
            .on_action(|_: &QuitApp, _window, cx| {
                cx.quit();
            })
            .child(if show_toolbar {
                self.render_hover_toolbar(cx).into_any_element()
            } else {
                div().h(px(TOOLBAR_RESERVE_TOP)).w_full().into_any_element()
            })
            .child(
                div()
                    .w(px(DEFAULT_CAMERA_SIZE))
                    .h(px(DEFAULT_CAMERA_SIZE))
                    .flex()
                    .items_center()
                    .justify_center()
                    .child(self.render_camera_bubble(cx)),
            )
    }
}

fn output_view_for(shape: BubbleShape, mirror: bool, scale_factor: f32) -> OutputView {
    let (w, h) = shape.dimensions(DEFAULT_CAMERA_SIZE);
    let scale = scale_factor.clamp(1.0, 3.0);
    OutputView {
        width: (w * scale).round().max(1.0) as u32,
        height: (h * scale).round().max(1.0) as u32,
        mirror,
    }
}

fn white_alpha(alpha: f32) -> Hsla {
    hsla(0.0, 0.0, 1.0, alpha)
}
