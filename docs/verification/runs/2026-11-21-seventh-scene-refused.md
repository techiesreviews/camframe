# Verification run: tools-295 B3, a seventh Scene is refused — 2026-11-21

- **Commit:** the change on branch `build/tools-295-b3-seventh-scene`, on top of `dev` at 880183c (the PR's head commit holds this file)
- **Version:** 0.8.0 (unreleased)
- **Observer:** Claude Opus 5.5 (agent, builder)
- **Environment:** Linux 7.0.0-43-generic, Node 24.22.2, dev (unpackaged)
- **Cameras:** none (unit tests and the browser QA preview only)
- **Related change/PR:** Orbit TOOLS-295, architecture review pick B3

## Automated checks

| Command | Result | Counts/duration | Evidence/notes |
| --- | --- | --- | --- |
| `npm ci` | Pass | | in the worktree, before `kit doctor` |
| `npm test` (`kit unit`) | Pass | 481 tests: 480 pass, 1 skipped, 0 fail | the skipped one is the release Go check, which runs only on a version tag build |
| New tests on the old code | Fail as expected | `saving a new Scene at the Scene limit is refused and never drops the oldest Scene` (the old code made an id for the new Scene and dropped `s0`) and `a seventh Scene is refused: the six Scenes stay and screen readers hear why` | run with only `SCENE_LIMIT_MESSAGE` added, before the refusal |
| `kit shots` | Pass | 25 screenshots, byte for byte the same as before the change | every PNG compared with `cmp` against a run on 880183c; nothing drawn changed, the Scenes tab already showed Full at six |
| `kit ux` | Not run | | the repo has no `docs/agents/features.md` list for it to try |
| `npm run test:electron` | Not run | | it opens camera windows on Lex's screen and is not wrapped by the kit; the change is in the pure Scene library and session, covered by unit tests |
| `git diff --check` | Pass | | |

## What changed for the user

Nothing drawn. Saving a new Scene when six exist no longer drops the oldest Scene: the Scene library refuses it, stores nothing, and screen readers hear "Not saved: CamFrame keeps 6 Scenes. Delete one to save a new one." The Scenes tab already shows Full at six and offers no save form then, so this only happens when a save was sent just before a Prompter link save filled the last slot. Saving over an existing name or ID still works at six.

## Manual checks

| ID | Result | Observation/evidence |
| --- | --- | --- |
| W-19 at six Scenes | Not run | covered by the unit tests; the save tile's Full state is in the preview shots |

## Regressions and surprises

None found.

## Release decision

- **Decision:** Documentation baseline only
- **Reason:** lands on `dev`; no CamFrame release in this change.
