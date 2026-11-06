# Verification run: silent Scenes (fix/silent-prompter-scenes) — 2026-11-06

- **Commit:** 7246795e83ba9c75e0d2a9b7a2e36e37a95d06c9 (checks ran at this commit; the commit after it changes only this run file)
- **Version:** 0.6.1 (`package.json`), unreleased change
- **Observer:** Claude (Sonnet 5.5), automated only
- **Environment:** Linux, one display, Node v24.21.0, Electron 44.7.0, development build
- **Cameras:** Chromium's synthetic camera
- **Related change/PR:** Lex's answer of 2026-11-06 to the API 2 questions; KG-14

Applying a Scene (Prompter cue, tray, shortcut, Inline settings) and saving one (Prompter or Inline settings) no longer show the Scene's name on the camera. The notice is drawn inside the Overlay, which is what gets captured on stream, so it is removed for hand use too (not sure it is excluded from the capture). Other notices stay. The large-corner-margin edge case stays as it is (listed in KG-14).

## Automated checks

| Command | Result | Counts/duration | Evidence/notes |
| --- | --- | --- | --- |
| `scripts/agents/kit unit` | Pass | 266 pass, 1 skipped (the tag-build check) | `test/prompter-control.test.js` asserts no notice for a Scene save, save-and-apply and two Scene cues; `test/scenes.test.js` asserts none for save and apply |
| `npm run test:electron` | Pass | 3/3 | real Electron on Linux |

## Build and artifact checks

| Target/check | Result | Artifact/hash/notes |
| --- | --- | --- |
| Windows portable | Not run | built from `dev` after this lands |

## Manual checks

| ID | Result | Observation/evidence |
| --- | --- | --- |
| W-30 | Not run | not in a build on the streaming PC |

## Regressions and surprises

None observed.

## Release decision

- **Decision:** Documentation baseline only
- **Reason:** automated checks pass on Linux; no Windows or macOS run.
- **Known exceptions accepted by:** none
- **Follow-ups:** W-30 with the API 2 steps on a build from `dev`.
