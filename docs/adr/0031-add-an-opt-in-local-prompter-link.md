# ADR 0031: Add an opt-in, local, view-only Prompter link

## Status

Accepted — 2026-10-30 (Lex).

## Context

Lex reads scripts in the Techies prompter (https://prompter.techies.tools, one self-contained web page) while CamFrame shows his camera. His scripts already carry cue lines such as `[Share screen. Face small.]` and `[Stop share. Face full.]`, and he switches CamFrame by hand with `Ctrl/Cmd+Shift+F` and the Scene shortcuts. He wants CamFrame to follow those cues when the prompter reaches them.

A web page cannot press CamFrame's global shortcuts. The prompter has no server-side state and must keep working offline as one file; CamFrame must stay a standalone, view-only camera viewer with no recording, post-production, or new camera features.

## Decision

- CamFrame gets a **Prompter link**: an HTTP server bound to `127.0.0.1` only, on the fixed, documented port `47833`, with two routes: `GET /camframe/status` (app, version, Scene names) and `POST /camframe/cue` (`{size, position?, scene?}`).
- It is **off by default** and listens only while the user turns it on in Inline settings → Scenes. Turning it off or quitting closes the port. A busy port is shown in settings, never thrown.
- A cue changes only the view CamFrame already offers: Full screen, Compact position on the current display (seven places with a configurable margin), back to the previous Compact geometry, or a saved Scene by name. Settings choose what "Face full" and a bare "Face small" do.
- Requests are checked strictly: `Host` must be `127.0.0.1:47833` or `localhost:47833` (DNS rebinding), `Origin` must be the prompter's site (or its preview, `https://preview.prompter.techies.tools`, added 2026-10-31 so Lex can try a prompter build there first), a `localhost`/`127.0.0.1` page, `null` (file:// copies), or absent (local programs); cues are a JSON object of at most 1 KB with only the three known fields. Preflights answer Chrome's Private Network Access header.
- The protocol lives in `src/prompter-link.js` behind an injected `createServer`, like the other deep modules (ADR 0030); main applies cues through the existing geometry and Scene paths.

## Consequences

- CamFrame now has one network listener. It is local-only and opt-in, and its worst effect is moving or resizing the camera view.
- `Origin: null` is also what a sandboxed iframe on any web site sends, so while the link is on such a page could move the view or read the Scene names. Accepted: the effect is view-only and the link is off unless Lex turns it on.
- Browsers decide whether a public page may reach `127.0.0.1`: Chrome may ask once for permission to reach apps on this device; Safari may refuse. Operating-system firewalls normally do not prompt for a `127.0.0.1`-only listener, but this needs manual confirmation on Windows and macOS.
- Preferences schema 13 adds `prompterLink`, `prompterFaceFull`, `prompterFaceSmall`, and `prompterMargin`, all outside Scenes.
