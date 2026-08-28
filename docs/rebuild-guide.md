# Rebuild guide

This guide is for reconstructing the current source behavior based on v0.4.3 plus the unreleased roadmap changes, not redesigning it. Read `known-gaps.md` first so uncertain or aspirational behavior is not mistaken for verified behavior.

## Reproducible baseline

- Git commit/tag: `fe8e6c6` / `v0.4.3`
- Working-tree extension: contextual onboarding, accessibility preferences, removal of the unreachable Controller, and one stable Camera quality from ADR 0012 and ADR 0016–0026; Preferences schema 12
- Node used by the 2026-08-28 audit: `v24.15.0`
- npm used: `11.14.1`
- Lockfile-resolved top-level tools: Electron `43.2.0`, Electron Builder `26.15.3`, Vite `8.2.0`
- Runtime code: browser-native JavaScript modules plus one CommonJS preload; no framework and no transpilation step for packaged source.

`package.json` declares the development dependencies as `latest`; exact reproduction therefore requires `package-lock.json` and `npm ci`. Do not regenerate the lockfile casually.

## Build from this repository

```powershell
npm.cmd ci
npm.cmd test
npm.cmd start
```

Windows package commands:

```powershell
npm.cmd run pack
npm.cmd run dist
```

macOS package command:

```bash
npm ci
npm test
npm run dist:mac
```

The CI release path is authoritative for cross-platform artifacts: tag `v*`, test/build Windows x64 plus macOS arm64/x64, upload artifacts, then create a GitHub release.

## Greenfield reconstruction order

1. **Pure domain contracts** — implement `settings.js`, `cameras.js`, `fullscreen.js`, and `onboarding.js` first. Reproduce defaults, clamps, geometry, Scene merge/order, constraints, onboarding migration/copy/steps, 280 ms interpolation, and the 280 ms/zero-duration Overlay bounds plan. Port the pure tests before adding Electron.
2. **Main-process shell** — implement Preferences load/save, startup overrides, Overlay BrowserWindow, media permissions, tray, shortcuts, and IPC. Keep native privileges out of renderers.
3. **Camera surface** — create one autoplay/muted/playsinline video with cover cropping. Implement stale-request cancellation, exact-device fallback, slower-profile retry, motion hint, and enumeration after permission.
4. **Overlay geometry** — reproduce the fixed chrome reserve (18/84/18/18), shape ratios, CSS clipping, inner frame, and direct native drag/resize polling.
5. **Hover/interactivity state machine** — default to click-through with forwarded movement; reveal the five-button toolbar and handles; preserve 220 ms compact hide and 200 ms Full screen hide behavior.
6. **Camera framing** — target tool, mirrored pan, 5% wheel zoom, double-click reset, and identical transforms on primary/blur videos. Do not add Size or Zoom settings rows.
7. **Effects** — outside-only Glow and Progressive blur with contextual controls and current tunable ranges. Do not restore Edge bloom.
8. **Full screen** — animate native bounds rather than toggling Electron fullscreen; preserve the active camera profile while coordinating renderer geometry, Escape, toolbar hotspot, state restoration, and immediate final geometry under reduced motion.
9. **Scenes** — preserve the persisted `presets` name and import compatibility, cap/order semantics, live position snapshot, reduced-motion-aware compact transition, tray, shortcuts, and notices.
10. **Onboarding** — show four contextual coach marks only for new installations after camera state is known; use a transient 220 px native top reserve so the coach mark sits above the standard Toolbar without moving the Toolbar or Camera on screen; keep the current target in its hover treatment and show four segmented progress lines. After the coach mark paints, automatically open Camera settings on step 1 and Scenes on step 4. Demonstrate Shape and framing with a pointer-transparent ghost mouse, reversible starting snapshots, hover/interaction handoff, and reduced-motion suppression. Escape exits active framing before dismissing the guide. Preserve modeless keyboard access, schema-12 migration, tray Help reopening, and platform copy.
11. **Accessibility preferences** — reflect live reduced-motion and contrast media queries as Overlay attributes, bridge only sanitized booleans to main, disable all descendant motion, finish active native bounds at their target, and use system colors plus structural selection/focus indicators.
12. **Packaging** — restrict ASAR inputs, embed only current fonts/icons and English locale, add macOS camera usage copy, and reproduce artifact names.

## Reconstruction invariants

- One camera MediaStream per Overlay; no canvas frame-copy pipeline.
- Compact and Full screen share one Camera quality; Full screen/Scene changes reuse the stream without applying constraints.
- Preferences are sanitized in main after every patch.
- Startup always reveals and raises the camera.
- Full screen and active Scene are transient.
- Scene order is shortcut order.
- Overlay size and camera zoom are independent.
- The shape cycle and aspect ratios remain exact.
- Effects stay outside the visible surface and disappear in Full screen.
- Accessibility preferences remain transient, and reduced motion always preserves final geometry.
- Mirror remains a persistent setting, not a quick action.
- Inline settings are the only settings surface.

## Acceptance gate

An exact rebuild is not complete when unit tests alone pass. It must:

1. Pass the automated contract suite described in `verification/README.md`.
2. Complete every applicable row in the manual Windows matrix, including multiple-camera/Elgato continuity tests across Full screen geometry changes.
3. Complete the macOS matrix on both Intel and Apple Silicon, or explicitly scope the rebuild to Windows and change the product specification.
4. Produce inspectable packages with only expected application files/locales.
5. Compare visible Overlay states against the geometry, wording, colors, and timing in `product-spec.md`.
6. Resolve or consciously reproduce every item in `known-gaps.md`.

## Where to make a change

| Desired change | Primary files | Also review |
| --- | --- | --- |
| Defaults/ranges/persistence | `src/settings.js` | data contracts, Scene snapshots, tests, schema version |
| Camera quality/devices | `src/cameras.js`, `src/overlay.js` | known fullscreen issue, manual hardware matrix |
| Native bounds/z-order/tray/shortcuts | `src/main.js`, `src/fullscreen.js` | Windows/macOS matrix, startup semantics |
| Overlay interaction/visuals | `src/overlay.js`, `.html`, `.css` | compositor/input gap, reduced motion, static UI tests |
| Onboarding/versioned Help | `src/onboarding.js`, `src/overlay.*`, `src/main.js` | Preferences migration, target/reveal mapping, dynamic placement, platform copy, tray, Scenes exclusion |
| Scene compatibility | `src/settings.js`, `src/main.js`, both UI scripts | export version, six-item limit, shortcuts |
| Packaging/release | `package.json`, lockfile, workflow | all three CI matrix targets and artifact inspection |

After a change, follow the maintenance workflow in `docs/README.md`; do not update only the README feature list.
