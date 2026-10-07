# REVIEW-1 — P6-40e-plaid-rekey

verdict: ACCEPT_WITH_NITS — 25 hypotheses (19 refuted, 4 confirmed as NIT, 1 inconclusive → run). The H-d fix cannot cause nightly full walks (cursor written to every account of the token after a successful walk); ambiguity decided before pairing; CSV/manual counted in S; global new-id check; tombstones; item scoping; guarded UPDATE; per-item atomicity; verified backup before writes; counts-only output; one key definition. NITs in NITS.md. scope_violations: [].
