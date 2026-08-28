# Verification run: onboarding progress and target highlight — 2026-08-28

- **Commit:** Working tree based on `fe8e6c6`
- **Version:** Unreleased after `0.4.3`; Preferences schema 12
- **Observer:** Codex; human visual review requested from repository owner
- **Environment:** Windows host, Node 24.15.0, Vite browser-safe renderer, development source
- **Cameras:** Browser-safe QA surface; no physical camera used for this visual-state check
- **Related change/PR:** [GitHub issue 13](https://github.com/techiesreviews/camframe/issues/13), ADR 0020

## Automated checks

| Command | Result | Counts/duration | Evidence/notes |
| --- | --- | --- | --- |
| `npm test` | Pass | 46 passed, 0 failed; approximately 0.13 s | Includes visible segmented progress, progressbar semantics, hover-equivalent target treatment, and absence of visible step text |
| `node --check src/overlay.js` | Pass | | Renderer syntax accepted |
| `git diff --check` | Pass | Full working tree | Only line-ending conversion warnings |
| T3 browser-safe state evaluation | Pass | Steps 1 and 2 | Visible label was “Getting started”; progress used a 3 px grid; filled segments advanced 1→2; `aria-valuenow` advanced 1→2; target changed Settings→Shape; both targets used `rgb(229,229,229)` on `rgb(25,25,27)` with an orange outline; tooltip-to-Toolbar gap remained approximately 12 px |

## Build and artifact checks

| Target/check | Result | Artifact/hash/notes |
| --- | --- | --- |
| Windows development Electron launch | Pass | Fresh-profile development app relaunched as PID 43228 for human review |
| Windows unpacked | Not run | |
| Windows NSIS | Not run | |
| Windows portable | Not run | |
| macOS arm64 DMG/ZIP | Not run | |
| macOS x64 DMG/ZIP | Not run | |

## Manual checks

| Check | Result | Evidence/notes |
| --- | --- | --- |
| Target reads like the real Toolbar hover state | Pending human review | |
| Four progress lines are clear at native scale | Pending human review | |
| Progress and target advance together through all four steps | Pending human review | |

## Verdict

Automated and browser-safe checks pass. Native visual acceptance remains pending the repository owner's review of the relaunched development app.
