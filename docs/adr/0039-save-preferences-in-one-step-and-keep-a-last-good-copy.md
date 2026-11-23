# ADR 0039: Save Preferences in one step and keep a last good copy

## Status

Accepted — 2026-11-15 (Orbit TOOLS-295, pick 0a of the 2026-11-15 architecture review, bug B4).

Superseded in part by ADR 0044 (unreadable Preferences and session save protection, 2026-11-23).

## Context

Main wrote `preferences.json` in place with `writeFileSync`, both after the 120 ms debounce and on quit. A crash, a forced shutdown or a power cut during that write leaves a cut-off file. `preferencesFromDocument()` treats invalid JSON as a new installation, so CamFrame started from defaults without a word and the next save overwrote the broken file: every saved Scene and setting was gone.

## Decision

`src/preferences-store.js` owns the Preferences file on disk; main only gives it the path.

- A save writes a temporary file of its own (`preferences.json.<process>-<save>.tmp`, so two running copies of CamFrame never share one), flushes it to disk, and renames it over `preferences.json`. On Linux and macOS it then flushes the folder. On Linux that makes the rename itself survive a power cut; on macOS the flush reaches only the drive's cache (a full flush needs `F_FULLFSYNC`, which Node lacks). Windows cannot open a folder for that and relies on NTFS journaling the rename. A crash leaves either the old file or the new one.
- Before each save, the current `preferences.json`, when it is complete (JSON that parses to an object) and differs from the new text, becomes `preferences.last-good.json` the same way. A broken file never replaces the last good copy. Refreshing the copy is best effort: when it fails, the save itself still goes ahead. The copy is only ever renamed into place, never written in place, so a failed refresh leaves the older copy whole.
- Loading reads `preferences.json` when it is complete; when it exists but is broken or unreadable, the last good copy is loaded instead, quietly (no notice, no new UI). With no complete copy either, loading falls back to defaults as before.
- A missing `preferences.json` still means "no saved Preferences", even when a last good copy is left, so deleting or renaming the file on purpose still starts fresh.
- When Windows refuses the rename because another program holds the file (`EPERM`, `EACCES`, `EBUSY`), the save of `preferences.json` (never of the copy, and never on Linux or macOS, where a refused rename is reported) writes in place instead of being lost; the last good copy is on disk by then, unless refreshing it just failed.

The Preferences fixtures (ADR 0030 rule 1) are unchanged: they describe the document, not the file.

## Consequences

- A cut-off `preferences.json` loads the previous save; at most the last change is lost, not the whole document. In the rare case where refreshing the copy failed, Windows then blocked the rename and the in-place write was cut off, the copy is older (or absent on the second save ever) and the changes since it are lost.
- A save that fails removes its own temporary file when it can. A crash mid-save, or a program that also holds the temporary file, can leave a `.tmp` file next to `preferences.json`; nothing reads it, and nothing removes it yet.
- On Windows and macOS a power cut right after a save can bring back an earlier complete file (the rename may not have reached the disk); the document is still whole.
- Two copies of CamFrame running at once (it has no single-instance lock) save over each other's whole document, as before. Their saves never mix inside one file, but the last good copy may then be an older complete file rather than the one the final save replaced.
- One extra small file sits in the user-data folder, and each save writes up to two small files instead of one.
- Automated: `test/preferences-store.test.js` on a real folder (a broken or unreadable file, a crash mid-write, a failed copy refresh, a blocked rename, the last good copy, a missing file, two overlapping saves, the folder flush on Linux and macOS but not on Windows, a refused folder flush, no temporary file left by a failed save, a temporary file that cannot be removed, a blocked rename of the copy, a refused rename on Linux and macOS, both files broken). The real Electron smoke opens a cut-off `preferences.json` with the last good copy and repairs it on quit.. A real Windows antivirus or indexer holding the file is not exercised until a Windows run covers it.
