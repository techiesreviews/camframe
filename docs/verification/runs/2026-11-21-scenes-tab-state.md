# Verification run: tools-295 Scenes tab state — 2026-11-21

- **Commit:** the change on branch `build/tools-295-tab`, on top of `dev` at d904686 (the PR's head commit holds this file)
- **Version:** 0.8.0 (unreleased)
- **Observer:** Claude Opus 5.5 (agent, builder)
- **Environment:** Linux 7.0.0-43-generic, Node 24.22.2, dev (unpackaged)
- **Cameras:** none (unit tests and the browser QA preview only)
- **Related change/PR:** Orbit TOOLS-295, architecture review job "Scenes tab state"

## Automated checks

| Command | Result | Counts/duration | Evidence/notes |
| --- | --- | --- | --- |
| `npm ci` | Pass | | in the worktree, before `kit doctor` |
| `npm test` | Pass | 475 tests: 474 pass, 1 skipped, 0 fail | the skipped one is the release Go check, which runs only on a version tag build |
| New tests on the old code | Fail as expected | `test/scenes-tab-state.test.js` fails to import (`src/scenes-tab-state.js` does not exist yet) | |
| Undo on a layout Scene keeps the camera and quality picked since | Pass on old and new code | | a test the code already met; it fails when `createSceneEdits` follows the camera keys too (tried by changing `FOLLOWED_LOOK_KEYS` in `src/scenes.js`, then put back) |
| `kit shots` | Pass | 25 screenshots, byte for byte the same as before the change | every PNG compared with `cmp` against a run on d904686; the run now also checks F2 focuses the rename field with its name selected, Escape puts focus back on the Scene, and an arrow key moves to the Scene before it |
| `kit ux` | Not run | | the repo has no `docs/agents/features.md` list for it to try |
| `npm run test:electron` | Not run | | the brief says not to run the Electron smoke on Lex's screen |
| `git diff --check` | Pass | | |

## What changed for the user

Nothing. The Scenes tab's interaction state (a rename or save in progress, where focus goes next, typing with an input method, the saved check, Import/Export results, keys and drag) moved out of `src/scenes-panel.js` into `src/scenes-tab-state.js`, which takes events and returns what to draw and where focus goes, so it is tested without a DOM. The two earlier focus and typing bugs (7c63315, 6862b5e) are regression tests there now. Requests still reach the bridge at the same point as before, so the browser QA preview's bridge, which answers at once, still draws main's new state once and in the same order.

## Manual checks

| ID | Result | Observation/evidence |
| --- | --- | --- |
| Scenes tab by keyboard, typing with an input method | Not run | covered by the unit tests and the 25 preview shots |

## Regressions and surprises

None found.

## Release decision

- **Decision:** Documentation baseline only
- **Reason:** lands on `dev`; no CamFrame release in this change.
- **Known exceptions accepted by:** none
- **Follow-ups:** none
