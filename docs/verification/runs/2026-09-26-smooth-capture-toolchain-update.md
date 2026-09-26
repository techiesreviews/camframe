# Verification run: smooth capture and toolchain update — 2026-09-26

- **Commit:** Working tree based on `57a6044`
- **Version:** `0.5.0` (unchanged)
- **Observer:** Claude Code; the repository owner's camera setup was used for physical-device probes
- **Environment:** Windows 11 Pro 10.0.26200, NVIDIA RTX 5070 Ti (active Chromium GPU) plus AMD Radeon iGPU, LG HDR 4K 60 Hz / Dell P2416D 59 Hz / Elgato Prompter 60 Hz, Node 24.21.0, npm 11.19.0, Electron 44.4.5, Electron Builder 26.17.0, Playwright Core 1.63.0, Vite 8.3.1
- **Cameras:** Elgato Virtual Camera (Camera Hub, 1920×1080 at 60 fps), Elgato Cam Link 4K, Chromium synthetic camera at 60 fps
- **Related change:** ADR 0028

## Automated checks

| Command | Result | Counts/evidence |
| --- | --- | --- |
| `npm ci` (Electron 43 baseline) | Pass | 0 vulnerabilities |
| `npm install` (upgrade) / `npm audit` | Pass | 0 vulnerabilities; direct tools pinned exactly |
| `npm test` | Pass | 51 passed, 0 failed; adds a guard that no constraint set carries a frame-rate ideal, maximum, or exact value |
| `npm run test:electron` | Pass | 1 passed, 0 failed on Electron 44.4.5; the synthetic camera now runs at 60 fps |
| `npm run probe:camera` | Pass | See measurements below |

## Build and artifact checks

| Target/check | Result | Artifact/hash/notes |
| --- | --- | --- |
| Windows unpacked | Pass | `npm run pack`; packaged `CamFrame.exe` launched with an isolated `--user-data-dir`, reported Electron 44.4.5, opened the Elgato Virtual Camera at 1280×720/60 fps with the ADR 0028 constraints and 0 discarded frames |
| Windows NSIS / portable | Not run | CI matrix |
| macOS arm64 / x64 | Not run | CI matrix |

## Camera measurements

Each row is one 6–8 s `npm run probe:camera` sample after the first frame. "Discarded" counts frames Chromium dropped before the video element (`MediaStreamTrack.stats`).

| Camera / quality | Constraints | Source fps | Presented fps | Discarded/s | Capture→display p50 |
| --- | --- | --- | --- | --- | --- |
| Elgato Virtual Camera / 2160p | Original ideal 60, min 30, max 60 | 59.4–60.1 | 53.0–53.2 | 6.3–6.9 | 17 ms |
| Elgato Virtual Camera / 2160p | ADR 0028 | 59.5–60.3 | 59.3–60.2 | 0 | 17–19 ms |
| Elgato Virtual Camera / 720p | ADR 0028 | 60.6 | 60.4 | 0 | 17 ms |
| Synthetic / 720p and 2160p | ADR 0028 | 59.8–60.0 | 59.7–59.9 | 0 | n/a (synthetic capture clock) |
| Elgato Virtual Camera / 2160p, Progressive blur | ADR 0028 | 59.4 | 59.3 | 0 | 17.5 ms |
| Elgato Virtual Camera / 2160p, Glow | ADR 0028 | 59.6 | 59.5 | 0 | 16.4 ms |

Rejected variants on the same setup, all still discarding frames: `resizeMode: 'none'` with the original profile, ideal 60/min 30 without max, ideal 60/min 30/max 120, ideal 120/min 30, and min 30/max 60.

## Regressions and surprises

- The Elgato Virtual Camera reports only 1920×1080 even when 2160p is selected.
- The Cam Link 4K cannot be opened directly while Camera Hub owns it, so its 2160p probe produced no frames.
- The Elgato Virtual Camera label uses a lookalike character (`EƖgato`); probe matching should use `gato virtual`.
- Frame effects had no measurable pipeline cost on this GPU.

## Release decision

- **Decision:** Documentation baseline only
- **Reason:** Maintenance and performance change inside the v0.5.0 candidate; CI packaging and the open human checks from the v0.5.0 run still apply.
- **Known exceptions accepted by:** None
- **Follow-ups:** Probe a UVC webcam that offers both 30 and 60 fps modes to confirm the advanced-set mode selection on hardware.
