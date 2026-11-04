# ADR 0034: Hold a version tag until its run says Go

## Status

Accepted — 2026-11-04 (Lex's lead, fleet-lead), after Lex asked for the 0.6.1 release to wait for a manual build and his own try-out.

## Context

`.github/workflows/build-desktop.yml` builds on any `v*` tag and its `release` job publishes as soon as the builds pass. Nothing checked that the tag matched the package version or that the release had been approved in a verification run.

## Decision

- `test/release-version.test.js` fails a tag build (`GITHUB_REF` starting `refs/tags/`) unless the tag is exactly `v<version>` and the newest linked run in force has the line `- **Decision:** Go`. A tag build runs `npm test` before `release` (which needs `build`), so a failing hold publishes nothing.
- The newest run is the one with the latest date in its filename; on the same date a decision that is not Go beats a Go. A run with a missing or badly written Decision line blocks.
- A run marked with a `> Superseded` line is out of force. A Go run must be dated later than every linked non-Go run, or those runs get the pointer.
- Manual dispatch on a branch still builds without publishing; the hold is for tags.

## Consequences

- Every future release needs a linked, dated run that says exactly Go before its tag; `docs/verification/README.md` (Release version row) lists the rule.
- The hold reads only the Decision line. It does not check the release page or whether the checks behind the Go were done.
