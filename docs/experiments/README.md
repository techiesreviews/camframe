# Experiments

Experiments preserve learning that should survive even when code is reverted or never merged. They are not architecture decisions and do not make a behavior part of the product contract.

Create `YYYY-MM-DD-short-name.md` from `TEMPLATE.md` before or at the start of uncertain work. Keep one record per hypothesis. Update it as evidence arrives and end with one disposition:

- **Adopted** — promoted into product/source/tests; link the PR and any ADR.
- **Rejected** — evidence showed the approach should not ship.
- **Inconclusive** — evidence was insufficient; state the next discriminating test.
- **Superseded** — a later experiment replaced it; link that record.
- **Abandoned** — stopped for a non-technical constraint; say why.

Never delete a completed record merely because the attempt failed. Remove temporary code/assets and state whether any artifacts remain.

Current backfilled records:

- [`2026-08-12-fullscreen-capture-renegotiation.md`](2026-08-12-fullscreen-capture-renegotiation.md) — dynamic profile switching and the unsuccessful canvas workaround.
