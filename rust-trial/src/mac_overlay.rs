//! macOS counterpart of `win32_overlay.rs`: turns the GPUI window into a bare, see-through panel.
//!
//! `gpui_macos` creates `WindowKind::PopUp` as an `NSPanel` with the style mask
//! `Titled | FullSizeContentView | NonactivatingPanel`. Even with a hidden, transparent title bar a
//! titled window keeps three things a floating camera bubble must not have:
//! 1. the system window shadow (drawn around the whole rectangular window),
//! 2. rounded window-frame corners and the traffic-light buttons of the title bar,
//! 3. `hidesOnDeactivate = YES`, the `NSPanel` default, which hides the bubble whenever the app
//!    loses focus.
//!
//! Fix: right after GPUI opens the window, switch the panel to `Borderless | NonactivatingPanel`,
//! turn the shadow off, keep the window non-opaque with a fully clear background (GPUI already
//! clears its `CAMetalLayer` to transparent for `WindowBackgroundAppearance::Transparent`), keep it
//! on the pop-up level above normal windows on every Space, and stop it from hiding on deactivate.
//! Shapes stay clipped per pixel on the GPU, exactly as on Windows.

use gpui::Window;
use objc2::runtime::{AnyObject, Bool};
use objc2::{class, msg_send};
use raw_window_handle::{HasWindowHandle, RawWindowHandle};

/// `NSWindowStyleMaskBorderless` is 0; only the non-activating panel bit stays set.
const NS_WINDOW_STYLE_MASK_NONACTIVATING_PANEL: usize = 1 << 7;
/// `NSPopUpMenuWindowLevel`, the level `gpui_macos` already uses for `WindowKind::PopUp`.
const NS_POP_UP_WINDOW_LEVEL: isize = 101;
/// `NSWindowCollectionBehaviorCanJoinAllSpaces | NSWindowCollectionBehaviorFullScreenAuxiliary`.
const NS_WINDOW_COLLECTION_BEHAVIOR_ALL_SPACES: usize = (1 << 0) | (1 << 8);

pub fn configure_transparent_overlay(
    window: &Window,
    _position: Option<(i32, i32)>,
) -> Result<(), String> {
    let raw = HasWindowHandle::window_handle(window)
        .map_err(|e| format!("failed to get raw window handle: {e}"))?
        .as_raw();
    let RawWindowHandle::AppKit(appkit) = raw else {
        return Err("expected AppKit window handle".into());
    };
    let ns_view = appkit.ns_view.as_ptr().cast::<AnyObject>();

    // SAFETY: GPUI hands us its live `GPUIView` (an `NSView`) on the main thread during window
    // creation; every message below is a documented `NSWindow`/`NSPanel` setter.
    unsafe {
        let ns_window: *mut AnyObject = msg_send![ns_view, window];
        if ns_window.is_null() {
            return Err("GPUI view has no NSWindow yet".into());
        }

        let _: () = msg_send![ns_window, setStyleMask: NS_WINDOW_STYLE_MASK_NONACTIVATING_PANEL];
        let _: () = msg_send![ns_window, setHasShadow: Bool::NO];
        let _: () = msg_send![ns_window, setOpaque: Bool::NO];
        let clear: *mut AnyObject = msg_send![class!(NSColor), clearColor];
        let _: () = msg_send![ns_window, setBackgroundColor: clear];
        let _: () = msg_send![ns_window, setLevel: NS_POP_UP_WINDOW_LEVEL];
        let _: () = msg_send![
            ns_window,
            setCollectionBehavior: NS_WINDOW_COLLECTION_BEHAVIOR_ALL_SPACES
        ];
        let _: () = msg_send![ns_window, setHidesOnDeactivate: Bool::NO];
    }

    Ok(())
}
