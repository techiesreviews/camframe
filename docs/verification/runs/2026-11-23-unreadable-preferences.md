# Verification run: unreadable Preferences preservation — 2026-11-23

- **Baseline:** `19cf45221ce08e43052df8975c9aa38dffc93552` (`origin/dev`).
- **Commit:** `fd398424dae2004b2540868eca86c5ef7aa8f5f2` (final source and tests; this run's later documentation commit changes no executable files).
- **Versions:** Electron 0.9.0; unreleased Rust 0.1.0.
- **Observer:** Codex (`gpt-6.1-sol`).
- **Environment:** Linux 7.0.0-43-generic x86_64, ordinary UID 1000, Node 24.22.2,
  development checkout; Electron uses the existing display and synthetic camera.
- **Related change:** TOOLS-447; [ADR 0044](../../adr/0044-keep-unreadable-preferences-in-place.md).

## Automated checks

All commands ran with `ASE_OWNER=fleet-lead`. Test temporary files stayed under `.scratch/tmp`.
The existing main checkout's `node_modules` was linked; no dependency install ran.

| Command | Result | Evidence |
| --- | --- | --- |
| `kit doctor` | Initially failed: missing Playwright; passed 12/12 after linking existing modules | Command output |
| `kit unit test/preferences-store.test.js` before the guard | Failed: 13 failures, 21 passes; unreadable primaries were replaced | `.scratch/unit/20261123T215942-468811.log` |
| `kit go tools-447-rust-red --max 15m -- scripts/agents/kit rust` before the guard | Failed: store read back size 288 instead of original size 412 and Saved Interview | `.scratch/kit-jobs/tools-447-rust-red/log` |
| `kit go tools-447-app-red --max 10m -- cargo test --manifest-path rust/Cargo.toml --locked -p camframe-rust startup_migration_and_later_saves_keep_unreadable_preferences` before the guard | Failed: startup and later save replaced the original with defaults | `.scratch/kit-jobs/tools-447-app-red/log` |
| `kit go tools-447-electron-red --max 3m -- node --test --test-name-pattern 'unreadable Preferences survive' scripts/electron-smoke.mjs` with the store guard but before main caught errors | Failed: captured `A JavaScript error occurred in the main process` | `.scratch/kit-jobs/tools-447-electron-red/log` |
| `kit unit --affected` after the fix | Passed 34/34 | `.scratch/unit/20261123T220307-575120.log` |
| `kit unit` | Passed: 492 passed, 0 failed, 1 skipped (493 total) | `.scratch/unit/20261123T220413-587128.log` |
| `kit go tools-447-rust-check --max 15m -- scripts/agents/kit rust` | Passed: formatting, 74 tests, Clippy with warnings denied | `.scratch/kit-jobs/tools-447-rust-check/log` |
| `kit go tools-447-electron-green --max 3m -- node --test --test-name-pattern 'unreadable Preferences survive\|cut-off preferences.json' scripts/electron-smoke.mjs` | Passed 2/2: unreadable preservation and existing cut-off-file repair | `.scratch/kit-jobs/tools-447-electron-green/log` |
| `git diff --check`; `node --check src/main.js`; `node --check scripts/electron-smoke.mjs` | Passed | Command output |
| `kit unit test/preferences-store.test.js` with the restored-access regression before the session fix | Failed: 13 failures, 22 passes | `.scratch/unit/20261123T220846-599360.log` |
| `kit go tools-447-session-red --max 10m -- cargo test --manifest-path rust/Cargo.toml --locked -p camframe-rust startup_migration_and_later_saves_keep_unreadable_preferences` before the session fix | Failed: defaults replaced the original after access returned | `.scratch/kit-jobs/tools-447-session-red/log` |
| `kit go tools-447-electron-session-red --max 3m -- node --test --test-name-pattern 'unreadable Preferences survive' scripts/electron-smoke.mjs` before the session fix | Failed: quit saved fallback settings after access returned | `.scratch/kit-jobs/tools-447-electron-session-red/log` |
| Final `kit unit --affected` | Passed 35/35 | `.scratch/unit/20261123T221051-603667.log` |
| Final `kit unit` | Passed: 493 passed, 0 failed, 1 skipped (494 total) | `.scratch/unit/20261123T221105-604813.log` |
| `kit go tools-447-session-check --max 15m -- scripts/agents/kit rust` | Passed: formatting, 74 tests, Clippy with warnings denied | `.scratch/kit-jobs/tools-447-session-check/log` |
| `kit go tools-447-electron-session-check --max 3m -- node --test --test-name-pattern 'unreadable Preferences survive\|cut-off preferences.json' scripts/electron-smoke.mjs` | Passed 2/2; refused debounce and quit saves are logged; quit after access returns keeps the original; restart recovers the Scene | `.scratch/kit-jobs/tools-447-electron-session-check/log` |

The first post-fix Rust run passed all tests but Clippy rejected non-octal permission literals
in the new tests. Using `0o000` fixed that check; the final run above passed.

## Behavior exercised

Done when 1: met — both stores reject automatic saves over unreadable primaries. JavaScript
injects EACCES/EIO over real files with missing, broken and good spares, with replacement allowed
and with Windows rename fallback available. Rust uses real mode-000 files; its startup test
covers frame migration markers 0 and 1 with missing, broken and good spares. Restoring access
recovers size 412 and Saved Interview; spare bytes stay unchanged while reads fail.
The entire fallback session stays read-only if access returns before the first automatic save or
before quit, so the original and spare also survive that transition.

Done when 2: met — the existing store and shared Preferences contract tests still pass for first
run, deliberately missing primaries, quiet last-good recovery, malformed fallback and repair.
Existing Rust tests still pass for first adoption and the healthy one-time frame reset. Real
Electron still repairs a cut-off primary from the good copy on quit.

Done when 3: met — the regression tests failed first in both stores and Rust startup. After the
fix, real Electron debounced updates and quit preserve an unreadable primary without a native
error dialog; reopening after permission restoration recovers its saved Scene. The strengthened
Electron test captures debounce and quit refusal logs, proving those save paths were attempted.

## Review resolutions

- R1-1: fixed. Both stores latch primary read failure for the session; Electron reuses its store.
  Restored-access regressions failed first in JavaScript, Rust startup, and real Electron.
- R1-2: fixed. ADR 0039 marks the partial supersession by ADR 0044.
- R1-3: fixed. The verification coverage table names both-file preservation and the new checks.
- R1-4: fixed. The final tested source commit is recorded above.
- R1-5 and R1-6: fixed. Store and Rust startup tests now restore access before a fallback save.
- R1-7: fixed. The real Electron test asserts an EACCES debounce log and a quit refusal on stderr.
- Declined: the review's optional invalid-UTF-8 parity suggestion (no finding ID). That predates
  this patch; changing the malformed-document backup policy is outside TOOLS-447's scope.

The [discarded per-save-only approach](../../experiments/2026-11-23-unreadable-preferences-save-guard.md)
records why the session guard was needed.

## Limits and release decision

Native Windows/macOS CI results are recorded on the PR. These Linux checks do not claim native
UI parity, a physical failing disk, or real Windows file locking. Unix permission tests run on
Linux and macOS; deterministic JavaScript mocks exercise Windows rename fallback.

No product UI changed, so no notice, screenshots, `kit ux` or `kit shots` was needed. The full
Electron smoke suite and physical camera checks were not run. This is a checked development
change, not a release approval; no tag, live deployment or release was made.
