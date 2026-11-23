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
        let filename = std::path::Path::new(&path).file_name().unwrap_or_default().to_string_lossy();
        let left = if filename.contains("scenes") {
            249
        } else if filename.contains("style") {
            180
        } else {
            107
        };
        for y in 135 * scale..153 * scale {
            for x in left * scale..(left + 42) * scale {
                if x < image.width() && y < image.height() {
                    let pixel = image.get_pixel(x, y);
                    if pixel[0] >= 170 && pixel[1] >= 170 && pixel[2] >= 170 {
                        text_pixels += 1;
                    }
                }
            }
        }
        println!("{path}: Selected tab bright pixels = {text_pixels}");
        for index in 0..6 {
            let centre = 107 + 38 * index;
            let ink = count_ink(&image, (centre - 10, 74, 20, 20), scale, 80);
            if ink < 5 * scale * scale {
                eprintln!("FAIL: toolbar icon {index} is missing in {path}");
                failed = true;
            }
        }
        if text_pixels < 10 * scale * scale {
            eprintln!("FAIL: Selected tab label is missing in {path}");
            failed = true;
        }
    }
    if failed {
        std::process::exit(1);
    }
}

fn count_ink(image: &image::RgbaImage, rect: (u32, u32, u32, u32), scale: u32, threshold: u8) -> u32 {
    let mut count = 0;
    for y in rect.1 * scale..((rect.1 + rect.3) * scale).min(image.height()) {
        for x in rect.0 * scale..((rect.0 + rect.2) * scale).min(image.width()) {
            let p = image.get_pixel(x, y);
            if p[0] >= threshold && p[1] >= threshold && p[2] >= threshold {
                count += 1;
            }
        }
    }
    count
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn blank_toolbar_fails_and_ink_is_measured_in_device_pixels() {
        for scale in [1, 2] {
            let mut image = image::RgbaImage::from_pixel(404 * scale, 470 * scale, image::Rgba([12, 12, 13, 255]));
            assert_eq!(count_ink(&image, (97, 74, 20, 20), scale, 80), 0);
            for y in 80 * scale..84 * scale {
                for x in 100 * scale..104 * scale {
                    image.put_pixel(x, y, image::Rgba([139, 139, 144, 255]));
                }
            }
            assert_eq!(count_ink(&image, (97, 74, 20, 20), scale, 80), 16 * scale * scale);
        }
    }
}
