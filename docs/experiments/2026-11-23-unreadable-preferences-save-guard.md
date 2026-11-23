# Experiment: Preserve unreadable Preferences with a per-save guard

- **Date started:** 2026-11-23
- **Owner:** Codex
- **Status:** Rejected (the per-save-only hypothesis; the session guard is recorded in ADR 0044).
- **Related change:** TOOLS-447; [ADR 0044](../adr/0044-keep-unreadable-preferences-in-place.md).
- **Baseline:** `19cf45221ce08e43052df8975c9aa38dffc93552`.

## Question and hypothesis

Would refusing each save whose primary read fails suffice to recover the saved Scenes once
access returns? The intended threshold was that neither automatic saves nor Rust startup could
erase a valid unreadable primary, and restarting with restored access recovered its Scenes.

## Variants and results

The baseline overwrote mode-000 valid Preferences with defaults in Rust startup. JavaScript
filesystem injection demonstrated the same overwrite with EACCES/EIO and successful replacement.

Variant A (`492ecf7`) refused each save while its primary read failed. It passed the initial store,
Rust startup and real Electron permission tests. Review identified an uncovered transition:
access returning before quit allowed fallback settings to replace the original. A subsequent
save could overwrite its last-good copy too. Restored-access regressions then failed in the
JavaScript store, Rust startup and real Electron (the `tools-447-session-red` and
`tools-447-electron-session-red` logs under `.scratch/kit-jobs/`).

Variant B (`fd39842`) also latches a primary load error for the lifetime of the store. Electron
reuses that store for its debounce and quit saves. Restoring access does not permit a fallback
session to save; restarting loads the original and resumes normal saves. All strengthened
regressions pass. See the [verification run](../verification/runs/2026-11-23-unreadable-preferences.md)
for commands and evidence paths.

## Disposition

Variant A's assumption that a fresh successful pre-save read is sufficient was discarded. The
per-save guard remains alongside Variant B's session guard. No archive, recovery UI, fallback
policy change or new dependency remains. All evidence is automated on isolated test files;
native Windows/macOS checks are recorded on the PR.
