# ADR 0045: Retain Preferences load reasons

## Status

Accepted — 2026-11-24 (TOOLS-448, the diagnostics case in TOOLS-433).
Extends ADR 0039 and ADR 0044 without changing their recovery or save rules.

## Context

Both apps quietly recover from a last-good copy or start with defaults when Preferences cannot
be loaded. The caller previously received only document text (or no text), so support could not
distinguish a missing primary from a read failure or a damaged document after startup.

## Decision

- Both stores retain the most recent read's structured outcome separately from Preferences.
  It contains the selected source (`primary`, `backup`, or `defaults`), primary status, and
  backup status. Status is valid, missing, damaged, or unreadable with an OS error code
  (JavaScript) or `io::ErrorKind` (Rust). Backup status is absent when it was not tried.
- A damaged document means readable text that is not a JSON object, including invalid JSON.
  Rust's strict backup UTF-8 decoder also classifies invalid text bytes as damaged while
  retaining its existing rejection of that spare, even if lossy decoding would parse as an object.
  `defaults` means neither file supplied a usable object. The store still returns the same
  original fallback text to the existing parser, preserving its legacy non-object behavior.
- The outcome contains no document text, Scene names, paths, or error messages. Electron exposes
  a frozen `loadOutcome`; Rust exposes a copy through `load_outcome()`. Saves, including Rust's
  automatic frame migration, do not erase that outcome.
- The startup boundaries log the structured outcome once using the existing process output
  (`console.info` in Electron, `eprintln!` in Rust). Electron's main module also exposes the
  retained outcome through `preferencesLoadOutcome()`. There is no diagnostic file, UI, IPC
  field, schema change, or new recovery flow.
- Missing primary still ignores any spare. Unreadable/damaged primary still tries the spare.
  Existing session save protection and readable damaged-file repair stay unchanged.

## Consequences

Support can distinguish recovery paths in process output without collecting saved settings.
The retained outcome survives automatic saves; it is runtime state, not a durable history.
The existing limitations of process-output collection, especially a packaged Windows GUI app
without an attached console, remain. This change does not add an export or persistent log sink.

Automated coverage exercises isolated file matrices, injected JavaScript `EACCES`/`EIO`, real
Rust filesystem errors, retained startup outcomes after migration, and real Electron startup.
Existing contract and unreadable-file preservation tests remain the recovery oracle.
