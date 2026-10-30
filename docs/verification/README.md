# Verification strategy

CamFrame crosses browser media capture, GPU composition, native transparent windows, input forwarding, OS z-order, global shortcuts, startup registration, file dialogs, and packaging. No single test layer can validate all of it.

## Required layers

1. **Pure automated contracts** — run on every change and platform.
2. **Static UI/source contracts** — guard intentional markup/CSS/code structure, but treat them as weaker than behavior tests.
3. **Renderer smoke checks** — inspect all Overlay states and browser diagnostics.
4. **Electron integration checks** — exercise IPC and window lifecycle in a packaged-like runtime.
5. **Manual OS/hardware checks** — required for camera continuity, transparency/input, z-order, shortcuts, login startup, and installers.
6. **Artifact inspection** — confirm package contents, locale/font pruning, architecture, and release names.

Every execution gets a dated file under `runs/`; never overwrite the last known result.

## Current automated suite

Commands: `npm test` for 189 module and static contracts (167 behavioral through module interfaces with fakes, 22 static markup/CSS/wiring checks) and `npm run test:electron` for two real Electron integration smokes (Windows CI; they also run on a Linux X11/XWayland desktop).

| Coverage area | Tests demonstrate | Important limitation |
| --- | --- | --- |
| Preferences contract | `test/fixtures/preferences/` sanitize, load/migration, and Scene import cases; schema 13; Scene snapshot keys | Does not read/write a real Preferences directory |
| Scene library | Save (live position, limit, name/ID match), apply, numbered apply, cycle, delete, reorder, import notices, export format, active-Scene clearing | No dialogs/filesystem round trip or UI interaction |
| Overlay window geometry | Fake window/screen/clock sequences: placement, centering, Full screen enter/exit and Always on top restore, reduced motion, onboarding reserve in every mode (including the 2026-10-11 regression), moved/position saving, drag, corner resize, pass-through, `showCompact` from Full screen (with and without a Scene position, also during the exit animation), a move during the Full screen exit animation, Prompter link corner spots on several displays | Native BrowserWindow animation, displays, focus, and z-order are not exercised |
| Prompter link | `test/prompter-link.test.js`: off by default, documented port, `127.0.0.1` only, off closes the port (also when turned off in the same tick it was turned on, and on → off → on before the port opens reuses one server), busy port reported, origins (prompter site, localhost pages, `file://` copies as `Origin: null`) and hosts (`127.0.0.1`/`localhost`, rebound names refused) through the real server, preflight and Private Network Access, strict cue checks, 404/405/413/415, cue actions for Face full / Face small; `test/prompter-link-view.test.js`: what the settings switch, status line and toolbar button show for off, starting, on and a problem (a switched-off link always reads off, a switched-on one never does); the Electron smoke flips the link from the toolbar button and the settings switch and checks both follow and the port opens and closes; `kit shots` captures the toolbar button off/on/busy and checks both controls agree | Chrome's Local Network Access prompt, firewalls and Safari only by hand (W-30, M-12) |
| Bridge contract | `preload.cjs` run against a fake Electron matches every channel and transport; main rejects other senders and invalid arguments; renderer patches cannot change Scenes/onboarding/schema; QA fake completeness | Real IPC only in the Electron smoke |
| Camera session | Fake `mediaDevices`/tracks/videos: constraints (ADR 0028), overconstrained retry, missing-camera fallback, error copy, stale results, reuse, ordered quality changes, halo video, device scans, QA preview | No real camera, driver, frame, permission, or Chromium pipeline |
| Overlay interaction | Chrome/hide timing, activities holding interactivity, Full screen hotspot and delay, change-only messages | Real pointer forwarding is manual (W-08) |
| Onboarding | Versioning/migration, step copy, offer once, reveal timing, shape and framing demos, hand-over, Back/Next restore, Escape order, reduced motion, completion, timer cleanup (fake Overlay port, view, clock) | No automated BrowserWindow focus, tray click, or visual/layout observation |
| Camera framing | Pan direction/mirroring, wheel steps, shared CSS rendering | KG-10 is not yet asserted |
| UI/wiring contracts | Controls/tabs/copy exist; removed controls absent; CSS variables, clip paths, high contrast, reduced motion; shortcut/tray text; a few `overlay.js` wiring lines | Regex over source; presence is not functionality |

The Electron smoke launches the actual main process with an isolated Preferences directory and Chromium's synthetic camera. It verifies the BrowserWindow/preload/IPC path, onboarding completion, Inline Camera settings, one Camera quality across Full screen, native compact/Full screen bounds, live reduced-motion and forced-color propagation, and the absence of renderer errors. A second smoke turns the Prompter link on from Preferences and drives it over HTTP on `127.0.0.1:47833` (it fails at once when that port is already busy, for example with CamFrame running): status lists the Scenes, `{size:"full"}` reaches the display bounds, `{size:"small",position:"bottom-right"}` puts the camera 40 px from the work-area corner, a Scene cue applies its bounds and makes it active, a placed cue clears the active Scene and saves its position to `preferences.json`, an unknown Scene answers 404, and turning the link off closes the port. Together they write four PNGs under `qa/electron-smoke/` (`04-prompter-bottom-right.png` is the link's); Windows CI retains them as the `camframe-electron-smoke-windows-x64` artifact. It does not replace any manual OS/hardware row.

Also run:

```bash
for f in src/*.js scripts/*.mjs; do node --check "$f"; done
node --check src/preload.cjs
git diff --check
```

## Manual Windows matrix

Record Windows version/build, GPU, display topology/scaling, camera models/drivers, Electron/app version, packaged vs development mode, observer, and evidence path.

| ID | Check | Expected result |
| --- | --- | --- |
| W-01 | Fresh launch with camera permission undecided | Overlay starts visible/topmost; permission appears; accepting starts video |
| W-02 | Deny permission, then enable desktop camera permission | Helpful blocked state; relaunch/retry works after OS permission change |
| W-03 | One camera, then attach/remove another | Device list updates; unlabeled devices have stable fallback labels |
| W-04 | Saved camera missing on launch | Selection clears and default camera starts |
| W-05 | Camera already used exclusively elsewhere | “already in use” state is visible in the Overlay |
| W-06 | Drag Overlay on each display/scaling factor | Pointer offset remains stable; final position persists after relaunch |
| W-07 | Resize all four corners for all shapes | Aspect ratio holds, opposite corner anchors, limits are 180–640 |
| W-08 | Hover then leave Overlay | Toolbar/handles appear; compact chrome clears without leaving a blocking rectangle |
| W-09 | Click underlying apps around curved/transparent regions | Input behavior matches the documented whole-window interactive state; record any blocked transparent pixels |
| W-10 | Cycle shapes | Circle, Square, Portrait, Wide geometry and clipping match spec |
| W-11 | Frame, Glow, Progressive blur at min/default/max | Effects stay outside surface; no clipping; contextual controls and colors work |
| W-12 | Mirror plus framing drag | Visible horizontal motion follows pointer in both mirror states |
| W-13 | Framing scroll/reset | 5% steps, 100–250%; double-click returns 100%/center only |
| W-14 | Enter/exit Full screen on every display | Correct display bounds, 280 ms transition, no stale compact chrome, compact bounds restore |
| W-15 | Full screen toolbar inactivity/recovery | Hides after ~200 ms; returns in padded hotspot; stays for settings/framing |
| W-16 | Rapid Full screen toggles | Final UI and bounds agree; the track profile is unchanged; no stuck animation |
| W-17 | Multiple cameras including Elgato during W-14/W-16 | Never shows another device, stale/unrelated frame, or black frame; confirm no mode-change constraint application |
| W-18 | Camera quality choices, including unsupported high profiles | Working feed remains stable; a rejected user quality change preserves the current profile |
| W-19 | Save/update/rename/reorder/delete six Scenes | Live position captured; ordering/numbering accurate; seventh-save behavior understood |
| W-20 | Scene apply in compact and Full screen | Compact transition animates; Full screen remains transient; notice appears 1.6 s |
| W-21 | Export/import canonical, bare array, legacy `presets`, invalid JSON, duplicate name/ID, over-capacity | Merge/error behavior matches data contracts; unrelated local Scenes remain |
| W-22 | All global shortcuts, including conflicts | Successful shortcuts work globally; collisions are silent; tray fallback works |
| W-23 | Toggle Always on top and overlap taskbar/other topmost apps | Current `screen-saver` behavior is recorded; controls remain recoverable after focus loss |
| W-24 | Hide via shortcut/tray, then relaunch | Hides during session; relaunch forces visible/topmost |
| W-25 | Packaged Start at login on/off | Registration changes only packaged app and survives sign-out/sign-in |
| W-26 | Tray open/double-click/Scene/show/quit | “Open controls” reveals Inline settings; the Overlay remains the only window |
| W-27 | Quit from toolbar and tray | Camera tracks stop and Preferences are synchronously flushed |
| W-28 | Fresh profile onboarding, Skip/completion, restart, and tray Help | Four coach marks appear above the unchanged six-button Toolbar with four visible progress segments and the target in its hover treatment; opening/closing the guide does not move the Toolbar, Camera, handles, or normal settings on screen; Camera and Scenes open to the matching section only after the coach mark paints; Shape cycles three times and framing demonstrates pan/zoom/reset with a ghost mouse; hover/interaction stops automation and adopts the current state; navigation without takeover restores starting state; reduced motion suppresses demos; framing exits via Crosshair or Escape without dismissing the guide; completion persists; existing profile does not auto-open; Help reopens |
| W-29 | Toggle Windows contrast themes and Animation effects while CamFrame is running; repeat Full screen and visible compact Scene apply with NVDA | Controls/status remain readable with explicit boundaries, selection, and focus; selected swatch has a check; turning motion off suppresses renderer motion and finishes native bounds immediately at exact final geometry; NVDA state/name announcements remain usable |
| W-30 | Prompter link (KG-13): turn it on (once from the toolbar's scroll button, once in Scenes settings), open https://prompter.techies.tools in Chrome and Edge, tick its CamFrame box, scroll past `[Face full]`, `[Face small, bottom right]` and `[Face: <Scene>]` lines; repeat from a `file://` copy; turn the link off | Chrome/Edge ask once for local network access, then cues switch the view; no Windows Defender Firewall prompt for the `127.0.0.1` listener; corner spots are right with mixed scaling, a display left of or above the primary one and a side taskbar; off closes the port (the prompter shows not found); the toolbar button and the settings switch always agree, and a second CamFrame-like listener on 47833 shows the orange dot |

## Manual macOS matrix

Run on both Apple Silicon and Intel artifacts where supported.

| ID | Check | Expected result |
| --- | --- | --- |
| M-01 | Fresh install/launch and camera permission | Camera usage copy is shown; camera starts after consent |
| M-02 | Permission denied | Error and onboarding name System Settings/CamFrame; relaunch/retry works after permission changes |
| M-03 | Overlay/Dock/tray lifecycle | Dock icon stays hidden; tray anchors process; no orphan normal window |
| M-04 | Always on top and spaces/full-screen apps | `floating` level behavior and limitations are recorded |
| M-05 | Drag/resize/multi-display/Retina | Geometry, saved logical coordinates, and hit behavior remain stable |
| M-06 | Full screen/camera continuity | Same checks as W-14–W-18 |
| M-07 | `Cmd` shortcut variants | All documented shortcuts and collision fallback work |
| M-08 | Packaged Start at login | Login item targets CamFrame and toggles correctly |
| M-09 | DMG/ZIP Gatekeeper behavior | Unsigned warning is expected and documented; app launches after user approval |
| M-10 | Fresh profile onboarding, keyboard focus, Skip/completion, and tray Help | Same contextual behavior as W-28 with `Cmd` shortcut copy and VoiceOver announcements |
| M-11 | Toggle Increase contrast and Reduce motion while CamFrame is running; repeat Full screen and visible compact Scene apply with VoiceOver | Boundaries/selection/focus/status remain distinct; renderer motion stops; native bounds complete immediately at exact final geometry; VoiceOver state/name announcements remain usable |
| M-12 | Prompter link (KG-13) as W-30 in Chrome, then in Safari | Chrome asks once and cues work; no macOS firewall prompt; record whether Safari reaches `http://127.0.0.1` from the https page (if refused, Chrome or Edge is the supported pairing); corner spots right with the Dock on the side |

## Renderer visual-state set

Capture at minimum:

- Each compact shape, idle and hovered.
- Camera/Style/Scenes Inline settings.
- Glow and Progressive blur controls at defaults and extrema.
- Framing mode at 100% and 250%.
- Full screen toolbar visible and hidden.
- Camera starting, permission blocked, busy, no devices, and generic error states.
- Scene notice and six-Scene management state.
- Onboarding coach marks 1–4 at default Circle and minimum Wide dimensions, including target alignment and keyboard focus states.
- Reduced-motion and high-contrast modes, including selected controls, keyboard focus, status, Scene notice, onboarding progress, and selected effect swatch.

Browser-only QA is useful for markup/CSS, but it does not represent native transparency, media permissions, Electron IPC, or z-order.

## Artifact inspection

For every release candidate, record:

- exact dependency versions and clean `npm ci`;
- tests before packaging;
- artifact filenames, architecture, byte size, and SHA-256;
- ASAR contents limited to `src/**/*` and `package.json`;
- only `en-US.pak` under locales;
- Phosphor font and license files included; removed Controller-only Inter assets absent;
- macOS `NSCameraUsageDescription` present;
- Windows NSIS and portable launch results;
- macOS DMG and ZIP launch results;
- whether signing/notarization is intentionally absent.

## Result vocabulary

- **Pass**: observed outcome met the recorded expectation.
- **Fail**: repeatable mismatch; link issue/experiment and preserve evidence.
- **Inconclusive**: test ran but environment/evidence could not distinguish outcomes.
- **Blocked**: test could not start because a named prerequisite was unavailable.
- **Not run**: no attempt was made. Never convert this to Pass based on source inspection.
