# Verification run: <version/branch> — YYYY-MM-DD

- **Commit:** <full hash>
- **Version:** <version>
- **Observer:** <person/agent>
- **Environment:** <OS/build, CPU/arch, GPU, displays/scaling, Node/npm, packaged/dev>
- **Cameras:** <models, drivers/firmware, connection path>
- **Related change/PR:** <link>

## Automated checks

| Command | Result | Counts/duration | Evidence/notes |
| --- | --- | --- | --- |
| `npm ci` | Not run | | |
| `npm test` | Not run | | |
| Syntax checks | Not run | | |
| `git diff --check` | Not run | | |

## Build and artifact checks

| Target/check | Result | Artifact/hash/notes |
| --- | --- | --- |
| Windows unpacked | Not run | |
| Windows NSIS | Not run | |
| Windows portable | Not run | |
| macOS arm64 DMG/ZIP | Not run | |
| macOS x64 DMG/ZIP | Not run | |
| ASAR/locales/fonts/permission metadata | Not run | |

## Manual checks

Copy the applicable IDs from `../README.md` and record each as Pass, Fail, Inconclusive, Blocked, or Not run. Add evidence paths and exact observations; do not write only “looks good.”

| ID | Result | Observation/evidence |
| --- | --- | --- |
| | | |

## Regressions and surprises

List every unexpected observation, including non-blocking differences. Link an issue or experiment where follow-up is needed.

## Release decision

- **Decision:** Go | No-go | Documentation baseline only
- **Reason:**
- **Known exceptions accepted by:**
- **Follow-ups:**
