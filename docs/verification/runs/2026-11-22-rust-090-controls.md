# Verification run: Rust 0.9.0 controls parity — 2026-11-22

- **Commit:** 61f520105643726e78c8b6326573f6d7fdb63c1f (first native parity build; subsequent fixes are identified below).
- **Version:** Rust 0.1.0 test app beside Electron 0.9.0.
- **Observer:** GPT Sol through Codex; independent review by Claude Opus 5.5 high.
- **Environment:** local Linux x64, Rust 1.98.1 and Node 24; Windows x64, Mac ARM and Intel CI desktops for native evidence.
- **Cameras:** synthetic patterns only. No physical camera or screen reader was available.
- **Related change/PR:** https://github.com/techiesreviews/camframe/pull/72 (test build, no merge or release).

## Automated checks

| Command | Result | Counts/duration | Evidence/notes |
| --- | --- | --- | --- |
| `kit doctor` | Pass | 12/12 | Project runner guide `docs/agents/runner.md` does not exist; the project kit guide and shared rulebook were read. |
| `kit unit --affected` | Pass | None affected | Rust changes are checked by `kit rust`; Node affected selection does not cover them. |
| `kit unit` | Pass | 480/481; one skipped | `.scratch/unit/20261122T140042-3018827.log` |
| `kit rust` | Pass before final style adjustment | 39 core, 2 chrome, 3 shared fixture suites, 18 app and 1 image-check test | Final rerun recorded below. |
| `kit shots` | Pass | 25 baseline captures | `.scratch/shots/2026-11-22T13-58-06-757Z`; this checks Electron, not GPUI. |
| `kit ux` | Cannot run | No feature list | `RESULT: fail ux ENOENT: no such file or directory, open '.../docs/agents/features.md'`. Native verifiers and comparison captures provide the Rust evidence. |
| Syntax and whitespace | Pass | `node --check rust/scripts/capture-parity.mjs`, `git diff --check` | |

## Reproduction and fixes

L1–L3 share a native resize defect. `SetWindowPos` sends `WM_SIZE` synchronously while GPUI has
its Window checked out. The callback cannot re-enter that Window. The OS window grows, but
GPUI's viewport and clipping mask retain the previous size. The first Windows Full screen capture
at d57ea84 shows only a 340×398 drawing in a 1024×768 display. Native bounds changes now call
`window.bounds_changed(cx)` explicitly on both platforms. Initial bounds are synchronized too.
Camera frames use cover fit while a new capture size is arriving. Toolbar button sizes fit even
180 px Portrait; the picture and controls are no longer clipped by the old viewport.

The first fixed native build fills all four Full screen corners and passes the real corner resize.
It exposed a separate Escape focus issue: the auto-hidden toolbar could retain keyboard focus.
Full screen now focuses the persistent root and activates the window. The Mac verifier also now
refreshes its cached origin after its drag, before aiming at the Full screen button.

L4/L5: settings use the original 240 px maximum width, top 76, 10 px padding, 3 tabs, selects,
switches, grey 3 px slider tracks and the original text, icons and colors. Settings never grow the
native window; content scrolls. Scenes use compact list/grid layouts, screen previews preserving
camera aspect, Save look slots, rename, delete/Undo, the 1.8 s saved check and file status on its
control. The tray menu matches 0.9.0's order and labels. Framing replaces the other toolbar
buttons with its original zoom/support row. The simpler guide keeps its approved no-ghost scope,
with the original visual hierarchy plus Back, Skip and Done.

Review found that Scene row commands intercepted rename keys. A regression test failed on
`space: Some(Apply(1)), expected None` before the guard. Row keys/clicks now ignore a row being
renamed; the field consumes its mouse events. Guide exit closes its settings, and row actions
remain visible while keyboard focus is inside the row.

## Build and artifact checks

Initial reproduction: [Windows d57ea84](https://github.com/techiesreviews/camframe/actions/runs/45028934648).
Its new probe first hit a PowerShell array-expression bug; the retained screenshot independently
shows the viewport clipping. The script expression was corrected before the next build.

First fixes: [Windows](https://github.com/techiesreviews/camframe/actions/runs/45030304789),
[Mac ARM/Intel](https://github.com/techiesreviews/camframe/actions/runs/45030309046).
These are deliberately recorded as failed: Windows found the Escape focus problem; Mac's new
Full screen test aimed at its pre-drag origin. Both are corrected in the follow-up.

The `camframe-parity-windows`, `camframe-parity-macos-arm64` and `camframe-parity-macos-x64`
artifacts contain 11 side-by-side states: bubble, menu, small/large menu, Camera, Style
(None/Glow/Blur), Scenes (grid/list), and Full screen. Left is unchanged Electron 0.9.0 source;
right is a real GPUI desktop capture. The capture refuses any Electron source drift and any blank
comparison. Video patterns differ; this is not a video-pixel equality test.

## Findings ledger

The complete kit ledger remains in the PR. R5-18 (rename), R5-19 (guide cleanup), R5-20 (remaining
390 px expansions), R5-21 (rename/save errors), R5-22 (keyboard focus), R5-23 (Back announcement),
R5-24 (empty camera selection), R5-25 (this run), and R5-26 (README) are fixed. Prior nits and test
gaps outside this UI correction remain recorded rather than silently counted as fixed.

## Decision

Test build only. No merge, release, switch-over, tag or production update. Physical-camera
quality/hot-plug/continuity, NVDA/VoiceOver and real-camera performance remain unverified release
gates under ADR 0042. The 71-feature source contract audit is [rust-090-parity.md](../rust-090-parity.md).
