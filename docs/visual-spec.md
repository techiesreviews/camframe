# Visual specification

This file records the reachable visual system based on v0.4.3 at commit `fe8e6c6`, plus the unreleased onboarding surface. CSS remains the pixel-level implementation evidence; these values are the minimum contract for a source-independent reconstruction. The dormant Controller is summarized separately so it is not confused with the live UI.

## Reachable Overlay coordinate system

The outer native window is transparent. In Compact mode, the camera starts at `(18 px, 84 px)`. The outer window extends 18 px to each side, 84 px above, and 18 px below the camera. All toolbar/settings coordinates are relative to that outer window.

| Element | Position and size | Layer |
| --- | --- | --- |
| Camera effect | Same bounds as camera surface; outside overflow visible | Below camera |
| Camera surface | Left 18, top 84, shape-derived dimensions | Base visible surface |
| Toolbar | Top 22, horizontally centered over active camera; 196×44 max | Above camera |
| Resize handles | 14×14, centered 7 px outside each camera corner | Camera layer |
| Inline settings | Top 76; centered; width min(240, camera width − 28); max height outer height − 76 | Above toolbar/camera (`z-index:4`) |
| Onboarding | In a temporary 220 px native reserve above the compact origin; 12 px above Toolbar; width min(244, outer width − 16) | Modeless coach mark (`z-index:10`) |
| Scene notice | Centered near camera bottom at `camera top + height − 46`; max camera width − 32 | Foreground (`z-index:5`) |

In Full screen, the camera surface becomes `inset:0`, width/height 100%, square corners, and no clip rounding. `active-camera-left` becomes 0 and width becomes 100%, so toolbar/settings center on the display. Resize handles and frame effects disappear.

## Typography and assets

- Reachable Overlay UI uses `Segoe UI Variable`, then `Segoe UI`, then sans-serif.
- Labels are generally 500 weight at 11/16 px; controls use 10–11 px; icons are 20 px.
- Phosphor is embedded as `Phosphor.woff2` with ligature-style glyph mappings. Toolbar glyphs, in order: `x-circle`, `corners-out`, `circle`, `crosshair`, `sliders-horizontal`.
- The framing status uses 9/12 px secondary copy and 600 weight 11/13 px for the live Zoom line.
- The dormant Controller uses embedded Inter Variable with OpenType features `cv02`, `cv03`, `cv04`, `cv11`, `ss01`, and `ss03`.

## Core palette

| Role | Value |
| --- | --- |
| Camera/loading surface | `#18181b` |
| Toolbar and near-opaque panels | `#0c0c0d`; panels use 96% alpha |
| Field surface | `#202023` |
| Selected tab | `#27272a` |
| Slider track | `#3f3f46` |
| Primary text | `#f4f4f5` / `#fafafa` |
| Secondary label | `#a1a1aa` |
| Muted text/icon | `#71717a` / `#8b8b90` |
| Hover icon | `#e5e5e5` on `#19191b` |
| Focus accent | `#fb923c` |
| Hairline borders | white at 6–14% alpha |
| Panel shadow | `0 12px 32px rgb(0 0 0 / 42%)` |

## Camera surface

- Video fills width/height with `object-fit: cover`, has no pointer events, and transforms on the GPU.
- Surface background is `#18181b`; frame is an inset zero-blur box shadow using `--frame-width` and `--frame-color`.
- Circle uses 50% radius/clip, Square 16%, and Portrait/Wide 12%.
- The camera/effect geometry transitions for 280 ms with `cubic-bezier(0.65, 0, 0.35, 1)` except during resize or reduced motion.
- At camera startup/error, an opaque `#18181b` state covers the surface with centered 13 px white copy and a 14 px spinner. Spinner border is 2 px and rotates every 0.8 s.

## Toolbar and direct-manipulation chrome

- Normal toolbar width is `min(196 px, active camera width − 8 px)`, with 4 px padding, 2 px button gaps, 10 px radius, and solid `#0c0c0d` background.
- Each button is 36×36 px, 8 px radius, transparent by default. Selected buttons use an inset 1.5 px `#eeeeef` outline. Keyboard focus uses a 2 px orange outline with 1 px offset.
- Hidden toolbar state is opacity 0, pointer-events none, translated down 4 px. Visible state is opacity 1/translation 0. Fade is 120 ms; translation is 160 ms.
- Framing mode hides all buttons except crosshair, expands the toolbar to `min(240 px, camera width − 8 px)`, left-aligns content with 8 px gap, and adds 10 px right padding.
- Resize handles are `#18181b`, with 2 px 92%-white borders and 3 px radius. They are invisible/non-interactive until hover/resize and never appear Full screen.

## Inline settings

- Panel: 10 px padding, 8 px grid gap, 12 px radius, 1 px 10%-white border, 96%-opaque `#0c0c0d`, and vertical overflow as needed.
- Tabs: three equal columns in a 3 px gap/padding group, 9 px group radius, 5%-white background. Buttons are 28 px high with 6 px radius; selected tab uses `#27272a` and a 7%-white inset hairline.
- Selects and text inputs are 30 px high with 7 px radius, `#202023` background, and a 12%-white inset outline. Standard horizontal padding is 9 px.
- Glow hex input is 68×30 px, uppercase 10 px monospace. Six swatches are 18×18 px with 5 px radius and 4 px gaps: orange `#fb923c`, cyan `#22d3ee`, violet `#8b5cf6`, pink `#ec4899`, green `#22c55e`, white `#ffffff`. Selected swatch has a 2 px white outline plus 1 px offset.
- Sliders have a 3 px `#3f3f46` pill track and 12 px `#f4f4f5` circular thumb. Output uses tabular 10 px numerals.
- Scene action buttons are 30 px high; management grids use three equal columns for order/delete and two for import/export. Disabled controls use opacity 0.42.
- Toggle rows have 7 px vertical padding and subtle separators. Checkboxes use the browser control with orange accent.
- Scene keyboard hints are muted 10/14 px; `<kbd>` chips have 1×4 px padding, 4 px radius, hairline border, and `#202023` background.

## Onboarding

- The modeless coach mark uses a 12 px radius, 8 px padding, 6 px grid gap, `#0c0c0d` background, and a 12%-white hairline without a shadow.
- A downward 12 px arrow points toward the current Toolbar control. The coach mark ends 12 px above the Toolbar inside a temporary 220 px transparent top reserve.
- The real target receives a 2 px orange outline with a 3 px offset plus the Toolbar's normal hover treatment: `#e5e5e5` icon color on `#19191b`. No dimming blocker is rendered; Toolbar, Inline settings, Camera surface, resize handles, and Scene notice remain available.
- The header pairs an 11/16 px muted “Getting started” label with a compact 24 px ghost Skip button. Beneath it, four 3 px line segments with 4 px gaps show cumulative progress: completed/current segments are orange `#fb923c`, upcoming segments are `#3f3f46`. Numeric position is exposed through progressbar semantics but is not visible text.
- The current heading is 18 px/1.25 at weight 600. Explanatory copy is 14/19 px, with optional 12/17 px muted platform/help notes.
- Back is a secondary `#202023` button; Next/Done is the only filled orange primary action. All actions are 34 px high with 7 px radii and 2 px orange focus outlines.
- Every step first paints the unchanged five-button Toolbar at its normal screen position beneath the coach mark, with settings closed and framing off. Step 1 targets Settings for Camera; step 2 targets Shape; step 3 targets Crosshair; step 4 targets Settings for Scenes.
- After that first paint, steps 1 and 4 automatically open the appropriate settings panel 12 px below the 44 px Toolbar with an independently scrollable remainder. Camera or Scenes is selected to match the coach mark. Clicking Crosshair may change the Toolbar only after the framing explanation is already visible. Back/Next restores the standard transient Toolbar state before the next coach mark appears.
- The framing copy names both exits. When framing is active, clicking Crosshair again or pressing Escape restores the standard Toolbar while leaving the current coach mark visible.
- Shape and framing demos use an 18×26 px dark mouse with a white 1.5 px outline, orange wheel/click pulse, 9 px radius, and subtle black shadow. It sits above Camera/settings but below the coach mark, accepts no input, and is hidden from accessibility APIs.
- Shape plays three approach/click gestures and cycles the real frame after each click. Framing loops a drag across the Camera, four scroll-wheel ticks with live zoom, and a double-click reset. Hover/focus/real interaction hides the ghost mouse immediately and leaves the real control active at the current adopted state.
- Under `prefers-reduced-motion: reduce`, the ghost mouse is not displayed and no automatic Shape/framing state changes run.
- At the default 324×390 px Circle, onboarding temporarily makes the native window 324×610 and moves its origin up 220 px. In enlarged-window coordinates, a 183 px coach mark occupies y=47–230, the Toolbar y=242–286, Inline settings begins at y=298, and the Camera begins at y=304. Relative to the unchanged compact screen origin, the Toolbar remains y=22–66, Inline settings begins at y=78, and the Camera remains y=84; the coach mark occupies y=−173–10 above them.
- Step changes and open/close have no new animation. The current heading receives focus after each step change.

## Effects

Glow renders two `drop-shadow()` layers: a near radius equal to 40% of configured spread (minimum 1 px) at an 88%-color mix and a far radius equal to spread at 58%; the layer opacity equals strength. Its hidden source is a solid effect color.

Progressive blur renders the live second video through `blur(configured px) saturate(1.18)` with configured opacity. Both effect sources use the same shape clip as the camera, but their filters overflow outside it. The opaque camera surface covers the inside portion.

## Scene notice

The notice has 7×10 px padding, 8 px radius, 10%-white border, 88%-opaque `#0c0c0d`, `0 8px 20px` black/28% shadow, white 600 weight 11/16 px text, ellipsis, and no input. It appears with a 140 ms fade/up animation and is removed after 1.6 s.

## Motion and timing

| Motion | Timing |
| --- | --- |
| Native bounds Full screen/Scene transition | 280 ms, cubic ease-in-out helper |
| Camera/effect geometry transition | 280 ms, cubic-bezier(0.65,0,0.35,1) |
| Toolbar fade/slide | 120/160 ms |
| Compact hover hide | 220 ms |
| Full screen toolbar hide | 200 ms |
| Scene notice entrance/lifetime | 140 ms / 1600 ms |
| Drag/resize/native animation polling | ~16 ms interval |

`prefers-reduced-motion: reduce` removes spinner animation, camera/effect/toolbar/handle transitions, and notice animation. Native main-process bounds interpolation does not inspect the CSS media preference and therefore still runs.

## Dormant Controller visual reference

If preserving source parity, the dormant Controller is a dark 404×720 px window (minimum 360×620) with `#09090b` background, 20×24 px shell padding, Inter Variable typography, a 22 px “CamFrame” heading, green Live badge, shape preview, and the same Camera/Style/Scenes grouping. Orange is the focus/primary-action accent. It is not part of the reachable v0.4.3 visual acceptance set unless a later ADR activates it.

## Visual evidence still missing

No durable screenshots are checked into this baseline. Both the v0.4.3 browser smoke and the unreleased onboarding capture attempt were inconclusive. A future verified run should capture the state set in `verification/README.md`, store stable assets outside ignored `qa-*.png` paths, and link them here with OS/scaling metadata.
