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
    use windows::Win32::Foundation::{BOOL, HWND};
    use windows::Win32::Graphics::Dwm::{
        DWM_WINDOW_CORNER_PREFERENCE, DWMNCRP_DISABLED, DWMSBT_NONE, DWMWCP_DONOTROUND,
        DWMWA_BORDER_COLOR, DWMWA_COLOR_NONE, DWMWA_NCRENDERING_POLICY,
        DWMWA_SYSTEMBACKDROP_TYPE, DWMWA_WINDOW_CORNER_PREFERENCE, DwmSetWindowAttribute,
    };
    use windows::Win32::System::LibraryLoader::{GetModuleHandleA, GetProcAddress};
    use windows::Win32::UI::WindowsAndMessaging::{
        GWL_EXSTYLE, GWL_STYLE, GetWindowLongPtrW, HWND_TOPMOST, SWP_FRAMECHANGED,
        SWP_NOACTIVATE, SWP_NOMOVE, SWP_NOSIZE, SetWindowLongPtrW, SetWindowPos, WS_BORDER,
        WS_CAPTION, WS_CLIPCHILDREN, WS_CLIPSIBLINGS, WS_DLGFRAME, WS_EX_NOREDIRECTIONBITMAP,
        WS_EX_TOOLWINDOW, WS_EX_TOPMOST, WS_POPUP, WS_SYSMENU, WS_THICKFRAME,
    };
    use windows::core::PCSTR;

    let raw = window
        .window_handle()
        .map_err(|e| format!("failed to get raw window handle: {e}"))?
        .as_raw();
    let RawWindowHandle::Win32(win32) = raw else {
        return Err("expected Win32 window handle".into());
    };
    let hwnd = HWND(win32.hwnd.get() as *mut core::ffi::c_void);

    unsafe {
        // 1. Switch from WS_OVERLAPPED (0) to WS_POPUP so Windows 11 DWM draws zero frame/shadow.
        let current_style = GetWindowLongPtrW(hwnd, GWL_STYLE) as u32;
        let strip_mask = (WS_CAPTION | WS_THICKFRAME | WS_BORDER | WS_DLGFRAME | WS_SYSMENU).0;
        let popup_style = (current_style & !strip_mask)
            | (WS_POPUP | WS_CLIPSIBLINGS | WS_CLIPCHILDREN).0;
        let _ = SetWindowLongPtrW(hwnd, GWL_STYLE, popup_style as isize);

        // 2. Ensure DirectComposition + Topmost + ToolWindow extended styles.
        let current_ex = GetWindowLongPtrW(hwnd, GWL_EXSTYLE) as u32;
        let overlay_ex = current_ex
            | (WS_EX_NOREDIRECTIONBITMAP | WS_EX_TOPMOST | WS_EX_TOOLWINDOW).0;
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

#[cfg(not(target_os = "windows"))]
pub fn configure_transparent_overlay(
    _window: &Window,
    _position: Option<(i32, i32)>,
) -> Result<(), String> {
    Ok(())
}
