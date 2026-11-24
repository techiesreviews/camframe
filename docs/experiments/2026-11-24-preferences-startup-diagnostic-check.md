# Preferences startup diagnostic check — 2026-11-24

- **Scope:** TOOLS-448, testing the retained outcome in the real Electron main process.
- **Baseline:** `origin/dev` at `1f4f1c0`; startup returned settings without retaining a diagnostic.
- **Hypothesis:** reading the child process's stdout after Playwright launch could verify the
  startup diagnostic without changing the main module's interface.
- **Result:** inconclusive. The listener installed after launch did not receive the startup
  record, including after the logging statement was present. This was not evidence that the
  statement failed to run. That assertion was discarded.
- **Second attempt:** dynamic `import()` inside `electronApplication.evaluate()` failed with
  `TypeError: A dynamic import callback was not specified.` It was discarded too.
- **Retained approach:** main exposes only its frozen outcome via `preferencesLoadOutcome()`.
  The test loads the already-cached ESM namespace with Node's `createRequire()` and checks
  the outcome after actual startup. Before the accessor, it failed with
  `TypeError: main.preferencesLoadOutcome is not a function`; afterward all six startup
  combinations passed. No renderer field or test-only environment hook was added.
- **Cleanup:** no exploratory helper files or production capture hooks remain. Raw test
  logs are ignored under `.scratch/`; the retained test lives in `scripts/electron-smoke.mjs`.
