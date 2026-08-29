# Known gaps and reconstruction warnings

These are evidence-backed mismatches or risks in the v0.4.3 baseline and current unreleased working tree. They are not automatically authorized fixes. Resolve behavior changes through an issue/ADR and update the reconstruction baseline.

## KG-01 — Native compositor-region helpers are not applied

**Status:** Open discrepancy.
**Evidence:** Source inspection and automated helper tests.

`settings.js` computes shape/effect/toolbar/control regions through `regionsFor()` and `overlayRegionsFor()`. `main.js` does not import those functions and never calls Electron `BrowserWindow.setShape()`. The test named “every compact camera shape has an explicit compositor clip mask” asserts CSS `clip-path`, not a native compositor mask.

Current source clips the visible camera in CSS and toggles mouse acceptance for the entire rectangular outer window. When non-interactive, the whole window is click-through; when interactive, transparent pixels inside that outer rectangle may accept/block input. `CONTEXT.md` and older prose previously implied a live native mask.

**Rebuild rule:** reproduce the current whole-window interactivity for exact parity, or make native regions a deliberate new feature with cross-platform manual tests.

## KG-02 — The separate Controller was unreachable

**Status:** Resolved in the unreleased working tree by ADR 0025.
**Evidence:** Source inspection and automated removal contracts.

The dormant renderer, BrowserWindow lifecycle, privileged relays/actions, and Controller-only Inter assets were removed. Open-controls entry points continue to show the Overlay and open Inline settings.

`borderColor` remains accepted only for Preferences and Scene compatibility; it does not imply a reachable color control. The unreachable Center action was removed.

## KG-03 — Fullscreen camera continuity needs hardware confirmation

**Status:** Source trigger removed by ADR 0026; manual acceptance remains open in GitHub issue 5.
**Evidence:** Historical issue, current source inspection, and automated stable-profile contracts.

Dynamic `applyConstraints()` switching was reported to show stale, black, or wrong camera frames on Windows with multiple devices including Elgato hardware. A local canvas-held-frame workaround passed an automated race test but still failed manual testing and was never committed.

The unreleased implementation now has one Camera quality and never applies track constraints because Full screen state changed. This removes the observed renegotiation trigger, but Windows multiple-device/Elgato verification is still required before closing issue 5.

See `experiments/2026-08-12-fullscreen-capture-renegotiation.md`.

## KG-04 — Platform-specific permission copy lacks manual macOS evidence

**Status:** Source mismatch resolved; packaged macOS evidence tracked by GitHub issue 21 (`ready-for-human`).
**Evidence:** Automated copy contract and source inspection; no macOS permission-denial observation.

`NotAllowedError` and onboarding now share platform-specific recovery copy: Windows names Windows Settings and desktop-app camera permission; macOS names System Settings and CamFrame camera permission. Manual permission-denial checks have not been recorded on macOS, so wording accuracy and the complete recovery path remain unverified there.

## KG-05 — Electron automation is Windows-scoped and not comprehensive

**Status:** Core integration seam added; expansion remains tracked by GitHub issue 22 (`ready-for-agent`).
**Evidence:** `npm run test:electron`, CI workflow inspection, and retained smoke screenshots.

The 50 unit/static tests remain, plus a Windows-scoped Playwright Electron smoke that creates the real BrowserWindow, crosses the preload/IPC boundary, uses Chromium's synthetic camera, completes onboarding, opens Camera settings, changes Camera quality, enters/exits Full screen without changing the track profile, emulates reduced motion/forced colors, checks native bounds, and captures three screenshots.

The integration smoke does not prove real camera/driver behavior, native pointer pass-through, global shortcuts, OS accessibility settings/assistive technology, native dialogs, Start at login, installers, or macOS behavior. Use the manual matrix and do not interpret “50 unit + 1 Electron passing” as full application verification.

## KG-06 — Renderer visual coverage remains incomplete

**Status:** Current-source Windows packaging/inspection and three Electron screenshots pass; final v0.5.0 CI packaging and broader state coverage remain tracked with KG-05 by GitHub issue 22 (`ready-for-agent`).
**Evidence:** `verification/runs/2026-08-29-v0.5.0-release-candidate.md` and CI smoke artifacts.

The current source packaged successfully as Windows unpacked, NSIS, and portable outputs immediately before the v0.5.0 metadata bump; ASAR, locales, assets, hashes, signatures, unpacked launch, and portable launch were inspected. The Electron smoke captures onboarding Camera, Inline Camera settings, and Full screen high contrast. T3's renderer snapshot/resize/recording endpoints still fail, final v0.5.0 CI packaging is pending, and the complete visual-state set is not yet automated or retained across every platform.

## KG-07 — `latest` dependency declarations weakened future reproducibility

**Status:** Resolved in the unreleased working tree by ADR 0027.
**Evidence:** Package/lockfile inspection, isolated clean dependency resolution, and packaging verification; final CI install pending.

Electron, Electron Builder, Playwright Core, and Vite are exact direct dependencies. This prevents lockfile regeneration from silently crossing versions and selects Electron Builder 26.15.5 instead of npm's broken 26.15.3 `latest` resolution on Windows. Continue recording exact resolved versions in every release verification run.

## KG-08 — Global shortcut failures are silent

**Status:** Accepted consequence in ADR 0007, not surfaced in UI.
**Evidence:** Source inspection and ADR.

Return values from `globalShortcut.register()` are ignored. Conflicts produce no warning; users must fall back to the tray. Numbered Scene shortcuts and presentation shortcuts need manual collision checks.

## KG-09 — Import format/version metadata is written but not enforced

**Status:** Compatibility behavior, validation risk.
**Evidence:** Source inspection.

Exports identify `camframe-scenes` version 1, but imports accept any object with `scenes`/`presets` or any array. Future format evolution needs an ADR/migration plan before strict validation changes existing imports.
