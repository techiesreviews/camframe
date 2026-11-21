#![cfg_attr(all(target_os = "windows", not(debug_assertions)), windows_subsystem = "windows")]

mod camera;
#[cfg(target_os = "macos")]
mod mac_overlay;
mod overlay;
mod shape;
#[cfg(not(target_os = "macos"))]
mod win32_overlay;

use std::path::PathBuf;
use std::time::Instant;

use overlay::LaunchConfig;
use shape::BubbleShape;

fn parse_args(launch_instant: Instant) -> LaunchConfig {
    let mut config = LaunchConfig {
        initial_shape: BubbleShape::Circle,
        demo_pattern: false,
        mirror: true,
        border: false,
        position: None,
        metrics_file: None,
        launch_instant,
    };

    let mut args = std::env::args().skip(1);
    while let Some(arg) = args.next() {
        match arg.as_str() {
            "--shape" => {
                if let Some(value) = args.next()
                    && let Some(parsed) = BubbleShape::from_cli(&value)
                {
                    config.initial_shape = parsed;
                }
            }
            "--demo-pattern" => config.demo_pattern = true,
            "--no-mirror" => config.mirror = false,
            "--border" => config.border = true,
            "--position" => {
                if let Some(value) = args.next()
                    && let Some((x_str, y_str)) = value.split_once(',')
                    && let (Ok(x), Ok(y)) = (x_str.trim().parse::<i32>(), y_str.trim().parse::<i32>())
                {
                    config.position = Some((x, y));
                }
            }
            "--metrics-file" => {
                if let Some(value) = args.next() {
                    config.metrics_file = Some(PathBuf::from(value));
                }
            }
            _ => {}
        }
    }

    config
}

fn main() {
    let launch_instant = Instant::now();
    let config = parse_args(launch_instant);

    // On macOS the camera permission is requested by the capture thread (`camera.rs`), so the
    // demo pattern never touches AVFoundation and a denied camera falls back to the demo pattern.
    gpui_platform::application().run(move |cx| {
        overlay::bind_keys(cx);
        if let Err(err) = overlay::open(config, cx) {
            eprintln!("CamFrame trial could not open overlay: {err:#}");
            cx.quit();
        }
    });
}
