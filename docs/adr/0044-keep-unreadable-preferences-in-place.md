# ADR 0044: Keep unreadable Preferences in place

## Status

Accepted — 2026-11-23 (TOOLS-447, the destructive automatic-save case in TOOLS-433).
Amends ADR 0039's save policy in both Electron 0.9.0 and Rust (ADR 0041).

## Context

A file can refuse reads while its directory still allows replacement. Both stores previously
skipped the last-good refresh after that read failure, then replaced the unreadable primary with
the in-memory fallback. Rust's frame migration could do this during `Prefs::open()`, even when
the unreadable file already held the migration marker and valid saved Scenes.

## Decision

- Before any save, read the primary. A genuinely missing file still allows a first save. Any
  other filesystem read failure aborts the save before touching the primary or the last-good copy.
- Keep the unreadable original at its existing path. Do not rename it or create an archive. This
  preserves its bytes and permissions without needing to copy bytes that cannot be read.
- If loading cannot read the primary, make that store read-only for the entire session. Electron
  keeps the same store for loading and all saves; Rust already does. Access returning during the
  session must not allow fallback settings to replace the saved Scenes. Restart after access
  returns to load the original; the new session can then save normally.
- For a session that loaded without a read error, recheck on each save. A temporary pre-save
  read failure refuses that save; a later successful read permits normal saving.
- Loading keeps ADR 0039's choices: a usable last-good copy wins over an unreadable or malformed
  primary; without one, defaults remain quiet. A missing primary ignores a leftover last-good copy.
  Readable malformed documents can still be repaired by saving.
- Electron catches save errors at both its debounced and quit boundaries and logs them without a
  native error dialog. Rust already logs store errors, including a failed startup migration save.
  No new recovery notice or settings field is introduced.

## Consequences

Changes made in a session that loaded after a primary read error are not persisted, even if access
returns before quit. Restarting after access returns recovers the saved Scenes and permits normal
saving. There is no automatic merge of fallback settings and old Scenes.
The one-time Rust frame reset is retried on reopening if its marker could not be saved.

This guard does not add locking between running app copies or strengthen the durability of a
healthy save when refreshing the last-good copy fails. Those remain ADR 0039's policies.

Automated coverage uses JavaScript filesystem error injection over real files (`EACCES`, `EIO`,
missing/broken/good spares, successful replacement and Windows blocked-rename fallback), Unix
mode-000 files in both Rust stores and startup, and real Electron debounce/quit/reopen checks.
