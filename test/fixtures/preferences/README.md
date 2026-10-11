# Preferences contract fixtures

These JSON files are the language-neutral contract for CamFrame Preferences. Any implementation that reads or writes `preferences.json` or Scene exports must pass every case. The Electron implementation runs them in `test/preferences-contract.test.js`.

Each file has the shape `{ "contract": string, "version": 1, "cases": [...] }`. Every case has a human-readable `name`.

| File | Entry point | Case fields |
| --- | --- | --- |
| `sanitize.json` | `sanitizeSettings(input)` | `input`: untrusted settings object. `expected`: the sanitized Preferences document. |
| `load.json` | `preferencesFromDocument(text)` | `document`: a JSON value written as the file, or `documentText`: raw file text (may be invalid JSON). Neither field means the file is missing. `expected`: the launch settings. |
| `scene-import.json` | `importScenes(existingScenes, payload)` | `existing`: current Scenes. `payload`: the parsed import file. `expected`: `{ "scenes": [...], "importedCount": n }` or `{ "error": string }`. |

Strings are measured in UTF-16 code units, as JavaScript's `String.prototype.slice` does. Numbers round half away from zero.

When behavior changes on purpose, regenerate the affected `expected` values, review the diff, and record the change in `docs/data-contracts.md`.
