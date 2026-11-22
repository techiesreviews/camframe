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
use objc2::encode::{Encode, Encoding};
use objc2::runtime::{AnyObject, Bool};
use objc2::{class, msg_send};
use raw_window_handle::{HasWindowHandle, RawWindowHandle};

/// `NSWindowStyleMaskBorderless` is 0; only the non-activating panel bit stays set.
const NS_WINDOW_STYLE_MASK_NONACTIVATING_PANEL: usize = 1 << 7;
/// `NSPopUpMenuWindowLevel`, the level `gpui_macos` already uses for `WindowKind::PopUp`.
const NS_POP_UP_WINDOW_LEVEL: isize = 101;
/// `NSWindowCollectionBehaviorCanJoinAllSpaces | NSWindowCollectionBehaviorFullScreenAuxiliary`.
const NS_WINDOW_COLLECTION_BEHAVIOR_ALL_SPACES: usize = (1 << 0) | (1 << 8);

pub fn configure_transparent_overlay(window: &Window, _position: Option<(i32, i32)>) -> Result<(), String> {
    let raw =
        HasWindowHandle::window_handle(window).map_err(|e| format!("failed to get raw window handle: {e}"))?.as_raw();
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

        // No Dock icon: the tray (menu bar) icon keeps the app reachable, as in 0.9.0.
        let app: *mut AnyObject = msg_send![class!(NSApplication), sharedApplication];
        let _: Bool = msg_send![app, setActivationPolicy: NS_APPLICATION_ACTIVATION_POLICY_ACCESSORY];
    }

    Ok(())
}

/// `NSApplicationActivationPolicyAccessory`.
const NS_APPLICATION_ACTIVATION_POLICY_ACCESSORY: isize = 1;

#[repr(C)]
#[derive(Clone, Copy)]
struct CgPoint {
    x: f64,
    y: f64,
}

#[repr(C)]
#[derive(Clone, Copy)]
struct CgSize {
    width: f64,
    height: f64,
}

#[repr(C)]
#[derive(Clone, Copy)]
struct CgRect {
    origin: CgPoint,
    size: CgSize,
}

// SAFETY: the layouts above are exactly CoreGraphics' CGPoint, CGSize and CGRect on 64-bit macOS.
unsafe impl Encode for CgPoint {
    const ENCODING: Encoding = Encoding::Struct("CGPoint", &[f64::ENCODING, f64::ENCODING]);
}
unsafe impl Encode for CgSize {
    const ENCODING: Encoding = Encoding::Struct("CGSize", &[f64::ENCODING, f64::ENCODING]);
}
unsafe impl Encode for CgRect {
    const ENCODING: Encoding = Encoding::Struct("CGRect", &[CgPoint::ENCODING, CgSize::ENCODING]);
}

fn ns_window_of(window: &Window) -> Option<*mut AnyObject> {
    let RawWindowHandle::AppKit(appkit) = HasWindowHandle::window_handle(window).ok()?.as_raw() else {
        return None;
    };
    let ns_view = appkit.ns_view.as_ptr().cast::<AnyObject>();
    // SAFETY: GPUI's live NSView on the main thread.
    let ns_window: *mut AnyObject = unsafe { msg_send![ns_view, window] };
    (!ns_window.is_null()).then_some(ns_window)
}

/// The height of the main screen: AppKit counts y up from its bottom, GPUI down from its top.
fn main_screen_height() -> f64 {
    // SAFETY: class methods and getters on the main thread.
    unsafe {
        let screens: *mut AnyObject = msg_send![class!(NSScreen), screens];
        let first: *mut AnyObject = msg_send![screens, firstObject];
        if first.is_null() {
            return 0.0;
        }
        let frame: CgRect = msg_send![first, frame];
        frame.size.height
    }
}

/// Moves and sizes the window in one step. `bounds` are GPUI points (top-left origin).
pub fn set_bounds(window: &mut Window, bounds: camframe_core::geometry::Rect, cx: &mut gpui::App) {
    let Some(ns_window) = ns_window_of(window) else { return };
    let frame = CgRect {
        origin: CgPoint { x: bounds.x as f64, y: main_screen_height() - (bounds.y + bounds.height) as f64 },
        size: CgSize { width: bounds.width as f64, height: bounds.height as f64 },
    };
    // SAFETY: documented NSWindow setter on the main thread.
    unsafe {
        let _: () = msg_send![ns_window, setFrame: frame, display: Bool::YES];
    }
    window.bounds_changed(cx);
}

pub fn set_click_through(window: &Window, through: bool) {
    let Some(ns_window) = ns_window_of(window) else { return };
    // SAFETY: documented NSWindow setter on the main thread.
    unsafe {
        let _: () = msg_send![ns_window, setIgnoresMouseEvents: Bool::new(through)];
    }
}

/// The pointer on screen in GPUI points (top-left origin of the main screen).
pub fn cursor_position(_window: &Window) -> Option<(f64, f64)> {
    // SAFETY: class method on the main thread.
    let location: CgPoint = unsafe { msg_send![class!(NSEvent), mouseLocation] };
    Some((location.x, main_screen_height() - location.y))
}

/// Whether the main mouse button is held down now.
pub fn primary_button_down() -> bool {
    // SAFETY: class method on the main thread.
    let buttons: usize = unsafe { msg_send![class!(NSEvent), pressedMouseButtons] };
    buttons & 1 != 0
}

pub fn set_visible(window: &Window, visible: bool) {
    let Some(ns_window) = ns_window_of(window) else { return };
    // SAFETY: documented NSWindow calls on the main thread.
    unsafe {
        if visible {
            let _: () = msg_send![ns_window, orderFrontRegardless];
        } else {
            let _: () = msg_send![ns_window, orderOut: std::ptr::null::<AnyObject>()];
        }
    }
}

pub fn set_always_on_top(window: &Window, on_top: bool) {
    let Some(ns_window) = ns_window_of(window) else { return };
    let level: isize = if on_top { NS_POP_UP_WINDOW_LEVEL } else { 0 };
    // SAFETY: documented NSWindow setter on the main thread.
    unsafe {
        let _: () = msg_send![ns_window, setLevel: level];
    }
}

pub fn accessibility_preferences() -> (bool, bool) {
    // SAFETY: documented NSWorkspace preference getters on GPUI's main thread.
    unsafe {
        let workspace: *mut AnyObject = msg_send![class!(NSWorkspace), sharedWorkspace];
        let reduced: Bool = msg_send![workspace, accessibilityDisplayShouldReduceMotion];
        let contrast: Bool = msg_send![workspace, accessibilityDisplayShouldIncreaseContrast];
        (reduced.as_bool(), contrast.as_bool())
    }
}
