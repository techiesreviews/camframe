# ADR 0040: Keep the Prompter link open as a public interface

## Status

Accepted — 2026-11-15 (Lex, Orbit TOOLS-295, finding S3 of the 2026-11-15 architecture review); written down 2026-11-21. Changes no behaviour: it records why the access ADR 0031 and ADR 0035 already grant stays as it is.

## Context

The 2026-11-15 architecture review (finding S3, low) pointed out that while the Prompter link is on, any web site can switch the camera to Full screen, move or resize it, or apply a Scene by name: a sandboxed frame on any site sends `Origin: null`, the same origin as a `file://` copy of the prompter, and the link accepts it for cues. Saving and the display layout were already refused to that origin. The review offered to close the gap with a "file copy allowed" switch, off by default, so only the prompter site and local pages could cue.

Lex decided against closing it (2026-11-15): "Yes and camframe position switcher should be open for anyone so they can build tools to manipulate that if needed." He also uses a downloaded `file://` copy of the prompter, which a closed link would lock out.

## Decision

The Prompter link stays open on purpose. It is a public interface on this computer: the prompter is one caller, and anyone may build other tools on it (scripts, stream deck buttons, a page of their own). The checks in `src/prompter-link.js` stay exactly as they are.

### Who may call it

| Caller | What it gets |
| --- | --- |
| A program on this computer that sends no `Origin` (curl, a script, a stream tool) | Everything: all routes and the full status |
| `https://prompter.techies.tools` | Everything |
| A page served from `http://localhost[:port]` or `http://127.0.0.1[:port]` (any port) | Everything |
| A page that sends `Origin: null`: a `file://` copy of the prompter or of any page, or a sandboxed frame on any web site | Cues only. Its status has only `app`, `version`, `scenes` (the names) and `api`; its cue answers have only `ok` and `cue`, never the display layout; saving a Scene or the small size answers `403` |
| Any other web page | Nothing: `403`, no CORS headers |

Every request must also name the link itself as its `Host` (`127.0.0.1:47833` or `localhost:47833`), which stops a web page that points its own name at `127.0.0.1` (DNS rebinding).

### What it accepts

`docs/prompter-link-api.md` has every request with real payloads, and `docs/data-contracts.md` (Prompter link HTTP contract) the exact rules. In short:

- `GET /camframe/status`: what CamFrame shows (mode, camera size and place, the display it is on), the small size, the look, and the Scenes.
- `POST /camframe/cue`: Full screen; Compact mode at the small size or a camera size of 180–640 px; at one of seven places (with a margin, and `withinRight` for a right-hand place) or an exact screen point; or a saved Scene by name.
- `POST /camframe/scenes`: save a layout Scene (a name, a size and a place), optionally applying it.
- `POST /camframe/small-size`: set the size "small" restores.

Each `POST` body is a JSON object of at most 1024 bytes with only the known fields; anything else is refused and changes nothing.

### What it does not allow

- No access from another computer: the link listens on `127.0.0.1` only.
- Nothing while the link is off. It is off by default and listens only while its saved choice is on, which only Lex's toolbar Prompter link button changes. The choice is saved, so it stays on after a restart until he turns it off; turning it off, or quitting, closes the port.
- No camera, shape, style (frame, effect, colours), crop, mirror, zoom or Camera quality of its own. Applying a saved Scene by name applies only what that Scene already holds; a layout Scene keeps the live look.
- No deleting, renaming (beyond the spelling change below) or reordering Scenes. Saving never deletes another Scene: a seventh Scene is refused (`409 scene-limit`). Saving over an existing name needs `"replace": true`, and then it does replace that Scene, also one saved by hand in CamFrame, with a layout Scene. The replacement keeps the Scene's id and place in the list but takes the name as sent, so a name that matches in another spelling (for example "demo" for "Demo") changes how the name is written.
- A cue never changes a saved Scene: a cue that moves the camera clears the active Scene instead of saving into it.
- No other settings: not Face full, Face small or the Corner margin, not the Prompter link itself, not click-through, always on top or onboarding. It cannot hide CamFrame or quit it.
- No pictures: it never records, streams or reads the camera's video, and the status shows the look without the camera's device id (the camera's label is shown), plus a hash of the whole look.
- No log of requests.

## Consequences

- While the link is on, a local program, a local page or a sandboxed frame on any web site Lex visits can switch the view or apply a Scene, for example in the middle of a livestream. Accepted: it only changes the view, and Lex turns the link off with the toolbar button to stop it. Local programs and local pages can also save layout Scenes and the small size; that keeps the access ADR 0035 gave them.
- Tools other than the prompter may rely on this interface. A change that narrows who may call it, or what a request does, is a decision for Lex in a new ADR, not a quiet hardening. New capabilities stay behind the `api` number in the status.
- A future "file copy allowed" switch (the review's option) would reverse this decision; it is not planned.
