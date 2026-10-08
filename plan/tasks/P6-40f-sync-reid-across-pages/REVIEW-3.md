# REVIEW-3 — P6-40f (focused: cycle-2 delta)

Reviewer: adversarial-reviewer (resumed). Scope: (a) N1 claimant filter, (b) last-event-removal
counting, (c) held-cursor log line, (d) `RETURNING (xmax = 0) AS inserted`.

**Verdict: ACCEPT_WITH_NITS** (0 BLOCK)

| Hypothesis | Result |
|---|---|
| `xmax = 0` misreports insert vs. update for INSERT…SELECT…WHERE NOT EXISTS…ON CONFLICT DO UPDATE | REFUTED (no triggers in db/schema.sql; the only FK into transactions locks existing rows only; concurrent inserts resolve to exactly one counted insert). INCONCLUSIVE on version: the idiom is undocumented, so it is converted to a G4 command |
| Tombstone guard yields no row → `rows[0].inserted` throws | REFUTED (the `rowCount === 0` branch runs first) |
| RETURNING changes which rows are written | REFUTED (#5 unchanged, 26 passed) |
| (b) undercounts a net-new row | REFUTED (traced each page order) |
| (b) overcounts | CONFIRMED (NIT N6) |
| (a) blocks a legitimate claim | REFUTED (the only affected sequence loses owner fields either way, via the page-wise DELETE) |
| (c) log leaks identifiers or fires when the cursor is not held | REFUTED |
| (d) changes the route's 500 heuristic | CONFIRMED (NIT N7) |

Scope note: the counting change crosses the "added counter semantics" non-goal. It was disclosed by
the implementer and adjudicated in GATES.md.
