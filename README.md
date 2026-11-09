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
- Hover toolbar with Inline settings for Camera, Style, and Scenes. Scenes show as a list or a grid of small screens; the Scene on camera saves your changes by itself, with Undo for 10 seconds. New installs start with "Small bottom" and "Big right".
- Tray controls and `Ctrl+Shift+C` to reveal the inline controls.
- Four contextual first-run coach marks that reveal camera, placement, framing, and Scene controls, reopenable from tray Help.
- Remembers the selected camera, crop position, appearance, and screen position.
- Optional Prompter link: the Techies prompter can switch CamFrame to full screen, to the small view in a corner, or to a saved Scene when you reach a cue line in your script. Off until you turn it on.

## Prompter link (optional)

CamFrame can follow the camera cues in your prompter script, so you don't have to press shortcuts while you talk.

**Turn it on**

1. In CamFrame, hover over the camera and click the **Prompter link** button (the scroll icon, next to the sliders). It gets a white ring and a green dot when it is ready. An orange dot means something is wrong, for example another app uses the port: hover the button to read what happened.
2. In the prompter (https://prompter.techies.tools), open **Settings** and tick **CamFrame link**. It should say "Connected to CamFrame" and list your Scenes.
3. The first time, Chrome may ask whether the prompter may reach apps on this device. Allow it.

Click the scroll button again to stop. With the link off, CamFrame listens for nothing.

**Cue cheat-sheet** (write these as reminder lines in your script, in square brackets; capitals don't matter)

| In your script | CamFrame does |
| --- | --- |
| `[Face full]` | Full screen (or the Scene chosen for "Face full" in an older version) |
| `[Face small]` | The stored small size, where the camera was (or the place or Scene chosen for "Face small" in an older version). The small size is the size you last set by resizing CamFrame by hand; a larger layout never changes it |
| `[Face small, bottom right]` | Small camera in that corner of the screen it is on. Places: top left, top right, bottom left, bottom right, left, right, center |
| `[Face: Demo]` | Your saved Scene called "Demo" (its size and place; a Scene saved in CamFrame also brings back its look, a layout Scene saved by the prompter keeps the camera's current look) |

For the two livestream layouts (a larger camera on the right, and the small camera bottom-right) saved as layout Scenes that keep the camera's look, see [docs/prompter-link-api.md](docs/prompter-link-api.md).

You can put a cue after other words, like `[Share screen. Face small.]` or `[Stop share. Face full.]`. The cue fires once when that line reaches the prompter's reading line, and again if you scroll back above it and read it again.

**Defaults**: `[Face full]` goes Full screen, `[Face small]` uses the stored small size where the camera was, and places keep the camera 32 px from the screen edges. These have no controls any more; a choice made in an older version is kept. At the top places the camera sits a little lower, so its toolbar stays on screen.

**Good to know**

- The link moves and resizes CamFrame's own camera view, can save layout Scenes and the small size, and lets the prompter read your camera's name and your display layout. It never records, streams or changes your camera.
- It works only on this computer: CamFrame listens on `127.0.0.1` port 47833 and answers only the prompter. Your script never leaves the prompter; only the short cue does.
- Use Chrome or Edge for the prompter. Safari may refuse to reach apps on this computer.
- If the settings say the port is in use, another app took port 47833. Close it, then switch the link off and on.

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

The Overlay uses one camera stream and native Chromium video elements; Progressive blur's optional second video shares that stream. It does not copy frames through canvas or JavaScript. Camera quality defaults to 1280x720, prefers 60 fps camera modes without letting Chromium discard early frames, and remains unchanged when entering or leaving Full screen, avoiding mode-change track renegotiation. Unsupported quality changes keep the current working stream. CamFrame uses a motion-first content hint, leaves GPU acceleration enabled, and disables background throttling only for the Overlay window. Transparent areas stay click-through, while forwarded pointer movement reveals the controls without clipping the antialiased camera edge.

Release builds include only the English Chromium locale and the exact font assets used by the interface. Electron still provides the browser, camera, GPU, and window runtime, so it imposes a larger baseline than a fully native application.
