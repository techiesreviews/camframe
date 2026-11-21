//! The tray icon (menu bar icon on macOS) with Show camera and Quit CamFrame, as in 0.9.0. The
//! rest of 0.9.0's tray menu (controls, help, Scenes) arrives with those features.
//!
//! `tray-icon` runs on the UI thread next to GPUI's own event loop. Menu clicks arrive on its
//! handler and are passed to GPUI through a channel.

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
#[cfg_attr(not(any(target_os = "windows", target_os = "macos")), allow(dead_code))]
pub enum TrayCommand {
    ToggleCamera,
    Controls,
    Fullscreen,
    Shape(camframe_core::settings::Shape),
    Help,
    CycleScene,
    Scene(usize),
    Quit,
}

#[cfg(any(target_os = "windows", target_os = "macos"))]
pub use imp::Tray;

#[cfg(any(target_os = "windows", target_os = "macos"))]
mod imp {
    use super::TrayCommand;
    use tray_icon::menu::{CheckMenuItem, Menu, MenuEvent, MenuItem, PredefinedMenuItem};
    use tray_icon::{Icon, TrayIcon, TrayIconBuilder};

    pub struct Tray {
        _icon: TrayIcon,
        show_camera: CheckMenuItem,
    }

    impl Tray {
        pub fn new(camera_shown: bool, commands: async_channel::Sender<TrayCommand>) -> anyhow::Result<Tray> {
            let show_camera = CheckMenuItem::new("Show camera", true, camera_shown, None);
            let quit = MenuItem::new("Quit CamFrame", true, None);
            let menu = Menu::new();
            let controls = MenuItem::new("Camera controls", true, None);
            let fullscreen = MenuItem::new("Full screen", true, None);
            let help = MenuItem::new("Help & onboarding", true, None);
            let shapes = camframe_core::settings::Shape::ALL.map(|shape| MenuItem::new(shape.label(), true, None));
            menu.append_items(&[&show_camera, &controls, &fullscreen])?;
            for shape in &shapes {
                menu.append(shape)?;
            }
            menu.append_items(&[&help, &PredefinedMenuItem::separator(), &quit])?;

            let (show_id, quit_id) = (show_camera.id().clone(), quit.id().clone());
            let mut actions = vec![
                (controls.id().clone(), TrayCommand::Controls),
                (fullscreen.id().clone(), TrayCommand::Fullscreen),
                (help.id().clone(), TrayCommand::Help),
            ];
            for (item, shape) in shapes.iter().zip(camframe_core::settings::Shape::ALL) {
                actions.push((item.id().clone(), TrayCommand::Shape(shape)));
            }
            MenuEvent::set_event_handler(Some(move |event: MenuEvent| {
                let command = if event.id == show_id {
                    TrayCommand::ToggleCamera
                } else if event.id == quit_id {
                    TrayCommand::Quit
                } else if let Some((_, command)) = actions.iter().find(|(id, _)| *id == event.id) {
                    *command
                } else {
                    return;
                };
                let _ = commands.try_send(command);
            }));

            // Rasterize the small camera glyph directly: the trial's embedded PNG was corrupt.
            let mut pixels = vec![0u8; 16 * 16 * 4];
            for y in 2i32..14 {
                for x in 1i32..15 {
                    let body = (3..=12).contains(&x) && (4..=12).contains(&y);
                    let lens = (x - 8) * (x - 8) + (y - 8) * (y - 8) <= 5;
                    let viewfinder = (4..=7).contains(&x) && y == 3;
                    if (body && !lens) || viewfinder {
                        let offset = ((y * 16 + x) * 4) as usize;
                        pixels[offset..offset + 4].copy_from_slice(&[230, 230, 230, 255]);
                    }
                }
            }
            let icon = TrayIconBuilder::new()
                .with_menu(Box::new(menu))
                .with_tooltip("CamFrame Rust")
                .with_icon(Icon::from_rgba(pixels, 16, 16)?)
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
