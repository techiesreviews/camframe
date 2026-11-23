# ADR 0042: Complete the Rust test app before switch-over

## Status

Accepted — 2026-11-21, implementing Lex's TOOLS-393 answers. Extends ADR 0041's initial bubble
scope to the complete test app and supersedes its temporary "no installer" limit for test builds.

## Context

Lex chose one complete Rust test build, with the everyday Windows bubble as his first try, Mac
beta from the start, a simpler guide built last, and no signing or auto-update work on this card.
He allowed the three improvements in ADR 0041. The Electron app must stay usable during the try.

## Decision

- Camera, Style, Full screen, Scenes, the Prompter link and the simpler four-tip guide share one
  GPUI window. Portable rules remain in `rust/core`; native window, camera and menu code remain
  behind app adapters. The guide never moves a ghost mouse or changes the camera automatically.
- Windows and both Mac architectures build unsigned test downloads in CI. Windows has an NSIS
  per-user installer and Portable; Mac has DMG and ZIP. Only the ad-hoc Mac identity needed to run
  the binary is used. CI uploads artifacts, never a release, tag or production update.
- Test builds keep the separate CamFrame Rust name and settings folder. No automatic takeover
  of 0.9.0, or removal of its old login registration, happens before Lex's try and go.
- Preferences remain schema 15 and use the shared fixtures. Native device identity differs from
  Chromium's origin-specific camera ids: imported selections use the saved camera label when
  possible, otherwise the default. New native selections use the backend's stable unique id.
- Human camera tests, NVDA/VoiceOver checks and real-camera performance measurements remain
  release gates. A passing test-picture CI job is labelled as such, never as a real-camera pass.

## Consequences

Lex can install and try the Rust build beside 0.9.0 and go back immediately. Settings files retain
their structure, Scenes and migrations, but a native camera id may need camera reselection when
moving a file back to Electron. Capture still resamples on its worker thread; performance at
2160p must be measured before claiming the rewrite beats 0.9.0 under real capture.
