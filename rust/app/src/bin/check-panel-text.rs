//! Pixel regression check for text missing from a native settings capture. The probe is wholly
//! inside the Camera tab button, excluding its border, in the native verifier's padded crop.
fn main() {
    let paths = std::env::args().skip(1).collect::<Vec<_>>();
    if paths.is_empty() {
        eprintln!("usage: check-panel-text <camera-panel.png> [style-panel.png ...]");
        std::process::exit(2);
    }
    let mut failed = false;
    for path in paths {
        let image = match image::open(&path) {
            Ok(image) => image.to_rgba8(),
            Err(error) => {
                eprintln!("{path}: {error}");
                failed = true;
                continue;
            }
        };
        let scale = (f64::from(image.width()) / 412.0).round().clamp(1.0, 3.0) as u32;
        let mut text_pixels = 0;
        for y in 143 * scale..166 * scale {
            for x in 79 * scale..124 * scale {
                if x < image.width() && y < image.height() {
                    let pixel = image.get_pixel(x, y);
                    if pixel[0] >= 170 && pixel[1] >= 170 && pixel[2] >= 170 {
                        text_pixels += 1;
                    }
                }
            }
        }
        println!("{path}: Camera label bright pixels = {text_pixels}");
        if text_pixels < 10 * scale * scale {
            eprintln!("FAIL: Camera tab label is missing in {path}");
            failed = true;
        }
    }
    if failed {
        std::process::exit(1);
    }
}
