# CamFrame

CamFrame is a small Windows desktop app that places a live camera feed in a movable shape above other windows.

## Features

- Select any connected camera.
- Circle, rounded square, portrait, and landscape shapes.
- Drag the overlay directly to any screen position.
- Resize from any corner while preserving the selected shape's aspect ratio.
- Reposition the live image inside its crop and double-click to recenter it.
- Animated fullscreen mode with `Esc` to restore the previous size and position.
- Adjustable frame width, frame color, and mirroring.
- Optional always-on-top behavior.
- Hover toolbar with inline camera, size, frame, and always-on-top settings.
- Tray controls and `Ctrl+Shift+C` to reveal the inline controls.
- Remembers the selected camera, crop position, appearance, and screen position.

## Run locally

```powershell
npm.cmd install
npm.cmd start
```

Windows will ask for camera permission the first time. If permission was previously blocked, enable camera access for desktop apps in **Settings → Privacy & security → Camera**.

## Build an installer

```powershell
npm.cmd run dist
```

The NSIS installer and portable executable are written to `dist/`.

## Performance

The overlay uses one native Chromium video element and one camera stream. It does not copy frames through canvas or JavaScript. Capture prefers 1280×720 at 60 fps with a motion-first content hint, falls back for slower cameras, leaves GPU acceleration enabled, and disables background throttling only for the overlay window. Transparent areas stay click-through, while forwarded pointer movement reveals the controls without clipping the antialiased camera edge.
