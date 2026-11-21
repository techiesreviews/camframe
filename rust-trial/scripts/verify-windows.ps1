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
$winX = 200
$winY = 150
$cropX = 150
$cropY = 100
$cropW = 424
$cropH = 462

$rustExeSize = (Get-Item $ExePath).Length
$rustProc = $null

try {
    $sw = [System.Diagnostics.Stopwatch]::StartNew()
    $rustProc = Start-Process -FilePath $ExePath -ArgumentList @(
        "--demo-pattern",
        "--position", "$winX,$winY",
        "--metrics-file", $metricsFile
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
        throw "camframe-trial.exe window did not become visible within 5 seconds"
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

    # 1. Verify CIRCLE shape
    $circlePath = Join-Path $OutDir "circle.png"
    $circleBmp = Capture-ScreenRegion -X $cropX -Y $cropY -W $cropW -H $cropH -Path $circlePath
    $cTopLeft = Sample-Rel $circleBmp 8 8
    $cTopRight = Sample-Rel $circleBmp 316 8
    $cBottomLeft = Sample-Rel $circleBmp 8 354
    $cBottomRight = Sample-Rel $circleBmp 316 354
    $cCornerProbe = Sample-Rel $circleBmp 48 86
    $cCenter = Sample-Rel $circleBmp 162 200
    $circleBmp.Dispose()

    Write-Host ("CIRCLE pixels: TL={0} TR={1} BL={2} BR={3} Probe(48,86)={4} Center={5}" -f `
        (Format-Color $cTopLeft), (Format-Color $cTopRight), (Format-Color $cBottomLeft), `
        (Format-Color $cBottomRight), (Format-Color $cCornerProbe), (Format-Color $cCenter))

    # 2. Switch LIVE to ROUNDED SQUARE by sending key '2'
    [void][Win32Verify]::SetForegroundWindow($hwnd)
    Start-Sleep -Milliseconds 200
    [System.Windows.Forms.SendKeys]::SendWait("2")
    Start-Sleep -Milliseconds 700

    $roundedPath = Join-Path $OutDir "rounded.png"
    $roundedBmp = Capture-ScreenRegion -X $cropX -Y $cropY -W $cropW -H $cropH -Path $roundedPath
    $rTopLeft = Sample-Rel $roundedBmp 8 8
    $rTopRight = Sample-Rel $roundedBmp 316 8
    $rBottomLeft = Sample-Rel $roundedBmp 8 354
    $rBottomRight = Sample-Rel $roundedBmp 316 354
    $rCornerProbe = Sample-Rel $roundedBmp 48 86
    $rCenter = Sample-Rel $roundedBmp 162 200
    $roundedBmp.Dispose()

    Write-Host ("ROUNDED pixels: TL={0} TR={1} BL={2} BR={3} Probe(48,86)={4} Center={5}" -f `
        (Format-Color $rTopLeft), (Format-Color $rTopRight), (Format-Color $rBottomLeft), `
        (Format-Color $rBottomRight), (Format-Color $rCornerProbe), (Format-Color $rCenter))

    # 3. Switch LIVE to LANDSCAPE (16:9) by sending key '4'
    [void][Win32Verify]::SetForegroundWindow($hwnd)
    Start-Sleep -Milliseconds 200
    [System.Windows.Forms.SendKeys]::SendWait("4")
    Start-Sleep -Milliseconds 700

    $landscapePath = Join-Path $OutDir "landscape.png"
    $landscapeBmp = Capture-ScreenRegion -X $cropX -Y $cropY -W $cropW -H $cropH -Path $landscapePath
    $lTopStrip = Sample-Rel $landscapeBmp 162 80
    $lBottomStrip = Sample-Rel $landscapeBmp 162 320
    $lCenter = Sample-Rel $landscapeBmp 162 200
    $landscapeBmp.Dispose()

    Write-Host ("LANDSCAPE pixels: TopStrip(162,80)={0} BottomStrip(162,320)={1} Center={2}" -f `
        (Format-Color $lTopStrip), (Format-Color $lBottomStrip), (Format-Color $lCenter))

    # Assert transparency & live shape switching
    $failures = @()
    if (-not (Is-Magenta $cTopLeft))     { $failures += "Circle outer TL not transparent: $(Format-Color $cTopLeft)" }
    if (-not (Is-Magenta $cTopRight))    { $failures += "Circle outer TR not transparent: $(Format-Color $cTopRight)" }
    if (-not (Is-Magenta $cBottomLeft))  { $failures += "Circle outer BL not transparent: $(Format-Color $cBottomLeft)" }
    if (-not (Is-Magenta $cBottomRight)) { $failures += "Circle outer BR not transparent: $(Format-Color $cBottomRight)" }
    if (-not (Is-Magenta $cCornerProbe)) { $failures += "Circle corner probe (48,86) not transparent: $(Format-Color $cCornerProbe)" }
    if (Is-Magenta $cCenter)             { $failures += "Circle center is transparent (nothing drawn)" }

    if (-not (Is-Magenta $rTopLeft))     { $failures += "Rounded outer TL not transparent: $(Format-Color $rTopLeft)" }
    if (-not (Is-Magenta $rTopRight))    { $failures += "Rounded outer TR not transparent: $(Format-Color $rTopRight)" }
    if (-not (Is-Magenta $rBottomLeft))  { $failures += "Rounded outer BL not transparent: $(Format-Color $rBottomLeft)" }
    if (-not (Is-Magenta $rBottomRight)) { $failures += "Rounded outer BR not transparent: $(Format-Color $rBottomRight)" }
    if (Is-Magenta $rCornerProbe)        { $failures += "Rounded corner probe (48,86) stayed transparent (shape did not change!)" }
    if (Is-Magenta $rCenter)             { $failures += "Rounded center is transparent" }

    if (-not (Is-Magenta $lTopStrip))    { $failures += "Landscape top strip (162,80) not transparent: $(Format-Color $lTopStrip)" }
    if (-not (Is-Magenta $lBottomStrip)) { $failures += "Landscape bottom strip (162,320) not transparent: $(Format-Color $lBottomStrip)" }
    if (Is-Magenta $lCenter)             { $failures += "Landscape center is transparent" }

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
        rustTrial = [ordered]@{
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
