#![cfg_attr(all(target_os = "windows", not(debug_assertions)), windows_subsystem = "windows")]

mod camera;
#[cfg(target_os = "macos")]
mod mac_overlay;
mod overlay;
mod prefs;
mod tray;
#[cfg(not(target_os = "macos"))]
mod win32_overlay;

use std::path::PathBuf;
use std::time::Instant;

use overlay::LaunchConfig;

/// Command-line options. Normal starts need none; the automated checks use them.
/// - `--demo-pattern`: a moving test picture instead of the camera (also turns on the 1 to 4 keys).
/// - `--position x,y`: open there and do not save the place.
/// - `--metrics-file path`: write the time to the first frame.
/// - `--settings-dir path`: keep Preferences under this folder instead of the app-data folder.
fn parse_args(launch_instant: Instant) -> LaunchConfig {
    let mut config =
        LaunchConfig { demo_pattern: false, position: None, metrics_file: None, launch_instant, settings_dir: None };

    let mut args = std::env::args().skip(1);
    while let Some(arg) = args.next() {
        match arg.as_str() {
            "--demo-pattern" => config.demo_pattern = true,
            "--position" => {
                if let Some(value) = args.next()
                    && let Some((x, y)) = value.split_once(',')
                    && let (Ok(x), Ok(y)) = (x.trim().parse::<i32>(), y.trim().parse::<i32>())
                {
                    config.position = Some((x, y));
                }
            }
            "--metrics-file" => config.metrics_file = args.next().map(PathBuf::from),
            "--settings-dir" => config.settings_dir = args.next().map(PathBuf::from),
            _ => {}
        }
    }
    config
}

fn main() {
    let launch_instant = Instant::now();
    let config = parse_args(launch_instant);

    // On macOS the camera permission is asked for by the capture thread (`camera.rs`), so the demo
    // pattern never touches AVFoundation.
    gpui_platform::application().with_assets(overlay::Icons).run(move |cx| {
        if config.demo_pattern {
            overlay::bind_test_keys(cx);
        }
        if let Err(err) = overlay::open(config, cx) {
            eprintln!("CamFrame could not open the camera bubble: {err:#}");
            cx.quit();
        }
    });
}
