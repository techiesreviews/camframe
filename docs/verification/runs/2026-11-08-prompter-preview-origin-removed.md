# Verification run: build/fleet-lead-camframe-remove-the-prompter-preview-trusted-address-tools-4 — 2026-11-08

- **Commit:** see the PR (the final hash is the PR's merge commit on the `dev` branch)
- **Version:** unreleased after 0.7.0 (no version bump, no tag, no release)
- **Observer:** agent (Claude Sonnet 5.5, Orbit card TOOLS-49)
- **Environment:** Linux, Node v24, dev checkout (no packaged build)
- **Cameras:** none (no camera needed for these checks)
- **Related change/PR:** the PR that carries this file (ADR 0033, note of 2026-11-08)

## Automated checks

| Command | Result | Counts/duration | Evidence/notes |
| --- | --- | --- | --- |
| `scripts/agents/kit doctor` | Pass | 12/12 checks | One setup piece (AGENTS.md "Review loop" line) was missing and was added with `kit init` |
| `scripts/agents/kit unit --affected` | Pass | 49/49, 2 files | `test/prompter-link.test.js` and `test/prompter-control.test.js` |
| `test/prompter-link.test.js` before the code change | Fail | 2 tests | The preview address was still allowed: `originAllowed` returned `true`; the real server answered `200` |
| `git diff --check` | Pass | | |

## Build and artifact checks

Not run: no release, no packaged build.

## Manual checks

| ID | Result | Observation/evidence |
| --- | --- | --- |
| W-30 | Not run | The preview step is removed from the row; the rest stays open as before |
| M-12 | Not run | Unchanged; it follows W-30 |

## Regressions and surprises

None seen. The live prompter address `https://prompter.techies.tools` still gets the status read, the preflight with Private Network Access and the cue through the real server (unit test). Earlier run files that name the preview address are history and are not edited.

## Release decision

- **Decision:** Documentation baseline only
- **Reason:** A change on `dev`; any CamFrame release needs Lex's own go.
- **Known exceptions accepted by:** not applicable
- **Follow-ups:** none
