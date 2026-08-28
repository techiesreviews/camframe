# Verification run: high contrast and reduced motion — 2026-08-29

- **Commit:** working tree based on `2f6b381f2c24d0b14781a6613a25c743be08b782`
- **Version:** unreleased based on 0.4.3
- **Observer:** Codex automated/source inspection; human visual review pending
- **Environment:** Windows 11 Pro 10.0.26200 AMD64; Node 24.15.0; npm 11.14.1; Electron 43.2.0 development source
- **Cameras:** Native camera behavior not exercised in this run
- **Related change/PR:** [GitHub issue 14](https://github.com/techiesreviews/camframe/issues/14), ADR 0024

## Automated checks

| Command | Result | Counts/duration | Evidence/notes |
| --- | --- | --- | --- |
| `npm ci` | Not run | | Existing lockfile install reused |
| `npm test` | Pass | 49/49, about 119 ms | Includes pure zero/280 ms bounds plan and static accessibility integration/visual contracts |
| Syntax checks | Pass | `main.js`, `overlay.js`, `fullscreen.js`, `preload.cjs` | Node parser accepted all changed JavaScript/CommonJS files |
| `git diff --check` | Pass | Clean | Checked after documentation synchronization |

## Build and artifact checks

| Target/check | Result | Artifact/hash/notes |
| --- | --- | --- |
| Windows unpacked | Not run | Development review build only |
| Windows development launch | Pass | Responsive `CamFrame overlay` window launched as PID 39692 with onboarding already completed |
| Windows NSIS | Not run | |
| Windows portable | Not run | |
| macOS arm64 DMG/ZIP | Not run | |
| macOS x64 DMG/ZIP | Not run | |
| ASAR/locales/fonts/permission metadata | Not run | |

## Manual checks

| ID | Result | Observation/evidence |
| --- | --- | --- |
| W-29 | Not run | Requires toggling Windows contrast/Animation effects and NVDA while observing native Full screen/Scene final geometry |
| M-11 | Blocked | No macOS/VoiceOver environment available |
| Renderer smoke | Inconclusive | T3 navigated to `overlay.html?state=onboarding`; collaborative snapshot and evaluation both failed, so no visual pass is claimed |

## Regressions and surprises

- The T3 page remained reachable but its automation client rejected both snapshot and evaluation, repeating the known visual-evidence gap.
- Existing Electron 43.2 types expose high-contrast state in main but no main-process reduced-motion property. The retained design therefore reports the live renderer media query through a boolean-only IPC bridge.

## Release decision

- **Decision:** No-go
- **Reason:** Automated candidate is green, but real Windows contrast/motion plus NVDA and macOS contrast/motion plus VoiceOver remain unverified.
- **Known exceptions accepted by:** None
- **Follow-ups:** Launch a fresh Windows development instance for W-29 review; run M-11 on macOS before a release candidate.
