//! Windows DirectComposition transparent-overlay shim for GPUI windows.
//!
//! Why this exists (and why the previous 2026-10-13 GPUI experiment showed a black box with a gray
//! rounded outline on Windows 11):
//! 1. `gpui_windows` creates `WindowKind::PopUp` with `dwstyle = 0` (`WS_OVERLAPPED`), not
//!    `WS_POPUP`. On Windows 11, DWM draws a 1px gray rounded border and drop shadow on overlapped
//!    windows even when `WM_NCCALCSIZE` removes the title bar.
//! 2. `gpui_windows::set_background_appearance(WindowBackgroundAppearance::Transparent)` calls
//!    `SetWindowCompositionAttribute(hwnd, ACCENT_ENABLE_TRANSPARENTGRADIENT = 2, 0x00000000)`.
//!    On Windows 11 with `WS_EX_NOREDIRECTIONBITMAP`, that undocumented accent policy paints an
//!    opaque black rectangular backdrop behind the DirectComposition surface.
//!
//! Fix: immediately after GPUI opens the window, switch the HWND to `WS_POPUP`, disable DWM
//! non-client rendering / corner rounding / border color / system backdrop, and reset
//! `SetWindowCompositionAttribute` to `ACCENT_DISABLED (0)` while leaving GPUI's internal
//! `background_appearance` as `Transparent` (so GPUI's `DirectXRenderer` keeps clearing its
//! `DXGI_ALPHA_MODE_PREMULTIPLIED` DirectComposition swap chain to `[0, 0, 0, 0]`).

use gpui::Window;

#[cfg(target_os = "windows")]
pub fn configure_transparent_overlay(window: &Window, position: Option<(i32, i32)>) -> Result<(), String> {
    use raw_window_handle::{HasWindowHandle, RawWindowHandle};
    use windows::Win32::Foundation::HWND;
    use windows::Win32::Graphics::Dwm::{
        DWM_WINDOW_CORNER_PREFERENCE, DWMNCRP_DISABLED, DWMSBT_NONE, DWMWA_BORDER_COLOR, DWMWA_COLOR_NONE,
        DWMWA_NCRENDERING_POLICY, DWMWA_SYSTEMBACKDROP_TYPE, DWMWA_WINDOW_CORNER_PREFERENCE, DWMWCP_DONOTROUND,
        DwmSetWindowAttribute,
    };
    use windows::Win32::System::LibraryLoader::{GetModuleHandleA, GetProcAddress};
    use windows::Win32::UI::WindowsAndMessaging::{
        GWL_EXSTYLE, GWL_STYLE, GetWindowLongPtrW, HWND_TOPMOST, SWP_FRAMECHANGED, SWP_NOACTIVATE, SWP_NOMOVE,
        SWP_NOSIZE, SetWindowLongPtrW, SetWindowPos, WS_BORDER, WS_CAPTION, WS_CLIPCHILDREN, WS_CLIPSIBLINGS,
        WS_DLGFRAME, WS_EX_NOREDIRECTIONBITMAP, WS_EX_TOOLWINDOW, WS_EX_TOPMOST, WS_POPUP, WS_SYSMENU, WS_THICKFRAME,
    };
    use windows::core::{BOOL, PCSTR};

    let raw =
        HasWindowHandle::window_handle(window).map_err(|e| format!("failed to get raw window handle: {e}"))?.as_raw();
    let RawWindowHandle::Win32(win32) = raw else {
        return Err("expected Win32 window handle".into());
    };
    let hwnd = HWND(win32.hwnd.get() as *mut core::ffi::c_void);

    unsafe {
        // 1. Switch from WS_OVERLAPPED (0) to WS_POPUP so Windows 11 DWM draws zero frame/shadow.
        let current_style = GetWindowLongPtrW(hwnd, GWL_STYLE) as u32;
        let strip_mask = (WS_CAPTION | WS_THICKFRAME | WS_BORDER | WS_DLGFRAME | WS_SYSMENU).0;
        let popup_style = (current_style & !strip_mask) | (WS_POPUP | WS_CLIPSIBLINGS | WS_CLIPCHILDREN).0;
        let _ = SetWindowLongPtrW(hwnd, GWL_STYLE, popup_style as isize);

        // 2. Ensure DirectComposition + Topmost + ToolWindow extended styles.
        let current_ex = GetWindowLongPtrW(hwnd, GWL_EXSTYLE) as u32;
        let overlay_ex = current_ex | (WS_EX_NOREDIRECTIONBITMAP | WS_EX_TOPMOST | WS_EX_TOOLWINDOW).0;
        let _ = SetWindowLongPtrW(hwnd, GWL_EXSTYLE, overlay_ex as isize);

        // 3. Disable DWM non-client frame, Windows 11 corner rounding, border, and system backdrop.
        let ncrp = DWMNCRP_DISABLED.0 as u32;
        let _ = DwmSetWindowAttribute(
            hwnd,
            DWMWA_NCRENDERING_POLICY,
            &ncrp as *const _ as *const _,
            std::mem::size_of_val(&ncrp) as u32,
        );
        let corner: DWM_WINDOW_CORNER_PREFERENCE = DWMWCP_DONOTROUND;
        let _ = DwmSetWindowAttribute(
            hwnd,
            DWMWA_WINDOW_CORNER_PREFERENCE,
            &corner as *const _ as *const _,
            std::mem::size_of_val(&corner) as u32,
        );
        let border_none: u32 = DWMWA_COLOR_NONE;
        let _ = DwmSetWindowAttribute(
            hwnd,
            DWMWA_BORDER_COLOR,
            &border_none as *const _ as *const _,
            std::mem::size_of_val(&border_none) as u32,
        );
        let backdrop = DWMSBT_NONE.0 as u32;
        let _ = DwmSetWindowAttribute(
            hwnd,
            DWMWA_SYSTEMBACKDROP_TYPE,
            &backdrop as *const _ as *const _,
            std::mem::size_of_val(&backdrop) as u32,
        );

        // 4. Clear GPUI's ACCENT_ENABLE_TRANSPARENTGRADIENT back to ACCENT_DISABLED (0).
        // GPUI still keeps its internal `background_appearance = Transparent` (clearing the
        // premultiplied-alpha DirectComposition swap chain to [0, 0, 0, 0]).
        clear_window_composition_accent(hwnd);

        // 5. Commit style changes, enforce HWND_TOPMOST, and apply optional initial position.
        let (x, y, flags) = match position {
            Some((px, py)) => (px, py, SWP_NOSIZE | SWP_NOACTIVATE | SWP_FRAMECHANGED),
            None => (0, 0, SWP_NOMOVE | SWP_NOSIZE | SWP_NOACTIVATE | SWP_FRAMECHANGED),
        };
        let _ = SetWindowPos(hwnd, Some(HWND_TOPMOST), x, y, 0, 0, flags);
    }

    #[repr(C)]
    struct AccentPolicy {
        accent_state: u32,
        accent_flags: u32,
        gradient_color: u32,
        animation_id: u32,
    }

    #[repr(C)]
    struct WindowCompositionAttribData {
        attrib: u32,
        pv_data: *mut core::ffi::c_void,
        cb_data: usize,
    }

    unsafe fn clear_window_composition_accent(hwnd: HWND) {
        type SetWindowCompositionAttributeFn =
            unsafe extern "system" fn(HWND, *mut WindowCompositionAttribData) -> BOOL;

        let Ok(user32) = (unsafe { GetModuleHandleA(PCSTR(c"user32.dll".as_ptr().cast())) }) else {
            return;
        };
        let Some(proc_addr) =
            (unsafe { GetProcAddress(user32, PCSTR(c"SetWindowCompositionAttribute".as_ptr().cast())) })
        else {
            return;
        };
        let set_attr: SetWindowCompositionAttributeFn = unsafe { std::mem::transmute(proc_addr) };
        let mut accent = AccentPolicy {
            accent_state: 0, // ACCENT_DISABLED
            accent_flags: 0,
            gradient_color: 0,
            animation_id: 0,
        };
        let mut data = WindowCompositionAttribData {
            attrib: 0x13, // WCA_ACCENT_POLICY
            pv_data: (&mut accent as *mut AccentPolicy).cast(),
            cb_data: std::mem::size_of::<AccentPolicy>(),
        };
        let _ = unsafe { set_attr(hwnd, &mut data) };
    }

    Ok(())
}

#[cfg(target_os = "windows")]
fn hwnd_of(window: &Window) -> Option<windows::Win32::Foundation::HWND> {
    use raw_window_handle::{HasWindowHandle, RawWindowHandle};
    match HasWindowHandle::window_handle(window).ok()?.as_raw() {
        RawWindowHandle::Win32(win32) => {
            Some(windows::Win32::Foundation::HWND(win32.hwnd.get() as *mut core::ffi::c_void))
        }
        _ => None,
    }
}

/// Moves and sizes the window in one step. `bounds` are logical pixels, like GPUI's.
#[cfg(target_os = "windows")]
pub fn set_bounds(window: &mut Window, bounds: camframe_core::geometry::Rect, cx: &mut gpui::App) {
    use windows::Win32::UI::WindowsAndMessaging::{SWP_NOACTIVATE, SWP_NOZORDER, SetWindowPos};
    let Some(hwnd) = hwnd_of(window) else { return };
    let scale = f64::from(window.scale_factor());
    let physical = |value: i64| (value as f64 * scale).round() as i32;
    // SAFETY: a live window handle on the UI thread; SetWindowPos only reads its arguments.
    unsafe {
        let _ = SetWindowPos(
            hwnd,
            None,
            physical(bounds.x),
            physical(bounds.y),
            physical(bounds.width),
            physical(bounds.height),
            SWP_NOACTIVATE | SWP_NOZORDER,
        );
    }
    // SetWindowPos sends WM_SIZE synchronously while GPUI has this Window checked out. Its
    // callback cannot re-enter the Window, so explicitly synchronize the drawable viewport.
    window.bounds_changed(cx);
}

/// Lets clicks go through the window to the app behind it (`through`), or takes them again. The
/// window is layered once so Windows routes clicks past it while `WS_EX_TRANSPARENT` is set.
#[cfg(target_os = "windows")]
pub fn set_click_through(window: &Window, through: bool) {
    use windows::Win32::Foundation::COLORREF;
    use windows::Win32::UI::WindowsAndMessaging::{
        GWL_EXSTYLE, GetWindowLongPtrW, LWA_ALPHA, SetLayeredWindowAttributes, SetWindowLongPtrW, WS_EX_LAYERED,
        WS_EX_TRANSPARENT,
    };
    let Some(hwnd) = hwnd_of(window) else { return };
    // SAFETY: style changes on a live window handle on the UI thread.
    unsafe {
        let current = GetWindowLongPtrW(hwnd, GWL_EXSTYLE) as u32;
        let mut next = current | WS_EX_LAYERED.0;
        if through {
            next |= WS_EX_TRANSPARENT.0;
        } else {
            next &= !WS_EX_TRANSPARENT.0;
        }
        if next != current {
            let _ = SetWindowLongPtrW(hwnd, GWL_EXSTYLE, next as isize);
            if current & WS_EX_LAYERED.0 == 0 {
                let _ = SetLayeredWindowAttributes(hwnd, COLORREF(0), 255, LWA_ALPHA);
            }
        }
    }
}

/// The pointer on screen, in logical pixels for this window's display.
#[cfg(target_os = "windows")]
pub fn cursor_position(window: &Window) -> Option<(f64, f64)> {
    use windows::Win32::Foundation::POINT;
    use windows::Win32::UI::WindowsAndMessaging::GetCursorPos;
    let mut point = POINT::default();
    // SAFETY: GetCursorPos writes into the POINT we own.
    unsafe { GetCursorPos(&mut point).ok()? };
    let scale = f64::from(window.scale_factor());
    Some((f64::from(point.x) / scale, f64::from(point.y) / scale))
}

/// Whether the main mouse button is held down now (the right one when the buttons are swapped).
#[cfg(target_os = "windows")]
pub fn primary_button_down() -> bool {
    use windows::Win32::UI::Input::KeyboardAndMouse::{GetAsyncKeyState, VK_LBUTTON, VK_RBUTTON};
    use windows::Win32::UI::WindowsAndMessaging::{GetSystemMetrics, SM_SWAPBUTTON};
    // SAFETY: both calls only read input state.
    unsafe {
        let key = if GetSystemMetrics(SM_SWAPBUTTON) != 0 { VK_RBUTTON } else { VK_LBUTTON };
        (GetAsyncKeyState(i32::from(key.0)) as u16) & 0x8000 != 0
    }
}

#[cfg(target_os = "windows")]
pub fn set_always_on_top(window: &Window, on_top: bool) {
    use windows::Win32::UI::WindowsAndMessaging::{
        HWND_NOTOPMOST, HWND_TOPMOST, SWP_NOACTIVATE, SWP_NOMOVE, SWP_NOSIZE, SetWindowPos,
    };
    let Some(hwnd) = hwnd_of(window) else { return };
    // SAFETY: changes only the z-order of GPUI's live window on the UI thread.
    unsafe {
        let _ = SetWindowPos(
            hwnd,
            Some(if on_top { HWND_TOPMOST } else { HWND_NOTOPMOST }),
            0,
            0,
            0,
            0,
            SWP_NOACTIVATE | SWP_NOMOVE | SWP_NOSIZE,
        );
    }
}

#[cfg(not(target_os = "windows"))]
pub fn set_always_on_top(_window: &Window, _on_top: bool) {}

#[cfg(target_os = "windows")]
pub fn accessibility_preferences() -> (bool, bool) {
    use windows::Win32::UI::Accessibility::{HCF_HIGHCONTRASTON, HIGHCONTRASTW};
    use windows::Win32::UI::WindowsAndMessaging::{
        SPI_GETCLIENTAREAANIMATION, SPI_GETHIGHCONTRAST, SYSTEM_PARAMETERS_INFO_UPDATE_FLAGS, SystemParametersInfoW,
    };
    let mut animation = windows::core::BOOL(1);
    let mut contrast = HIGHCONTRASTW { cbSize: std::mem::size_of::<HIGHCONTRASTW>() as u32, ..Default::default() };
    // SAFETY: the OS fills correctly sized local preference values; no window state is changed.
    unsafe {
        let _ = SystemParametersInfoW(
            SPI_GETCLIENTAREAANIMATION,
            0,
            Some((&mut animation as *mut windows::core::BOOL).cast()),
            SYSTEM_PARAMETERS_INFO_UPDATE_FLAGS(0),
        );
        let _ = SystemParametersInfoW(
            SPI_GETHIGHCONTRAST,
            contrast.cbSize,
            Some((&mut contrast as *mut HIGHCONTRASTW).cast()),
            SYSTEM_PARAMETERS_INFO_UPDATE_FLAGS(0),
        );
    }
    (!animation.as_bool(), contrast.dwFlags.0 & HCF_HIGHCONTRASTON.0 != 0)
}
#[cfg(not(target_os = "windows"))]
pub fn accessibility_preferences() -> (bool, bool) {
    (false, false)
}

#[cfg(target_os = "windows")]
pub fn set_visible(window: &Window, visible: bool) {
    use windows::Win32::UI::WindowsAndMessaging::{SW_HIDE, SW_SHOWNOACTIVATE, ShowWindow};
    let Some(hwnd) = hwnd_of(window) else { return };
    // SAFETY: a live window handle on the UI thread.
    unsafe {
        let _ = ShowWindow(hwnd, if visible { SW_SHOWNOACTIVATE } else { SW_HIDE });
    }
}

// Linux builds only run the unit tests and local development; the window calls do nothing there.
#[cfg(not(target_os = "windows"))]
pub fn configure_transparent_overlay(_window: &Window, _position: Option<(i32, i32)>) -> Result<(), String> {
    Ok(())
}

#[cfg(not(target_os = "windows"))]
pub fn set_bounds(_window: &mut Window, _bounds: camframe_core::geometry::Rect, _cx: &mut gpui::App) {}

#[cfg(not(target_os = "windows"))]
pub fn set_click_through(_window: &Window, _through: bool) {}

#[cfg(not(target_os = "windows"))]
pub fn cursor_position(_window: &Window) -> Option<(f64, f64)> {
    None
}

#[cfg(not(target_os = "windows"))]
pub fn set_visible(_window: &Window, _visible: bool) {}

#[cfg(not(target_os = "windows"))]
pub fn primary_button_down() -> bool {
    false
}

/// Windows applies bounds synchronously; only the Mac shim has queued native frames.
pub fn pending_bounds(_window: &Window) -> Option<camframe_core::geometry::Rect> {
    None
}

// Windows and the Linux test host retain the existing reserved scrollbar.
pub fn uses_overlay_scrollbars() -> bool {
    false
}
