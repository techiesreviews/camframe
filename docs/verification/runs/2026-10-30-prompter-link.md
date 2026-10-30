# Verification run: feature/camframe-link (Prompter link) — 2026-10-30

- **Commit:** the `feature/camframe-link` commit that adds this file (base `6861660`, `origin/main`)
- **Version:** 0.5.1 + unreleased Prompter link
- **Observer:** Claude (Opus 5.5) as builder agent; no human observation yet
- **Environment:** Linux 7.0 (Wayland/Xwayland `:0`), Node 24.21.0; Electron 44.7.0 (the pinned version, from `npm ci` in the worktree). The first round ran the smoke on Electron 43.2.0 borrowed from the main checkout; this round replaces that evidence.
- **Cameras:** Chromium fake capture device (`CAMFRAME_E2E`), no real camera
- **Related change/PR:** none yet (not pushed); ADR 0031

## Automated checks

| Command | Result | Counts/duration | Evidence/notes |
| --- | --- | --- | --- |
| `npm ci` | Pass | | Worktree's own `node_modules`: Electron 44.7.0, `playwright-core` 1.63.0 |
| `scripts/agents/kit unit` (= `node --test`) | Pass | 176 tests, 11 files | `.scratch/unit/` log; new `test/prompter-link.test.js`, Prompter link cases in `overlay-geometry`, `overlay-markup`, Preferences fixtures. Review round: a move during the Full screen exit, a Scene with and without a position from Full screen, on/off in one tick (real port and a late-binding fake server), `Origin: null` and `Host: localhost:<port>` through the server |
| `npm run test:electron` (both smokes) | Pass | 2 tests, ~5.1 s | Electron 44.7.0. Prompter link smoke: status lists Scenes; `{size:"full"}` → display bounds; `{size:"small",position:"bottom-right"}` → camera 40 px from the work-area corner; `{scene:"demo"}` → Scene bounds and active Scene `preset-demo`; `{size:"small",position:"top-left"}` → active Scene cleared and the new position in `getState()` and saved `preferences.json`; unknown Scene 404; turning the link off closes the port. With port 47833 held by another listener it fails at once with "Port 47833 is busy". Screenshot `qa/electron-smoke/04-prompter-bottom-right.png` (ignored) |
| `scripts/agents/kit shots` | Pass | 6 screenshots | Inline settings → Scenes: link off, on, busy port, at 324x390 and 324x820 (browser QA fake); Playwright from the repo's own `playwright-core` |
| Syntax checks | Pass | | `node --check` on `src/*.js`, `scripts/*.mjs`, `src/preload.cjs`, `scripts/agents/project.d/shots` |
| `git diff --check` | Pass | | |

## Build and artifact checks

Not run: no packaging change.

## Manual checks

| ID | Result | Observation/evidence |
| --- | --- | --- |
| W-30 Prompter link on Windows with Chrome and Edge | Not run | See KG-13 |
| M-12 Prompter link on macOS with Chrome and Safari | Not run | See KG-13 |
| Multi-monitor corner placement on real hardware | Not run | Covered by unit tests with displays left of and above the primary one only |

## Regressions and surprises

- Review round (2026-10-30): a burst of cues during the 280 ms Full screen exit could leave a stale saved Compact base (the replaced animation's finishing step was dropped); a Scene without a position applied from Full screen went to the display's corner; turning the link on and off in one tick could leave a listener on Node versions that bind after an early `close()` (Node 22.22 and 24.21 here do not, so the test models it with a fake server). All three are fixed and covered.
- The previously defined `showScene()` behaviour is unchanged (Scenes applied by shortcut in Full screen still keep Full screen); only Prompter link cues use the new `showCompact()`.

## Release decision

- **Decision:** Documentation baseline only
- **Reason:** Feature branch; manual Windows/macOS checks outstanding.
- **Known exceptions accepted by:** —
- **Follow-ups:** KG-13
