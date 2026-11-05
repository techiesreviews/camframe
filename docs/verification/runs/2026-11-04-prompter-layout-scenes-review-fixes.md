# Verification run: Prompter link API 2 review fixes — 2026-11-04

- **Commit:** `cd2be44`, `4b7db43`, `f867dc9`, `8784aff`, `65c79e9`, `5617021`, `ee619c9`, `f47cbaf`, `4e91f5e`, `5016947`, `4df10ce`, `1623617` and the thirteenth-review commit after them on `feat/prompter-scene-geometry` (base `origin/dev` `622c023`, the land branch)
- **Version:** 0.6.0 (`package.json`), unreleased change
- **Observer:** Claude (Opus 5.5), automated only
- **Environment:** as `2026-11-04-prompter-layout-scenes.md` (Linux 7.0.0-42, one 2560 × 1440 display, Node v24.21.0, Electron 44.7.0, development build)
- **Cameras:** Chromium's synthetic camera
- **Related change/PR:** ADR 0035 (amended), KG-14

## Review findings fixed

First `kit review` (claude-opus-5-5) on `7ee2eca`, fixed in `cd2be44`:

- `withinRight` counts the 18 px of right chrome that always stays on screen (a margin of 0 could push the camera past the share).
- `GET /camframe/status` gives `Origin: null` only `app`, `version`, `scenes`, `api`.
- A layout Scene saved with `size: "small"` stores `"small"` and follows the small size.
- A fallback apply reports the requested size; docs, glossary and a test name brought up to date.

Second `kit review` on `cd2be44`, fixed in the follow-up:

- Cue answers to `Origin: null` drop `view`, so the display layout cannot be read through a cue.
- A layout Scene without a place, and an exact point, plan on the display nearest the point and stay on screen there (a grown small size or an unplugged display no longer puts the window off screen).
- A corner dragged out and back sets the small size to the size let go at (compared with the previous poll, not the start).
- ADR 0035 marked amended; this separate run file instead of overwriting the first.

Third `kit review` on `4b7db43`, fixed in the next commit:

- Cue answers to `Origin: null` also drop `layout` (how far a size shrank revealed the display size): only `ok` and `cue`.
- The status and reply `view.workArea` follow the display the window is heading to (`workAreaFor(target)`), so a cue to another display reports that display at once.
- Only a pointer that has moved since the press sets the small size by hand; a cue changing the size while a corner is only held does not.
- ADR 0035, CONTEXT and the API guide state the display rule: a place on the Overlay's display, no place on the display nearest the saved point.

Fourth `kit review` on `f867dc9`, fixed in the next commit:

- A place cue, and a layout Scene, plan on the display the window is heading to (`currentWorkArea` follows the animation target), matching the reported `view.workArea`.
- A held corner reports no resize at all until the pointer moves, so a cue's size is not undone (the test now checks the size too).
- `does-not-fit` refusals to `Origin: null` carry no share or margin; ADR 0035 records the remaining accepted one-bit signal.

Fifth `kit review` on `8784aff`, fixed in `65c79e9`:

- A held corner takes a fresh starting size and place on every poll until the pointer moves, so a drag after a cue starts from the cue's size (432 + 5 px gives 437, not about 305).
- The held-corner test now drives the cue through the geometry and checks the window width; new tests for a layout Scene applied mid-move and the work area while leaving Full screen.
- Glossary, API guide and a code comment use the "on or heading to" display wording.

Sixth `kit review` on `65c79e9`, fixed in `5617021`:

- The held-corner and mid-move geometry tests drive the paths they name: a cue while a corner is only held keeps the cue size, a drag that starts while a cue is still moving the window starts from where it is heading, and leaving Full screen for another display reports that display's work area.
- ADR 0035 status, this run file and a code comment brought up to date.

Seventh `kit review` (the first `kit pr` review of PR #31, on `5617021`), fixed in `ee619c9`:

- A bare `"small"` cue from Full screen is planned like one in Compact mode (`place()`), so a small size grown past the space left of or under the old place no longer leaves the window off screen, and `layout.clamped` is truthful.
- `sceneDetails[].position` for a Scene without a place is the camera's top-left point (the form a cue's point takes), not the window's; `savedPosition` stays the window's.
- Glossary (Active Scene), a module header, two layout comments, the verification coverage row, the API guide sample version and the architecture row brought in line with the code.
- New tests: Full screen bare `"small"` after `small-size` 400 (and 640 on a small display, clamped), a point Scene's reported position, saving over a layout Scene from Inline settings; the Electron smoke now also applies the large Scene through the bridge (`applyPreset`, the Inline settings, tray and shortcut path) after a look change and checks the real window bounds and that the look stayed.

Eighth `kit review` (the second `kit pr` review, on `ee619c9`), fixed in `f47cbaf`:

- A bare `"small"` back from Full screen to the same size and place keeps the Active Scene again (the first fix had cleared it); tests for that, for `small-size` while the small Scene is active, the renderer unable to set `prompterSmallSize`, and main's hand-resize wiring (static check); the smoke's reads after the relaunch wait for `settled`; the `Origin: null` save refusal names sandboxed frames too.

Ninth `kit review` (the third `kit pr` review, on `f47cbaf`), fixed in `4e91f5e`:

- The `does-not-fit` refusal names the gap really used at the right edge (at least the 18 px of chrome), not the margin asked for.
- The Electron smoke re-reads the status every 50 ms until `view.settled` (3 s limit) instead of one read after a fixed 400 ms.
- ADR 0035's status line no longer lists review history; the rules it named are in its Decision list. This run file names every earlier commit.
- New tests: portrait and landscape cameras against the right 30% (largest size that fits, vertical centring), a circle layout Scene applied with a landscape live shape, and the refusal text with a 0 margin.

Tenth `kit review` (the fourth `kit pr` review, on `4e91f5e`), fixed in `5016947`:

- With no stored position (for example after applying a Scene saved without one), a bare `"small"` from Full screen went to the work area's bottom-right corner instead of back where the Overlay was, and cleared the Active Scene; this came in with the `ee619c9` fix. The geometry now reports where Full screen returns to (`fullscreenReturnBounds()`: the stored position, else the place before Full screen), and the control plans the cue, the same-place check and a `"current"` Scene save from it.
- The `prompter-link.js` header names `prompter-control.js` as the module that acts on requests.
- New tests: Full screen then bare `"small"` with no stored position returns to the same window place and keeps the Active Scene; a `"current"` Scene save from Full screen saves the place Full screen returns to (both failed before the fix).

Eleventh `kit review` (the fifth `kit pr` review, on `5016947`), fixed in `4df10ce`:

- With two displays, after the tray or a shortcut applied a Scene from another display while in Full screen, a bare `"small"` planned on the Full screen display and clamped the camera to its edge (and cleared the Active Scene). A bare size, and a `"current"` Scene save, now plan on the display of the place the camera keeps (`workAreaFor` of the reference bounds); a place name still plans on the display the Overlay is on or heading to.
- The data contract and KG-14 say that an older build that saves drops `layout` and `prompterSmallSize` (layout Scenes become snapshot Scenes, the small size resets), instead of "ignores".
- The API guide's sample Scene save answer has `followsSmallSize`.
- New tests: the two-display Full screen case (failed before the fix), and the cycle and numbered-shortcut paths applying a layout Scene on a work area with the live look kept.

Twelfth review (the sixth `kit pr` review by Claude, and Grok's second look, on `4df10ce`), fixed in `1623617`:

- Grok P1: a corner drag started while a cue was still moving the window saved the dragged size while the move then painted the cue's size. When the pointer first moves, a running move now ends at its target and the drag starts from there.
- Claude P3: a cue during a drag already under way was undone by the drag, which then saved its own size as the small size. A Scene or cue moving the window (`showScene`, `showCompact`) now ends such a drag; a corner only held keeps waiting.
- Grok P2: a Scene with a place applied from the tray or a shortcut in Full screen is now where Escape lands (the saved pre-Full-screen base is dropped, as `showCompact` already did).
- Grok P2: left, right and center cap the size so the centred camera leaves room for the 84 px top chrome on a short screen (on a 1366 × 768 work area of 728 px the camera was about 33 px below centre).
- Grok P2: Face small's default reads "Small size, where it was"; the README cheat sheet explains the stored small size and points at the API guide for the two livestream layouts.
- Grok P2 (hand resize leaves the Active Scene marked): older behaviour, not changed; recorded in KG-14.
- Claude and Grok: the data contract names the three display rules and the `403` for `Origin: null` on both saving routes.
- New tests (each failed before the fix): drag let go during a cue move, cue during a drag, Scene in Full screen then leaving it, centring on a short screen.

Thirteenth review (the seventh `kit pr` review by Claude, on `1623617`; the second look could not run: Grok's weekly budget was used up and the OpenCode fallback failed), fixed in the next commit:

- The Face small default "Small size, where it was" was cut off at the default Overlay size (it showed "Small size, whe" in `kit shots`); it now reads "Same place", which fits (the field is already called Face small; the README and product spec explain the stored small size).
- The README `[Face: Demo]` row says a layout Scene keeps the camera's current look.
- The does-not-fit refusal reads "… (180 px) and the 18 px gap at the right edge" (no "a 18").
- New tests: Face small set to a place after the large layout, and Face full set to a layout Scene. Both behaviours were already right, so the tests pass on `1623617` too; each fails when its branch in `cueAction` is removed.

## Automated checks

| Command | Result | Counts/duration | Evidence/notes |
| --- | --- | --- | --- |
| `scripts/agents/kit unit` | Pass | 249/249, 13 files after the thirteenth review (221 at `4b7db43`, 225 at `f867dc9`, 228 at `8784aff`, 231 at `65c79e9`, 232 at `5617021`, 235 at `ee619c9`, 237 at `f47cbaf`, 239 at `4e91f5e`, 241 at `5016947`, 243 at `4df10ce`, 247 at `1623617`) | new: hold/drag/drag-back resize, null-origin status and cue reply, small Scene after `small-size` 260, tiny-display fallback, no-place Scene on screen, point on a second display, `layout.size` fixtures; then a cue to another display's point, an unplugged display, a held corner during a cue, `layoutSceneGeometry` with and without `workAreaAt`; then a place cue mid-move to another display, `workAreaFor`, the null-origin does-not-fit text; then a drag starting from a cue's size (also mid-move), a layout Scene applied mid-move, the work area while leaving Full screen for another display |
| `npm run test:electron` | Pass | 3/3, about 9 s (run again after the third- and seventh- to twelfth-review fixes) | the smoke now also asserts both Scenes' `layout` in `preferences.json` after a real quit |
| `scripts/agents/kit shots` | Pass | 13 screenshots (at `1623617` and after the label change) | Inline settings → Scenes with the Prompter link on at the default 324 × 390 Overlay: "Small size, where it was" was cut off at `1623617`; "Same place" fits. `.scratch/shots/` (not committed) |
| `git diff --check` | Pass | | |

## Manual checks

| ID | Result | Observation/evidence |
| --- | --- | --- |
| W-30 | Not run | not in a build on the streaming PC |

## Release decision

- **Decision:** Documentation baseline only
- **Reason:** implemented and tested; not deployed to or verified in the CamFrame used for the livestream.
