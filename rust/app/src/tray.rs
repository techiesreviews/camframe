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
    use std::sync::{Arc, Mutex};
    use tray_icon::menu::{CheckMenuItem, Menu, MenuEvent, MenuId, MenuItem, PredefinedMenuItem, Submenu};
    use tray_icon::{Icon, TrayIcon, TrayIconBuilder};

    pub struct Tray {
        _icon: TrayIcon,
        show_camera: CheckMenuItem,
        scenes_menu: Submenu,
        scene_actions: Arc<Mutex<Vec<(MenuId, TrayCommand)>>>,
    }

    impl Tray {
        pub fn new(camera_shown: bool, commands: async_channel::Sender<TrayCommand>) -> anyhow::Result<Tray> {
            let tray_commands = commands.clone();
            tray_icon::TrayIconEvent::set_event_handler(Some(move |event| {
                if matches!(event, tray_icon::TrayIconEvent::DoubleClick { .. }) {
                    let _ = tray_commands.try_send(TrayCommand::Controls);
                }
            }));
            let show_camera = CheckMenuItem::new("Show camera", true, camera_shown, None);
            let quit = MenuItem::new("Quit CamFrame", true, None);
            let menu = Menu::new();
            let scenes_menu = Submenu::new("Scenes", true);
            let scene_actions = Arc::new(Mutex::new(Vec::<(MenuId, TrayCommand)>::new()));
            let handler_scenes = Arc::clone(&scene_actions);
            let controls = MenuItem::new("Open controls", true, None);
            let help = MenuItem::new("Help & onboarding", true, None);
            menu.append_items(&[
                &controls,
                &help,
                &show_camera,
                &scenes_menu,
                &PredefinedMenuItem::separator(),
                &quit,
            ])?;

            let (show_id, quit_id) = (show_camera.id().clone(), quit.id().clone());
            let actions = [(controls.id().clone(), TrayCommand::Controls), (help.id().clone(), TrayCommand::Help)];
            MenuEvent::set_event_handler(Some(move |event: MenuEvent| {
                let command = if event.id == show_id {
                    TrayCommand::ToggleCamera
                } else if event.id == quit_id {
                    TrayCommand::Quit
                } else if let Some((_, command)) = actions.iter().find(|(id, _)| *id == event.id) {
                    *command
                } else if let Some((_, command)) =
                    crate::camera::lock_unpoisoned(&handler_scenes).iter().find(|(id, _)| *id == event.id)
                {
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
            Ok(Tray { _icon: icon, show_camera, scenes_menu, scene_actions })
        }

        /// Keeps the tick in step when the camera is shown or hidden some other way.
        pub fn set_camera_shown(&self, shown: bool) {
            self.show_camera.set_checked(shown);
        }

        pub fn set_scenes(&self, scenes: &[camframe_core::settings::Scene], active: &str) {
            for _ in self.scenes_menu.items() {
                let _ = self.scenes_menu.remove_at(0);
            }
            let mut actions = crate::camera::lock_unpoisoned(&self.scene_actions);
            actions.clear();
            for (i, scene) in scenes.iter().enumerate() {
                let item = CheckMenuItem::new(&scene.name, true, scene.id == active, None);
                if self.scenes_menu.append(&item).is_ok() {
                    actions.push((item.id().clone(), TrayCommand::Scene(i)));
                }
            }
            if scenes.is_empty() {
                let _ = self.scenes_menu.append(&MenuItem::new("No saved scenes", false, None));
            }
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
    pub fn set_scenes(&self, _scenes: &[camframe_core::settings::Scene], _active: &str) {}
}
