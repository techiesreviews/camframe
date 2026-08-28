# Verification run: contextual onboarding coach marks — 2026-08-28

> Historical placement run for ADR 0018. ADR 0019 and `2026-08-28-onboarding-stable-toolbar.md` supersede the Toolbar-moving layout recorded here.

- **Commit:** Working tree based on `fe8e6c6`
- **Version:** Unreleased after `0.4.3`; Preferences schema 12
- **Observer:** Codex; human visual review requested from repository owner
- **Environment:** Windows host, Node 24.15.0, development source
- **Cameras:** Physical camera available to the user-run development app; no model or driver evidence recorded
- **Related change/PR:** [GitHub issue 13](https://github.com/techiesreviews/camframe/issues/13), ADR 0016–0018

## Automated checks

| Command | Result | Counts/duration | Evidence/notes |
| --- | --- | --- | --- |
| `npm ci` | Not run | | Existing dependency installation used |
| `npm test` | Pass | 46 passed, 0 failed; approximately 0.1 s | Covers four target/reveal mappings, platform copy, bounded navigation, persistence, and reachable source contracts |
| Syntax checks | Pass | `onboarding.js`, `overlay.js` | Node parser accepted both changed scripts |
| `git diff --check` | Pass | Source/test scope | Only line-ending conversion warnings |
| Browser-safe DOM geometry/state | Pass | Four steps at default 324×390 px Overlay | T3 evaluation confirmed the tooltip at y=8–191, all five Toolbar buttons at y=203–247, and opened settings at y=259–390. Both gaps were 12 px, the Camera stayed at y=84, and the camera selector remained visible. Screenshot capture remained unavailable |

## Build and artifact checks

| Target/check | Result | Artifact/hash/notes |
| --- | --- | --- |
| Windows development Electron launch | Pass | Electron started with a fresh isolated Chromium profile after removing the harness-only `ELECTRON_RUN_AS_NODE` environment variable |
| Windows unpacked | Not run | |
| Windows NSIS | Not run | |
| Windows portable | Not run | |
| macOS arm64 DMG/ZIP | Not run | |
| macOS x64 DMG/ZIP | Not run | |
| ASAR/locales/fonts/permission metadata | Not run | |

## Manual checks

| ID | Result | Observation/evidence |
| --- | --- | --- |
| W-28 | Pending | Fresh-profile app prepared for repository-owner review of all four targets, placement, live interactions, keyboard behavior, completion, and tray Help |
| M-10 | Not run | No macOS/VoiceOver environment |

## Regressions and surprises

- The Codex harness exports `ELECTRON_RUN_AS_NODE`; development launch must remove it for the child Electron process. This is a harness condition, not application behavior.
- The prior centered modal verification result is superseded for UI behavior by ADR 0016. Its blocked evidence remains historically valid for that discarded presentation.

## Release decision

- **Decision:** No-go
- **Reason:** Automated contracts pass, but contextual placement and interaction are awaiting human visual/keyboard review.
- **Known exceptions accepted by:** None
- **Follow-ups:** Record the repository owner's observations, then complete W-28 and durable screenshot capture before a release candidate.
