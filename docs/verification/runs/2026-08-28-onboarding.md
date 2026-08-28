# Verification run: unreleased onboarding — 2026-08-28

- **Commit:** Working tree based on `fe8e6c6`
- **Version:** Unreleased after `0.4.3`; Preferences schema 12
- **Observer:** Codex
- **Environment:** Windows host, Node 24.15.0, npm test runtime; development source
- **Cameras:** Chromium fake camera requested for Electron smoke; no physical camera evidence recorded
- **Related change/PR:** [GitHub issue 13](https://github.com/techiesreviews/camframe/issues/13), ADR 0012

## Automated checks

| Command | Result | Counts/duration | Evidence/notes |
| --- | --- | --- | --- |
| `npm ci` | Not run | | Existing dependency installation used |
| `npm test` | Pass | 46 passed, 0 failed; approximately 0.1 s | Includes onboarding migration/show predicates, bounded steps, platform copy/content, schema 12, Scene exclusion, and reachable UI/tray contracts |
| Syntax checks | Pass | `onboarding.js`, `settings.js`, `main.js`, `preload.cjs`, `overlay.js` | Node parser accepted each changed script |
| `git diff --check` | Pass | | No whitespace errors in source/test pass; final repository pass recorded after documentation updates |

## Build and artifact checks

| Target/check | Result | Artifact/hash/notes |
| --- | --- | --- |
| Windows development Electron launch | Inconclusive | Fake camera and isolated Chromium user-data arguments produced Electron main/renderer/utility processes, but no visual automation channel was available |
| Windows unpacked | Not run | |
| Windows NSIS | Not run | |
| Windows portable | Not run | |
| macOS arm64 DMG/ZIP | Not run | |
| macOS x64 DMG/ZIP | Not run | |
| ASAR/locales/fonts/permission metadata | Not run | |

## Manual checks

| ID | Result | Observation/evidence |
| --- | --- | --- |
| W-01 | Inconclusive | Browser-safe page loaded and Electron launched with a fake camera, but visual state could not be captured |
| W-28 | Blocked | T3 preview snapshot/evaluation repeatedly failed; Windows Computer Use native pipe remained unavailable after retry/reset |
| M-02 | Not run | No macOS environment |
| M-10 | Not run | No macOS environment or VoiceOver observer |

## Regressions and surprises

- The T3 collaborative preview could navigate to the onboarding QA URL, but resize, snapshot, and evaluation calls failed or timed out.
- Windows Computer Use could not connect to its native pipe after the required retry and kernel reset. No screenshot, focus tree, tray action, NVDA, or VoiceOver result is claimed.
- Static inspection prompted two retained corrections before completion: a full Overlay input blocker behind the modal and `aria-hidden` on the Camera surface while onboarding owns focus.

## Release decision

- **Decision:** No-go
- **Reason:** Automated contracts pass, but the new reachable UI has no completed visual, focus, tray, or assistive-technology observation.
- **Known exceptions accepted by:** None
- **Follow-ups:** Run W-28 and M-10 on supported hardware before a release candidate; store durable screenshots for all four steps and the minimum-Wide scroll state.
