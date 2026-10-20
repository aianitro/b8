# P5-35-finding-freshness — follow-ups (from REVIEW-1, 2026-10-20)

- **N1 — widen the SQL-clock check (W1).** Add `CURRENT_TIME`, `LOCALTIME` and literal casts (`'now'`, `'today'`,
  `'tomorrow'`, `'yesterday'` followed by `::`) to `SQL_CLOCKS`, each with a fabricated violator. Confirmed at G3: a
  `CURRENT_TIME` query passes W1 today, and R6 cannot see any database clock by construction.
- **N2 — the `INDEXES` cache in `findingsFreshness.ts`.** Either document that facts are immutable once passed in, or
  drop the cache.
- **N3 — cosmetic:** the R-file's header comment about fixture amounts is inaccurate; reword it when the file is next
  touched.

For step 36 (the composed digest):
- A `feed-degraded` finding whose last success is recent reads `fresh` even while the feed is failing. That follows the
  spec (the input is the last success), but the digest should not present "fresh" as "healthy".
- The R-file empties the read tables (accounts, sync_log, budget_categories, gifts and others) before each world. Any
  later integration suite that relies on rows left behind by another file will break; none does today (shuffled runs
  green at G3).
