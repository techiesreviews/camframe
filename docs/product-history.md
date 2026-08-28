# Product history and disposition ledger

This ledger answers four different questions that a changelog usually mixes together: what shipped, what remains, what was removed, and what was tried without succeeding. It is backfilled from first-parent tags/commits, merged PR descriptions, ADRs, and GitHub issue 5.

## Release timeline

| Version | Retained outcome | Historical validation recorded at the time |
| --- | --- | --- |
| 0.2.12 | Initial Windows Electron Overlay: camera selection, four shapes, mirror/frame, direct drag/resize/crop, hover controls, Full screen, persistence | 13 tests; Windows unpacked build |
| 0.2.13 | macOS arm64/x64 packaging, camera permission copy, hidden Dock icon, smaller English-only packages and exact font assets | 13 tests; Windows packages; ASAR/locale inspection; package size ~86.8–87.0 MB |
| 0.2.14 | Electron Builder publishing disabled so the workflow owns GitHub release publication | 13 tests |
| 0.2.15 | Same-track 720p/60 compact ↔ 4K/30 Full screen profile switching, serialized rapid changes, unsupported-profile fallback | 14 tests; syntax/package checks; later contradicted by manual issue 5 evidence |
| 0.2.16 | Windows topmost level changed to `pop-up-menu` to float over taskbar | 15 tests; syntax; local Windows package/manual verification |
| 0.2.17 | Independent compact/Full screen quality settings and explicit renderer geometry contracts | Tests added; exact PR record not present in the queried merged-PR list |
| 0.3.0 | Glow/Progressive blur, contextual settings, Scenes, import/export/order/shortcuts/tray/notices, task-grouped settings, Start at login | 34 tests; Windows x64 build; compact/controller settings inspection |
| 0.4.0 | Direct camera framing: target tool, pan, 5% wheel zoom, reset; Size controls removed | 37 tests; diff check; browser QA |
| 0.4.1 | Full screen toolbar 200 ms auto-hide and 12 px recovery hotspot | 38 tests; diff check |
| 0.4.2 | Normal toolbar tightened to the five icon buttons; framing toolbar remains wider | 38 tests; diff check |
| 0.4.3 | Windows topmost changed from `pop-up-menu` to `screen-saver`; z-order centralized/re-raised; compact chrome clears on Full screen exit and window blur | Current audit: 40 tests and syntax checks pass; packaging/UI smoke inconclusive |

Historical validation is evidence about those revisions, not proof that the current environment still behaves identically.

## Retained decisions

| Topic | What stayed | Record |
| --- | --- | --- |
| Effect color input | In-app swatches plus six-digit hex for Glow | ADR 0001 |
| Effects | None, Glow, Progressive blur; independent contextual controls | ADR 0002, ADR 0003 |
| Mirror | Persistent setting in settings surfaces, absent from quick toolbar | ADR 0004 |
| Reusable layouts | Six named local layouts, now presented as Scenes | ADR 0005, ADR 0008 |
| Settings navigation | Camera / Style / Scenes progressive disclosure | ADR 0006 |
| Presentation | Tray Scenes, global shortcuts, notices, packaged Start at login | ADR 0007 |
| Storage compatibility | UI says Scene; persisted field remains `presets` | ADR 0008 |
| Scene capture | Synchronous live compact bounds snapshot | ADR 0008 |
| Framing | Direct pan/scroll/reset; zoom independent from Overlay size | ADR 0009 |
| Full screen chrome | Toolbar hides after 200 ms and returns over padded hotspot | ADR 0011 |
| Camera pipeline | Native video elements and one stream, no ongoing canvas copies | README, architecture, issue 5 out-of-scope statement |

## Removed or replaced behavior

| Removed/replaced | Reason | Replacement/status | Record |
| --- | --- | --- | --- |
| Native color chooser for effect colors | Native popup can appear behind topmost windows | In-app hex and swatches | ADR 0001 |
| Edge bloom | Overlapped Glow without enough value | Glow remains | ADR 0002 |
| Generic effect strength | Ambiguous across different effect concepts | Named effect-specific controls | ADR 0003 |
| Mirror quick action | Toolbar was too crowded; mirror is persistent, not moment-to-moment | Mirror in settings | ADR 0004 |
| Flat long settings stack | Resolutions/effects/Scenes overcrowded compact UI | Three task sections | ADR 0006 |
| “Preset” as user-facing term | Presentation workflows needed ordering/direct shortcuts/management | Scene UI; storage key unchanged | ADR 0008 |
| Size and Zoom settings sliders | Duplicated direct manipulation and crowded settings | Corner resize plus target framing tool | ADR 0009 |
| Always-visible Full screen toolbar | Distracted from presentation | Timed auto-hide/hotspot | ADR 0011 |
| Windows `pop-up-menu` topmost level | Current v0.4.3 commit prioritizes reliable controls/taskbar layering | `screen-saver` plus z-order re-raise | Commit `fe8e6c6` |

## Tried and not successful

| Attempt | Result | Final disposition | Evidence |
| --- | --- | --- | --- |
| Hold the last valid camera frame on canvas while Full screen constraints renegotiate; wait for fresh frames; coalesce rapid requests | Automated race regression passed, but manual Windows/Elgato testing still showed wrong/stale/black frames | Never committed; explicitly out of scope as a solution | GitHub issue 5; experiment record |

## Uncertain historical outcomes

- GitHub issue 5 is closed, but has no comments or linked resolution and its acceptance checklist remains unchecked. Current source retains dynamic renegotiation. Treat the underlying visual continuity problem as unresolved until a new hardware run proves otherwise.
- Historical PR 6 says `pop-up-menu` was manually verified over the Windows taskbar. v0.4.3 later changes to `screen-saver` without an ADR. Both facts are preserved; current code is authoritative for reconstruction.
- The dormant Controller has remained in source and static tests but is not reachable. Its intended long-term disposition is undocumented.

## Adding a history entry

For each release, add one release row with links to its PR/issue/ADR and its dated verification run. Put rejected variants in `experiments/`; do not hide them in a squashed commit message. When removing a feature, state what replaces it and whether persisted old values are migrated, ignored, or rejected.
