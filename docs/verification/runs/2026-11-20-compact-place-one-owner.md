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
| `npm test` | Pass | 402 tests: 401 pass, 1 skipped, 0 fail | |
| `kit unit --affected` | Pass | 210/210 in 6 files | |
| `npm run test:electron` | Pass | 7/7, 14 s | includes the startup heal smoke ("a saved place off every screen opens on screen"), which runs main's new `openingCompactBounds` path, and the new B1 smoke (a circle Scene changed to Wide saves the native window's place and opens there again) |
| New B1 smoke on the old code | Fails as expected | 1/1 fails at "Desk saved the place the window landed on" | whole `origin/dev` tree from `git archive`, with this branch's `scripts/electron-smoke.mjs` |
| New tests on the old code | Fail as expected | the Scene session tests for the B1 place fail; `test/overlay-geometry.test.js` fails to import (`openingCompactBounds` does not exist yet) | old `src/` taken from `origin/dev` with `git archive`; two new Scene session tests are guards that pass on both (a place the window does not move to, a change that changes nothing). The tests for a Scene shown away from its saved place (a display gone, a startup heal) and a Scene without a place were added in review rounds 3 and 4 and fail on the round-2 commit 005b29f, which saved the live laptop place into such a Scene. The onboarding Shape demo test was added in round 5 and fails on the round-4 commit b8a43c4 (Desk saved (400, 437) instead of (400, 500)). The test for a larger Desk imported over the Active Scene was added after the final review and fails on 67acc83 (Desk saved (1120, 320) instead of (1000, 200)) |
| `git diff --check` | Pass | | |

## Reproduction of B1 on the old code

A probe wired like main (Scene session, geometry, a fake window and screen): a 288 px circle at (400, 500) in an Active Scene, then a toolbar Shape change to landscape.

- Old code: the window lands at (400, 563) to keep its centre, but the Active Scene keeps (400, 500). Applying the Scene again puts the camera 63 px off where it was left.
- New code: the Scene session stores (400, 563) with the Shape change, the Active Scene saves it in the same step, and applying the Scene again opens the camera where it was left (end-to-end test in `test/overlay-geometry.test.js`).

## Manual checks

| ID | Result | Observation/evidence |
| --- | --- | --- |
| Toolbar Shape change, then re-apply the Scene | Not run | covered by the end-to-end unit test and the seventh Electron smoke; no hand check by a person |

## Regressions and surprises

- Older behaviour, not changed here: a Shape or size change made while a Scene's move animation runs (about 0.3 s after the Scene goes on camera) is stored, but the window keeps its old bounds until the next placement; the new smoke waits for the move to end. Recorded as KG-18 in `docs/known-gaps.md`.
- A Shape or size change on a Scene shown at its saved place, whose new size would go off screen, saves the place the window is kept to into the Active Scene, since the change is a hand change; a heal on its own still goes to Preferences only (ADR 0038).
- A Shape or size change on a Scene shown away from its saved place (its display gone, Desk applied after a startup heal, or an onboarding Shape demo) keeps the Scene's own place, moved to keep the Scene's own centre (measured with its saved Shape and size), so the Scene opens on its own display again when it comes back; a Scene saved without a place keeps none (review round 3).

## Release decision

- **Decision:** Documentation baseline only
- **Reason:** lands on `dev`; no CamFrame release in this change.
- **Known exceptions accepted by:** none
- **Follow-ups:** KG-18 (a Shape or size change during a Scene's move animation)
