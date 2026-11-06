# ADR 0036: Draw no Scene name on the camera

## Status

Accepted — 2026-11-06 (Lex).

## Context

Applying a Scene, and saving one, used to show the Scene's name (or "<name> saved") on the Overlay for 1.6 seconds. The Overlay is the window Lex captures for the stream, so with the Prompter link (ADR 0031, ADR 0035) a cue line would have put a Scene name on air at every camera change. Unverified: whether a capture setup could leave the notice out; nothing in CamFrame makes it do so.

## Decision

- Applying a Scene (Prompter cue, tray, shortcut, Inline settings) and saving one (Prompter link or Inline settings) draw nothing on the camera.
- Screen readers still hear the Scene name: every apply and every save sends it (`announce`, bridge event `onSceneAnnouncement`) and `src/overlay.js` writes it into a visually hidden live region (`#scene-announcer`, `role="status"`, 1 px, clipped), emptying it first so the same Scene twice is read twice. It is never drawn.
- The notice stays for other events: Scene deleted, scenes imported or exported, no saved scenes.
- The corner margin at a bottom place on a short display that is not fully met stays as it is (KG-14, Lex 2026-11-06).

## Consequences

- A Prompter cue also announces the name, which only a screen reader on the streaming PC would hear.
- Manual rows W-20, W-29 and M-11 changed; W-30 checks silence on the streaming PC.
