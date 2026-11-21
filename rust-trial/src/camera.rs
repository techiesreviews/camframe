//! Native webcam capture + BGRA conversion for GPUI (`nokhwa` native backend + pure-Rust `zune-jpeg`).
//!
//! Runs on a dedicated OS thread and publishes only the latest frame, so the UI never queues stale
//! video frames. Also includes a deterministic `--demo-pattern` source for camera-less CI verification.

use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex, MutexGuard};
use std::thread::JoinHandle;
use std::time::Duration;

use nokhwa::Camera;
use nokhwa::utils::{
    ApiBackend, CameraFormat, CameraIndex, FrameFormat, RequestedFormat, RequestedFormatType,
};
use zune_jpeg::JpegDecoder;
use zune_jpeg::zune_core::bytestream::ZCursor;
use zune_jpeg::zune_core::colorspace::ColorSpace;
use zune_jpeg::zune_core::options::DecoderOptions;

/// Target capture resolution matching CamFrame 0.9.0 default (`720p`).
const TARGET_WIDTH: u32 = 1280;
const TARGET_HEIGHT: u32 = 720;
const MIN_FRAME_RATE: u32 = 30;
const SMOOTH_FRAME_RATE: u32 = 50;
const MAX_CONSECUTIVE_FAILURES: u32 = 30;

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

/// Desired output framing for the camera surface.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct OutputView {
    pub width: u32,
    pub height: u32,
    pub mirror: bool,
}

#[derive(Clone, Debug)]
pub enum CameraStatus {
    Starting,
    Live(String),
    DemoPattern,
    Unavailable(String),
}

#[derive(Default)]
pub struct CameraSlot {
    pub frame: Mutex<Option<BgraFrame>>,
    pub status: Mutex<Option<CameraStatus>>,
    pub view: Mutex<Option<OutputView>>,
}

pub fn lock_unpoisoned<T>(mutex: &Mutex<T>) -> MutexGuard<'_, T> {
    mutex.lock().unwrap_or_else(|poisoned| poisoned.into_inner())
}

pub struct CameraWorker {
    stop: Arc<AtomicBool>,
    handle: Option<JoinHandle<()>>,
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
        let handle = std::thread::Builder::new()
            .name("camframe-capture".into())
            .spawn(move || {
                if demo_pattern {
                    run_demo_loop(stop_flag, slot, wake);
                } else {
                    run_webcam_loop(stop_flag, slot, wake);
                }
            })
            .ok();
        Self { stop, handle }
    }
}

impl Drop for CameraWorker {
    fn drop(&mut self) {
        self.stop.store(true, Ordering::Relaxed);
        if let Some(handle) = self.handle.take() {
            let _ = handle.join();
        }
    }
}

fn publish_status(slot: &CameraSlot, wake: &async_channel::Sender<()>, status: CameraStatus) {
    *lock_unpoisoned(&slot.status) = Some(status);
    let _ = wake.try_send(());
}

fn publish_frame(slot: &CameraSlot, wake: &async_channel::Sender<()>, frame: BgraFrame) {
    *lock_unpoisoned(&slot.frame) = Some(frame);
    let _ = wake.try_send(());
}

fn run_demo_loop(
    stop: Arc<AtomicBool>,
    slot: Arc<CameraSlot>,
    wake: async_channel::Sender<()>,
) {
    publish_status(&slot, &wake, CameraStatus::DemoPattern);
    let mut tick: u32 = 0;
    while !stop.load(Ordering::Relaxed) {
        let view = lock_unpoisoned(&slot.view)
            .unwrap_or(OutputView { width: 288, height: 288, mirror: true });
        let frame = generate_demo_pattern(view.width.max(1), view.height.max(1), tick);
        publish_frame(&slot, &wake, frame);
        tick = tick.wrapping_add(1);
        std::thread::sleep(Duration::from_millis(33));
    }
}

fn run_webcam_loop(
    stop: Arc<AtomicBool>,
    slot: Arc<CameraSlot>,
    wake: async_channel::Sender<()>,
) {
    let cameras = match nokhwa::query(ApiBackend::Auto) {
        Ok(list) if !list.is_empty() => list,
        Ok(_) => {
            publish_status(
                &slot,
                &wake,
                CameraStatus::Unavailable("No camera found".into()),
            );
            return;
        }
        Err(err) => {
            publish_status(&slot, &wake, CameraStatus::Unavailable(classify_error(&err.to_string())));
            return;
        }
    };

    let info = &cameras[0];
    let camera_name = info.human_name();
    let index = info.index().clone();

    let mut camera = match open_preferred_camera(index) {
        Ok(cam) => cam,
        Err(msg) => {
            publish_status(&slot, &wake, CameraStatus::Unavailable(msg));
            return;
        }
    };

    if let Err(err) = camera.open_stream() {
        publish_status(&slot, &wake, CameraStatus::Unavailable(classify_error(&err.to_string())));
        return;
    }

    let fmt = camera.camera_format();
    publish_status(
        &slot,
        &wake,
        CameraStatus::Live(format!(
            "{} ({}×{} {} fps)",
            camera_name,
            fmt.width(),
            fmt.height(),
            fmt.frame_rate()
        )),
    );

    let mut failures = 0u32;
    while !stop.load(Ordering::Relaxed) {
        match camera.frame() {
            Ok(buffer) => {
                let res = buffer.resolution();
                let format = buffer.source_frame_format();
                if let Some(decoded) = decode_to_bgra(format, buffer.buffer(), res.width(), res.height()) {
                    failures = 0;
                    let view = lock_unpoisoned(&slot.view)
                        .unwrap_or(OutputView { width: 288, height: 288, mirror: true });
                    let framed = cover_resample(&decoded, view);
                    publish_frame(&slot, &wake, framed);
                } else {
                    failures += 1;
                }
            }
            Err(err) => {
                failures += 1;
                if failures >= MAX_CONSECUTIVE_FAILURES {
                    publish_status(
                        &slot,
                        &wake,
                        CameraStatus::Unavailable(classify_error(&err.to_string())),
                    );
                    break;
                }
                std::thread::sleep(Duration::from_millis(16));
            }
        }
    }

    let _ = camera.stop_stream();
}

fn open_preferred_camera(index: CameraIndex) -> Result<Camera, String> {
    let initial_request = RequestedFormat::new::<nokhwa::pixel_format::RgbFormat>(
        RequestedFormatType::AbsoluteHighestFrameRate,
    );
    let mut camera = Camera::new(index, initial_request)
        .map_err(|err| classify_error(&err.to_string()))?;

    if let Ok(formats) = camera.compatible_camera_formats()
        && let Some(best) = pick_best_format(&formats)
    {
        let _ = camera.set_camera_format(best);
    }

    Ok(camera)
}

fn pick_best_format(formats: &[CameraFormat]) -> Option<CameraFormat> {
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
    let distance = |f: &CameraFormat| {
        f.width().abs_diff(TARGET_WIDTH) + f.height().abs_diff(TARGET_HEIGHT)
    };
    let decode_cost = |f: &CameraFormat| u8::from(f.format() == FrameFormat::MJPEG);

    formats
        .iter()
        .filter(|f| DECODABLE_FORMATS.contains(&f.format()))
        .min_by_key(|f| (tier(f), distance(f), std::cmp::Reverse(f.frame_rate()), decode_cost(f)))
        .copied()
}

fn classify_error(raw: &str) -> String {
    let lower = raw.to_ascii_lowercase();
    if ["permission", "denied", "access is denied", "not authorized"]
        .iter()
        .any(|needle| lower.contains(needle))
    {
        "Camera blocked in Windows Settings".into()
    } else if ["busy", "in use", "ebusy"]
        .iter()
        .any(|needle| lower.contains(needle))
    {
        "Camera is in use by another app".into()
    } else {
        "Could not open camera".into()
    }
}

/// Decodes a camera frame buffer straight into BGRA8.
pub fn decode_to_bgra(
    format: FrameFormat,
    data: &[u8],
    width: u32,
    height: u32,
) -> Option<BgraFrame> {
    if format == FrameFormat::MJPEG {
        let options = DecoderOptions::default().jpeg_set_out_colorspace(ColorSpace::BGRA);
        let mut decoder = JpegDecoder::new_with_options(ZCursor::new(data), options);
        let bytes = decoder.decode().ok()?;
        let info = decoder.info()?;
        let (w, h) = (u32::from(info.width), u32::from(info.height));
        return (w > 0 && h > 0 && bytes.len() == w as usize * h as usize * 4)
            .then_some(BgraFrame { width: w, height: h, bytes });
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
            for chunk in data[..pixels * 2].chunks_exact(4) {
                out.extend_from_slice(&yuv_to_bgra(chunk[0], chunk[1], chunk[3]));
                out.extend_from_slice(&yuv_to_bgra(chunk[2], chunk[1], chunk[3]));
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
                    out.extend_from_slice(&yuv_to_bgra(
                        luma[row * w + col],
                        chroma[uv],
                        chroma[uv + 1],
                    ));
                }
            }
            out
        }
        FrameFormat::RAWRGB => {
            if data.len() < pixels * 3 {
                return None;
            }
            let mut out = Vec::with_capacity(pixels * 4);
            for px in data[..pixels * 3].chunks_exact(3) {
                out.extend_from_slice(&[px[2], px[1], px[0], 255]);
            }
            out
        }
        FrameFormat::RAWBGR => {
            if data.len() < pixels * 3 {
                return None;
            }
            let mut out = Vec::with_capacity(pixels * 4);
            for px in data[..pixels * 3].chunks_exact(3) {
                out.extend_from_slice(&[px[0], px[1], px[2], 255]);
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

/// Center-crops (`object-fit: cover`), resamples to `view.width × view.height`, and optionally
/// mirrors horizontally so the webcam looks natural inside any bubble aspect ratio.
pub fn cover_resample(source: &BgraFrame, view: OutputView) -> BgraFrame {
    let dst_w = view.width.max(1);
    let dst_h = view.height.max(1);
    let src_w = source.width.max(1);
    let src_h = source.height.max(1);

    let scale = (dst_w as f32 / src_w as f32).max(dst_h as f32 / src_h as f32);
    let visible_src_w = dst_w as f32 / scale;
    let visible_src_h = dst_h as f32 / scale;
    let crop_x0 = (src_w as f32 - visible_src_w) * 0.5;
    let crop_y0 = (src_h as f32 - visible_src_h) * 0.5;

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

    BgraFrame {
        width: dst_w,
        height: dst_h,
        bytes: out,
    }
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
        let src = BgraFrame {
            width: 2,
            height: 1,
            bytes: vec![255, 0, 0, 255, 0, 0, 255, 255],
        };
        let mirrored = cover_resample(&src, OutputView { width: 2, height: 1, mirror: true });
        assert_eq!(&mirrored.bytes[0..4], &[0, 0, 255, 255]);
        assert_eq!(&mirrored.bytes[4..8], &[255, 0, 0, 255]);

        let unmirrored = cover_resample(&src, OutputView { width: 2, height: 1, mirror: false });
        assert_eq!(&unmirrored.bytes[0..4], &[255, 0, 0, 255]);
        assert_eq!(&unmirrored.bytes[4..8], &[0, 0, 255, 255]);
    }

    #[test]
    fn demo_pattern_has_expected_size_and_full_alpha() {
        let frame = generate_demo_pattern(64, 48, 0);
        assert_eq!(frame.bytes.len(), 64 * 48 * 4);
        assert!(frame.bytes.chunks_exact(4).all(|px| px[3] == 255));
    }
}
