# Verification run: camera quality switches once — 2026-11-09

- **Commit:** built on `dev` at `ebf00568ead24e3b770cb92f896b80adfda5d06b`; the final hash is the PR's merge commit on `dev`
- **Version:** 0.7.0 (unchanged; no release)
- **Observer:** Claude Opus 5.5 (builder agent)
- **Environment:** Linux 7.0 (Wayland, display :0), Node 24.22.2, development checkout
- **Cameras:** none physical; fake `mediaDevices` in unit tests, Chromium's synthetic 60 fps camera in the Electron smoke test
- **Related change/PR:** the PR that carries this file (Orbit cards TOOLS-22 and TOOLS-131, GitHub issue 5, KG-03)

## What was found

The reported trigger (Full screen calling `applyConstraints()` on the live track) was removed by ADR 0026 and stays removed: `applyFullscreen()` in the Overlay changes only geometry and chrome, and the Electron smoke test still checks that the track's device, width and height are unchanged across Full screen. Two paths still switched the live camera mode more than needed:

1. Every queued Camera quality change re-applied the latest quality. A burst of changes (Inline settings, or Scene applies with different qualities) switched the camera mode once per change, and a burst that ended on the quality already running still switched it.
2. A Camera quality chosen while the camera was starting was dropped (there was no track yet), so the camera opened and stayed at the old quality.

Each switch of capture mode on a live track is the step that showed stale, black or another camera's frames on Windows. The session now remembers the quality the track runs at, skips a switch to that same quality, and applies a quality chosen during start to the new track before it reaches the camera or halo video. That late switch goes straight to the new track, and each camera start begins a fresh quality chain, so a stalled switch on the old camera's driver cannot hold the new camera back, then or later. A newer camera start, or quitting, stops the waiting stream at once.

## Automated checks

| Command | Result | Counts/duration | Evidence/notes |
| --- | --- | --- | --- |
| `npm ci` | Pass | | |
| `scripts/agents/kit unit --affected` | Pass | 23/23, 1 file | `.scratch/unit/` |
| `scripts/agents/kit unit` (= `node --test`) | Pass | 273 pass, 1 skipped (tag-build check, not a tag build) | `.scratch/unit/` |
| `npm run test:electron` | Pass | 3/3 | Full screen keeps the synthetic track's device and size |
| Syntax checks | Pass | `node --check src/camera-session.js` | |
| `git diff --check` | Pass | | |

New unit tests (`test/camera-session.test.js`); the first four failed on `ebf0056` before the change:

- rapid Camera quality changes switch the running track once, to the final quality
- Camera quality changes that end on the running quality never switch the camera mode
- a Camera quality change while the camera starts is applied before the camera is shown
- an unsupported Camera quality leaves the camera running, and going back to the running quality switches nothing
- a camera replaced while its late Camera quality is applied is stopped at once and never shown
- a stalled Camera quality change on the old camera never holds back the next camera
- the blur halo never shows a starting camera while its late Camera quality is applied
- stopping while a starting camera gets its late Camera quality never shows it
- a Camera quality the camera rejects while starting is tried once and the camera still shows

The last five cover review notes on this change. Each of the first four failed on the version before its fix (the stall test also checks that a later Camera quality change reaches the new camera); the last one covers a branch that was already right.

## Manual checks

| ID | Result | Observation/evidence |
| --- | --- | --- |
| W-14 | Not run | Needs Windows hardware |
| W-17 | Not run | Needs Windows with several cameras including an Elgato device; steps are in the PR |

## Regressions and surprises

- Applying a Scene saved with a different Camera quality still switches the live camera mode once. That is the hardware-risky step KG-03 tracks; this change does not remove it.

## Release decision

- **Decision:** Documentation baseline only
- **Reason:** Lands on `dev`; issue 5 hardware acceptance (W-17) is still open.
- **Known exceptions accepted by:** —
- **Follow-ups:** Lex's Windows/Elgato check (W-14, W-17).
