# Verification run: Prompter link API 2 on the current dev — 2026-11-05

- **Commit:** `ca8abf2` on `feat/prompter-scene-geometry` (all checks below ran at this commit; the commits after it change only this run file; the earlier fourteen commits are squashed into one and rebased onto `origin/dev` `815cd88`, the land branch, which holds 0.6.1)
- **Version:** 0.6.1 (`package.json`), unreleased change
- **Observer:** Claude (Sonnet 5.5), automated only
- **Environment:** as `2026-11-04-prompter-layout-scenes.md` (Linux, one display, Node v24.21.0, Electron 44.7.0, development build)
- **Related change/PR:** ADR 0035 (renumbered from 0034, which dev now uses for the tag hold), KG-14, PR 31

This run replaces the commit, base and version lines of `2026-11-04-prompter-layout-scenes.md` and `2026-11-04-prompter-layout-scenes-review-fixes.md`, which describe the branch before the rebase. Their results still stand: the code did not change in the rebase.

## What changed since the 2026-11-04 runs

- The rebase: docs conflicts with the 0.6.1 release resolved (README baseline stays 0.6.1 with schema 14, the ADR list, KG-13/KG-14, the test counts). ADR 0034 on dev is the tag hold, so this change's ADR is 0035.
- Fourth `kit pr` round: leaving Full screen goes to a position a Scene stored while in Full screen, else to the place the window really had (a hand drag whose `moved` event is late or never comes, as on Linux, is no longer lost; a bare "small" and Escape agree); the Full screen status shows the display bounds also with the onboarding reserve open; Scene names also refuse a joiner at either end and match ignoring joiners, variation selectors and emoji tags, with one shared name rule in `src/scenes.js`; the guide lists `422` for a Scene save.
- Third `kit pr` round: leaving Full screen goes to a stored position, else to the place before Full screen, also after two Scenes were applied in Full screen; Scene names refuse every invisible character except joiners, variation selectors and emoji tags, and match across composed and decomposed accents; a static check that the tray and both shortcuts pass the live display to a layout Scene; the guide lists invalid JSON and unknown path as refusals without a `code`.
- Second `kit pr` round: Scene names refuse control characters, line breaks and names of only invisible characters or spaces (Hangul filler, braille blank, zero-width), but accept joiners inside a name (emoji, Persian); a layout Scene that cannot fit its display answers `clamped: true`; two caller-map rows corrected.
- First `kit pr` review fixes: a layout Scene that cannot be planned keeps its saved place inside the work area; a cue or Scene now also ends a move-drag that is already under way; Scene names with line breaks, control or zero-width characters are refused (`400`); the guide, spec, caller map, W-30 steps and KG-14 brought up to date (including that a Scene cue shows the Scene's name for about 1.6 s).

## Automated checks

| Command | Result | Counts/duration | Evidence/notes |
| --- | --- | --- | --- |
| `scripts/agents/kit unit` | Pass | 263 pass, 1 skipped (the tag-build check), 14 files | new tests fail without their fix (move-drag and Full screen return checked) |
| `npm run test:electron` | Pass | 3/3, about 9 s | real Electron on Linux |
| `scripts/agents/kit shots` | Pass | 13 screenshots | |

## Manual checks

| ID | Result | Observation/evidence |
| --- | --- | --- |
| W-30 | Not run | not in a build on the streaming PC; the API 2 steps are added to its row |
