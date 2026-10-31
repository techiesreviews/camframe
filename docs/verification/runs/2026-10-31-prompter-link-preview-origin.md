# Verification run: build/ke-80-preview-origin — 2026-10-31

- **Commit:** `54369c5` and `3725702` on base `2df0d20`, plus the review-fix commit after them that adds two preview checks (status read, look-alike preflight); the counts below are for that last commit
- **Version:** unreleased after 0.6.0
- **Observer:** agent (Claude Opus 5.5, ticket ke-80)
- **Environment:** Linux 7.0.0-42-generic, Node v24.21.0, dev checkout (no packaged build)
- **Cameras:** none (no camera needed for these checks)
- **Related change/PR:** https://github.com/techiesreviews/camframe/pull/24 (ADR 0033)

## Automated checks

| Command | Result | Counts/duration | Evidence/notes |
| --- | --- | --- | --- |
| `scripts/agents/kit doctor` | Pass | 12/12 checks | 4 kit setup pieces reported missing (warnings; the shared kit's `kit init --all` adds them) |
| `scripts/agents/kit unit` | Pass | 191/191, 12 files | `.scratch/unit/20261031T064706-2070240.log` (local, not committed) |
| `npm ci` | Not run | | `node_modules` hard-linked from a checkout with the same `package-lock.json` |
| `npm test` | Pass | 191 tests, about 0.4 s | New: the preview's status read, preflight (Private Network Access) and cue through the real server; a preview look-alike refused with `403` and no CORS or Private Network Access header, for a cue and a preflight; `originAllowed` refuses the preview's http form, other ports and look-alike names |
| Syntax checks | Not run | | |
| `git diff --check` | Pass | | |

## Build and artifact checks

| Target/check | Result | Artifact/hash/notes |
| --- | --- | --- |
| Windows unpacked | Not run | No release (a CamFrame release is Lex's) |
| Windows NSIS | Not run | |
| Windows portable | Not run | |
| macOS arm64 DMG/ZIP | Not run | |
| macOS x64 DMG/ZIP | Not run | |
| ASAR/locales/fonts/permission metadata | Not run | |

## Manual checks

| ID | Result | Observation/evidence |
| --- | --- | --- |
| W-30 (preview step) | Not run | Unverified until Lex opens https://preview.prompter.techies.tools in Chrome or Edge with the link on: its own one-time local network prompt, then cues switch the view. The preview itself was checked to load over https (200) on 2026-10-31. |

## Regressions and surprises

None.

## Release decision

- **Decision:** Documentation baseline only
- **Reason:** origin-list change for the next release; no build made.
- **Known exceptions accepted by:** —
- **Follow-ups:** W-30's preview step by hand with the next release.
