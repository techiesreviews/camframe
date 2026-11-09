# Verification run: Scenes tab, focus after Save look and typing a Scene name — 2026-11-09

- **Commit:** built on `dev` at `c4f5bd147d76539d4c2d537ad28a6e5d992c445f`; the final hash is the PR's merge commit on `dev`
- **Version:** 0.8.0 (not released; Lex's go of 2026-11-09 was for `e1794f6`, before this change, so a new test build and a new go are needed before the tag)
- **Observer:** agent (Claude Opus 5.5)
- **Environment:** Linux 7.0 (Wayland with XWayland, display :0), Node 24.22.2, Electron 44.7.0, development checkout; headless Chromium (playwright-core) for `kit shots`
- **Cameras:** none physical; Chromium's synthetic camera in the Electron smoke test
- **Related change/PR:** the PR that carries this file; found by the review of the 0.8.0 release PR #55 (closed without merging, superseded); ADR 0037

## What was wrong

- **Focus after Save look:** `save()` asked for focus on "the active Scene" and drew the tab at once. In Electron `savePreset` is a one-way message, so that draw still saw the Scene that was on camera before, focused it and dropped the request; when the saved Scene arrived, focus did not follow. The browser QA preview hid it, because its fake bridge answers at once.
- **Typing a Scene name:** every key in the name field drew the whole tab again (the typed name was part of the draw key), so a new field replaced the focused one on each key. Focus and caret were put back, but an input method's composition (Chinese, Japanese, Korean) was cancelled and screen readers read the field again after each key.
- **List row focus ring (smaller):** the row clips its overflow, so the Scene button's focus ring, drawn outside the button, was cut off at the top, bottom and right.

## What changed

- After Save look, focus waits for main's answer: the first saved Scene newer than the one known when the save was sent, with the name that was sent, gets focus (`saved-scene`, `src/scenes-panel.js`); the name check keeps an autosave or a Prompter link save arriving in between from taking the focus. A Save look that replaces a Scene with a taken name focuses that Scene.
- The typed name is left out of the draw key; typing updates only the save button in place (enabled, its label, and Replace when the name is taken). While an input method composes, a draw waits for `compositionend`, and keys during composition belong to the input method (Enter does not save, Escape does not close the form or the settings).
- In the list, the Scene button's focus ring sits inside it (`outline-offset: -2px`, `-3px` in high contrast).

## Automated checks

| Command | Result | Counts/duration | Evidence/notes |
| --- | --- | --- | --- |
| Tests first | Pass | | the Scenes tab smoke failed before each fix: "the name field survives typing" (actual false), then, with only the typing fix, "focus follows the saved Scene onto the camera" (actual `apply:starter-big-right`); the CSS contract failed before the focus ring rule |
| `scripts/agents/kit unit` | Pass | 338 pass, 1 skipped (the tag-build check), 16 files | new: list row focus ring contract in `test/overlay-markup.test.js` |
| `npm run test:electron` | Pass | 5/5 | the Scenes tab smoke now saves by keyboard, types a taken name (Replace), clears it, composes "Interview" with composition events (with Enter and Escape sent while composing), checks the same field stays focused throughout, checks focus on the new Scene, then replaces Small bottom by keyboard and checks focus on it. Not covered: a state change from main arriving during composition, and the name check against an autosave racing the save (rare; no test) |
| `scripts/agents/kit shots` | Pass | 25 screenshots | the save form with a taken name shows Replace; high contrast list shows the whole focus ring on the row |
| Syntax checks | Pass | | `node --check` over `src/*.js`, `src/*.cjs` and `scripts/*.mjs` |
| `git diff --check` | Pass | | |

## Build and artifact checks

| Target/check | Result | Artifact/hash/notes |
| --- | --- | --- |
| Manual no-publish Windows build of `dev` after this change | Not run | started after the merge; its run is named in the 0.8.0 records when Lex has tried it |

## Manual checks

| ID | Result | Observation/evidence |
| --- | --- | --- |
| Save look with the keyboard, then see which Scene has focus and is on camera | Not run | for Lex with the new test build |
| Type a long name slowly in the save form | Not run | for Lex with the new test build |
| The eight earlier Scenes tab steps | Not run | for Lex with the new test build |
| Input-method typing (Chinese, Japanese, Korean) on Windows | Not run | composition events are faked in the smoke; no real input method tried |
| W-29 screen reader on the name field | Not run | KG-16 |

## Regressions and surprises

- None in the automated runs.

## Release decision

- **Decision:** Documentation baseline only
- **Reason:** a fix on `dev` before the 0.8.0 release; the release waits for a new test build and Lex's new go
- **Known exceptions accepted by:** none
- **Follow-ups:** the new test build and Lex's three checks; the other review points stay logged (tiles on displays that are not 16:9, KG-16; a long name squeezing the deleted row's Undo; the grid rename row has no Cancel button; blank-looking names; the Full slot's number; the Scenes label read twice)
