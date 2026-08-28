# Verification run: onboarding stable Toolbar placement — 2026-08-28

- **Commit:** Working tree based on `fe8e6c6`
- **Version:** Unreleased after `0.4.3`; Preferences schema 12
- **Observer:** Codex; human visual review requested from repository owner
- **Environment:** Windows host, Node 24.15.0, development source
- **Cameras:** Physical camera available to the user-run development app; no model or driver evidence recorded
- **Related change/PR:** [GitHub issue 13](https://github.com/techiesreviews/camframe/issues/13), ADR 0019

## Automated checks

| Command | Result | Counts/duration | Evidence/notes |
| --- | --- | --- | --- |
| `npm test` | Pass | 46 passed, 0 failed; approximately 0.1 s | Includes 220 px reserve and synchronous onboarding-layout source contracts |
| Syntax checks | Pass | Six source modules | Node parser accepted `main.js`, `overlay.js`, `onboarding.js`, `settings.js`, `cameras.js`, and `fullscreen.js` |
| `git diff --check` | Pass | Full working tree | Only line-ending conversion warnings |
| Browser-safe DOM geometry/state | Blocked | | T3 preview transport stopped returning the served document during this run; native Electron/manual review is the decisive check for screen-coordinate invariance |

## Build and artifact checks

| Target/check | Result | Artifact/hash/notes |
| --- | --- | --- |
| Windows development Electron launch | Pass | Fresh-profile Overlay visible as PID 21996; Win32 reported a 327×614 outer window at 125% display scale, consistent with the 220-DIP transient reserve over the compact window |
| Windows unpacked | Not run | |
| Windows NSIS | Not run | |
| Windows portable | Not run | |
| macOS arm64 DMG/ZIP | Not run | |
| macOS x64 DMG/ZIP | Not run | |

## Manual checks

| Check | Result | Evidence/notes |
| --- | --- | --- |
| Tooltip appears physically above Toolbar | Pending human review | |
| Toolbar and Camera retain identical screen coordinates as guide opens | Pending human review | This is the acceptance criterion for ADR 0019 |
| No intermediate jump before tooltip paint | Pending human review | |
| Camera/Scenes settings open below Toolbar after activation | Pending human review | |

## Verdict

Automated contract checks pass. Native visual acceptance remains pending the repository owner's review of the relaunched development app.
