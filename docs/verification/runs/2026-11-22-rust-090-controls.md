# Verification run: Rust 0.9.0 controls parity — 2026-11-22

- **Commit:** 1f4701fd43acc62dfed2868f95afac267557bba0 (final implementation; evidence-only commits may follow).
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
| `kit rust` | Pass | 40 core, 3 chrome, 3 shared fixture suites, 18 app and 1 image-check test | 65 test functions; fmt and Clippy with warnings denied. `.scratch/kit-jobs/parity-menu-final/log` |
| `kit shots` | Pass | 25 baseline captures | `.scratch/shots/2026-11-22T15-11-18-990Z`; this checks Electron, not GPUI. |
| `kit ux` | Cannot run | No feature list | `RESULT: fail ux ENOENT: no such file or directory, open '.../docs/agents/features.md'`. Native verifiers and comparison captures provide the Rust evidence. |
| Syntax and whitespace | Pass | `node --check rust/scripts/capture-parity.mjs`, `git diff --check` | |

## Reproduction and fixes

L1–L3 share a native resize defect. `SetWindowPos` sends `WM_SIZE` synchronously while GPUI has
its Window checked out. The callback cannot re-enter that Window. The OS window grows, but
GPUI's viewport and clipping mask retain the previous size. The first Windows Full screen capture
at d57ea84 shows only a 340×398 drawing in a 1024×768 display. Windows bounds changes now call
`window.bounds_changed(cx)` explicitly; initial bounds are synchronized too. Mac frame changes
run on GPUI's foreground executor after the current Window update returns. AppKit's synchronous
resize/repaint callback can then enter GPUI, instead of stretching a cached Compact scene.
Requested bounds stay authoritative until AppKit applies them, including guide exit followed
by Full screen or a Scene in the same UI turn; superseded frame requests are discarded.
Camera frames use cover fit while a new capture size is arriving. Toolbar button sizes fit even
180 px Portrait; the picture and controls are no longer clipped by the old viewport.

The first fixed native build fills all four Full screen corners and passes the real corner resize.
It exposed a separate Escape focus issue: the auto-hidden toolbar could retain keyboard focus.
Full screen now focuses the persistent root and activates the window. The Mac verifier also now
refreshes its cached origin after its drag, before aiming at the Full screen button.

L4/L5: settings use the original 240 px maximum width, top 76, 10 px padding, 3 tabs, selects,
switches, grey 3 px slider tracks and the original text, icons and colors. Settings never grow the
native window; the whole panel, including tabs, scrolls. Windows shows its 17 px scrollbar
rail and Mac a 15 px legacy-style rail without arrow buttons. Mac does not yet follow the
system overlay-scrollbar preference (R11-32). Scenes use compact list/grid layouts, screen previews preserving
camera aspect, Save look slots, rename, delete/Undo, the 1.8 s saved check and file status on its
control. The tray menu matches 0.9.0's order and labels. Framing replaces the other toolbar
buttons with its original zoom/support row. The simpler guide keeps its approved no-ghost scope,
with the original visual hierarchy plus Back, Skip and Done.

Review found that Scene row commands intercepted rename keys. A regression test failed on
`space: Some(Apply(1)), expected None` before the guard. Row keys/clicks now ignore a row being
renamed; the field consumes its mouse events. Guide exit closes its settings, and row actions
remain visible while keyboard focus is inside the row.

GPUI already activates buttons on Enter/Space release. Removing duplicate manual handlers
prevents a toggle from running twice. Scene rows prevent the synthetic default click only when
the row itself handles the key; child edit buttons run alone. Ctrl/Cmd+Z undoes a pending delete
before a look change, matching 0.9.0; the visible look Undo only undoes that look change.
Slider click/drag coordinates now use the thumb centers, including the Windows scroll rail.
Export reports its Scene count; import/export failures remain on the respective control.

## Build and artifact checks

| Target/check | Result | Artifact/hash/notes |
| --- | --- | --- |
| Windows native desktop, Portable, NSIS install/uninstall | Pass after retry | [1f4701f Windows job](https://github.com/techiesreviews/camframe/actions/runs/45036927695/job/137254353394); license included. |
| macOS ARM native desktop, packaged app, DMG/ZIP | Pass | [1f4701f Mac ARM job](https://github.com/techiesreviews/camframe/actions/runs/45036927724/job/137252667561); app bundle license included. |
| macOS Intel native desktop, packaged app, DMG/ZIP | Pass | [1f4701f Mac Intel job](https://github.com/techiesreviews/camframe/actions/runs/45036927724/job/137252667824). |
| Native text and icons | Pass | Selected-tab bright pixels: Windows Camera 95 / Style 67 / Scenes 65; Mac ARM Camera 138 / Style 106 / Scenes 113. All six toolbar icons and six panel variants pass. |
| Side-by-side capture | Pass | 11 Electron 0.9.0/native comparisons per platform; 33 committed PNGs below. |
| Signing/notarization | Not run | Test builds are intentionally unsigned/ad-hoc signed; no release was made. |

The first [`1f4701f` Windows push job](https://github.com/techiesreviews/camframe/actions/runs/45036921786/job/137252659621) failed its new “Camera controls opened before Space”
precondition. The [PR job](https://github.com/techiesreviews/camframe/actions/runs/45036927695/attempts/1) passed the native checks but timed out opening the unchanged
Electron Style tab during comparisons. A rerun passed both native checks and all 11
comparisons, followed by NSIS install/uninstall. These failures are recorded as input/capture
flakiness, not erased or counted as passing attempts.

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
comparison. Video patterns differ; this is not a video-pixel equality test. The Electron fake camera is
listed as a device, while the Rust demo pattern does not enumerate a hardware camera. Mac
desktop backgrounds also differ because these are genuine desktop captures, not redrawn UI.

## Side-by-side screenshots

Left: unchanged Electron 0.9.0. Right: real Rust GPUI desktop. All final captures use
`1f4701fd43acc62dfed2868f95afac267557bba0`.

| State | Windows | Mac ARM | Mac Intel |
| --- | --- | --- | --- |
| Bubble | [Windows](2026-11-22-rust-090-controls/windows/bubble-side-by-side.png) | [ARM](2026-11-22-rust-090-controls/macos-arm64/bubble-side-by-side.png) | [Intel](2026-11-22-rust-090-controls/macos-x64/bubble-side-by-side.png) |
| Toolbar | [Windows](2026-11-22-rust-090-controls/windows/menu-side-by-side.png) | [ARM](2026-11-22-rust-090-controls/macos-arm64/menu-side-by-side.png) | [Intel](2026-11-22-rust-090-controls/macos-x64/menu-side-by-side.png) |
| 180 px Portrait menu | [Windows](2026-11-22-rust-090-controls/windows/small-menu-side-by-side.png) | [ARM](2026-11-22-rust-090-controls/macos-arm64/small-menu-side-by-side.png) | [Intel](2026-11-22-rust-090-controls/macos-x64/small-menu-side-by-side.png) |
| 640 px Wide menu | [Windows](2026-11-22-rust-090-controls/windows/large-menu-side-by-side.png) | [ARM](2026-11-22-rust-090-controls/macos-arm64/large-menu-side-by-side.png) | [Intel](2026-11-22-rust-090-controls/macos-x64/large-menu-side-by-side.png) |
| Camera | [Windows](2026-11-22-rust-090-controls/windows/camera-side-by-side.png) | [ARM](2026-11-22-rust-090-controls/macos-arm64/camera-side-by-side.png) | [Intel](2026-11-22-rust-090-controls/macos-x64/camera-side-by-side.png) |
| Style: None | [Windows](2026-11-22-rust-090-controls/windows/style-side-by-side.png) | [ARM](2026-11-22-rust-090-controls/macos-arm64/style-side-by-side.png) | [Intel](2026-11-22-rust-090-controls/macos-x64/style-side-by-side.png) |
| Style: Glow | [Windows](2026-11-22-rust-090-controls/windows/style-glow-side-by-side.png) | [ARM](2026-11-22-rust-090-controls/macos-arm64/style-glow-side-by-side.png) | [Intel](2026-11-22-rust-090-controls/macos-x64/style-glow-side-by-side.png) |
| Style: Progressive blur | [Windows](2026-11-22-rust-090-controls/windows/style-blur-side-by-side.png) | [ARM](2026-11-22-rust-090-controls/macos-arm64/style-blur-side-by-side.png) | [Intel](2026-11-22-rust-090-controls/macos-x64/style-blur-side-by-side.png) |
| Scenes: grid | [Windows](2026-11-22-rust-090-controls/windows/scenes-side-by-side.png) | [ARM](2026-11-22-rust-090-controls/macos-arm64/scenes-side-by-side.png) | [Intel](2026-11-22-rust-090-controls/macos-x64/scenes-side-by-side.png) |
| Scenes: list | [Windows](2026-11-22-rust-090-controls/windows/scenes-list-side-by-side.png) | [ARM](2026-11-22-rust-090-controls/macos-arm64/scenes-list-side-by-side.png) | [Intel](2026-11-22-rust-090-controls/macos-x64/scenes-list-side-by-side.png) |
| Full screen | [Windows](2026-11-22-rust-090-controls/windows/fullscreen-side-by-side.png) | [ARM](2026-11-22-rust-090-controls/macos-arm64/fullscreen-side-by-side.png) | [Intel](2026-11-22-rust-090-controls/macos-x64/fullscreen-side-by-side.png) |

[Before: clipped Windows Full screen at d57ea84](2026-11-22-rust-090-controls/windows-fullscreen-before.png).
[After: real Windows corner resize](2026-11-22-rust-090-controls/windows/resize-large.png).
[Mac Full screen toolbar at normal scale](2026-11-22-rust-090-controls/macos-arm64/fullscreen-toolbar.png).

## Manual checks

| ID | Result | Observation/evidence |
| --- | --- | --- |
| W-01–W-37 | Not run as a human matrix | CI runs native desktop interaction and image checks, not the complete physical-PC matrix. |
| M-01–M-12 | Not run as a human matrix | Both native Mac architectures are exercised in CI; hardware, Spaces and VoiceOver remain open. |
| L1–L3 | Pass in native automation | Full screen corner coverage, Escape restores Compact, real corner resize, large/small menus and camera cover. |
| L4 | Partial | Standard-theme layout is aligned and captured; Mac scrollbar preference and high-contrast file borders remain open (R11-32/R11-33). |
| L5 | Inconclusive for complete visual/hardware parity | 71-feature source audit and 11 real side-by-side states per platform; contract presence is not pixel equality or hardware certification. |

## Findings ledger

The complete kit ledger remains in the PR. R5-18 (rename), R5-19 (guide cleanup), R5-20 (remaining
390 px expansions), R5-21 (rename/save errors), R5-22 (keyboard focus), R5-23 (Back announcement),
R5-24 (empty camera selection), R5-25 (this run), and R5-26 (README) are fixed. Prior nits and test
gaps outside this UI correction remain recorded rather than silently counted as fixed.

R10's Opus review of `269cdaa` returned only P3/nits and validation gaps. The quality-select
popup now derives its Y position from its label gap, and the scroll rail switches to the
contrast palette. Screenshot inspection also corrected Scene number outlines, the 1.8 s
saved-check color, file-button icon order/background and the miniature desktop shadow.

Declined: R10-31 (P3): the requested sign change is incorrect for these fixed-aspect tiles.
`screen_height = screen_width * 9 / 16`: narrowing a two-column grid by 17 px makes each
row **shorter** by `17 * 9 / 32`, not taller. Adding that amount reconstructs the wider,
rail-free height. Subtracting it can remove a necessary rail and make its appearance
oscillate. The existing sign is retained. The later toolbar-only fix prevents SVG flex shrinking in the
minimum-width Portrait menu; each icon remains 20 px, as in 0.9.0. Remaining P3 documentation/test-gap findings
are listed in the kit ledger; no broader refactor is required for this test-build correction.

### Open findings at the review budget limit

The final Opus 5.5 high review covered `1f4701f`. Its verdict is **not approved**: the kit
reports 11 total PR rounds and two open shoulds. No waiver or further code round was taken.
The reviewer and builder agree on both remaining issues:

- **R11-32, P2:** Mac always reserves a 15 px white rail when content overflows. Electron
  follows `NSScroller.preferredScrollerStyle`; a trackpad Mac normally uses an overlay
  scrollbar without reserving width. CI proves the legacy setting only. Follow-up: query
  the preference, respond to its change notification, and draw a temporary overlay thumb
  for the overlay style.
- **R11-33, P2:** Import/Export's new low-opacity border overrides `control()`'s high-contrast
  border. Follow-up: apply the faint normal-theme border only when high contrast is off.
  Native normal-theme checks do not cover this accessibility state.

The non-GPT second look was attempted through the kit. Grok's weekly budget was 8/8, and
free OpenCode refused with “Free usage limit reached.” The result is skipped, not approved.
No GPT reviewer, budget override, merge or release was used. Opus withdrew R10-31 in
R11 after checking the aspect-ratio calculation; it is resolved, not an open should.

## Regressions and surprises

- The Full screen comparison captures the Rust toolbar visible and Electron’s hidden;
  it proves coverage, not equal toolbar visibility at the sampled time. The separate
  Mac `fullscreen-toolbar.png` checks that the toolbar is repainted at its normal size.
  Full hide/show timing still needs a focused manual parity check.
- New probes exposed the stale Windows viewport and Escape focus bug, then a stale Mac
  repaint and pending-bounds race. Their failed CI runs are linked in Build and artifact checks above.
- The first comparison run used nested preferences instead of the app’s flat document;
  fixed before accepting comparisons. The Mac runner’s Bash 3.2 could not run the kit;
  CI now installs modern Bash.
- The Windows installer’s new license path was relative twice; corrected to the script’s
  working directory. The existing Mac app-bundle license placement passes packaging.
- The source tray PNG is corrupt; the working Rust raster glyph remains. The guide’s
  ghost mouse and old login cleanup remain the approved ADR 0042 differences.

## Agent Kit result lines

```text
RESULT: ok doctor 12/12 checks passed
RESULT: ok unit none affected
RESULT: ok unit 480/481 (21 files) log .scratch/unit/20261122T140042-3018827.log
RESULT: pass cargo test and clippy (rust/)
RESULT: ok shots 25 screenshots evidence /home/ubulex/Projects/camframe-tools-393-sol/.scratch/shots/2026-11-22T15-11-18-990Z
RESULT: fail ux ENOENT: no such file or directory, open '/home/ubulex/Projects/camframe-tools-393-sol/docs/agents/features.md'
RESULT: ok opened #72 1f4701f
```

`kit pr --no-merge` used the non-GPT second-look order. Final review verdict:
“not approved (budget used, 2 open findings left for Lex)”. Its return status only means
the test PR was updated, not that those findings were accepted or that a release is approved.

## Release decision

- **Decision:** No-go
- **Reason:** Test build only; Lex has not approved a release.
- **Known exceptions accepted by:** Lex, ADR 0042 (simpler guide and deferred switch-over).
- **Follow-ups:** Physical-camera and accessibility checks in the Manual checks table; Lex tries the test build.

Test build only. No merge, release, switch-over, tag or production update. Physical-camera
quality/hot-plug/continuity, NVDA/VoiceOver and real-camera performance remain unverified release
gates under ADR 0042. The 71-feature source contract audit is [rust-090-parity.md](../rust-090-parity.md).
