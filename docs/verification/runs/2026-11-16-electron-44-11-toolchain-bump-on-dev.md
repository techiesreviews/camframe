# Verification run: tools-295-toolchain-bump on dev with ADR 0039 — 2026-11-16

- **Commit:** 9e9623a6676e001826c5cc7e72a449d467e1b35c
- **Version:** 0.8.0 (unreleased; branch `tools-295-toolchain-bump`, rebased on `dev` at a742f20, which holds the one-step Preferences save, ADR 0039)
- **Observer:** Claude Opus 5.5 (agent, builder)
- **Environment:** Linux 7.0.0-43-generic, Wayland session with X11 available, Node 24.22.2, npm 11.19.1, dev (unpackaged) and a Windows unpacked build made on Linux; no wine
- **Cameras:** Chromium's synthetic camera (Electron smoke)
- **Related change/PR:** Orbit TOOLS-295 pick 0b, PR #61; the earlier run `2026-11-16-electron-44-11-toolchain-bump.md` was on the branch before the rebase

## Automated checks

| Command | Result | Counts/duration | Evidence/notes |
| --- | --- | --- | --- |
| `npm ci` | Pass | | electron 44.11.3 (`node_modules/electron/dist/version`), electron-builder 26.18.1, playwright-core 1.63.0, vite 8.3.8 |
| `npm audit` | 0 high, 6 moderate | | the 6 moderate are `minimatch` 9 under `@electron/universal` 2 (Electron Builder's macOS universal-build path), as in the earlier run; before the bump `dev` had 4 high |
| `npm test` (`kit unit`) | Pass | 361 pass, 1 skipped, 0 fail | `dev`'s 360 (including the 22 Preferences store tests) plus `test/toolchain-pins.test.js` |
| `npm run test:electron` | Pass | 6/6 | on Electron 44.11.3, including the sixth smoke: a cut-off `preferences.json` opens with the last good copy and is repaired on quit |
| Syntax checks | Not run | | no source change in this branch |
| `git diff --check` | Pass | | |

## Build and artifact checks

| Target/check | Result | Artifact/hash/notes |
| --- | --- | --- |
| Windows unpacked (`npm run pack`, on Linux) | Pass | `CamFrame.exe` reports `Electron/44.11.3`; `app.asar` holds `src/preferences-store.js` |
| Windows NSIS | Blocked | needs wine on Linux; Windows CI (`build-desktop.yml`) or Lex's laptop |
| Windows portable | Blocked | same |
| macOS arm64 DMG/ZIP | Not run | |
| macOS x64 DMG/ZIP | Not run | |
| ASAR/locales/fonts/permission metadata | Pass (Windows unpacked) | |

## Manual checks

| ID | Result | Observation/evidence |
| --- | --- | --- |
| Artifact inspection: Windows NSIS and portable launch results | Not run | the next Windows build |
| W-01, W-08, W-09, W-14, W-23 | Not run | Electron 44.11 on Windows: camera start, hover chrome, click-through, Full screen, Always on top |
| W-27 | Not run | quit keeps settings with the new Preferences store on Windows |

## Regressions and surprises

None seen.

## Release decision

- **Decision:** Documentation baseline only
- **Reason:** A maintenance change on `dev`; release needs its own run, the Windows build and Lex's go.
- **Known exceptions accepted by:** —
- **Follow-ups:** the Windows rows above in the next release run; macOS builds when a macOS release is planned.
