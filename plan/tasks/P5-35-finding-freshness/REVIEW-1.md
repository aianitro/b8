# REVIEW-1 — P5-35-finding-freshness
**Verdict:** ACCEPT_WITH_NITS
**Reviewer:** adversarial-reviewer · 2026-10-20

Persisted from the reviewer's final report. Two figures it quoted (a fixture value and a pre-existing parse vector) are
described rather than repeated, per AGENTS.md.

No BLOCK. Every attack point was tested by reading, and none produces a wrong state, a wrong severity or a leak. The
nits are weak guards, not wrong numbers.

## Falsification log
| # | Hypothesis | Method | Result |
|---|---|---|---|
| 1 | `feed-degraded` joins an item fact instead of using its own `lastSuccessfulUpdate` | `FRESHNESS_RULES['feed-degraded']` is `instantInput('feed', f.lastSuccessfulUpdate, j.now, feedStale)`; no join; null → `never` | REFUTED |
| 2 | Feed comparator is `>=` or floored hours | `ms > FEED_STALE_AFTER_HOURS * HOUR_MS`, same as `feedState` (feedHealth.ts); F4 tests the exact boundary and one ms past it | REFUTED |
| 3 | Sync/wallet/overdraft use the wrong constant or comparator | Imports aliased by module; `floor(ms/DAY) >= const` as in `classifySyncHealth` and `staleWallets`; overdraft at the sync constant (Q5) | REFUTED |
| 4 | Valuation age differs from `staleValuations` (zone, rounding) | Both are UTC day-number differences against the process-local as-of triple; malformed or impossible date → `undated` via the contract's `giftDate` refine; future date → `undated` | REFUTED |
| 5 | Valuation SQL differs from `loadValuationFindings` | Keeps `valuation_mode='valuation' AND access_token IS NULL`, drops `is_liability = FALSE` — a superset, every producer id has a fact; a tokenized account classes `plaid-linked` first | REFUTED |
| 6 | Item grouping/keys differ from SyncHealthCard and loadFeedHealth | Same `MIN(id)`/`MAX(…)` `GROUP BY access_token`; window gives the same key per account; token never selected | REFUTED |
| 7 | Two no-bank items merge under `Unknown` | Lookup by `h.key`; `byKey` throws on duplicates; F7/R1 seed two null-bank items with different dates | REFUTED |
| 8 | Contributor filters drift from the budget grid | Compared with `readBudgetVsActual` (overviewRead.ts): same `hidden`, `track_transactions`, year, name match, operational names; EXISTS gives one row per pair | REFUTED |
| 9 | A capital twin of the same name double-counts | Operational names only; `UNIQUE(name, landscape)` makes the map 1:1; R7 asserts the twin is absent | REFUTED |
| 10 | A gift-protected column reaches the read | The only `transactions` literal selects nothing from `t` and filters on keep columns; R8 canary in name, merchant, note | REFUTED |
| 11 | A SQL clock is in the judgement path | No `NOW()`, `CURRENT_*`, `clock_timestamp` in any literal; `now` sets only `year` | REFUTED (see N1) |
| 12 | R6 alone could detect a SQL clock | It cannot by construction (two app-side instants, one DB clock); only W1 guards this | CONFIRMED (guard is W1 only) |
| 13 | The N3 clamp changes a verdict for `lastRun <= now` | Same object takes the unchanged path; invalid Date compares false; F10 differential 0 differing | REFUTED |
| 14 | Job freshness re-derives the late threshold | `jobInput` calls `jobHealth(...).status !== 'fresh'`; JOB_SQL matches `loadJobHealth`; `ran_at` NOT NULL | REFUTED |
| 15 | Undated defaults to fresh anywhere | No context, empty set, unknown account, manual ledger, unknown feed, missing row → all `undated`; contract refines fresh to zero undated inputs | REFUTED |
| 16 | Drift is dated by `observedAt` | `driftInputs` uses item sync and feed only; F6 and R9 seed an old change-log row beside a fresh sync | REFUTED |
| 17 | Duplicate open overdraft rows crash `byKey` | Partial unique indexes `overdraft_episodes_one_open`, `overdraft_forecasts_one_open` make it impossible | REFUTED |
| 18 | Freshness steers severity or order | Sort key is severity, sourceRank, position; F13 | REFUTED |
| 19 | Worst-input selection is order-dependent | `worseFirst` is a total order, run on a copy | REFUTED |
| 20 | The R-file TRUNCATE hits a real DB | `testDbGuard.setup.ts` refuses before the pool is built; `fileParallelism: false`; other route tests truncate the same way | REFUTED (order → inconclusive 1) |
| 21 | Money-looking figures in tracked files | Only hit is a pre-existing T34 rejection vector in the contract test (comma-grouped, no currency sign) | REFUTED |
| 22 | A failing feed with a recent success reads `fresh` | Spec-conformant: the input is the last success at the feed threshold; worth knowing for step 36 | REFUTED |
| 23 | Hidden module state breaks purity | `INDEXES` WeakMap keyed by facts identity; only wrong if a caller mutates facts in place; none does | REFUTED (N2) |

## Findings
- **[NIT] N1 — `apps/web/lib/findingsWiring.test.ts` `SQL_CLOCKS`** misses `CURRENT_TIME`, `LOCALTIME` and literal casts
  such as `'now'::timestamptz`. Meets the spec's named list, but weaker than the "no SQL clock" non-goal, and R6 cannot
  back it up.
- **[NIT] N2 — `apps/web/lib/domain/findingsFreshness.ts` `INDEXES`** cache returns a stale index if a caller mutates a
  facts array in place after a first call. Document immutability or drop the cache.
- **[NIT] N3 — `apps/web/scripts/findings-freshness-read.test.ts` header comment** says fixture amounts are single
  digits; one is not. Cosmetic.

## Scope violations
None.

## Inconclusive — run by the orchestrator
1. Integration suite in shuffled file order, seeds 1 and 2 → each `total 245`, failed `[]`, T35-R1..R9 all passed.
2. W1 blind spot: a `CURRENT_TIME` query appended to `findingsFreshnessRead.ts` → `T35-W1` still passed
   (`1 passed | 9 skipped`). N1 confirmed. File restored, `cmp` identical to the backup.
