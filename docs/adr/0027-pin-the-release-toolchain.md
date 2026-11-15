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

2026-09-26 maintenance update: Electron 44.4.5, Electron Builder 26.17.0 (npm `v26` tag; `latest` still resolves to 26.15.3), Playwright Core 1.63.0, and Vite 8.3.1. Electron 44 drops macOS 12 and 32-bit Windows.

2026-10-11 maintenance update: Electron 44.7.0 (npm `latest`), a patch-line update within Electron 44. Electron Builder, Playwright Core, and Vite are unchanged.

2026-11-16 maintenance update (Orbit TOOLS-295, security): Electron 44.11.3 (npm `latest`; 44.7.0 fell in the high advisory "Mitigation for compromised eMudhra intermediate certificates", fixed in 44.9.1), Vite 8.3.8 (8.3.1 pulled in the launch-editor command-injection advisory on Windows), and Electron Builder 26.18.1 (npm `v26` tag; `latest` is 26.18.0). Playwright Core is unchanged. `npm audit fix` raised the transitive undici (6.29.1 and 7.30.2), source-map-js (1.2.2) and fast-uri (3.1.9) in the lockfile. After it `npm audit` reports no high or critical advisory; 6 moderate remain, all from `minimatch` 9 under `@electron/universal` 2 in Electron Builder's macOS universal-build path, which npm can only "fix" by going back to Electron Builder 24.13.3, before the Windows rename fix above.

## Consequences

- A clean install and release CI resolve the same direct tool versions, including the Electron integration driver.
- Windows packaging avoids the 26.15.3 temporary-directory rename defect.
- Updates no longer arrive implicitly through lockfile regeneration.
- Maintainers must deliberately review and apply security and compatibility upgrades.