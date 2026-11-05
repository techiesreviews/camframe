# Verification run: Prompter link API 2 on the current dev (feat/prompter-scene-geometry) — 2026-11-05

- **Commit:** 974fe03c178b8914ea3692c3af850bce4b8e4cd3 (all checks below ran at this commit; the commit after it changes only this run file). The earlier fourteen commits are squashed into one and rebased onto `origin/dev` `815cd88` (the land branch, which holds 0.6.1).
- **Version:** 0.6.1 (`package.json`), unreleased change
- **Observer:** Claude (Sonnet 5.5), automated only
- **Environment:** Linux, one display, Node v24.21.0, Electron 44.7.0, development build (as `2026-11-04-prompter-layout-scenes.md`)
- **Cameras:** Chromium's synthetic camera
- **Related change/PR:** ADR 0035 (renumbered from 0034, which dev now uses for the tag hold), KG-14, PR 31

This run replaces the commit, base and version lines of `2026-11-04-prompter-layout-scenes.md` and `2026-11-04-prompter-layout-scenes-review-fixes.md`, which describe the branch before the rebase. Their results still stand: the code did not change in the rebase.

## What changed since the 2026-11-04 runs

- The rebase: docs conflicts with the 0.6.1 release resolved (README baseline stays 0.6.1 with schema 14, the ADR list, KG-13/KG-14, the test counts). ADR 0034 on dev is the tag hold, so this change's ADR is 0035.
- Sixth round: README, guide and spec wording (what the link can do, a bare "small" at the same size does nothing even if dragged off screen); a Full screen cue with `margin` or `withinRight` names the field in its error; the guide's Scene name row and the docs index.
- Fifth `kit pr` round: Full screen right after a move cue returns to the move's target, not the halfway point; a bare "small" that changes nothing no longer moves the camera in Compact mode; the guide and KG-14 say a very large margin at a bottom place may not be met; oversized bodies on the Scene and small-size routes are tested.
- Fourth round: leaving Full screen goes to a position a Scene stored while in Full screen, else to the place the window really had (a hand drag whose `moved` event is late or never comes, as on Linux, is no longer lost; a bare "small" and Escape agree); the Full screen status shows the display bounds also with the onboarding reserve open; Scene names also refuse a joiner at either end and match ignoring joiners, variation selectors and emoji tags, with one shared name rule in `src/scenes.js`.
- Third round: leaving Full screen keeps the place before it after two Scenes; invisible-character Scene names; a static check that the tray and both shortcuts pass the live display to a layout Scene.
- Second round: Scene names refuse control characters and names of only invisible characters; a layout Scene that cannot fit its display answers `clamped: true`.
- First round: a layout Scene that cannot be planned keeps its saved place inside the work area; a cue or Scene also ends a move-drag already under way; hidden characters in Scene names refused.

## Automated checks

| Command | Result | Counts/duration | Evidence/notes |
| --- | --- | --- | --- |
| `npm ci` | Not run | | node_modules already installed in this worktree |
| `npm test` (`scripts/agents/kit unit`) | Pass | 265 pass, 1 skipped (the tag-build check), 14 files | new tests fail without their fix (move-drag, Full screen return and Full screen after a move cue checked) |
| `npm run test:electron` | Pass | 3/3, about 9 s | real Electron on Linux |
| `scripts/agents/kit shots` | Pass | 13 screenshots | |
| `git diff --check` | Pass | | |

## Build and artifact checks

| Target/check | Result | Artifact/hash/notes |
| --- | --- | --- |
| Windows unpacked | Not run | the Windows build is started from `dev` after this lands |
| Windows NSIS | Not run | |
| Windows portable | Not run | |
| macOS arm64 DMG/ZIP | Not run | |
| macOS x64 DMG/ZIP | Not run | |
| ASAR/locales/fonts/permission metadata | Not run | |

## Manual checks

| ID | Result | Observation/evidence |
| --- | --- | --- |
| W-30 | Not run | not in a build on the streaming PC; the API 2 steps are added to its row |
| M-12 | Not run | no macOS build |

## Regressions and surprises

- The Electron smoke fails at once when port 47833 is busy; it failed once here because another agent's prompter test was listening on that port, and passed 3/3 after it stopped.
- Review found that a stored position can be older than the window (the `moved` event is late or never fires on Linux); Full screen now returns to the real window place unless a Scene stored a position in Full screen.
- KG-14 lists what stays open: a Scene cue or a Scene save shows its name on the camera for about 1.6 s, a very large margin at a bottom place may not be met, and Windows/macOS were not checked.

## Release decision

- **Decision:** Documentation baseline only
- **Reason:** automated checks pass on Linux; no build with API 2 has run on Windows or macOS.
- **Known exceptions accepted by:** none yet
- **Follow-ups:** W-30 and M-12 with the API 2 steps, on a build from `dev`; Lex decides when API 2 is released.
