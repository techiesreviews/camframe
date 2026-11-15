# ADR 0039: Save Preferences in one step and keep a last good copy

## Status

Accepted — 2026-11-15 (Orbit TOOLS-295, pick 0a of the 2026-11-15 architecture review, bug B4).

## Context

Main wrote `preferences.json` in place with `writeFileSync`, both after the 120 ms debounce and on quit. A crash, a forced shutdown or a power cut during that write leaves a cut-off file. `preferencesFromDocument()` treats invalid JSON as a new installation, so CamFrame started from defaults without a word and the next save overwrote the broken file: every saved Scene and setting was gone.

## Decision

`src/preferences-store.js` owns the Preferences file on disk; main only gives it the path.

- A save writes `preferences.json.tmp`, flushes it to disk, and renames it over `preferences.json`. A crash leaves either the old file or the new one.
- Before each save, the current `preferences.json`, when it is complete (JSON that parses to an object) and differs from the new text, becomes `preferences.last-good.json` the same way. A broken file never replaces the last good copy.
- Loading reads `preferences.json` when it is complete; when it exists but is broken or unreadable, the last good copy is loaded instead, quietly (no notice, no new UI). With no complete copy either, loading falls back to defaults as before.
- A missing `preferences.json` still means "no saved Preferences", even when a last good copy is left, so deleting or renaming the file on purpose still starts fresh.
- When Windows refuses the rename because another program holds the file (`EPERM`, `EACCES`, `EBUSY`), the save writes in place instead of being lost; the last good copy is already on disk by then.

The Preferences fixtures (ADR 0030 rule 1) are unchanged: they describe the document, not the file.

## Consequences

- A cut-off `preferences.json` loads the previous save; at most the last change is lost, not the whole document.
- One extra small file sits in the user-data folder, and each save writes up to two small files instead of one.
- Automated: `test/preferences-store.test.js` on a real folder (a broken file, a crash mid-write, the last good copy, a missing file). The Windows rename while an antivirus or the indexer holds the file is checked only by reading the code until a Windows run covers it.
