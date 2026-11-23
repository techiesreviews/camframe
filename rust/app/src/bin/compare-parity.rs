//! Put the real Electron capture (left) beside the native GPUI desktop capture (right).
//! The 40-point transparent margin on the desktop is added to Electron's content capture.
fn main() -> anyhow::Result<()> {
    let args = std::env::args().skip(1).collect::<Vec<_>>();
    anyhow::ensure!(args.len() == 4, "usage: compare-parity <electron.png> <rust.png> <out.png> <padding>");
    let left = image::open(&args[0])?.to_rgba8();
    let right = image::open(&args[1])?.to_rgba8();
    for (name, image) in [("Electron", &left), ("Rust", &right)] {
        let drawn = image.pixels().filter(|p| p[3] > 0 && !(p[0] >= 240 && p[1] <= 15 && p[2] >= 240)).count();
        anyhow::ensure!(drawn > 100, "{name} capture is blank");
    }
    let padding: u32 = args[3].parse()?;
    let left_width = left.width() + padding * 2;
    let left_height = left.height() + padding * 2;
    let mut comparison = image::RgbaImage::from_pixel(
        left_width + 16 + right.width(),
        left_height.max(right.height()),
        image::Rgba([255, 0, 255, 255]),
    );
    image::imageops::overlay(&mut comparison, &left, i64::from(padding), i64::from(padding));
    image::imageops::overlay(&mut comparison, &right, i64::from(left_width + 16), 0);
    comparison.save(&args[2])?;
    Ok(())
}
