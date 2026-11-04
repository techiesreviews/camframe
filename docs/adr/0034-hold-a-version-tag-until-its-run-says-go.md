# ADR 0034: Hold a version tag until its run says Go

## Status

Accepted — 2026-11-04 (Lex's lead, fleet-lead), after Lex asked for the 0.6.1 release to wait for a manual build and his own try-out.

## Context

`.github/workflows/build-desktop.yml` builds on any `v*` tag and its `release` job publishes as soon as the builds pass. Nothing checked that the tag matched the package version or that the release had been approved in a verification run.

## Decision

- `test/release-version.test.js` fails a tag build (`GITHUB_REF` starting `refs/tags/`) unless the tag is exactly `v<version>` and there is exactly one dated `docs/verification/runs/<date>-v<version>-go.md` with the lines `- **Decision:** Go` and `- **Version:** <version>`. A tag build runs `npm test` before `release` (which needs `build`), so a failing hold publishes nothing.
- No Go file, more than one, or a wrong line fails with a plain reason. To take a Go back, rename its file so it no longer ends in `-go.md`.
- Manual dispatch on a branch still builds without publishing; the hold is for tags.

## Consequences

- Every future release needs one `<date>-v<version>-go.md` run before its tag; `docs/verification/README.md` (Release version row) lists the rule.
- The hold only protects commits that contain it; a tag on an older commit publishes unchecked (closing that is a GitHub tag rule, which is Lex's decision; only the lead tags).
- The hold reads only those two lines. It does not check the release page or whether the checks behind the Go were done.
