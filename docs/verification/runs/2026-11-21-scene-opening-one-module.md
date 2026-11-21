# Verification run: tools-295-b2 scene opening, one module — 2026-11-21

- **Commit:** the change on branch `build/tools-295-b2-layout-request`, on top of `dev` at f0378f8 (the PR's head commit holds this file)
- **Version:** 0.8.0 (unreleased)
- **Observer:** Claude Opus 5.5 (agent, builder)
- **Environment:** Linux 7.0.0-43-generic, Node 24.22.2, dev (unpackaged)
- **Cameras:** none (unit tests only)
- **Related change/PR:** Orbit TOOLS-295, architecture review job B2 (one layout-request module for Scene tiles and apply)

## Automated checks

| Command | Result | Counts/duration | Evidence/notes |
| --- | --- | --- | --- |
| `npm ci` | Pass | | in the worktree, before `kit doctor` |
| `npm test` | Pass | 432 tests: 431 pass, 1 skipped, 0 fail | |
| New tests on the old code | Fail as expected | `test/layout-request.test.js` and `test/scenes.test.js` fail to import (`src/layout-request.js` does not exist yet); "a layout Scene that opens shrunk names the size it really opens at" and "Scene tiles are fitted to the same displays as applying a Scene" fail | whole `origin/dev` tree from `git archive`, with this branch's `test/` folder |
| `kit shots` | Pass | 25 screenshots | the browser QA preview's Scenes tab (grid, list, six Scenes, empty, high contrast) draws every tile; the preview's Scene context now carries `workAreas` like main's, so its tiles and applies use the same displays. Its Scenes all sit on its one display, so the shots look as before |
| `npm run test:electron` | Not run | | the brief says not to run the Electron smoke on Lex's screen |
| `git diff --check` | Pass | | |

## What changed for the user

Before this change a Scene tile used the raw saved place, while applying the Scene kept a place whose display is gone on screen (ADR 0038). The Scenes tab also named the size a layout Scene asked for, not the size it shrinks to on a small display.

- Old code: a snapshot Scene saved at (2500, 300) on a second display that is gone draws its tile from the raw saved place; applying it opens at x 1596 on the display that is left.
- New code: the tile and applying both use `sceneOpening()`, so the tile shows the camera at x 1596. A layout Scene asking 640 px on a 1280 x 680 laptop names 578 px, the size it opens at.

Applying a Scene, Prompter cues and layout Scene saves behave as before (ADR 0035, ADR 0038); the same tests pass, and the new table in `test/layout-request.test.js` checks that the opening, the applied settings and the tile agree for nine Scenes, including the tile's shape. One more test plugs and unplugs a display left of and above the main one (negative coordinates): the tile follows applying, and the Scene keeps its own place for when the display comes back. Main now starts a Scene's move before it sends the tiles, and sends them again after a Prompter request, so after a Scene moves the Overlay to a smaller display the tab names the size a layout Scene opens at there (found by the GPT second look on the PR; a Prompter link test checks the tiles mid-move against the next apply). A display plugged in or out also sends the tiles again, so a Scene saved on an unplugged display shows its new spot at once (second look, round 2), and so does a place the window reaches by itself, such as the heal when the display a Scene was moving to is unplugged mid-move (second look, round 3; a Prompter link test unplugs it mid-move and checks the tiles after the heal against the next apply).

## Manual checks

| ID | Result | Observation/evidence |
| --- | --- | --- |
| Scene tile for a Scene saved on an unplugged display | Not run | covered by the unit tests; needs a second display to check by hand |

## Regressions and surprises

None found.

## Release decision

- **Decision:** Documentation baseline only
- **Reason:** lands on `dev`; no CamFrame release in this change.
- **Known exceptions accepted by:** none
- **Follow-ups:** none
