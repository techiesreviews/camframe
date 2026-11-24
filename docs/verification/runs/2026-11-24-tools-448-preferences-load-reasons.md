# Verification run: TOOLS-448 Preferences load reasons — 2026-11-24

- **Baseline:** `origin/dev` at `1f4f1c0`.
- **Version:** Electron 0.9.0; unreleased Rust app 0.1.0.
- **Observer:** Codex (`gpt-6.1-sol`), automated checks only.
- **Environment:** Linux x64, Node 24.22.2, development Electron with synthetic video,
  isolated Preferences folders under `.scratch/tmp`; Rust locked workspace dependencies.
- **Related change:** TOOLS-448; ADR 0045. No release or deployment is authorized.

## Automated checks

- `kit doctor`: initially failed because Playwright was absent in this worktree. Linking the
  main checkout's existing `node_modules` resolved it: `RESULT: ok doctor 12/12 checks passed`.
  No install was run and linked dependencies were not modified. An initial `kit deps check`
  reported 229 missing packages before this link.
- JavaScript red: all 20 new primary/backup outcome cases failed because `loadOutcome` was
  undefined (`.scratch/tools-448-js-red.log`, `RESULT: fail unit 35/55`). After implementation:
  `RESULT: ok unit 55/55`; `kit unit --affected` also passed all 55 selected tests.
- Rust red: the new matrix first failed compilation because outcome types/accessor were absent.
  A subsequent run demonstrated the behavioral assertion: actual `None` versus expected
  `Some(LoadOutcome { source: Defaults, primary: Missing, backup: None })`.
  Evidence: `.scratch/kit-jobs/tools-448-rust-red/log` and `tools-448-outcome-red/log`.
- `kit rust`: format, locked workspace tests (77 passed), and Clippy with warnings denied pass.
  Matrices cover 16 real-file primary/backup combinations and six actual `Prefs::open()` cases
  after frame migration and later saves. Existing Unix permission-preservation tests also pass.
- `kit unit test/preferences-store.test.js test/preferences-contract.test.js test/settings.test.js`:
  `RESULT: ok unit 105/105 (3 files)`.
- `kit unit`: `RESULT: ok unit 513/514 (21 files)` — 513 passed, zero failed, one platform skip.
- Real Electron startup red: the new startup test failed with
  `TypeError: main.preferencesLoadOutcome is not a function`. The final `kit unit
  scripts/electron-smoke.mjs` passed all nine tests (`RESULT: ok unit 9/9`). The six startup
  cases verify source, primary reason/error code, unchanged Scene selection, no settings text
  in the outcome, and no diagnostic field in renderer state. Existing cut-off recovery and
  unreadable debounce/quit/reopen cases pass unchanged.
- `git diff --check`: passed.

## Completion proof

Done when 1: met — 20 JavaScript store cases, 16 Rust store cases, six Rust startup cases and six real Electron startup cases retain source/reasons without settings contents, including after saves.

Done when 2: met — unchanged Preferences fixtures pass in both languages; existing real Electron cut-off recovery and unreadable debounce/quit/reopen tests pass, preserving the TOOLS-447 session guard and missing-primary rule.

Done when 3: met — JavaScript EACCES/EIO injection and missing/good/damaged/unreadable spares, real Rust filesystem read errors, damaged files and startup backup selection are covered by passing tests that first exposed missing outcomes/accessors.

## Limits and release decision

- Native Windows/macOS CI is required before merging; its result belongs in the PR.
- No physical camera, power-loss, native Windows file-lock or manual desktop test was performed.
- No visible change: `kit ux`/`kit shots` are not required; land with `--not-visible "diagnostics only"`.
- The requested `docs/agents/runner.md` is absent in this repository. The available project
  Agent Kit guide, command help and shared rulebook were followed instead.
- Discarded startup capture attempts are recorded in
  `docs/experiments/2026-11-24-preferences-startup-diagnostic-check.md`.
- **Decision:** local automated verification passes; not a release Go.
