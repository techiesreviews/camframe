# CamFrame documentation

This directory is the reconstruction dossier for CamFrame. Its goal is to preserve enough product intent, observable behavior, implementation contracts, and verification evidence for a future engineer or AI agent to reproduce the current application without relying on institutional memory.

## Reading order

1. [`../CONTEXT.md`](../CONTEXT.md) — canonical domain terms and module ownership.
2. [`product-spec.md`](product-spec.md) — the user-visible unreleased product contract based on v0.4.3.
3. [`visual-spec.md`](visual-spec.md) — reachable layout, visual tokens, states, motion, and icon contract.
4. [`architecture.md`](architecture.md) — runtime boundaries, module/caller map, and important flows.
5. [`data-contracts.md`](data-contracts.md) — Preferences, Scenes, IPC, constraints, and geometry.
6. [`rebuild-guide.md`](rebuild-guide.md) — dependency baseline and implementation sequence.
7. [`verification/README.md`](verification/README.md) — automated coverage and the required manual matrix.
8. [`product-history.md`](product-history.md) — what was added, retained, renamed, removed, or unsuccessful.
9. [`known-gaps.md`](known-gaps.md) — verified mismatches and unresolved risks.
10. [`adr/`](adr/) — durable product and architecture decisions.
11. [`experiments/`](experiments/) — attempts and evidence, including ideas that did not work.

Repository workflow metadata lives in [`agents/`](agents/). It does not describe product behavior.

## Evidence hierarchy

Use these labels in new documentation and change records:

- **Automated**: demonstrated by a repeatable checked-in test or command.
- **Manual**: observed by a named person on a recorded OS/hardware configuration.
- **Source inspection**: directly present in the checked-in implementation but not exercised end to end.
- **Historical**: recorded by an ADR, merged PR, issue, commit, or release artifact.
- **Unverified**: intended or plausible, but not yet demonstrated.

For the current implementation, checked-in source plus executable tests outrank descriptive prose. Accepted ADRs outrank new design proposals. If source and an ADR disagree, do not silently “fix” either account: add the discrepancy to `known-gaps.md`, then resolve it with a new ADR and code change.

## Required maintenance workflow

For every material behavior change:

1. Before implementation, read `CONTEXT.md`, the relevant product/architecture sections, and applicable ADRs.
2. If exploring an uncertain approach, copy [`experiments/TEMPLATE.md`](experiments/TEMPLATE.md) before coding. Record the hypothesis, baseline, variants, evidence, result, and cleanup disposition.
3. Add or update automated tests that express the retained behavior.
4. Update `product-spec.md`, `architecture.md`, or `data-contracts.md` when their contracts change.
5. Add an ADR when the decision is durable or constrains future design. Supersede; never rewrite accepted history.
6. Add a dated run from [`verification/runs/TEMPLATE.md`](verification/runs/TEMPLATE.md). Never mark a manual check passed without the hardware/OS and observer.
7. Update `product-history.md` for releases and user-visible removals. Link the PR/issue/ADR rather than copying uncertain context.

Documentation-only wording corrections do not require an ADR. They still require `git diff --check`, link validation by inspection, and a dated verification entry when they change the reconstruction baseline.

## Baseline represented here

- Product version: unreleased working tree based on `0.4.3`
- Git baseline inspected: `fe8e6c6` (`main`, tag `v0.4.3`)
- Settings schema: `12`
- Documentation audit date: `2026-08-29`
- Audit scope: the v0.4.3 reconstruction baseline plus contextual Overlay onboarding, live contrast/reduced-motion behavior, removal of the unreachable Controller, one stable Camera quality, and a pinned release toolchain tracked by GitHub issues 5, 13–14, and 21–22, ADR 0012, and ADR 0016–0027.

Generated packages, dependencies, ignored logs, and T3 checkpoint refs are not product source. They were used only as supporting local evidence where explicitly recorded.
