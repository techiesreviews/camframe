# Verification run: feat/prompter-scene-geometry (Prompter link API 2) — 2026-11-04

- **Commit:** `7ee2eca` (base `origin/dev` `622c023`, the land branch)
- **Version:** 0.6.0 (`package.json`), unreleased change
- **Observer:** Claude (Opus 5.5), automated only
- **Environment:** Linux 7.0.0-42-generic, AMD Ryzen 9 8945HS (Radeon 780M), one 2560 × 1440 display, Wayland session with XWayland (`DISPLAY=:0`), Node v24.21.0, npm 9.2.0, Electron 44.7.0, development build (`npm ci` in the worktree)
- **Cameras:** Chromium's synthetic camera (`CAMFRAME_E2E=1`)
- **Related change/PR:** ADR 0035, `docs/prompter-link-api.md`, KG-14

## Automated checks

| Command | Result | Counts/duration | Evidence/notes |
| --- | --- | --- | --- |
| `npm ci` | Pass | 297 packages | |
| `scripts/agents/kit doctor` | Pass | 12/12 | after `npm ci` (Playwright was missing before) |
| `scripts/agents/kit unit` (`npm test` suites) | Pass | 211/211, 13 files | baseline before the change 191/191 |
| `npm run test:electron` | Pass | 3/3, about 12 s | the new smoke: real window bounds for large then small, `preferences.json` after quit, relaunch |
| `scripts/agents/kit shots` | Pass | 13 screenshots | no Overlay UI change; Scenes tab unchanged |
| `git diff --check` | Pass | | |

## What the tests demonstrate

On a simulated 1920 × 1080 display (work area 1920 × 1040, Corner margin 32), through the real HTTP server (`test/prompter-control.test.js`):

1. The original small geometry is read first: `smallSize` 288, camera 288 px, `look.signature` noted.
2. `POST /camframe/scenes {"name":"Live small corner","size":"small","position":"bottom-right"}` saves camera `{x:1600,y:720,width:288,height:288}` without moving the Overlay.
3. `POST /camframe/scenes {"name":"Live right large","size":432,"position":"right","withinRight":0.3}` saves camera `{x:1456,y:304,width:432,height:432}`: 1.5 × 288, inside the right 30% (x ≥ 1344), vertically centred.
4. Cue large, then cue small: the view returns to exactly `{x:1600,y:720,width:288,height:288}`; `smallSize` stays 288; `look.signature` is unchanged after each cue. The older cues `{size:"small",position:"bottom-right"}` and `{size:"small"}` also return 288 px after large; the same holds through Full screen.
5. A 1280 × 720 display clamps the large Scene to 352 px (`clamped: true`), still inside the right 30%; small stays 288.
6. A layout Scene keeps a camera and frame changed after it was saved.
7. With two unrelated Scenes present, four more saves reach six; a seventh is `409 scene-limit` and the six names are unchanged; a duplicate name is `409 scene-exists`; `replace: true` keeps the id and order. Ids stay unique when saved in the same millisecond.
8. The saved Preferences text reloads through `preferencesFromDocument` with all four Scenes, both `layout`s and `prompterSmallSize` 288, and the reloaded large Scene still applies 432 px.

The real-Electron smoke repeats 2–4 against the real BrowserWindow on the 2560 × 1440 display (window bounds equal the status `view`), then quits, finds schema 14, `prompterSmallSize` 288 and `["Demo","Live small corner","Live right large"]` in `preferences.json`, relaunches, and applies both Scenes again with the same bounds and look.

Review findings and their fixes are recorded in `2026-11-04-prompter-layout-scenes-review-fixes.md`.

## Manual checks

| ID | Result | Observation/evidence |
| --- | --- | --- |
| W-30 | Not run | API 2 is not in a build on Lex's Windows streaming PC |
| M-12 | Not run | |

## Regressions and surprises

- Existing cue behaviour changed on purpose: `"small"` (bare or with a place) now uses the small size instead of the current size (ADR 0035). Every ADR 0031 cue shape is still accepted.
- With `margin: 0` the camera stops 18 px from the right edge, because the whole window, with its transparent chrome, stays on screen (unchanged behaviour of `compactPositionAt`).
- No CamFrame was running on this computer (`127.0.0.1:47833` closed). The running livestream app was not touched, restarted or replaced.

## Release decision

- **Decision:** Documentation baseline only
- **Reason:** implemented and tested; not deployed to or verified in the CamFrame used for the livestream.
- **Known exceptions accepted by:** —
- **Follow-ups:** KG-14; W-30 with the two Scenes on the streaming PC after Lex approves installing the new build.
