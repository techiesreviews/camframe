# Verification run: Rust frame defaults and Full screen motion — 2026-11-22

- **Baseline:** `1caa0dd`, PR [#72](https://github.com/techiesreviews/camframe/pull/72).
- **Observer:** GPT Sol, Linux x64, Rust 1.98.1, Node 24; synthetic camera only.
- **Scope:** Two fixes requested by Lex; no merge, release or board change.

## Reproduction

`kit go p3-all-red -- kit rust` failed four regressions before the implementation:
imported and earlier Rust settings both retained `(6, "#ff8800")` instead of `(0, "#ffffff")`;
entering Full screen jumped the camera to the edge and removed its round corners immediately;
leaving Full screen snapped the camera back to 288 px before the window shrank.
Evidence: `.scratch/kit-jobs/p3-all-red/log` in the working checkout.

The failing [Mac ARM run](https://github.com/techiesreviews/camframe/actions/runs/45039459141)
reported two transparent Full screen corners. The prior packaged-app capture in
`.scratch/p2-arm-failed.zip` also shows an enlarged cached Compact scene, including oversized
toolbar and corner handles. Native bounds changes now explicitly synchronize GPUI after AppKit
applies the frame, even when its resize callback was missed.

## Automated evidence

- `kit doctor`: 12/12 checks passed. The project runner guide is absent.
- `kit rust`: passes formatting, 72 test functions and Clippy after the changes. Evidence:
  `.scratch/kit-jobs/p3-green3/log`. Intermediate runs caught a float annotation error and
  test-module ordering; both were corrected before the passing run.
- Preferences tests exercise real files: fresh start; imported 0.9.0 settings; an earlier Rust
  file; second launch after migration; a newly chosen 4 px `#123456` frame surviving restart;
  other preferences retained and the original Electron file unchanged.
- Motion tests sample the same camera-layout function used by rendering, at deterministic
  timestamps. Unchanged 0.9.0 CSS was sampled in Chromium by pausing its actual transitions at
  0/70/140/210/280 ms while resizing the viewport along its original window curve. At 140 ms
  both directions have camera `(left 9, top 42, width 705, height 511.5)` in viewport
  `1122 × 735`. Position and size differ by less than 0.03 px from all reference samples.
  Reversal is continuous; reduced motion has no surface animation.
- `kit unit --affected`: no affected Node suites; Rust checks use `kit rust`.
- `kit shots`: 25 Electron baseline screenshots passed, evidence
  `.scratch/shots/2026-11-22T20-08-26-654Z`. These do not prove native Rust motion.
- `kit ux --base 1caa0dd`: cannot run because `docs/agents/features.md` is missing; not a pass.
- `git diff --check`: passed before commit.

## Limits and pending native checks

Windows and both Mac CI jobs must check this head, including the packaged Mac app, Full screen
coverage, Escape restoring Compact, toolbar scale and border appearance. Native results and
download links will be recorded after push. Physical cameras and Lex's side-by-side motion
judgment remain unverified. GPUI uses a scalar corner radius, so intermediate rounded corners
approximate CSS's elliptical radii even though timing, offsets and dimensions match.

Done when 1: not met — this narrow follow-up proves the frame reset and camera layout regressions
locally; the complete 71-feature Windows/Mac parity and physical-camera checks remain open.
Done when 2: not met — no new real-camera size/startup/memory comparison in this follow-up.
Done when 3: not met — Lex has not approved release; PR #72 remains unmerged.

## Release decision

No-go. New test build only; merge and release still require Lex's go.
