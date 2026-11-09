# Verification run: build/fleet-lead-camframe-the-window-can-never-end-up-off-screen-self-healing — 2026-11-09

- **Commit:** the branch head of the TOOLS-156 pull request (based on `dev` `9ea8126`)
- **Version:** 0.7.0 (unchanged; no release)
- **Observer:** Claude Opus 5.5 (fleet builder)
- **Environment:** Linux 7.0 (Wayland/Xwayland `:0`), Node 24.22.2, Electron 44.7.0 from the main checkout's `node_modules`, one display; dev build
- **Cameras:** Chromium's synthetic camera (`use-fake-device-for-media-stream`)
- **Related change/PR:** Orbit TOOLS-156, ADR 0038

## Automated checks

| Command | Result | Counts/duration | Evidence/notes |
| --- | --- | --- | --- |
| `scripts/agents/kit unit` | Pass | all suites | New tests failed before the change (the geometry import and the exact-Scene clamp); the old-Preferences load test passed before and after (it guards that nothing is dropped). |
| `npm run test:electron` | Pass | 5/5 | The new fifth smoke failed on `origin/dev`'s `src/` (the Overlay stayed off screen) and passes with the change; the four existing smokes pass. Run through `kit go`. |
| `git diff --check` | Pass | | |

## Build and artifact checks

| Target/check | Result | Artifact/hash/notes |
| --- | --- | --- |
| Windows unpacked | Not run | No release (Lex's go is needed for one). |
| Windows NSIS | Not run | |
| Windows portable | Not run | |
| macOS arm64 DMG/ZIP | Not run | |
| macOS x64 DMG/ZIP | Not run | |
| ASAR/locales/fonts/permission metadata | Not run | |

## Manual checks

| ID | Result | Observation/evidence |
| --- | --- | --- |
| W-37 | Not run | Needs Lex's laptop and a second display (KG-17). |

## Regressions and surprises

- Under Wayland, Electron reports every window at `0,0`, so the new smoke launches with `--ozone-platform=x11` on Linux to read real positions. The other smokes are unchanged.

## Release decision

- **Decision:** Documentation baseline only
- **Reason:** Lands on `dev`; any CamFrame release needs Lex's go.
- **Known exceptions accepted by:** —
- **Follow-ups:** W-37 by hand on Windows.
