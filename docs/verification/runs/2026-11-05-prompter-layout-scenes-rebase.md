# Verification run: Prompter link API 2 on the current dev — 2026-11-05

- **Commit:** `c8d351c` on `feat/prompter-scene-geometry` (the earlier fourteen commits squashed into one and rebased onto `origin/dev` `815cd88`, the land branch, which holds 0.6.1)
- **Version:** 0.6.1 (`package.json`), unreleased change
- **Observer:** Claude (Sonnet 5.5), automated only
- **Environment:** as `2026-11-04-prompter-layout-scenes.md` (Linux, one display, Node v24.21.0, Electron 44.7.0, development build)
- **Related change/PR:** ADR 0035 (renumbered from 0034, which dev now uses for the tag hold), KG-14, PR 31

This run replaces the commit, base and version lines of `2026-11-04-prompter-layout-scenes.md` and `2026-11-04-prompter-layout-scenes-review-fixes.md`, which describe the branch before the rebase. Their results still stand: the code did not change in the rebase.

## What changed since the 2026-11-04 runs

- The rebase: docs conflicts with the 0.6.1 release resolved (README baseline stays 0.6.1 with schema 14, the ADR list, KG-13/KG-14, the test counts). ADR 0034 on dev is the tag hold, so this change's ADR is 0035.
- First `kit pr` review fixes: a layout Scene that cannot be planned keeps its saved place inside the work area; a cue or Scene now also ends a move-drag that is already under way; Scene names with line breaks, control or zero-width characters are refused (`400`); the guide, spec, caller map, W-30 steps and KG-14 brought up to date (including that a Scene cue shows the Scene's name for about 1.6 s).

## Automated checks

| Command | Result | Counts/duration | Evidence/notes |
| --- | --- | --- | --- |
| `scripts/agents/kit unit` | Pass | 258 pass, 1 skipped (the tag-build check), 14 files | three new tests fail without their fix (move-drag checked) |
| `npm run test:electron` | Pass | 3/3, about 9 s | real Electron on Linux |
| `scripts/agents/kit shots` | Pass | 13 screenshots | |

## Manual checks

| ID | Result | Observation/evidence |
| --- | --- | --- |
| W-30 | Not run | not in a build on the streaming PC; the API 2 steps are added to its row |
