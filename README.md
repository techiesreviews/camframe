# CamFrame

CamFrame is a small Windows and macOS desktop app that places a live camera feed in a movable shape above other windows.

For an implementation-level product specification, architecture map, data contracts, rebuild sequence, and verification history, start at [`docs/README.md`](docs/README.md).

## Features

- Select any connected camera.
- Circle, rounded square, portrait, and landscape shapes.
- Drag the overlay directly to any screen position.
- Resize from any corner while preserving the selected shape's aspect ratio.
- Reposition the live image inside its crop and double-click to recenter it.
- Animated fullscreen mode with `Esc` to restore the previous size and position.
- Adjustable frame width, camera quality, and mirroring.
- Optional always-on-top behavior, including above the Windows taskbar.
- Hover toolbar with Inline settings for Camera, Style, and Scenes.
- Tray controls and `Ctrl+Shift+C` to reveal the inline controls.
- Four contextual first-run coach marks that reveal camera, placement, framing, and Scene controls, reopenable from tray Help.
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

The Windows installer and portable executable are written to `dist/`.

On macOS, build a DMG and ZIP with:

```bash
npm run dist:mac
```

Native Apple Silicon and Intel builds are produced by the GitHub Actions desktop-build workflow. The macOS app includes the required camera permission description. Unsigned development builds may trigger Windows SmartScreen or macOS Gatekeeper warnings.

## Performance and download size

The Overlay uses one camera stream and native Chromium video elements; Progressive blur's optional second video shares that stream. It does not copy frames through canvas or JavaScript. Camera quality defaults to 1280x720 at 60 fps and remains unchanged when entering or leaving Full screen, avoiding mode-change track renegotiation. Unsupported quality changes keep the current working stream. CamFrame uses a motion-first content hint, leaves GPU acceleration enabled, and disables background throttling only for the Overlay window. Transparent areas stay click-through, while forwarded pointer movement reveals the controls without clipping the antialiased camera edge.

Release builds include only the English Chromium locale and the exact font assets used by the interface. Electron still provides the browser, camera, GPU, and window runtime, so it imposes a larger baseline than a fully native application.
