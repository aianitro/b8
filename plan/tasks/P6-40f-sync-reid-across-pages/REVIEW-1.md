# REVIEW-1 — P6-40f-sync-reid-across-pages

verdict: BLOCK — 15 hypotheses. B1 (BLOCK): R4's premise ("a reissue is only ever delivered in a walk
that begins from no cursor") is false. After a re-auth Plaid delivers the initial pull first
(`INITIAL_UPDATE_COMPLETE`) and the historical pull later; the first walk stores a cursor, so the
historical pull arrives in a stored-cursor walk and R4 inserts every older transaction as a duplicate.
Sub-case: `NOT_READY` returns `next_cursor ''`, stored as '' — '' !== null, so the full re-delivery runs
without re-identification. B2 (BLOCK, orchestrator's hypothesis, confirmed by reading): a stored-cursor
walk with `removed:[old]` + `added:[new]` inserts new and deletes the owner's row, losing hidden, note,
non-rule category, watched_at, transfer group and property tag. Key finding: within one walk, a
historical-pull delivery and a genuine second identical purchase are byte-identical, so no walk-local
rule can separate them. NITs: the test helper hard-codes `removed: []` and three owner fields are never
asserted; H-d misattribution in a multi-page null-cursor walk (better than base; follow-up).
