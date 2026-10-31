# Known gaps and reconstruction warnings

These are evidence-backed mismatches or risks in the v0.4.3 baseline and current unreleased working tree. They are not automatically authorized fixes. Resolve behavior changes through an issue/ADR and update the reconstruction baseline.

## KG-01 — Native compositor-region helpers were not applied

**Status:** Resolved on 2026-10-11 by ADR 0029 (helpers removed).
**Evidence:** Source inspection and automated tests.

`settings.js` computed shape/effect/toolbar/control regions through `regionsFor()` and `overlayRegionsFor()`, but main never imported them or called `BrowserWindow.setShape()`. They and their tests were deleted. CSS clips the visible camera, and mouse acceptance still toggles for the entire rectangular outer window. When non-interactive, the whole window is click-through; when interactive, transparent pixels inside that outer rectangle may accept/block input.

**Rebuild rule:** reproduce the current whole-window interactivity for exact parity, or make native regions a deliberate new feature with an ADR and cross-platform manual tests.

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

`NotAllowedError` uses platform-specific recovery copy from `cameraErrorMessage()` in `camera-session.js`: Windows names Windows Settings and desktop-app camera permission; macOS names System Settings and CamFrame camera permission. Manual permission-denial checks have not been recorded on macOS, so wording accuracy and the complete recovery path remain unverified there.

## KG-05 — Electron automation is Windows-scoped and not comprehensive

**Status:** Core integration seam added; expansion remains tracked by GitHub issue 22 (`ready-for-agent`).
**Evidence:** `npm run test:electron`, CI workflow inspection, and retained smoke screenshots.

The 155 module and static tests (136 behavioral through module interfaces with fakes, 19 static markup/CSS/wiring checks) remain, plus a Windows-scoped Playwright Electron smoke that creates the real BrowserWindow, crosses the preload/IPC boundary, uses Chromium's synthetic camera, completes onboarding, opens Camera settings, changes Camera quality, enters/exits Full screen without changing the track profile, emulates reduced motion/forced colors, checks native bounds, and captures three screenshots.

The integration smoke does not prove real camera/driver behavior, native pointer pass-through, global shortcuts, OS accessibility settings/assistive technology, native dialogs, Start at login, installers, or macOS behavior. Use the manual matrix and do not interpret “155 unit + 1 Electron passing” as full application verification. The smoke also runs on a Linux X11/XWayland desktop session (2026-10-11 run), but that is not part of CI.

## KG-06 — Renderer visual coverage remains incomplete

**Status:** Current-source Windows packaging/inspection and three Electron screenshots pass; final v0.5.0 CI packaging and broader state coverage remain tracked with KG-05 by GitHub issue 22 (`ready-for-agent`).
**Evidence:** `verification/runs/2026-08-29-v0.5.0-release-candidate.md` and CI smoke artifacts.

The current source packaged successfully as Windows unpacked, NSIS, and portable outputs immediately before the v0.5.0 metadata bump; ASAR, locales, assets, hashes, signatures, unpacked launch, and portable launch were inspected. The Electron smoke captures onboarding Camera, Inline Camera settings, and Full screen high contrast. T3's renderer snapshot/resize/recording endpoints still fail, final v0.5.0 CI packaging is pending, and the complete visual-state set is not yet automated or retained across every platform.

## KG-07 — `latest` dependency declarations weakened future reproducibility

**Status:** Resolved in the unreleased working tree by ADR 0027.
**Evidence:** Package/lockfile inspection, isolated clean dependency resolution, and packaging verification; final CI install pending.

Electron, Electron Builder, Playwright Core, and Vite are exact direct dependencies. This prevents lockfile regeneration from silently crossing versions and selects Electron Builder 26.17.0 (newer than the 26.15.5 fix) instead of npm's broken 26.15.3 `latest` resolution on Windows. Continue recording exact resolved versions in every release verification run.

## KG-08 — Global shortcut failures are silent

**Status:** Accepted consequence in ADR 0007, not surfaced in UI.
**Evidence:** Source inspection and ADR.

Return values from `globalShortcut.register()` are ignored. Conflicts produce no warning; users must fall back to the tray. Numbered Scene shortcuts and presentation shortcuts need manual collision checks.

## KG-09 — Import format/version metadata is written but not enforced

**Status:** Compatibility behavior, validation risk.
**Evidence:** Source inspection.

Exports identify `camframe-scenes` version 1, but imports accept any object with `scenes`/`presets` or any array. Future format evolution needs an ADR/migration plan before strict validation changes existing imports.

## KG-10 — Mirrored off-center framing uncovers part of the Camera surface

**Status:** Unresolved defect found during the GPUI port experiment; not yet observed manually.
**Evidence:** Source inspection of `applyCameraFraming()` in `src/overlay.js` plus the CSS transform math; reproduced by `camera::tests::mirrored_off_center_framing_uncovers_the_surface_like_css` in `gpui/`.

The video uses `transform: scaleX(-1) scale(z)` with `transform-origin` at `cameraPosition`. On the horizontal axis, a surface of width `W` with origin `Ox` maps the element to `[Ox − z(W − Ox), Ox + z·Ox]`. This covers `[0, W]` only when `W/(1+z) ≤ Ox ≤ zW/(1+z)`. At 100% zoom that interval is exactly 50%, so with Mirror camera on, any horizontal pan at 100% zoom exposes the `#18181b` surface background along one edge. Unmirrored framing always covers the surface for `z ≥ 1`. A fix should constrain or reinterpret the horizontal origin while mirrored; it needs an ADR because it changes persisted Scene framing semantics.

On the Electron side the transform is now produced only by `cameraFramingStyles()` in `src/camera-framing.js` (formerly `applyCameraFraming()`), so a fix lands in one place.

## KG-11 — Main can make the Overlay click-through without telling the renderer

**Status:** Unverified risk.
**Evidence:** Source inspection.

The renderer sends `overlay:interactive` only when its derived interactivity changes. Main can also set interactivity itself: hiding the Overlay makes it click-through, and Full screen, Open controls, Help, and drag/resize starts make it interactive. If main makes a hidden Overlay click-through while the renderer still believes it is interactive, and the Overlay is shown again from the tray checkbox or `Ctrl/Cmd+Shift+H` without the pointer leaving and re-entering, the renderer will not resend `true`. Hiding normally blurs the window, which already hides the chrome, so this is unlikely. A fix would make main report its forced changes back, or have the renderer resend on show.

## KG-12 — Escape leaves framing but the framing demo keeps running

**Status:** Open defect, preserved by the 2026-10-11 refactor.
**Evidence:** Automated real-Electron trace (`docs/verification/runs/2026-10-11-deep-modules-electron-44-7.md`) on the baseline and refactored source.

During the Onboarding framing step, `Escape` turns framing mode off and keeps the tour open (ADR 0021), but unlike clicking Crosshair it does not hand the demo over. The demo keeps panning and zooming the camera with framing mode off until the user changes steps or closes the tour, which restores the framing from before the demo. The fix is one call (`takeOver('framing')` in the tour's `escape()`), but it changes what Escape keeps, so it needs product confirmation.

## KG-13 — The Prompter link lacks manual Windows and macOS evidence

**Status:** Open verification gap, 2026-10-30.
**Evidence:** Automated: unit tests (server, origins, host, cue checks, placement on several displays) and real-Electron cue runs on Linux (`docs/verification/runs/2026-10-30-prompter-link.md`, `2026-10-30-prompter-link-review.md`, `2026-10-30-prompter-link-toolbar.md`). Lex reported on 2026-10-30 that the link works on Lex's Windows PC (browser, prompts and display layout not recorded); not yet observed on macOS.

Still to confirm by hand: Chrome's one-time Local Network Access prompt when https://prompter.techies.tools, and again when its preview https://preview.prompter.techies.tools (ADR 0033), first reaches `127.0.0.1:47833`; whether the Windows Defender Firewall or macOS firewall prompts for a `127.0.0.1`-only listener (not expected); Safari reaching `http://127.0.0.1` from an https page (may be refused, so Chrome or Edge is the supported pairing); corner placement with mixed display scaling, a display left of or above the primary one, and a taskbar or Dock on the side. These are the manual rows W-30 and M-12 in `docs/verification/README.md`.
