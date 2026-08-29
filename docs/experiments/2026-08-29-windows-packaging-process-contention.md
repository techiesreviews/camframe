# Windows packaging process contention — 2026-08-29

## Question

Could the final v0.5.0 Windows artifacts be rebuilt locally immediately after validating Electron Builder 26.15.5?

## Attempt

Two packaging commands were inadvertently started against the same `dist-rc-v0.5.0` output. One was part of a PowerShell sequence that used `;`, so it continued after the preceding Electron smoke failed; a second explicit build then overlapped it. Later retries used unique output paths and, once, the installed unpacked Electron distribution, but the orphaned builder/NSIS children continued to saturate the filesystem until their parent terminal sessions were cancelled.

## Result

The overlapping v0.5.0 outputs are invalid and are not release evidence. No source or tracked artifact was lost. The earlier single-process 26.15.5 build remains valid evidence for the candidate source before the version metadata bump.

A later final `npm ci` also stalled while reifying the local workspace after clearing `node_modules`, despite a regenerated lock resolving successfully in a clean temporary directory in six seconds. The installer had no child process, CPU change, or network connection and was stopped. This local dependency tree is generated and excluded from release evidence; the clean CI runners remain the authoritative install check.

## Decision

- Never run concurrent Electron Builder jobs against one output directory.
- Run dependent checks as separate commands and inspect each exit code instead of using a non-short-circuiting PowerShell `;` sequence.
- Use the clean, isolated GitHub Actions matrix as the authoritative final v0.5.0 package build.
