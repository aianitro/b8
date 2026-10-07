# NITS — P6-40a-deletion-tombstones (follow-ups, not absorbed)

From REVIEW-1 (ACCEPT_WITH_NITS). Both are concurrency windows between the owner's delete and a
sync that is writing the same Plaid id at that moment.

**N1 — re-identification can still be claimed under a race (`lib/sync.ts` re-id block).** The
tombstone read that excludes ids from `matchReissuedTransactions` is a separate statement from the
`existingRows` read and the re-id `UPDATE`. A delete landing between them lets a just-deleted id
claim a live row with the same account, date, amount and name. The code comment and EVIDENCE.md
describe the window more narrowly than it is ("only rows dated outside the page range"); correct
them. Guarding the UPDATE in-statement would let mutation M3 survive S10, so the fix needs the
scenario amended too.

**N2 — CONFIRMED by command: a sync upsert overlapping the route's open DELETE transaction
resurrects the row.** Under READ COMMITTED the upsert's `NOT EXISTS` snapshot predates the route's
commit; after the commit the unique-index recheck finds no conflict and inserts. Reproduced on a
scratch DB with two sessions (route transaction held open with `pg_sleep`; upsert issued inside the
window): `rows=1 tombstones=1`. The window is the route's DELETE → INSERT tombstone → COMMIT, a few
milliseconds, and needs a sync to be processing that exact id. Consequence: the row returns and is
then frozen (S9 behaviour). Candidate fixes: an end-of-sync sweep deleting rows whose id is
tombstoned (contradicts S9 as frozen — scenario must change), or a shared advisory lock taken by
both writers before their snapshot-bearing statement.

Proposed follow-up task: `P6-40a1-tombstone-races`.
