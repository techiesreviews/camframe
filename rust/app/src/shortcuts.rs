//! Global shortcuts are registered on GPUI's UI thread, alongside its native message loop.
use crate::tray::TrayCommand;

#[cfg(any(target_os = "windows", target_os = "macos"))]
pub struct Shortcuts {
    _manager: global_hotkey::GlobalHotKeyManager,
}

#[cfg(any(target_os = "windows", target_os = "macos"))]
impl Shortcuts {
    pub fn new(commands: async_channel::Sender<TrayCommand>) -> (Option<Self>, Vec<String>) {
        use global_hotkey::{
            GlobalHotKeyEvent, GlobalHotKeyManager, HotKeyState,
            hotkey::{Code, HotKey, Modifiers},
        };
        let mut failed = Vec::new();
        let manager = match GlobalHotKeyManager::new() {
            Ok(manager) => manager,
            Err(error) => return (None, vec![format!("Shortcuts unavailable: {error}")]),
        };
        let mut mods = Modifiers::SHIFT;
        #[cfg(target_os = "macos")]
        {
            mods |= Modifiers::META;
        }
        #[cfg(target_os = "windows")]
        {
            mods |= Modifiers::CONTROL;
        }
        let mut ids = Vec::new();
        let mut bindings = vec![
            (Code::KeyC, "C", TrayCommand::Controls),
            (Code::KeyH, "H", TrayCommand::ToggleCamera),
            (Code::KeyF, "F", TrayCommand::Fullscreen),
        ];
        bindings.push((Code::KeyP, "P", TrayCommand::CycleScene));
        for (i, code) in
            [Code::Digit1, Code::Digit2, Code::Digit3, Code::Digit4, Code::Digit5, Code::Digit6].into_iter().enumerate()
        {
            let name = ["1", "2", "3", "4", "5", "6"][i];
            bindings.push((code, name, TrayCommand::Scene(i)));
        }
        for (code, name, command) in bindings {
            let hotkey = HotKey::new(Some(mods), code);
            if let Err(error) = manager.register(hotkey) {
                failed.push(format!(
                    "{}+Shift+{name}: {error}",
                    if cfg!(target_os = "macos") { "Command" } else { "Ctrl" }
                ));
            } else {
                ids.push((hotkey.id(), command));
            }
        }
        GlobalHotKeyEvent::set_event_handler(Some(move |event: GlobalHotKeyEvent| {
            if event.state == HotKeyState::Pressed
                && let Some((_, command)) = ids.iter().find(|(id, _)| *id == event.id)
            {
                let _ = commands.try_send(*command);
            }
        }));
        (Some(Self { _manager: manager }), failed)
    }
}

#[cfg(not(any(target_os = "windows", target_os = "macos")))]
pub struct Shortcuts;
#[cfg(not(any(target_os = "windows", target_os = "macos")))]
impl Shortcuts {
    pub fn new(_: async_channel::Sender<TrayCommand>) -> (Option<Self>, Vec<String>) {
        (Some(Self), Vec::new())
    }
}
