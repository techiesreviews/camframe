param(
    [Parameter(Mandatory = $true)]
    [string]$ExePath,
    [Parameter(Mandatory = $true)]
    [string]$OutDir,
    [string]$CamFrame090Exe = ""
)

$ErrorActionPreference = "Stop"
New-Item -ItemType Directory -Force -Path $OutDir | Out-Null

Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing

Add-Type @"
using System;
using System.Collections.Generic;
using System.Runtime.InteropServices;

public static class Win32Verify {
    public delegate bool EnumWindowsProc(IntPtr hWnd, IntPtr lParam);

    [DllImport("user32.dll")]
    public static extern bool EnumWindows(EnumWindowsProc lpEnumFunc, IntPtr lParam);

    [DllImport("user32.dll")]
    public static extern uint GetWindowThreadProcessId(IntPtr hWnd, out uint lpdwProcessId);

    [DllImport("user32.dll")]
    public static extern bool IsWindowVisible(IntPtr hWnd);

    [DllImport("user32.dll")]
    public static extern bool SetForegroundWindow(IntPtr hWnd);

    [DllImport("user32.dll")]
    public static extern bool GetWindowRect(IntPtr hWnd, out RECT lpRect);

    [DllImport("user32.dll")]
    public static extern int GetWindowLong(IntPtr hWnd, int nIndex);

    [DllImport("user32.dll")]
    public static extern uint GetDpiForWindow(IntPtr hWnd);

    [DllImport("user32.dll")]
    public static extern bool SetCursorPos(int x, int y);

    [DllImport("user32.dll")]
    public static extern void mouse_event(uint dwFlags, uint dx, uint dy, uint dwData, UIntPtr dwExtraInfo);

    [StructLayout(LayoutKind.Sequential)]
    public struct RECT {
        public int Left;
        public int Top;
        public int Right;
        public int Bottom;
    }

    public static IntPtr FindVisibleWindowByPid(int pid) {
        IntPtr found = IntPtr.Zero;
        EnumWindows((hWnd, lParam) => {
            uint wPid;
            GetWindowThreadProcessId(hWnd, out wPid);
            if ((int)wPid == pid && IsWindowVisible(hWnd)) {
                RECT r;
                if (GetWindowRect(hWnd, out r) && (r.Right - r.Left) > 50 && (r.Bottom - r.Top) > 50) {
                    found = hWnd;
                    return false;
                }
            }
            return true;
        }, IntPtr.Zero);
        return found;
    }
}
"@

function Capture-ScreenRegion {
    param([int]$X, [int]$Y, [int]$W, [int]$H, [string]$Path)
    $bmp = New-Object System.Drawing.Bitmap($W, $H)
    $g = [System.Drawing.Graphics]::FromImage($bmp)
    $g.CopyFromScreen($X, $Y, 0, 0, (New-Object System.Drawing.Size($W, $H)))
    $g.Dispose()
    $bmp.Save($Path, [System.Drawing.Imaging.ImageFormat]::Png)
    return $bmp
}

function Is-Magenta {
    param([System.Drawing.Color]$Color)
    return ($Color.R -ge 240 -and $Color.G -le 15 -and $Color.B -ge 240)
}

function Format-Color {
    param([System.Drawing.Color]$Color)
    return ("rgb({0},{1},{2})" -f $Color.R, $Color.G, $Color.B)
}

# Launch a bright magenta (#FF00FF) borderless backdrop in a separate PowerShell job/process
# so the desktop behind our transparent bubble is a known exact color.
$backdropScript = @"
Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing
`$form = New-Object System.Windows.Forms.Form
`$form.FormBorderStyle = 'None'
`$form.WindowState = 'Maximized'
`$form.BackColor = [System.Drawing.Color]::FromArgb(255, 0, 255)
`$form.ShowInTaskbar = `$false
`$form.TopMost = `$false
`$form.Show()
[System.Windows.Forms.Application]::Run(`$form)
"@
$backdropProc = Start-Process -FilePath "powershell.exe" -ArgumentList @("-NoProfile", "-WindowStyle", "Hidden", "-Command", $backdropScript) -PassThru
Start-Sleep -Milliseconds 1200

$metricsFile = Join-Path $OutDir "rust-startup.txt"
# Preferences go to a fresh folder so the check never touches a real CamFrame setup.
$settingsDir = Join-Path $OutDir "settings"
if (Test-Path $settingsDir) { Remove-Item -Recurse -Force $settingsDir }
New-Item -ItemType Directory -Force -Path $settingsDir | Out-Null
$prefsFile = Join-Path $settingsDir "CamFrame Rust\preferences.json"
# WS_EX_TRANSPARENT: set while clicks pass through the window.
$WS_EX_TRANSPARENT = 0x20
$winX = 200
$winY = 150
$cropX = 150
$cropY = 100
$cropW = 424
$cropH = 462

$rustExeSize = (Get-Item $ExePath).Length
$rustProc = $null

try {
    # Keep the pointer away from the bubble so the toolbar stays hidden for the first pictures.
    [void][Win32Verify]::SetCursorPos($cropX + $cropW + 200, 40)

    $sw = [System.Diagnostics.Stopwatch]::StartNew()
    $rustProc = Start-Process -FilePath $ExePath -ArgumentList @(
        "--demo-pattern",
        "--position", "$winX,$winY",
        "--metrics-file", $metricsFile,
        "--settings-dir", $settingsDir
    ) -PassThru

    $hwnd = [IntPtr]::Zero
    $windowVisibleMs = -1
    for ($i = 0; $i -lt 100; $i++) {
        $hwnd = [Win32Verify]::FindVisibleWindowByPid($rustProc.Id)
        if ($hwnd -ne [IntPtr]::Zero) {
            $windowVisibleMs = [math]::Round($sw.Elapsed.TotalMilliseconds, 1)
            break
        }
        Start-Sleep -Milliseconds 50
    }
    if ($hwnd -eq [IntPtr]::Zero) {
        throw "camframe-rust.exe window did not become visible within 5 seconds"
    }

    Start-Sleep -Milliseconds 2000

    $rect = New-Object Win32Verify+RECT
    [void][Win32Verify]::GetWindowRect($hwnd, [ref]$rect)
    $dpi = [Win32Verify]::GetDpiForWindow($hwnd)
    $scale = if ($dpi -gt 0) { $dpi / 96.0 } else { 1.0 }
    $gwlStyle = [Win32Verify]::GetWindowLong($hwnd, -16)
    $gwlExStyle = [Win32Verify]::GetWindowLong($hwnd, -20)
    Write-Host ("Rust HWND rect=({0},{1})-({2},{3}) dpi={4} scale={5} style=0x{6:X} exStyle=0x{7:X}" -f `
        $rect.Left, $rect.Top, $rect.Right, $rect.Bottom, $dpi, $scale, $gwlStyle, $gwlExStyle)

    # Sample memory after settling
    $rustProc.Refresh()
    $rustWorkingSetMb = [math]::Round($rustProc.WorkingSet64 / 1MB, 2)
    $rustPrivateMb = [math]::Round($rustProc.PrivateMemorySize64 / 1MB, 2)

    $firstFrameMs = -1
    if (Test-Path $metricsFile) {
        $raw = Get-Content $metricsFile -Raw
        if ($raw -match "STARTUP_FIRST_FRAME_MS=([0-9\.]+)") {
            $firstFrameMs = [double]$Matches[1]
        }
    }

    # Helper to compute sample coordinate inside the captured bitmap
    function Sample-Rel {
        param([System.Drawing.Bitmap]$Bmp, [double]$RelX, [double]$RelY)
        $sx = [int][math]::Round($rect.Left + $RelX * $scale) - $cropX
        $sy = [int][math]::Round($rect.Top + $RelY * $scale) - $cropY
        return $Bmp.GetPixel($sx, $sy)
    }

    function Refresh-Rect {
        [void][Win32Verify]::GetWindowRect($hwnd, [ref]$script:rect)
    }

    function Ex-Style {
        return [Win32Verify]::GetWindowLong($hwnd, -20)
    }

    # Window layout at the default size 288 (0.9.0): 84 px of room above the camera and 18 px on
    # the other sides, so a circle window is 324 x 390 with the camera at (18, 84).
    # (58, 94) is inside the camera's bounding box but outside the circle, and inside a rounded
    # square (corner radius 46).
    $clickThroughAtRest = ((Ex-Style) -band $WS_EX_TRANSPARENT) -ne 0

    # 1. Verify CIRCLE shape
    $circlePath = Join-Path $OutDir "circle.png"
    $circleBmp = Capture-ScreenRegion -X $cropX -Y $cropY -W $cropW -H $cropH -Path $circlePath
    $cTopLeft = Sample-Rel $circleBmp 8 8
    $cTopRight = Sample-Rel $circleBmp 316 8
    $cBottomLeft = Sample-Rel $circleBmp 8 380
    $cBottomRight = Sample-Rel $circleBmp 316 380
    $cCornerProbe = Sample-Rel $circleBmp 58 94
    $cCenter = Sample-Rel $circleBmp 162 228
    $circleBmp.Dispose()

    Write-Host ("CIRCLE pixels: TL={0} TR={1} BL={2} BR={3} Probe(58,94)={4} Center={5}" -f `
        (Format-Color $cTopLeft), (Format-Color $cTopRight), (Format-Color $cBottomLeft), `
        (Format-Color $cBottomRight), (Format-Color $cCornerProbe), (Format-Color $cCenter))

    # 2. Switch LIVE to ROUNDED SQUARE by sending key '2'
    [void][Win32Verify]::SetForegroundWindow($hwnd)
    Start-Sleep -Milliseconds 200
    [System.Windows.Forms.SendKeys]::SendWait("2")
    Start-Sleep -Milliseconds 700

    $roundedPath = Join-Path $OutDir "rounded.png"
    $roundedBmp = Capture-ScreenRegion -X $cropX -Y $cropY -W $cropW -H $cropH -Path $roundedPath
    Refresh-Rect
    $rTopLeft = Sample-Rel $roundedBmp 8 8
    $rTopRight = Sample-Rel $roundedBmp 316 8
    $rBottomLeft = Sample-Rel $roundedBmp 8 380
    $rBottomRight = Sample-Rel $roundedBmp 316 380
    $rCornerProbe = Sample-Rel $roundedBmp 58 94
    $rCenter = Sample-Rel $roundedBmp 162 228
    $roundedBmp.Dispose()

    Write-Host ("ROUNDED pixels: TL={0} TR={1} BL={2} BR={3} Probe(58,94)={4} Center={5}" -f `
        (Format-Color $rTopLeft), (Format-Color $rTopRight), (Format-Color $rBottomLeft), `
        (Format-Color $rBottomRight), (Format-Color $rCornerProbe), (Format-Color $rCenter))

    # 3. Switch LIVE to LANDSCAPE (16:9) by sending key '4'
    [void][Win32Verify]::SetForegroundWindow($hwnd)
    Start-Sleep -Milliseconds 200
    [System.Windows.Forms.SendKeys]::SendWait("4")
    Start-Sleep -Milliseconds 700

    $landscapePath = Join-Path $OutDir "landscape.png"
    # Landscape keeps the window's centre: 324 x 264, camera 288 x 162 at (18, 84).
    $landscapeBmp = Capture-ScreenRegion -X $cropX -Y $cropY -W $cropW -H $cropH -Path $landscapePath
    Refresh-Rect
    $landscapeHeight = [math]::Round(($rect.Bottom - $rect.Top) / $scale)
    $lTopStrip = Sample-Rel $landscapeBmp 162 60
    $lBottomStrip = Sample-Rel $landscapeBmp 162 255
    $lCenter = Sample-Rel $landscapeBmp 162 165
    $landscapeBmp.Dispose()

    Write-Host ("LANDSCAPE pixels: TopStrip(162,60)={0} BottomStrip(162,255)={1} Center={2} height={3}" -f `
        (Format-Color $lTopStrip), (Format-Color $lBottomStrip), (Format-Color $lCenter), $landscapeHeight)

    # 4. Back to the circle, then hover: the toolbar shows, the window takes clicks on the camera
    # and lets them through in the empty corner around the circle (allowed improvement 1).
    [void][Win32Verify]::SetForegroundWindow($hwnd)
    Start-Sleep -Milliseconds 200
    [System.Windows.Forms.SendKeys]::SendWait("1")
    Start-Sleep -Milliseconds 700
    Refresh-Rect
    function Move-To {
        param([double]$RelX, [double]$RelY)
        [void][Win32Verify]::SetCursorPos([int][math]::Round($rect.Left + $RelX * $scale), [int][math]::Round($rect.Top + $RelY * $scale))
        Start-Sleep -Milliseconds 400
    }
    Move-To 162 228
    $takesClicksOnCamera = ((Ex-Style) -band $WS_EX_TRANSPARENT) -eq 0
    $hoverPath = Join-Path $OutDir "hover.png"
    $hoverBmp = Capture-ScreenRegion -X $cropX -Y $cropY -W $cropW -H $cropH -Path $hoverPath
    $hToolbar = Sample-Rel $hoverBmp 162 44
    $hHandle = Sample-Rel $hoverBmp 18 84
    $hoverBmp.Dispose()
    # (43, 109) is in the empty corner of the circle, away from the corner handle.
    Move-To 43 109
    $passesInEmptyCorner = ((Ex-Style) -band $WS_EX_TRANSPARENT) -ne 0
    $cornerBmp = Capture-ScreenRegion -X $cropX -Y $cropY -W $cropW -H $cropH -Path (Join-Path $OutDir "hover-empty-corner.png")
    $hEmptyCorner = Sample-Rel $cornerBmp 43 109
    $cornerBmp.Dispose()
    # (30, 44) is beside the toolbar (which spans x 45 to 279): the toolbar stays shown, but
    # clicks pass through.
    Move-To 162 228
    Move-To 30 44
    $passesBesideToolbar = ((Ex-Style) -band $WS_EX_TRANSPARENT) -ne 0
    $besideBmp = Capture-ScreenRegion -X $cropX -Y $cropY -W $cropW -H $cropH -Path (Join-Path $OutDir "hover-beside-toolbar.png")
    $hToolbarFromBeside = Sample-Rel $besideBmp 162 44
    $besideBmp.Dispose()
    # Shape is the third of six buttons, 19 logical pixels left of the toolbar centre.
    Move-To 162 228
    Move-To 143 44
    [Win32Verify]::mouse_event(0x02, 0, 0, 0, [UIntPtr]::Zero)
    Start-Sleep -Milliseconds 60
    [Win32Verify]::mouse_event(0x04, 0, 0, 0, [UIntPtr]::Zero)
    Start-Sleep -Milliseconds 700
    Refresh-Rect
    $buttonBmp = Capture-ScreenRegion -X $cropX -Y $cropY -W $cropW -H $cropH -Path (Join-Path $OutDir "shape-button.png")
    $bCornerProbe = Sample-Rel $buttonBmp 58 94
    $buttonBmp.Dispose()
    [void][Win32Verify]::SetCursorPos($cropX + $cropW + 200, 40)
    Start-Sleep -Milliseconds 600
    $clickThroughAfterLeave = ((Ex-Style) -band $WS_EX_TRANSPARENT) -ne 0

    Write-Host ("HOVER: atRest={0} camera={1} emptyCorner={2} afterLeave={3} toolbar={4} handle={5} emptyCornerPixel={6} afterShapeButton={7} besideToolbar={8}" -f `
        $clickThroughAtRest, $takesClicksOnCamera, $passesInEmptyCorner, $clickThroughAfterLeave, `
        (Format-Color $hToolbar), (Format-Color $hHandle), (Format-Color $hEmptyCorner), (Format-Color $bCornerProbe), `
        $passesBesideToolbar)

    # Assert transparency & live shape switching
    $failures = @()
    if (-not (Is-Magenta $cTopLeft))     { $failures += "Circle outer TL not transparent: $(Format-Color $cTopLeft)" }
    if (-not (Is-Magenta $cTopRight))    { $failures += "Circle outer TR not transparent: $(Format-Color $cTopRight)" }
    if (-not (Is-Magenta $cBottomLeft))  { $failures += "Circle outer BL not transparent: $(Format-Color $cBottomLeft)" }
    if (-not (Is-Magenta $cBottomRight)) { $failures += "Circle outer BR not transparent: $(Format-Color $cBottomRight)" }
    if (-not (Is-Magenta $cCornerProbe)) { $failures += "Circle corner probe (58,94) not transparent: $(Format-Color $cCornerProbe)" }
    if (Is-Magenta $cCenter)             { $failures += "Circle center is transparent (nothing drawn)" }

    if (-not (Is-Magenta $rTopLeft))     { $failures += "Rounded outer TL not transparent: $(Format-Color $rTopLeft)" }
    if (-not (Is-Magenta $rTopRight))    { $failures += "Rounded outer TR not transparent: $(Format-Color $rTopRight)" }
    if (-not (Is-Magenta $rBottomLeft))  { $failures += "Rounded outer BL not transparent: $(Format-Color $rBottomLeft)" }
    if (-not (Is-Magenta $rBottomRight)) { $failures += "Rounded outer BR not transparent: $(Format-Color $rBottomRight)" }
    if (Is-Magenta $rCornerProbe)        { $failures += "Rounded corner probe (58,94) stayed transparent (shape did not change!)" }
    if (Is-Magenta $rCenter)             { $failures += "Rounded center is transparent" }

    if (-not (Is-Magenta $lTopStrip))    { $failures += "Landscape top strip (162,60) not transparent: $(Format-Color $lTopStrip)" }
    if (-not (Is-Magenta $lBottomStrip)) { $failures += "Landscape bottom strip (162,255) not transparent: $(Format-Color $lBottomStrip)" }
    if (Is-Magenta $lCenter)             { $failures += "Landscape center is transparent" }
    if ($landscapeHeight -ne 264)        { $failures += "Landscape window height is $landscapeHeight, expected 264" }

    if (-not $clickThroughAtRest)        { $failures += "Clicks do not pass through the window at rest" }
    if (-not $takesClicksOnCamera)       { $failures += "The window does not take clicks on the camera" }
    if (-not $passesInEmptyCorner)       { $failures += "Clicks do not pass through the empty corner around the circle" }
    if (-not $passesBesideToolbar)       { $failures += "Clicks do not pass through the empty room beside the toolbar" }
    if (Is-Magenta $hToolbarFromBeside)  { $failures += "The toolbar hid while the pointer was beside it" }
    if (-not $clickThroughAfterLeave)    { $failures += "Clicks do not pass through again after the pointer left" }
    if (Is-Magenta $hToolbar)            { $failures += "The toolbar did not show on hover" }
    if (Is-Magenta $hHandle)             { $failures += "The corner handle did not show on hover" }
    if (-not (Is-Magenta $hEmptyCorner)) { $failures += "Something is drawn in the empty corner on hover: $(Format-Color $hEmptyCorner)" }
    if (Is-Magenta $bCornerProbe)        { $failures += "Clicking the Shape button did not switch the circle to the rounded square" }

    # Preferences: saved in the app's own folder, in 0.9.0's layout, with the last shape.
    $prefsText = if (Test-Path $prefsFile) { Get-Content $prefsFile -Raw } else { "" }
    if (-not $prefsText.StartsWith("{`n  `"schemaVersion`": 15,")) { $failures += "Preferences missing or not in 0.9.0's layout: $prefsFile" }
    if ($prefsText -notmatch '"shape": "rounded"') { $failures += "Preferences did not save the last shape" }
    if ($prefsText -match '"position": \{') { $failures += "Preferences saved a place although --position pinned it" }

    # Stop Rust process
    if (-not $rustProc.HasExited) {
        Stop-Process -Id $rustProc.Id -Force -ErrorAction SilentlyContinue
    }

    # Optional apples-to-apples benchmark of CamFrame 0.9.0 Portable on the same Windows runner
    $cf090 = [ordered]@{
        exeBytes = 101385890
        exeMb = [math]::Round(101385890 / 1MB, 2)
        setupBytes = 111805357
        setupMb = [math]::Round(111805357 / 1MB, 2)
        measured = $false
        windowVisibleMs = $null
        workingSetMb = $null
        privateMb = $null
        processCount = $null
    }

    if ($CamFrame090Exe -and (Test-Path $CamFrame090Exe)) {
        $cf090.exeBytes = (Get-Item $CamFrame090Exe).Length
        $cf090.exeMb = [math]::Round($cf090.exeBytes / 1MB, 2)
        $beforePids = @(Get-Process -Name "CamFrame*" -ErrorAction SilentlyContinue | Select-Object -ExpandProperty Id)
        $sw090 = [System.Diagnostics.Stopwatch]::StartNew()
        $p090 = Start-Process -FilePath $CamFrame090Exe -PassThru
        $cfHwnd = [IntPtr]::Zero
        for ($i = 0; $i -lt 300; $i++) {
            $procs = Get-Process -Name "CamFrame*" -ErrorAction SilentlyContinue | Where-Object { $beforePids -notcontains $_.Id }
            foreach ($p in $procs) {
                $h = [Win32Verify]::FindVisibleWindowByPid($p.Id)
                if ($h -ne [IntPtr]::Zero) {
                    $cfHwnd = $h
                    $cf090.windowVisibleMs = [math]::Round($sw090.Elapsed.TotalMilliseconds, 1)
                    break
                }
            }
            if ($cfHwnd -ne [IntPtr]::Zero) { break }
            Start-Sleep -Milliseconds 100
        }
        Start-Sleep -Milliseconds 3000
        $liveProcs = @(Get-Process -Name "CamFrame*" -ErrorAction SilentlyContinue | Where-Object { $beforePids -notcontains $_.Id })
        if ($liveProcs.Count -gt 0) {
            $cf090.measured = $true
            $cf090.processCount = $liveProcs.Count
            $cf090.workingSetMb = [math]::Round(($liveProcs | Measure-Object -Property WorkingSet64 -Sum).Sum / 1MB, 2)
            $cf090.privateMb = [math]::Round(($liveProcs | Measure-Object -Property PrivateMemorySize64 -Sum).Sum / 1MB, 2)
            foreach ($p in $liveProcs) {
                Stop-Process -Id $p.Id -Force -ErrorAction SilentlyContinue
            }
        }
        if ($p090 -and -not $p090.HasExited) {
            Stop-Process -Id $p090.Id -Force -ErrorAction SilentlyContinue
        }
    }

    $report = [ordered]@{
        transparencyVerified = ($failures.Count -eq 0)
        failures = $failures
        rust = [ordered]@{
            exeBytes = $rustExeSize
            exeMb = [math]::Round($rustExeSize / 1MB, 2)
            windowVisibleMs = $windowVisibleMs
            firstFrameMs = $firstFrameMs
            workingSetMb = $rustWorkingSetMb
            privateMb = $rustPrivateMb
            dpi = $dpi
            gwlStyleHex = ("0x{0:X}" -f $gwlStyle)
            gwlExStyleHex = ("0x{0:X}" -f $gwlExStyle)
        }
        camframe090 = $cf090
    }

    $reportJson = $report | ConvertTo-Json -Depth 5
    Set-Content -Path (Join-Path $OutDir "benchmark.json") -Value $reportJson -Encoding UTF8
    Write-Host "=== BENCHMARK ==="
    Write-Host $reportJson

    # Capture the real GPUI settings panels, each with its own disposable Preferences folder.
    foreach ($panel in @('camera', 'style', 'scenes')) {
        if ($rustProc -and -not $rustProc.HasExited) { Stop-Process -Id $rustProc.Id -Force }
        $panelSettings = Join-Path $OutDir "panel-settings-$panel"
        $rustProc = Start-Process -FilePath $ExePath -ArgumentList @('--demo-pattern', '--position', "$winX,$winY", '--settings-panel', $panel, '--settings-dir', $panelSettings) -PassThru
        $panelWindow = [IntPtr]::Zero
        for ($attempt = 0; $attempt -lt 100; $attempt++) {
            $panelWindow = [Win32Verify]::FindVisibleWindowByPid($rustProc.Id)
            if ($panelWindow -ne [IntPtr]::Zero) { break }
            Start-Sleep -Milliseconds 50
        }
        if ($panelWindow -eq [IntPtr]::Zero) { throw "Rust $panel panel did not open" }
        Start-Sleep -Milliseconds 800
        $panelBounds = New-Object Win32Verify+RECT
        [void][Win32Verify]::GetWindowRect($panelWindow, [ref]$panelBounds)
        $panelShot = Capture-ScreenRegion -X ($panelBounds.Left - 40) -Y ($panelBounds.Top - 40) -W ($panelBounds.Right - $panelBounds.Left + 80) -H ($panelBounds.Bottom - $panelBounds.Top + 80) -Path (Join-Path $OutDir "$panel-panel.png")
        $panelShot.Dispose()
    }

    if ($failures.Count -gt 0) {
        Write-Error ("Transparency / shape verification FAILED:`n" + ($failures -join "`n"))
        exit 1
    }
    Write-Host "ALL WINDOWS TRANSPARENCY AND SHAPE-SWITCH CHECKS PASSED!"
}
finally {
    if ($rustProc -and -not $rustProc.HasExited) {
        Stop-Process -Id $rustProc.Id -Force -ErrorAction SilentlyContinue
    }
    if ($backdropProc -and -not $backdropProc.HasExited) {
        Stop-Process -Id $backdropProc.Id -Force -ErrorAction SilentlyContinue
    }
}
