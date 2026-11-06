# Verification run: silent Scenes (fix/silent-prompter-scenes) — 2026-11-06

- **Commit:** 79e61f9b95c63d183dc0709b5d7da2591f889fb7 (checks ran at this commit; the commit after it changes only this run file)
- **Version:** 0.6.1 (`package.json`), unreleased change
- **Observer:** Claude (Sonnet 5.5), automated only
- **Environment:** Linux, one display, Node v24.21.0, Electron 44.7.0, development build
- **Cameras:** Chromium's synthetic camera
- **Related change/PR:** Lex's answer of 2026-11-06 to the API 2 questions; KG-14

Applying a Scene (Prompter cue, tray, shortcut, Inline settings) and saving one (Prompter or Inline settings) no longer show the Scene's name on the camera. The notice is drawn inside the Overlay, which is what gets captured on stream, so it is removed for hand use too (Unverified: whether a capture setup could leave it out; ADR 0036). Screen readers still hear the name through a hidden live region. Other notices stay. The large-corner-margin edge case stays as it is (listed in KG-14).

## Automated checks

| Command | Result | Counts/duration | Evidence/notes |
| --- | --- | --- | --- |
| `npm ci` | Not run | | node_modules already installed |
| `scripts/agents/kit unit` | Pass | 266 pass, 1 skipped (the tag-build check) | `test/prompter-control.test.js` asserts no notice for a Scene save, save-and-apply and two Scene cues; `test/scenes.test.js` asserts none for save and apply |
| `npm run test:electron` | Pass | 3/3 | real Electron on Linux (first try failed because another agent held port 47833; passed when it stopped) |
| `scripts/agents/kit shots` | Pass | 13 screenshots | |
| `git diff --check` | Pass | | |

`test/overlay-markup.test.js` checks the hidden announcer (role, `aria-live`, 1 px clipped, written from the `onSceneAnnouncement` event); the third Electron smoke checks the toast stays hidden and the announcer holds the Scene name after a Scene is applied.

## Build and artifact checks

| Target/check | Result | Artifact/hash/notes |
| --- | --- | --- |
| Windows portable | Not run | built from `dev` after this lands |

## Manual checks

| ID | Result | Observation/evidence |
| --- | --- | --- |
| W-20 | Not run | expected result changed: no Scene name on the camera |
| W-29 | Not run | NVDA reads the Scene name from the hidden announcer |
| M-11 | Not run | same with VoiceOver |
| W-30 | Not run | not in a build on the streaming PC; new step: no name in the capture |

## Regressions and surprises

None observed.

## Release decision

- **Decision:** Documentation baseline only
- **Reason:** automated checks pass on Linux; no Windows or macOS run.
- **Known exceptions accepted by:** none
- **Follow-ups:** W-20, W-29, M-11 and W-30 with the API 2 steps on a build from `dev`.
