# REVIEW-1 — P6-40a-deletion-tombstones

verdict: ACCEPT_WITH_NITS — 18 hypotheses tested (16 REFUTED, 1 CONFIRMED as NIT, 1 INCONCLUSIVE
converted to a command at G4 and CONFIRMED as NIT). Findings: N1, N2 in NITS.md. scope_violations: [].

Refuted, among others: the DO UPDATE branch firing for a tombstoned id with a stored row (no row is
proposed, so no conflict arbitration); parameter order / column list / owner-category CASE changed
versus the pre-change compiled sync; untyped-parameter coercion in INSERT…SELECT; `added` count
semantics; client leak or open transaction on DELETE error paths; tombstone key read from anywhere
but `DELETE … RETURNING`; non-atomic delete (S4 has two halves); `removed` tombstoning; page/cursor
short-circuit on skip; vacuous tests (lib/db not mocked, S10 fixture really matches, S2 has a
bystander); order dependence (fileParallelism off, relative counts); log leakage (counts and
err.message only); other DELETE paths; scope creep; real data in fixtures.
