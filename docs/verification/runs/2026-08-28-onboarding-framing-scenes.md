# Verification run: onboarding framing exit and Scene explanation — 2026-08-28

- **Commit:** Working tree based on `fe8e6c6`
- **Version:** Unreleased after `0.4.3`; Preferences schema 12
- **Observer:** Codex; human visual review requested from repository owner
- **Environment:** Windows host, Node 24.15.0, Vite browser-safe renderer, development source
- **Cameras:** Browser-safe QA surface; no physical camera used for this interaction check
- **Related change/PR:** [GitHub issue 13](https://github.com/techiesreviews/camframe/issues/13), ADR 0021

## Automated checks

| Command | Result | Counts/duration | Evidence/notes |
| --- | --- | --- | --- |
| `npm test` | Pass | 46 passed, 0 failed; approximately 0.11 s | Covers exit copy, Scene snapshot explanation, and renderer Escape branch |
| Syntax checks | Pass | `onboarding.js`, `overlay.js` | Node parser accepted both modules |
| `git diff --check` | Pass | Full working tree | Only line-ending conversion warnings |
| T3 browser-safe interaction | Pass | Steps 3 and 4 | Step 3 copy named Crosshair/Escape exits; Crosshair entered framing, Escape changed positioning true→false while onboarding stayed true; Step 4 named camera, screen position, shape, framing, and style; both 211 px coach marks retained an approximately 12 px Toolbar gap |

## Build and artifact checks

| Target/check | Result | Artifact/hash/notes |
| --- | --- | --- |
| Windows development Electron launch | Pass | Fresh-profile development app relaunched as PID 33700 for human review |
| Windows unpacked | Not run | |
| Windows NSIS | Not run | |
| Windows portable | Not run | |
| macOS arm64 DMG/ZIP | Not run | |
| macOS x64 DMG/ZIP | Not run | |

## Manual checks

| Check | Result | Evidence/notes |
| --- | --- | --- |
| Framing exits are understandable without trial and error | Pending human review | |
| Scene explanation communicates per-Scene camera/layout scope | Pending human review | |
| Longer copy remains comfortably readable at native scale | Pending human review | |

## Verdict

Automated and browser-safe checks pass. Native visual acceptance remains pending the repository owner's review of the relaunched development app.
