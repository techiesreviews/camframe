# ADR 0027: Pin the release toolchain

## Status

Accepted — 2026-08-29

## Context

CamFrame declared Electron, Electron Builder, and Vite as `latest`. The lockfile made an unchanged checkout reproducible, but regenerating it could silently change major versions. During release verification, npm's `latest` tag selected Electron Builder 26.15.3, whose Windows extraction path locked `win-unpacked.tmp` and then tried to rename that same directory before releasing the lock. Windows consistently returned `EPERM`.

Electron Builder 26.15.5 replaces the direct rename with a retrying atomic move. It is published and tagged upstream, but npm's `latest` distribution tag still resolves to 26.15.3.

## Decision

Pin every direct development/release dependency exactly:

- Electron 43.2.0
- Electron Builder 26.15.5
- Playwright Core 1.62.1
- Vite 8.2.0

Keep `package-lock.json` checked in and use `npm ci` locally and in CI. Dependency upgrades are explicit maintenance changes with tests, packaging, and an updated verification run.

## Consequences

- A clean install and release CI resolve the same direct tool versions, including the Electron integration driver.
- Windows packaging avoids the 26.15.3 temporary-directory rename defect.
- Updates no longer arrive implicitly through lockfile regeneration.
- Maintainers must deliberately review and apply security and compatibility upgrades.