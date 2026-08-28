# Verification run: stable Camera quality and Controller removal — 2026-08-29

- **Commit:** working tree based on `2f6b381f2c24d0b14781a6613a25c743be08b782`
- **Version:** unreleased based on 0.4.3; Preferences schema 12
- **Observer:** Codex automated/source inspection; camera-hardware review pending
- **Environment:** Windows 11 Pro 10.0.26200 AMD64; Node 24.15.0; npm 11.14.1; Electron 43.2.0 development source
- **Cameras:** Physical camera continuity not asserted by this run
- **Related records:** [GitHub issue 5](https://github.com/techiesreviews/camframe/issues/5), [issue 21](https://github.com/techiesreviews/camframe/issues/21), [issue 22](https://github.com/techiesreviews/camframe/issues/22), ADR 0025, ADR 0026

## Automated checks

| Command | Result | Counts/duration | Evidence/notes |
| --- | --- | --- | --- |
| `npm ci` | Not run | | Existing lockfile install reused |
| `npm test` | Pass | 50/50, about 101 ms | Covers one sanitized Camera quality, stable mode profile, no Full screen quality update, Controller/bridge/file removal, and prior onboarding/accessibility contracts |
| Syntax checks | Pass | `main.js`, `overlay.js`, `settings.js`, `cameras.js`, `fullscreen.js`, `onboarding.js`, `preload.cjs` | Node parser accepted all runtime modules |
| `git diff --check` | Pass | Clean | Only Git line-ending conversion warnings were emitted |
| Dead-contract search | Pass | Source tree | No live `fullscreenResolution`, Controller window, Controller renderer, or Controller-only IPC remains |

## Development launch and artifacts

| Target/check | Result | Artifact/hash/notes |
| --- | --- | --- |
| Windows development launch | Pass | Fresh isolated profile launched; visible `CamFrame overlay` process PID 43620 |
| Windows unpacked/NSIS/portable | Not run | Current-tree packaging is tracked by issue 22 |
| macOS arm64/x64 DMG/ZIP | Not run | No macOS environment; packaged permission verification is tracked by issue 21 |
| ASAR/locales/fonts/permission metadata | Not run | Current-tree artifact inspection is tracked by issue 22 |

## Manual checks

| ID | Result | Observation/evidence |
| --- | --- | --- |
| W-14/W-16 | Pending human review | Full screen should change geometry without changing the active track profile |
| W-17 | Pending human review | Requires multiple devices including Elgato; issue 5 remains open with `ready-for-human` |
| W-18 | Pending human review | User Camera quality changes and unsupported high profiles require live hardware |
| W-26 | Source-level pass; visual review pending | Separate Controller implementation and assets are absent; open-controls entry points target Overlay Inline settings |
| M-01/M-02 | Blocked | No macOS environment; issue 21 carries the verification brief |

## Dispositions

- KG-02 is resolved: the unreachable surface and its unused privileged contracts were removed.
- KG-03 is fixed at the source trigger: Full screen no longer renegotiates the track. Hardware acceptance remains open in issue 5.
- KG-04 is tracked by issue 21 as a human macOS verification task.
- KG-05 and KG-06 are combined in issue 22 because the same Electron harness, artifact retention, and current-tree build pipeline should close both evidence gaps.

## Release decision

- **Decision:** No-go
- **Reason:** automated checks and a development launch pass, but issue 5 hardware continuity, issue 21 macOS permission evidence, issue 22 Electron/visual/package coverage, and issue 14 native accessibility review remain incomplete.
