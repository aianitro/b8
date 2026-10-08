# EVIDENCE — P6-40f-sync-reid-across-pages

# Cycle 1 — R5 (G3 amendment, replaces R4)

Implementer's evidence for cycle 1. Every command was run by the implementer on 2026-10-07 against the
scratch database `b8_p640f` (`DATABASE_URL=postgresql://localhost/b8_p640f`), with `PLAID_CLIENT_ID`
and `PLAID_SECRET` unset (`env -u`). Outputs are verbatim. Every id, name and amount in them is a
fabricated `p640f-` sentinel. Nothing is committed. The cycle-0 record (R4) is kept unchanged below,
under "Cycle 0 record"; where it and this section differ, this section is current.

## Summary

| # | Result |
|---|---|
| 1 | `tsc --noEmit` exit 0 |
| 2 | `eslint` exit 0, no warnings (only Next's `pages` directory notice, printed by every eslint run here) |
| 3 | `Tests  22 passed (22)`; 22 lines match `PG-` |
| 4 | `22` — **the spec says 21; see finding F1** |
| 5 | `Tests  26 passed (26)`, the three files unmodified |
| 6 | prints nothing |
| 7 | `1` and `1` with `/usr/bin/grep` (cycle-0 note on this shell's ugrep `grep` still applies) |
| 8 | `Tests  12 passed (12)` |
| 9 | base `8df05e7` `sync.ts`: 15 fail, 7 pass — full list below; restore `cmp` exit 0 |
| 10 | `0` |
| 11 | `Test Files  72 passed (72)`, `Tests  1112 passed (1112)` |
| 12 | prints nothing |
| R5 probe | PG-15 and PG-16 RED against the cycle-0 `sync.ts` (also PG-15b, 15c, 16b, 17); restore `cmp` exit 0 |

## Findings for the orchestrator

- **F1. The spec's count of 21 is an arithmetic slip.** Cycle 0 had 15 `PG-` tests (13 plus PG-13 and
  PG-14). R5 adds seven (PG-15, 15b, 15c, 15d, 16, 16b, 17). 15 + 7 = 22. No test was added beyond the
  spec's list; two of the seven carry a second scenario (below), which does not change the count.
- **F2. PG-15 passes on base `8df05e7`.** On base, a single page with `added [new-1]` and
  `removed [old-1]` runs the re-identification before the `removed` loop, so the row is renamed and the
  DELETE then finds nothing. B2's loss on base needs the removal to arrive on an EARLIER page than the
  new id; PG-15b's second order shows exactly that on base (`expected [[pk+1, new-1]] to deeply equal
  [[pk, new-1]]`: the row was deleted and a bare copy inserted). Against the cycle-0 diff, PG-15 is RED
  as the spec requires.
- **F3. PG-17 is RED on cycle-0 only through the UNKNOWN log assertion** I added to its second run
  (`expected [] to have a length of 1`). Its row assertions pass on cycle-0, because cycle-0's R4 also
  inserts a same-key second purchase in a stored-cursor walk. That is expected: PG-17 is a guard that
  R5 keeps R4's good half.
- **F4. Two scenarios were folded into existing tests to kill surviving mutants** (no new tags):
  PG-15c also delivers the same new id on two pages with both rows retired (the repeat must claim
  nothing; mutant N4 survived without it), and PG-16b also syncs an account whose stored cursor is
  ALREADY `''` — what earlier code stored for a NOT_READY answer (mutant N3b survived without it).
  PG-15b runs both page orders.
- **F5. The UNKNOWN log line** is asserted in PG-17's second run: exactly one line, with only `time`,
  `level`, `scope` and `message` keys (no ids). The spec does not name a test for it.
- **F6. Behaviour change worth a reviewer's eye: the walk is now fetched whole before it is written.**
  This is needed because a `removed` licence can arrive on a page before the new id it licenses. It
  means a walk that fails part-way now writes nothing, where base wrote the earlier pages. The cursor
  was never written for a failed walk either way, so the next sync re-fetches the same pages. The three
  existing suites (#5) are unchanged and green.
- **F7. `!cursor` is applied at both layers** (`runSyncInner`'s grouping and `syncItem`). Either layer
  alone makes PG-16b pass. Mutant N3c (grouping only reverted) survives because `syncItem` still
  treats `''` as no cursor; N3b (both reverted) is killed. That is defence in depth, not a gap.

## What changed in cycle 1 (`apps/web/lib/sync.ts`)

- **Re-auth phase.** `reauthWalk = !cursor`, and `runSyncInner`'s H-d grouping uses `!a.cursor` too, so
  an empty cursor counts as no cursor. The request sends `cursor || undefined`. A walk from no cursor
  re-identifies page by page exactly as in cycle 0 (R1–R3 and `seenInWalk` unchanged). After the walk,
  if it began from no cursor and the FINAL page's `transactions_update_status` is `NOT_READY` or
  `INITIAL_UPDATE_COMPLETE`, the accounts' cursor is written as NULL. Rows are still written, and the
  freshness columns are still updated in the same statement. `HISTORICAL_UPDATE_COMPLETE`, an absent
  field and `TRANSACTIONS_UPDATE_STATUS_UNKNOWN` store the cursor as before. UNKNOWN logs one line,
  `transactions update status unknown; cursor stored as usual`, with no fields.
- **Stored-cursor walks.** Before any page is applied, the retired ids are collected: every `removed` id
  in the walk, minus any id Plaid also delivers in the walk as `added` or `modified`. The claimants are
  the posted, known-account `added` ids, each at its first occurrence, in walk order. Claimants that are
  tombstoned or already stored are dropped, and retired ids that are tombstoned are dropped. The real
  matcher, unchanged, pairs the remaining claimants against the stored rows bearing a retired id on this
  item's accounts (same key, lowest primary key first, delivery order), and each pair is renamed in
  place. Then the pages are applied in order as before. The retired id's DELETE finds no row, because
  that row already carries the new id. Renamed ids are in the walk-scoped `reidentified` set, so they
  are not counted in `synced`. One `re-identified transactions after item change` line is logged per
  walk for these renames. With no `removed` licence, every new id is inserted (PG-13).
- **Buffering.** The pages are fetched first (`walk: TransactionsSyncResponse[]`) and applied after; see F6.
- **Not changed:** `txnMatch.ts`, the upserts' SQL and tombstone guard, the pending skip, the
  `removed` semantics (no tombstone), `unmatchedAccountIds` and the rest of the cursor write, the
  schema, and shared types. No persisted flag.

## What the walk remembers (cycle 1)

Within one item's walk, the code remembers three things, and none of them persists past the walk. First,
the whole walk itself, fetched before any of it is written. That is what lets a `removed` entry on any
page license a new id on any other page. Second, in a walk from no cursor, the set of ids already
handed to an upsert (`seenInWalk`, unchanged from cycle 0). It sits beside the per-page tombstone
pre-filter: a seen or tombstoned id never claims, and a stored row bearing one is never a candidate.
Third, the walk-scoped `reidentified` set, which keeps a renamed row out of `synced`. In a stored-cursor
walk the candidate pool is not "any stored row not named on this page". It is only the stored rows Plaid
retired by id in this walk. Tombstoned ids are removed from both sides, and an id Plaid both retires
and still sends is not treated as retired. Across walks the only state is the cursor. While Plaid
reports the initial pull and not yet the historical one, the cursor is deliberately left NULL, so the
next walk is again a re-auth walk.

## Existing-test fixture edits

**None.** #5's three files are byte-identical to base (#6) and pass, with the same 26 tests.

## Extra mutation probes (final test file; each restored, final `cmp` exit 0)

```
N1 removed-licence pre-pass disabled:
PG-15 PG-15b PG-15c 
N2 cursor always stored:
PG-16 
N3b empty cursor treated as stored, in grouping and syncItem:
PG-16b 
N4 claimants not deduplicated:
PG-15c 
N5 UNKNOWN log line removed:
PG-17 
cmp exit 0
```

Also run in an earlier iteration: N3 (syncItem alone reverted to `=== null` / `??`) and N3c (the
grouping alone reverted) both survive, because the other layer still normalises `''` (F7). Before F4's
additions, N3b and N4 survived. Cycle-0 mutants M1–M4 are recorded in the cycle-0 section. They are not
re-run here, because R5 leaves the re-auth path's code unchanged.

## R5 probe — the new file against the CYCLE-0 `sync.ts`

```
$ cp apps/web/lib/sync.ts $SCRATCH/sync.cycle1.ts      # cycle-0 file was saved earlier as $SCRATCH/sync.cycle0.ts
$ cp $SCRATCH/sync.cycle0.ts apps/web/lib/sync.ts
$ (cd apps/web && env -u PLAID_CLIENT_ID -u PLAID_SECRET npx vitest run --config vitest.integration.config.mts --reporter=verbose app/api/v1/sync/reid-across-pages.test.ts)

 RUN  v5.0.3 /Users/andreianpilogov/Documents/b8/app/apps/web

{"time":"2026-10-07T23:44:11.332Z","level":"info","scope":"sync","message":"re-identified transactions after item change","count":1}
{"time":"2026-10-07T23:44:11.336Z","level":"info","scope":"sync","message":"re-identified transactions after item change","count":1}
[reid-dump pg01] [{"id":2269,"hidden":false,"note":"Fabricated P640f note 1","mapped_category":"Fabricated P640f Pick 1","rule_applied":false,"watched_at":"2026-03-01 02:00:00-08","transfer_group_id":78,"property_id":78,"plaid_transaction_id":"p640f-new-1"},{"id":2270,"hidden":true,"note":"Fabricated P640f note 2","mapped_category":"Fabricated P640f Pick 2","rule_applied":false,"watched_at":"2026-03-02 02:00:00-08","transfer_group_id":79,"property_id":79,"plaid_transaction_id":"p640f-new-2"}]
[reid-dump pg01] re-identified log lines=2 total count=2
{"time":"2026-10-07T23:44:11.349Z","level":"info","scope":"sync","message":"re-identified transactions after item change","count":1}
{"time":"2026-10-07T23:44:11.351Z","level":"info","scope":"sync","message":"re-identified transactions after item change","count":1}
{"time":"2026-10-07T23:44:11.353Z","level":"info","scope":"sync","message":"re-identified transactions after item change","count":1}
{"time":"2026-10-07T23:44:11.361Z","level":"info","scope":"sync","message":"re-identified transactions after item change","count":1}
{"time":"2026-10-07T23:44:11.362Z","level":"info","scope":"sync","message":"re-identified transactions after item change","count":1}
{"time":"2026-10-07T23:44:11.371Z","level":"info","scope":"sync","message":"re-identified transactions after item change","count":1}
{"time":"2026-10-07T23:44:11.373Z","level":"info","scope":"sync","message":"re-identified transactions after item change","count":1}
{"time":"2026-10-07T23:44:11.374Z","level":"info","scope":"sync","message":"skipped transactions the owner deleted","count":1}
[reid-dump pg04] [{"id":2283,"hidden":false,"note":"Fabricated P640f note 1","mapped_category":"Fabricated P640f Pick 1","rule_applied":false,"watched_at":"2026-03-01 02:00:00-08","transfer_group_id":78,"property_id":78,"plaid_transaction_id":"p640f-new-1"},{"id":2284,"hidden":true,"note":"Fabricated P640f note 2","mapped_category":"Fabricated P640f Pick 2","rule_applied":false,"watched_at":"2026-03-02 02:00:00-08","transfer_group_id":79,"property_id":79,"plaid_transaction_id":"p640f-new-3"},{"id":2285,"hidden":false,"note":"Fabricated P640f note 3","mapped_category":"Fabricated P640f Pick 3","rule_applied":false,"watched_at":"2026-03-03 02:00:00-08","transfer_group_id":80,"property_id":80,"plaid_transaction_id":"p640f-old-3"}]
{"time":"2026-10-07T23:44:11.380Z","level":"info","scope":"sync","message":"re-identified transactions after item change","count":1}
{"time":"2026-10-07T23:44:11.381Z","level":"info","scope":"sync","message":"skipped transactions the owner deleted","count":1}
{"time":"2026-10-07T23:44:11.386Z","level":"info","scope":"sync","message":"re-identified transactions after item change","count":1}
{"time":"2026-10-07T23:44:11.387Z","level":"info","scope":"sync","message":"skipped transactions the owner deleted","count":1}
{"time":"2026-10-07T23:44:11.391Z","level":"info","scope":"sync","message":"re-identified transactions after item change","count":1}
{"time":"2026-10-07T23:44:11.396Z","level":"info","scope":"sync","message":"re-identified transactions after item change","count":1}
{"time":"2026-10-07T23:44:11.396Z","level":"info","scope":"sync","message":"re-identified transactions after item change","count":1}
 ✓ app/api/v1/sync/reid-across-pages.test.ts > a sync walk re-identifies each stored row at most once, across pages > PG-01: two identical rows, their new ids one per page: each row takes its own id, once 25ms
 ✓ app/api/v1/sync/reid-across-pages.test.ts > a sync walk re-identifies each stored row at most once, across pages > PG-02: three identical rows, three pages: the k-th id goes to the k-th lowest primary key 14ms
 ✓ app/api/v1/sync/reid-across-pages.test.ts > a sync walk re-identifies each stored row at most once, across pages > PG-03: an empty page between the two ids neither resets what the walk remembers nor blocks the second claim 10ms
 ✓ app/api/v1/sync/reid-across-pages.test.ts > a sync walk re-identifies each stored row at most once, across pages > PG-04: a tombstoned id on the middle page claims nothing, is stored nowhere, and the last page takes the next row 11ms
 ✓ app/api/v1/sync/reid-across-pages.test.ts > a sync walk re-identifies each stored row at most once, across pages > PG-04a: a tombstoned id on the page after a rename leaves the second row on its old id 6ms
 ✓ app/api/v1/sync/reid-across-pages.test.ts > a sync walk re-identifies each stored row at most once, across pages > PG-04b: a tombstoned id on the first page spends no claim, so the next page takes the lowest row 6ms
 ✓ app/api/v1/sync/reid-across-pages.test.ts > a sync walk re-identifies each stored row at most once, across pages > PG-05: one new id for two rows leaves the second on its old id, and an unrelated later row is inserted once 5ms
 ✓ app/api/v1/sync/reid-across-pages.test.ts > a sync walk re-identifies each stored row at most once, across pages > PG-06: modified for an id renamed on an earlier page refreshes that row and never inserts a third 5ms
{"time":"2026-10-07T23:44:11.401Z","level":"info","scope":"sync","message":"re-identified transactions after item change","count":1}
{"time":"2026-10-07T23:44:11.412Z","level":"info","scope":"sync","message":"re-identified transactions after item change","count":2}
{"time":"2026-10-07T23:44:11.416Z","level":"info","scope":"sync","message":"re-identified transactions after item change","count":1}
{"time":"2026-10-07T23:44:11.422Z","level":"info","scope":"sync","message":"re-identified transactions after item change","count":1}
{"time":"2026-10-07T23:44:11.449Z","level":"info","scope":"sync","message":"re-identified transactions after item change","count":1}
 ✓ app/api/v1/sync/reid-across-pages.test.ts > a sync walk re-identifies each stored row at most once, across pages > PG-07: the same new id on two pages claims one row only, and is not counted again 5ms
 ✓ app/api/v1/sync/reid-across-pages.test.ts > a sync walk re-identifies each stored row at most once, across pages > PG-08: two genuine identical transactions on two pages, no stored history, are both stored 3ms
 ✓ app/api/v1/sync/reid-across-pages.test.ts > a sync walk re-identifies each stored row at most once, across pages > PG-09: a row inserted by modified on page 1 is not renamed by a same-key added id on page 2 3ms
 ✓ app/api/v1/sync/reid-across-pages.test.ts > a sync walk re-identifies each stored row at most once, across pages > PG-10: a single page carrying both new ids still pairs them in order (unchanged) 4ms
 ✓ app/api/v1/sync/reid-across-pages.test.ts > a sync walk re-identifies each stored row at most once, across pages > PG-12: an opposite-sign amount is a different transaction; only the same-key id claims the stored row 4ms
 ✓ app/api/v1/sync/reid-across-pages.test.ts > a sync walk re-identifies each stored row at most once, across pages > PG-13: a stored-cursor walk with no removed licence never re-identifies: a same-key new id is a second transaction 3ms
 ✓ app/api/v1/sync/reid-across-pages.test.ts > a sync walk re-identifies each stored row at most once, across pages > PG-14: the same delivery from no cursor still re-identifies the stored row in place 3ms
 × app/api/v1/sync/reid-across-pages.test.ts > a sync walk re-identifies each stored row at most once, across pages > PG-15: a stored-cursor walk that retires the old id renames the row in place instead of deleting it 7ms
   → expected [ [ 2323, 'p640f-new-1' ] ] to deeply equal [ [ 2322, 'p640f-new-1' ] ]
 × app/api/v1/sync/reid-across-pages.test.ts > a sync walk re-identifies each stored row at most once, across pages > PG-15b: the licence works across pages in either order (added then removed, removed then added) 4ms
   → expected [ [ 2325, 'p640f-new-1' ] ] to deeply equal [ [ 2324, 'p640f-new-1' ] ]
 × app/api/v1/sync/reid-across-pages.test.ts > a sync walk re-identifies each stored row at most once, across pages > PG-15c: only the retired row is claimable, and once: a same-key second new id is inserted, a repeated one claims nothing 4ms
   → expected [ 'p640f-old-2', 'p640f-new-1', …(1) ] to deeply equal [ 'p640f-new-1', 'p640f-old-2', …(1) ]
 ✓ app/api/v1/sync/reid-across-pages.test.ts > a sync walk re-identifies each stored row at most once, across pages > PG-15d: a removed id of a different key licenses nothing: the new id is inserted and the retired row deleted 3ms
 × app/api/v1/sync/reid-across-pages.test.ts > a sync walk re-identifies each stored row at most once, across pages > PG-16: a re-auth walk ending on INITIAL_UPDATE_COMPLETE keeps the cursor NULL, so the historical pull re-identifies 2ms
   → expected 'p640f-r1-next-1' to be null
 × app/api/v1/sync/reid-across-pages.test.ts > a sync walk re-identifies each stored row at most once, across pages > PG-16b: a NOT_READY walk answering with an empty cursor leaves no usable cursor, and the next walk re-identifies 3ms
   → expected [ '' ] to deeply equal [ undefined ]
 × app/api/v1/sync/reid-across-pages.test.ts > a sync walk re-identifies each stored row at most once, across pages > PG-17: after HISTORICAL_UPDATE_COMPLETE the next walk is incremental, and a same-key second purchase is inserted 5ms
   → expected [] to have a length of 1 but got +0

⎯⎯⎯⎯⎯⎯⎯ Failed Tests 6 ⎯⎯⎯⎯⎯⎯⎯

 FAIL  app/api/v1/sync/reid-across-pages.test.ts > a sync walk re-identifies each stored row at most once, across pages > PG-15: a stored-cursor walk that retires the old id renames the row in place instead of deleting it
AssertionError: expected [ [ 2323, 'p640f-new-1' ] ] to deeply equal [ [ 2322, 'p640f-new-1' ] ]

- Expected
+ Received

  [
    [
-     2322,
+     2323,
      "p640f-new-1",
    ],
  ]

 ❯ app/api/v1/sync/reid-across-pages.test.ts:475:62
    473|
    474|     const after = await rows();
    475|     expect(after.map((x) => [x.id, x.plaid_transaction_id])).toEqual([…
       |                                                              ^
    476|     expect(after.map(owner)).toEqual(before.map(owner));
    477|     expect((await db.query('SELECT 1 FROM transactions WHERE plaid_tra…

⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯[1/6]⎯

 FAIL  app/api/v1/sync/reid-across-pages.test.ts > a sync walk re-identifies each stored row at most once, across pages > PG-15b: the licence works across pages in either order (added then removed, removed then added)
AssertionError: expected [ [ 2325, 'p640f-new-1' ] ] to deeply equal [ [ 2324, 'p640f-new-1' ] ]

- Expected
+ Received

  [
    [
-     2324,
+     2325,
      "p640f-new-1",
    ],
  ]

 ❯ app/api/v1/sync/reid-across-pages.test.ts:496:64
    494|
    495|       const after = await rows();
    496|       expect(after.map((x) => [x.id, x.plaid_transaction_id])).toEqual…
       |                                                                ^
    497|       expect(after.map(owner)).toEqual(before.map(owner));
    498|       expect((await db.query('SELECT 1 FROM transactions WHERE plaid_t…

⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯[2/6]⎯

 FAIL  app/api/v1/sync/reid-across-pages.test.ts > a sync walk re-identifies each stored row at most once, across pages > PG-15c: only the retired row is claimable, and once: a same-key second new id is inserted, a repeated one claims nothing
AssertionError: expected [ 'p640f-old-2', 'p640f-new-1', …(1) ] to deeply equal [ 'p640f-new-1', 'p640f-old-2', …(1) ]

- Expected
+ Received

  [
-   "p640f-new-1",
    "p640f-old-2",
+   "p640f-new-1",
    "p640f-new-9",
  ]

 ❯ app/api/v1/sync/reid-across-pages.test.ts:512:54
    510|
    511|     const after = await rows();
    512|     expect(after.map((x) => x.plaid_transaction_id)).toEqual([newId(1)…
       |                                                      ^
    513|     expect(after.slice(0, 2).map((x) => x.id)).toEqual([r1, r2]);
    514|     expect(after.slice(0, 2).map(owner)).toEqual(before.map(owner));

⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯[3/6]⎯

 FAIL  app/api/v1/sync/reid-across-pages.test.ts > a sync walk re-identifies each stored row at most once, across pages > PG-16: a re-auth walk ending on INITIAL_UPDATE_COMPLETE keeps the cursor NULL, so the historical pull re-identifies
AssertionError: expected 'p640f-r1-next-1' to be null

- Expected:
null

+ Received:
"p640f-r1-next-1"

 ❯ app/api/v1/sync/reid-across-pages.test.ts:557:34
    555|     const run1 = queueWalk(null, [{ added: [], status: 'INITIAL_UPDATE…
    556|     await sync(run1);
    557|     expect(await storedCursor()).toBeNull();
       |                                  ^
    558|
    559|     const run2 = queueWalk(null, [{ added: [txn(newId(1))], status: 'H…

⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯[4/6]⎯

 FAIL  app/api/v1/sync/reid-across-pages.test.ts > a sync walk re-identifies each stored row at most once, across pages > PG-16b: a NOT_READY walk answering with an empty cursor leaves no usable cursor, and the next walk re-identifies
AssertionError: expected [ '' ] to deeply equal [ undefined ]

- Expected
+ Received

  [
-   undefined,
+   "",
  ]

 ❯ sync app/api/v1/sync/reid-across-pages.test.ts:185:86
    183|   // Every queued page was served: a walk that stopped early would lea…
    184|   expect(fake.pages.get(TOKEN)).toEqual([]);
    185|   expect(fake.requests.filter((q) => q.access_token === TOKEN).map((q)…
       |                                                                                      ^
    186|   return result;
    187| }
 ❯ app/api/v1/sync/reid-across-pages.test.ts:580:20

⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯[5/6]⎯

 FAIL  app/api/v1/sync/reid-across-pages.test.ts > a sync walk re-identifies each stored row at most once, across pages > PG-17: after HISTORICAL_UPDATE_COMPLETE the next walk is incremental, and a same-key second purchase is inserted
AssertionError: expected [] to have a length of 1 but got +0

- Expected
+ Received

- 1
+ 0

 ❯ app/api/v1/sync/reid-across-pages.test.ts:629:26
    627|     expect(result.synced).toBe(1);
    628|     expect(await storedCursor()).toBe(`${P}-r2-next-1`);
    629|     expect(unknownLines).toHaveLength(1);
       |                          ^
    630|     expect(Object.keys(JSON.parse(unknownLines[0])).sort()).toEqual(['…
    631|   });

⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯[6/6]⎯


 Test Files  1 failed (1)
      Tests  6 failed | 16 passed (22)
   Start at  16:44:10
   Duration  472ms (tests 48%, import 32%, transform 19%, setup 1%)
$ cp $SCRATCH/sync.cycle1.ts apps/web/lib/sync.ts && cmp $SCRATCH/sync.cycle1.ts apps/web/lib/sync.ts; echo "cmp exit $?"
cmp exit 0
```

## Acceptance #9 — the new file against BASE `8df05e7`

Pass on base: PG-04a, 04b, 05, 10, 12, 14, 15. Fail on base: PG-01, 02, 03, 04, 06, 07, 08, 09, 13,
15b, 15c, 15d, 16, 16b, 17.

```
$ git show 8df05e7:apps/web/lib/sync.ts > apps/web/lib/sync.ts
$ (cd apps/web && env -u PLAID_CLIENT_ID -u PLAID_SECRET npx vitest run --config vitest.integration.config.mts --reporter=verbose app/api/v1/sync/reid-across-pages.test.ts)

 RUN  v5.0.3 /Users/andreianpilogov/Documents/b8/app/apps/web

{"time":"2026-10-07T23:44:12.284Z","level":"info","scope":"sync","message":"re-identified transactions after item change","count":1}
{"time":"2026-10-07T23:44:12.288Z","level":"info","scope":"sync","message":"re-identified transactions after item change","count":1}
[reid-dump pg01] [{"id":2339,"hidden":false,"note":"Fabricated P640f note 1","mapped_category":"Fabricated P640f Pick 1","rule_applied":false,"watched_at":"2026-03-01 02:00:00-08","transfer_group_id":82,"property_id":82,"plaid_transaction_id":"p640f-new-2"},{"id":2340,"hidden":true,"note":"Fabricated P640f note 2","mapped_category":"Fabricated P640f Pick 2","rule_applied":false,"watched_at":"2026-03-02 02:00:00-08","transfer_group_id":83,"property_id":83,"plaid_transaction_id":"p640f-old-2"}]
[reid-dump pg01] re-identified log lines=2 total count=2
{"time":"2026-10-07T23:44:12.306Z","level":"info","scope":"sync","message":"re-identified transactions after item change","count":1}
{"time":"2026-10-07T23:44:12.307Z","level":"info","scope":"sync","message":"re-identified transactions after item change","count":1}
{"time":"2026-10-07T23:44:12.309Z","level":"info","scope":"sync","message":"re-identified transactions after item change","count":1}
{"time":"2026-10-07T23:44:12.316Z","level":"info","scope":"sync","message":"re-identified transactions after item change","count":1}
{"time":"2026-10-07T23:44:12.318Z","level":"info","scope":"sync","message":"re-identified transactions after item change","count":1}
{"time":"2026-10-07T23:44:12.325Z","level":"info","scope":"sync","message":"re-identified transactions after item change","count":1}
{"time":"2026-10-07T23:44:12.327Z","level":"info","scope":"sync","message":"re-identified transactions after item change","count":1}
{"time":"2026-10-07T23:44:12.328Z","level":"info","scope":"sync","message":"skipped transactions the owner deleted","count":1}
[reid-dump pg04] [{"id":2353,"hidden":false,"note":"Fabricated P640f note 1","mapped_category":"Fabricated P640f Pick 1","rule_applied":false,"watched_at":"2026-03-01 02:00:00-08","transfer_group_id":82,"property_id":82,"plaid_transaction_id":"p640f-new-3"},{"id":2354,"hidden":true,"note":"Fabricated P640f note 2","mapped_category":"Fabricated P640f Pick 2","rule_applied":false,"watched_at":"2026-03-02 02:00:00-08","transfer_group_id":83,"property_id":83,"plaid_transaction_id":"p640f-old-2"},{"id":2355,"hidden":false,"note":"Fabricated P640f note 3","mapped_category":"Fabricated P640f Pick 3","rule_applied":false,"watched_at":"2026-03-03 02:00:00-08","transfer_group_id":84,"property_id":84,"plaid_transaction_id":"p640f-old-3"}]
{"time":"2026-10-07T23:44:12.332Z","level":"info","scope":"sync","message":"re-identified transactions after item change","count":1}
{"time":"2026-10-07T23:44:12.333Z","level":"info","scope":"sync","message":"skipped transactions the owner deleted","count":1}
{"time":"2026-10-07T23:44:12.340Z","level":"info","scope":"sync","message":"re-identified transactions after item change","count":1}
{"time":"2026-10-07T23:44:12.341Z","level":"info","scope":"sync","message":"skipped transactions the owner deleted","count":1}
{"time":"2026-10-07T23:44:12.345Z","level":"info","scope":"sync","message":"re-identified transactions after item change","count":1}
 × app/api/v1/sync/reid-across-pages.test.ts > a sync walk re-identifies each stored row at most once, across pages > PG-01: two identical rows, their new ids one per page: each row takes its own id, once 29ms
   → expected [ [ 2339, 'p640f-new-2' ], …(1) ] to deeply equal [ [ 2339, 'p640f-new-1' ], …(1) ]
 × app/api/v1/sync/reid-across-pages.test.ts > a sync walk re-identifies each stored row at most once, across pages > PG-02: three identical rows, three pages: the k-th id goes to the k-th lowest primary key 16ms
   → expected [ [ 2343, 'p640f-new-3' ], …(2) ] to deeply equal [ [ 2343, 'p640f-new-1' ], …(2) ]
 × app/api/v1/sync/reid-across-pages.test.ts > a sync walk re-identifies each stored row at most once, across pages > PG-03: an empty page between the two ids neither resets what the walk remembers nor blocks the second claim 8ms
   → expected [ [ 2349, 'p640f-new-2' ], …(1) ] to deeply equal [ [ 2349, 'p640f-new-1' ], …(1) ]
 × app/api/v1/sync/reid-across-pages.test.ts > a sync walk re-identifies each stored row at most once, across pages > PG-04: a tombstoned id on the middle page claims nothing, is stored nowhere, and the last page takes the next row 8ms
   → expected [ [ 2353, 'p640f-new-3' ], …(2) ] to deeply equal [ [ 2353, 'p640f-new-1' ], …(2) ]
 ✓ app/api/v1/sync/reid-across-pages.test.ts > a sync walk re-identifies each stored row at most once, across pages > PG-04a: a tombstoned id on the page after a rename leaves the second row on its old id 6ms
 ✓ app/api/v1/sync/reid-across-pages.test.ts > a sync walk re-identifies each stored row at most once, across pages > PG-04b: a tombstoned id on the first page spends no claim, so the next page takes the lowest row 7ms
 ✓ app/api/v1/sync/reid-across-pages.test.ts > a sync walk re-identifies each stored row at most once, across pages > PG-05: one new id for two rows leaves the second on its old id, and an unrelated later row is inserted once 6ms
{"time":"2026-10-07T23:44:12.350Z","level":"info","scope":"sync","message":"re-identified transactions after item change","count":1}
{"time":"2026-10-07T23:44:12.351Z","level":"info","scope":"sync","message":"re-identified transactions after item change","count":1}
{"time":"2026-10-07T23:44:12.355Z","level":"info","scope":"sync","message":"re-identified transactions after item change","count":1}
{"time":"2026-10-07T23:44:12.360Z","level":"info","scope":"sync","message":"re-identified transactions after item change","count":1}
{"time":"2026-10-07T23:44:12.364Z","level":"info","scope":"sync","message":"re-identified transactions after item change","count":1}
{"time":"2026-10-07T23:44:12.367Z","level":"info","scope":"sync","message":"re-identified transactions after item change","count":2}
{"time":"2026-10-07T23:44:12.371Z","level":"info","scope":"sync","message":"re-identified transactions after item change","count":1}
{"time":"2026-10-07T23:44:12.374Z","level":"info","scope":"sync","message":"re-identified transactions after item change","count":1}
{"time":"2026-10-07T23:44:12.377Z","level":"info","scope":"sync","message":"re-identified transactions after item change","count":1}
{"time":"2026-10-07T23:44:12.380Z","level":"info","scope":"sync","message":"re-identified transactions after item change","count":1}
{"time":"2026-10-07T23:44:12.384Z","level":"info","scope":"sync","message":"re-identified transactions after item change","count":1}
{"time":"2026-10-07T23:44:12.390Z","level":"info","scope":"sync","message":"re-identified transactions after item change","count":2}
{"time":"2026-10-07T23:44:12.397Z","level":"info","scope":"sync","message":"re-identified transactions after item change","count":1}
{"time":"2026-10-07T23:44:12.402Z","level":"info","scope":"sync","message":"re-identified transactions after item change","count":1}
{"time":"2026-10-07T23:44:12.405Z","level":"info","scope":"sync","message":"re-identified transactions after item change","count":1}
{"time":"2026-10-07T23:44:12.406Z","level":"info","scope":"sync","message":"re-identified transactions after item change","count":1}
 × app/api/v1/sync/reid-across-pages.test.ts > a sync walk re-identifies each stored row at most once, across pages > PG-06: modified for an id renamed on an earlier page refreshes that row and never inserts a third 5ms
   → expected [ [ 2368, 'p640f-new-2' ], …(2) ] to deeply equal [ [ 2368, 'p640f-new-1' ], …(1) ]
 × app/api/v1/sync/reid-across-pages.test.ts > a sync walk re-identifies each stored row at most once, across pages > PG-07: the same new id on two pages claims one row only, and is not counted again 5ms
   → expected 1 to be +0 // Object.is equality
 × app/api/v1/sync/reid-across-pages.test.ts > a sync walk re-identifies each stored row at most once, across pages > PG-08: two genuine identical transactions on two pages, no stored history, are both stored 4ms
   → expected [ 'p640f-c-2' ] to deeply equal [ 'p640f-c-1', 'p640f-c-2' ]
 × app/api/v1/sync/reid-across-pages.test.ts > a sync walk re-identifies each stored row at most once, across pages > PG-09: a row inserted by modified on page 1 is not renamed by a same-key added id on page 2 3ms
   → expected [ 'p640f-c-2' ] to deeply equal [ 'p640f-m-1', 'p640f-c-2' ]
 ✓ app/api/v1/sync/reid-across-pages.test.ts > a sync walk re-identifies each stored row at most once, across pages > PG-10: a single page carrying both new ids still pairs them in order (unchanged) 4ms
 ✓ app/api/v1/sync/reid-across-pages.test.ts > a sync walk re-identifies each stored row at most once, across pages > PG-12: an opposite-sign amount is a different transaction; only the same-key id claims the stored row 3ms
 × app/api/v1/sync/reid-across-pages.test.ts > a sync walk re-identifies each stored row at most once, across pages > PG-13: a stored-cursor walk with no removed licence never re-identifies: a same-key new id is a second transaction 3ms
   → expected [ 'p640f-new-1' ] to deeply equal [ 'p640f-old-1', 'p640f-new-1' ]
 ✓ app/api/v1/sync/reid-across-pages.test.ts > a sync walk re-identifies each stored row at most once, across pages > PG-14: the same delivery from no cursor still re-identifies the stored row in place 3ms
 ✓ app/api/v1/sync/reid-across-pages.test.ts > a sync walk re-identifies each stored row at most once, across pages > PG-15: a stored-cursor walk that retires the old id renames the row in place instead of deleting it 3ms
 × app/api/v1/sync/reid-across-pages.test.ts > a sync walk re-identifies each stored row at most once, across pages > PG-15b: the licence works across pages in either order (added then removed, removed then added) 6ms
   → expected [ [ 2397, 'p640f-new-1' ] ] to deeply equal [ [ 2396, 'p640f-new-1' ] ]
 × app/api/v1/sync/reid-across-pages.test.ts > a sync walk re-identifies each stored row at most once, across pages > PG-15c: only the retired row is claimable, and once: a same-key second new id is inserted, a repeated one claims nothing 4ms
   → expected [ 'p640f-new-1', 'p640f-new-9' ] to deeply equal [ 'p640f-new-1', 'p640f-old-2', …(1) ]
 × app/api/v1/sync/reid-across-pages.test.ts > a sync walk re-identifies each stored row at most once, across pages > PG-15d: a removed id of a different key licenses nothing: the new id is inserted and the retired row deleted 6ms
   → expected [ 'p640f-new-1' ] to deeply equal [ 'p640f-old-1', 'p640f-new-1' ]
 × app/api/v1/sync/reid-across-pages.test.ts > a sync walk re-identifies each stored row at most once, across pages > PG-16: a re-auth walk ending on INITIAL_UPDATE_COMPLETE keeps the cursor NULL, so the historical pull re-identifies 2ms
   → expected 'p640f-r1-next-1' to be null
 × app/api/v1/sync/reid-across-pages.test.ts > a sync walk re-identifies each stored row at most once, across pages > PG-16b: a NOT_READY walk answering with an empty cursor leaves no usable cursor, and the next walk re-identifies 3ms
   → expected [ '' ] to deeply equal [ undefined ]
 × app/api/v1/sync/reid-across-pages.test.ts > a sync walk re-identifies each stored row at most once, across pages > PG-17: after HISTORICAL_UPDATE_COMPLETE the next walk is incremental, and a same-key second purchase is inserted 4ms
   → expected [ 'p640f-new-2' ] to deeply equal [ 'p640f-new-1', 'p640f-new-2' ]

⎯⎯⎯⎯⎯⎯ Failed Tests 15 ⎯⎯⎯⎯⎯⎯⎯

 FAIL  app/api/v1/sync/reid-across-pages.test.ts > a sync walk re-identifies each stored row at most once, across pages > PG-01: two identical rows, their new ids one per page: each row takes its own id, once
AssertionError: expected [ [ 2339, 'p640f-new-2' ], …(1) ] to deeply equal [ [ 2339, 'p640f-new-1' ], …(1) ]

- Expected
+ Received

  [
    [
      2339,
-     "p640f-new-1",
+     "p640f-new-2",
    ],
    [
      2340,
-     "p640f-new-2",
+     "p640f-old-2",
    ],
  ]

 ❯ app/api/v1/sync/reid-across-pages.test.ts:262:62
    260|     console.log(`[reid-dump pg01] re-identified log lines=${reLines.le…
    261|
    262|     expect(after.map((r) => [r.id, r.plaid_transaction_id])).toEqual([…
       |                                                              ^
    263|     expect(after.map(owner)).toEqual(before.map(owner));
    264|     expect(result.synced).toBe(0);

⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯[1/15]⎯

 FAIL  app/api/v1/sync/reid-across-pages.test.ts > a sync walk re-identifies each stored row at most once, across pages > PG-02: three identical rows, three pages: the k-th id goes to the k-th lowest primary key
AssertionError: expected [ [ 2343, 'p640f-new-3' ], …(2) ] to deeply equal [ [ 2343, 'p640f-new-1' ], …(2) ]

- Expected
+ Received

  [
    [
      2343,
-     "p640f-new-1",
+     "p640f-new-3",
    ],
    [
      2344,
-     "p640f-new-2",
+     "p640f-old-2",
    ],
    [
      2345,
-     "p640f-new-3",
+     "p640f-old-3",
    ],
  ]

 ❯ app/api/v1/sync/reid-across-pages.test.ts:276:62
    274|
    275|     const after = await rows();
    276|     expect(after.map((r) => [r.id, r.plaid_transaction_id])).toEqual([…
       |                                                              ^
    277|     expect(after.map(owner)).toEqual(before.map(owner));
    278|     expect(result.synced).toBe(0);

⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯[2/15]⎯

 FAIL  app/api/v1/sync/reid-across-pages.test.ts > a sync walk re-identifies each stored row at most once, across pages > PG-03: an empty page between the two ids neither resets what the walk remembers nor blocks the second claim
AssertionError: expected [ [ 2349, 'p640f-new-2' ], …(1) ] to deeply equal [ [ 2349, 'p640f-new-1' ], …(1) ]

- Expected
+ Received

  [
    [
      2349,
-     "p640f-new-1",
+     "p640f-new-2",
    ],
    [
      2350,
-     "p640f-new-2",
+     "p640f-old-2",
    ],
  ]

 ❯ app/api/v1/sync/reid-across-pages.test.ts:289:62
    287|
    288|     const after = await rows();
    289|     expect(after.map((r) => [r.id, r.plaid_transaction_id])).toEqual([…
       |                                                              ^
    290|     expect(after.map(owner)).toEqual(before.map(owner));
    291|     expect(result.synced).toBe(0);

⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯[3/15]⎯

 FAIL  app/api/v1/sync/reid-across-pages.test.ts > a sync walk re-identifies each stored row at most once, across pages > PG-04: a tombstoned id on the middle page claims nothing, is stored nowhere, and the last page takes the next row
AssertionError: expected [ [ 2353, 'p640f-new-3' ], …(2) ] to deeply equal [ [ 2353, 'p640f-new-1' ], …(2) ]

- Expected
+ Received

@@ -1,13 +1,13 @@
  [
    [
      2353,
-     "p640f-new-1",
+     "p640f-new-3",
    ],
    [
      2354,
-     "p640f-new-3",
+     "p640f-old-2",
    ],
    [
      2355,
      "p640f-old-3",
    ],

 ❯ app/api/v1/sync/reid-across-pages.test.ts:306:62
    304|     const after = await rows();
    305|     console.log(`[reid-dump pg04] ${JSON.stringify(after.map((r) => ({…
    306|     expect(after.map((r) => [r.id, r.plaid_transaction_id])).toEqual([…
       |                                                              ^
    307|     expect(after.map(owner)).toEqual(before.map(owner));
    308|     const carrying = await db.query('SELECT 1 FROM transactions WHERE …

⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯[4/15]⎯

 FAIL  app/api/v1/sync/reid-across-pages.test.ts > a sync walk re-identifies each stored row at most once, across pages > PG-06: modified for an id renamed on an earlier page refreshes that row and never inserts a third
AssertionError: expected [ [ 2368, 'p640f-new-2' ], …(2) ] to deeply equal [ [ 2368, 'p640f-new-1' ], …(1) ]

- Expected
+ Received

  [
    [
      2368,
-     "p640f-new-1",
+     "p640f-new-2",
    ],
    [
      2369,
-     "p640f-new-2",
+     "p640f-old-2",
+   ],
+   [
+     2372,
+     "p640f-new-1",
    ],
  ]

 ❯ app/api/v1/sync/reid-across-pages.test.ts:373:62
    371|
    372|     const after = await rows();
    373|     expect(after.map((r) => [r.id, r.plaid_transaction_id])).toEqual([…
       |                                                              ^
    374|     expect(after[0].merchant_name).toBe(revised);
    375|     expect(after.map(owner)).toEqual(before.map(owner));

⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯[5/15]⎯

 FAIL  app/api/v1/sync/reid-across-pages.test.ts > a sync walk re-identifies each stored row at most once, across pages > PG-07: the same new id on two pages claims one row only, and is not counted again
AssertionError: expected 1 to be +0 // Object.is equality

- Expected
+ Received

- 0
+ 1

 ❯ app/api/v1/sync/reid-across-pages.test.ts:389:27
    387|     expect(after.map((r) => [r.id, r.plaid_transaction_id])).toEqual([…
    388|     expect(after.map(owner)).toEqual(before.map(owner));
    389|     expect(result.synced).toBe(0);
       |                           ^
    390|   });
    391|

⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯[6/15]⎯

 FAIL  app/api/v1/sync/reid-across-pages.test.ts > a sync walk re-identifies each stored row at most once, across pages > PG-08: two genuine identical transactions on two pages, no stored history, are both stored
AssertionError: expected [ 'p640f-c-2' ] to deeply equal [ 'p640f-c-1', 'p640f-c-2' ]

- Expected
+ Received

  [
-   "p640f-c-1",
    "p640f-c-2",
  ]

 ❯ app/api/v1/sync/reid-across-pages.test.ts:397:63
    395|     const result = await sync(cursors);
    396|
    397|     expect((await rows()).map((r) => r.plaid_transaction_id)).toEqual(…
       |                                                               ^
    398|     expect(result.synced).toBe(2);
    399|   });

⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯[7/15]⎯

 FAIL  app/api/v1/sync/reid-across-pages.test.ts > a sync walk re-identifies each stored row at most once, across pages > PG-09: a row inserted by modified on page 1 is not renamed by a same-key added id on page 2
AssertionError: expected [ 'p640f-c-2' ] to deeply equal [ 'p640f-m-1', 'p640f-c-2' ]

- Expected
+ Received

  [
-   "p640f-m-1",
    "p640f-c-2",
  ]

 ❯ app/api/v1/sync/reid-across-pages.test.ts:406:63
    404|     const result = await sync(cursors);
    405|
    406|     expect((await rows()).map((r) => r.plaid_transaction_id)).toEqual(…
       |                                                               ^
    407|     // Only the `added` insert counts; `modified` has never been count…
    408|     expect(result.synced).toBe(1);

⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯[8/15]⎯

 FAIL  app/api/v1/sync/reid-across-pages.test.ts > a sync walk re-identifies each stored row at most once, across pages > PG-13: a stored-cursor walk with no removed licence never re-identifies: a same-key new id is a second transaction
AssertionError: expected [ 'p640f-new-1' ] to deeply equal [ 'p640f-old-1', 'p640f-new-1' ]

- Expected
+ Received

  [
-   "p640f-old-1",
    "p640f-new-1",
  ]

 ❯ app/api/v1/sync/reid-across-pages.test.ts:446:54
    444|
    445|     const after = await rows();
    446|     expect(after.map((x) => x.plaid_transaction_id)).toEqual([oldId(1)…
       |                                                      ^
    447|     expect(owner(after[0])).toEqual(owner(before[0]));
    448|     expect(after[0].id).toBe(r);

⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯[9/15]⎯

 FAIL  app/api/v1/sync/reid-across-pages.test.ts > a sync walk re-identifies each stored row at most once, across pages > PG-15b: the licence works across pages in either order (added then removed, removed then added)
AssertionError: expected [ [ 2397, 'p640f-new-1' ] ] to deeply equal [ [ 2396, 'p640f-new-1' ] ]

- Expected
+ Received

  [
    [
-     2396,
+     2397,
      "p640f-new-1",
    ],
  ]

 ❯ app/api/v1/sync/reid-across-pages.test.ts:496:64
    494|
    495|       const after = await rows();
    496|       expect(after.map((x) => [x.id, x.plaid_transaction_id])).toEqual…
       |                                                                ^
    497|       expect(after.map(owner)).toEqual(before.map(owner));
    498|       expect((await db.query('SELECT 1 FROM transactions WHERE plaid_t…

⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯[10/15]⎯

 FAIL  app/api/v1/sync/reid-across-pages.test.ts > a sync walk re-identifies each stored row at most once, across pages > PG-15c: only the retired row is claimable, and once: a same-key second new id is inserted, a repeated one claims nothing
AssertionError: expected [ 'p640f-new-1', 'p640f-new-9' ] to deeply equal [ 'p640f-new-1', 'p640f-old-2', …(1) ]

- Expected
+ Received

  [
    "p640f-new-1",
-   "p640f-old-2",
    "p640f-new-9",
  ]

 ❯ app/api/v1/sync/reid-across-pages.test.ts:512:54
    510|
    511|     const after = await rows();
    512|     expect(after.map((x) => x.plaid_transaction_id)).toEqual([newId(1)…
       |                                                      ^
    513|     expect(after.slice(0, 2).map((x) => x.id)).toEqual([r1, r2]);
    514|     expect(after.slice(0, 2).map(owner)).toEqual(before.map(owner));

⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯[11/15]⎯

 FAIL  app/api/v1/sync/reid-across-pages.test.ts > a sync walk re-identifies each stored row at most once, across pages > PG-15d: a removed id of a different key licenses nothing: the new id is inserted and the retired row deleted
AssertionError: expected [ 'p640f-new-1' ] to deeply equal [ 'p640f-old-1', 'p640f-new-1' ]

- Expected
+ Received

  [
-   "p640f-old-1",
    "p640f-new-1",
  ]

 ❯ app/api/v1/sync/reid-across-pages.test.ts:544:54
    542|
    543|     const after = await rows();
    544|     expect(after.map((x) => x.plaid_transaction_id)).toEqual([oldId(1)…
       |                                                      ^
    545|     expect(owner(after[0])).toEqual(owner(before[0]));
    546|     expect(after[0].id).toBe(r);

⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯[12/15]⎯

 FAIL  app/api/v1/sync/reid-across-pages.test.ts > a sync walk re-identifies each stored row at most once, across pages > PG-16: a re-auth walk ending on INITIAL_UPDATE_COMPLETE keeps the cursor NULL, so the historical pull re-identifies
AssertionError: expected 'p640f-r1-next-1' to be null

- Expected:
null

+ Received:
"p640f-r1-next-1"

 ❯ app/api/v1/sync/reid-across-pages.test.ts:557:34
    555|     const run1 = queueWalk(null, [{ added: [], status: 'INITIAL_UPDATE…
    556|     await sync(run1);
    557|     expect(await storedCursor()).toBeNull();
       |                                  ^
    558|
    559|     const run2 = queueWalk(null, [{ added: [txn(newId(1))], status: 'H…

⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯[13/15]⎯

 FAIL  app/api/v1/sync/reid-across-pages.test.ts > a sync walk re-identifies each stored row at most once, across pages > PG-16b: a NOT_READY walk answering with an empty cursor leaves no usable cursor, and the next walk re-identifies
AssertionError: expected [ '' ] to deeply equal [ undefined ]

- Expected
+ Received

  [
-   undefined,
+   "",
  ]

 ❯ sync app/api/v1/sync/reid-across-pages.test.ts:185:86
    183|   // Every queued page was served: a walk that stopped early would lea…
    184|   expect(fake.pages.get(TOKEN)).toEqual([]);
    185|   expect(fake.requests.filter((q) => q.access_token === TOKEN).map((q)…
       |                                                                                      ^
    186|   return result;
    187| }
 ❯ app/api/v1/sync/reid-across-pages.test.ts:580:20

⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯[14/15]⎯

 FAIL  app/api/v1/sync/reid-across-pages.test.ts > a sync walk re-identifies each stored row at most once, across pages > PG-17: after HISTORICAL_UPDATE_COMPLETE the next walk is incremental, and a same-key second purchase is inserted
AssertionError: expected [ 'p640f-new-2' ] to deeply equal [ 'p640f-new-1', 'p640f-new-2' ]

- Expected
+ Received

  [
-   "p640f-new-1",
    "p640f-new-2",
  ]

 ❯ app/api/v1/sync/reid-across-pages.test.ts:624:54
    622|
    623|     const after = await rows();
    624|     expect(after.map((x) => x.plaid_transaction_id)).toEqual([newId(1)…
       |                                                      ^
    625|     expect(after[0].id).toBe(r);
    626|     expect(owner(after[0])).toEqual(owner(before[0]));

⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯[15/15]⎯


 Test Files  1 failed (1)
      Tests  15 failed | 7 passed (22)
   Start at  16:44:11
   Duration  451ms (tests 48%, import 31%, transform 19%, setup 1%)
$ cp $SCRATCH/sync.cycle1.ts apps/web/lib/sync.ts && cmp $SCRATCH/sync.cycle1.ts apps/web/lib/sync.ts; echo "cmp exit $?"
cmp exit 0
```

One-line failure messages from both probes:

```
== c1-probe-cycle0
PG-15	   → expected [ [ 2323, 'p640f-new-1' ] ] to deeply equal [ [ 2322, 'p640f-new-1' ] ]
PG-15b	   → expected [ [ 2325, 'p640f-new-1' ] ] to deeply equal [ [ 2324, 'p640f-new-1' ] ]
PG-15c	   → expected [ 'p640f-old-2', 'p640f-new-1', …(1) ] to deeply equal [ 'p640f-new-1', 'p640f-old-2', …(1) ]
PG-16	   → expected 'p640f-r1-next-1' to be null
PG-16b	   → expected [ '' ] to deeply equal [ undefined ]
PG-17	   → expected [] to have a length of 1 but got +0
== c1-probe-base
PG-01	   → expected [ [ 2339, 'p640f-new-2' ], …(1) ] to deeply equal [ [ 2339, 'p640f-new-1' ], …(1) ]
PG-02	   → expected [ [ 2343, 'p640f-new-3' ], …(2) ] to deeply equal [ [ 2343, 'p640f-new-1' ], …(2) ]
PG-03	   → expected [ [ 2349, 'p640f-new-2' ], …(1) ] to deeply equal [ [ 2349, 'p640f-new-1' ], …(1) ]
PG-04	   → expected [ [ 2353, 'p640f-new-3' ], …(2) ] to deeply equal [ [ 2353, 'p640f-new-1' ], …(2) ]
PG-06	   → expected [ [ 2368, 'p640f-new-2' ], …(2) ] to deeply equal [ [ 2368, 'p640f-new-1' ], …(1) ]
PG-07	   → expected 1 to be +0 // Object.is equality
PG-08	   → expected [ 'p640f-c-2' ] to deeply equal [ 'p640f-c-1', 'p640f-c-2' ]
PG-09	   → expected [ 'p640f-c-2' ] to deeply equal [ 'p640f-m-1', 'p640f-c-2' ]
PG-13	   → expected [ 'p640f-new-1' ] to deeply equal [ 'p640f-old-1', 'p640f-new-1' ]
PG-15b	   → expected [ [ 2397, 'p640f-new-1' ] ] to deeply equal [ [ 2396, 'p640f-new-1' ] ]
PG-15c	   → expected [ 'p640f-new-1', 'p640f-new-9' ] to deeply equal [ 'p640f-new-1', 'p640f-old-2', …(1) ]
PG-15d	   → expected [ 'p640f-new-1' ] to deeply equal [ 'p640f-old-1', 'p640f-new-1' ]
PG-16	   → expected 'p640f-r1-next-1' to be null
PG-16b	   → expected [ '' ] to deeply equal [ undefined ]
PG-17	   → expected [ 'p640f-new-2' ] to deeply equal [ 'p640f-new-1', 'p640f-new-2' ]
```

## Row dumps (from acceptance #3)

```
[reid-dump pg01] [{"id":2411,"hidden":false,"note":"Fabricated P640f note 1","mapped_category":"Fabricated P640f Pick 1","rule_applied":false,"watched_at":"2026-03-01 02:00:00-08","transfer_group_id":86,"property_id":86,"plaid_transaction_id":"p640f-new-1"},{"id":2412,"hidden":true,"note":"Fabricated P640f note 2","mapped_category":"Fabricated P640f Pick 2","rule_applied":false,"watched_at":"2026-03-02 02:00:00-08","transfer_group_id":87,"property_id":87,"plaid_transaction_id":"p640f-new-2"}]
[reid-dump pg01] re-identified log lines=2 total count=2
[reid-dump pg04] [{"id":2425,"hidden":false,"note":"Fabricated P640f note 1","mapped_category":"Fabricated P640f Pick 1","rule_applied":false,"watched_at":"2026-03-01 02:00:00-08","transfer_group_id":86,"property_id":86,"plaid_transaction_id":"p640f-new-1"},{"id":2426,"hidden":true,"note":"Fabricated P640f note 2","mapped_category":"Fabricated P640f Pick 2","rule_applied":false,"watched_at":"2026-03-02 02:00:00-08","transfer_group_id":87,"property_id":87,"plaid_transaction_id":"p640f-new-3"},{"id":2427,"hidden":false,"note":"Fabricated P640f note 3","mapped_category":"Fabricated P640f Pick 3","rule_applied":false,"watched_at":"2026-03-03 02:00:00-08","transfer_group_id":88,"property_id":88,"plaid_transaction_id":"p640f-old-3"}]
```

## Acceptance #1

```
$ (cd apps/web && npx tsc --noEmit)
exit 0
```

## Acceptance #2

```
$ npx eslint apps/web/lib/sync.ts apps/web/app/api/v1/sync/reid-across-pages.test.ts
Pages directory cannot be found at /Users/andreianpilogov/Documents/b8/app/pages or /Users/andreianpilogov/Documents/b8/app/src/pages. If using a custom path, please configure with the `no-html-link-for-pages` rule in your eslint config file.
exit 0
```

## Acceptance #3 (GREEN, after every restore)

```
$ (cd apps/web && env -u PLAID_CLIENT_ID -u PLAID_SECRET npx vitest run --config vitest.integration.config.mts --reporter=verbose app/api/v1/sync/reid-across-pages.test.ts)

 RUN  v5.0.3 /Users/andreianpilogov/Documents/b8/app/apps/web

{"time":"2026-10-07T23:44:16.404Z","level":"info","scope":"sync","message":"re-identified transactions after item change","count":1}
{"time":"2026-10-07T23:44:16.407Z","level":"info","scope":"sync","message":"re-identified transactions after item change","count":1}
[reid-dump pg01] [{"id":2411,"hidden":false,"note":"Fabricated P640f note 1","mapped_category":"Fabricated P640f Pick 1","rule_applied":false,"watched_at":"2026-03-01 02:00:00-08","transfer_group_id":86,"property_id":86,"plaid_transaction_id":"p640f-new-1"},{"id":2412,"hidden":true,"note":"Fabricated P640f note 2","mapped_category":"Fabricated P640f Pick 2","rule_applied":false,"watched_at":"2026-03-02 02:00:00-08","transfer_group_id":87,"property_id":87,"plaid_transaction_id":"p640f-new-2"}]
[reid-dump pg01] re-identified log lines=2 total count=2
{"time":"2026-10-07T23:44:16.423Z","level":"info","scope":"sync","message":"re-identified transactions after item change","count":1}
{"time":"2026-10-07T23:44:16.425Z","level":"info","scope":"sync","message":"re-identified transactions after item change","count":1}
{"time":"2026-10-07T23:44:16.427Z","level":"info","scope":"sync","message":"re-identified transactions after item change","count":1}
{"time":"2026-10-07T23:44:16.437Z","level":"info","scope":"sync","message":"re-identified transactions after item change","count":1}
{"time":"2026-10-07T23:44:16.440Z","level":"info","scope":"sync","message":"re-identified transactions after item change","count":1}
{"time":"2026-10-07T23:44:16.448Z","level":"info","scope":"sync","message":"re-identified transactions after item change","count":1}
{"time":"2026-10-07T23:44:16.450Z","level":"info","scope":"sync","message":"re-identified transactions after item change","count":1}
{"time":"2026-10-07T23:44:16.451Z","level":"info","scope":"sync","message":"skipped transactions the owner deleted","count":1}
[reid-dump pg04] [{"id":2425,"hidden":false,"note":"Fabricated P640f note 1","mapped_category":"Fabricated P640f Pick 1","rule_applied":false,"watched_at":"2026-03-01 02:00:00-08","transfer_group_id":86,"property_id":86,"plaid_transaction_id":"p640f-new-1"},{"id":2426,"hidden":true,"note":"Fabricated P640f note 2","mapped_category":"Fabricated P640f Pick 2","rule_applied":false,"watched_at":"2026-03-02 02:00:00-08","transfer_group_id":87,"property_id":87,"plaid_transaction_id":"p640f-new-3"},{"id":2427,"hidden":false,"note":"Fabricated P640f note 3","mapped_category":"Fabricated P640f Pick 3","rule_applied":false,"watched_at":"2026-03-03 02:00:00-08","transfer_group_id":88,"property_id":88,"plaid_transaction_id":"p640f-old-3"}]
{"time":"2026-10-07T23:44:16.457Z","level":"info","scope":"sync","message":"re-identified transactions after item change","count":1}
{"time":"2026-10-07T23:44:16.458Z","level":"info","scope":"sync","message":"skipped transactions the owner deleted","count":1}
{"time":"2026-10-07T23:44:16.463Z","level":"info","scope":"sync","message":"re-identified transactions after item change","count":1}
{"time":"2026-10-07T23:44:16.464Z","level":"info","scope":"sync","message":"skipped transactions the owner deleted","count":1}
 ✓ app/api/v1/sync/reid-across-pages.test.ts > a sync walk re-identifies each stored row at most once, across pages > PG-01: two identical rows, their new ids one per page: each row takes its own id, once 25ms
 ✓ app/api/v1/sync/reid-across-pages.test.ts > a sync walk re-identifies each stored row at most once, across pages > PG-02: three identical rows, three pages: the k-th id goes to the k-th lowest primary key 19ms
 ✓ app/api/v1/sync/reid-across-pages.test.ts > a sync walk re-identifies each stored row at most once, across pages > PG-03: an empty page between the two ids neither resets what the walk remembers nor blocks the second claim 12ms
 ✓ app/api/v1/sync/reid-across-pages.test.ts > a sync walk re-identifies each stored row at most once, across pages > PG-04: a tombstoned id on the middle page claims nothing, is stored nowhere, and the last page takes the next row 11ms
 ✓ app/api/v1/sync/reid-across-pages.test.ts > a sync walk re-identifies each stored row at most once, across pages > PG-04a: a tombstoned id on the page after a rename leaves the second row on its old id 6ms
 ✓ app/api/v1/sync/reid-across-pages.test.ts > a sync walk re-identifies each stored row at most once, across pages > PG-04b: a tombstoned id on the first page spends no claim, so the next page takes the lowest row 6ms
{"time":"2026-10-07T23:44:16.468Z","level":"info","scope":"sync","message":"re-identified transactions after item change","count":1}
{"time":"2026-10-07T23:44:16.474Z","level":"info","scope":"sync","message":"re-identified transactions after item change","count":1}
{"time":"2026-10-07T23:44:16.475Z","level":"info","scope":"sync","message":"re-identified transactions after item change","count":1}
{"time":"2026-10-07T23:44:16.480Z","level":"info","scope":"sync","message":"re-identified transactions after item change","count":1}
{"time":"2026-10-07T23:44:16.491Z","level":"info","scope":"sync","message":"re-identified transactions after item change","count":2}
{"time":"2026-10-07T23:44:16.496Z","level":"info","scope":"sync","message":"re-identified transactions after item change","count":1}
{"time":"2026-10-07T23:44:16.503Z","level":"info","scope":"sync","message":"re-identified transactions after item change","count":1}
{"time":"2026-10-07T23:44:16.506Z","level":"info","scope":"sync","message":"re-identified transactions after item change","count":1}
{"time":"2026-10-07T23:44:16.510Z","level":"info","scope":"sync","message":"re-identified transactions after item change","count":1}
{"time":"2026-10-07T23:44:16.513Z","level":"info","scope":"sync","message":"re-identified transactions after item change","count":1}
{"time":"2026-10-07T23:44:16.517Z","level":"info","scope":"sync","message":"re-identified transactions after item change","count":1}
{"time":"2026-10-07T23:44:16.520Z","level":"info","scope":"sync","message":"re-identified transactions after item change","count":1}
{"time":"2026-10-07T23:44:16.529Z","level":"info","scope":"sync","message":"re-identified transactions after item change","count":1}
{"time":"2026-10-07T23:44:16.533Z","level":"info","scope":"sync","message":"re-identified transactions after item change","count":1}
{"time":"2026-10-07T23:44:16.536Z","level":"info","scope":"sync","message":"re-identified transactions after item change","count":1}
{"time":"2026-10-07T23:44:16.539Z","level":"info","scope":"sync","message":"re-identified transactions after item change","count":1}
{"time":"2026-10-07T23:44:16.541Z","level":"info","scope":"sync","message":"transactions update status unknown; cursor stored as usual"}
 ✓ app/api/v1/sync/reid-across-pages.test.ts > a sync walk re-identifies each stored row at most once, across pages > PG-05: one new id for two rows leaves the second on its old id, and an unrelated later row is inserted once 6ms
 ✓ app/api/v1/sync/reid-across-pages.test.ts > a sync walk re-identifies each stored row at most once, across pages > PG-06: modified for an id renamed on an earlier page refreshes that row and never inserts a third 6ms
 ✓ app/api/v1/sync/reid-across-pages.test.ts > a sync walk re-identifies each stored row at most once, across pages > PG-07: the same new id on two pages claims one row only, and is not counted again 5ms
 ✓ app/api/v1/sync/reid-across-pages.test.ts > a sync walk re-identifies each stored row at most once, across pages > PG-08: two genuine identical transactions on two pages, no stored history, are both stored 4ms
 ✓ app/api/v1/sync/reid-across-pages.test.ts > a sync walk re-identifies each stored row at most once, across pages > PG-09: a row inserted by modified on page 1 is not renamed by a same-key added id on page 2 3ms
 ✓ app/api/v1/sync/reid-across-pages.test.ts > a sync walk re-identifies each stored row at most once, across pages > PG-10: a single page carrying both new ids still pairs them in order (unchanged) 4ms
 ✓ app/api/v1/sync/reid-across-pages.test.ts > a sync walk re-identifies each stored row at most once, across pages > PG-12: an opposite-sign amount is a different transaction; only the same-key id claims the stored row 4ms
 ✓ app/api/v1/sync/reid-across-pages.test.ts > a sync walk re-identifies each stored row at most once, across pages > PG-13: a stored-cursor walk with no removed licence never re-identifies: a same-key new id is a second transaction 3ms
 ✓ app/api/v1/sync/reid-across-pages.test.ts > a sync walk re-identifies each stored row at most once, across pages > PG-14: the same delivery from no cursor still re-identifies the stored row in place 3ms
 ✓ app/api/v1/sync/reid-across-pages.test.ts > a sync walk re-identifies each stored row at most once, across pages > PG-15: a stored-cursor walk that retires the old id renames the row in place instead of deleting it 4ms
 ✓ app/api/v1/sync/reid-across-pages.test.ts > a sync walk re-identifies each stored row at most once, across pages > PG-15b: the licence works across pages in either order (added then removed, removed then added) 7ms
 ✓ app/api/v1/sync/reid-across-pages.test.ts > a sync walk re-identifies each stored row at most once, across pages > PG-15c: only the retired row is claimable, and once: a same-key second new id is inserted, a repeated one claims nothing 7ms
 ✓ app/api/v1/sync/reid-across-pages.test.ts > a sync walk re-identifies each stored row at most once, across pages > PG-15d: a removed id of a different key licenses nothing: the new id is inserted and the retired row deleted 4ms
 ✓ app/api/v1/sync/reid-across-pages.test.ts > a sync walk re-identifies each stored row at most once, across pages > PG-16: a re-auth walk ending on INITIAL_UPDATE_COMPLETE keeps the cursor NULL, so the historical pull re-identifies 4ms
 ✓ app/api/v1/sync/reid-across-pages.test.ts > a sync walk re-identifies each stored row at most once, across pages > PG-16b: a NOT_READY walk answering with an empty cursor leaves no usable cursor, and the next walk re-identifies 7ms
 ✓ app/api/v1/sync/reid-across-pages.test.ts > a sync walk re-identifies each stored row at most once, across pages > PG-17: after HISTORICAL_UPDATE_COMPLETE the next walk is incremental, and a same-key second purchase is inserted 5ms

 Test Files  1 passed (1)
      Tests  22 passed (22)
   Start at  16:44:16
   Duration  462ms (tests 50%, import 30%, transform 19%, setup 1%)

exit 0
```

## Acceptance #4

```
$ (cd apps/web && env -u PLAID_CLIENT_ID -u PLAID_SECRET npx vitest run --config vitest.integration.config.mts --reporter=verbose app/api/v1/sync/reid-across-pages.test.ts 2>&1 | grep -cE '^\s*(✓|×).*PG-')
22
```

## Acceptance #5

```
$ (cd apps/web && env -u PLAID_CLIENT_ID -u PLAID_SECRET npx vitest run --config vitest.integration.config.mts --reporter=verbose app/api/v1/sync/route.test.ts app/api/v1/sync/enrichment.test.ts app/api/v1/plaid/exchange-token/reissue-root-cause.test.ts)

 RUN  v5.0.3 /Users/andreianpilogov/Documents/b8/app/apps/web

{"time":"2026-10-07T23:44:18.366Z","level":"info","scope":"sync","message":"re-identified transactions after item change","count":1}
 ✓ app/api/v1/sync/enrichment.test.ts > sync keeps Plaid enrichment > T40b-S1: an added row stores all ten columns, the primary category unchanged and the date unshifted 30ms
 ✓ app/api/v1/sync/enrichment.test.ts > sync keeps Plaid enrichment > T40b-S2: when Plaid omits everything optional, all ten columns are NULL and plaid_raw is still an object 8ms
 ✓ app/api/v1/sync/enrichment.test.ts > sync keeps Plaid enrichment > T40b-S3: empty and whitespace-only strings are stored as NULL 10ms
 ✓ app/api/v1/sync/enrichment.test.ts > sync keeps Plaid enrichment > T40b-S4: modified with changed values overwrites every column and plaid_raw becomes the new object 11ms
 ✓ app/api/v1/sync/enrichment.test.ts > sync keeps Plaid enrichment > T40b-S5: modified that omits previously stored fields sets them to NULL rather than keeping the stale values 5ms
 ✓ app/api/v1/sync/enrichment.test.ts > sync keeps Plaid enrichment > T40b-S6: modified for an id not yet stored creates the row with every field 4ms
 ✓ app/api/v1/sync/enrichment.test.ts > sync keeps Plaid enrichment > T40b-S7: modified leaves the six owner-set fields byte-identical while refreshing enrichment and plaid_category 5ms
 ✓ app/api/v1/sync/enrichment.test.ts > sync keeps Plaid enrichment > T40b-S8: an added event re-delivering a stored id leaves the owner-set fields byte-identical too 4ms
 ✓ app/api/v1/sync/enrichment.test.ts > sync keeps Plaid enrichment > T40b-S9: a rule-managed row still has mapped_category re-derived on modified, and gets the new enrichment 3ms
 ✓ app/api/v1/sync/enrichment.test.ts > sync keeps Plaid enrichment > T40b-S10: a re-identified row keeps its id and owner fields and gains the new id, enrichment and plaid_raw 5ms
{"time":"2026-10-07T23:44:18.373Z","level":"warn","scope":"sync","message":"transactions for unrecognized account_ids (not saved)","accountIds":["p40b_enrich_unknown_acct"]}
{"time":"2026-10-07T23:44:18.383Z","level":"info","scope":"sync","message":"skipped transactions the owner deleted","count":2}
 ✓ app/api/v1/sync/enrichment.test.ts > sync keeps Plaid enrichment > T40b-S11: a pending transaction with full enrichment creates no row, as added or as modified 3ms
 ✓ app/api/v1/sync/enrichment.test.ts > sync keeps Plaid enrichment > T40b-S12: a transaction for an unknown account creates no row 2ms
 ✓ app/api/v1/sync/enrichment.test.ts > sync keeps Plaid enrichment > T40b-S13: plaid_raw is the object as received, minus only counterparties[*].account_numbers 4ms
 ✓ app/api/v1/sync/enrichment.test.ts > sync keeps Plaid enrichment > T40b-S14: the detailed category does not drive rules; the primary one still does 4ms
 ✓ app/api/v1/sync/enrichment.test.ts > sync keeps Plaid enrichment > T40b-S15: a tombstoned id carrying full enrichment creates no row, as added or as modified 2ms
 ✓ app/api/v1/sync/enrichment.test.ts > sync keeps Plaid enrichment > T40b-S16: the same sync response twice leaves one row with identical values and a deep-equal plaid_raw 4ms
 ✓ app/api/v1/sync/enrichment.test.ts > sync keeps Plaid enrichment > T40b-S17: one transaction with objects missing outright does not fail the batch 3ms
 ✓ app/api/v1/sync/enrichment.test.ts > sync keeps Plaid enrichment > T40b-S18: U+0000 and lone surrogates in enrichment text become U+FFFD; the page and its page-mate still sync and the cursor advances 4ms
{"time":"2026-10-07T23:44:18.734Z","level":"info","scope":"sync","message":"skipped transactions the owner deleted","count":1}
{"time":"2026-10-07T23:44:18.755Z","level":"info","scope":"sync","message":"skipped transactions the owner deleted","count":1}
{"time":"2026-10-07T23:44:18.764Z","level":"info","scope":"sync","message":"skipped transactions the owner deleted","count":1}
{"time":"2026-10-07T23:44:18.774Z","level":"info","scope":"sync","message":"skipped transactions the owner deleted","count":1}
 ✓ app/api/v1/sync/route.test.ts > sync never writes back a transaction the owner deleted > T40a-S7: a tombstoned id arriving as added is skipped, its page-mate is inserted, and the sync completes 20ms
 ✓ app/api/v1/sync/route.test.ts > sync never writes back a transaction the owner deleted > T40a-S8: a row deleted through the real route does not return on modified, while a live row updates and keeps its owner category 20ms
 ✓ app/api/v1/sync/route.test.ts > sync never writes back a transaction the owner deleted > T40a-S9: modified for a tombstoned id writes nothing even when a row with that id exists 8ms
 ✓ app/api/v1/sync/route.test.ts > sync never writes back a transaction the owner deleted > T40a-S10: a tombstoned incoming id never claims a stored live row during re-identification 14ms
 ✓ app/api/v1/sync/route.test.ts > sync never writes back a transaction the owner deleted > T40a-S11: removed is a no-op for a tombstoned id and deletes a live row without tombstoning it 7ms
{"time":"2026-10-07T23:44:19.071Z","level":"info","scope":"sync","message":"re-identified transactions after item change","count":2}
{"time":"2026-10-07T23:44:19.075Z","level":"info","scope":"sync","message":"re-identified transactions after item change","count":2}
{"time":"2026-10-07T23:44:19.094Z","level":"warn","scope":"plaidReconcile","message":"could not confidently reconcile","unmatchedLive":[],"unmatchedDb":[{"id":"rc-p40e-acct-mix-null","name":"Fabricated RC Mixed A","mask":null},{"id":"rc-p40e-acct-mix-set","name":"Fabricated RC Mixed B","mask":null}]}
{"time":"2026-10-07T23:44:19.096Z","level":"warn","scope":"plaidReconcile","message":"could not confidently reconcile","unmatchedLive":[],"unmatchedDb":[{"id":"rc-p40e-acct-mix-set","name":"Fabricated RC Mixed B","mask":null},{"id":"rc-p40e-acct-mix-null","name":"Fabricated RC Mixed A","mask":null}]}
 ✓ app/api/v1/plaid/exchange-token/reissue-root-cause.test.ts > why reissued rows stayed orphaned > RC-01: a token change through exchange-token nulls the cursor, and the full re-delivery re-keys every row in place 48ms
 ✓ app/api/v1/plaid/exchange-token/reissue-root-cause.test.ts > why reissued rows stayed orphaned > RC-02: ids reissued on the SAME item never reach sync: an incremental delta leaves the old rows orphaned 11ms
 ✓ app/api/v1/plaid/exchange-token/reissue-root-cause.test.ts > why reissued rows stayed orphaned > RC-03: an item whose accounts disagree on the cursor syncs from no cursor, whichever account the table returns first 8ms

 Test Files  3 passed (3)
      Tests  26 passed (26)
   Start at  16:44:17
   Duration  1.11s (import 49%, tests 36%, transform 13%, setup 1%)

exit 0
```

## Acceptance #6

```
$ git diff --stat 8df05e7 -- apps/web/app/api/v1/sync/route.test.ts apps/web/app/api/v1/sync/enrichment.test.ts apps/web/app/api/v1/plaid/exchange-token/reissue-root-cause.test.ts apps/web/lib/domain/txnMatch.ts apps/web/lib/domain/txnMatch.test.ts apps/web/vitest.integration.config.mts
exit 0 (no output above this line)
```

## Acceptance #7

```
$ /usr/bin/grep -c "export const key = (t: { accountId: string; date: string; amount: number; name: string | null }) =>" apps/web/lib/domain/txnMatch.ts
$ /usr/bin/grep -c "toFixed(2)}|\${(t.name ?? '').trim().toLowerCase()}" apps/web/lib/domain/txnMatch.ts
1
1
```

## Acceptance #8

```
$ (cd apps/web && npx vitest run lib/domain/txnMatch.test.ts)

 RUN  v5.0.3 /Users/andreianpilogov/Documents/b8/app/apps/web


 Test Files  1 passed (1)
      Tests  12 passed (12)
   Start at  16:44:19
   Duration  129ms (transform 55%, import 20%, tests 14%, worker 11%)

exit 0
```

## Acceptance #10

```
$ (cd apps/web && env -u PLAID_CLIENT_ID -u PLAID_SECRET npx vitest run --config vitest.integration.config.mts --reporter=verbose app/api/v1/sync/reid-across-pages.test.ts 2>&1 | grep -c 'Tests .*failed')
0
```

## Acceptance #11

```
$ npm test

> b8@0.1.0 test
> npm run test -w @b8/web


> @b8/web@0.1.0 test
> vitest run


 RUN  v5.0.3 /Users/andreianpilogov/Documents/b8/app/apps/web

(node:48182) ExperimentalWarning: The supports Web Crypto API method is an experimental feature and might change at any time
(Use `node --trace-warnings ...` to show where the warning was created)
(node:48182) ExperimentalWarning: The ML-DSA-44 Web Crypto API algorithm is an experimental feature and might change at any time

 Test Files  72 passed (72)
      Tests  1112 passed (1112)
   Start at  16:44:21
   Duration  5.73s (tests 58%, import 22%, transform 18%, worker 2%)

    Isolate  72 workers spawned · ~143ms startup each (spawn + environment, per file)
             at least ~1.33s faster with isolate: false — reuses workers across files instead of one per file

npm test exit 0
```

## Acceptance #12

```
$ git diff --stat 8df05e7 -- . ':!apps/web/lib/sync.ts' ':!apps/web/app/api/v1/sync/reid-across-pages.test.ts' ':!plan'
exit 0 (no output above this line)
```

---

# Cycle 0 record (R4 — superseded by R5; kept as run)

Implementer's evidence bundle. Every command below was run by the implementer on 2026-10-07 against the
scratch database `b8_p640f` (`DATABASE_URL=postgresql://localhost/b8_p640f`), with `PLAID_CLIENT_ID` and
`PLAID_SECRET` unset (`env -u`). Outputs are verbatim. Every id, name and amount in them is a fabricated
`p640f-` sentinel; no figure from the owner's ledger appears. Nothing is committed.

## Summary

| # | Result |
|---|---|
| 1 | `tsc --noEmit` exit 0 |
| 2 | `eslint` exit 0, no warnings (the one line printed is Next's plugin notice about a `pages` directory, which every eslint run in this repo prints; it is not a lint problem) |
| 3 | 15 passed, 0 failed; 15 lines match `PG-` |
| 4 | `15` (the G0 amendment raised the expected count from 13 to 15 with PG-13 and PG-14) |
| 5 | `Tests  26 passed (26)`, the three files unmodified |
| 6 | prints nothing |
| 7 | `1` and `1` with the system grep (see the note on #7 below) |
| 8 | `Tests  12 passed (12)` |
| 9 | base `sync.ts`: exactly PG-01, 02, 03, 04, 06, 07, 08, 09 and PG-13 fail; PG-04a, 04b, 05, 10, 12 and PG-14 pass. Restore `cmp` exit 0. Matches the spec plus the G0 amendment. One nuance for PG-07, below. |
| 10 | `0` |
| 11 | `Test Files  72 passed (72)`, `Tests  1112 passed (1112)` — baseline unchanged |
| 12 | prints nothing |

## What changed

`apps/web/lib/sync.ts`, inside `syncItem` only:

- **R4.** `const reidentifies = cursor === null;` When the walk began from a stored cursor, the
  re-identification block is skipped entirely (`pageCandidates` is empty: no tombstone read, no
  existing-rows read, no rename). Every new posted id then goes through the unchanged upserts, which
  still carry the in-statement tombstone guard, after the unchanged pending skip.
- **R1, R2, R3.** One walk-scoped `Set<string>`, `seenInWalk`, holds every posted, known-account id the
  walk has handed to either upsert (`added` or `modified`), recorded before the write so that a
  tombstone-refused id is remembered too. It is used twice: an incoming id already in it is not a
  claimant (R2), and a stored row whose `plaid_transaction_id` is in it is not a candidate (R1 for a
  renamed row, R3 for a row inserted or refreshed by an earlier page's upsert).
- **Counting.** The `reidentified` set moved from per page to per walk, so a renamed row whose id Plaid
  repeats on a later page is refreshed by the upsert there without being counted as a new transaction.
- No change to `txnMatch.ts`, its key, the upserts' SQL, the tombstone guard, the cursor write,
  `unmatchedAccountIds`, the `removed` loop, `runSyncInner`, the schema, or any shared type.

## What the walk remembers between pages

The walk now remembers one thing between pages: the set of Plaid transaction ids it has already handed
to the `added` or `modified` upsert, for that item's walk only (it is a local of `syncItem`, so a second
item starts empty and nothing persists past the walk). Every row the walk writes carries an id from that
set, because an upsert writes the id it was given and a rename writes an id that the same page's upsert
then handles. So the set answers both of the matcher's per-page blind spots at once: such an id may not
claim a stored row on a later page, and a stored row bearing such an id is not a candidate on a later
page, because Plaid has already referred to it in this walk. It sits beside the tombstone pre-filter
rather than replacing it. The tombstone set is still read per page, still removes a tombstoned id from
the claimants before matching (so it spends no claim), and still removes a stored row bearing a
tombstoned id from the pool. Because a tombstoned id is recorded in the walk set when the upsert loop
reaches it (and the guard refuses the write), it also stays out of both roles on every later page, even
on a page where it is not delivered again. The walk set only ever narrows the matcher's inputs. It
never adds a candidate, never changes the pairing order (still lowest primary key first, in delivery
order), and is empty on the first page, so a single-page walk behaves exactly as before. A walk that
began from a stored cursor does not consult it at all, because it does no re-identification.

## Existing-test fixture edits (G0 amendment to #5/#6)

**None.** No existing test asserts re-identification on a walk that starts from a stored cursor:
`RC-01` re-identifies after exchange-token has nulled the cursor; `T40b-S10` and `T40a-S10` run on an
account seeded with no cursor (their first sync is from no cursor); the tests that sync twice
(`T40a-S8`, `T40b-S4`, `S5`, `S14`, `S16`) re-identify nothing on the second sync. Acceptance #5 is
green on the three unmodified files and #6 prints nothing.

## Notes and deviations

- **#7 and this shell's `grep`.** In the implementer's shell, `grep` is a function that runs ugrep, and
  with it the second command of #7 prints `0` against the file — the same `0` against the base file
  (`git show 8df05e7:apps/web/lib/domain/txnMatch.ts | grep -c ...`), so it is the pattern's quoting
  under ugrep, not a change. With the system `/usr/bin/grep` both commands print `1`. #6 shows the file
  byte-identical to base regardless. The orchestrator should run #7 with `/usr/bin/grep` (or `grep -F`,
  which prints `1` in either).
- **PG-07 is RED on base through its `synced` assertion, not its row assertion.** On base, page 2's
  repeated `new-1` finds the renamed row inside page 2's own read (same date), so the matcher's
  "already stored under this exact id" rule already keeps it from claiming row b; the rows come out
  right. What base gets wrong is the count: its page-local `reidentified` set has forgotten the rename,
  so the conflict-refresh on page 2 is counted as a new transaction (`expected 1 to be +0`). The spec's
  prediction (RED) holds; the reason is the counter rather than a second claim. The second-claim path of
  R2 is still guarded: mutation M1 below (the claimant filter removed) makes PG-07 fail, because the
  walk set then hides row a from page 2's pool while `new-1` is still allowed to claim — so it claims
  row b and the rename hits the unique constraint.
- **PG-03's date spread.** The spec's failure-mode list suggests spreading the page date ranges in
  PG-03; doing so with extra rows would have changed PG-03's required `synced` of `0`. The case is
  covered in PG-05 instead: its page 2 carries only an unrelated row on a later date, so page 2's
  range excludes the group entirely, and the test asserts the renamed row is not duplicated and the
  group keeps its exact row count.
- **Second item in PG-02** (spec: "if cheap") was not added. Plaid ids do not repeat across items, so a
  second item cannot make a per-run set observably different from a per-item one with real-shaped data;
  the scope is visible in the code instead (`seenInWalk` is a local of `syncItem`).
- **Over-counting of a plain repeated id is unchanged.** An id that was an ordinary insert on page 1 and
  is delivered again on page 2 is still counted twice by `added`, exactly as on base. Changing that is
  the `added` counter semantics the spec lists as a non-goal; it is noted, not changed.
- **Log line.** The `re-identified transactions after item change` line is still emitted per page with
  that page's count. In the PG-01 run there are 2 such lines, each `count 1`, total 2 — the true number
  of renames. On base the same fixture also emits 2 lines totalling 2, but one of them is the second
  rename of the same row (a rename that undid the first), so base's total was not truthful.
- **Palette / UI.** Not applicable; no UI touched.

## Additional mutation probes (beyond #9)

Each probe edits the fixed `sync.ts` with one change, runs the new file, and is restored from the saved
copy (final `cmp` exit 0). Failing tests per mutant:

| Mutant | Change | Tests that fail |
|---|---|---|
| M1 | claimant filter `!seenInWalk.has(t.transaction_id)` removed | PG-07 |
| M2 | candidate filter `!seenInWalk.has(r.plaid_transaction_id)` removed | PG-01 PG-02 PG-03 PG-04 PG-06 PG-08 PG-09 |
| M3 | `reidentifies` forced to `true` | PG-13 |
| M4 | `seenInWalk.add` removed from the `modified` loop | PG-09 |

## Post-walk row dumps (printed by the test run, from acceptance #3)

Primary key, owner values and the id each row carries after the walk. PG-01: row with the lower key
carries `new-1`, the higher `new-2`, notes and the hidden flag on their own keys. PG-04: `new-1` on the
lowest key, `new-3` on the middle, the highest keeps `old-3`, and no row carries `p640f-tomb-x`.

```
[reid-dump pg01] [{"id":416,"hidden":false,"note":"Fabricated P640f note 1","mapped_category":"Fabricated P640f Pick 1","rule_applied":false,"plaid_transaction_id":"p640f-new-1"},{"id":417,"hidden":true,"note":"Fabricated P640f note 2","mapped_category":"Fabricated P640f Pick 2","rule_applied":false,"plaid_transaction_id":"p640f-new-2"}]
[reid-dump pg01] re-identified log lines=2 total count=2
[reid-dump pg04] [{"id":430,"hidden":false,"note":"Fabricated P640f note 1","mapped_category":"Fabricated P640f Pick 1","rule_applied":false,"plaid_transaction_id":"p640f-new-1"},{"id":431,"hidden":true,"note":"Fabricated P640f note 2","mapped_category":"Fabricated P640f Pick 2","rule_applied":false,"plaid_transaction_id":"p640f-new-3"},{"id":432,"hidden":false,"note":"Fabricated P640f note 3","mapped_category":"Fabricated P640f Pick 3","rule_applied":false,"plaid_transaction_id":"p640f-old-3"}]
```

`re-identified transactions after item change` lines in the PG-01 run: **2**, total count **2**
(second dump line above).

## Acceptance #1

```
$ (cd apps/web && npx tsc --noEmit)
exit 0
```

## Acceptance #2

```
$ npx eslint apps/web/lib/sync.ts apps/web/app/api/v1/sync/reid-across-pages.test.ts
Pages directory cannot be found at /Users/andreianpilogov/Documents/b8/app/pages or /Users/andreianpilogov/Documents/b8/app/src/pages. If using a custom path, please configure with the `no-html-link-for-pages` rule in your eslint config file.
exit 0
```

## Acceptance #3

```
$ (cd apps/web && env -u PLAID_CLIENT_ID -u PLAID_SECRET npx vitest run --config vitest.integration.config.mts --reporter=verbose app/api/v1/sync/reid-across-pages.test.ts)

 RUN  v5.0.3 /Users/andreianpilogov/Documents/b8/app/apps/web

{"time":"2026-10-07T23:26:16.113Z","level":"info","scope":"sync","message":"re-identified transactions after item change","count":1}
{"time":"2026-10-07T23:26:16.115Z","level":"info","scope":"sync","message":"re-identified transactions after item change","count":1}
[reid-dump pg01] [{"id":416,"hidden":false,"note":"Fabricated P640f note 1","mapped_category":"Fabricated P640f Pick 1","rule_applied":false,"plaid_transaction_id":"p640f-new-1"},{"id":417,"hidden":true,"note":"Fabricated P640f note 2","mapped_category":"Fabricated P640f Pick 2","rule_applied":false,"plaid_transaction_id":"p640f-new-2"}]
[reid-dump pg01] re-identified log lines=2 total count=2
{"time":"2026-10-07T23:26:16.122Z","level":"info","scope":"sync","message":"re-identified transactions after item change","count":1}
{"time":"2026-10-07T23:26:16.123Z","level":"info","scope":"sync","message":"re-identified transactions after item change","count":1}
{"time":"2026-10-07T23:26:16.124Z","level":"info","scope":"sync","message":"re-identified transactions after item change","count":1}
{"time":"2026-10-07T23:26:16.129Z","level":"info","scope":"sync","message":"re-identified transactions after item change","count":1}
{"time":"2026-10-07T23:26:16.130Z","level":"info","scope":"sync","message":"re-identified transactions after item change","count":1}
{"time":"2026-10-07T23:26:16.135Z","level":"info","scope":"sync","message":"re-identified transactions after item change","count":1}
{"time":"2026-10-07T23:26:16.137Z","level":"info","scope":"sync","message":"re-identified transactions after item change","count":1}
{"time":"2026-10-07T23:26:16.138Z","level":"info","scope":"sync","message":"skipped transactions the owner deleted","count":1}
[reid-dump pg04] [{"id":430,"hidden":false,"note":"Fabricated P640f note 1","mapped_category":"Fabricated P640f Pick 1","rule_applied":false,"plaid_transaction_id":"p640f-new-1"},{"id":431,"hidden":true,"note":"Fabricated P640f note 2","mapped_category":"Fabricated P640f Pick 2","rule_applied":false,"plaid_transaction_id":"p640f-new-3"},{"id":432,"hidden":false,"note":"Fabricated P640f note 3","mapped_category":"Fabricated P640f Pick 3","rule_applied":false,"plaid_transaction_id":"p640f-old-3"}]
{"time":"2026-10-07T23:26:16.143Z","level":"info","scope":"sync","message":"re-identified transactions after item change","count":1}
{"time":"2026-10-07T23:26:16.144Z","level":"info","scope":"sync","message":"skipped transactions the owner deleted","count":1}
{"time":"2026-10-07T23:26:16.149Z","level":"info","scope":"sync","message":"re-identified transactions after item change","count":1}
{"time":"2026-10-07T23:26:16.150Z","level":"info","scope":"sync","message":"skipped transactions the owner deleted","count":1}
{"time":"2026-10-07T23:26:16.157Z","level":"info","scope":"sync","message":"re-identified transactions after item change","count":1}
{"time":"2026-10-07T23:26:16.161Z","level":"info","scope":"sync","message":"re-identified transactions after item change","count":1}
{"time":"2026-10-07T23:26:16.163Z","level":"info","scope":"sync","message":"re-identified transactions after item change","count":1}
{"time":"2026-10-07T23:26:16.166Z","level":"info","scope":"sync","message":"re-identified transactions after item change","count":1}
{"time":"2026-10-07T23:26:16.175Z","level":"info","scope":"sync","message":"re-identified transactions after item change","count":2}
{"time":"2026-10-07T23:26:16.178Z","level":"info","scope":"sync","message":"re-identified transactions after item change","count":1}
{"time":"2026-10-07T23:26:16.183Z","level":"info","scope":"sync","message":"re-identified transactions after item change","count":1}
 ✓ app/api/v1/sync/reid-across-pages.test.ts > a sync walk re-identifies each stored row at most once, across pages > PG-01: two identical rows, their new ids one per page: each row takes its own id, once 30ms
 ✓ app/api/v1/sync/reid-across-pages.test.ts > a sync walk re-identifies each stored row at most once, across pages > PG-02: three identical rows, three pages: the k-th id goes to the k-th lowest primary key 9ms
 ✓ app/api/v1/sync/reid-across-pages.test.ts > a sync walk re-identifies each stored row at most once, across pages > PG-03: an empty page between the two ids neither resets what the walk remembers nor blocks the second claim 6ms
 ✓ app/api/v1/sync/reid-across-pages.test.ts > a sync walk re-identifies each stored row at most once, across pages > PG-04: a tombstoned id on the middle page claims nothing, is stored nowhere, and the last page takes the next row 8ms
 ✓ app/api/v1/sync/reid-across-pages.test.ts > a sync walk re-identifies each stored row at most once, across pages > PG-04a: a tombstoned id on the page after a rename leaves the second row on its old id 5ms
 ✓ app/api/v1/sync/reid-across-pages.test.ts > a sync walk re-identifies each stored row at most once, across pages > PG-04b: a tombstoned id on the first page spends no claim, so the next page takes the lowest row 6ms
 ✓ app/api/v1/sync/reid-across-pages.test.ts > a sync walk re-identifies each stored row at most once, across pages > PG-05: one new id for two rows leaves the second on its old id, and an unrelated later row is inserted once 8ms
 ✓ app/api/v1/sync/reid-across-pages.test.ts > a sync walk re-identifies each stored row at most once, across pages > PG-06: modified for an id renamed on an earlier page refreshes that row and never inserts a third 5ms
 ✓ app/api/v1/sync/reid-across-pages.test.ts > a sync walk re-identifies each stored row at most once, across pages > PG-07: the same new id on two pages claims one row only, and is not counted again 3ms
 ✓ app/api/v1/sync/reid-across-pages.test.ts > a sync walk re-identifies each stored row at most once, across pages > PG-08: two genuine identical transactions on two pages, no stored history, are both stored 3ms
 ✓ app/api/v1/sync/reid-across-pages.test.ts > a sync walk re-identifies each stored row at most once, across pages > PG-09: a row inserted by modified on page 1 is not renamed by a same-key added id on page 2 2ms
 ✓ app/api/v1/sync/reid-across-pages.test.ts > a sync walk re-identifies each stored row at most once, across pages > PG-10: a single page carrying both new ids still pairs them in order (unchanged) 3ms
 ✓ app/api/v1/sync/reid-across-pages.test.ts > a sync walk re-identifies each stored row at most once, across pages > PG-12: an opposite-sign amount is a different transaction; only the same-key id claims the stored row 3ms
 ✓ app/api/v1/sync/reid-across-pages.test.ts > a sync walk re-identifies each stored row at most once, across pages > PG-13: a walk from a stored cursor never re-identifies: a same-key new id is a second transaction 2ms
 ✓ app/api/v1/sync/reid-across-pages.test.ts > a sync walk re-identifies each stored row at most once, across pages > PG-14: the same delivery from no cursor still re-identifies the stored row in place 3ms

 Test Files  1 passed (1)
      Tests  15 passed (15)
   Start at  16:26:15
   Duration  413ms (import 43%, tests 33%, transform 22%, setup 2%)
```

## Acceptance #4

```
$ (cd apps/web && env -u PLAID_CLIENT_ID -u PLAID_SECRET npx vitest run --config vitest.integration.config.mts --reporter=verbose app/api/v1/sync/reid-across-pages.test.ts 2>&1 | grep -cE '^\s*(✓|×).*PG-')
15
```

## Acceptance #5

```
$ (cd apps/web && env -u PLAID_CLIENT_ID -u PLAID_SECRET npx vitest run --config vitest.integration.config.mts --reporter=verbose app/api/v1/sync/route.test.ts app/api/v1/sync/enrichment.test.ts app/api/v1/plaid/exchange-token/reissue-root-cause.test.ts)

 RUN  v5.0.3 /Users/andreianpilogov/Documents/b8/app/apps/web

{"time":"2026-10-07T23:26:17.897Z","level":"info","scope":"sync","message":"re-identified transactions after item change","count":1}
{"time":"2026-10-07T23:26:17.905Z","level":"warn","scope":"sync","message":"transactions for unrecognized account_ids (not saved)","accountIds":["p40b_enrich_unknown_acct"]}
{"time":"2026-10-07T23:26:17.918Z","level":"info","scope":"sync","message":"skipped transactions the owner deleted","count":2}
 ✓ app/api/v1/sync/enrichment.test.ts > sync keeps Plaid enrichment > T40b-S1: an added row stores all ten columns, the primary category unchanged and the date unshifted 16ms
 ✓ app/api/v1/sync/enrichment.test.ts > sync keeps Plaid enrichment > T40b-S2: when Plaid omits everything optional, all ten columns are NULL and plaid_raw is still an object 6ms
 ✓ app/api/v1/sync/enrichment.test.ts > sync keeps Plaid enrichment > T40b-S3: empty and whitespace-only strings are stored as NULL 4ms
 ✓ app/api/v1/sync/enrichment.test.ts > sync keeps Plaid enrichment > T40b-S4: modified with changed values overwrites every column and plaid_raw becomes the new object 6ms
 ✓ app/api/v1/sync/enrichment.test.ts > sync keeps Plaid enrichment > T40b-S5: modified that omits previously stored fields sets them to NULL rather than keeping the stale values 7ms
 ✓ app/api/v1/sync/enrichment.test.ts > sync keeps Plaid enrichment > T40b-S6: modified for an id not yet stored creates the row with every field 4ms
 ✓ app/api/v1/sync/enrichment.test.ts > sync keeps Plaid enrichment > T40b-S7: modified leaves the six owner-set fields byte-identical while refreshing enrichment and plaid_category 5ms
 ✓ app/api/v1/sync/enrichment.test.ts > sync keeps Plaid enrichment > T40b-S8: an added event re-delivering a stored id leaves the owner-set fields byte-identical too 5ms
 ✓ app/api/v1/sync/enrichment.test.ts > sync keeps Plaid enrichment > T40b-S9: a rule-managed row still has mapped_category re-derived on modified, and gets the new enrichment 4ms
 ✓ app/api/v1/sync/enrichment.test.ts > sync keeps Plaid enrichment > T40b-S10: a re-identified row keeps its id and owner fields and gains the new id, enrichment and plaid_raw 8ms
 ✓ app/api/v1/sync/enrichment.test.ts > sync keeps Plaid enrichment > T40b-S11: a pending transaction with full enrichment creates no row, as added or as modified 3ms
 ✓ app/api/v1/sync/enrichment.test.ts > sync keeps Plaid enrichment > T40b-S12: a transaction for an unknown account creates no row 2ms
 ✓ app/api/v1/sync/enrichment.test.ts > sync keeps Plaid enrichment > T40b-S13: plaid_raw is the object as received, minus only counterparties[*].account_numbers 4ms
 ✓ app/api/v1/sync/enrichment.test.ts > sync keeps Plaid enrichment > T40b-S14: the detailed category does not drive rules; the primary one still does 6ms
 ✓ app/api/v1/sync/enrichment.test.ts > sync keeps Plaid enrichment > T40b-S15: a tombstoned id carrying full enrichment creates no row, as added or as modified 3ms
 ✓ app/api/v1/sync/enrichment.test.ts > sync keeps Plaid enrichment > T40b-S16: the same sync response twice leaves one row with identical values and a deep-equal plaid_raw 5ms
 ✓ app/api/v1/sync/enrichment.test.ts > sync keeps Plaid enrichment > T40b-S17: one transaction with objects missing outright does not fail the batch 3ms
 ✓ app/api/v1/sync/enrichment.test.ts > sync keeps Plaid enrichment > T40b-S18: U+0000 and lone surrogates in enrichment text become U+FFFD; the page and its page-mate still sync and the cursor advances 3ms
{"time":"2026-10-07T23:26:18.307Z","level":"info","scope":"sync","message":"skipped transactions the owner deleted","count":1}
{"time":"2026-10-07T23:26:18.326Z","level":"info","scope":"sync","message":"skipped transactions the owner deleted","count":1}
{"time":"2026-10-07T23:26:18.331Z","level":"info","scope":"sync","message":"skipped transactions the owner deleted","count":1}
{"time":"2026-10-07T23:26:18.336Z","level":"info","scope":"sync","message":"skipped transactions the owner deleted","count":1}
 ✓ app/api/v1/sync/route.test.ts > sync never writes back a transaction the owner deleted > T40a-S7: a tombstoned id arriving as added is skipped, its page-mate is inserted, and the sync completes 18ms
 ✓ app/api/v1/sync/route.test.ts > sync never writes back a transaction the owner deleted > T40a-S8: a row deleted through the real route does not return on modified, while a live row updates and keeps its owner category 13ms
 ✓ app/api/v1/sync/route.test.ts > sync never writes back a transaction the owner deleted > T40a-S9: modified for a tombstoned id writes nothing even when a row with that id exists 5ms
 ✓ app/api/v1/sync/route.test.ts > sync never writes back a transaction the owner deleted > T40a-S10: a tombstoned incoming id never claims a stored live row during re-identification 5ms
 ✓ app/api/v1/sync/route.test.ts > sync never writes back a transaction the owner deleted > T40a-S11: removed is a no-op for a tombstoned id and deletes a live row without tombstoning it 4ms
{"time":"2026-10-07T23:26:18.608Z","level":"info","scope":"sync","message":"re-identified transactions after item change","count":2}
{"time":"2026-10-07T23:26:18.610Z","level":"info","scope":"sync","message":"re-identified transactions after item change","count":2}
{"time":"2026-10-07T23:26:18.626Z","level":"warn","scope":"plaidReconcile","message":"could not confidently reconcile","unmatchedLive":[],"unmatchedDb":[{"id":"rc-p40e-acct-mix-null","name":"Fabricated RC Mixed A","mask":null},{"id":"rc-p40e-acct-mix-set","name":"Fabricated RC Mixed B","mask":null}]}
{"time":"2026-10-07T23:26:18.628Z","level":"warn","scope":"plaidReconcile","message":"could not confidently reconcile","unmatchedLive":[],"unmatchedDb":[{"id":"rc-p40e-acct-mix-set","name":"Fabricated RC Mixed B","mask":null},{"id":"rc-p40e-acct-mix-null","name":"Fabricated RC Mixed A","mask":null}]}
 ✓ app/api/v1/plaid/exchange-token/reissue-root-cause.test.ts > why reissued rows stayed orphaned > RC-01: a token change through exchange-token nulls the cursor, and the full re-delivery re-keys every row in place 33ms
 ✓ app/api/v1/plaid/exchange-token/reissue-root-cause.test.ts > why reissued rows stayed orphaned > RC-02: ids reissued on the SAME item never reach sync: an incremental delta leaves the old rows orphaned 8ms
 ✓ app/api/v1/plaid/exchange-token/reissue-root-cause.test.ts > why reissued rows stayed orphaned > RC-03: an item whose accounts disagree on the cursor syncs from no cursor, whichever account the table returns first 8ms

 Test Files  3 passed (3)
      Tests  26 passed (26)
   Start at  16:26:17
   Duration  1.08s (import 56%, tests 28%, transform 14%, setup 1%, worker 1%)
```

## Acceptance #6

```
$ git diff --stat 8df05e7 -- apps/web/app/api/v1/sync/route.test.ts apps/web/app/api/v1/sync/enrichment.test.ts apps/web/app/api/v1/plaid/exchange-token/reissue-root-cause.test.ts apps/web/lib/domain/txnMatch.ts apps/web/lib/domain/txnMatch.test.ts apps/web/vitest.integration.config.mts
exit 0 (no output above this line)
```

## Acceptance #7

```
$ /usr/bin/grep -c "export const key = (t: { accountId: string; date: string; amount: number; name: string | null }) =>" apps/web/lib/domain/txnMatch.ts
1
$ /usr/bin/grep -c "toFixed(2)}|\${(t.name ?? '').trim().toLowerCase()}" apps/web/lib/domain/txnMatch.ts
1
```

## Acceptance #8

```
$ (cd apps/web && npx vitest run lib/domain/txnMatch.test.ts)

 RUN  v5.0.3 /Users/andreianpilogov/Documents/b8/app/apps/web


 Test Files  1 passed (1)
      Tests  12 passed (12)
   Start at  16:26:19
   Duration  131ms (transform 57%, import 21%, tests 14%, worker 8%)
```

## Acceptance #9 — RED on base `sync.ts`, then restore

```
$ cp apps/web/lib/sync.ts $SCRATCH/sync.fixed.ts
$ git show 8df05e7:apps/web/lib/sync.ts > apps/web/lib/sync.ts
$ (cd apps/web && env -u PLAID_CLIENT_ID -u PLAID_SECRET npx vitest run --config vitest.integration.config.mts --reporter=verbose app/api/v1/sync/reid-across-pages.test.ts)

 RUN  v5.0.3 /Users/andreianpilogov/Documents/b8/app/apps/web

{"time":"2026-10-07T23:25:33.065Z","level":"info","scope":"sync","message":"re-identified transactions after item change","count":1}
{"time":"2026-10-07T23:25:33.070Z","level":"info","scope":"sync","message":"re-identified transactions after item change","count":1}
[reid-dump pg01] [{"id":152,"hidden":false,"note":"Fabricated P640f note 1","mapped_category":"Fabricated P640f Pick 1","rule_applied":false,"plaid_transaction_id":"p640f-new-2"},{"id":153,"hidden":true,"note":"Fabricated P640f note 2","mapped_category":"Fabricated P640f Pick 2","rule_applied":false,"plaid_transaction_id":"p640f-old-2"}]
[reid-dump pg01] re-identified log lines=2 total count=2
{"time":"2026-10-07T23:25:33.086Z","level":"info","scope":"sync","message":"re-identified transactions after item change","count":1}
{"time":"2026-10-07T23:25:33.089Z","level":"info","scope":"sync","message":"re-identified transactions after item change","count":1}
{"time":"2026-10-07T23:25:33.091Z","level":"info","scope":"sync","message":"re-identified transactions after item change","count":1}
{"time":"2026-10-07T23:25:33.100Z","level":"info","scope":"sync","message":"re-identified transactions after item change","count":1}
{"time":"2026-10-07T23:25:33.101Z","level":"info","scope":"sync","message":"re-identified transactions after item change","count":1}
{"time":"2026-10-07T23:25:33.108Z","level":"info","scope":"sync","message":"re-identified transactions after item change","count":1}
{"time":"2026-10-07T23:25:33.110Z","level":"info","scope":"sync","message":"re-identified transactions after item change","count":1}
{"time":"2026-10-07T23:25:33.111Z","level":"info","scope":"sync","message":"skipped transactions the owner deleted","count":1}
[reid-dump pg04] [{"id":166,"hidden":false,"note":"Fabricated P640f note 1","mapped_category":"Fabricated P640f Pick 1","rule_applied":false,"plaid_transaction_id":"p640f-new-3"},{"id":167,"hidden":true,"note":"Fabricated P640f note 2","mapped_category":"Fabricated P640f Pick 2","rule_applied":false,"plaid_transaction_id":"p640f-old-2"},{"id":168,"hidden":false,"note":"Fabricated P640f note 3","mapped_category":"Fabricated P640f Pick 3","rule_applied":false,"plaid_transaction_id":"p640f-old-3"}]
{"time":"2026-10-07T23:25:33.115Z","level":"info","scope":"sync","message":"re-identified transactions after item change","count":1}
{"time":"2026-10-07T23:25:33.116Z","level":"info","scope":"sync","message":"skipped transactions the owner deleted","count":1}
{"time":"2026-10-07T23:25:33.121Z","level":"info","scope":"sync","message":"re-identified transactions after item change","count":1}
{"time":"2026-10-07T23:25:33.122Z","level":"info","scope":"sync","message":"skipped transactions the owner deleted","count":1}
{"time":"2026-10-07T23:25:33.126Z","level":"info","scope":"sync","message":"re-identified transactions after item change","count":1}
{"time":"2026-10-07T23:25:33.131Z","level":"info","scope":"sync","message":"re-identified transactions after item change","count":1}
{"time":"2026-10-07T23:25:33.132Z","level":"info","scope":"sync","message":"re-identified transactions after item change","count":1}
 × app/api/v1/sync/reid-across-pages.test.ts > a sync walk re-identifies each stored row at most once, across pages > PG-01: two identical rows, their new ids one per page: each row takes its own id, once 47ms
   → expected [ [ 152, 'p640f-new-2' ], …(1) ] to deeply equal [ [ 152, 'p640f-new-1' ], …(1) ]
 × app/api/v1/sync/reid-across-pages.test.ts > a sync walk re-identifies each stored row at most once, across pages > PG-02: three identical rows, three pages: the k-th id goes to the k-th lowest primary key 17ms
   → expected [ [ 156, 'p640f-new-3' ], …(2) ] to deeply equal [ [ 156, 'p640f-new-1' ], …(2) ]
 × app/api/v1/sync/reid-across-pages.test.ts > a sync walk re-identifies each stored row at most once, across pages > PG-03: an empty page between the two ids neither resets what the walk remembers nor blocks the second claim 9ms
   → expected [ [ 162, 'p640f-new-2' ], …(1) ] to deeply equal [ [ 162, 'p640f-new-1' ], …(1) ]
 × app/api/v1/sync/reid-across-pages.test.ts > a sync walk re-identifies each stored row at most once, across pages > PG-04: a tombstoned id on the middle page claims nothing, is stored nowhere, and the last page takes the next row 8ms
   → expected [ [ 166, 'p640f-new-3' ], …(2) ] to deeply equal [ [ 166, 'p640f-new-1' ], …(2) ]
 ✓ app/api/v1/sync/reid-across-pages.test.ts > a sync walk re-identifies each stored row at most once, across pages > PG-04a: a tombstoned id on the page after a rename leaves the second row on its old id 6ms
 ✓ app/api/v1/sync/reid-across-pages.test.ts > a sync walk re-identifies each stored row at most once, across pages > PG-04b: a tombstoned id on the first page spends no claim, so the next page takes the lowest row 5ms
 ✓ app/api/v1/sync/reid-across-pages.test.ts > a sync walk re-identifies each stored row at most once, across pages > PG-05: one new id for two rows leaves the second on its old id, and an unrelated later row is inserted once 6ms
{"time":"2026-10-07T23:25:33.140Z","level":"info","scope":"sync","message":"re-identified transactions after item change","count":1}
{"time":"2026-10-07T23:25:33.144Z","level":"info","scope":"sync","message":"re-identified transactions after item change","count":1}
{"time":"2026-10-07T23:25:33.147Z","level":"info","scope":"sync","message":"re-identified transactions after item change","count":1}
{"time":"2026-10-07T23:25:33.151Z","level":"info","scope":"sync","message":"re-identified transactions after item change","count":2}
{"time":"2026-10-07T23:25:33.155Z","level":"info","scope":"sync","message":"re-identified transactions after item change","count":1}
{"time":"2026-10-07T23:25:33.159Z","level":"info","scope":"sync","message":"re-identified transactions after item change","count":1}
{"time":"2026-10-07T23:25:33.162Z","level":"info","scope":"sync","message":"re-identified transactions after item change","count":1}
 × app/api/v1/sync/reid-across-pages.test.ts > a sync walk re-identifies each stored row at most once, across pages > PG-06: modified for an id renamed on an earlier page refreshes that row and never inserts a third 9ms
   → expected [ [ 181, 'p640f-new-2' ], …(2) ] to deeply equal [ [ 181, 'p640f-new-1' ], …(1) ]
 × app/api/v1/sync/reid-across-pages.test.ts > a sync walk re-identifies each stored row at most once, across pages > PG-07: the same new id on two pages claims one row only, and is not counted again 5ms
   → expected 1 to be +0 // Object.is equality
 × app/api/v1/sync/reid-across-pages.test.ts > a sync walk re-identifies each stored row at most once, across pages > PG-08: two genuine identical transactions on two pages, no stored history, are both stored 3ms
   → expected [ 'p640f-c-2' ] to deeply equal [ 'p640f-c-1', 'p640f-c-2' ]
 × app/api/v1/sync/reid-across-pages.test.ts > a sync walk re-identifies each stored row at most once, across pages > PG-09: a row inserted by modified on page 1 is not renamed by a same-key added id on page 2 3ms
   → expected [ 'p640f-c-2' ] to deeply equal [ 'p640f-m-1', 'p640f-c-2' ]
 ✓ app/api/v1/sync/reid-across-pages.test.ts > a sync walk re-identifies each stored row at most once, across pages > PG-10: a single page carrying both new ids still pairs them in order (unchanged) 4ms
 ✓ app/api/v1/sync/reid-across-pages.test.ts > a sync walk re-identifies each stored row at most once, across pages > PG-12: an opposite-sign amount is a different transaction; only the same-key id claims the stored row 4ms
 × app/api/v1/sync/reid-across-pages.test.ts > a sync walk re-identifies each stored row at most once, across pages > PG-13: a walk from a stored cursor never re-identifies: a same-key new id is a second transaction 3ms
   → expected [ 'p640f-new-1' ] to deeply equal [ 'p640f-old-1', 'p640f-new-1' ]
 ✓ app/api/v1/sync/reid-across-pages.test.ts > a sync walk re-identifies each stored row at most once, across pages > PG-14: the same delivery from no cursor still re-identifies the stored row in place 3ms

⎯⎯⎯⎯⎯⎯⎯ Failed Tests 9 ⎯⎯⎯⎯⎯⎯⎯

 FAIL  app/api/v1/sync/reid-across-pages.test.ts > a sync walk re-identifies each stored row at most once, across pages > PG-01: two identical rows, their new ids one per page: each row takes its own id, once
AssertionError: expected [ [ 152, 'p640f-new-2' ], …(1) ] to deeply equal [ [ 152, 'p640f-new-1' ], …(1) ]

- Expected
+ Received

  [
    [
      152,
-     "p640f-new-1",
+     "p640f-new-2",
    ],
    [
      153,
-     "p640f-new-2",
+     "p640f-old-2",
    ],
  ]

 ❯ app/api/v1/sync/reid-across-pages.test.ts:207:62
    205|     console.log(`[reid-dump pg01] re-identified log lines=${reLines.le…
    206|
    207|     expect(after.map((r) => [r.id, r.plaid_transaction_id])).toEqual([…
       |                                                              ^
    208|     expect(after.map(owner)).toEqual(before.map(owner));
    209|     expect(result.synced).toBe(0);

⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯[1/9]⎯

 FAIL  app/api/v1/sync/reid-across-pages.test.ts > a sync walk re-identifies each stored row at most once, across pages > PG-02: three identical rows, three pages: the k-th id goes to the k-th lowest primary key
AssertionError: expected [ [ 156, 'p640f-new-3' ], …(2) ] to deeply equal [ [ 156, 'p640f-new-1' ], …(2) ]

- Expected
+ Received

  [
    [
      156,
-     "p640f-new-1",
+     "p640f-new-3",
    ],
    [
      157,
-     "p640f-new-2",
+     "p640f-old-2",
    ],
    [
      158,
-     "p640f-new-3",
+     "p640f-old-3",
    ],
  ]

 ❯ app/api/v1/sync/reid-across-pages.test.ts:221:62
    219|
    220|     const after = await rows();
    221|     expect(after.map((r) => [r.id, r.plaid_transaction_id])).toEqual([…
       |                                                              ^
    222|     expect(after.map(owner)).toEqual(before.map(owner));
    223|     expect(result.synced).toBe(0);

⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯[2/9]⎯

 FAIL  app/api/v1/sync/reid-across-pages.test.ts > a sync walk re-identifies each stored row at most once, across pages > PG-03: an empty page between the two ids neither resets what the walk remembers nor blocks the second claim
AssertionError: expected [ [ 162, 'p640f-new-2' ], …(1) ] to deeply equal [ [ 162, 'p640f-new-1' ], …(1) ]

- Expected
+ Received

  [
    [
      162,
-     "p640f-new-1",
+     "p640f-new-2",
    ],
    [
      163,
-     "p640f-new-2",
+     "p640f-old-2",
    ],
  ]

 ❯ app/api/v1/sync/reid-across-pages.test.ts:234:62
    232|
    233|     const after = await rows();
    234|     expect(after.map((r) => [r.id, r.plaid_transaction_id])).toEqual([…
       |                                                              ^
    235|     expect(after.map(owner)).toEqual(before.map(owner));
    236|     expect(result.synced).toBe(0);

⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯[3/9]⎯

 FAIL  app/api/v1/sync/reid-across-pages.test.ts > a sync walk re-identifies each stored row at most once, across pages > PG-04: a tombstoned id on the middle page claims nothing, is stored nowhere, and the last page takes the next row
AssertionError: expected [ [ 166, 'p640f-new-3' ], …(2) ] to deeply equal [ [ 166, 'p640f-new-1' ], …(2) ]

- Expected
+ Received

@@ -1,13 +1,13 @@
  [
    [
      166,
-     "p640f-new-1",
+     "p640f-new-3",
    ],
    [
      167,
-     "p640f-new-3",
+     "p640f-old-2",
    ],
    [
      168,
      "p640f-old-3",
    ],

 ❯ app/api/v1/sync/reid-across-pages.test.ts:251:62
    249|     const after = await rows();
    250|     console.log(`[reid-dump pg04] ${JSON.stringify(after.map((r) => ({…
    251|     expect(after.map((r) => [r.id, r.plaid_transaction_id])).toEqual([…
       |                                                              ^
    252|     expect(after.map(owner)).toEqual(before.map(owner));
    253|     const carrying = await db.query('SELECT 1 FROM transactions WHERE …

⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯[4/9]⎯

 FAIL  app/api/v1/sync/reid-across-pages.test.ts > a sync walk re-identifies each stored row at most once, across pages > PG-06: modified for an id renamed on an earlier page refreshes that row and never inserts a third
AssertionError: expected [ [ 181, 'p640f-new-2' ], …(2) ] to deeply equal [ [ 181, 'p640f-new-1' ], …(1) ]

- Expected
+ Received

  [
    [
      181,
-     "p640f-new-1",
+     "p640f-new-2",
    ],
    [
      182,
-     "p640f-new-2",
+     "p640f-old-2",
+   ],
+   [
+     185,
+     "p640f-new-1",
    ],
  ]

 ❯ app/api/v1/sync/reid-across-pages.test.ts:318:62
    316|
    317|     const after = await rows();
    318|     expect(after.map((r) => [r.id, r.plaid_transaction_id])).toEqual([…
       |                                                              ^
    319|     expect(after[0].merchant_name).toBe(revised);
    320|     expect(after.map(owner)).toEqual(before.map(owner));

⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯[5/9]⎯

 FAIL  app/api/v1/sync/reid-across-pages.test.ts > a sync walk re-identifies each stored row at most once, across pages > PG-07: the same new id on two pages claims one row only, and is not counted again
AssertionError: expected 1 to be +0 // Object.is equality

- Expected
+ Received

- 0
+ 1

 ❯ app/api/v1/sync/reid-across-pages.test.ts:334:27
    332|     expect(after.map((r) => [r.id, r.plaid_transaction_id])).toEqual([…
    333|     expect(after.map(owner)).toEqual(before.map(owner));
    334|     expect(result.synced).toBe(0);
       |                           ^
    335|   });
    336|

⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯[6/9]⎯

 FAIL  app/api/v1/sync/reid-across-pages.test.ts > a sync walk re-identifies each stored row at most once, across pages > PG-08: two genuine identical transactions on two pages, no stored history, are both stored
AssertionError: expected [ 'p640f-c-2' ] to deeply equal [ 'p640f-c-1', 'p640f-c-2' ]

- Expected
+ Received

  [
-   "p640f-c-1",
    "p640f-c-2",
  ]

 ❯ app/api/v1/sync/reid-across-pages.test.ts:342:63
    340|     const result = await sync(cursors);
    341|
    342|     expect((await rows()).map((r) => r.plaid_transaction_id)).toEqual(…
       |                                                               ^
    343|     expect(result.synced).toBe(2);
    344|   });

⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯[7/9]⎯

 FAIL  app/api/v1/sync/reid-across-pages.test.ts > a sync walk re-identifies each stored row at most once, across pages > PG-09: a row inserted by modified on page 1 is not renamed by a same-key added id on page 2
AssertionError: expected [ 'p640f-c-2' ] to deeply equal [ 'p640f-m-1', 'p640f-c-2' ]

- Expected
+ Received

  [
-   "p640f-m-1",
    "p640f-c-2",
  ]

 ❯ app/api/v1/sync/reid-across-pages.test.ts:351:63
    349|     const result = await sync(cursors);
    350|
    351|     expect((await rows()).map((r) => r.plaid_transaction_id)).toEqual(…
       |                                                               ^
    352|     // Only the `added` insert counts; `modified` has never been count…
    353|     expect(result.synced).toBe(1);

⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯[8/9]⎯

 FAIL  app/api/v1/sync/reid-across-pages.test.ts > a sync walk re-identifies each stored row at most once, across pages > PG-13: a walk from a stored cursor never re-identifies: a same-key new id is a second transaction
AssertionError: expected [ 'p640f-new-1' ] to deeply equal [ 'p640f-old-1', 'p640f-new-1' ]

- Expected
+ Received

  [
-   "p640f-old-1",
    "p640f-new-1",
  ]

 ❯ app/api/v1/sync/reid-across-pages.test.ts:391:54
    389|
    390|     const after = await rows();
    391|     expect(after.map((x) => x.plaid_transaction_id)).toEqual([oldId(1)…
       |                                                      ^
    392|     expect(owner(after[0])).toEqual(owner(before[0]));
    393|     expect(after[0].id).toBe(r);

⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯[9/9]⎯


 Test Files  1 failed (1)
      Tests  9 failed | 6 passed (15)
   Start at  16:25:32
   Duration  437ms (tests 43%, import 35%, transform 20%, setup 2%, worker 1%)
$ cp $SCRATCH/sync.fixed.ts apps/web/lib/sync.ts
$ cmp $SCRATCH/sync.fixed.ts apps/web/lib/sync.ts; echo "cmp exit $?"
cmp exit 0
```

The GREEN run after the restore is acceptance #3 above (run after the restore and the mutation probes).

## Acceptance #10

```
$ (cd apps/web && env -u PLAID_CLIENT_ID -u PLAID_SECRET npx vitest run --config vitest.integration.config.mts --reporter=verbose app/api/v1/sync/reid-across-pages.test.ts 2>&1 | grep -c 'Tests .*failed')
0
```

## Acceptance #11

```
$ npm test

> b8@0.1.0 test
> npm run test -w @b8/web


> @b8/web@0.1.0 test
> vitest run


 RUN  v5.0.3 /Users/andreianpilogov/Documents/b8/app/apps/web

(node:37935) ExperimentalWarning: The supports Web Crypto API method is an experimental feature and might change at any time
(Use `node --trace-warnings ...` to show where the warning was created)
(node:37935) ExperimentalWarning: The ML-DSA-44 Web Crypto API algorithm is an experimental feature and might change at any time

 Test Files  72 passed (72)
      Tests  1112 passed (1112)
   Start at  16:26:40
   Duration  5.67s (tests 58%, import 23%, transform 16%, worker 3%)

    Isolate  72 workers spawned · ~145ms startup each (spawn + environment, per file)
             at least ~1.35s faster with isolate: false — reuses workers across files instead of one per file
```

## Acceptance #12

```
$ git diff --stat 8df05e7 -- . ':!apps/web/lib/sync.ts' ':!apps/web/app/api/v1/sync/reid-across-pages.test.ts' ':!plan'
exit 0 (no output above this line)
```


---

# Cycle 2 — REVIEW-2 nits N1, N2, N3

Same conditions as cycle 1: scratch database `b8_p640f`, Plaid env vars unset, outputs verbatim, all
values fabricated `p640f-` sentinels, nothing committed. Where this section and the cycle 1 or cycle 0
sections differ, this section is current. The `PG-` count is now **24**: cycle 1's 22, plus PG-15e
and PG-16c.

## Summary

| # | Result |
|---|---|
| 1 | `tsc --noEmit` exit 0 |
| 2 | `eslint` exit 0, no warnings |
| 3 | `Tests  24 passed (24)`; 24 lines match `PG-` |
| 4 | `24` |
| 5 | `Tests  26 passed (26)`, the three files unmodified |
| 6 | prints nothing |
| 7 | `1` and `1` (`/usr/bin/grep`) |
| 8 | `Tests  12 passed (12)` |
| 9 | the new file against base `8df05e7`: 16 fail, 8 pass — list below |
| 10 | `0` |
| 11 | `Test Files  72 passed (72)`, `Tests  1112 passed (1112)` |
| 12 | prints nothing |
| cycle-2 probe | against the cycle-1 `sync.ts`: PG-15e, PG-16, PG-16b and PG-16c fail; everything else passes |

## What changed (`apps/web/lib/sync.ts`)

- **N1.** In the stored-cursor pre-pass, an `added` id that also appears anywhere in the walk's
  `removed` list is not a claimant. In a double reissue in one walk (old-1 to new-1, then new-1 to
  new-2), the owner's row now goes to new-2, the id Plaid ends on. Before, new-1 took the row and new-1's
  own removal then deleted it, owner fields and all.
- **N1, counting.** An id whose last event in the walk is a removal (Plaid's net view; within a page
  the order is added, then modified, then removed, as the loops apply them) is not counted in
  `synced`. Without this, PG-15e's `new-1` is inserted on page 1 and deleted on page 2, yet still
  counted, so `synced` would be 1.
- **N2.** A walk from no cursor that ends with the cursor held (`NOT_READY` or
  `INITIAL_UPDATE_COMPLETE`) logs exactly one line, `cursor held until Plaid reports history
  complete`, with a single field, `status`. It carries no id, token or account name.
- **N3, and a counting change it required (flagged for the reviewer).** PG-16c's required `synced 0`
  on run 2 failed at first (`expected 1 to be +0`). Run 2 re-delivers `new-1`, which is already
  stored under that id from run 1. The `added` upsert takes its DO UPDATE branch, and `rowCount` is 1
  for an update as well as for an insert, so the refresh was counted as a new transaction. This
  counting predates the task: on base, any walk from no cursor counted every re-delivered row that
  was already stored under its own id. With the held phase, it would report the same history as new
  on every nightly re-walk. The `added` upsert now ends `RETURNING (xmax = 0) AS inserted`, and only a
  true insert is counted. This makes the code match the spec's own Counting convention ("`synced`
  counts rows newly INSERTED to the ledger"). It does touch the original spec's "`added` counter
  semantics" non-goal, so I am naming it here and not leaving it implicit. The tombstone guard, the
  column list and the DO UPDATE clause are unchanged. Only the RETURNING clause was added. #5's 26
  tests pass unmodified.
- Nothing else changed. The matcher, schema and shared types are unchanged, and there is no persisted
  flag.

## Tests added or extended (`reid-across-pages.test.ts`)

- **PG-15e (new).** Stored cursor, one stored row R. Page 1: added [new-1], removed [old-1]. Page 2:
  added [new-2] (same key), removed [new-1]. Asserts exactly 1 row, R's primary key, id new-2, all
  seven owner fields as seeded, and `synced` 0. **Guard in the same test:** the same page 1, then a
  page 2 with only removed [new-1]. R is deleted (0 rows, Plaid's net view) and `synced` is 0.
- **PG-16c (new).** No cursor, rows R1 < R2. Run 1 delivers added [new-1] with
  `INITIAL_UPDATE_COMPLETE`. It asserts R1 renamed to new-1, R2 still on old-2, all owner fields
  intact, `synced` 0, and the cursor NULL. Run 2, again from no cursor, delivers [new-1, new-2] with
  `HISTORICAL_UPDATE_COMPLETE`. It asserts R1 carries new-1, R2 carries new-2, exactly 2 rows, owner
  fields intact, `synced` 0, and the cursor stored.
- **PG-16 and PG-16b (extended, N2).** Each held run asserts exactly one held line, whose keys are
  `level, message, scope, status, time` and whose `status` is `INITIAL_UPDATE_COMPLETE` or
  `NOT_READY` respectively.

## RED/GREEN against the cycle-1 `sync.ts`, and notes on the predictions

- PG-15e is RED on cycle-1: the row ends under a new primary key, so the owner fields were lost.
- PG-16 and PG-16b are RED on cycle-1, on the held-line assertion: `expected [] to have a length of 1`.
- **PG-16c is RED on cycle-1, not a passing guard.** The rename and the held cursor already worked in
  cycle 1. It fails only on run 2's `synced` (`expected 1 to be +0`), which is the counting issue
  described under N3.
- **PG-15e passes on base `8df05e7`.** Base re-identifies on every page, regardless of cursor, so page
  2's new-2 re-claims the row page 1 had renamed to new-1. That is H-g, and here it happens to give
  the right answer, and the removal of new-1 then finds nothing. PG-15e is RED against the cycle-1
  diff, which is the code it guards.

```
== c2-probe-cycle1
 ✓	PG-01  ✓	PG-02  ✓	PG-03  ✓	PG-04  ✓	PG-04a  ✓	PG-04b  ✓	PG-05  ✓	PG-06  ✓	PG-07  ✓	PG-08  ✓	PG-09  ✓	PG-10  ✓	PG-12  ✓	PG-13  ✓	PG-14  ✓	PG-15  ✓	PG-15b  ✓	PG-15c  ✓	PG-15d  ×	PG-15e  ×	PG-16  ×	PG-16b  ×	PG-16c  ✓	PG-17 
⎯⎯⎯⎯⎯⎯⎯ Failed Tests 4 ⎯⎯⎯⎯⎯⎯⎯
      Tests  4 failed | 20 passed (24)
PG-15e	   → expected [ [ 3645, 'p640f-new-2' ] ] to deeply equal [ [ 3643, 'p640f-new-2' ] ]
PG-16	   → expected [] to have a length of 1 but got +0
PG-16b	   → expected [] to have a length of 1 but got +0
PG-16c	   → expected 1 to be +0 // Object.is equality
== c2-probe-base
 ×	PG-01  ×	PG-02  ×	PG-03  ×	PG-04  ✓	PG-04a  ✓	PG-04b  ✓	PG-05  ×	PG-06  ×	PG-07  ×	PG-08  ×	PG-09  ✓	PG-10  ✓	PG-12  ×	PG-13  ✓	PG-14  ✓	PG-15  ×	PG-15b  ×	PG-15c  ×	PG-15d  ✓	PG-15e  ×	PG-16  ×	PG-16b  ×	PG-16c  ×	PG-17 
⎯⎯⎯⎯⎯⎯ Failed Tests 16 ⎯⎯⎯⎯⎯⎯⎯
      Tests  16 failed | 8 passed (24)
PG-01	   → expected [ [ 3656, 'p640f-new-2' ], …(1) ] to deeply equal [ [ 3656, 'p640f-new-1' ], …(1) ]
PG-02	   → expected [ [ 3660, 'p640f-new-3' ], …(2) ] to deeply equal [ [ 3660, 'p640f-new-1' ], …(2) ]
PG-03	   → expected [ [ 3666, 'p640f-new-2' ], …(1) ] to deeply equal [ [ 3666, 'p640f-new-1' ], …(1) ]
PG-04	   → expected [ [ 3670, 'p640f-new-3' ], …(2) ] to deeply equal [ [ 3670, 'p640f-new-1' ], …(2) ]
PG-06	   → expected [ [ 3685, 'p640f-new-2' ], …(2) ] to deeply equal [ [ 3685, 'p640f-new-1' ], …(1) ]
PG-07	   → expected 1 to be +0 // Object.is equality
PG-08	   → expected [ 'p640f-c-2' ] to deeply equal [ 'p640f-c-1', 'p640f-c-2' ]
PG-09	   → expected [ 'p640f-c-2' ] to deeply equal [ 'p640f-m-1', 'p640f-c-2' ]
PG-13	   → expected [ 'p640f-new-1' ] to deeply equal [ 'p640f-old-1', 'p640f-new-1' ]
PG-15b	   → expected [ [ 3714, 'p640f-new-1' ] ] to deeply equal [ [ 3713, 'p640f-new-1' ] ]
PG-15c	   → expected [ 'p640f-new-1', 'p640f-new-9' ] to deeply equal [ 'p640f-new-1', 'p640f-old-2', …(1) ]
PG-15d	   → expected [ 'p640f-new-1' ] to deeply equal [ 'p640f-old-1', 'p640f-new-1' ]
PG-16	   → expected [] to have a length of 1 but got +0
PG-16b	   → expected [] to have a length of 1 but got +0
PG-16c	   → expected 'p640f-r1-next-1' to be null
PG-17	   → expected [ 'p640f-new-2' ] to deeply equal [ 'p640f-new-1', 'p640f-new-2' ]
```

Swaps, each restored:

```
$ cp apps/web/lib/sync.ts $SCRATCH/sync.cycle2.ts       # cycle-1 file saved earlier as $SCRATCH/sync.cycle1.ts
$ cp $SCRATCH/sync.cycle1.ts apps/web/lib/sync.ts && (cd apps/web && env -u PLAID_CLIENT_ID -u PLAID_SECRET npx vitest run --config vitest.integration.config.mts --reporter=verbose app/api/v1/sync/reid-across-pages.test.ts)
$ cp $SCRATCH/sync.cycle2.ts apps/web/lib/sync.ts && cmp $SCRATCH/sync.cycle2.ts apps/web/lib/sync.ts; echo "cmp exit $?"
cmp exit 0
$ git show 8df05e7:apps/web/lib/sync.ts > apps/web/lib/sync.ts && (cd apps/web && env -u PLAID_CLIENT_ID -u PLAID_SECRET npx vitest run --config vitest.integration.config.mts --reporter=verbose app/api/v1/sync/reid-across-pages.test.ts)
$ cp $SCRATCH/sync.cycle2.ts apps/web/lib/sync.ts && cmp $SCRATCH/sync.cycle2.ts apps/web/lib/sync.ts; echo "cmp exit $?"
cmp exit 0
```

Full verbose output of the cycle-1 probe:

```

 RUN  v5.0.3 /Users/andreianpilogov/Documents/b8/app/apps/web

{"time":"2026-10-08T03:05:57.715Z","level":"info","scope":"sync","message":"re-identified transactions after item change","count":1}
{"time":"2026-10-08T03:05:57.719Z","level":"info","scope":"sync","message":"re-identified transactions after item change","count":1}
[reid-dump pg01] [{"id":3573,"hidden":false,"note":"Fabricated P640f note 1","mapped_category":"Fabricated P640f Pick 1","rule_applied":false,"watched_at":"2026-03-01 02:00:00-08","transfer_group_id":145,"property_id":145,"plaid_transaction_id":"p640f-new-1"},{"id":3574,"hidden":true,"note":"Fabricated P640f note 2","mapped_category":"Fabricated P640f Pick 2","rule_applied":false,"watched_at":"2026-03-02 02:00:00-08","transfer_group_id":146,"property_id":146,"plaid_transaction_id":"p640f-new-2"}]
[reid-dump pg01] re-identified log lines=2 total count=2
{"time":"2026-10-08T03:05:57.732Z","level":"info","scope":"sync","message":"re-identified transactions after item change","count":1}
{"time":"2026-10-08T03:05:57.733Z","level":"info","scope":"sync","message":"re-identified transactions after item change","count":1}
{"time":"2026-10-08T03:05:57.735Z","level":"info","scope":"sync","message":"re-identified transactions after item change","count":1}
{"time":"2026-10-08T03:05:57.743Z","level":"info","scope":"sync","message":"re-identified transactions after item change","count":1}
{"time":"2026-10-08T03:05:57.745Z","level":"info","scope":"sync","message":"re-identified transactions after item change","count":1}
{"time":"2026-10-08T03:05:57.753Z","level":"info","scope":"sync","message":"re-identified transactions after item change","count":1}
{"time":"2026-10-08T03:05:57.755Z","level":"info","scope":"sync","message":"re-identified transactions after item change","count":1}
{"time":"2026-10-08T03:05:57.756Z","level":"info","scope":"sync","message":"skipped transactions the owner deleted","count":1}
[reid-dump pg04] [{"id":3587,"hidden":false,"note":"Fabricated P640f note 1","mapped_category":"Fabricated P640f Pick 1","rule_applied":false,"watched_at":"2026-03-01 02:00:00-08","transfer_group_id":145,"property_id":145,"plaid_transaction_id":"p640f-new-1"},{"id":3588,"hidden":true,"note":"Fabricated P640f note 2","mapped_category":"Fabricated P640f Pick 2","rule_applied":false,"watched_at":"2026-03-02 02:00:00-08","transfer_group_id":146,"property_id":146,"plaid_transaction_id":"p640f-new-3"},{"id":3589,"hidden":false,"note":"Fabricated P640f note 3","mapped_category":"Fabricated P640f Pick 3","rule_applied":false,"watched_at":"2026-03-03 02:00:00-08","transfer_group_id":147,"property_id":147,"plaid_transaction_id":"p640f-old-3"}]
{"time":"2026-10-08T03:05:57.761Z","level":"info","scope":"sync","message":"re-identified transactions after item change","count":1}
{"time":"2026-10-08T03:05:57.763Z","level":"info","scope":"sync","message":"skipped transactions the owner deleted","count":1}
{"time":"2026-10-08T03:05:57.767Z","level":"info","scope":"sync","message":"re-identified transactions after item change","count":1}
{"time":"2026-10-08T03:05:57.768Z","level":"info","scope":"sync","message":"skipped transactions the owner deleted","count":1}
{"time":"2026-10-08T03:05:57.772Z","level":"info","scope":"sync","message":"re-identified transactions after item change","count":1}
{"time":"2026-10-08T03:05:57.777Z","level":"info","scope":"sync","message":"re-identified transactions after item change","count":1}
{"time":"2026-10-08T03:05:57.778Z","level":"info","scope":"sync","message":"re-identified transactions after item change","count":1}
{"time":"2026-10-08T03:05:57.782Z","level":"info","scope":"sync","message":"re-identified transactions after item change","count":1}
 ✓ app/api/v1/sync/reid-across-pages.test.ts > a sync walk re-identifies each stored row at most once, across pages > PG-01: two identical rows, their new ids one per page: each row takes its own id, once 25ms
 ✓ app/api/v1/sync/reid-across-pages.test.ts > a sync walk re-identifies each stored row at most once, across pages > PG-02: three identical rows, three pages: the k-th id goes to the k-th lowest primary key 15ms
 ✓ app/api/v1/sync/reid-across-pages.test.ts > a sync walk re-identifies each stored row at most once, across pages > PG-03: an empty page between the two ids neither resets what the walk remembers nor blocks the second claim 10ms
 ✓ app/api/v1/sync/reid-across-pages.test.ts > a sync walk re-identifies each stored row at most once, across pages > PG-04: a tombstoned id on the middle page claims nothing, is stored nowhere, and the last page takes the next row 10ms
 ✓ app/api/v1/sync/reid-across-pages.test.ts > a sync walk re-identifies each stored row at most once, across pages > PG-04a: a tombstoned id on the page after a rename leaves the second row on its old id 6ms
 ✓ app/api/v1/sync/reid-across-pages.test.ts > a sync walk re-identifies each stored row at most once, across pages > PG-04b: a tombstoned id on the first page spends no claim, so the next page takes the lowest row 5ms
 ✓ app/api/v1/sync/reid-across-pages.test.ts > a sync walk re-identifies each stored row at most once, across pages > PG-05: one new id for two rows leaves the second on its old id, and an unrelated later row is inserted once 5ms
 ✓ app/api/v1/sync/reid-across-pages.test.ts > a sync walk re-identifies each stored row at most once, across pages > PG-06: modified for an id renamed on an earlier page refreshes that row and never inserts a third 5ms
 ✓ app/api/v1/sync/reid-across-pages.test.ts > a sync walk re-identifies each stored row at most once, across pages > PG-07: the same new id on two pages claims one row only, and is not counted again 4ms
{"time":"2026-10-08T03:05:57.793Z","level":"info","scope":"sync","message":"re-identified transactions after item change","count":2}
{"time":"2026-10-08T03:05:57.797Z","level":"info","scope":"sync","message":"re-identified transactions after item change","count":1}
{"time":"2026-10-08T03:05:57.803Z","level":"info","scope":"sync","message":"re-identified transactions after item change","count":1}
{"time":"2026-10-08T03:05:57.806Z","level":"info","scope":"sync","message":"re-identified transactions after item change","count":1}
{"time":"2026-10-08T03:05:57.810Z","level":"info","scope":"sync","message":"re-identified transactions after item change","count":1}
{"time":"2026-10-08T03:05:57.813Z","level":"info","scope":"sync","message":"re-identified transactions after item change","count":1}
{"time":"2026-10-08T03:05:57.817Z","level":"info","scope":"sync","message":"re-identified transactions after item change","count":1}
{"time":"2026-10-08T03:05:57.820Z","level":"info","scope":"sync","message":"re-identified transactions after item change","count":1}
{"time":"2026-10-08T03:05:57.826Z","level":"info","scope":"sync","message":"re-identified transactions after item change","count":1}
{"time":"2026-10-08T03:05:57.840Z","level":"info","scope":"sync","message":"re-identified transactions after item change","count":1}
{"time":"2026-10-08T03:05:57.842Z","level":"info","scope":"sync","message":"re-identified transactions after item change","count":1}
{"time":"2026-10-08T03:05:57.845Z","level":"info","scope":"sync","message":"re-identified transactions after item change","count":1}
{"time":"2026-10-08T03:05:57.847Z","level":"info","scope":"sync","message":"transactions update status unknown; cursor stored as usual"}
 ✓ app/api/v1/sync/reid-across-pages.test.ts > a sync walk re-identifies each stored row at most once, across pages > PG-08: two genuine identical transactions on two pages, no stored history, are both stored 3ms
 ✓ app/api/v1/sync/reid-across-pages.test.ts > a sync walk re-identifies each stored row at most once, across pages > PG-09: a row inserted by modified on page 1 is not renamed by a same-key added id on page 2 3ms
 ✓ app/api/v1/sync/reid-across-pages.test.ts > a sync walk re-identifies each stored row at most once, across pages > PG-10: a single page carrying both new ids still pairs them in order (unchanged) 4ms
 ✓ app/api/v1/sync/reid-across-pages.test.ts > a sync walk re-identifies each stored row at most once, across pages > PG-12: an opposite-sign amount is a different transaction; only the same-key id claims the stored row 4ms
 ✓ app/api/v1/sync/reid-across-pages.test.ts > a sync walk re-identifies each stored row at most once, across pages > PG-13: a stored-cursor walk with no removed licence never re-identifies: a same-key new id is a second transaction 3ms
 ✓ app/api/v1/sync/reid-across-pages.test.ts > a sync walk re-identifies each stored row at most once, across pages > PG-14: the same delivery from no cursor still re-identifies the stored row in place 3ms
 ✓ app/api/v1/sync/reid-across-pages.test.ts > a sync walk re-identifies each stored row at most once, across pages > PG-15: a stored-cursor walk that retires the old id renames the row in place instead of deleting it 4ms
 ✓ app/api/v1/sync/reid-across-pages.test.ts > a sync walk re-identifies each stored row at most once, across pages > PG-15b: the licence works across pages in either order (added then removed, removed then added) 7ms
 ✓ app/api/v1/sync/reid-across-pages.test.ts > a sync walk re-identifies each stored row at most once, across pages > PG-15c: only the retired row is claimable, and once: a same-key second new id is inserted, a repeated one claims nothing 7ms
 ✓ app/api/v1/sync/reid-across-pages.test.ts > a sync walk re-identifies each stored row at most once, across pages > PG-15d: a removed id of a different key licenses nothing: the new id is inserted and the retired row deleted 3ms
 × app/api/v1/sync/reid-across-pages.test.ts > a sync walk re-identifies each stored row at most once, across pages > PG-15e: a claimant Plaid retires later in the walk takes nothing; the row goes to the id Plaid ends on 8ms
   → expected [ [ 3645, 'p640f-new-2' ] ] to deeply equal [ [ 3643, 'p640f-new-2' ] ]
 × app/api/v1/sync/reid-across-pages.test.ts > a sync walk re-identifies each stored row at most once, across pages > PG-16: a re-auth walk ending on INITIAL_UPDATE_COMPLETE keeps the cursor NULL, so the historical pull re-identifies 3ms
   → expected [] to have a length of 1 but got +0
 × app/api/v1/sync/reid-across-pages.test.ts > a sync walk re-identifies each stored row at most once, across pages > PG-16b: a NOT_READY walk answering with an empty cursor leaves no usable cursor, and the next walk re-identifies 3ms
   → expected [] to have a length of 1 but got +0
 × app/api/v1/sync/reid-across-pages.test.ts > a sync walk re-identifies each stored row at most once, across pages > PG-16c: rows a held-cursor walk writes are real writes: renamed in place, then joined by the historical pull 6ms
   → expected 1 to be +0 // Object.is equality
 ✓ app/api/v1/sync/reid-across-pages.test.ts > a sync walk re-identifies each stored row at most once, across pages > PG-17: after HISTORICAL_UPDATE_COMPLETE the next walk is incremental, and a same-key second purchase is inserted 4ms

⎯⎯⎯⎯⎯⎯⎯ Failed Tests 4 ⎯⎯⎯⎯⎯⎯⎯

 FAIL  app/api/v1/sync/reid-across-pages.test.ts > a sync walk re-identifies each stored row at most once, across pages > PG-15e: a claimant Plaid retires later in the walk takes nothing; the row goes to the id Plaid ends on
AssertionError: expected [ [ 3645, 'p640f-new-2' ] ] to deeply equal [ [ 3643, 'p640f-new-2' ] ]

- Expected
+ Received

  [
    [
-     3643,
+     3645,
      "p640f-new-2",
    ],
  ]

 ❯ app/api/v1/sync/reid-across-pages.test.ts:573:62
    571|
    572|     const after = await rows();
    573|     expect(after.map((x) => [x.id, x.plaid_transaction_id])).toEqual([…
       |                                                              ^
    574|     expect(after.map(owner)).toEqual(before.map(owner));
    575|     expect(result.synced).toBe(0);

⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯[1/4]⎯

 FAIL  app/api/v1/sync/reid-across-pages.test.ts > a sync walk re-identifies each stored row at most once, across pages > PG-16: a re-auth walk ending on INITIAL_UPDATE_COMPLETE keeps the cursor NULL, so the historical pull re-identifies
AssertionError: expected [] to have a length of 1 but got +0

- Expected
+ Received

- 1
+ 0

 ❯ expectOneHeldLine app/api/v1/sync/reid-across-pages.test.ts:216:16
    214| function expectOneHeldLine(lines: Record<string, unknown>[], status: s…
    215|   const held = lines.filter((l) => l.message === HELD);
    216|   expect(held).toHaveLength(1);
       |                ^
    217|   expect(Object.keys(held[0]).sort()).toEqual(['level', 'message', 'sc…
    218|   expect(held[0].status).toBe(status);
 ❯ app/api/v1/sync/reid-across-pages.test.ts:597:5

⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯[2/4]⎯

 FAIL  app/api/v1/sync/reid-across-pages.test.ts > a sync walk re-identifies each stored row at most once, across pages > PG-16b: a NOT_READY walk answering with an empty cursor leaves no usable cursor, and the next walk re-identifies
AssertionError: expected [] to have a length of 1 but got +0

- Expected
+ Received

- 1
+ 0

 ❯ expectOneHeldLine app/api/v1/sync/reid-across-pages.test.ts:216:16
    214| function expectOneHeldLine(lines: Record<string, unknown>[], status: s…
    215|   const held = lines.filter((l) => l.message === HELD);
    216|   expect(held).toHaveLength(1);
       |                ^
    217|   expect(Object.keys(held[0]).sort()).toEqual(['level', 'message', 'sc…
    218|   expect(held[0].status).toBe(status);
 ❯ app/api/v1/sync/reid-across-pages.test.ts:616:5

⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯[3/4]⎯

 FAIL  app/api/v1/sync/reid-across-pages.test.ts > a sync walk re-identifies each stored row at most once, across pages > PG-16c: rows a held-cursor walk writes are real writes: renamed in place, then joined by the historical pull
AssertionError: expected 1 to be +0 // Object.is equality

- Expected
+ Received

- 0
+ 1

 ❯ app/api/v1/sync/reid-across-pages.test.ts:661:27
    659|     expect(after.map((x) => [x.id, x.plaid_transaction_id])).toEqual([…
    660|     expect(after.map(owner)).toEqual(before.map(owner));
    661|     expect(second.synced).toBe(0);
       |                           ^
    662|     expect(await storedCursor()).toBe(`${P}-r2-next-1`);
    663|   });

⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯[4/4]⎯


 Test Files  1 failed (1)
      Tests  4 failed | 20 passed (24)
   Start at  20:05:57
   Duration  453ms (tests 48%, import 30%, transform 20%, setup 1%)
```

Full verbose output of the base probe:

```

 RUN  v5.0.3 /Users/andreianpilogov/Documents/b8/app/apps/web

{"time":"2026-10-08T03:05:58.653Z","level":"info","scope":"sync","message":"re-identified transactions after item change","count":1}
{"time":"2026-10-08T03:05:58.655Z","level":"info","scope":"sync","message":"re-identified transactions after item change","count":1}
[reid-dump pg01] [{"id":3656,"hidden":false,"note":"Fabricated P640f note 1","mapped_category":"Fabricated P640f Pick 1","rule_applied":false,"watched_at":"2026-03-01 02:00:00-08","transfer_group_id":149,"property_id":149,"plaid_transaction_id":"p640f-new-2"},{"id":3657,"hidden":true,"note":"Fabricated P640f note 2","mapped_category":"Fabricated P640f Pick 2","rule_applied":false,"watched_at":"2026-03-02 02:00:00-08","transfer_group_id":150,"property_id":150,"plaid_transaction_id":"p640f-old-2"}]
[reid-dump pg01] re-identified log lines=2 total count=2
{"time":"2026-10-08T03:05:58.670Z","level":"info","scope":"sync","message":"re-identified transactions after item change","count":1}
{"time":"2026-10-08T03:05:58.671Z","level":"info","scope":"sync","message":"re-identified transactions after item change","count":1}
{"time":"2026-10-08T03:05:58.672Z","level":"info","scope":"sync","message":"re-identified transactions after item change","count":1}
{"time":"2026-10-08T03:05:58.680Z","level":"info","scope":"sync","message":"re-identified transactions after item change","count":1}
{"time":"2026-10-08T03:05:58.681Z","level":"info","scope":"sync","message":"re-identified transactions after item change","count":1}
{"time":"2026-10-08T03:05:58.687Z","level":"info","scope":"sync","message":"re-identified transactions after item change","count":1}
{"time":"2026-10-08T03:05:58.689Z","level":"info","scope":"sync","message":"re-identified transactions after item change","count":1}
{"time":"2026-10-08T03:05:58.689Z","level":"info","scope":"sync","message":"skipped transactions the owner deleted","count":1}
[reid-dump pg04] [{"id":3670,"hidden":false,"note":"Fabricated P640f note 1","mapped_category":"Fabricated P640f Pick 1","rule_applied":false,"watched_at":"2026-03-01 02:00:00-08","transfer_group_id":149,"property_id":149,"plaid_transaction_id":"p640f-new-3"},{"id":3671,"hidden":true,"note":"Fabricated P640f note 2","mapped_category":"Fabricated P640f Pick 2","rule_applied":false,"watched_at":"2026-03-02 02:00:00-08","transfer_group_id":150,"property_id":150,"plaid_transaction_id":"p640f-old-2"},{"id":3672,"hidden":false,"note":"Fabricated P640f note 3","mapped_category":"Fabricated P640f Pick 3","rule_applied":false,"watched_at":"2026-03-03 02:00:00-08","transfer_group_id":151,"property_id":151,"plaid_transaction_id":"p640f-old-3"}]
{"time":"2026-10-08T03:05:58.694Z","level":"info","scope":"sync","message":"re-identified transactions after item change","count":1}
{"time":"2026-10-08T03:05:58.695Z","level":"info","scope":"sync","message":"skipped transactions the owner deleted","count":1}
{"time":"2026-10-08T03:05:58.700Z","level":"info","scope":"sync","message":"re-identified transactions after item change","count":1}
{"time":"2026-10-08T03:05:58.701Z","level":"info","scope":"sync","message":"skipped transactions the owner deleted","count":1}
{"time":"2026-10-08T03:05:58.705Z","level":"info","scope":"sync","message":"re-identified transactions after item change","count":1}
{"time":"2026-10-08T03:05:58.710Z","level":"info","scope":"sync","message":"re-identified transactions after item change","count":1}
{"time":"2026-10-08T03:05:58.710Z","level":"info","scope":"sync","message":"re-identified transactions after item change","count":1}
{"time":"2026-10-08T03:05:58.714Z","level":"info","scope":"sync","message":"re-identified transactions after item change","count":1}
{"time":"2026-10-08T03:05:58.718Z","level":"info","scope":"sync","message":"re-identified transactions after item change","count":1}
{"time":"2026-10-08T03:05:58.721Z","level":"info","scope":"sync","message":"re-identified transactions after item change","count":1}
{"time":"2026-10-08T03:05:58.724Z","level":"info","scope":"sync","message":"re-identified transactions after item change","count":2}
{"time":"2026-10-08T03:05:58.727Z","level":"info","scope":"sync","message":"re-identified transactions after item change","count":1}
 × app/api/v1/sync/reid-across-pages.test.ts > a sync walk re-identifies each stored row at most once, across pages > PG-01: two identical rows, their new ids one per page: each row takes its own id, once 19ms
   → expected [ [ 3656, 'p640f-new-2' ], …(1) ] to deeply equal [ [ 3656, 'p640f-new-1' ], …(1) ]
 × app/api/v1/sync/reid-across-pages.test.ts > a sync walk re-identifies each stored row at most once, across pages > PG-02: three identical rows, three pages: the k-th id goes to the k-th lowest primary key 12ms
   → expected [ [ 3660, 'p640f-new-3' ], …(2) ] to deeply equal [ [ 3660, 'p640f-new-1' ], …(2) ]
 × app/api/v1/sync/reid-across-pages.test.ts > a sync walk re-identifies each stored row at most once, across pages > PG-03: an empty page between the two ids neither resets what the walk remembers nor blocks the second claim 9ms
   → expected [ [ 3666, 'p640f-new-2' ], …(1) ] to deeply equal [ [ 3666, 'p640f-new-1' ], …(1) ]
 × app/api/v1/sync/reid-across-pages.test.ts > a sync walk re-identifies each stored row at most once, across pages > PG-04: a tombstoned id on the middle page claims nothing, is stored nowhere, and the last page takes the next row 7ms
   → expected [ [ 3670, 'p640f-new-3' ], …(2) ] to deeply equal [ [ 3670, 'p640f-new-1' ], …(2) ]
 ✓ app/api/v1/sync/reid-across-pages.test.ts > a sync walk re-identifies each stored row at most once, across pages > PG-04a: a tombstoned id on the page after a rename leaves the second row on its old id 5ms
 ✓ app/api/v1/sync/reid-across-pages.test.ts > a sync walk re-identifies each stored row at most once, across pages > PG-04b: a tombstoned id on the first page spends no claim, so the next page takes the lowest row 6ms
 ✓ app/api/v1/sync/reid-across-pages.test.ts > a sync walk re-identifies each stored row at most once, across pages > PG-05: one new id for two rows leaves the second on its old id, and an unrelated later row is inserted once 6ms
 × app/api/v1/sync/reid-across-pages.test.ts > a sync walk re-identifies each stored row at most once, across pages > PG-06: modified for an id renamed on an earlier page refreshes that row and never inserts a third 5ms
   → expected [ [ 3685, 'p640f-new-2' ], …(2) ] to deeply equal [ [ 3685, 'p640f-new-1' ], …(1) ]
 × app/api/v1/sync/reid-across-pages.test.ts > a sync walk re-identifies each stored row at most once, across pages > PG-07: the same new id on two pages claims one row only, and is not counted again 4ms
   → expected 1 to be +0 // Object.is equality
 × app/api/v1/sync/reid-across-pages.test.ts > a sync walk re-identifies each stored row at most once, across pages > PG-08: two genuine identical transactions on two pages, no stored history, are both stored 3ms
   → expected [ 'p640f-c-2' ] to deeply equal [ 'p640f-c-1', 'p640f-c-2' ]
 × app/api/v1/sync/reid-across-pages.test.ts > a sync walk re-identifies each stored row at most once, across pages > PG-09: a row inserted by modified on page 1 is not renamed by a same-key added id on page 2 3ms
   → expected [ 'p640f-c-2' ] to deeply equal [ 'p640f-m-1', 'p640f-c-2' ]
 ✓ app/api/v1/sync/reid-across-pages.test.ts > a sync walk re-identifies each stored row at most once, across pages > PG-10: a single page carrying both new ids still pairs them in order (unchanged) 3ms
 ✓ app/api/v1/sync/reid-across-pages.test.ts > a sync walk re-identifies each stored row at most once, across pages > PG-12: an opposite-sign amount is a different transaction; only the same-key id claims the stored row 3ms
{"time":"2026-10-08T03:05:58.730Z","level":"info","scope":"sync","message":"re-identified transactions after item change","count":1}
{"time":"2026-10-08T03:05:58.733Z","level":"info","scope":"sync","message":"re-identified transactions after item change","count":1}
{"time":"2026-10-08T03:05:58.736Z","level":"info","scope":"sync","message":"re-identified transactions after item change","count":1}
{"time":"2026-10-08T03:05:58.739Z","level":"info","scope":"sync","message":"re-identified transactions after item change","count":1}
{"time":"2026-10-08T03:05:58.746Z","level":"info","scope":"sync","message":"re-identified transactions after item change","count":2}
{"time":"2026-10-08T03:05:58.749Z","level":"info","scope":"sync","message":"re-identified transactions after item change","count":1}
{"time":"2026-10-08T03:05:58.752Z","level":"info","scope":"sync","message":"re-identified transactions after item change","count":1}
{"time":"2026-10-08T03:05:58.753Z","level":"info","scope":"sync","message":"re-identified transactions after item change","count":1}
{"time":"2026-10-08T03:05:58.755Z","level":"info","scope":"sync","message":"re-identified transactions after item change","count":1}
{"time":"2026-10-08T03:05:58.763Z","level":"info","scope":"sync","message":"re-identified transactions after item change","count":1}
{"time":"2026-10-08T03:05:58.766Z","level":"info","scope":"sync","message":"re-identified transactions after item change","count":1}
{"time":"2026-10-08T03:05:58.768Z","level":"info","scope":"sync","message":"re-identified transactions after item change","count":1}
 × app/api/v1/sync/reid-across-pages.test.ts > a sync walk re-identifies each stored row at most once, across pages > PG-13: a stored-cursor walk with no removed licence never re-identifies: a same-key new id is a second transaction 3ms
   → expected [ 'p640f-new-1' ] to deeply equal [ 'p640f-old-1', 'p640f-new-1' ]
 ✓ app/api/v1/sync/reid-across-pages.test.ts > a sync walk re-identifies each stored row at most once, across pages > PG-14: the same delivery from no cursor still re-identifies the stored row in place 3ms
 ✓ app/api/v1/sync/reid-across-pages.test.ts > a sync walk re-identifies each stored row at most once, across pages > PG-15: a stored-cursor walk that retires the old id renames the row in place instead of deleting it 3ms
 × app/api/v1/sync/reid-across-pages.test.ts > a sync walk re-identifies each stored row at most once, across pages > PG-15b: the licence works across pages in either order (added then removed, removed then added) 6ms
   → expected [ [ 3714, 'p640f-new-1' ] ] to deeply equal [ [ 3713, 'p640f-new-1' ] ]
 × app/api/v1/sync/reid-across-pages.test.ts > a sync walk re-identifies each stored row at most once, across pages > PG-15c: only the retired row is claimable, and once: a same-key second new id is inserted, a repeated one claims nothing 4ms
   → expected [ 'p640f-new-1', 'p640f-new-9' ] to deeply equal [ 'p640f-new-1', 'p640f-old-2', …(1) ]
 × app/api/v1/sync/reid-across-pages.test.ts > a sync walk re-identifies each stored row at most once, across pages > PG-15d: a removed id of a different key licenses nothing: the new id is inserted and the retired row deleted 3ms
   → expected [ 'p640f-new-1' ] to deeply equal [ 'p640f-old-1', 'p640f-new-1' ]
 ✓ app/api/v1/sync/reid-across-pages.test.ts > a sync walk re-identifies each stored row at most once, across pages > PG-15e: a claimant Plaid retires later in the walk takes nothing; the row goes to the id Plaid ends on 6ms
 × app/api/v1/sync/reid-across-pages.test.ts > a sync walk re-identifies each stored row at most once, across pages > PG-16: a re-auth walk ending on INITIAL_UPDATE_COMPLETE keeps the cursor NULL, so the historical pull re-identifies 2ms
   → expected [] to have a length of 1 but got +0
 × app/api/v1/sync/reid-across-pages.test.ts > a sync walk re-identifies each stored row at most once, across pages > PG-16b: a NOT_READY walk answering with an empty cursor leaves no usable cursor, and the next walk re-identifies 2ms
   → expected [] to have a length of 1 but got +0
 × app/api/v1/sync/reid-across-pages.test.ts > a sync walk re-identifies each stored row at most once, across pages > PG-16c: rows a held-cursor walk writes are real writes: renamed in place, then joined by the historical pull 3ms
   → expected 'p640f-r1-next-1' to be null
 × app/api/v1/sync/reid-across-pages.test.ts > a sync walk re-identifies each stored row at most once, across pages > PG-17: after HISTORICAL_UPDATE_COMPLETE the next walk is incremental, and a same-key second purchase is inserted 6ms
   → expected [ 'p640f-new-2' ] to deeply equal [ 'p640f-new-1', 'p640f-new-2' ]

⎯⎯⎯⎯⎯⎯ Failed Tests 16 ⎯⎯⎯⎯⎯⎯⎯

 FAIL  app/api/v1/sync/reid-across-pages.test.ts > a sync walk re-identifies each stored row at most once, across pages > PG-01: two identical rows, their new ids one per page: each row takes its own id, once
AssertionError: expected [ [ 3656, 'p640f-new-2' ], …(1) ] to deeply equal [ [ 3656, 'p640f-new-1' ], …(1) ]

- Expected
+ Received

  [
    [
      3656,
-     "p640f-new-1",
+     "p640f-new-2",
    ],
    [
      3657,
-     "p640f-new-2",
+     "p640f-old-2",
    ],
  ]

 ❯ app/api/v1/sync/reid-across-pages.test.ts:273:62
    271|     console.log(`[reid-dump pg01] re-identified log lines=${reLines.le…
    272|
    273|     expect(after.map((r) => [r.id, r.plaid_transaction_id])).toEqual([…
       |                                                              ^
    274|     expect(after.map(owner)).toEqual(before.map(owner));
    275|     expect(result.synced).toBe(0);

⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯[1/16]⎯

 FAIL  app/api/v1/sync/reid-across-pages.test.ts > a sync walk re-identifies each stored row at most once, across pages > PG-02: three identical rows, three pages: the k-th id goes to the k-th lowest primary key
AssertionError: expected [ [ 3660, 'p640f-new-3' ], …(2) ] to deeply equal [ [ 3660, 'p640f-new-1' ], …(2) ]

- Expected
+ Received

  [
    [
      3660,
-     "p640f-new-1",
+     "p640f-new-3",
    ],
    [
      3661,
-     "p640f-new-2",
+     "p640f-old-2",
    ],
    [
      3662,
-     "p640f-new-3",
+     "p640f-old-3",
    ],
  ]

 ❯ app/api/v1/sync/reid-across-pages.test.ts:287:62
    285|
    286|     const after = await rows();
    287|     expect(after.map((r) => [r.id, r.plaid_transaction_id])).toEqual([…
       |                                                              ^
    288|     expect(after.map(owner)).toEqual(before.map(owner));
    289|     expect(result.synced).toBe(0);

⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯[2/16]⎯

 FAIL  app/api/v1/sync/reid-across-pages.test.ts > a sync walk re-identifies each stored row at most once, across pages > PG-03: an empty page between the two ids neither resets what the walk remembers nor blocks the second claim
AssertionError: expected [ [ 3666, 'p640f-new-2' ], …(1) ] to deeply equal [ [ 3666, 'p640f-new-1' ], …(1) ]

- Expected
+ Received

  [
    [
      3666,
-     "p640f-new-1",
+     "p640f-new-2",
    ],
    [
      3667,
-     "p640f-new-2",
+     "p640f-old-2",
    ],
  ]

 ❯ app/api/v1/sync/reid-across-pages.test.ts:300:62
    298|
    299|     const after = await rows();
    300|     expect(after.map((r) => [r.id, r.plaid_transaction_id])).toEqual([…
       |                                                              ^
    301|     expect(after.map(owner)).toEqual(before.map(owner));
    302|     expect(result.synced).toBe(0);

⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯[3/16]⎯

 FAIL  app/api/v1/sync/reid-across-pages.test.ts > a sync walk re-identifies each stored row at most once, across pages > PG-04: a tombstoned id on the middle page claims nothing, is stored nowhere, and the last page takes the next row
AssertionError: expected [ [ 3670, 'p640f-new-3' ], …(2) ] to deeply equal [ [ 3670, 'p640f-new-1' ], …(2) ]

- Expected
+ Received

@@ -1,13 +1,13 @@
  [
    [
      3670,
-     "p640f-new-1",
+     "p640f-new-3",
    ],
    [
      3671,
-     "p640f-new-3",
+     "p640f-old-2",
    ],
    [
      3672,
      "p640f-old-3",
    ],

 ❯ app/api/v1/sync/reid-across-pages.test.ts:317:62
    315|     const after = await rows();
    316|     console.log(`[reid-dump pg04] ${JSON.stringify(after.map((r) => ({…
    317|     expect(after.map((r) => [r.id, r.plaid_transaction_id])).toEqual([…
       |                                                              ^
    318|     expect(after.map(owner)).toEqual(before.map(owner));
    319|     const carrying = await db.query('SELECT 1 FROM transactions WHERE …

⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯[4/16]⎯

 FAIL  app/api/v1/sync/reid-across-pages.test.ts > a sync walk re-identifies each stored row at most once, across pages > PG-06: modified for an id renamed on an earlier page refreshes that row and never inserts a third
AssertionError: expected [ [ 3685, 'p640f-new-2' ], …(2) ] to deeply equal [ [ 3685, 'p640f-new-1' ], …(1) ]

- Expected
+ Received

  [
    [
      3685,
-     "p640f-new-1",
+     "p640f-new-2",
    ],
    [
      3686,
-     "p640f-new-2",
+     "p640f-old-2",
+   ],
+   [
+     3689,
+     "p640f-new-1",
    ],
  ]

 ❯ app/api/v1/sync/reid-across-pages.test.ts:384:62
    382|
    383|     const after = await rows();
    384|     expect(after.map((r) => [r.id, r.plaid_transaction_id])).toEqual([…
       |                                                              ^
    385|     expect(after[0].merchant_name).toBe(revised);
    386|     expect(after.map(owner)).toEqual(before.map(owner));

⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯[5/16]⎯

 FAIL  app/api/v1/sync/reid-across-pages.test.ts > a sync walk re-identifies each stored row at most once, across pages > PG-07: the same new id on two pages claims one row only, and is not counted again
AssertionError: expected 1 to be +0 // Object.is equality

- Expected
+ Received

- 0
+ 1

 ❯ app/api/v1/sync/reid-across-pages.test.ts:400:27
    398|     expect(after.map((r) => [r.id, r.plaid_transaction_id])).toEqual([…
    399|     expect(after.map(owner)).toEqual(before.map(owner));
    400|     expect(result.synced).toBe(0);
       |                           ^
    401|   });
    402|

⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯[6/16]⎯

 FAIL  app/api/v1/sync/reid-across-pages.test.ts > a sync walk re-identifies each stored row at most once, across pages > PG-08: two genuine identical transactions on two pages, no stored history, are both stored
AssertionError: expected [ 'p640f-c-2' ] to deeply equal [ 'p640f-c-1', 'p640f-c-2' ]

- Expected
+ Received

  [
-   "p640f-c-1",
    "p640f-c-2",
  ]

 ❯ app/api/v1/sync/reid-across-pages.test.ts:408:63
    406|     const result = await sync(cursors);
    407|
    408|     expect((await rows()).map((r) => r.plaid_transaction_id)).toEqual(…
       |                                                               ^
    409|     expect(result.synced).toBe(2);
    410|   });

⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯[7/16]⎯

 FAIL  app/api/v1/sync/reid-across-pages.test.ts > a sync walk re-identifies each stored row at most once, across pages > PG-09: a row inserted by modified on page 1 is not renamed by a same-key added id on page 2
AssertionError: expected [ 'p640f-c-2' ] to deeply equal [ 'p640f-m-1', 'p640f-c-2' ]

- Expected
+ Received

  [
-   "p640f-m-1",
    "p640f-c-2",
  ]

 ❯ app/api/v1/sync/reid-across-pages.test.ts:417:63
    415|     const result = await sync(cursors);
    416|
    417|     expect((await rows()).map((r) => r.plaid_transaction_id)).toEqual(…
       |                                                               ^
    418|     // Only the `added` insert counts; `modified` has never been count…
    419|     expect(result.synced).toBe(1);

⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯[8/16]⎯

 FAIL  app/api/v1/sync/reid-across-pages.test.ts > a sync walk re-identifies each stored row at most once, across pages > PG-13: a stored-cursor walk with no removed licence never re-identifies: a same-key new id is a second transaction
AssertionError: expected [ 'p640f-new-1' ] to deeply equal [ 'p640f-old-1', 'p640f-new-1' ]

- Expected
+ Received

  [
-   "p640f-old-1",
    "p640f-new-1",
  ]

 ❯ app/api/v1/sync/reid-across-pages.test.ts:457:54
    455|
    456|     const after = await rows();
    457|     expect(after.map((x) => x.plaid_transaction_id)).toEqual([oldId(1)…
       |                                                      ^
    458|     expect(owner(after[0])).toEqual(owner(before[0]));
    459|     expect(after[0].id).toBe(r);

⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯[9/16]⎯

 FAIL  app/api/v1/sync/reid-across-pages.test.ts > a sync walk re-identifies each stored row at most once, across pages > PG-15b: the licence works across pages in either order (added then removed, removed then added)
AssertionError: expected [ [ 3714, 'p640f-new-1' ] ] to deeply equal [ [ 3713, 'p640f-new-1' ] ]

- Expected
+ Received

  [
    [
-     3713,
+     3714,
      "p640f-new-1",
    ],
  ]

 ❯ app/api/v1/sync/reid-across-pages.test.ts:507:64
    505|
    506|       const after = await rows();
    507|       expect(after.map((x) => [x.id, x.plaid_transaction_id])).toEqual…
       |                                                                ^
    508|       expect(after.map(owner)).toEqual(before.map(owner));
    509|       expect((await db.query('SELECT 1 FROM transactions WHERE plaid_t…

⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯[10/16]⎯

 FAIL  app/api/v1/sync/reid-across-pages.test.ts > a sync walk re-identifies each stored row at most once, across pages > PG-15c: only the retired row is claimable, and once: a same-key second new id is inserted, a repeated one claims nothing
AssertionError: expected [ 'p640f-new-1', 'p640f-new-9' ] to deeply equal [ 'p640f-new-1', 'p640f-old-2', …(1) ]

- Expected
+ Received

  [
    "p640f-new-1",
-   "p640f-old-2",
    "p640f-new-9",
  ]

 ❯ app/api/v1/sync/reid-across-pages.test.ts:523:54
    521|
    522|     const after = await rows();
    523|     expect(after.map((x) => x.plaid_transaction_id)).toEqual([newId(1)…
       |                                                      ^
    524|     expect(after.slice(0, 2).map((x) => x.id)).toEqual([r1, r2]);
    525|     expect(after.slice(0, 2).map(owner)).toEqual(before.map(owner));

⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯[11/16]⎯

 FAIL  app/api/v1/sync/reid-across-pages.test.ts > a sync walk re-identifies each stored row at most once, across pages > PG-15d: a removed id of a different key licenses nothing: the new id is inserted and the retired row deleted
AssertionError: expected [ 'p640f-new-1' ] to deeply equal [ 'p640f-old-1', 'p640f-new-1' ]

- Expected
+ Received

  [
-   "p640f-old-1",
    "p640f-new-1",
  ]

 ❯ app/api/v1/sync/reid-across-pages.test.ts:555:54
    553|
    554|     const after = await rows();
    555|     expect(after.map((x) => x.plaid_transaction_id)).toEqual([oldId(1)…
       |                                                      ^
    556|     expect(owner(after[0])).toEqual(owner(before[0]));
    557|     expect(after[0].id).toBe(r);

⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯[12/16]⎯

 FAIL  app/api/v1/sync/reid-across-pages.test.ts > a sync walk re-identifies each stored row at most once, across pages > PG-16: a re-auth walk ending on INITIAL_UPDATE_COMPLETE keeps the cursor NULL, so the historical pull re-identifies
AssertionError: expected [] to have a length of 1 but got +0

- Expected
+ Received

- 1
+ 0

 ❯ expectOneHeldLine app/api/v1/sync/reid-across-pages.test.ts:216:16
    214| function expectOneHeldLine(lines: Record<string, unknown>[], status: s…
    215|   const held = lines.filter((l) => l.message === HELD);
    216|   expect(held).toHaveLength(1);
       |                ^
    217|   expect(Object.keys(held[0]).sort()).toEqual(['level', 'message', 'sc…
    218|   expect(held[0].status).toBe(status);
 ❯ app/api/v1/sync/reid-across-pages.test.ts:597:5

⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯[13/16]⎯

 FAIL  app/api/v1/sync/reid-across-pages.test.ts > a sync walk re-identifies each stored row at most once, across pages > PG-16b: a NOT_READY walk answering with an empty cursor leaves no usable cursor, and the next walk re-identifies
AssertionError: expected [] to have a length of 1 but got +0

- Expected
+ Received

- 1
+ 0

 ❯ expectOneHeldLine app/api/v1/sync/reid-across-pages.test.ts:216:16
    214| function expectOneHeldLine(lines: Record<string, unknown>[], status: s…
    215|   const held = lines.filter((l) => l.message === HELD);
    216|   expect(held).toHaveLength(1);
       |                ^
    217|   expect(Object.keys(held[0]).sort()).toEqual(['level', 'message', 'sc…
    218|   expect(held[0].status).toBe(status);
 ❯ app/api/v1/sync/reid-across-pages.test.ts:616:5

⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯[14/16]⎯

 FAIL  app/api/v1/sync/reid-across-pages.test.ts > a sync walk re-identifies each stored row at most once, across pages > PG-16c: rows a held-cursor walk writes are real writes: renamed in place, then joined by the historical pull
AssertionError: expected 'p640f-r1-next-1' to be null

- Expected:
null

+ Received:
"p640f-r1-next-1"

 ❯ app/api/v1/sync/reid-across-pages.test.ts:653:34
    651|     expect(mid.map(owner)).toEqual(before.map(owner));
    652|     expect(first.synced).toBe(0);
    653|     expect(await storedCursor()).toBeNull();
       |                                  ^
    654|
    655|     // Run 2, again from no cursor: the historical pull re-delivers ne…

⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯[15/16]⎯

 FAIL  app/api/v1/sync/reid-across-pages.test.ts > a sync walk re-identifies each stored row at most once, across pages > PG-17: after HISTORICAL_UPDATE_COMPLETE the next walk is incremental, and a same-key second purchase is inserted
AssertionError: expected [ 'p640f-new-2' ] to deeply equal [ 'p640f-new-1', 'p640f-new-2' ]

- Expected
+ Received

  [
-   "p640f-new-1",
    "p640f-new-2",
  ]

 ❯ app/api/v1/sync/reid-across-pages.test.ts:689:54
    687|
    688|     const after = await rows();
    689|     expect(after.map((x) => x.plaid_transaction_id)).toEqual([newId(1)…
       |                                                      ^
    690|     expect(after[0].id).toBe(r);
    691|     expect(owner(after[0])).toEqual(owner(before[0]));

⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯[16/16]⎯


 Test Files  1 failed (1)
      Tests  16 failed | 8 passed (24)
   Start at  20:05:58
   Duration  429ms (tests 45%, import 33%, transform 20%, setup 1%)
```

## Mutation probes on the cycle-2 changes (each restored; final `cmp` exit 0)

The number after each label is the count of the mutated line left in the file, which is `0` and
confirms that the edit applied.

```
P1 N1 claimant filter removed (removedInWalk.has skip):
0
PG-15e 
P2 netRemoved not consulted in the count:
0
PG-15e 
P3 inserted flag not consulted (written.rows[0]?.inserted && removed):
0
PG-16c 
P4 held-cursor log line removed:
0
PG-16 PG-16b 
cmp exit 0
```

## Acceptance #1

```
$ (cd apps/web && npx tsc --noEmit)
exit 0
```

## Acceptance #2

```
$ npx eslint apps/web/lib/sync.ts apps/web/app/api/v1/sync/reid-across-pages.test.ts
Pages directory cannot be found at /Users/andreianpilogov/Documents/b8/app/pages or /Users/andreianpilogov/Documents/b8/app/src/pages. If using a custom path, please configure with the `no-html-link-for-pages` rule in your eslint config file.
exit 0
```

## Acceptance #3

```
$ (cd apps/web && env -u PLAID_CLIENT_ID -u PLAID_SECRET npx vitest run --config vitest.integration.config.mts --reporter=verbose app/api/v1/sync/reid-across-pages.test.ts)

 RUN  v5.0.3 /Users/andreianpilogov/Documents/b8/app/apps/web

{"time":"2026-10-08T03:06:22.354Z","level":"info","scope":"sync","message":"re-identified transactions after item change","count":1}
{"time":"2026-10-08T03:06:22.357Z","level":"info","scope":"sync","message":"re-identified transactions after item change","count":1}
[reid-dump pg01] [{"id":4083,"hidden":false,"note":"Fabricated P640f note 1","mapped_category":"Fabricated P640f Pick 1","rule_applied":false,"watched_at":"2026-03-01 02:00:00-08","transfer_group_id":169,"property_id":169,"plaid_transaction_id":"p640f-new-1"},{"id":4084,"hidden":true,"note":"Fabricated P640f note 2","mapped_category":"Fabricated P640f Pick 2","rule_applied":false,"watched_at":"2026-03-02 02:00:00-08","transfer_group_id":170,"property_id":170,"plaid_transaction_id":"p640f-new-2"}]
[reid-dump pg01] re-identified log lines=2 total count=2
{"time":"2026-10-08T03:06:22.368Z","level":"info","scope":"sync","message":"re-identified transactions after item change","count":1}
{"time":"2026-10-08T03:06:22.371Z","level":"info","scope":"sync","message":"re-identified transactions after item change","count":1}
{"time":"2026-10-08T03:06:22.372Z","level":"info","scope":"sync","message":"re-identified transactions after item change","count":1}
{"time":"2026-10-08T03:06:22.380Z","level":"info","scope":"sync","message":"re-identified transactions after item change","count":1}
{"time":"2026-10-08T03:06:22.382Z","level":"info","scope":"sync","message":"re-identified transactions after item change","count":1}
{"time":"2026-10-08T03:06:22.388Z","level":"info","scope":"sync","message":"re-identified transactions after item change","count":1}
{"time":"2026-10-08T03:06:22.389Z","level":"info","scope":"sync","message":"re-identified transactions after item change","count":1}
{"time":"2026-10-08T03:06:22.390Z","level":"info","scope":"sync","message":"skipped transactions the owner deleted","count":1}
[reid-dump pg04] [{"id":4097,"hidden":false,"note":"Fabricated P640f note 1","mapped_category":"Fabricated P640f Pick 1","rule_applied":false,"watched_at":"2026-03-01 02:00:00-08","transfer_group_id":169,"property_id":169,"plaid_transaction_id":"p640f-new-1"},{"id":4098,"hidden":true,"note":"Fabricated P640f note 2","mapped_category":"Fabricated P640f Pick 2","rule_applied":false,"watched_at":"2026-03-02 02:00:00-08","transfer_group_id":170,"property_id":170,"plaid_transaction_id":"p640f-new-3"},{"id":4099,"hidden":false,"note":"Fabricated P640f note 3","mapped_category":"Fabricated P640f Pick 3","rule_applied":false,"watched_at":"2026-03-03 02:00:00-08","transfer_group_id":171,"property_id":171,"plaid_transaction_id":"p640f-old-3"}]
{"time":"2026-10-08T03:06:22.395Z","level":"info","scope":"sync","message":"re-identified transactions after item change","count":1}
{"time":"2026-10-08T03:06:22.396Z","level":"info","scope":"sync","message":"skipped transactions the owner deleted","count":1}
{"time":"2026-10-08T03:06:22.401Z","level":"info","scope":"sync","message":"re-identified transactions after item change","count":1}
{"time":"2026-10-08T03:06:22.401Z","level":"info","scope":"sync","message":"skipped transactions the owner deleted","count":1}
{"time":"2026-10-08T03:06:22.405Z","level":"info","scope":"sync","message":"re-identified transactions after item change","count":1}
{"time":"2026-10-08T03:06:22.410Z","level":"info","scope":"sync","message":"re-identified transactions after item change","count":1}
{"time":"2026-10-08T03:06:22.411Z","level":"info","scope":"sync","message":"re-identified transactions after item change","count":1}
{"time":"2026-10-08T03:06:22.415Z","level":"info","scope":"sync","message":"re-identified transactions after item change","count":1}
 ✓ app/api/v1/sync/reid-across-pages.test.ts > a sync walk re-identifies each stored row at most once, across pages > PG-01: two identical rows, their new ids one per page: each row takes its own id, once 22ms
 ✓ app/api/v1/sync/reid-across-pages.test.ts > a sync walk re-identifies each stored row at most once, across pages > PG-02: three identical rows, three pages: the k-th id goes to the k-th lowest primary key 14ms
 ✓ app/api/v1/sync/reid-across-pages.test.ts > a sync walk re-identifies each stored row at most once, across pages > PG-03: an empty page between the two ids neither resets what the walk remembers nor blocks the second claim 8ms
 ✓ app/api/v1/sync/reid-across-pages.test.ts > a sync walk re-identifies each stored row at most once, across pages > PG-04: a tombstoned id on the middle page claims nothing, is stored nowhere, and the last page takes the next row 8ms
 ✓ app/api/v1/sync/reid-across-pages.test.ts > a sync walk re-identifies each stored row at most once, across pages > PG-04a: a tombstoned id on the page after a rename leaves the second row on its old id 5ms
 ✓ app/api/v1/sync/reid-across-pages.test.ts > a sync walk re-identifies each stored row at most once, across pages > PG-04b: a tombstoned id on the first page spends no claim, so the next page takes the lowest row 5ms
 ✓ app/api/v1/sync/reid-across-pages.test.ts > a sync walk re-identifies each stored row at most once, across pages > PG-05: one new id for two rows leaves the second on its old id, and an unrelated later row is inserted once 5ms
 ✓ app/api/v1/sync/reid-across-pages.test.ts > a sync walk re-identifies each stored row at most once, across pages > PG-06: modified for an id renamed on an earlier page refreshes that row and never inserts a third 5ms
{"time":"2026-10-08T03:06:22.426Z","level":"info","scope":"sync","message":"re-identified transactions after item change","count":2}
{"time":"2026-10-08T03:06:22.430Z","level":"info","scope":"sync","message":"re-identified transactions after item change","count":1}
{"time":"2026-10-08T03:06:22.437Z","level":"info","scope":"sync","message":"re-identified transactions after item change","count":1}
{"time":"2026-10-08T03:06:22.441Z","level":"info","scope":"sync","message":"re-identified transactions after item change","count":1}
{"time":"2026-10-08T03:06:22.445Z","level":"info","scope":"sync","message":"re-identified transactions after item change","count":1}
{"time":"2026-10-08T03:06:22.448Z","level":"info","scope":"sync","message":"re-identified transactions after item change","count":1}
{"time":"2026-10-08T03:06:22.452Z","level":"info","scope":"sync","message":"re-identified transactions after item change","count":1}
{"time":"2026-10-08T03:06:22.456Z","level":"info","scope":"sync","message":"re-identified transactions after item change","count":1}
{"time":"2026-10-08T03:06:22.462Z","level":"info","scope":"sync","message":"re-identified transactions after item change","count":1}
{"time":"2026-10-08T03:06:22.468Z","level":"info","scope":"sync","message":"cursor held until Plaid reports history complete","status":"INITIAL_UPDATE_COMPLETE"}
{"time":"2026-10-08T03:06:22.470Z","level":"info","scope":"sync","message":"re-identified transactions after item change","count":1}
{"time":"2026-10-08T03:06:22.472Z","level":"info","scope":"sync","message":"cursor held until Plaid reports history complete","status":"NOT_READY"}
{"time":"2026-10-08T03:06:22.474Z","level":"info","scope":"sync","message":"re-identified transactions after item change","count":1}
{"time":"2026-10-08T03:06:22.476Z","level":"info","scope":"sync","message":"re-identified transactions after item change","count":1}
{"time":"2026-10-08T03:06:22.479Z","level":"info","scope":"sync","message":"re-identified transactions after item change","count":1}
{"time":"2026-10-08T03:06:22.479Z","level":"info","scope":"sync","message":"cursor held until Plaid reports history complete","status":"INITIAL_UPDATE_COMPLETE"}
{"time":"2026-10-08T03:06:22.481Z","level":"info","scope":"sync","message":"re-identified transactions after item change","count":1}
{"time":"2026-10-08T03:06:22.484Z","level":"info","scope":"sync","message":"re-identified transactions after item change","count":1}
{"time":"2026-10-08T03:06:22.486Z","level":"info","scope":"sync","message":"transactions update status unknown; cursor stored as usual"}
 ✓ app/api/v1/sync/reid-across-pages.test.ts > a sync walk re-identifies each stored row at most once, across pages > PG-07: the same new id on two pages claims one row only, and is not counted again 4ms
 ✓ app/api/v1/sync/reid-across-pages.test.ts > a sync walk re-identifies each stored row at most once, across pages > PG-08: two genuine identical transactions on two pages, no stored history, are both stored 4ms
 ✓ app/api/v1/sync/reid-across-pages.test.ts > a sync walk re-identifies each stored row at most once, across pages > PG-09: a row inserted by modified on page 1 is not renamed by a same-key added id on page 2 3ms
 ✓ app/api/v1/sync/reid-across-pages.test.ts > a sync walk re-identifies each stored row at most once, across pages > PG-10: a single page carrying both new ids still pairs them in order (unchanged) 4ms
 ✓ app/api/v1/sync/reid-across-pages.test.ts > a sync walk re-identifies each stored row at most once, across pages > PG-12: an opposite-sign amount is a different transaction; only the same-key id claims the stored row 4ms
 ✓ app/api/v1/sync/reid-across-pages.test.ts > a sync walk re-identifies each stored row at most once, across pages > PG-13: a stored-cursor walk with no removed licence never re-identifies: a same-key new id is a second transaction 3ms
 ✓ app/api/v1/sync/reid-across-pages.test.ts > a sync walk re-identifies each stored row at most once, across pages > PG-14: the same delivery from no cursor still re-identifies the stored row in place 3ms
 ✓ app/api/v1/sync/reid-across-pages.test.ts > a sync walk re-identifies each stored row at most once, across pages > PG-15: a stored-cursor walk that retires the old id renames the row in place instead of deleting it 4ms
 ✓ app/api/v1/sync/reid-across-pages.test.ts > a sync walk re-identifies each stored row at most once, across pages > PG-15b: the licence works across pages in either order (added then removed, removed then added) 7ms
 ✓ app/api/v1/sync/reid-across-pages.test.ts > a sync walk re-identifies each stored row at most once, across pages > PG-15c: only the retired row is claimable, and once: a same-key second new id is inserted, a repeated one claims nothing 8ms
 ✓ app/api/v1/sync/reid-across-pages.test.ts > a sync walk re-identifies each stored row at most once, across pages > PG-15d: a removed id of a different key licenses nothing: the new id is inserted and the retired row deleted 3ms
 ✓ app/api/v1/sync/reid-across-pages.test.ts > a sync walk re-identifies each stored row at most once, across pages > PG-15e: a claimant Plaid retires later in the walk takes nothing; the row goes to the id Plaid ends on 6ms
 ✓ app/api/v1/sync/reid-across-pages.test.ts > a sync walk re-identifies each stored row at most once, across pages > PG-16: a re-auth walk ending on INITIAL_UPDATE_COMPLETE keeps the cursor NULL, so the historical pull re-identifies 4ms
 ✓ app/api/v1/sync/reid-across-pages.test.ts > a sync walk re-identifies each stored row at most once, across pages > PG-16b: a NOT_READY walk answering with an empty cursor leaves no usable cursor, and the next walk re-identifies 6ms
 ✓ app/api/v1/sync/reid-across-pages.test.ts > a sync walk re-identifies each stored row at most once, across pages > PG-16c: rows a held-cursor walk writes are real writes: renamed in place, then joined by the historical pull 5ms
 ✓ app/api/v1/sync/reid-across-pages.test.ts > a sync walk re-identifies each stored row at most once, across pages > PG-17: after HISTORICAL_UPDATE_COMPLETE the next walk is incremental, and a same-key second purchase is inserted 4ms

 Test Files  1 passed (1)
      Tests  24 passed (24)
   Start at  20:06:22
   Duration  488ms (tests 45%, import 34%, transform 19%, setup 1%)

exit 0
```

## Acceptance #4

```
$ (cd apps/web && env -u PLAID_CLIENT_ID -u PLAID_SECRET npx vitest run --config vitest.integration.config.mts --reporter=verbose app/api/v1/sync/reid-across-pages.test.ts 2>&1 | grep -cE '^\s*(✓|×).*PG-')
24
```

## Acceptance #5

```
$ (cd apps/web && env -u PLAID_CLIENT_ID -u PLAID_SECRET npx vitest run --config vitest.integration.config.mts --reporter=verbose app/api/v1/sync/route.test.ts app/api/v1/sync/enrichment.test.ts app/api/v1/plaid/exchange-token/reissue-root-cause.test.ts)

 RUN  v5.0.3 /Users/andreianpilogov/Documents/b8/app/apps/web

{"time":"2026-10-08T03:06:24.240Z","level":"info","scope":"sync","message":"re-identified transactions after item change","count":1}
 ✓ app/api/v1/sync/enrichment.test.ts > sync keeps Plaid enrichment > T40b-S1: an added row stores all ten columns, the primary category unchanged and the date unshifted 28ms
 ✓ app/api/v1/sync/enrichment.test.ts > sync keeps Plaid enrichment > T40b-S2: when Plaid omits everything optional, all ten columns are NULL and plaid_raw is still an object 9ms
 ✓ app/api/v1/sync/enrichment.test.ts > sync keeps Plaid enrichment > T40b-S3: empty and whitespace-only strings are stored as NULL 4ms
 ✓ app/api/v1/sync/enrichment.test.ts > sync keeps Plaid enrichment > T40b-S4: modified with changed values overwrites every column and plaid_raw becomes the new object 6ms
 ✓ app/api/v1/sync/enrichment.test.ts > sync keeps Plaid enrichment > T40b-S5: modified that omits previously stored fields sets them to NULL rather than keeping the stale values 7ms
 ✓ app/api/v1/sync/enrichment.test.ts > sync keeps Plaid enrichment > T40b-S6: modified for an id not yet stored creates the row with every field 4ms
 ✓ app/api/v1/sync/enrichment.test.ts > sync keeps Plaid enrichment > T40b-S7: modified leaves the six owner-set fields byte-identical while refreshing enrichment and plaid_category 6ms
 ✓ app/api/v1/sync/enrichment.test.ts > sync keeps Plaid enrichment > T40b-S8: an added event re-delivering a stored id leaves the owner-set fields byte-identical too 7ms
 ✓ app/api/v1/sync/enrichment.test.ts > sync keeps Plaid enrichment > T40b-S9: a rule-managed row still has mapped_category re-derived on modified, and gets the new enrichment 6ms
 ✓ app/api/v1/sync/enrichment.test.ts > sync keeps Plaid enrichment > T40b-S10: a re-identified row keeps its id and owner fields and gains the new id, enrichment and plaid_raw 8ms
{"time":"2026-10-08T03:06:24.247Z","level":"warn","scope":"sync","message":"transactions for unrecognized account_ids (not saved)","accountIds":["p40b_enrich_unknown_acct"]}
{"time":"2026-10-08T03:06:24.262Z","level":"info","scope":"sync","message":"skipped transactions the owner deleted","count":2}
 ✓ app/api/v1/sync/enrichment.test.ts > sync keeps Plaid enrichment > T40b-S11: a pending transaction with full enrichment creates no row, as added or as modified 3ms
 ✓ app/api/v1/sync/enrichment.test.ts > sync keeps Plaid enrichment > T40b-S12: a transaction for an unknown account creates no row 2ms
 ✓ app/api/v1/sync/enrichment.test.ts > sync keeps Plaid enrichment > T40b-S13: plaid_raw is the object as received, minus only counterparties[*].account_numbers 5ms
 ✓ app/api/v1/sync/enrichment.test.ts > sync keeps Plaid enrichment > T40b-S14: the detailed category does not drive rules; the primary one still does 7ms
 ✓ app/api/v1/sync/enrichment.test.ts > sync keeps Plaid enrichment > T40b-S15: a tombstoned id carrying full enrichment creates no row, as added or as modified 3ms
 ✓ app/api/v1/sync/enrichment.test.ts > sync keeps Plaid enrichment > T40b-S16: the same sync response twice leaves one row with identical values and a deep-equal plaid_raw 4ms
 ✓ app/api/v1/sync/enrichment.test.ts > sync keeps Plaid enrichment > T40b-S17: one transaction with objects missing outright does not fail the batch 3ms
 ✓ app/api/v1/sync/enrichment.test.ts > sync keeps Plaid enrichment > T40b-S18: U+0000 and lone surrogates in enrichment text become U+FFFD; the page and its page-mate still sync and the cursor advances 4ms
{"time":"2026-10-08T03:06:24.561Z","level":"info","scope":"sync","message":"re-identified transactions after item change","count":2}
{"time":"2026-10-08T03:06:24.565Z","level":"info","scope":"sync","message":"re-identified transactions after item change","count":2}
{"time":"2026-10-08T03:06:24.587Z","level":"warn","scope":"plaidReconcile","message":"could not confidently reconcile","unmatchedLive":[],"unmatchedDb":[{"id":"rc-p40e-acct-mix-null","name":"Fabricated RC Mixed A","mask":null},{"id":"rc-p40e-acct-mix-set","name":"Fabricated RC Mixed B","mask":null}]}
{"time":"2026-10-08T03:06:24.590Z","level":"warn","scope":"plaidReconcile","message":"could not confidently reconcile","unmatchedLive":[],"unmatchedDb":[{"id":"rc-p40e-acct-mix-set","name":"Fabricated RC Mixed B","mask":null},{"id":"rc-p40e-acct-mix-null","name":"Fabricated RC Mixed A","mask":null}]}
 ✓ app/api/v1/plaid/exchange-token/reissue-root-cause.test.ts > why reissued rows stayed orphaned > RC-01: a token change through exchange-token nulls the cursor, and the full re-delivery re-keys every row in place 48ms
 ✓ app/api/v1/plaid/exchange-token/reissue-root-cause.test.ts > why reissued rows stayed orphaned > RC-02: ids reissued on the SAME item never reach sync: an incremental delta leaves the old rows orphaned 13ms
 ✓ app/api/v1/plaid/exchange-token/reissue-root-cause.test.ts > why reissued rows stayed orphaned > RC-03: an item whose accounts disagree on the cursor syncs from no cursor, whichever account the table returns first 8ms
{"time":"2026-10-08T03:06:24.913Z","level":"info","scope":"sync","message":"skipped transactions the owner deleted","count":1}
{"time":"2026-10-08T03:06:24.934Z","level":"info","scope":"sync","message":"skipped transactions the owner deleted","count":1}
{"time":"2026-10-08T03:06:24.943Z","level":"info","scope":"sync","message":"skipped transactions the owner deleted","count":1}
{"time":"2026-10-08T03:06:24.950Z","level":"info","scope":"sync","message":"skipped transactions the owner deleted","count":1}
 ✓ app/api/v1/sync/route.test.ts > sync never writes back a transaction the owner deleted > T40a-S7: a tombstoned id arriving as added is skipped, its page-mate is inserted, and the sync completes 20ms
 ✓ app/api/v1/sync/route.test.ts > sync never writes back a transaction the owner deleted > T40a-S8: a row deleted through the real route does not return on modified, while a live row updates and keeps its owner category 19ms
 ✓ app/api/v1/sync/route.test.ts > sync never writes back a transaction the owner deleted > T40a-S9: modified for a tombstoned id writes nothing even when a row with that id exists 8ms
 ✓ app/api/v1/sync/route.test.ts > sync never writes back a transaction the owner deleted > T40a-S10: a tombstoned incoming id never claims a stored live row during re-identification 8ms
 ✓ app/api/v1/sync/route.test.ts > sync never writes back a transaction the owner deleted > T40a-S11: removed is a no-op for a tombstoned id and deletes a live row without tombstoning it 7ms

 Test Files  3 passed (3)
      Tests  26 passed (26)
   Start at  20:06:23
   Duration  1.09s (import 49%, tests 37%, transform 13%, setup 1%, worker 1%)

exit 0
```

## Acceptance #6

```
$ git diff --stat 8df05e7 -- apps/web/app/api/v1/sync/route.test.ts apps/web/app/api/v1/sync/enrichment.test.ts apps/web/app/api/v1/plaid/exchange-token/reissue-root-cause.test.ts apps/web/lib/domain/txnMatch.ts apps/web/lib/domain/txnMatch.test.ts apps/web/vitest.integration.config.mts
exit 0 (no output above this line)
```

## Acceptance #7

```
$ /usr/bin/grep -c "export const key = (t: { accountId: string; date: string; amount: number; name: string | null }) =>" apps/web/lib/domain/txnMatch.ts
$ /usr/bin/grep -c "toFixed(2)}|\${(t.name ?? '').trim().toLowerCase()}" apps/web/lib/domain/txnMatch.ts
1
1
```

## Acceptance #8

```
$ (cd apps/web && npx vitest run lib/domain/txnMatch.test.ts)

 RUN  v5.0.3 /Users/andreianpilogov/Documents/b8/app/apps/web


 Test Files  1 passed (1)
      Tests  12 passed (12)
   Start at  20:06:25
   Duration  126ms (transform 56%, import 20%, tests 14%, worker 10%)

exit 0
```

## Acceptance #10

```
$ (cd apps/web && env -u PLAID_CLIENT_ID -u PLAID_SECRET npx vitest run --config vitest.integration.config.mts --reporter=verbose app/api/v1/sync/reid-across-pages.test.ts 2>&1 | grep -c 'Tests .*failed')
0
```

## Acceptance #11

```
$ npm test

> b8@0.1.0 test
> npm run test -w @b8/web


> @b8/web@0.1.0 test
> vitest run


 RUN  v5.0.3 /Users/andreianpilogov/Documents/b8/app/apps/web

(node:56235) ExperimentalWarning: The supports Web Crypto API method is an experimental feature and might change at any time
(Use `node --trace-warnings ...` to show where the warning was created)
(node:56235) ExperimentalWarning: The ML-DSA-44 Web Crypto API algorithm is an experimental feature and might change at any time

 Test Files  72 passed (72)
      Tests  1112 passed (1112)
   Start at  20:06:27
   Duration  5.57s (tests 57%, import 23%, transform 17%, worker 3%)

    Isolate  72 workers spawned · ~141ms startup each (spawn + environment, per file)
             at least ~1.31s faster with isolate: false — reuses workers across files instead of one per file

npm test exit 0
```

## Acceptance #12

```
$ git diff --stat 8df05e7 -- . ':!apps/web/lib/sync.ts' ':!apps/web/app/api/v1/sync/reid-across-pages.test.ts' ':!plan'
exit 0 (no output above this line)
```
