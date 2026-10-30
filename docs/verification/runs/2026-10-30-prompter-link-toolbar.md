# Verification run: feature/camframe-link (Prompter link toolbar button and settings restyle) — 2026-10-30

- **Commit:** `82a6fcf` (toolbar button, settings restyle, switches) and the review-fix commit that adds this file, on top of `bf397e8` (base `6861660`, `origin/main`)
- **Version:** 0.5.1 + unreleased Prompter link
- **Observer:** Claude (Opus 5.5) as builder agent; Lex reported earlier the same day that the link itself works on his Windows PC (browser, prompts and display layout not recorded)
- **Environment:** Linux 7.0 (Wayland/Xwayland `:0`), Node 24.21.0; Electron 44.7.0 (worktree's own `node_modules`)
- **Cameras:** Chromium fake capture device (`CAMFRAME_E2E`), no real camera
- **Related change/PR:** none yet (not pushed); ADR 0032; review `20261030T214016Z` under `.scratch/reviews/feature/camframe-link/` in the main checkout

## Automated checks

| Command | Result | Counts/duration | Evidence/notes |
| --- | --- | --- | --- |
| `scripts/agents/kit doctor` | Pass | 12/12 | |
| `scripts/agents/kit unit` (= `node --test`) | Pass | 186 tests, 12 files | `.scratch/unit/` log. New: `test/prompter-link-view.test.js` (off always reads off, on never does, starting/ready/problem text and titles, no "undefined" without a port); markup: toolbar order and button attributes, the `ph-scroll` mapping, both controls sending `prompterLink`, every checkbox a `role="switch"`, high-contrast focus and icon rules |
| `npm run test:electron` (both smokes) | Pass | 2 tests, ~4.4 s | The Prompter link smoke now flips the link from the toolbar button (off: port refused; on: status 200), double-clicks it before main answers (ends on), and turns it off from the settings switch; each time `aria-pressed`, the button's link state and the switch agree. The double click times out on `82a6fcf`'s click handler (fixed in the review-fix commit) |
| `scripts/agents/kit shots` | Pass | 13 screenshots | `.scratch/shots/2026-10-30T21-44-05-977Z/`: settings off/on/busy at 324x390 and 324x820, on/busy in forced colors, the Camera tab switches, toolbar button off/on (from the keyboard)/busy at 2x; checks the button and switch agree both ways, all six buttons fit at 36 px in the default Overlay, keyboard focus on the switch is visible in forced colors (fails without the review fix), and a Corner margin update keeps the Face full choices |
| Onboarding look | Pass | | QA preview `?state=onboarding`: the coach mark arrows still point at Settings and Shape with six buttons |
| `git diff --check`, `node --check` | Pass | | |

## Build and artifact checks

| Command | Result | Notes |
| --- | --- | --- |
| `npx electron-builder --win portable --publish never` | Pass | `dist/CamFrame-Portable-0.5.1-Windows-x64.exe` (unsigned test build); its `app.asar` holds the toolbar button, the `ph-scroll` glyph mapping, `src/prompter-link-view.js` and the double-click fix |

## Manual checks

| ID | Result | Observation/evidence |
| --- | --- | --- |
| W-30 Prompter link on Windows, including the toolbar button | Not run by the builder | Lex tests the portable build; see KG-13 |

## Regressions and surprises

- Found by review and fixed: a quick second click on the toolbar button before main answered repeated the first request, so the link stayed on; the button now flips its own pending request.
- Found while checking: in high contrast, keyboard focus was invisible on toolbar buttons, tabs, selects and switches (a control rule's `outline: 0` outranked the focus rule), and pressed toolbar buttons showed no icon (forced colors painted a Canvas backplate behind the white glyph). Both predate this branch for the existing controls; both are fixed.
- Still in high contrast, the sliders' tracks are not drawn (existing, not changed here).

## Release decision

- **Decision:** Documentation baseline only
- **Reason:** Feature branch; Lex's Windows check of the portable build is outstanding.
- **Known exceptions accepted by:** —
- **Follow-ups:** KG-13
