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

Command: `npm test` (`node --test`). Current count: 46 tests in `test/settings.test.js`.

| Coverage area | Tests demonstrate | Important limitation |
| --- | --- | --- |
| Settings safety | Defaults, whitelists, clamps, camera crop/zoom, resolutions, startup override | Does not read/write a real Preferences directory |
| Geometry | Shape dimensions, outer chrome, resize anchoring, region bounds, pan direction | Native BrowserWindow shape/input is not exercised |
| Camera | Device filtering, stream reuse predicate, constraints, motion hint, profile apply/failure | No real camera, driver, frame, permission, or Chromium pipeline |
| Scenes | Snapshot inclusion/exclusion, live position capture, cap/sanitize, reorder, merge | No dialogs/filesystem round trip or UI interaction |
| UI contracts | Controls/tabs/copy/selectors exist; removed controls/effect absent; CSS variables/clip paths exist | Mostly regex over source; presence is not functionality |
| Presentation | Shortcut/tray/notice implementation text exists | Shortcuts/tray are not registered or clicked in a test runtime |
| Full screen | Copy, Escape predicate, plan, interpolation, toolbar timing/hotspot, blur-handler text | No native window animation, display, focus, z-order, or video continuity |
| Onboarding | New/existing Preferences decision, bounded steps, target/reveal mapping, platform copy, schema/Scene exclusion | No automated BrowserWindow focus, tray click, or visual/layout observation |

Also run:

```powershell
node --check src/main.js
node --check src/overlay.js
node --check src/control.js
node --check src/settings.js
node --check src/cameras.js
node --check src/fullscreen.js
node --check src/onboarding.js
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
| W-05 | Camera already used exclusively elsewhere | “already in use” state is visible and Controller relay is not assumed |
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
| W-16 | Rapid Full screen toggles | Final UI/profile agree; no stuck animation or wrong bounds |
| W-17 | Multiple cameras including Elgato during W-14/W-16 | Never shows another device, stale/unrelated frame, or black frame; log frame/profile telemetry |
| W-18 | Camera without requested 4K profile | Working feed remains stable; no stream loss |
| W-19 | Save/update/rename/reorder/delete six Scenes | Live position captured; ordering/numbering accurate; seventh-save behavior understood |
| W-20 | Scene apply in compact and Full screen | Compact transition animates; Full screen remains transient; notice appears 1.6 s |
| W-21 | Export/import canonical, bare array, legacy `presets`, invalid JSON, duplicate name/ID, over-capacity | Merge/error behavior matches data contracts; unrelated local Scenes remain |
| W-22 | All global shortcuts, including conflicts | Successful shortcuts work globally; collisions are silent; tray fallback works |
| W-23 | Toggle Always on top and overlap taskbar/other topmost apps | Current `screen-saver` behavior is recorded; controls remain recoverable after focus loss |
| W-24 | Hide via shortcut/tray, then relaunch | Hides during session; relaunch forces visible/topmost |
| W-25 | Packaged Start at login on/off | Registration changes only packaged app and survives sign-out/sign-in |
| W-26 | Tray open/double-click/Scene/show/quit | “Open controls” reveals Inline settings; no separate Controller appears |
| W-27 | Quit from toolbar and tray | Camera tracks stop and Preferences are synchronously flushed |
| W-28 | Fresh profile onboarding, Skip/completion, restart, and tray Help | Four coach marks appear above the unchanged five-button Toolbar with four visible progress segments and the target in its hover treatment; opening/closing the guide does not move the Toolbar, Camera, handles, or normal settings on screen; Camera and Scenes open to the matching section only after the coach mark paints; Shape cycles three times and framing demonstrates pan/zoom/reset with a ghost mouse; hover/interaction stops automation and adopts the current state; navigation without takeover restores starting state; reduced motion suppresses demos; framing exits via Crosshair or Escape without dismissing the guide; completion persists; existing profile does not auto-open; Help reopens |

## Manual macOS matrix

Run on both Apple Silicon and Intel artifacts where supported.

| ID | Check | Expected result |
| --- | --- | --- |
| M-01 | Fresh install/launch and camera permission | Camera usage copy is shown; camera starts after consent |
| M-02 | Permission denied | Error and onboarding name System Settings/CamFrame; relaunch/retry works after permission changes |
| M-03 | Overlay/Dock/tray lifecycle | Dock icon stays hidden; tray anchors process; no orphan normal window |
| M-04 | Always on top and spaces/full-screen apps | `floating` level behavior and limitations are recorded |
| M-05 | Drag/resize/multi-display/Retina | Geometry, saved logical coordinates, and hit behavior remain stable |
| M-06 | Full screen/profile/camera continuity | Same checks as W-14–W-18 |
| M-07 | `Cmd` shortcut variants | All documented shortcuts and collision fallback work |
| M-08 | Packaged Start at login | Login item targets CamFrame and toggles correctly |
| M-09 | DMG/ZIP Gatekeeper behavior | Unsigned warning is expected and documented; app launches after user approval |
| M-10 | Fresh profile onboarding, keyboard focus, Skip/completion, and tray Help | Same contextual behavior as W-28 with `Cmd` shortcut copy and VoiceOver announcements |

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
- Reduced-motion mode.

Browser-only QA is useful for markup/CSS, but it does not represent native transparency, media permissions, Electron IPC, or z-order.

## Artifact inspection

For every release candidate, record:

- exact dependency versions and clean `npm ci`;
- tests before packaging;
- artifact filenames, architecture, byte size, and SHA-256;
- ASAR contents limited to `src/**/*` and `package.json`;
- only `en-US.pak` under locales;
- Inter/Phosphor font files and license files included;
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
