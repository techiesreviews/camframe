# Verification run: feature/camframe-link (Prompter link) — 2026-10-30

- **Commit:** the `feature/camframe-link` commit that adds this file (base `6861660`, `origin/main`)
- **Version:** 0.5.1 + unreleased Prompter link
- **Observer:** Claude (Opus 5.5) as builder agent; no human observation yet
- **Environment:** Linux 7.0 (Wayland/Xwayland `:0`), Node 24.21.0; Electron 43.2.0 borrowed from the main checkout's `node_modules` for the smoke run (the branch pins 44.7.0)
- **Cameras:** Chromium fake capture device (`CAMFRAME_E2E`), no real camera
- **Related change/PR:** none yet (not pushed); ADR 0031

## Automated checks

| Command | Result | Counts/duration | Evidence/notes |
| --- | --- | --- | --- |
| `npm ci` | Not run | | Worktree used the main checkout's modules only for the Electron run |
| `scripts/agents/kit unit` (= `node --test`) | Pass | 171 tests, 11 files | `.scratch/unit/` log; new `test/prompter-link.test.js`, Prompter link cases in `overlay-geometry`, `overlay-markup`, Preferences fixtures |
| `node --test --test-name-pattern "Prompter link" scripts/electron-smoke.mjs` | Pass | 1 test, ~2.4 s | Real Electron: status lists Scenes; `{size:"full"}` → display bounds; `{size:"small",position:"bottom-right"}` → camera 40 px from the work-area corner; `{scene:"demo"}` → Scene bounds; unknown Scene 404; turning the link off closes the port. Screenshot `qa/electron-smoke/04-prompter-bottom-right.png` (ignored) |
| `scripts/agents/kit shots` | Pass | 6 screenshots | Inline settings → Scenes: link off, on, busy port, at 324x390 and 324x820 (browser QA fake) |
| Syntax checks | Pass | | `node --check` on changed sources |
| `git diff --check` | Pass | | |

## Build and artifact checks

Not run: no packaging change.

## Manual checks

| ID | Result | Observation/evidence |
| --- | --- | --- |
| Prompter link on Windows with Chrome | Not run | See KG-13 |
| Prompter link on macOS with Chrome and Safari | Not run | See KG-13 |
| Multi-monitor corner placement on real hardware | Not run | Covered by unit tests with displays left of and above the primary one only |

## Regressions and surprises

- The previously defined `showScene()` behaviour is unchanged (Scenes applied by shortcut in Full screen still keep Full screen); only Prompter link cues use the new `showCompact()`.

## Release decision

- **Decision:** Documentation baseline only
- **Reason:** Feature branch; manual Windows/macOS checks outstanding.
- **Known exceptions accepted by:** —
- **Follow-ups:** KG-13
