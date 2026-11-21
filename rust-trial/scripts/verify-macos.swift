// macOS counterpart of verify-windows.ps1 (TRIAL ONLY).
//
// Puts a full-screen magenta window behind the bubble, starts camframe-trial with the demo
// pattern, and checks real screen pixels: everything around the circle shows the magenta behind
// it (no title bar, no background, no shadow), the window floats above normal windows, a real
// right-click on the bubble switches the shape while the outside stays see-through, and dragging
// the bubble moves the window. Also measures size, start time and memory.
//
// Build and run:
//   swiftc -O scripts/verify-macos.swift -o verify-macos
//   ./verify-macos --exe target/release/camframe-trial --out trial-verification-macos

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

// Window geometry from src/shape.rs (logical points).
let outerWidth = 324.0
let outerHeight = 362.0
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

func capture(around window: CGRect, name: String) -> Shot? {
    let origin = CGPoint(x: window.minX - pad, y: window.minY - pad)
    let w = window.width + pad * 2
    let h = window.height + pad * 2
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

func moveMouseAway(from window: CGRect) {
    postMouse(.mouseMoved, CGPoint(x: window.maxX + 200, y: window.maxY + 80))
    sleepMs(700)
}

func rightClick(_ p: CGPoint) {
    postMouse(.mouseMoved, p)
    sleepMs(300)
    postMouse(.rightMouseDown, p, .right)
    sleepMs(60)
    postMouse(.rightMouseUp, p, .right)
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

func checks() -> Int32 {
    var failures: [String] = []
    var report: [String: Any] = [:]
    let exeBytes = (try? FileManager.default.attributesOfItem(atPath: exePath)[.size] as? Int) ?? -1
    let metricsFile = (outDir as NSString).appendingPathComponent("rust-startup.txt")
    let appLog = (outDir as NSString).appendingPathComponent("camframe-trial-output.txt")
    FileManager.default.createFile(atPath: appLog, contents: nil)

    let started = Date()
    let app = Process()
    app.executableURL = URL(fileURLWithPath: exePath)
    app.arguments = ["--demo-pattern", "--position", "\(Int(windowX)),\(Int(windowY))", "--metrics-file", metricsFile]
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
        log("camframe-trial window did not appear within 10 seconds")
        log((try? String(contentsOfFile: appLog, encoding: .utf8)) ?? "")
        return 1
    }
    sleepMs(2000)
    bubble = bubbleWindow(of: pid) ?? bubble
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

    if abs(bubble.bounds.width - outerWidth) > 1 || abs(bubble.bounds.height - outerHeight) > 1 {
        failures.append("window is \(bubble.bounds.width)x\(bubble.bounds.height), expected \(outerWidth)x\(outerHeight) (title bar left over?)")
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

    var pixels: [String: String] = [:]

    // 1. Circle.
    guard let circle = capture(around: bubble.bounds, name: "circle") else {
        log("screencapture failed (screen recording permission?)")
        return 1
    }
    let backdrop = circle.pixel(6, 6)
    log("backdrop sample \(backdrop) scale=\(circle.scale)")
    if !(backdrop.r >= 200 && backdrop.g <= 60 && backdrop.b >= 200) {
        failures.append("backdrop sample \(backdrop) is not magenta: the capture does not show the screen")
    }
    pixels["circle.TL"] = "\(expectClear(circle, "circle TL", 8, 8, backdrop))"
    pixels["circle.TR"] = "\(expectClear(circle, "circle TR", 316, 8, backdrop))"
    pixels["circle.BL"] = "\(expectClear(circle, "circle BL", 8, 354, backdrop))"
    pixels["circle.BR"] = "\(expectClear(circle, "circle BR", 316, 354, backdrop))"
    pixels["circle.probe"] = "\(expectClear(circle, "circle corner probe", 48, 86, backdrop))"
    pixels["circle.shadowProbe"] = "\(expectClear(circle, "circle shadow probe below bubble", 162, 352, backdrop))"
    let belowWindow = circle.pixel(pad + 162, pad + outerHeight + 6)
    pixels["circle.belowWindow"] = "\(belowWindow)"
    if !belowWindow.near(backdrop) {
        failures.append("pixel 6pt below the window is not the backdrop (window shadow?)")
    }
    pixels["circle.center"] = "\(expectDrawn(circle, "circle center", 162, 200, backdrop))"

    // 2. Shape switch by a real right-click on the bubble (falls back to the "2" key sent to the app).
    let center = CGPoint(x: bubble.bounds.minX + 162, y: bubble.bounds.minY + 200)
    var switchMethod = "right-click"
    rightClick(center)
    moveMouseAway(from: bubble.bounds)
    var rounded = capture(around: bubble.bounds, name: "rounded")
    if let shot = rounded, shot.at(bubble.bounds, 48, 86).near(backdrop) {
        log("right-click did not switch the shape; trying the 2 key")
        switchMethod = "key"
        pressKey(keyForShape["rounded"]!, pid: pid)
        moveMouseAway(from: bubble.bounds)
        rounded = capture(around: bubble.bounds, name: "rounded")
    }
    if let shot = rounded {
        pixels["rounded.TL"] = "\(expectClear(shot, "rounded TL", 8, 8, backdrop))"
        pixels["rounded.TR"] = "\(expectClear(shot, "rounded TR", 316, 8, backdrop))"
        pixels["rounded.BL"] = "\(expectClear(shot, "rounded BL", 8, 354, backdrop))"
        pixels["rounded.BR"] = "\(expectClear(shot, "rounded BR", 316, 354, backdrop))"
        pixels["rounded.shadowProbe"] = "\(expectClear(shot, "rounded shadow probe below bubble", 162, 352, backdrop))"
        let probe = shot.at(bubble.bounds, 48, 86)
        pixels["rounded.probe"] = "\(probe)"
        if probe.near(backdrop) { failures.append("rounded corner probe (48,86) stayed see-through: shape did not change") }
        pixels["rounded.center"] = "\(expectDrawn(shot, "rounded center", 162, 200, backdrop))"
    } else {
        failures.append("rounded capture failed")
    }

    // 3. Portrait and landscape, by the same input method.
    func nextShape(_ key: String) {
        if switchMethod == "right-click" { rightClick(center) } else { pressKey(keyForShape[key]!, pid: pid) }
        moveMouseAway(from: bubble.bounds)
    }
    nextShape("portrait")
    if let shot = capture(around: bubble.bounds, name: "portrait") {
        pixels["portrait.side"] = "\(expectClear(shot, "portrait side strip", 30, 200, backdrop))"
        pixels["portrait.center"] = "\(expectDrawn(shot, "portrait center", 162, 200, backdrop))"
    } else {
        failures.append("portrait capture failed")
    }
    nextShape("landscape")
    if let shot = capture(around: bubble.bounds, name: "landscape") {
        pixels["landscape.top"] = "\(expectClear(shot, "landscape top strip", 162, 80, backdrop))"
        pixels["landscape.bottom"] = "\(expectClear(shot, "landscape bottom strip", 162, 320, backdrop))"
        pixels["landscape.center"] = "\(expectDrawn(shot, "landscape center", 162, 200, backdrop))"
    } else {
        failures.append("landscape capture failed")
    }

    // 4. Dragging the bubble moves the window.
    let before = bubble.bounds
    let grab = CGPoint(x: before.minX + 162, y: before.minY + 200)
    postMouse(.mouseMoved, grab)
    sleepMs(300)
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

    // Whole screen for the record.
    _ = run("/usr/sbin/screencapture", ["-x", (outDir as NSString).appendingPathComponent("desktop.png")])

    report["seeThroughAndShapeSwitchVerified"] = failures.isEmpty
    report["failures"] = failures
    report["shapeSwitchInput"] = switchMethod
    report["pixels"] = pixels
    report["backdrop"] = "\(backdrop)"
    report["captureScale"] = circle.scale
    report["rustTrial"] = [
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

    if !failures.isEmpty {
        log("macOS see-through / shape-switch verification FAILED:")
        failures.forEach { log("  - \($0)") }
        return 1
    }
    log("ALL MACOS SEE-THROUGH AND SHAPE-SWITCH CHECKS PASSED!")
    return 0
}

// A full-screen magenta window at the normal level is the known colour behind the bubble.
let application = NSApplication.shared
application.setActivationPolicy(.accessory)
let screenFrame = NSScreen.main?.frame ?? NSRect(x: 0, y: 0, width: 1920, height: 1080)
let backdropWindow = NSWindow(contentRect: screenFrame, styleMask: .borderless, backing: .buffered, defer: false)
backdropWindow.backgroundColor = NSColor(srgbRed: 1, green: 0, blue: 1, alpha: 1)
backdropWindow.isOpaque = true
backdropWindow.hasShadow = false
backdropWindow.level = .normal
backdropWindow.ignoresMouseEvents = true
backdropWindow.orderFrontRegardless()

DispatchQueue.global().async {
    sleepMs(1200)
    let code = checks()
    DispatchQueue.main.async { exit(code) }
}
application.run()
