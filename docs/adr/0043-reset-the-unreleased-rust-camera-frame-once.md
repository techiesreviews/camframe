# ADR 0043: Reset the unreleased Rust camera frame once

## Status

Accepted — 2026-11-22, following Lex's test feedback and the lead's explicit migration approval.
Extends ADR 0041's first-start copy rule and ADR 0042's test settings contract.

## Context

Lex wants the camera to start without a border, with white selected for any later frame. Fresh
defaults already used width 0 and white, but the Rust app copied every 0.9.0 preference, including
its frame. Earlier Rust test builds could retain that copied border. The Rust app has not been
released; the lead confirmed Lex had not chosen a border in those test builds.

## Decision

- On the first load without `rustFrameDefaultsVersion: 1`, reset only the live camera's
  `borderWidth` to 0 and `borderColor` to `#ffffff`, then save to the Rust settings folder.
- Include that Rust-only marker in every subsequent save. Later user choices survive restarts.
- Leave Scenes, other preferences and the original Electron file unchanged. Shared Preferences
  schema 15 and its language-neutral fixtures remain unchanged; Electron ignores the extra marker.
- Do not draw an extra camera outline for high contrast. UI controls keep their contrast borders.

## Consequences

Both imported settings and earlier Rust test settings receive the reset once. A failure to save
still reports the existing preferences error and retries the migration on the next start. The
last good copy retains its existing recovery behavior. This is a test-build migration, not a
general reset of the user's choices on every start.
