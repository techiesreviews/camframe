# Verification run: tools-295-toolchain-bump — 2026-11-16

- **Commit:** 24f23f8c3e38a06326ff48a0527c5e4fac4b8f55
- **Version:** 0.8.0 (unreleased; branch `tools-295-toolchain-bump`, for `dev`)
- **Observer:** Claude Opus 5.5 (agent, builder)
- **Environment:** Linux 7.0.0-43-generic, Wayland session with X11 available, Node 24.22.2, npm 11.19.1, dev (unpackaged) and Windows/Linux unpacked builds made on Linux; no wine
- **Cameras:** Chromium's synthetic camera (Electron smoke)
- **Related change/PR:** Orbit TOOLS-295 pick 0b (security advisories S1 and S2 of the 2026-11-15 architecture review), ADR 0027 2026-11-16 update

## Automated checks

| Command | Result | Counts/duration | Evidence/notes |
| --- | --- | --- | --- |
| `npm audit` before (origin/dev, 3fee479) | 4 high, 7 moderate | | high: electron 44.7.0 (eMudhra certificates, fixed in 44.9.1), vite 8.3.1 (launch-editor on Windows), undici, source-map-js; moderate: fast-uri and Electron Builder's `minimatch` tree |
| `npm install -D -E electron@44.11.3 vite@8.3.8 electron-builder@26.18.1` then `npm audit fix` | Pass | | resolved: electron 44.11.3, vite 8.3.8, electron-builder 26.18.1, undici 6.29.1 and 7.30.2, source-map-js 1.2.2, fast-uri 3.1.9; Playwright Core 1.63.0 unchanged |
| `npm audit` after | 0 high, 6 moderate | | all 6 from `minimatch` 9.0.9 under `@electron/universal` 2.0.3 (Electron Builder's macOS universal-build path); npm's only offer is Electron Builder 24.13.3, which brings back the Windows `EPERM` rename defect (ADR 0027) |
| `npm test` | Pass | 338 pass, 1 skipped, 0 fail | same count as before the bump |
| `npm run test:electron` | Pass | 5/5 | Electron 44.11.3 (`node_modules/electron/dist/version`) |
| `npx vite` dev server | Pass | | Vite 8.3.8 ready, `/src/overlay.html` answers 200 |
| Syntax checks | Not run | | no source change |
| `git diff --check` | Pass | | |

## Build and artifact checks

| Target/check | Result | Artifact/hash/notes |
| --- | --- | --- |
| Windows unpacked (`npm run pack`, on Linux) | Pass | `dist/win-unpacked/CamFrame.exe` reports `Chrome/152.0.7977.169 Electron/44.11.3`; `app.asar` holds `package.json` and `src/**`; locales `en-US.pak` only |
| Windows NSIS | Blocked | `npm run dist` on Linux stops at `spawn wine ENOENT`; needs the Windows CI build (`build-desktop.yml`) or Lex's laptop |
| Windows portable | Blocked | same |
| Linux unpacked (`electron-builder --dir --linux`) | Pass | Electron Builder 26.18.1 packages on this machine |
| macOS arm64 DMG/ZIP | Not run | |
| macOS x64 DMG/ZIP | Not run | |
| ASAR/locales/fonts/permission metadata | Pass (Windows unpacked) | as above |

## Manual checks

| ID | Result | Observation/evidence |
| --- | --- | --- |
| Windows installer and portable build | Not run | Needs the next Windows build: install and start CamFrame on Lex's laptop, camera shows, move, Full screen, quit |
| Electron 44.11 on Windows (camera, transparency, click-through, always on top) | Not run | The real-Electron smoke ran on Linux only; Windows CI runs it on the next tag or manual build |

## Regressions and surprises

None seen. Electron Builder logs "no node modules found in collection" because CamFrame ships no runtime dependencies; the packaged `app.asar` holds the same files as before.

## Release decision

- **Decision:** Documentation baseline only
- **Reason:** A maintenance change on `dev`; release needs its own run, the Windows build and Lex's go.
- **Known exceptions accepted by:** —
- **Follow-ups:** the two Windows rows above in the next release run; the 6 moderate `minimatch` advisories wait for an Electron Builder release that moves `@electron/universal` off `minimatch` 9.
