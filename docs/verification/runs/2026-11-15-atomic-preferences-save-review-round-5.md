# Verification run: tools-295-atomic-prefs review rounds 4 and 5 — 2026-11-15

- **Commit:** 1284e6917c86c4c2b88f2a3eb36d15ae5494f447
- **Version:** 0.8.0 (unreleased; branch `tools-295-atomic-prefs`, for `dev`)
- **Observer:** Claude Opus 5.5 (agent, builder)
- **Environment:** Linux 7.0.0-43-generic, Wayland session with X11 available, Node 24.22.2, npm 11.19.1, dev (unpackaged)
- **Cameras:** Chromium's synthetic camera (Electron smoke)
- **Related change/PR:** Orbit TOOLS-295 pick 0a, ADR 0039; after review rounds 4 and 5 on `2026-11-15-atomic-preferences-save-second-look-fixes.md`

## Automated checks

| Command | Result | Counts/duration | Evidence/notes |
| --- | --- | --- | --- |
| `npm ci` | Pass | | Electron binary fetched with `node node_modules/electron/install.js` (npm 11 held back its install script) |
| `npm test` (`kit unit`) | Pass | 356 pass, 1 skipped, 0 fail | 18 new tests in `test/preferences-store.test.js`: a cut-off `preferences.json` loads the last good copy and its Scene; no direct write onto `preferences.json`; a crash while writing `preferences.json` leaves it and the copy whole; a failed refresh of the copy still saves; a rename blocked with `EPERM`, `EACCES` or `EBUSY` writes in place, any other rename error throws; an unreadable file loads the copy, and saving over it leaves the copy alone; the last good copy follows each save; a broken file never replaces it; a missing file still starts fresh; a broken file with no copy still starts from defaults; two overlapping saves use separate temporary files (this test fails with one shared `preferences.json.tmp`); the folder is flushed after the rename on Linux, and not opened on Windows; a folder that refuses the flush does not fail a completed save and its handle is closed; a failed save (twice in a row, a failed copy refresh, an `ENOSPC` rename) leaves no temporary file; a temporary file that cannot be removed (`EBUSY`) neither fails an in-place save nor hides a write failure |
| `npm run test:electron` | Pass | 5/5 at this commit | The real main process saves, quits and relaunches through the new store (layout Scenes persist, Scenes tab autosave, off-screen place) |
| Syntax checks | Pass | | `for f in src/*.js scripts/*.mjs; do node --check "$f"; done; node --check src/preload.cjs` |
| `git diff --check` | Pass | | |

## Build and artifact checks

| Target/check | Result | Artifact/hash/notes |
| --- | --- | --- |
| Windows unpacked | Not run | No packaging change |
| Windows NSIS | Not run | |
| Windows portable | Not run | |
| macOS arm64 DMG/ZIP | Not run | |
| macOS x64 DMG/ZIP | Not run | |
| ASAR/locales/fonts/permission metadata | Not run | |

## Manual checks

| ID | Result | Observation/evidence |
| --- | --- | --- |
| W-27 | Not run | Needs Lex's Windows laptop: change a setting, quit from the toolbar and the tray, start again; the setting is kept, and `%APPDATA%\CamFrame` holds `preferences.json` and, after a second save, `preferences.last-good.json` |
| Extra: rename refused by another program | Not run | The in-place fallback is automated with a fake `EPERM`, `EACCES` or `EBUSY` rename; a real Windows antivirus or indexer holding the file is not |

## Regressions and surprises

None seen.

## Release decision

- **Decision:** Documentation baseline only
- **Reason:** A maintenance change on `dev`; release needs its own run and Lex's go.
- **Known exceptions accepted by:** —
- **Follow-ups:** the two Windows rows above in the next release run.
