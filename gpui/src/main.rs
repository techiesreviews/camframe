//! CamFrame, experimentally ported from Electron to GPUI and GPUI Kit.

mod camera;
mod overlay;
mod settings;
mod store;

use gpui_kit::component::{Theme, ThemeMode};

fn main() {
    let settings = store::load();
    camera::request_permission();
    gpui_kit::application().with_assets(overlay::AppAssets).run(move |cx| {
        gpui_kit::init(cx);
        Theme::change(ThemeMode::Dark, None, cx);
        overlay::bind_keys(cx);
        if let Err(error) = overlay::open(settings, cx) {
            eprintln!("CamFrame could not open its overlay: {error:#}");
            cx.quit();
        }
    });
}
