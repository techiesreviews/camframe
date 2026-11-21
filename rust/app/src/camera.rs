//! Native webcam capture + BGRA conversion for GPUI (`nokhwa` native backend + pure-Rust `zune-jpeg`).
//!
//! Runs on a dedicated OS thread and publishes only the latest frame, so the UI never queues stale
//! video frames. Also includes a deterministic `--demo-pattern` source for camera-less CI verification.

use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex, MutexGuard};
use std::thread::JoinHandle;
use std::time::{Duration, Instant};

use camframe_core::framing::visible_source_rect;
use camframe_core::settings::{CameraPosition, Resolution};

use nokhwa::Camera;
use nokhwa::utils::{ApiBackend, CameraFormat, CameraIndex, FrameFormat, RequestedFormat, RequestedFormatType};
use zune_jpeg::JpegDecoder;
use zune_jpeg::zune_core::bytestream::ZCursor;
use zune_jpeg::zune_core::colorspace::ColorSpace;
use zune_jpeg::zune_core::options::DecoderOptions;

/// Target capture resolution matching CamFrame 0.9.0 default (`720p`).
const MIN_FRAME_RATE: u32 = 30;
const SMOOTH_FRAME_RATE: u32 = 50;
const MAX_CONSECUTIVE_FAILURES: u32 = 30;

// The camera messages use CamFrame 0.9.0's exact words (src/camera-session.js `cameraErrorMessage`).
#[cfg(target_os = "macos")]
const CAMERA_BLOCKED_MESSAGE: &str = "Camera access is blocked. In System Settings, allow CamFrame to use the camera.";
#[cfg(target_os = "windows")]
const CAMERA_BLOCKED_MESSAGE: &str =
    "Camera access is blocked. In Windows Settings, allow camera access for desktop apps.";
#[cfg(not(any(target_os = "macos", target_os = "windows")))]
const CAMERA_BLOCKED_MESSAGE: &str =
    "Camera access is blocked. Allow CamFrame to use the camera in system privacy settings.";
const CAMERA_IN_USE_MESSAGE: &str = "This camera is already in use by another app.";
const CAMERA_FAILED_MESSAGE: &str = "CamFrame could not start this camera.";
/// 0.9.0 has no separate message for "no camera connected": it shows its general one.
const NO_CAMERA_MESSAGE: &str = CAMERA_FAILED_MESSAGE;

const DECODABLE_FORMATS: [FrameFormat; 6] = [
    FrameFormat::MJPEG,
    FrameFormat::YUYV,
    FrameFormat::NV12,
    FrameFormat::RAWRGB,
    FrameFormat::RAWBGR,
    FrameFormat::GRAY,
];

/// A decoded frame in GPUI's native BGRA8 layout.
#[derive(Clone)]
pub struct BgraFrame {
    pub width: u32,
    pub height: u32,
    pub bytes: Vec<u8>,
}

/// Desired output framing for the camera surface: its size in device pixels, the mirror, and the
/// framing origin (percent) and zoom (percent) from Preferences.
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct OutputView {
    pub width: u32,
    pub height: u32,
    pub mirror: bool,
    pub position: CameraPosition,
    pub zoom: u32,
}

impl Default for OutputView {
    fn default() -> Self {
        OutputView { width: 288, height: 288, mirror: true, position: CameraPosition { x: 50.0, y: 50.0 }, zoom: 100 }
    }
}

#[derive(Clone, Debug)]
pub enum CameraStatus {
    Starting,
    Live,
    DemoPattern,
    Unavailable(String),
}

#[derive(Default)]
pub struct CameraSlot {
    pub frame: Mutex<Option<BgraFrame>>,
    pub status: Mutex<Option<CameraStatus>>,
    pub view: Mutex<Option<OutputView>>,
    pub request: Mutex<CaptureRequest>,
    pub devices: Mutex<Vec<Device>>,
    pub effect: Mutex<Option<(camframe_core::settings::Shape, u32, u32, u32)>>,
    pub halo: Mutex<Option<BgraFrame>>,
    inventory: Mutex<Option<Result<Vec<nokhwa::utils::CameraInfo>, String>>>,
    pub rejection: Mutex<Option<(CaptureRequest, Resolution, String)>>,
}

#[derive(Clone, Debug, PartialEq, Default)]
pub struct CaptureRequest {
    pub device: String,
    pub label: String,
    pub resolution: Resolution,
}

#[derive(Clone, Debug, PartialEq)]
pub struct Device {
    pub id: String,
    pub label: String,
}

fn camera_label(name: &str, index: usize) -> String {
    if name.trim().is_empty() { format!("Camera {}", index + 1) } else { name.trim().into() }
}

fn device_id(info: &nokhwa::utils::CameraInfo) -> String {
    let unique = info.misc();
    if unique.is_empty() { info.index().as_string() } else { unique }
}

#[derive(Debug, PartialEq, Eq)]
enum DeviceChoice {
    Wait,
    Unavailable,
    Device(usize),
}

fn choose_device(
    seen_inventory: bool,
    devices: &[nokhwa::utils::CameraInfo],
    request: &CaptureRequest,
) -> DeviceChoice {
    if !seen_inventory {
        return DeviceChoice::Wait;
    }
    if devices.is_empty() {
        return DeviceChoice::Unavailable;
    }
    if let Some(index) = devices.iter().position(|info| device_id(info) == request.device) {
        return DeviceChoice::Device(index);
    }
    if !request.label.trim().is_empty() && request.label != "Default camera" {
        let matches = devices
            .iter()
            .enumerate()
            .filter(|(_, info)| info.human_name().trim() == request.label.trim())
            .map(|(i, _)| i)
            .collect::<Vec<_>>();
        if matches.len() == 1 {
            return DeviceChoice::Device(matches[0]);
        }
    }
    DeviceChoice::Device(0)
}

pub fn lock_unpoisoned<T>(mutex: &Mutex<T>) -> MutexGuard<'_, T> {
    mutex.lock().unwrap_or_else(|poisoned| poisoned.into_inner())
}

pub struct CameraWorker {
    stop: Arc<AtomicBool>,
    handle: Option<JoinHandle<()>>,
    scan: Option<JoinHandle<()>>,
}

impl CameraWorker {
    pub fn start(
        demo_pattern: bool,
        initial_view: OutputView,
        slot: Arc<CameraSlot>,
        wake: async_channel::Sender<()>,
    ) -> Self {
        *lock_unpoisoned(&slot.view) = Some(initial_view);
        let stop = Arc::new(AtomicBool::new(false));
        let stop_flag = Arc::clone(&stop);
        let scan = if demo_pattern {
            None
        } else {
            let stop = Arc::clone(&stop);
            let slot = Arc::clone(&slot);
            let wake = wake.clone();
            Some(std::thread::spawn(move || {
                while !stop.load(Ordering::Relaxed) {
                    let result = nokhwa::query(ApiBackend::Auto).map_err(|error| classify_error(&error.to_string()));
                    if let Ok(devices) = &result {
                        *lock_unpoisoned(&slot.devices) = devices
                            .iter()
                            .enumerate()
                            .map(|(i, info)| Device { id: device_id(info), label: camera_label(&info.human_name(), i) })
                            .collect();
                    }
                    *lock_unpoisoned(&slot.inventory) = Some(result);
                    let _ = wake.try_send(());
                    for _ in 0..20 {
                        if stop.load(Ordering::Relaxed) {
                            return;
                        }
                        std::thread::sleep(Duration::from_millis(100));
                    }
                }
            }))
        };
        let handle = std::thread::Builder::new()
            .name("camframe-capture".into())
            .spawn(move || {
                // Without a camera the bubble keeps the message on screen, as in 0.9.0; the
                // test picture shows only when asked for with --demo-pattern.
                if demo_pattern {
                    run_demo_loop(&stop_flag, &slot, &wake);
                } else {
                    run_webcam_loop(&stop_flag, &slot, &wake);
                }
            })
            .ok();
        Self { stop, handle, scan }
    }
}

impl Drop for CameraWorker {
    fn drop(&mut self) {
        self.stop.store(true, Ordering::Relaxed);
        if let Some(handle) = self.handle.take() {
            let _ = handle.join();
        }
        if let Some(scan) = self.scan.take() {
            let _ = scan.join();
        }
    }
}

fn publish_status(slot: &CameraSlot, wake: &async_channel::Sender<()>, status: CameraStatus) {
    *lock_unpoisoned(&slot.status) = Some(status);
    let _ = wake.try_send(());
}

fn publish_frame(slot: &CameraSlot, wake: &async_channel::Sender<()>, frame: BgraFrame) {
    if let Some((shape, size, amount, opacity)) = *lock_unpoisoned(&slot.effect) {
        *lock_unpoisoned(&slot.halo) = Some(blur_halo(&frame, shape, size, amount, opacity));
    }
    *lock_unpoisoned(&slot.frame) = Some(frame);
    let _ = wake.try_send(());
}

fn run_demo_loop(stop: &AtomicBool, slot: &CameraSlot, wake: &async_channel::Sender<()>) {
    publish_status(slot, wake, CameraStatus::DemoPattern);
    let mut tick: u32 = 0;
    while !stop.load(Ordering::Relaxed) {
        let view = lock_unpoisoned(&slot.view).unwrap_or_default();
        let frame = generate_demo_pattern(view.width.max(1), view.height.max(1), tick);
        publish_frame(slot, wake, frame);
        tick = tick.wrapping_add(1);
        std::thread::sleep(Duration::from_millis(33));
    }
}

/// Counts camera frames in a row that could not be read or decoded.
#[derive(Default)]
struct FailureCount(u32);

impl FailureCount {
    /// Adds one failure and says whether the camera should now give up.
    fn add(&mut self) -> bool {
        self.0 += 1;
        self.0 >= MAX_CONSECUTIVE_FAILURES
    }

    fn reset(&mut self) {
        self.0 = 0;
    }
}

fn camera_unavailable(slot: &CameraSlot, wake: &async_channel::Sender<()>, message: impl Into<String>) {
    publish_status(slot, wake, CameraStatus::Unavailable(message.into()));
}

/// Streams the first camera until `stop` is set. When the camera cannot start, or stops sending
/// usable frames, the status shows why.
fn run_webcam_loop(stop: &AtomicBool, slot: &CameraSlot, wake: &async_channel::Sender<()>) {
    #[cfg(target_os = "macos")]
    if let Err(msg) = wait_for_camera_permission(stop) {
        return camera_unavailable(slot, wake, msg);
    }

    let mut camera: Option<Camera> = None;
    let mut applied: Option<CaptureRequest> = None;
    let mut pending = lock_unpoisoned(&slot.request).clone();
    let mut changed_at = Instant::now() - Duration::from_secs(1);
    let mut devices = Vec::new();
    let mut seen_inventory = false;
    let mut last_working_resolution = Resolution::R720;
    let mut scan_error: Option<String> = None;
    let mut current_device = String::new();
    let mut failures = FailureCount::default();
    while !stop.load(Ordering::Relaxed) {
        let wanted = lock_unpoisoned(&slot.request).clone();
        if wanted != pending {
            pending = wanted;
            changed_at = Instant::now();
        }
        if let Some(scan) = lock_unpoisoned(&slot.inventory).take() {
            seen_inventory = true;
            if let Ok(list) = scan {
                devices = list;
                scan_error = None;
                if camera.is_some() && !devices.iter().any(|info| device_id(info) == current_device) {
                    if let Some(mut disconnected) = camera.take() {
                        let _ = disconnected.stop_stream();
                    }
                    applied = None;
                }
            } else if let Err(message) = scan {
                scan_error = Some(message.clone());
                if camera.is_none() {
                    camera_unavailable(slot, wake, message);
                }
            }
        }
        if choose_device(seen_inventory, &devices, &pending) == DeviceChoice::Wait {
            std::thread::sleep(Duration::from_millis(10));
            continue;
        }
        if changed_at.elapsed() >= Duration::from_millis(200) && applied.as_ref() != Some(&pending) {
            if let Some(current) = camera.as_mut()
                && applied.as_ref().is_some_and(|old| old.device == pending.device)
            {
                // Keep the same device and restore its working mode if the driver refuses a switch.
                let old = current.camera_format();
                let switched = current
                    .compatible_camera_formats()
                    .map_err(|error| error.to_string())
                    .and_then(|formats| {
                        pick_best_format(&formats, pending.resolution)
                            .ok_or_else(|| "This quality is not available.".to_string())
                    })
                    .and_then(|best| {
                        current
                            .set_camera_requset(RequestedFormat::with_formats(
                                RequestedFormatType::Exact(best),
                                &DECODABLE_FORMATS,
                            ))
                            .map_err(|error| error.to_string())
                    });
                if let Err(error) = switched {
                    let _ = current.set_camera_requset(RequestedFormat::with_formats(
                        RequestedFormatType::Exact(old),
                        &DECODABLE_FORMATS,
                    ));
                    let _ = current.open_stream();
                    let old_resolution = last_working_resolution;
                    *lock_unpoisoned(&slot.rejection) = Some((
                        pending.clone(),
                        old_resolution,
                        format!("{} The previous quality is kept.", classify_error(&error)),
                    ));
                    publish_status(slot, wake, CameraStatus::Live);
                } else {
                    last_working_resolution = pending.resolution;
                }
                applied = Some(pending.clone());
            } else {
                if let Some(mut previous) = camera.take() {
                    let _ = previous.stop_stream();
                }
                let info = match choose_device(seen_inventory, &devices, &pending) {
                    DeviceChoice::Device(index) => devices.get(index),
                    _ => None,
                };
                if let Some(info) = info {
                    let unique = device_id(info);
                    let index =
                        if info.misc().is_empty() { info.index().clone() } else { CameraIndex::String(unique.clone()) };
                    match open_preferred_camera(index, pending.resolution).and_then(|mut next| {
                        next.open_stream().map_err(|error| classify_error(&error.to_string()))?;
                        Ok(next)
                    }) {
                        Ok(next) => {
                            camera = Some(next);
                            current_device = unique;
                            applied = Some(pending.clone());
                            last_working_resolution = pending.resolution;
                            failures.reset();
                            publish_status(slot, wake, CameraStatus::Live);
                        }
                        Err(message) => camera_unavailable(slot, wake, message),
                    }
                } else {
                    camera_unavailable(slot, wake, scan_error.as_deref().unwrap_or(NO_CAMERA_MESSAGE));
                }
                if camera.is_none() {
                    changed_at = Instant::now() + Duration::from_secs(1);
                }
            }
        }
        let Some(current) = camera.as_mut() else {
            std::thread::sleep(Duration::from_millis(100));
            continue;
        };
        let failure = match current.frame() {
            Ok(buffer) => {
                let res = buffer.resolution();
                let format = buffer.source_frame_format();
                match decode_to_bgra(format, buffer.buffer(), res.width(), res.height()) {
                    Some(decoded) => {
                        failures.reset();
                        let view = lock_unpoisoned(&slot.view).unwrap_or_default();
                        publish_frame(slot, wake, cover_resample(&decoded, view));
                        continue;
                    }
                    None => CAMERA_FAILED_MESSAGE.to_string(),
                }
            }
            Err(err) => classify_error(&err.to_string()),
        };
        if failures.add() {
            camera_unavailable(slot, wake, failure);
            if let Some(mut failed) = camera.take() {
                let _ = failed.stop_stream();
            }
            applied = None;
            changed_at = Instant::now() + Duration::from_secs(1);
        }
        std::thread::sleep(Duration::from_millis(16));
    }

    if let Some(mut camera) = camera {
        let _ = camera.stop_stream();
    }
}

/// Asks macOS for camera access (the system prompt shows once per app) and waits for the answer.
#[cfg(target_os = "macos")]
fn wait_for_camera_permission(stop: &AtomicBool) -> Result<(), String> {
    if nokhwa::nokhwa_check() {
        return Ok(());
    }
    let (answer_tx, answer_rx) = std::sync::mpsc::channel::<bool>();
    nokhwa::nokhwa_initialize(move |granted| {
        let _ = answer_tx.send(granted);
    });
    // The prompt waits for the person, so keep waiting (in short steps) until they answer or quit.
    while !stop.load(Ordering::Relaxed) {
        match answer_rx.recv_timeout(Duration::from_millis(200)) {
            Ok(true) => return Ok(()),
            Ok(false) => return Err(CAMERA_BLOCKED_MESSAGE.into()),
            Err(std::sync::mpsc::RecvTimeoutError::Timeout) => {}
            Err(std::sync::mpsc::RecvTimeoutError::Disconnected) => {
                return Err(CAMERA_BLOCKED_MESSAGE.into());
            }
        }
    }
    Err("Camera permission prompt closed".into())
}

fn open_preferred_camera(index: CameraIndex, resolution: Resolution) -> Result<Camera, String> {
    let initial_request =
        RequestedFormat::new::<nokhwa::pixel_format::RgbFormat>(RequestedFormatType::AbsoluteHighestFrameRate);
    let mut camera = Camera::new(index, initial_request).map_err(|err| classify_error(&err.to_string()))?;

    if let Ok(formats) = camera.compatible_camera_formats()
        && let Some(best) = pick_best_format(&formats, resolution)
    {
        let exact = RequestedFormat::new::<nokhwa::pixel_format::RgbFormat>(RequestedFormatType::Exact(best));
        let _ = camera.set_camera_requset(exact);
    }

    Ok(camera)
}

fn pick_best_format(formats: &[CameraFormat], resolution: Resolution) -> Option<CameraFormat> {
    let (target_width, target_height) = resolution.size();
    let tier = |f: &CameraFormat| -> u8 {
        let fps = f.frame_rate();
        if fps >= SMOOTH_FRAME_RATE {
            0
        } else if fps >= MIN_FRAME_RATE {
            1
        } else {
            2
        }
    };
    let distance = |f: &CameraFormat| f.width().abs_diff(target_width) + f.height().abs_diff(target_height);
    let decode_cost = |f: &CameraFormat| u8::from(f.format() == FrameFormat::MJPEG);

    formats
        .iter()
        .filter(|f| DECODABLE_FORMATS.contains(&f.format()))
        .min_by_key(|f| {
            (
                u8::from(f.width() < target_width || f.height() < target_height),
                tier(f),
                distance(f),
                std::cmp::Reverse(f.frame_rate()),
                decode_cost(f),
            )
        })
        .copied()
}

fn classify_error(raw: &str) -> String {
    let lower = raw.to_ascii_lowercase();
    if ["permission", "denied", "access is denied", "not authorized"].iter().any(|needle| lower.contains(needle)) {
        CAMERA_BLOCKED_MESSAGE.into()
    } else if ["busy", "in use", "ebusy"].iter().any(|needle| lower.contains(needle)) {
        CAMERA_IN_USE_MESSAGE.into()
    } else {
        CAMERA_FAILED_MESSAGE.into()
    }
}

/// Decodes a camera frame buffer straight into BGRA8.
pub fn decode_to_bgra(format: FrameFormat, data: &[u8], width: u32, height: u32) -> Option<BgraFrame> {
    if format == FrameFormat::MJPEG {
        let options = DecoderOptions::default().jpeg_set_out_colorspace(ColorSpace::BGRA);
        let mut decoder = JpegDecoder::new_with_options(ZCursor::new(data), options);
        let bytes = decoder.decode().ok()?;
        let info = decoder.info()?;
        let (w, h) = (u32::from(info.width), u32::from(info.height));
        return (w > 0 && h > 0 && bytes.len() == w as usize * h as usize * 4).then_some(BgraFrame {
            width: w,
            height: h,
            bytes,
        });
    }

    let pixels = (width as usize).checked_mul(height as usize)?;
    if pixels == 0 {
        return None;
    }

    let bytes = match format {
        FrameFormat::MJPEG => return None,
        FrameFormat::YUYV => {
            if data.len() < pixels * 2 {
                return None;
            }
            let mut out = Vec::with_capacity(pixels * 4);
            for &[y0, u, y1, v] in data[..pixels * 2].as_chunks::<4>().0 {
                out.extend_from_slice(&yuv_to_bgra(y0, u, v));
                out.extend_from_slice(&yuv_to_bgra(y1, u, v));
            }
            out
        }
        FrameFormat::NV12 => {
            let (w, h) = (width as usize, height as usize);
            if !w.is_multiple_of(2) || !h.is_multiple_of(2) || data.len() < pixels + pixels / 2 {
                return None;
            }
            let (luma, chroma) = data.split_at(pixels);
            let mut out = Vec::with_capacity(pixels * 4);
            for row in 0..h {
                for col in 0..w {
                    let uv = (row / 2) * w + (col / 2) * 2;
                    out.extend_from_slice(&yuv_to_bgra(luma[row * w + col], chroma[uv], chroma[uv + 1]));
                }
            }
            out
        }
        FrameFormat::RAWRGB => {
            if data.len() < pixels * 3 {
                return None;
            }
            let mut out = Vec::with_capacity(pixels * 4);
            for &[r, g, b] in data[..pixels * 3].as_chunks::<3>().0 {
                out.extend_from_slice(&[b, g, r, 255]);
            }
            out
        }
        FrameFormat::RAWBGR => {
            if data.len() < pixels * 3 {
                return None;
            }
            let mut out = Vec::with_capacity(pixels * 4);
            for &[b, g, r] in data[..pixels * 3].as_chunks::<3>().0 {
                out.extend_from_slice(&[b, g, r, 255]);
            }
            out
        }
        FrameFormat::GRAY => {
            if data.len() < pixels {
                return None;
            }
            let mut out = Vec::with_capacity(pixels * 4);
            for &luma in &data[..pixels] {
                out.extend_from_slice(&[luma, luma, luma, 255]);
            }
            out
        }
    };

    Some(BgraFrame { width, height, bytes })
}

#[inline]
fn yuv_to_bgra(y: u8, u: u8, v: u8) -> [u8; 4] {
    let c = i32::from(y) - 16;
    let d = i32::from(u) - 128;
    let e = i32::from(v) - 128;
    let r = ((298 * c + 409 * e + 128) >> 8).clamp(0, 255) as u8;
    let g = ((298 * c - 100 * d - 208 * e + 128) >> 8).clamp(0, 255) as u8;
    let b = ((298 * c + 516 * d + 128) >> 8).clamp(0, 255) as u8;
    [b, g, r, 255]
}

/// Cuts out the part of the frame the framing shows (cover crop at the framing origin, then zoom
/// around it), resamples it to `view.width × view.height`, and mirrors the cut-out as a whole, so
/// a mirrored, off-centre framing still fills the bubble (known gap KG-10 of 0.9.0).
pub fn cover_resample(source: &BgraFrame, view: OutputView) -> BgraFrame {
    let dst_w = view.width.max(1);
    let dst_h = view.height.max(1);
    let src_w = source.width.max(1);
    let src_h = source.height.max(1);

    let (left, top, width, height) =
        visible_source_rect((src_w, src_h), (f64::from(dst_w), f64::from(dst_h)), view.position, view.zoom);
    let (crop_x0, crop_y0) = (left as f32, top as f32);
    let (visible_src_w, visible_src_h) = (width as f32, height as f32);

    let mut x_map = Vec::with_capacity(dst_w as usize);
    for dx in 0..dst_w {
        let u = (dx as f32 + 0.5) / dst_w as f32;
        let u_mirrored = if view.mirror { 1.0 - u } else { u };
        let sx = (crop_x0 + u_mirrored * visible_src_w).clamp(0.0, (src_w - 1) as f32) as usize;
        x_map.push(sx * 4);
    }

    let mut out = vec![0u8; dst_w as usize * dst_h as usize * 4];
    let src_stride = src_w as usize * 4;
    let dst_stride = dst_w as usize * 4;

    for dy in 0..dst_h {
        let v = (dy as f32 + 0.5) / dst_h as f32;
        let sy = (crop_y0 + v * visible_src_h).clamp(0.0, (src_h - 1) as f32) as usize;
        let src_row = &source.bytes[sy * src_stride..(sy + 1) * src_stride];
        let dst_row = &mut out[dy as usize * dst_stride..(dy as usize + 1) * dst_stride];
        for (dx, &sx_off) in x_map.iter().enumerate() {
            let dst_off = dx * 4;
            dst_row[dst_off..dst_off + 4].copy_from_slice(&src_row[sx_off..sx_off + 4]);
        }
    }

    BgraFrame { width: dst_w, height: dst_h, bytes: out }
}

/// A small, premultiplied blur of the shaped live frame. The camera covers its centre, leaving
/// only the soft outer halo visible. Work is bounded to a quarter of the logical surface size.
fn blur_halo(
    source: &BgraFrame,
    shape: camframe_core::settings::Shape,
    size: u32,
    amount: u32,
    opacity: u32,
) -> BgraFrame {
    let (width, height) = camframe_core::settings::dimensions_for(shape, size);
    let scale = 0.25;
    let pad = 5u32;
    let (w, h) = ((width as f32 * scale).ceil() as u32, (height as f32 * scale).ceil() as u32);
    let view = OutputView { width: w, height: h, mirror: false, ..OutputView::default() };
    let small = cover_resample(source, view);
    let mut padded = image::RgbaImage::new(w + pad * 2, h + pad * 2);
    for y in 0..h {
        for x in 0..w {
            if camframe_core::geometry::is_inside_camera(shape, size, (f64::from(x) * 4.0, f64::from(y) * 4.0)) {
                let offset = ((y * w + x) * 4) as usize;
                let alpha = opacity as f32 / 100.0;
                padded.put_pixel(
                    x + pad,
                    y + pad,
                    image::Rgba([
                        (f32::from(small.bytes[offset]) * alpha) as u8,
                        (f32::from(small.bytes[offset + 1]) * alpha) as u8,
                        (f32::from(small.bytes[offset + 2]) * alpha) as u8,
                        (255.0 * alpha) as u8,
                    ]),
                );
            }
        }
    }
    let mut blurred = image::imageops::blur(&padded, amount as f32 * scale);
    // GPUI uploads straight BGRA and premultiplies when painting.
    for pixel in blurred.pixels_mut() {
        if pixel[3] > 0 {
            for c in 0..3 {
                pixel[c] = (u32::from(pixel[c]) * 255 / u32::from(pixel[3])).min(255) as u8;
            }
        }
    }
    BgraFrame { width: blurred.width(), height: blurred.height(), bytes: blurred.into_raw() }
}

/// Deterministic animated BGRA test pattern (deep ocean-blue / cyan / warm amber; never magenta).
pub fn generate_demo_pattern(width: u32, height: u32, tick: u32) -> BgraFrame {
    let mut bytes = vec![0u8; width as usize * height as usize * 4];
    let cx = width as f32 * 0.5;
    let cy = height as f32 * 0.5;
    let pulse = ((tick % 60) as f32 / 60.0) * std::f32::consts::TAU;
    let ring_r = width.min(height) as f32 * (0.24 + 0.04 * pulse.sin());

    for y in 0..height {
        let fy = y as f32 / height.max(1) as f32;
        for x in 0..width {
            let fx = x as f32 / width.max(1) as f32;
            let dist = ((x as f32 - cx).hypot(y as f32 - cy) - ring_r).abs();

            let (r, g, b) = if dist < 4.0 {
                // Bright warm amber ring
                (251u8, 146u8, 60u8)
            } else {
                // Deep slate-to-teal gradient (always far from magenta #ff00ff)
                let r = (24.0 + fx * 36.0) as u8;
                let g = (72.0 + fy * 110.0) as u8;
                let b = (128.0 + (1.0 - fy) * 80.0) as u8;
                (r, g, b)
            };

            let off = (y as usize * width as usize + x as usize) * 4;
            bytes[off] = b;
            bytes[off + 1] = g;
            bytes[off + 2] = r;
            bytes[off + 3] = 255;
        }
    }

    BgraFrame { width, height, bytes }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn capture_waits_for_inventory_and_uses_stable_identity_after_reordering() {
        let a = nokhwa::utils::CameraInfo::new("  Desk  ", "", "native-a", CameraIndex::Index(0));
        let b = nokhwa::utils::CameraInfo::new("Default", "", "native-b", CameraIndex::Index(1));
        let request = CaptureRequest { device: "native-a".into(), label: "Desk".into(), resolution: Resolution::R720 };
        assert_eq!(choose_device(false, &[a.clone(), b.clone()], &request), DeviceChoice::Wait);
        assert_eq!(choose_device(true, &[b.clone(), a.clone()], &request), DeviceChoice::Device(1));
        let imported = CaptureRequest { device: "chromium-id".into(), ..request };
        assert_eq!(choose_device(true, &[b.clone(), a.clone()], &imported), DeviceChoice::Device(1));
        let duplicate = nokhwa::utils::CameraInfo::new("Desk", "", "native-c", CameraIndex::Index(2));
        assert_eq!(choose_device(true, &[b, a, duplicate], &imported), DeviceChoice::Device(0));
        assert_eq!(choose_device(true, &[], &imported), DeviceChoice::Unavailable);
    }

    #[test]
    fn blur_halo_has_transparent_corners_and_a_bounded_working_size() {
        let source = generate_demo_pattern(288, 288, 0);
        let halo = blur_halo(&source, camframe_core::settings::Shape::Circle, 288, 12, 72);
        assert!(halo.width <= 180 && halo.height <= 180);
        assert_eq!(halo.bytes[3], 0);
        assert!(halo.bytes.as_chunks::<4>().0.iter().any(|pixel| pixel[3] > 0));
    }

    #[test]
    fn quality_selection_uses_the_requested_resolution() {
        let formats = [
            CameraFormat::new_from(1280, 720, FrameFormat::MJPEG, 60),
            CameraFormat::new_from(1920, 1080, FrameFormat::MJPEG, 60),
            CameraFormat::new_from(3840, 2160, FrameFormat::MJPEG, 30),
        ];
        assert_eq!(pick_best_format(&formats, Resolution::R1080), Some(formats[1]));
        assert_eq!(pick_best_format(&formats, Resolution::R2160), Some(formats[2]));
    }

    #[test]
    fn camera_names_have_a_number_when_the_driver_provides_none() {
        assert_eq!(camera_label("", 1), "Camera 2");
        assert_eq!(camera_label("  Elgato  ", 0), "Elgato");
    }

    #[test]
    fn camera_errors_use_the_same_words_as_camframe_090() {
        assert_eq!(classify_error("Access is denied by the system"), CAMERA_BLOCKED_MESSAGE);
        assert_eq!(classify_error("Permission not authorized"), CAMERA_BLOCKED_MESSAGE);
        assert_eq!(classify_error("device busy"), "This camera is already in use by another app.");
        assert_eq!(classify_error("stream ended"), "CamFrame could not start this camera.");
        assert_eq!(NO_CAMERA_MESSAGE, "CamFrame could not start this camera.");
    }

    #[test]
    fn the_blocked_camera_message_names_the_right_settings_app() {
        #[cfg(target_os = "macos")]
        assert_eq!(
            CAMERA_BLOCKED_MESSAGE,
            "Camera access is blocked. In System Settings, allow CamFrame to use the camera."
        );
        #[cfg(target_os = "windows")]
        assert_eq!(
            CAMERA_BLOCKED_MESSAGE,
            "Camera access is blocked. In Windows Settings, allow camera access for desktop apps."
        );
        #[cfg(not(any(target_os = "macos", target_os = "windows")))]
        assert_eq!(
            CAMERA_BLOCKED_MESSAGE,
            "Camera access is blocked. Allow CamFrame to use the camera in system privacy settings."
        );
    }

    #[test]
    fn the_camera_gives_up_after_too_many_bad_frames_in_a_row() {
        let mut failures = FailureCount::default();
        for _ in 1..MAX_CONSECUTIVE_FAILURES {
            assert!(!failures.add());
        }
        assert!(failures.add(), "the limit is reached on the last allowed failure");
        failures.reset();
        assert!(!failures.add(), "a good frame starts the count again");
    }

    #[test]
    fn decodes_raw_rgb_to_bgra() {
        let rgb = [10u8, 20, 30, 40, 50, 60];
        let frame = decode_to_bgra(FrameFormat::RAWRGB, &rgb, 2, 1).expect("valid rgb");
        assert_eq!(frame.bytes, vec![30, 20, 10, 255, 60, 50, 40, 255]);
    }

    #[test]
    fn decodes_nv12_and_rejects_odd_dimensions() {
        assert!(decode_to_bgra(FrameFormat::NV12, &[0; 12], 3, 2).is_none());
        let mut nv12 = vec![128u8; 4 + 2];
        nv12[4] = 128;
        nv12[5] = 128;
        let frame = decode_to_bgra(FrameFormat::NV12, &nv12, 2, 2).expect("valid nv12");
        assert_eq!(frame.bytes.len(), 16);
        assert_eq!(frame.bytes[3], 255);
    }

    #[test]
    fn cover_resample_mirrors_horizontally_and_preserves_dimensions() {
        // 2x1 source: left pixel = blue [255,0,0,255], right pixel = red [0,0,255,255]
        let src = BgraFrame { width: 2, height: 1, bytes: vec![255, 0, 0, 255, 0, 0, 255, 255] };
        let mirrored = cover_resample(&src, view(2, 1));
        assert_eq!(&mirrored.bytes[0..4], &[0, 0, 255, 255]);
        assert_eq!(&mirrored.bytes[4..8], &[255, 0, 0, 255]);

        let unmirrored = cover_resample(&src, OutputView { mirror: false, ..view(2, 1) });
        assert_eq!(&unmirrored.bytes[0..4], &[255, 0, 0, 255]);
        assert_eq!(&unmirrored.bytes[4..8], &[0, 0, 255, 255]);
    }

    fn view(width: u32, height: u32) -> OutputView {
        OutputView { width, height, mirror: true, position: CameraPosition { x: 50.0, y: 50.0 }, zoom: 100 }
    }

    /// Known gap KG-10: a mirrored, off-centre framing must still fill the bubble with the part of
    /// the picture the framing points at, flipped as a whole.
    #[test]
    fn mirrored_framing_keeps_the_chosen_part_and_covers_the_bubble() {
        // 4x1 source: A B C D, shown on a 2x1 surface.
        let a = [10, 0, 0, 255];
        let b = [20, 0, 0, 255];
        let c = [30, 0, 0, 255];
        let d = [40, 0, 0, 255];
        let src = BgraFrame { width: 4, height: 1, bytes: [a, b, c, d].concat() };
        let left = cover_resample(&src, OutputView { position: CameraPosition { x: 0.0, y: 50.0 }, ..view(2, 1) });
        assert_eq!(left.bytes, [b, a].concat());
        let right = cover_resample(&src, OutputView { position: CameraPosition { x: 100.0, y: 50.0 }, ..view(2, 1) });
        assert_eq!(right.bytes, [d, c].concat());
        let zoomed = cover_resample(
            &src,
            OutputView { position: CameraPosition { x: 100.0, y: 50.0 }, zoom: 200, ..view(1, 1) },
        );
        assert_eq!(zoomed.bytes, d.to_vec());
    }

    #[test]
    fn demo_pattern_has_expected_size_and_full_alpha() {
        let frame = generate_demo_pattern(64, 48, 0);
        assert_eq!(frame.bytes.len(), 64 * 48 * 4);
        assert!(frame.bytes.as_chunks::<4>().0.iter().all(|px| px[3] == 255));
    }
}
