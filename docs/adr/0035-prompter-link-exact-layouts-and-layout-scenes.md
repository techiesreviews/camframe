# ADR 0035: Prompter link API 2: exact layouts, layout Scenes and a fixed small size

## Status

Accepted — 2026-11-04 (Lex's request for Prompter-controlled livestream layouts). Supersedes in part ADR 0031 (its two routes, three cue fields and view-only effect). The review history is in `docs/verification/runs/2026-11-04-prompter-layout-scenes-review-fixes.md`.

## Context

Lex's livestream needs two camera layouts driven from the prompter: on branded pages with content on the left, a larger camera on the right, vertically centred; on plugin and advisory screens, the original small camera bottom-right. Camera, style, shape and crop must stay the same in both.

ADR 0031's cues could pick a place or a Scene but not a size. A Scene stores the whole look as well as the geometry, so a Scene saved before a camera or style change would bring the old look back mid-stream. And a bare `"small"` meant "whatever size the Overlay has now", so after a larger Scene, `"small"` stayed large. The prompter also had no way to check what CamFrame actually showed.

## Decision

- `POST /camframe/cue` also takes a camera size in pixels (180–640), a point `{x,y}` for the camera's top-left, `margin` for a place, and `withinRight` (a 0.1–1 share of the display's right side the camera must fit in; it shrinks, never below 180, and refuses with `422 does-not-fit` when that is impossible). Every ADR 0031 cue keeps its shape.
- `"small"` means a stored **small size** (`prompterSmallSize`, schema 14), never the current size. Scenes and Prompter cues do not change it; resizing the Overlay by hand and `POST /camframe/small-size` do. An upgraded document starts with its own `size`. Only a corner the pointer has moved counts as a resize by hand (holding one still changes nothing); when the pointer first moves, a move still running ends at its target and the drag starts from there, so the size saved by hand is always the size on screen. A cue or Scene that moves the window during a drag already under way ends that drag, so the cue's size stays and the drag saves nothing.
- A bare `"small"` cue is planned like any size cue, from Full screen (around the place Full screen returns to: a position a Scene stored while in Full screen, else where the Overlay was before Full screen, which is the real window place, on that place's display) as in Compact mode, so the whole window stays on the display and `clamped` is reported truthfully. When it lands at the same size and place it commits nothing, so the Active Scene stays; otherwise, like any size or place cue, it clears the Active Scene.
- `POST /camframe/scenes` saves a **layout Scene**: the Scene record gets an optional `layout` (`size`, place, `margin`, `withinRight`). `size: "small"` is stored as `"small"` and follows the small size, so the small Scene and a `"small"` cue always agree. Applying one, from any entry point, changes only size and place, planned again on the display the Overlay is on or heading to (a place) or on the display nearest its saved camera point (no place; exact cue points too), kept on screen there, and keeps the live camera, shape, appearance and framing. `settings` stays a full snapshot so export, import and older builds still work; an older build that saves drops `layout` and `prompterSmallSize` (KG-14).
- Left, right and center keep the camera vertically centred: the size is capped so the centred camera leaves room for the top toolbar (camera height at most the work area height less twice the 84 px top chrome), instead of sliding down.
- A Scene applied in Full screen (tray, shortcut) with a place is where leaving Full screen lands.
- Saving through the link never evicts: a new name past six Scenes is `409 scene-limit`, an existing name needs `"replace": true` (`409 scene-exists` otherwise), and replacing keeps the Scene's id and order.
- `GET /camframe/status` keeps `app`, `version` and `scenes` and adds `api: 2`, the small size, the active Scene, the live view (camera and window bounds where the window is heading, plus `settled`), the look without the camera's device id plus a signature over the whole look, and per-Scene details (`position` is a place name, or else the camera's top-left point, the form a cue's point takes; `savedPosition` is the window's top-left).
- Refusals carry a machine-readable `code`. The two saving routes refuse `Origin: null`; cues still accept it.
- `src/prompter-control.js` holds what a request does, against injected geometry and state, so the whole flow is tested in Node; `main.js` only wires it.

## Consequences

- An allowed page can now also add or overwrite layout Scenes (never delete one, never past six) and change the small size, while the link is on. Sandboxed iframes and file:// copies (`Origin: null`) cannot.
- An allowed page can read the camera's label (its model name), the look and the display layout. The device id stays in CamFrame. `Origin: null` reads only the API 1 fields (`app`, `version`, `scenes`) plus `api`; its cue answers are `ok` and `cue` only, and its does-not-fit refusals carry no share or margin. Accepted: whether a cue succeeds or is refused, and the visible camera move, still say a little about the display.
- UI-saved Scenes are unchanged: they still store and apply the whole look. Saving over a layout Scene from Inline settings turns it into a snapshot Scene.
- Resizing by hand while a large layout is showing makes that the new small size (KG-14).
