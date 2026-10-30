# Verification run: feature/camframe-link (Prompter link, review fixes) — 2026-10-30

- **Commit:** the `feature/camframe-link` commit that adds this file, on top of `c632636` (base `6861660`, `origin/main`); covers both review rounds after `e9f9aa8` (first run: `2026-10-30-prompter-link.md`)
- **Version:** 0.5.1 + unreleased Prompter link
- **Observer:** Claude (Opus 5.5) as builder agent; no human observation yet
- **Environment:** Linux 7.0 (Wayland/Xwayland `:0`), Node 24.21.0; Electron 44.7.0 (the pinned version, from `npm ci` in the worktree, not borrowed)
- **Cameras:** Chromium fake capture device (`CAMFRAME_E2E`), no real camera
- **Related change/PR:** none yet (not pushed); ADR 0031; reviews under `.scratch/reviews/feature/camframe-link/` in the main checkout (`20261030T162956Z`, `20261030T163722Z`)

## Automated checks

| Command | Result | Counts/duration | Evidence/notes |
| --- | --- | --- | --- |
| `npm ci` | Pass | | Worktree's own `node_modules`: Electron 44.7.0, `playwright-core` 1.63.0 |
| `scripts/agents/kit doctor` | Pass | 12/12 | Playwright from the repo's own `playwright-core` (no machine paths in `kit.json`) |
| `scripts/agents/kit unit` (= `node --test`) | Pass | 178 tests, 11 files | `.scratch/unit/` log. New: a move during the Full screen exit (no stale Compact base), a Scene with and without a position from Full screen and a positionless Scene during the exit, on/off in one tick (real port, and a fake server that binds late), on → off → on before the port opens (one server), `Origin: null` and `Host: localhost:<port>` through the server. Each new geometry and lifecycle test fails on the code before its fix |
| `npm run test:electron` (both smokes) | Pass | 2 tests, ~5.3 s | Prompter link smoke: status lists Scenes; `{size:"full"}` → display bounds; `{size:"small",position:"bottom-right"}` → camera 40 px from the work-area corner; `{scene:"demo"}` → Scene bounds and active Scene `preset-demo`; `{size:"small",position:"top-left"}` → active Scene cleared, new position in `getState()` and in the saved `preferences.json`; unknown Scene 404; off closes the port. With port 47833 held by another listener it fails at once with "Port 47833 is busy". Screenshot `qa/electron-smoke/04-prompter-bottom-right.png` (ignored) |
| `scripts/agents/kit shots` | Pass | 6 screenshots | Inline settings → Scenes: link off, on, busy port, at 324x390 and 324x820 (browser QA fake). New: a Corner margin update keeps the focused Face full `<option>` nodes and value (fails on `e9f9aa8`'s `overlay.js`) |
| Syntax checks | Pass | | `node --check` on `src/*.js`, `scripts/*.mjs`, `src/preload.cjs`, `scripts/agents/project.d/shots` |
| `git diff --check` | Pass | | |

## Build and artifact checks

Not run: no packaging change.

## Manual checks

| ID | Result | Observation/evidence |
| --- | --- | --- |
| W-30 Prompter link on Windows with Chrome and Edge | Not run | See KG-13 |
| M-12 Prompter link on macOS with Chrome and Safari | Not run | See KG-13 |

## Regressions and surprises

- Fixed: a burst of cues during the 280 ms Full screen exit dropped the exit's finishing step, so a stale saved Compact base came back at the next Full screen; a Scene without a position applied from Full screen (or during its exit) went to the display's corner or a half-way point; turning the link on and off in one tick could leave a listener (and on → off → on could then report the port busy) on Node versions that bind after an early `close()`. Node 22.22 and 24.21 here do not bind after it, so those tests model it with a fake server.
- The Overlay's Face full / Face small selects are now rebuilt only when their options change.

## Release decision

- **Decision:** Documentation baseline only
- **Reason:** Feature branch; manual Windows/macOS checks outstanding.
- **Known exceptions accepted by:** —
- **Follow-ups:** KG-13
