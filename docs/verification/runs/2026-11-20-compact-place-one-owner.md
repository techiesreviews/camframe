# Verification run: tools-295-b1 compact place, one owner — 2026-11-20

- **Commit:** the change on branch `build/tools-295-b1-compact-place`, on top of `dev` at d0cb9dbd45413a426c804761e1c1e47c62ac1cba (the PR's head commit holds this file)
- **Version:** 0.8.0 (unreleased)
- **Observer:** Claude Opus 5.5 (agent, builder)
- **Environment:** Linux 7.0.0-43-generic, Wayland session with X11 available, Node 24.22.2, npm 11.19.1, dev (unpackaged)
- **Cameras:** Chromium's synthetic camera (Electron smoke)
- **Related change/PR:** Orbit TOOLS-295, architecture review bug B1 (a toolbar Shape or size change left the Active Scene with the old place)

## Automated checks

| Command | Result | Counts/duration | Evidence/notes |
| --- | --- | --- | --- |
| `npm ci` | Pass | | through `kit go` in the worktree |
| `npm test` | Pass | 395 tests: 394 pass, 1 skipped, 0 fail | |
| `kit unit --affected` | Pass | 203/203 in 6 files | |
| `npm run test:electron` | Pass | 6/6, 13 s | includes the startup heal smoke ("a saved place off every screen opens on screen"), which runs main's new `openingCompactBounds` path |
| New tests on the old code | Fail as expected | the Scene session tests for the B1 place fail; `test/overlay-geometry.test.js` fails to import (`openingCompactBounds` does not exist yet) | old `src/` taken from `origin/dev` with `git archive`; two new Scene session tests are guards that pass on both (a place the window does not move to, a change that changes nothing) |
| `git diff --check` | Pass | | |

## Reproduction of B1 on the old code

A probe wired like main (Scene session, geometry, a fake window and screen): a 288 px circle at (400, 500) in an Active Scene, then a toolbar Shape change to landscape.

- Old code: the window lands at (400, 563) to keep its centre, but the Active Scene keeps (400, 500). Applying the Scene again puts the camera 63 px off where it was left.
- New code: the Scene session stores (400, 563) with the Shape change, the Active Scene saves it in the same step, and applying the Scene again opens the camera where it was left (end-to-end test in `test/overlay-geometry.test.js`).

## Manual checks

| ID | Result | Observation/evidence |
| --- | --- | --- |
| Toolbar Shape change, then re-apply the Scene | Not run | covered by the end-to-end unit test and the Electron smoke; no hand check on a real display |

## Regressions and surprises

- None seen. A Shape or size change that lands on a healed (off-screen) place saves the healed place into the Active Scene, since the change is a hand change; a heal on its own still goes to Preferences only (ADR 0038).

## Release decision

- **Decision:** Documentation baseline only
- **Reason:** lands on `dev`; no CamFrame release in this change.
- **Known exceptions accepted by:** none
- **Follow-ups:** none
