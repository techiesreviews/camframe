# Verification run: refactor/deepen-electron-modules — 2026-10-11

- **Commit:** uncommitted working tree on `84da019` (branch `refactor/deepen-electron-modules`)
- **Version:** 0.5.0 (package metadata unchanged)
- **Observer:** Claude Code (automated runs only; no human observation)
- **Environment:** Ubuntu 26.04.1 LTS, Linux 7.0.0-38, AMD Ryzen 9 8945HS with Radeon 780M, GNOME Wayland session. Node v22.22.1, npm 9.2.0, Electron 44.7.0, development mode (`electron .`)
- **Cameras:** Chromium synthetic camera only (`use-fake-device-for-media-stream`); no physical camera
- **Related change/PR:** ADR 0029, ADR 0030, ADR 0027 maintenance note; architecture review candidates 1–6, 8, 9 (GPUI candidate 7 deferred)

## Automated checks

| Command | Result | Counts/duration | Evidence/notes |
| --- | --- | --- | --- |
| `npm ci` | Pass | Electron 44.7.0 binary downloaded | Lockfile integrity matches the registry tarball for 44.7.0 |
| `npm test` (baseline `84da019`) | Pass | 51/51 | Before any change |
| `npm test` | Pass | 155/155, ~0.24 s | 136 behavioral tests through module interfaces, 19 static markup/CSS/wiring tests (100 regex assertions, 35 on JS source; previously 133 and about 69) |
| `npm run test:electron` | Pass | 1/1, ~2.3 s | Ran on Linux with Electron's default platform choice in a Wayland session; CI target remains Windows |
| Syntax checks | Pass | every `src/*.js`, `scripts/*.mjs`, `src/preload.cjs` | `node --check` |
| `git diff --check` | Pass, with an existing exception | — | Flags only the four edited `package-lock.json` lines, whose CRLF endings match every one of the file's 4360 lines at `84da019` |

### Real-Electron reproduction of the onboarding reserve defect

A Playwright script (not checked in) launched each tree with an isolated Preferences directory and `--ozone-platform=x11`. It waited for the first-run tour, called `toggleFullscreen()` (the same IPC path as `Ctrl/Cmd+Shift+F`), clicked Skip, called `exitFullscreen()`, then read the Overlay bounds.

| Tree | Bounds with reserve | Expected compact bounds | Bounds after exit |
| --- | --- | --- | --- |
| Baseline `84da019` (Electron 44.7.0) | `x 2200, y 794, 324×610` | `y 1014, 324×390` | `y 794, 324×390`: **220 px too high** |
| This change | `x 2200, y 794, 324×610` | `y 1014, 324×390` | `y 1014, 324×390`: correct |

The same sequence and its variants (reserve left open through Full screen, close during the exit animation, resize/move while reserved) are now unit tests in `test/overlay-geometry.test.js`.

### Onboarding trace comparison

A second script (not checked in) walked the tour in real Electron and recorded 19 fields at 17 checkpoints. The fields include title, demo marker, hovered, framing, shape, Inline settings visibility and panel, `--settings-top`, `--onboarding-offset`, highlighted target, Back/Next, progress, demo cursor, focused element, and saved shape/zoom/position/completion. The checkpoints covered opening, all four steps, the shape demo at three times, hovering Shape, Back, the framing demo, pointer movement, Escape, Next, Done, and window blur.

- Baseline vs. after the interaction model (step 7): 16 of 17 identical. The one difference, at 50 ms after opening, was timing jitter around the 80 ms reveal; the checkpoint moved to 200 ms.
- Baseline vs. after the tour controller and framing module (steps 8 and 9, and the final tree): 17 of 17 identical, with no page or console errors.

## Build and artifact checks

| Target/check | Result | Artifact/hash/notes |
| --- | --- | --- |
| Windows unpacked | Not run | Linux host |
| Windows NSIS | Not run | |
| Windows portable | Not run | |
| macOS arm64 DMG/ZIP | Not run | |
| macOS x64 DMG/ZIP | Not run | |
| ASAR/locales/fonts/permission metadata | Not run | New `src/*.js` files are covered by the existing `src/**/*` package glob |

## Manual checks

No manual Windows or macOS matrix rows were run. Every row in `../README.md` remains open for this change, especially W-06/W-07 (drag/resize), Full screen, onboarding, Scenes, and pointer pass-through, because those paths moved into new modules.

| ID | Result | Observation/evidence |
| --- | --- | --- |
| All | Not run | Automated evidence only |

## Regressions and surprises

- **Fixed defect:** the stuck onboarding reserve above.
- **Intentional behavior differences** (ADR 0029, ADR 0030):
  - The native `moved` event now saves the compact position while the onboarding reserve is open. Before, it skipped saving until the tour closed.
  - Renderer interactivity follows one rule in every path. Before, six call sites used different subsets of activities.
  - Renderer `updateState` patches can no longer change `presets`, `completedOnboardingVersion`, or `schemaVersion`. No current renderer code sent them.
  - Every bridge channel now rejects senders other than the Overlay and invalid arguments. Before, only `accessibility:preferences` checked its sender.
  - Frame effect changes no longer re-apply identical window bounds.
  - Closing onboarding during a window animation (a Scene transition, or within 280 ms of entering or leaving Full screen) now finishes that animation at once before releasing the reserve, so the window jumps to its final bounds instead of sliding. Before, the reserve stayed set in that case.
  - Resizing now saves Preferences on each 16 ms tick (debounced to 120 ms) instead of only when resizing stops.
  - An unreachable Scene import branch (`imported-{slot}-` ID renaming) was removed.
- **Existing defects recorded, not changed:** KG-10 (mirrored framing edge), KG-11 (interactivity can disagree between main and renderer), KG-12 (Escape leaves the framing demo running, seen in both traces).
- **Independent review:** a separate agent compared every moved function against `84da019` and found no regressions beyond these items. It also noted a sub-0.5% change in `--corner-scale-x` from using rounded camera dimensions.
- **Existing smoke observation:** `01-onboarding-camera.png` shows the camera picture drawn above the resize handles inside the enlarged onboarding window, identically on the baseline and this change. Its cause, such as capture timing during the offset change, was not investigated.

## Release decision

- **Decision:** Documentation baseline only
- **Reason:** Automated and real-Electron evidence on Linux with a synthetic camera; no Windows/macOS manual matrix or packaging.
- **Known exceptions accepted by:** —
- **Follow-ups:** Run the Windows manual matrix and the CI Electron smoke; decide KG-12; consider a Rust loader for `test/fixtures/preferences/` in the GPUI experiment.
