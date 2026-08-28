# Known gaps and reconstruction warnings

These are evidence-backed mismatches or risks in the v0.4.3 baseline and current unreleased working tree. They are not automatically authorized fixes. Resolve behavior changes through an issue/ADR and update the reconstruction baseline.

## KG-01 — Native compositor-region helpers are not applied

**Status:** Open discrepancy.
**Evidence:** Source inspection and automated helper tests.

`settings.js` computes shape/effect/toolbar/control regions through `regionsFor()` and `overlayRegionsFor()`. `main.js` does not import those functions and never calls Electron `BrowserWindow.setShape()`. The test named “every compact camera shape has an explicit compositor clip mask” asserts CSS `clip-path`, not a native compositor mask.

Current source clips the visible camera in CSS and toggles mouse acceptance for the entire rectangular outer window. When non-interactive, the whole window is click-through; when interactive, transparent pixels inside that outer rectangle may accept/block input. `CONTEXT.md` and older prose previously implied a live native mask.

**Rebuild rule:** reproduce the current whole-window interactivity for exact parity, or make native regions a deliberate new feature with cross-platform manual tests.

## KG-02 — The separate Controller is unreachable

**Status:** Open discrepancy / dormant code.
**Evidence:** Source inspection.

`createControlWindow()` and a full `control.*` renderer exist, but there are no callers of `createControlWindow()`. Every action named “Open controls” calls `showController()`, which shows the Overlay and sends `controls:show` to open Inline settings.

Static tests assert that controls exist in both HTML surfaces, but no end-to-end test proves the Controller lifecycle. Some features—border color and Center—are currently exposed only in the dormant Controller.

**Rebuild rule:** do not describe those controls as reachable or instantiate the Controller accidentally. Decide later whether to remove it, activate it, or keep it as a reference implementation.

## KG-03 — Fullscreen capture renegotiation has unresolved visual evidence

**Status:** Unresolved despite GitHub issue 5 being closed.
**Evidence:** Historical issue plus current source inspection.

Dynamic `applyConstraints()` switching was reported to show stale, black, or wrong camera frames on Windows with multiple devices including Elgato hardware. A local canvas-held-frame workaround passed an automated race test but still failed manual testing and was never committed. Current v0.4.3 still renegotiates the same live track; no linked fix or manual closure evidence exists.

See `experiments/2026-08-12-fullscreen-capture-renegotiation.md`.

## KG-04 — Platform-specific permission copy lacks manual macOS evidence

**Status:** Source mismatch resolved in the unreleased onboarding change; manual evidence remains open.
**Evidence:** Automated copy contract and source inspection; no macOS permission-denial observation.

`NotAllowedError` and onboarding now share platform-specific recovery copy: Windows names Windows Settings and desktop-app camera permission; macOS names System Settings and CamFrame camera permission. Manual permission-denial checks have not been recorded on macOS, so wording accuracy and the complete recovery path remain unverified there.

## KG-05 — Automated tests do not run Electron end to end

**Status:** Known test limitation.
**Evidence:** Test inspection.

The 46 Node tests cover pure helpers and inspect source/HTML/CSS strings. They do not create BrowserWindows, request a real camera, exercise IPC, verify pointer pass-through, run global shortcuts, open dialogs, validate Start at login, or inspect live packaged artifacts.

Several assertions prove that implementation text exists rather than that behavior works. Use the manual matrix and avoid interpreting “46 passing” as full application verification.

## KG-06 — Local packaging and renderer visual smoke remain incomplete

**Status:** Vite startup reverified; packaging and visual capture need rerun.
**Evidence:** `verification/runs/2026-08-28-v0.4.3-baseline.md`, `verification/runs/2026-08-28-onboarding.md`, and `verification/runs/2026-08-28-onboarding-coach-marks.md`.

The original onboarding run started Vite successfully and navigated the browser-safe Overlay page, but T3 snapshot/evaluation failed. The contextual-coach-mark follow-up passed automated contracts and launched as a Windows development app for human review, but no durable visual evidence is recorded yet. Packaging was not rerun. A pre-existing `dist/win-unpacked` from 2026-08-24 is not evidence for the current working tree. CI/history records earlier successful builds, but current toolchain packaging and durable visual capture should be reverified.

## KG-07 — `latest` dependency declarations weaken future reproducibility

**Status:** Managed by lockfile, still a maintenance risk.
**Evidence:** Package and lockfile inspection.

The three development dependencies are declared as `latest`. `npm ci` is reproducible while the lockfile remains intact, but lockfile regeneration can silently cross major Electron/Vite/Builder versions. Record exact resolved versions in every release verification run.

## KG-08 — Global shortcut failures are silent

**Status:** Accepted consequence in ADR 0007, not surfaced in UI.
**Evidence:** Source inspection and ADR.

Return values from `globalShortcut.register()` are ignored. Conflicts produce no warning; users must fall back to the tray. Numbered Scene shortcuts and presentation shortcuts need manual collision checks.

## KG-09 — Import format/version metadata is written but not enforced

**Status:** Compatibility behavior, validation risk.
**Evidence:** Source inspection.

Exports identify `camframe-scenes` version 1, but imports accept any object with `scenes`/`presets` or any array. Future format evolution needs an ADR/migration plan before strict validation changes existing imports.
