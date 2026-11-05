# Prompter link API 2: sizes, places and layout Scenes

This is the guide for whoever drives CamFrame from the prompter (a person or the prompter's agent). It lists every request the Prompter link accepts, with real request and answer payloads, and the cues for Lex's livestream layouts. The rules are in `docs/data-contracts.md` (Prompter link HTTP contract), the decision is ADR 0035, and the code is `src/prompter-link.js` (wire checks) and `src/prompter-control.js` (what a request does).

API 2 needs a CamFrame build that contains it. Check before relying on it: `GET /camframe/status` answers `"api": 2`. An older CamFrame has no `api` field, refuses numeric sizes with `400`, and has no `/camframe/scenes` or `/camframe/small-size` (`404`).

## Basics

- Base address: `http://127.0.0.1:47833`, only while the Prompter link is on in CamFrame.
- `POST` bodies are JSON (`Content-Type: application/json`), at most 1024 bytes.
- Allowed pages: `https://prompter.techies.tools`, `https://preview.prompter.techies.tools`, `http://localhost[:port]`, `http://127.0.0.1[:port]`, `file://` copies, and local programs that send no `Origin`.
- `POST /camframe/scenes` and `POST /camframe/small-size` refuse `file://` copies (`Origin: null`, `403`). A `file://` copy may send cues, but its status has only `app`, `version`, `scenes` and `api`, and its cue answers have only `ok` and `cue`.
- Every answer is JSON. Success is `200 {"ok":true,…}` (except `GET /camframe/status`, which is the status object itself). A refusal is `{"ok":false,"error":"<plain English>","code":"<code>"}`:

| HTTP | `code` | Meaning |
| --- | --- | --- |
| 400 | `bad-request` | The request breaks a rule below; `error` says which. Nothing changed. |
| 404 | `unknown-scene` | No Scene has that name. Nothing changed. |
| 409 | `scene-exists` | A Scene with that name exists and `replace` was not `true`. |
| 409 | `scene-limit` | CamFrame already has 6 Scenes. Nothing was deleted. |
| 422 | `does-not-fit` | Even the smallest camera (180 px) does not fit the place asked for in a cue. Nothing changed. (A saved layout Scene that cannot fit on the display it is cued on is not refused: it answers `200` with `"clamped": true`, and CamFrame uses its saved size and place, kept on screen.) |
| 503 | `not-ready` | CamFrame's window is not open yet. |

Older errors (wrong host or page `403`, wrong method `405`, too large `413`, not JSON `415`) have no `code`.

## Words

- **Camera size**: the camera's size in screen pixels, 180–640. A circle or rounded square is `size` × `size`; portrait is 0.75 × `size` wide; landscape is `size` wide and 0.5625 × `size` tall.
- **Small size** (`smallSize` in the status): the size `"small"` restores. Scenes and Prompter cues never change it. Resizing CamFrame by hand with a corner handle sets it (just clicking or holding a corner does not), and so does `POST /camframe/small-size`. After upgrading, it starts as the size CamFrame had.
- **Place**: `top-left`, `top-right`, `bottom-left`, `bottom-right`, `left`, `right`, `center`, on the display the camera is on now (or still moving to, the one the last answer's `view.workArea` named). The camera sits `margin` px from the edges it touches (default: the Corner margin in CamFrame's settings, 32). `left` and `right` are vertically centred.
- **Point**: `{ "x": …, "y": … }`, the screen pixel for the camera's top-left corner, kept on the display that pixel is on (or the nearest one).
- **`withinRight`**: with `right`, `top-right` or `bottom-right`, a share of the display from 0.1 to 1. The camera and its margin (at least 18 px, the window border that always stays on screen) stay inside that share of the display's right side; a size that does not fit shrinks until it does, never below 180.
- **Layout Scene**: a Scene saved through `POST /camframe/scenes`. Applying it changes only the camera size and place, worked out again when applied: a place on the display the camera is on at that moment (or still moving to, the one the last answer's `view.workArea` named), a saved point on the display nearest that point. The camera, shape, style (frame, effect, colours) and crop stay as they are live. A Scene saved in CamFrame's own settings is a **snapshot Scene**: it also applies the camera and look it saved.

## `GET /camframe/status`

Read-only. The first three fields are the same as before API 2.

```json
{
  "app": "camframe",
  "version": "0.6.1",
  "scenes": ["Interview", "Live small corner", "Live right large"],
  "api": 2,
  "sceneLimit": 6,
  "smallSize": 288,
  "margin": 32,
  "activeScene": "Live right large",
  "view": {
    "mode": "compact",
    "visible": true,
    "settled": true,
    "size": 432,
    "shape": "circle",
    "camera": { "x": 1456, "y": 304, "width": 432, "height": 432 },
    "window": { "width": 468, "height": 534, "x": 1438, "y": 220 },
    "workArea": { "x": 0, "y": 0, "width": 1920, "height": 1040 }
  },
  "look": {
    "cameraLabel": "Logitech BRIO",
    "shape": "circle",
    "overlayResolution": "720p",
    "frameEffect": "glow",
    "effectColor": "#fb923c",
    "glowStrength": 90,
    "glowSpread": 13,
    "blurAmount": 12,
    "blurOpacity": 72,
    "borderWidth": 4,
    "borderColor": "#ffffff",
    "mirror": true,
    "cameraZoom": 100,
    "cameraPosition": { "x": 50, "y": 50 },
    "signature": "a92d323626979470"
  },
  "sceneDetails": [
    {
      "id": "preset-interview",
      "name": "Interview",
      "kind": "snapshot",
      "size": 400,
      "position": { "x": 28, "y": 104 },
      "savedSize": 400,
      "savedPosition": { "x": 10, "y": 20 },
      "keepsLiveLook": false,
      "look": { "cameraLabel": "Default camera", "shape": "circle", "…": "…", "signature": "45e96c0135dd6c51" }
    },
    {
      "id": "preset-mw20pcii",
      "name": "Live small corner",
      "kind": "layout",
      "size": 288,
      "followsSmallSize": true,
      "position": "bottom-right",
      "savedSize": 288,
      "savedPosition": { "x": 1582, "y": 636 },
      "keepsLiveLook": true
    },
    {
      "id": "preset-mw20pcij",
      "name": "Live right large",
      "kind": "layout",
      "size": 432,
      "followsSmallSize": false,
      "position": "right",
      "withinRight": 0.3,
      "savedSize": 432,
      "savedPosition": { "x": 1438, "y": 220 },
      "keepsLiveLook": true
    }
  ]
}
```

- `view.camera` is where the camera is heading, in screen pixels. `view.settled` is `false` while it is still moving there (about 0.3 s; at once with reduced motion). To verify a cue, read the status until `settled` is `true`, then compare `view.camera`.
- `view.window` is the whole CamFrame window, with its transparent border for the hover toolbar (18 px at the sides and bottom, 84 px on top).
- `view.workArea` is the display the camera is heading to, without the taskbar or menu bar.
- `look.signature` changes when the camera, shape, style or crop changes (the camera's device id counts but is not shown). Same signature, same look.
- `sceneDetails[].size` and `position` are what the Scene asks for: `position` is a place name, or else the camera's top-left point (the same form a cue's point takes, so a Scene saved at `{"x":1200,"y":100}` reports that point). `savedSize` and `savedPosition` (the window's top-left, 18 px left of and 84 px above the camera) are what it worked out on the display it was saved on. A snapshot Scene applies `savedSize` and `savedPosition`.
- `view` is `null` before CamFrame's window opens.

## `POST /camframe/cue`

Changes the view now. Every cue that worked before API 2 is still accepted.

| Field | Values | Notes |
| --- | --- | --- |
| `size` | `"full"`, `"small"`, or a camera size 180–640 | `"small"` is the small size. |
| `position` | a place, or a point `{x,y}` | Only with `"small"` or a number. |
| `margin` | 0–160 | Only with a place. |
| `withinRight` | 0.1–1 | Only with `right`, `top-right` or `bottom-right`. |
| `scene` | a Scene name, 1–40 characters, any case | `size` may be `"small"` or left out; nothing else goes with it. |

What each cue does:

- `{"size":"full"}`: Full screen, or the Scene chosen for Face full in CamFrame.
- `{"size":"small"}`: the Face small choice in CamFrame. By default ("Same place"): out of Full screen back to the previous place, at the small size; already in Compact mode, it shrinks or grows to the small size around the camera's centre. Either way the whole window stays on the display (a small size too big for it shrinks, and `layout.clamped` says so).
- `{"size":"small","position":"bottom-right"}`: the small size at that place.
- `{"size":432,"position":"right","withinRight":0.3}`: exactly 432 px (or less, to fit) at that place. It does not change the small size.
- `{"size":400,"position":{"x":1200,"y":100}}`: exactly 400 px with its top-left at (1200, 100), kept on screen.
- `{"size":400}`: 400 px around the camera's current centre.
- `{"scene":"Live right large"}`: applies that Scene.

A size or place cue is saved like any move and clears the active Scene, except a bare `"small"` that leaves the camera at the same size and place (for example back from Full screen to where it was): that keeps it. A Scene cue makes that Scene active.

Answer (real, 1920 × 1080 display):

```http
POST /camframe/cue
{"scene":"Live right large"}

200 {"ok":true,"cue":{"size":"small","scene":"Live right large"},"layout":{"size":432,"requestedSize":432,"clamped":false},"view":{"mode":"compact","visible":true,"settled":false,"size":432,"shape":"circle","camera":{"x":1456,"y":304,"width":432,"height":432},"window":{"width":468,"height":534,"x":1438,"y":220},"workArea":{"x":0,"y":0,"width":1920,"height":1040}}}
```

`cue` repeats the checked cue. `layout` (Compact cues only) gives the size used, the size asked for, and whether it had to shrink. `view` is the status `view` right after the cue.

## `POST /camframe/scenes`

Saves a layout Scene. It does not move the camera unless `apply` is `true`.

| Field | Values | Default |
| --- | --- | --- |
| `name` | 1–40 characters | required |
| `size` | `"small"` (follows the small size, now and later), `"current"`, or 180–640 | `"current"` |
| `position` | a place, a point `{x,y}`, or `"current"` | `"current"` |
| `margin` | 0–160, only with a place | CamFrame's Corner margin when applied |
| `withinRight` | 0.1–1, only with a right-hand place | none |
| `replace` | `true` to save over a Scene with the same name (keeps its id and place in the list) | `false` |
| `apply` | `true` to apply it right after saving | `false` |

The Scene keeps the size you ask for (`432`, even if a small display needs less, or `"small"`, which always means the small size) and the place name, so it fits whichever display it is applied on. With a point or `"current"`, it keeps that camera position on the display nearest to it, shrunk and kept on screen there if needed (for example after the small size grows).

Only the named Scene changes. Saving never deletes another Scene: past 6 Scenes the answer is `409 scene-limit`.

```http
POST /camframe/scenes
{"name":"Live right large","size":432,"position":"right","withinRight":0.3}

200 {"ok":true,"scene":{"id":"preset-mw20pcij","name":"Live right large","kind":"layout","size":432,"followsSmallSize":false,"position":"right","withinRight":0.3,"savedSize":432,"savedPosition":{"x":1438,"y":220},"keepsLiveLook":true},"replaced":false,"saved":{"size":432,"requestedSize":432,"clamped":false,"camera":{"x":1456,"y":304,"width":432,"height":432},"workArea":{"x":0,"y":0,"width":1920,"height":1040}}}
```

`saved.camera` is where the camera will be when this Scene is applied on that display. With `apply: true`, the answer also has `layout` and `view` as for a cue.

## `POST /camframe/small-size`

Sets the size `"small"` restores. It does not move the camera.

```http
POST /camframe/small-size
{"size":288}

200 {"ok":true,"smallSize":288}
```

`{"size":"current"}` uses the camera's size now.

## Lex's livestream layouts

- Branded pages with content on the left: larger camera on the right, vertically centred.
- Plugin and advisory screens: the original small camera, bottom-right.
- Same camera, style, shape and crop in both.

### One-time setup (with the camera at its original small size)

1. `GET /camframe/status`. Check `api` is `2`. Note `smallSize`, `view.camera` and `look.signature`. `smallSize` must be the original compact size (288 by default). If it is not, `POST /camframe/small-size {"size":288}` (or the original size) first.
2. Save the small Scene first, before enlarging anything:

   ```json
   {"name":"Live small corner","size":"small","position":"bottom-right"}
   ```

   On a 1920 × 1080 display with the default margin: `saved.camera` = `{"x":1600,"y":720,"width":288,"height":288}`.
3. Save the large Scene, 1.5 × the small size (288 × 1.5 = 432), kept inside the right 30%:

   ```json
   {"name":"Live right large","size":432,"position":"right","withinRight":0.3}
   ```

   On 1920 × 1080: `saved.camera` = `{"x":1456,"y":304,"width":432,"height":432}`. On 1280 × 720 the camera shrinks to 352 px (`"clamped": true`) to stay inside the right 30%.
4. If a Scene with either name already exists, the answer is `409 scene-exists`; repeat with `"replace": true` only if it should be overwritten. If the answer is `409 scene-limit`, delete an unused Scene in CamFrame first; nothing was deleted for you.

### Cues

| Prompter cue line | Request (`POST /camframe/cue`) |
| --- | --- |
| Branded page, content on the left | `{"scene":"Live right large"}` |
| Plugin or advisory screen | `{"scene":"Live small corner"}` |
| Same, with the older cue shape | `{"size":"small","position":"bottom-right"}` |

Both small cues give the same size and place, also after the large Scene: the small size, bottom-right. One difference: applying a Scene shows its name on the camera for about 1.6 s (CamFrame's existing Scene notice, as when a Scene is picked by hand); a size or place cue shows nothing. If the camera is captured on stream, use the size and place cue for a silent change. "Live small corner" follows the small size, so the two stay the same even after the small size changes. Each one-off request without a saved Scene also works: `{"size":432,"position":"right","withinRight":0.3}`.

### Checking a cue worked

After each cue, read `GET /camframe/status` until `view.settled` is `true`, then check:

- Large: `activeScene` is `"Live right large"`; `view.camera.x` ≥ `workArea.x + 0.7 × workArea.width`; `view.camera.y + view.camera.height / 2` is the work area's vertical middle (±1 px); `view.size` ≤ 1.5 × `smallSize`.
- Small: `view.size` equals `smallSize`; `view.camera.x + view.camera.width` = right edge − margin and `view.camera.y + view.camera.height` = bottom edge − margin.
- Both: `look.signature` is the one noted in step 1, and `smallSize` has not changed.
