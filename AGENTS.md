## Agent skills

### Issue tracker

Issues are tracked in GitHub at `techiesreviews/camframe`. See `docs/agents/issue-tracker.md`.

### Triage labels

Use the standard five-role label vocabulary. See `docs/agents/triage-labels.md`.

### Domain docs

CamFrame uses a single-context documentation structure. See `docs/agents/domain.md`.

### Documentation maintenance

Read `docs/README.md` before changing product behavior. Keep the reconstruction documents synchronized with the source, add an ADR for durable decisions, record discarded or uncertain attempts under `docs/experiments/`, and add a dated verification run under `docs/verification/runs/` for every release candidate or material behavior change.

### Agent Kit

Agent Kit is required for all coding here, for every model and provider, including delegated workers: read `docs/agents/agent-scripts.md`, run `scripts/agents/kit --help` and `scripts/agents/kit doctor` first, then `kit unit` (and `kit shots` for Overlay UI changes). Delegated work must carry this requirement.

Kitchen rulebook: `scripts/agents/kit rulebook` (stations, who decides, builder and reviewer pins).
Agent commands: `scripts/agents/kit --help`; `scripts/agents/kit <command> --help` for one.

## Messages to Lex
<!-- messages-to-lex:start v1 -->
- Only what matters to him. Start with the question, or what he must do (test, do or answer).
- Add a recommendation when it fits.
- Caveman style, short bullets, plain words (he is not technical). He asks if he wants more context.
- Leave out internal process (review rounds, waivers, SHAs, file paths) unless he must act on it.
- Example: "Keep the old export button or remove it?" / "Both do the same." / "Recommend: remove it."
<!-- messages-to-lex:end -->
