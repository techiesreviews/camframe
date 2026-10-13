# Verification run: GPUI build removal — 2026-10-13

- **Removal commit:** `9bb58c3e5d4b4408fd449c0cfecf284fde54a38d`, pushed to `experiment/gpui-port`
- **Version:** abandoned GPUI experiment `0.1.0`; Electron unaffected
- **Observer:** Codex GPT-6.1-Sol implementation agent; Lex reported the Windows retest result
- **Environment:** repository inspection on Linux; no native Windows check performed by the agent
- **Related records:** [experiment](../../experiments/2026-09-30-gpui-port.md#2026-10-13-abandonment-and-build-removal), [transparent Overlay verification](2026-10-13-gpui-transparent-overlay.md)

## Request and disposition

Lex reported the corrected Windows build was “Still the same” and requested “remove the GPUI build.” The Windows build workflow is deleted from the pushed branch, and the port is marked abandoned. `gpui/` source remains archived for research. No Electron source, releases, or product behavior changes are part of this removal.

## Checks

| Check | Result | Evidence/notes |
| --- | --- | --- |
| `.github/workflows/build-gpui-windows.yml` removal | Pass (source and remote inspection) | Commit `9bb58c3` deletes the workflow and was pushed successfully. The GitHub contents endpoint for `.github/workflows` on `experiment/gpui-port` lists only `build-desktop.yml`; no new GPUI run was created for the removal commit. |
| Archived source and documentation | Pass (source inspection) | Source retained; README and experiment mark abandonment and replace current artifact download instructions with historical evidence. |
| Documentation links | Pass (inspection) | Relative links between the README, experiment, and verification records resolve. |
| `git diff --check` | Pass | No whitespace errors. |
| Rust tests and Clippy | Not run | Removal changes workflow and documentation only; GPUI work is stopped. Historical passing tests do not prove native transparency. |

## External cleanup

| Action | Result | Notes |
| --- | --- | --- |
| Disable GitHub GPUI workflow | Blocked (API permission) | Workflow ID `381793488`: disable request returned HTTP 403, `Resource not accessible by personal access token`. Its GitHub registration could not be disabled, but the workflow source is absent from the pushed branch, stopping new branch builds. Historical runs remain accessible. |
| Delete GPUI build artifacts | Blocked (API permission) | Deletion requests for artifact IDs `11798396851`, `11797999468`, and `11727282729` returned the same HTTP 403. All three remain on GitHub; cleanup requires GitHub Actions write access. No permission expansion or workaround was attempted. |
| Remaining GPUI runs/tasks | None found | Lead agent found no running GPUI workflow run or pending task to cancel. |
| Local GPUI build outputs | Pass | Lead agent ran `cargo clean --manifest-path /home/ubulex/Projects/camframe/gpui/Cargo.toml`: removed 19,063 files, 10.8 GiB total. Archived source and Preferences are retained. |

## Decision

Abandon the GPUI experiment and stop producing new builds at Lex's request. Preserve historical source and test evidence. Existing GitHub artifacts could not be deleted with the available token. No further transparency investigation is planned.
