//! Native camera capture replacing `getUserMedia()` and `src/cameras.js`.
//!
//! Each capture runs on its own thread that owns the device. The thread converts frames
//! to BGRA (GPUI's texture layout) and publishes only the newest one, so a slow UI frame
//! drops camera frames instead of queueing latency.

use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex, MutexGuard, PoisonError};
use std::thread::JoinHandle;

use nokhwa::Camera;
use nokhwa::utils::{
    ApiBackend, CameraFormat, CameraIndex, FrameFormat, RequestedFormat, RequestedFormatType,
};
use zune_jpeg::JpegDecoder;
use zune_jpeg::zune_core::bytestream::ZCursor;
use zune_jpeg::zune_core::colorspace::ColorSpace;
use zune_jpeg::zune_core::options::DecoderOptions;

use crate::settings::Resolution;

/// The minimum frame rate CamFrame prefers, and the smooth rate it prefers above it (ADR 0028).
pub const MIN_FRAME_RATE: u32 = 30;
pub const SMOOTH_FRAME_RATE: u32 = 50;

const HANDOFF_TIMEOUT: std::time::Duration = std::time::Duration::from_secs(2);
const MAX_CONSECUTIVE_FAILURES: u32 = 30;
/// The camera surface background (`#18181b`) in BGRA, shown where CSS would leave the
/// transformed video short of the surface.
const SURFACE_BACKGROUND: [u8; 4] = [0x1b, 0x18, 0x18, 255];

const DECODABLE_FORMATS: [FrameFormat; 6] = [
    FrameFormat::MJPEG,
    FrameFormat::YUYV,
    FrameFormat::NV12,
    FrameFormat::RAWRGB,
    FrameFormat::RAWBGR,
    FrameFormat::GRAY,
];

#[derive(Clone, Debug, PartialEq)]
pub struct CameraDevice {
    /// Persisted as `cameraId`. Backend path/identifier when available, else the name.
    pub id: String,
    pub label: String,
    index: CameraIndex,
}

pub fn list_devices() -> Vec<CameraDevice> {
    let Ok(cameras) = nokhwa::query(ApiBackend::Auto) else {
        return Vec::new();
    };
    cameras
        .into_iter()
        .enumerate()
        .map(|(position, info)| {
            let name = info.human_name();
            let label = if name.trim().is_empty() { format!("Camera {}", position + 1) } else { name };
            let misc = info.misc();
            let id = if misc.trim().is_empty() { format!("{}#{}", label, info.index()) } else { misc };
            CameraDevice { id, label, index: info.index().clone() }
        })
        .collect()
}

/// Requests camera access where the platform needs an explicit prompt (macOS).
pub fn request_permission() {
    #[cfg(target_os = "macos")]
    nokhwa::nokhwa_initialize(|_| {});
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub enum CaptureError {
    PermissionBlocked,
    Busy,
    NotFound,
    Failed,
}

impl CaptureError {
    fn classify(message: &str) -> Self {
        let lower = message.to_lowercase();
        if ["permission", "denied", "not authorized", "access is denied", "eacces"]
            .iter()
            .any(|needle| lower.contains(needle))
        {
            Self::PermissionBlocked
        } else if ["busy", "in use", "ebusy"].iter().any(|needle| lower.contains(needle)) {
            Self::Busy
        } else if ["not found", "no such", "out of range", "enoent"].iter().any(|needle| lower.contains(needle)) {
            Self::NotFound
        } else {
            Self::Failed
        }
    }

    pub fn message(&self) -> &'static str {
        match self {
            Self::PermissionBlocked if cfg!(target_os = "macos") => {
                "Camera access is blocked. In System Settings, allow CamFrame to use the camera."
            }
            Self::PermissionBlocked if cfg!(target_os = "windows") => {
                "Camera access is blocked. In Windows Settings, allow camera access for desktop apps."
            }
            Self::PermissionBlocked => {
                "Camera access is blocked. Allow CamFrame to use the camera in system privacy settings."
            }
            Self::Busy => "This camera is already in use by another app.",
            Self::NotFound | Self::Failed => "CamFrame could not start this camera.",
        }
    }
}

pub struct Frame {
    pub width: u32,
    pub height: u32,
    pub bgra: Vec<u8>,
}

/// How the camera surface shows the frame: CSS `object-fit: cover`, then
/// `scaleX(-1) scale(zoom)` around the crop origin, in output device pixels.
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct View {
    pub width: u32,
    pub height: u32,
    pub zoom: f32,
    /// Crop origin as fractions of the surface (camera position / 100).
    pub origin: (f32, f32),
    pub mirror: bool,
    /// Progressive blur source: `Some(pixels across)` for a tiny, saturated, masked copy.
    pub halo: Option<Halo>,
}

#[derive(Clone, Copy, Debug, PartialEq)]
pub struct Halo {
    /// Content pixels across the long axis; fewer pixels read as a wider blur once upscaled.
    pub resolution: u32,
    /// Corner radius as a fraction of the short side (0.5 is a circle).
    pub radius: f32,
}

/// Transparent pixels added around the halo so GPU upscaling fades its edge.
pub const HALO_MARGIN: u32 = 2;

pub enum CaptureStatus {
    Live(CameraFormat),
    Failed(CaptureError),
}

/// Shared between the capture thread and the UI: the newest frame plus status changes.
#[derive(Default)]
pub struct CaptureSlot {
    pub frame: Mutex<Option<(Frame, Option<Frame>)>>,
    pub status: Mutex<Option<CaptureStatus>>,
    pub view: Mutex<Option<View>>,
}

/// Locks a slot field. A panicked capture thread must not take the UI down with it, so a
/// poisoned lock is recovered rather than propagated.
pub fn lock<T>(mutex: &Mutex<T>) -> MutexGuard<'_, T> {
    mutex.lock().unwrap_or_else(PoisonError::into_inner)
}

/// Owns a running capture. Dropping it stops the thread, which then releases the device.
pub struct Capture {
    stop: Arc<AtomicBool>,
    thread: Option<JoinHandle<()>>,
}

impl Capture {
    /// Stops capturing and returns the thread so a successor can wait for the device.
    fn stop(mut self) -> Option<JoinHandle<()>> {
        self.stop.store(true, Ordering::Relaxed);
        self.thread.take()
    }
}

impl Drop for Capture {
    fn drop(&mut self) {
        self.stop.store(true, Ordering::Relaxed);
    }
}

/// Starts capturing `device` (or the first camera) at the Camera quality `resolution`.
/// `previous` is stopped and awaited on the new thread so the device is free before reopening.
/// `wake` is called after each new frame or status so the UI can repaint.
pub fn start(
    previous: Option<Capture>,
    device: Option<CameraDevice>,
    resolution: Resolution,
    slot: Arc<CaptureSlot>,
    wake: impl Fn() + Send + 'static,
) -> std::io::Result<Capture> {
    let stop = Arc::new(AtomicBool::new(false));
    let thread_stop = stop.clone();
    let previous = previous.and_then(Capture::stop);
    let thread = std::thread::Builder::new()
        .name("camframe-capture".into())
        .spawn(move || {
            if let Some(previous) = previous {
                // Wait briefly for the old thread to release the device. A driver stuck in a
                // blocking read must not hold the new camera at "Starting camera." forever.
                let deadline = std::time::Instant::now() + HANDOFF_TIMEOUT;
                while !previous.is_finished() && std::time::Instant::now() < deadline {
                    std::thread::sleep(std::time::Duration::from_millis(10));
                }
            }
            if thread_stop.load(Ordering::Relaxed) {
                return;
            }
            let publish_status = |status| {
                *lock(&slot.status) = Some(status);
                wake();
            };
            let mut camera = match open(device, resolution) {
                Ok(opened) => opened,
                Err(error) => return publish_status(CaptureStatus::Failed(error)),
            };
            publish_status(CaptureStatus::Live(camera.camera_format()));

            // Read and decode failures both count; only a usable frame resets the streak.
            let mut failures = 0;
            while !thread_stop.load(Ordering::Relaxed) {
                let decoded = camera.frame().map_err(|error| error.to_string()).and_then(|buffer| {
                    let resolution = buffer.resolution();
                    to_bgra(buffer.source_frame_format(), buffer.buffer(), resolution.width(), resolution.height())
                        .ok_or_else(|| "undecodable camera frame".to_string())
                });
                match decoded {
                    Ok(source) => {
                        failures = 0;
                        let Some(view) = *lock(&slot.view) else { continue };
                        let frame = render_view(&source, &view);
                        let halo = view.halo.map(|halo| render_halo(&source, &view, halo));
                        *lock(&slot.frame) = Some((frame, halo));
                        wake();
                    }
                    Err(error) => {
                        failures += 1;
                        if failures > MAX_CONSECUTIVE_FAILURES {
                            publish_status(CaptureStatus::Failed(CaptureError::classify(&error)));
                            break;
                        }
                    }
                }
            }
            let _ = camera.stop_stream();
        })
?;
    Ok(Capture { stop, thread: Some(thread) })
}

fn open(device: Option<CameraDevice>, resolution: Resolution) -> Result<Camera, CaptureError> {
    let index = match device {
        Some(device) => device.index,
        None => list_devices().into_iter().next().ok_or(CaptureError::NotFound)?.index,
    };
    let error = |error: nokhwa::NokhwaError| CaptureError::classify(&error.to_string());
    let request = RequestedFormat::with_formats(RequestedFormatType::None, &DECODABLE_FORMATS);
    let mut camera = Camera::new(index, request).map_err(error)?;
    let formats = camera.compatible_camera_formats().map_err(error)?;
    if let Some(chosen) = choose_format(&formats, resolution) {
        let exact = RequestedFormat::with_formats(RequestedFormatType::Exact(chosen), &DECODABLE_FORMATS);
        camera.set_camera_requset(exact).map_err(error)?;
    }
    camera.open_stream().map_err(error)?;
    Ok(camera)
}

/// Chooses a capture mode the way the Electron constraints ask Chromium to (ADR 0028):
/// requested size at a smooth rate, then requested size, then a smooth rate, then at
/// least 30 fps, and finally anything (the overconstrained retry). Within a tier the
/// size nearest the ideal wins, then the higher frame rate, then the cheaper decode.
pub fn choose_format(formats: &[CameraFormat], resolution: Resolution) -> Option<CameraFormat> {
    let (target_width, target_height) = resolution.dimensions();
    let tier = |format: &CameraFormat| {
        let big_enough = format.width() >= target_width && format.height() >= target_height;
        let fps = format.frame_rate();
        match (big_enough, fps) {
            (true, fps) if fps >= SMOOTH_FRAME_RATE => 0,
            (true, fps) if fps >= MIN_FRAME_RATE => 1,
            (false, fps) if fps >= SMOOTH_FRAME_RATE => 2,
            (false, fps) if fps >= MIN_FRAME_RATE => 3,
            _ => 4,
        }
    };
    let distance = |format: &CameraFormat| {
        format.width().abs_diff(target_width) + format.height().abs_diff(target_height)
    };
    let decode_cost = |format: &CameraFormat| u8::from(format.format() == FrameFormat::MJPEG);
    formats
        .iter()
        .filter(|format| DECODABLE_FORMATS.contains(&format.format()))
        .min_by_key(|format| {
            (tier(format), distance(format), std::cmp::Reverse(format.frame_rate()), decode_cost(format))
        })
        .copied()
}

/// Converts one camera buffer to BGRA. `None` means the buffer does not match its metadata.
fn to_bgra(format: FrameFormat, data: &[u8], width: u32, height: u32) -> Option<Frame> {
    if format == FrameFormat::MJPEG {
        // The JPEG's own header is authoritative; drivers can disagree with the negotiated mode.
        let options = DecoderOptions::default().jpeg_set_out_colorspace(ColorSpace::BGRA);
        let mut decoder = JpegDecoder::new_with_options(ZCursor::new(data), options);
        let bgra = decoder.decode().ok()?;
        let info = decoder.info()?;
        let (width, height) = (u32::from(info.width), u32::from(info.height));
        return (bgra.len() == width as usize * height as usize * 4 && width > 0 && height > 0)
            .then_some(Frame { width, height, bgra });
    }
    let bgra = to_bgra_uncompressed(format, data, width, height)?;
    Some(Frame { width, height, bgra })
}

fn to_bgra_uncompressed(format: FrameFormat, data: &[u8], width: u32, height: u32) -> Option<Vec<u8>> {
    let pixels = width as usize * height as usize;
    if pixels == 0 {
        return None;
    }
    match format {
        FrameFormat::MJPEG => None,
        FrameFormat::YUYV => {
            if data.len() < pixels * 2 {
                return None;
            }
            let mut out = Vec::with_capacity(pixels * 4);
            for &[y0, u, y1, v] in data[..pixels * 2].as_chunks::<4>().0 {
                out.extend_from_slice(&yuv_to_bgra(y0, u, v));
                out.extend_from_slice(&yuv_to_bgra(y1, u, v));
            }
            Some(out)
        }
        FrameFormat::NV12 => {
            let (w, h) = (width as usize, height as usize);
            // 4:2:0 chroma is defined per 2×2 block; odd sizes need padded planes we cannot infer.
            if w % 2 != 0 || h % 2 != 0 || data.len() < pixels + pixels / 2 {
                return None;
            }
            let (luma, chroma) = data.split_at(pixels);
            let mut out = Vec::with_capacity(pixels * 4);
            for row in 0..h {
                for column in 0..w {
                    let uv = (row / 2) * w + (column / 2) * 2;
                    out.extend_from_slice(&yuv_to_bgra(luma[row * w + column], chroma[uv], chroma[uv + 1]));
                }
            }
            Some(out)
        }
        FrameFormat::RAWRGB | FrameFormat::RAWBGR => {
            if data.len() < pixels * 3 {
                return None;
            }
            let swap = format == FrameFormat::RAWRGB;
            let mut out = Vec::with_capacity(pixels * 4);
            for &[first, second, third] in data[..pixels * 3].as_chunks::<3>().0 {
                if swap {
                    out.extend_from_slice(&[third, second, first, 255]);
                } else {
                    out.extend_from_slice(&[first, second, third, 255]);
                }
            }
            Some(out)
        }
        FrameFormat::GRAY => {
            if data.len() < pixels {
                return None;
            }
            Some(data[..pixels].iter().flat_map(|&luma| [luma, luma, luma, 255]).collect())
        }
    }
}

/// One output axis: for each output pixel, the source taps and their weights. All-zero
/// weights mean the transformed video element does not cover that pixel.
fn axis_taps(output: u32, source: u32, surface: f32, fit_scale: f32, origin: f32, direction: f32, zoom: f32) -> Vec<[(u32, f32); 4]> {
    // Surface point → pre-transform element point → source pixel (see `View`).
    let pivot = origin * surface;
    let overflow = (surface - source as f32 * fit_scale) * origin;
    let per_output = surface / output as f32;
    let step = (per_output / (zoom * fit_scale)).abs();
    let last = source.saturating_sub(1) as f32;
    (0..output)
        .map(|index| {
            let screen = (index as f32 + 0.5) * per_output;
            let element = pivot + (screen - pivot) / (direction * zoom);
            let center = (element - overflow) / fit_scale - 0.5;
            let mut taps = [(0u32, 0.0f32); 4];
            if !(0.0..=surface).contains(&element) {
                // Mirroring around an off-center origin moves the element off part of the
                // surface, exactly as `scaleX(-1)` does in the Electron CSS.
                return taps;
            }
            if step <= 1.0 {
                // Bilinear when enlarging.
                let clamped = center.clamp(0.0, last);
                let low = clamped.floor();
                let weight = clamped - low;
                taps[0] = (low as u32, 1.0 - weight);
                taps[1] = ((low + 1.0).min(last) as u32, weight);
            } else {
                // Box filter when shrinking, up to four taps across the footprint.
                let count = step.ceil().min(4.0) as usize;
                for (tap, slot) in taps.iter_mut().take(count).enumerate() {
                    let position = center + ((tap as f32 + 0.5) / count as f32 - 0.5) * step;
                    *slot = (position.round().clamp(0.0, last) as u32, 1.0 / count as f32);
                }
            }
            taps
        })
        .collect()
}

fn render_view(source: &Frame, view: &View) -> Frame {
    // Never resample above the camera's own detail; the GPU enlarges the result for free.
    let magnification = (view.width as f32 / source.width as f32).max(view.height as f32 / source.height as f32) * view.zoom;
    let shrink = magnification.max(1.0);
    let width = ((view.width as f32 / shrink).round() as u32).max(1);
    let height = ((view.height as f32 / shrink).round() as u32).max(1);
    let fit_scale = (width as f32 / source.width as f32).max(height as f32 / source.height as f32);
    let direction = if view.mirror { -1.0 } else { 1.0 };
    let columns = axis_taps(width, source.width, width as f32, fit_scale, view.origin.0, direction, view.zoom);
    let rows = axis_taps(height, source.height, height as f32, fit_scale, view.origin.1, 1.0, view.zoom);
    let stride = source.width as usize * 4;
    let mut bgra = Vec::with_capacity(width as usize * height as usize * 4);
    let covered = |taps: &[(u32, f32); 4]| taps.iter().any(|tap| tap.1 > 0.0);
    for row in &rows {
        for column in columns.iter() {
            if !covered(row) || !covered(column) {
                bgra.extend_from_slice(&SURFACE_BACKGROUND);
                continue;
            }
            let mut pixel = [0.0f32; 3];
            for &(y, wy) in row.iter().filter(|tap| tap.1 > 0.0) {
                let line = y as usize * stride;
                for &(x, wx) in column.iter().filter(|tap| tap.1 > 0.0) {
                    let offset = line + x as usize * 4;
                    let weight = wx * wy;
                    for (sum, &value) in pixel.iter_mut().zip(&source.bgra[offset..offset + 3]) {
                        *sum += value as f32 * weight;
                    }
                }
            }
            bgra.extend_from_slice(&[pixel[0] as u8, pixel[1] as u8, pixel[2] as u8, 255]);
        }
    }
    Frame { width, height, bgra }
}

/// The Progressive blur source: a tiny `saturate(1.18)` copy of the framed camera, masked to
/// the shape and surrounded by transparent edge-extended pixels. GPU upscaling blurs it.
fn render_halo(source: &Frame, view: &View, halo: Halo) -> Frame {
    let long = view.width.max(view.height).max(1) as f32;
    let scale = halo.resolution.max(2) as f32 / long;
    let requested_width = ((view.width as f32 * scale).round() as u32).max(2);
    let requested_height = ((view.height as f32 * scale).round() as u32).max(2);
    let small = render_view(source, &View { width: requested_width, height: requested_height, halo: None, ..*view });
    let (content_width, content_height) = (small.width, small.height);
    let (width, height) = (content_width + HALO_MARGIN * 2, content_height + HALO_MARGIN * 2);
    let radius = halo.radius * content_width.min(content_height) as f32;
    let mut bgra = Vec::with_capacity(width as usize * height as usize * 4);
    for y in 0..height {
        for x in 0..width {
            let cx = (x as i64 - HALO_MARGIN as i64).clamp(0, content_width as i64 - 1) as u32;
            let cy = (y as i64 - HALO_MARGIN as i64).clamp(0, content_height as i64 - 1) as u32;
            let offset = (cy * content_width + cx) as usize * 4;
            let [b, g, r] = [0, 1, 2].map(|channel| small.bgra[offset + channel] as f32);
            let luma = 0.0722 * b + 0.7152 * g + 0.2126 * r;
            let saturate = |value: f32| (luma + (value - luma) * 1.18).clamp(0.0, 255.0) as u8;
            let inside = x >= HALO_MARGIN
                && y >= HALO_MARGIN
                && inside_rounded_rect(
                    (x - HALO_MARGIN) as f32 + 0.5,
                    (y - HALO_MARGIN) as f32 + 0.5,
                    content_width as f32,
                    content_height as f32,
                    radius,
                );
            bgra.extend_from_slice(&[saturate(b), saturate(g), saturate(r), if inside { 255 } else { 0 }]);
        }
    }
    Frame { width, height, bgra }
}

fn inside_rounded_rect(x: f32, y: f32, width: f32, height: f32, radius: f32) -> bool {
    if x < 0.0 || y < 0.0 || x > width || y > height {
        return false;
    }
    let dx = (radius - x).max(x - (width - radius)).max(0.0);
    let dy = (radius - y).max(y - (height - radius)).max(0.0);
    dx * dx + dy * dy <= radius * radius
}

/// BT.601 limited-range YUV to BGRA using integer arithmetic.
fn yuv_to_bgra(y: u8, u: u8, v: u8) -> [u8; 4] {
    let c = (i32::from(y) - 16).max(0) * 298;
    let d = i32::from(u) - 128;
    let e = i32::from(v) - 128;
    let channel = |value: i32| ((value + 128) >> 8).clamp(0, 255) as u8;
    [channel(c + 516 * d), channel(c - 100 * d - 208 * e), channel(c + 409 * e), 255]
}

#[cfg(test)]
mod tests {
    use super::*;

    fn mode(width: u32, height: u32, format: FrameFormat, fps: u32) -> CameraFormat {
        CameraFormat::new_from(width, height, format, fps)
    }

    #[test]
    fn prefers_requested_size_at_a_smooth_rate() {
        let formats = [
            mode(1920, 1080, FrameFormat::YUYV, 5),
            mode(1280, 720, FrameFormat::YUYV, 10),
            mode(1280, 720, FrameFormat::MJPEG, 60),
            mode(1920, 1080, FrameFormat::MJPEG, 30),
        ];
        assert_eq!(choose_format(&formats, Resolution::P720), Some(formats[2]));
        assert_eq!(choose_format(&formats, Resolution::P1080), Some(formats[3]));
    }

    #[test]
    fn falls_back_to_smooth_then_minimum_then_anything() {
        let small_smooth = mode(640, 480, FrameFormat::YUYV, 60);
        let slow_large = mode(3840, 2160, FrameFormat::MJPEG, 15);
        assert_eq!(choose_format(&[slow_large, small_smooth], Resolution::P2160), Some(small_smooth));
        assert_eq!(choose_format(&[slow_large], Resolution::P2160), Some(slow_large));
        assert_eq!(choose_format(&[], Resolution::P720), None);
    }

    #[test]
    fn prefers_the_cheaper_decode_on_ties() {
        let mjpeg = mode(1280, 720, FrameFormat::MJPEG, 30);
        let yuyv = mode(1280, 720, FrameFormat::YUYV, 30);
        assert_eq!(choose_format(&[mjpeg, yuyv], Resolution::P720), Some(yuyv));
    }

    #[test]
    fn converts_packed_and_planar_yuv() {
        let white = to_bgra(FrameFormat::YUYV, &[235, 128, 235, 128], 2, 1).unwrap();
        assert_eq!(white.bgra, vec![255, 255, 255, 255, 255, 255, 255, 255]);
        let black = to_bgra(FrameFormat::NV12, &[16, 16, 16, 16, 128, 128], 2, 2).unwrap();
        assert!(black.bgra.chunks(4).all(|pixel| pixel == [0, 0, 0, 255]));
        assert_eq!(to_bgra(FrameFormat::RAWRGB, &[1, 2, 3], 1, 1).unwrap().bgra, vec![3, 2, 1, 255]);
    }

    #[test]
    fn rejects_buffers_that_do_not_match_their_metadata() {
        assert!(to_bgra(FrameFormat::NV12, &[0; 12], 3, 3).is_none());
        assert!(to_bgra(FrameFormat::YUYV, &[0; 2], 2, 1).is_none());
        assert!(to_bgra(FrameFormat::MJPEG, b"not a jpeg", 2, 2).is_none());
    }

    fn view(width: u32, height: u32, zoom: f32, mirror: bool) -> View {
        View { width, height, zoom, origin: (0.5, 0.5), mirror, halo: None }
    }

    #[test]
    fn cover_fit_crops_the_long_axis_and_mirrors() {
        // A 4×2 source with distinct columns, shown in a 2×2 surface: cover keeps columns 1–2.
        let bgra = (0..2).flat_map(|_| (0..4u8).flat_map(|column| [column * 60, 0, 0, 255])).collect();
        let source = Frame { width: 4, height: 2, bgra };
        let plain = render_view(&source, &view(2, 2, 1.0, false));
        assert_eq!((plain.bgra[0], plain.bgra[4]), (60, 120));
        let mirrored = render_view(&source, &view(2, 2, 1.0, true));
        assert_eq!((mirrored.bgra[0], mirrored.bgra[4]), (120, 60));
    }

    #[test]
    fn mirrored_off_center_framing_uncovers_the_surface_like_css() {
        // Origin 25%: scaleX(-1) maps the 2 px element onto [-1, 1], leaving the right pixel bare.
        let bgra = (0..2).flat_map(|_| (0..4u8).flat_map(|column| [column * 60, 0, 0, 255])).collect();
        let source = Frame { width: 4, height: 2, bgra };
        let mut mirrored = view(2, 2, 1.0, true);
        mirrored.origin = (0.25, 0.5);
        let frame = render_view(&source, &mirrored);
        assert_eq!(frame.bgra[4..8], SURFACE_BACKGROUND);
    }

    #[test]
    fn zoom_magnifies_around_the_crop_origin() {
        // An 8×2 source shown 4×1 at 2× zoom around the left edge keeps columns 0–3.
        let bgra = (0..2).flat_map(|_| (0..8u8).flat_map(|column| [column * 30, 0, 0, 255])).collect();
        let source = Frame { width: 8, height: 2, bgra };
        let mut zoomed = view(4, 1, 2.0, false);
        zoomed.origin = (0.0, 0.5);
        let frame = render_view(&source, &zoomed);
        assert_eq!((frame.bgra[0], frame.bgra[12]), (0, 90));
    }

    #[test]
    fn output_never_exceeds_source_detail() {
        let source = Frame { width: 4, height: 2, bgra: vec![0; 4 * 2 * 4] };
        let frame = render_view(&source, &view(40, 40, 2.0, false));
        assert_eq!((frame.width, frame.height), (1, 1));
    }

    #[test]
    fn halo_is_masked_and_padded() {
        let source = Frame { width: 8, height: 8, bgra: vec![200; 8 * 8 * 4] };
        let mut circle = view(100, 100, 1.0, false);
        circle.halo = Some(Halo { resolution: 10, radius: 0.5 });
        let halo = render_halo(&source, &circle, circle.halo.unwrap());
        // Content is capped at the 8×8 source detail, plus two transparent pixels per side.
        assert_eq!((halo.width, halo.height), (12, 12));
        assert_eq!(halo.bgra[3], 0);
        let center = ((6 * 12 + 6) * 4 + 3) as usize;
        assert_eq!(halo.bgra[center], 255);
    }

    #[test]
    fn classifies_platform_errors() {
        assert_eq!(CaptureError::classify("Device or resource busy"), CaptureError::Busy);
        assert_eq!(CaptureError::classify("Permission denied (os error 13)"), CaptureError::PermissionBlocked);
        assert_eq!(CaptureError::classify("weird"), CaptureError::Failed);
    }
}
