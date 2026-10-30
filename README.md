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
- Optional Prompter link: the Techies prompter can switch CamFrame to full screen, to the small view in a corner, or to a saved Scene when you reach a cue line in your script. Off until you turn it on.

## Prompter link (optional)

CamFrame can follow the camera cues in your prompter script, so you don't have to press shortcuts while you talk.

**Turn it on**

1. In CamFrame, hover over the camera and click the **Prompter link** button (the scroll icon, next to the sliders). It gets a white ring and a green dot when it is ready. You can also switch it on in the controls (the sliders button) under **Scenes** → **Prompter link**; the line under it then says "On. Waiting for prompter cues on port 47833". An orange dot means something is wrong, for example another app uses the port: the line under the switch says what happened.
2. In the prompter (https://prompter.techies.tools), open **Settings** and tick **CamFrame link**. It should say "Connected to CamFrame" and list your Scenes.
3. The first time, Chrome may ask whether the prompter may reach apps on this device. Allow it.

Click the scroll button again, or turn either switch off, to stop. With the link off, CamFrame listens for nothing.

**Cue cheat-sheet** (write these as reminder lines in your script, in square brackets; capitals don't matter)

| In your script | CamFrame does |
| --- | --- |
| `[Face full]` | Full screen (or the Scene you chose for "Face full") |
| `[Face small]` | Back to the small camera where it was (or the place or Scene you chose for "Face small") |
| `[Face small, bottom right]` | Small camera in that corner of the screen it is on. Places: top left, top right, bottom left, bottom right, left, right, center |
| `[Face: Demo]` | Your saved Scene called "Demo" (its size, place and look) |

You can put a cue after other words, like `[Share screen. Face small.]` or `[Stop share. Face full.]`. The cue fires once when that line reaches the prompter's reading line, and again if you scroll back above it and read it again.

**Settings** (under the Prompter link switch, shown while it is on): **Face full** (Full screen or a Scene), **Face small** (Where it was, one of the seven places, or a Scene) and **Corner margin** (how far the camera stays from the screen edges, 32 px by default). At the top places the camera sits a little lower, so its toolbar stays on screen.

**Good to know**

- The link only moves and resizes CamFrame's own camera view. It never records, streams or changes your camera.
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
