# ADR 0015: Sign releases before enabling updates

## Status

Proposed

## Related work

- Roadmap PRD: [GitHub issue 11](https://github.com/techiesreviews/camframe/issues/11)
- Signed release candidates: [GitHub issue 12](https://github.com/techiesreviews/camframe/issues/12)
- Stable release updates: [GitHub issue 19](https://github.com/techiesreviews/camframe/issues/19)

## Context

CamFrame currently produces unsigned Windows NSIS/portable artifacts and unsigned macOS DMG/ZIP artifacts. This creates operating-system trust warnings and makes a self-update path harder to authenticate safely.

The existing tagged GitHub release workflow is a natural stable update source, but release signing requires human-owned identities, protected credentials, and platform-specific verification.

## Decision

Establish repeatable Windows code signing and macOS signing/notarization before enabling in-app update installation on the corresponding platform. Keep signing credentials in protected CI secrets, never expose them to untrusted pull-request jobs, and verify signatures/notarization as release acceptance criteria.

Use stable tagged GitHub releases as the initial update source. Packaged installed builds may check for updates automatically when the global Update checks Preference is enabled. The default is enabled, but checking can be disabled. Development, unpacked, and unsigned builds do not offer in-app installation.

An available update shows its version and release notes. Download and installation require explicit user actions; CamFrame never silently replaces or restarts the running app. Download, verification, cancellation, failure, restart, and up-to-date states remain recoverable and are announced accessibly.

Support the installed Windows and macOS distributions first. The Windows portable build may check and link to the release download, but it does not self-install. Use a single stable channel until a separate decision defines prerelease channels or rollback behavior.

Update state and network access live in the main process behind a narrow preload interface. Update settings are global Preferences and are not captured by Scenes.

## Consequences

- A human must obtain and maintain signing identities and protected CI credentials.
- Update installation is blocked independently per platform until that platform's signed artifacts pass manual verification.
- Release verification expands to cover signature identity, macOS notarization, update discovery, download integrity, user cancellation, restart installation, and failure recovery.
- Portable Windows users retain a manual replacement flow.
- Certificate expiry, revocation, and credential rotation become release-operability responsibilities.
