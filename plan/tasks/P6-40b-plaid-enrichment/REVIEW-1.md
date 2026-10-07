# REVIEW-1 — P6-40b-plaid-enrichment

verdict: BLOCK — 19 hypotheses (16 refuted, 1 confirmed BLOCK, 2 inconclusive → commands run by the
orchestrator). Finding B1 (BLOCK): `plaid_raw` is JSON.stringify'd and cast `::jsonb` with no
protection against escapes jsonb refuses; a U+0000 or a lone surrogate in any of ~30 newly stored
fields fails the statement, `syncItem` throws before the cursor UPDATE, and the item is stuck on that
page forever. Finding N1 (NIT): `as Required<Transaction>` is an assertion, not a check — the fixture
is complete today but the claimed compile-time guarantee does not exist. scope_violations: [].
Refuted, among others: parameter numbering in both upserts; tombstone guard intact in both writes;
owner fields; `plaid_category` still primary; rules blind to the detailed category; no COALESCE;
single serialisation (object, not string); redaction exact and not in place; no date shift;
blank → NULL; no log leakage; scope.
