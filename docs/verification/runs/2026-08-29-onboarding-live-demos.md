# Verification run: onboarding live Shape and framing demos — 2026-08-29

- **Commit:** Working tree based on `fe8e6c6`
- **Version:** Unreleased after `0.4.3`; Preferences schema 12
- **Observer:** Codex; human visual review requested from repository owner
- **Environment:** Windows host, Node 24.15.0, Vite browser-safe renderer, development source
- **Cameras:** Browser-safe QA surface; no physical camera used for this interaction check
- **Related change/PR:** [GitHub issue 13](https://github.com/techiesreviews/camframe/issues/13), ADR 0023

## Automated checks

| Command | Result | Counts/duration | Evidence/notes |
| --- | --- | --- | --- |
| `npm test` | Pass | 46 passed, 0 failed; approximately 0.13 s | Covers demo constants, ghost-mouse markup/CSS, reduced-motion suppression, snapshots/restoration, and hover/interaction stop routes |
| Syntax checks | Pass | `onboarding.js`, `overlay.js` | Node parser accepted both modules |
| `git diff --check` | Pass | Full working tree | Only line-ending conversion warnings |
| T3 Shape interaction | Pass | Step 2 | Ghost mouse became visible with demo state `shape`; pointer-enter stopped it and left shape unchanged. An uninterrupted run observed Circle→Rounded→Portrait→Wide across three clicks and reached `shape-ready`; Next restored Circle. A second run stopped on Rounded and Next retained Rounded, confirming handoff adoption |
| T3 framing interaction | Pass | Step 3 | Demo entered framing, animated object position to `77.8% 63.2%`, then showed scroll action and reached 130% zoom. Pointer-enter stopped automation, hid the ghost mouse, retained the exact crop/zoom, and left framing active |
| T3 Camera copy | Pass | Step 1 | Exact visible copy: “Settings allow you to choose your camera and camera quality.” |

## Build and artifact checks

| Target/check | Result | Artifact/hash/notes |
| --- | --- | --- |
| Windows development Electron launch | Pass | Fresh-profile development app relaunched as PID 21524 for human motion review |
| Windows unpacked | Not run | |
| Windows NSIS | Not run | |
| Windows portable | Not run | |
| macOS arm64 DMG/ZIP | Not run | |
| macOS x64 DMG/ZIP | Not run | |

## Manual checks

| Check | Result | Evidence/notes |
| --- | --- | --- |
| Ghost mouse visually resembles a mouse at native scale | Pending human review | |
| Shape clicks align with the moving native Toolbar through all shapes | Pending human review | Browser-safe state/animation verified; native window movement requires observation |
| Framing pan/zoom/reset loop reads clearly over a live camera | Pending human review | |
| Hover handoff feels immediate and leaves no competing ghost motion | Pending human review | |
| Reduced-motion preference suppresses all automatic demonstrations | Pending manual OS preference check | Source/CSS contract is automated |

## Verdict

Automated and browser-safe state/handoff checks pass. Native motion quality and reduced-motion OS behavior remain pending human review.
