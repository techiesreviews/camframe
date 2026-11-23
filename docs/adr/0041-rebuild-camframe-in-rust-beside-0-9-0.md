# ADR 0041: Rebuild CamFrame in Rust (GPUI), beside 0.9.0, with its own Preferences

## Status

Accepted — 2026-11-21 (Lex, Orbit TOOLS-393: the plan and his answers to its questions). Builds on the Windows trial (TOOLS-391) and the macOS check (TOOLS-394), recorded in `docs/experiments/2026-11-21-rust-gpui-bubble-macos.md`.

## Context

CamFrame 0.9.0 is an Electron app. The trial bubble in Rust with GPUI showed that a see-through, always-on-top camera bubble works on a Windows and a macOS CI desktop, in a much smaller and faster program. Lex asked for the whole app, every feature of 0.9.0, rebuilt in Rust for Windows and macOS.

He also asked that 0.9.0 keeps working while the Rust app is being built and tried: the two must be able to run on the same computer without one changing the other's settings.

## Decision

- The Rust app lives in `rust/` (a Cargo workspace: `core/` without any window code, `app/` with GPUI), next to the Electron app in `src/`. It is built by its own CI jobs (`.github/workflows/rust-windows.yml`, `rust-macos.yml`) and never by the Electron release workflow.
- It keeps its Preferences in its own folder, "CamFrame Rust", next to 0.9.0's "CamFrame" folder (`%APPDATA%` on Windows, `~/Library/Application Support` on macOS). On its first start, when it has no Preferences yet, it copies 0.9.0's `preferences.json` once. It only ever reads 0.9.0's file. After that the two apps' settings are separate.
- The Preferences file keeps 0.9.0's layout and rules exactly (schema 15, the same cleaning of every value, a one-step save and the last good copy of ADR 0039), checked against the same fixtures in `test/fixtures/preferences/`. So a file can move between the apps either way.
- It changes nothing in 0.9.0 except three improvements Lex allowed: clicks pass through the empty parts of the window around the camera, a shortcut another app has taken is shown as taken, and the mirrored framing bug (KG-10) is fixed. Every other difference is written down for Lex.
- No signing, no installer and no auto-update for now. The macOS app carries only the ad-hoc signature Apple Silicon needs to start a program and is labelled beta until a person has tried it.

## Consequences

- Both apps can be open at once. They do not share the Prompter link port: only one of them can turn it on at a time.
- A change to the Preferences in 0.9.0 after the first start of the Rust app does not reach the Rust app, and the other way round.
- The Preferences fixtures, `src/settings.js` and `src/scenes.js` are the shared contract: a change there runs the Rust CI jobs too.
- Whether the Rust app replaces the Electron app, and how it would be released and signed, is a later decision for Lex in a new ADR.
