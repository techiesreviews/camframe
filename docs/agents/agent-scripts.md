# Agent Kit (CamFrame)

Agent Kit is required for all coding in this repo, for every model and provider, including delegated workers. CamFrame uses the shared, machine-wide kit (`~/.local/share/agent-kit/current`, set up with `kit init --light` on 2026-10-30); the repo holds only its launcher (`scripts/agents/kit`), hook launcher (`scripts/agents/hooks/run.sh`), settings (`scripts/agents/kit.json`) and one project command (`scripts/agents/project.d/shots`). The kit itself is never copied in.

Work in a git worktree, not the main checkout. Run `scripts/agents/kit --help`, each relevant command's `--help`, and `scripts/agents/kit doctor` before implementing. Every command ends with one `RESULT: ok|fail …` line.

| Command | What it does here | Evidence |
| --- | --- | --- |
| `kit doctor` | Worktree place and base, hook config, Node, conflict markers, every command's `--help`, the kit copy. | stdout |
| `kit unit [files…]` / `kit unit --affected` | `node --test` over `test/**/*.test.js` (the same suites as `npm test`), or only the files a change touches. | `.scratch/unit/*.log` |
| `kit shots` | Project command. Serves `src/` on a free `127.0.0.1` port, opens `overlay.html` in Chromium without Electron (the browser QA fake), opens Inline settings → Scenes and captures the Prompter link off, on, and with a busy port (`?prompter=busy`) at the default Overlay size (324x390) and a tall view. Fails on page errors or missing controls. Playwright comes from `KIT_PLAYWRIGHT_MODULE`, else `playwright` in `kit.json`. | `.scratch/shots/<time>/` |
| `kit review` | Read-only review of a commit or range, with the kit's pinned reviewer. | `.scratch/reviews/` |

The real-Electron smoke test (`npm run test:electron`, `scripts/electron-smoke.mjs`) needs `node_modules` (Electron and `playwright-core`) and a display; it is not wrapped by the kit. `.scratch/` is git-ignored. Do not use `kit pr`, `kit slice` or other publishing commands unless the lead authorises it.
