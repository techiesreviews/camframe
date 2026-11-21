//! The tray icon (menu bar icon on macOS) with Show camera and Quit CamFrame, as in 0.9.0. The
//! rest of 0.9.0's tray menu (controls, help, Scenes) arrives with those features.
//!
//! `tray-icon` runs on the UI thread next to GPUI's own event loop. Menu clicks arrive on its
//! handler and are passed to GPUI through a channel.

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
#[cfg_attr(not(any(target_os = "windows", target_os = "macos")), allow(dead_code))]
pub enum TrayCommand {
    ToggleCamera,
    Quit,
}

#[cfg(any(target_os = "windows", target_os = "macos"))]
pub use imp::Tray;

#[cfg(any(target_os = "windows", target_os = "macos"))]
mod imp {
    use super::TrayCommand;
    use tray_icon::menu::{CheckMenuItem, Menu, MenuEvent, MenuItem, PredefinedMenuItem};
    use tray_icon::{Icon, TrayIcon, TrayIconBuilder};

    const ICON_PNG: &[u8] = include_bytes!("../assets/tray.png");

    pub struct Tray {
        _icon: TrayIcon,
        show_camera: CheckMenuItem,
    }

    impl Tray {
        pub fn new(camera_shown: bool, commands: async_channel::Sender<TrayCommand>) -> anyhow::Result<Tray> {
            let show_camera = CheckMenuItem::new("Show camera", true, camera_shown, None);
            let quit = MenuItem::new("Quit CamFrame", true, None);
            let menu = Menu::new();
            menu.append_items(&[&show_camera, &PredefinedMenuItem::separator(), &quit])?;

            let (show_id, quit_id) = (show_camera.id().clone(), quit.id().clone());
            MenuEvent::set_event_handler(Some(move |event: MenuEvent| {
                let command = if event.id == show_id {
                    TrayCommand::ToggleCamera
                } else if event.id == quit_id {
                    TrayCommand::Quit
                } else {
                    return;
                };
                let _ = commands.try_send(command);
            }));

            let icon = image::load_from_memory_with_format(ICON_PNG, image::ImageFormat::Png)?.into_rgba8();
            let (width, height) = icon.dimensions();
            let icon = TrayIconBuilder::new()
                .with_menu(Box::new(menu))
                .with_tooltip("CamFrame Rust")
                .with_icon(Icon::from_rgba(icon.into_raw(), width, height)?)
                .build()?;
            Ok(Tray { _icon: icon, show_camera })
        }

        /// Keeps the tick in step when the camera is shown or hidden some other way.
        pub fn set_camera_shown(&self, shown: bool) {
            self.show_camera.set_checked(shown);
        }
    }
}

/// Linux has no tray here (development and tests only).
#[cfg(not(any(target_os = "windows", target_os = "macos")))]
pub struct Tray;

#[cfg(not(any(target_os = "windows", target_os = "macos")))]
impl Tray {
    pub fn new(_camera_shown: bool, _commands: async_channel::Sender<TrayCommand>) -> anyhow::Result<Tray> {
        Ok(Tray)
    }

    pub fn set_camera_shown(&self, _shown: bool) {}
}
