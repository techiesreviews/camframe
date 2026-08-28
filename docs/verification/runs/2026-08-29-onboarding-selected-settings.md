# Verification run: onboarding selected settings — 2026-08-29

- **Commit:** Working tree based on `fe8e6c6`
- **Version:** Unreleased after `0.4.3`; Preferences schema 12
- **Observer:** Codex; human visual review requested from repository owner
- **Environment:** Windows host, Node 24.15.0, Vite browser-safe renderer, development source
- **Cameras:** Browser-safe QA surface; no physical camera used for this settings-state check
- **Related change/PR:** [GitHub issue 13](https://github.com/techiesreviews/camframe/issues/13), ADR 0022

## Automated checks

| Command | Result | Counts/duration | Evidence/notes |
| --- | --- | --- | --- |
| `npm test` | Pass | 46 passed, 0 failed; approximately 0.12 s | Covers the 80 ms guarded reveal, Camera/Scenes routing, and existing coach-mark contracts |
| Syntax checks | Pass | `onboarding.js`, `overlay.js` | Node parser accepted both modules |
| `git diff --check` | Pass | Full working tree | Only line-ending conversion warnings |
| T3 browser-safe settled states | Pass | Steps 1 and 4 | After 120 ms, step 1 had Inline settings visible with Camera selected; step 4 had Inline settings visible with Scenes selected. Both retained a 12 px tooltip→Toolbar gap and 12 px Toolbar→settings gap. Step 4's Scenes panel remained scrollable within the available height |

## Build and artifact checks

| Target/check | Result | Artifact/hash/notes |
| --- | --- | --- |
| Windows development Electron launch | Pass | Fresh-profile development app relaunched as PID 36916 for human review |
| Windows unpacked | Not run | |
| Windows NSIS | Not run | |
| Windows portable | Not run | |
| macOS arm64 DMG/ZIP | Not run | |
| macOS x64 DMG/ZIP | Not run | |

## Manual checks

| Check | Result | Evidence/notes |
| --- | --- | --- |
| Coach mark visibly precedes automatic panel reveal | Pending human review | 80 ms delay and source guards are automated/source-inspected; native perceptual timing needs observation |
| Step 1 settles on Camera | Pending human review | |
| Step 4 settles on Scenes | Pending human review | |
| Rapid Back/Next does not open a stale panel | Pending human review | State guards are source-inspected |

## Verdict

Automated and browser-safe settled-state checks pass. Native perceptual timing remains pending the repository owner's review of the relaunched development app.
