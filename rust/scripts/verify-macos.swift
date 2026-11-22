// macOS counterpart of verify-windows.ps1.
//
// Puts a full-screen magenta window behind the bubble, starts camframe-rust with the demo pattern
// and its own settings folder, and checks real screen pixels and real mouse input:
// - everything around the camera shape shows the magenta behind it (no title bar, no background,
//   no shadow), and the window floats above normal windows;
// - hovering shows the toolbar and the corner handles;
// - a click in the empty corner around the circle reaches the window behind (allowed
//   improvement 1), while a click on the camera does not;
// - real clicks on the toolbar's Shape button step through the four shapes, keeping the window
//   centre, and the last shape is saved in the app's own preferences file;
// - the bubble stays visible when another app is active, and dragging the bubble moves it.
// Also measures size, start time and memory.
//
// Build and run:
//   swiftc -O scripts/verify-macos.swift -o verify-macos
//   ./verify-macos --exe target/release/camframe-rust --out verification-macos

import AppKit
import CoreGraphics
import Foundation

func argument(_ name: String) -> String? {
    let args = CommandLine.arguments
    guard let i = args.firstIndex(of: name), i + 1 < args.count else { return nil }
    return args[i + 1]
}

guard let exePath = argument("--exe"), let outDir = argument("--out") else {
    FileHandle.standardError.write("usage: verify-macos --exe <path> --out <dir>\n".data(using: .utf8)!)
    exit(2)
}
try? FileManager.default.createDirectory(atPath: outDir, withIntermediateDirectories: true)

// Window layout at the default size 288, as in 0.9.0 (logical points): 84 pt of room above the
// camera for the toolbar and 18 pt on the other sides. A circle window is 324 x 390.
let chromeTop = 84.0
let chromeSide = 18.0
let circleWidth = 324.0
let circleHeight = 390.0
let windowX = 200.0
let windowY = 150.0
// Extra screen area captured around the window, so the shot also holds plain backdrop pixels.
let pad = 40.0

struct RGB: CustomStringConvertible {
    let r: Int, g: Int, b: Int
    var description: String { "rgb(\(r),\(g),\(b))" }
    func near(_ o: RGB, tolerance: Int = 14) -> Bool {
        abs(r - o.r) <= tolerance && abs(g - o.g) <= tolerance && abs(b - o.b) <= tolerance
    }
}

func log(_ s: String) {
    print(s)
    fflush(stdout)
}

func sleepMs(_ ms: Int) { usleep(useconds_t(ms * 1000)) }

func run(_ path: String, _ args: [String]) -> String {
    let p = Process()
    p.executableURL = URL(fileURLWithPath: path)
    p.arguments = args
    let pipe = Pipe()
    p.standardOutput = pipe
    p.standardError = pipe
    do { try p.run() } catch { return "" }
    let data = pipe.fileHandleForReading.readDataToEndOfFile()
    p.waitUntilExit()
    return String(data: data, encoding: .utf8) ?? ""
}

struct WindowInfo {
    let bounds: CGRect
    let layer: Int
    let alpha: Double
}

func windows(of pid: pid_t) -> [WindowInfo] {
    guard let list = CGWindowListCopyWindowInfo([.optionOnScreenOnly, .excludeDesktopElements], kCGNullWindowID)
        as? [[String: Any]] else { return [] }
    return list.compactMap { info in
        guard let owner = info[kCGWindowOwnerPID as String] as? Int, owner == Int(pid),
              let boundsDict = info[kCGWindowBounds as String] as? NSDictionary,
              let bounds = CGRect(dictionaryRepresentation: boundsDict as CFDictionary) else { return nil }
        let layer = info[kCGWindowLayer as String] as? Int ?? 0
        let alpha = info[kCGWindowAlpha as String] as? Double ?? 1
        return WindowInfo(bounds: bounds, layer: layer, alpha: alpha)
    }
}

func bubbleWindow(of pid: pid_t) -> WindowInfo? {
    windows(of: pid).first { $0.bounds.width > 50 && $0.bounds.height > 50 }
}

/// The middle of the camera, relative to the window's top-left corner.
func cameraCenter(_ window: CGRect) -> (Double, Double) {
    (window.width / 2, chromeTop + (window.height - chromeTop - chromeSide) / 2)
}

struct Shot {
    let rep: NSBitmapImageRep
    let origin: CGPoint  // top-left of the capture, global points
    let scale: Double

    // Colour at a point given relative to the window's top-left corner (points).
    func at(_ window: CGRect, _ x: Double, _ y: Double) -> RGB {
        pixel(window.minX - origin.x + x, window.minY - origin.y + y)
    }

    // Colour at a point given relative to the capture's top-left corner (points).
    func pixel(_ x: Double, _ y: Double) -> RGB {
        let px = Int((x * scale).rounded())
        let py = Int((y * scale).rounded())
        guard let c = rep.colorAt(x: px, y: py)?.usingColorSpace(.sRGB) else { return RGB(r: -1, g: -1, b: -1) }
        return RGB(r: Int((c.redComponent * 255).rounded()),
                   g: Int((c.greenComponent * 255).rounded()),
                   b: Int((c.blueComponent * 255).rounded()))
    }
}

func capture(around window: CGRect, name: String, padding: Double = pad) -> Shot? {
    let origin = CGPoint(x: window.minX - padding, y: window.minY - padding)
    let w = window.width + padding * 2
    let h = window.height + padding * 2
    let path = (outDir as NSString).appendingPathComponent("\(name).png")
    _ = run("/usr/sbin/screencapture", ["-x", "-R", "\(Int(origin.x)),\(Int(origin.y)),\(Int(w)),\(Int(h))", path])
    guard let data = FileManager.default.contents(atPath: path), let rep = NSBitmapImageRep(data: data) else {
        return nil
    }
    return Shot(rep: rep, origin: origin, scale: Double(rep.pixelsWide) / w)
}

func postMouse(_ type: CGEventType, _ p: CGPoint, _ button: CGMouseButton = .left) {
    CGEvent(mouseEventSource: nil, mouseType: type, mouseCursorPosition: p, mouseButton: button)?
        .post(tap: .cghidEventTap)
}

func moveMouse(_ p: CGPoint, settleMs: Int = 400) {
    postMouse(.mouseMoved, p)
    sleepMs(settleMs)
}

func moveMouseAway(from window: CGRect) {
    moveMouse(CGPoint(x: window.maxX + 200, y: window.maxY + 80), settleMs: 700)
}

func leftClick(_ p: CGPoint) {
    postMouse(.leftMouseDown, p)
    sleepMs(60)
    postMouse(.leftMouseUp, p)
    sleepMs(500)
}

func pressKey(_ keyCode: CGKeyCode, pid: pid_t) {
    CGEvent(keyboardEventSource: nil, virtualKey: keyCode, keyDown: true)?.postToPid(pid)
    sleepMs(40)
    CGEvent(keyboardEventSource: nil, virtualKey: keyCode, keyDown: false)?.postToPid(pid)
    sleepMs(500)
}

// kVK_ANSI_1 ... kVK_ANSI_4
let keyForShape: [String: CGKeyCode] = ["circle": 0x12, "rounded": 0x13, "portrait": 0x14, "landscape": 0x15]

/// The magenta backdrop counts the clicks that reach it, to prove clicks pass through the bubble.
final class ClickCounter: NSView {
    static var clicks = 0
    override func acceptsFirstMouse(for event: NSEvent?) -> Bool { true }
    override func mouseDown(with event: NSEvent) { ClickCounter.clicks += 1 }
}

func backdropClicks() -> Int { DispatchQueue.main.sync { ClickCounter.clicks } }

func checks() -> Int32 {
    var failures: [String] = []
    var report: [String: Any] = [:]
    let exeBytes = (try? FileManager.default.attributesOfItem(atPath: exePath)[.size] as? Int) ?? -1
    let metricsFile = (outDir as NSString).appendingPathComponent("rust-startup.txt")
    let appLog = (outDir as NSString).appendingPathComponent("camframe-rust-output.txt")
    // Preferences go to a fresh folder so the check never touches a real CamFrame setup.
    let settingsDir = (outDir as NSString).appendingPathComponent("settings")
    try? FileManager.default.removeItem(atPath: settingsDir)
    try? FileManager.default.createDirectory(atPath: settingsDir, withIntermediateDirectories: true)
    let prefsFile = (settingsDir as NSString).appendingPathComponent("CamFrame Rust/preferences.json")
    FileManager.default.createFile(atPath: appLog, contents: nil)

    // Keep the pointer away from the bubble so the toolbar stays hidden for the first pictures.
    moveMouse(CGPoint(x: windowX + circleWidth + 240, y: windowY + circleHeight + 80), settleMs: 100)

    let started = Date()
    let app = Process()
    app.executableURL = URL(fileURLWithPath: exePath)
    app.arguments = [
        "--demo-pattern",
        "--position", "\(Int(windowX)),\(Int(windowY))",
        "--metrics-file", metricsFile,
        "--settings-dir", settingsDir,
    ]
    if let handle = FileHandle(forWritingAtPath: appLog) {
        app.standardOutput = handle
        app.standardError = handle
    }
    do { try app.run() } catch {
        log("could not start \(exePath): \(error)")
        return 1
    }
    let pid = app.processIdentifier
    defer { if app.isRunning { app.terminate() } }

    var windowVisibleMs = -1.0
    var info: WindowInfo?
    for _ in 0..<200 {
        if let found = bubbleWindow(of: pid) {
            info = found
            windowVisibleMs = (Date().timeIntervalSince(started) * 1000).rounded()
            break
        }
        sleepMs(50)
    }
    guard var bubble = info else {
        log("camframe-rust window did not appear within 10 seconds")
        log((try? String(contentsOfFile: appLog, encoding: .utf8)) ?? "")
        return 1
    }
    sleepMs(2000)
    func refresh() { bubble = bubbleWindow(of: pid) ?? bubble }
    refresh()
    let allWindows = windows(of: pid)
    log("bubble window bounds=\(bubble.bounds) layer=\(bubble.layer) alpha=\(bubble.alpha) windows=\(allWindows.count)")

    let rssKb = Int(run("/bin/ps", ["-o", "rss=", "-p", "\(pid)"]).trimmingCharacters(in: .whitespacesAndNewlines)) ?? -1
    let footprint = run("/usr/bin/footprint", ["-p", "\(pid)"])
        .split(separator: "\n").first { $0.contains("Footprint:") }.map(String.init) ?? ""
    let firstFrameMs: Double = {
        guard let raw = try? String(contentsOfFile: metricsFile, encoding: .utf8),
              let value = raw.split(separator: "=").last else { return -1 }
        return Double(value.trimmingCharacters(in: .whitespacesAndNewlines)) ?? -1
    }()

    if abs(bubble.bounds.width - circleWidth) > 1 || abs(bubble.bounds.height - circleHeight) > 1 {
        failures.append("window is \(bubble.bounds.width)x\(bubble.bounds.height), expected \(circleWidth)x\(circleHeight) (title bar left over?)")
    }
    if bubble.layer < 3 {
        failures.append("window layer \(bubble.layer) is not above normal windows (always on top)")
    }

    moveMouseAway(from: bubble.bounds)

    // A see-through point must show the backdrop colour; a drawn point must not.
    func expectClear(_ shot: Shot, _ label: String, _ x: Double, _ y: Double, _ backdrop: RGB) -> RGB {
        let c = shot.at(bubble.bounds, x, y)
        if !c.near(backdrop) { failures.append("\(label) (\(Int(x)),\(Int(y))) not see-through: \(c), backdrop \(backdrop)") }
        return c
    }
    func expectDrawn(_ shot: Shot, _ label: String, _ x: Double, _ y: Double, _ backdrop: RGB) -> RGB {
        let c = shot.at(bubble.bounds, x, y)
        if c.near(backdrop) { failures.append("\(label) (\(Int(x)),\(Int(y))) shows the backdrop: nothing drawn") }
        return c
    }
    func global(_ x: Double, _ y: Double) -> CGPoint {
        CGPoint(x: bubble.bounds.minX + x, y: bubble.bounds.minY + y)
    }

    var pixels: [String: String] = [:]

    // 1. Circle at rest. (58, 94) is inside the camera's bounding box but outside the circle.
    guard let circle = capture(around: bubble.bounds, name: "circle") else {
        log("screencapture failed (screen recording permission?)")
        return 1
    }
    let backdrop = circle.pixel(6, 6)
    log("backdrop sample \(backdrop) scale=\(circle.scale)")
    // The runner's display colour profile turns pure magenta into about rgb(255,64,255).
    if !(backdrop.r >= 200 && backdrop.g <= 110 && backdrop.b >= 200) {
        failures.append("backdrop sample \(backdrop) is not magenta: the capture does not show the screen")
    }
    pixels["circle.TL"] = "\(expectClear(circle, "circle TL", 8, 8, backdrop))"
    pixels["circle.TR"] = "\(expectClear(circle, "circle TR", 316, 8, backdrop))"
    pixels["circle.BL"] = "\(expectClear(circle, "circle BL", 8, 380, backdrop))"
    pixels["circle.BR"] = "\(expectClear(circle, "circle BR", 316, 380, backdrop))"
    pixels["circle.toolbarRoom"] = "\(expectClear(circle, "circle toolbar room (no toolbar at rest)", 162, 44, backdrop))"
    pixels["circle.probe"] = "\(expectClear(circle, "circle corner probe", 58, 94, backdrop))"
    pixels["circle.shadowProbe"] = "\(expectClear(circle, "circle shadow probe below bubble", 162, 381, backdrop))"
    let belowWindow = circle.pixel(pad + 162, pad + circleHeight + 6)
    pixels["circle.belowWindow"] = "\(belowWindow)"
    if !belowWindow.near(backdrop) {
        failures.append("pixel 6pt below the window is not the backdrop (window shadow?)")
    }
    pixels["circle.center"] = "\(expectDrawn(circle, "circle center", 162, 228, backdrop))"

    // 2. Clicks: one in the empty corner around the circle must reach the backdrop behind it,
    // one on the camera must not.
    let clicksBefore = backdropClicks()
    moveMouse(global(43, 109))
    leftClick(global(43, 109))
    let clicksAfterCorner = backdropClicks()
    let emptyCornerPassesClicks = clicksAfterCorner == clicksBefore + 1
    if !emptyCornerPassesClicks {
        failures.append("a click in the empty corner around the circle did not reach the window behind (\(clicksAfterCorner - clicksBefore) clicks arrived)")
    }

    // 3. Hover: the toolbar and the corner handles show; the empty corner stays see-through.
    moveMouse(global(162, 228))
    if let shot = capture(around: bubble.bounds, name: "hover") {
        pixels["hover.toolbar"] = "\(expectDrawn(shot, "hover toolbar", 162, 44, backdrop))"
        pixels["hover.handle"] = "\(expectDrawn(shot, "hover corner handle", 18, 84, backdrop))"
        pixels["hover.emptyCorner"] = "\(expectClear(shot, "hover empty corner", 43, 109, backdrop))"
    } else {
        failures.append("hover capture failed")
    }
    leftClick(global(162, 228))
    let cameraTakesClicks = backdropClicks() == clicksAfterCorner
    if !cameraTakesClicks {
        failures.append("a click on the camera went through to the window behind")
    }
    // Beside the toolbar (which spans x 45 to 279) the toolbar stays shown, but clicks go through.
    moveMouse(global(30, 44))
    leftClick(global(30, 44))
    let clicksAfterBesideToolbar = backdropClicks()
    let besideToolbarPassesClicks = clicksAfterBesideToolbar == clicksAfterCorner + 1
    if !besideToolbarPassesClicks {
        failures.append("a click beside the toolbar did not reach the window behind (\(clicksAfterBesideToolbar - clicksAfterCorner) clicks arrived)")
    }

    // 4. Shape is third of six buttons, 19 points left of the toolbar centre.
    func clickShapeButton() {
        let (cx, cy) = cameraCenter(bubble.bounds)
        moveMouse(global(cx, cy))
        moveMouse(global(bubble.bounds.width / 2 - 19, 44), settleMs: 300)
        leftClick(global(bubble.bounds.width / 2 - 19, 44))
        let before = bubble.bounds
        moveMouseAway(from: before)
        refresh()
    }
    func keptCentre(_ before: CGRect, _ label: String) {
        if abs(before.midX - bubble.bounds.midX) > 1.5 || abs(before.midY - bubble.bounds.midY) > 1.5 {
            failures.append("\(label): the window centre moved from (\(before.midX),\(before.midY)) to (\(bubble.bounds.midX),\(bubble.bounds.midY))")
        }
    }

    var previous = bubble.bounds
    clickShapeButton()
    keptCentre(previous, "rounded")
    if let shot = capture(around: bubble.bounds, name: "rounded") {
        pixels["rounded.TL"] = "\(expectClear(shot, "rounded TL", 8, 8, backdrop))"
        pixels["rounded.BR"] = "\(expectClear(shot, "rounded BR", 316, 380, backdrop))"
        let probe = shot.at(bubble.bounds, 58, 94)
        pixels["rounded.probe"] = "\(probe)"
        if probe.near(backdrop) { failures.append("rounded corner probe (58,94) stayed see-through: the Shape button did not switch") }
        pixels["rounded.center"] = "\(expectDrawn(shot, "rounded center", 162, 228, backdrop))"
    } else {
        failures.append("rounded capture failed")
    }

    // Portrait: a 216 x 288 camera in a 252 x 390 window.
    previous = bubble.bounds
    clickShapeButton()
    keptCentre(previous, "portrait")
    if abs(bubble.bounds.width - 252) > 1 { failures.append("portrait window is \(bubble.bounds.width) wide, expected 252") }
    if let shot = capture(around: bubble.bounds, name: "portrait") {
        pixels["portrait.side"] = "\(expectClear(shot, "portrait side strip", 8, 228, backdrop))"
        pixels["portrait.center"] = "\(expectDrawn(shot, "portrait center", 126, 228, backdrop))"
    } else {
        failures.append("portrait capture failed")
    }

    // Landscape: a 288 x 162 camera in a 324 x 264 window.
    previous = bubble.bounds
    clickShapeButton()
    keptCentre(previous, "landscape")
    if abs(bubble.bounds.height - 264) > 1 { failures.append("landscape window is \(bubble.bounds.height) high, expected 264") }
    if let shot = capture(around: bubble.bounds, name: "landscape") {
        pixels["landscape.top"] = "\(expectClear(shot, "landscape top strip", 162, 60, backdrop))"
        pixels["landscape.bottom"] = "\(expectClear(shot, "landscape bottom strip", 162, 255, backdrop))"
        pixels["landscape.center"] = "\(expectDrawn(shot, "landscape center", 162, 165, backdrop))"
    } else {
        failures.append("landscape capture failed")
    }

    // The last shape is saved in the app's own folder, in 0.9.0's file layout.
    let prefsText = (try? String(contentsOfFile: prefsFile, encoding: .utf8)) ?? ""
    if !prefsText.hasPrefix("{\n  \"schemaVersion\": 15,") {
        failures.append("preferences missing or not in 0.9.0's layout: \(prefsFile)")
    }
    if !prefsText.contains("\"shape\": \"landscape\"") {
        failures.append("preferences did not save the last shape")
    }

    // 4b. Keyboard "1" back to the circle, checked on its own (reported, not required: keys sent
    // to another app's process can be filtered by macOS on CI runners). The 1 to 4 keys exist only
    // with --demo-pattern.
    pressKey(keyForShape["circle"]!, pid: pid)
    moveMouseAway(from: bubble.bounds)
    refresh()
    var keyboardShapeSwitch = false
    if let shot = capture(around: bubble.bounds, name: "key-circle") {
        keyboardShapeSwitch = abs(bubble.bounds.height - circleHeight) <= 1
            && shot.at(bubble.bounds, 58, 94).near(backdrop)
            && !shot.at(bubble.bounds, 162, 228).near(backdrop)
    }
    log("keyboard shape switch (1 key): \(keyboardShapeSwitch ? "worked" : "did not work")")

    // 5. Another app in front: the bubble must stay visible and see-through.
    _ = run("/usr/bin/open", ["-a", "Finder"])
    sleepMs(1200)
    let frontApp = NSWorkspace.shared.frontmostApplication?.localizedName ?? "unknown"
    moveMouseAway(from: bubble.bounds)
    refresh()
    if bubbleWindow(of: pid) == nil {
        failures.append("bubble disappeared when \(frontApp) became the active app")
    } else if let shot = capture(around: bubble.bounds, name: "other-app-active") {
        // The other app's window may now sit behind the bubble, so compare each corner with the
        // screen just outside the bubble window instead of with the magenta backdrop.
        let bottom = bubble.bounds.height - 10
        let outsideTL = shot.at(bubble.bounds, -6, 8)
        let outsideBL = shot.at(bubble.bounds, -6, bottom)
        pixels["otherApp.TL"] = "\(expectClear(shot, "other app active TL", 8, 8, outsideTL))"
        pixels["otherApp.BL"] = "\(expectClear(shot, "other app active BL", 8, bottom, outsideBL))"
        let (cx, cy) = cameraCenter(bubble.bounds)
        let drawnCenter = expectDrawn(shot, "other app active center", cx, cy, backdrop)
        pixels["otherApp.center"] = "\(drawnCenter)"
        if drawnCenter.near(outsideTL) {
            failures.append("other app active center shows the screen behind the bubble: nothing drawn")
        }
    } else {
        failures.append("capture with another app active failed")
    }
    log("active app during the check: \(frontApp)")

    // 6. Dragging the bubble moves the window.
    let before = bubble.bounds
    let (gx, gy) = cameraCenter(before)
    let grab = CGPoint(x: before.minX + gx, y: before.minY + gy)
    moveMouse(grab, settleMs: 400)
    postMouse(.leftMouseDown, grab)
    sleepMs(80)
    for step in 1...12 {
        postMouse(.leftMouseDragged, CGPoint(x: grab.x + Double(step) * 10, y: grab.y + Double(step) * 5))
        sleepMs(30)
    }
    postMouse(.leftMouseUp, CGPoint(x: grab.x + 120, y: grab.y + 60))
    sleepMs(600)
    let after = bubbleWindow(of: pid)?.bounds ?? before
    let moved = CGPoint(x: after.minX - before.minX, y: after.minY - before.minY)
    log("drag moved the window by \(moved)")
    if abs(moved.x - 120) > 12 || abs(moved.y - 60) > 12 {
        failures.append("dragging the bubble moved the window by \(moved), expected about (120, 60)")
    }
    moveMouseAway(from: after)
    _ = capture(around: after, name: "after-drag")

    // Full screen through the real toolbar, including all four drawable corners. Then Escape
    // must restore the same compact bounds without opening a second camera/window.
    refresh()
    let compact = bubble.bounds
    let centre = cameraCenter(compact)
    moveMouse(global(centre.0, centre.1))
    moveMouse(global(compact.width / 2 - 57, 44), settleMs: 300)
    leftClick(global(compact.width / 2 - 57, 44))
    sleepMs(700)
    refresh()
    let display = CGDisplayBounds(CGMainDisplayID())
    if abs(bubble.bounds.width - display.width) > 2 || abs(bubble.bounds.height - display.height) > 2 {
        failures.append("Full screen toolbar did not fill the display: \(bubble.bounds)")
    }
    if let shot = capture(around: bubble.bounds, name: "fullscreen", padding: 0) {
        for (name,x,y) in [("TL",4.0,4.0),("TR",bubble.bounds.width-5,4.0),("BL",4.0,bubble.bounds.height-5),("BR",bubble.bounds.width-5,bubble.bounds.height-5)] {
            let pixel = shot.at(bubble.bounds,x,y)
            pixels["fullscreen.\(name)"] = "\(pixel)"
            log("Full screen \(name) at (\(x),\(y)): \(pixel), window \(bubble.bounds), display \(display)")
            if pixel.near(backdrop) { failures.append("Full screen camera leaves a transparent corner") }
            // The demo gradient is blue/teal at every corner. A stale Compact scene can also
            // expose Finder or the menu bar, which is not the magenta backdrop.
            else if pixel.r >= 150 || pixel.b < 80 { failures.append("Full screen \(name) does not show the camera") }
        }
    }
    moveMouse(CGPoint(x: display.midX, y: display.minY + 44), settleMs: 400)
    if let toolbarShot = capture(around: bubble.bounds, name: "fullscreen-toolbar", padding: 0) {
        let toolbarPixel = toolbarShot.at(bubble.bounds, bubble.bounds.width / 2, 44)
        let cameraPixel = toolbarShot.at(bubble.bounds, bubble.bounds.width / 2, 120)
        if toolbarPixel.b > 80 || cameraPixel.b < 80 {
            failures.append("Full screen reuses a scaled Compact scene instead of repainting the toolbar and camera")
        }
    } else { failures.append("could not capture Full screen toolbar") }
    pressKey(0x35, pid: pid)
    sleepMs(400)
    refresh()
    if abs(bubble.bounds.width - compact.width) > 2 || abs(bubble.bounds.height - compact.height) > 2 ||
       abs(bubble.bounds.minX - compact.minX) > 2 || abs(bubble.bounds.minY - compact.minY) > 2 {
        failures.append("Escape did not restore compact bounds")
    }

    // Whole screen for the record.
    _ = run("/usr/sbin/screencapture", ["-x", (outDir as NSString).appendingPathComponent("desktop.png")])

    report["seeThroughAndShapeSwitchVerified"] = failures.isEmpty
    report["failures"] = failures
    report["shapeSwitchInput"] = "toolbar Shape button"
    report["emptyCornerPassesClicks"] = emptyCornerPassesClicks
    report["cameraTakesClicks"] = cameraTakesClicks
    report["besideToolbarPassesClicks"] = besideToolbarPassesClicks
    report["keyboardShapeSwitch"] = keyboardShapeSwitch
    report["activeAppDuringOtherAppCheck"] = frontApp
    report["pixels"] = pixels
    report["backdrop"] = "\(backdrop)"
    report["captureScale"] = circle.scale
    report["rust"] = [
        "exeBytes": exeBytes,
        "exeMb": (Double(exeBytes) / 1_048_576 * 100).rounded() / 100,
        "windowVisibleMs": windowVisibleMs,
        "firstFrameMs": firstFrameMs,
        "rssMb": (Double(rssKb) / 1024 * 100).rounded() / 100,
        "footprint": footprint.trimmingCharacters(in: .whitespaces),
        "windowLayer": bubble.layer,
        "windowCount": allWindows.count,
        "windowBounds": "\(bubble.bounds)",
        "dragMoved": "\(moved)",
    ] as [String: Any]
    report["macOS"] = ProcessInfo.processInfo.operatingSystemVersionString

    if let json = try? JSONSerialization.data(withJSONObject: report, options: [.prettyPrinted, .sortedKeys]) {
        FileManager.default.createFile(atPath: (outDir as NSString).appendingPathComponent("benchmark.json"), contents: json)
        log("=== BENCHMARK ===")
        log(String(data: json, encoding: .utf8) ?? "")
    }

    // Capture native GPUI controls, rather than the old Electron browser preview.
    if app.isRunning { app.terminate(); app.waitUntilExit() }
    for panel in ["camera", "style", "style-glow", "style-blur", "scenes", "scenes-list", "small-menu", "large-menu", "scenes-overlay", "scenes-legacy"] {
        let panelApp = Process()
        panelApp.executableURL = URL(fileURLWithPath: exePath)
        let scrollerCase = panel == "scenes-overlay" || panel == "scenes-legacy"
        panelApp.arguments = ["--demo-pattern", "--position", "\(Int(windowX)),\(Int(windowY))", "--settings-panel", scrollerCase ? "scenes" : panel,
                              "--settings-dir", (outDir as NSString).appendingPathComponent("panel-settings-\(panel)")]
        if scrollerCase {
            // AppKit's standard argument-domain override exercises the real NSScroller preference.
            panelApp.arguments! += ["-AppleShowScrollBars", panel == "scenes-overlay" ? "WhenScrolling" : "Always"]
        }
        do { try panelApp.run() } catch { failures.append("could not launch \(panel) panel: \(error)"); continue }
        var panelWindow: WindowInfo?
        for _ in 0..<100 {
            panelWindow = bubbleWindow(of: panelApp.processIdentifier)
            if panelWindow != nil { break }
            sleepMs(50)
        }
        sleepMs(800)
        if let panelWindow {
            if panel.hasSuffix("menu") {
                moveMouse(CGPoint(x: panelWindow.bounds.midX, y: panelWindow.bounds.minY + 100), settleMs: 350)
            }
            if let shot = capture(around: panelWindow.bounds, name: "\(panel)-panel") {
                if scrollerCase {
                    let rail = shot.at(panelWindow.bounds, 280, 120)
                    let bright = rail.r > 220 && rail.g > 220 && rail.b > 220
                    log("\(panel): native scroll rail pixel = \(rail)")
                    if bright != (panel == "scenes-legacy") { failures.append("\(panel) does not follow Show scroll bars") }
                }
            } else { failures.append("could not capture \(panel) panel") }
        } else { failures.append("\(panel) panel did not open") }
        if panelApp.isRunning { panelApp.terminate(); panelApp.waitUntilExit() }
    }

    if !failures.isEmpty {
        log("macOS see-through / shape-switch verification FAILED:")
        failures.forEach { log("  - \($0)") }
        log("--- app output ---")
        log((try? String(contentsOfFile: appLog, encoding: .utf8)) ?? "")
        return 1
    }
    log("ALL MACOS SEE-THROUGH AND SHAPE-SWITCH CHECKS PASSED!")
    return 0
}

// A full-screen magenta window at the normal level is the known colour behind the bubble. It
// counts the clicks that reach it.
let application = NSApplication.shared
application.setActivationPolicy(.accessory)
let screenFrame = NSScreen.main?.frame ?? NSRect(x: 0, y: 0, width: 1920, height: 1080)
let backdropWindow = NSWindow(contentRect: screenFrame, styleMask: .borderless, backing: .buffered, defer: false)
backdropWindow.backgroundColor = NSColor(srgbRed: 1, green: 0, blue: 1, alpha: 1)
backdropWindow.isOpaque = true
backdropWindow.hasShadow = false
backdropWindow.level = .normal
backdropWindow.contentView = ClickCounter(frame: NSRect(origin: .zero, size: screenFrame.size))
backdropWindow.ignoresMouseEvents = false
backdropWindow.orderFrontRegardless()

DispatchQueue.global().async {
    sleepMs(1200)
    let code = checks()
    DispatchQueue.main.async { exit(code) }
}
application.run()
