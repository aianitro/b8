# GATES — P6-40b-plaid-enrichment
<!-- Append-only audit trail. The process analogue of this app's own append-only observation
     tables: the record of what happened is worth more than a summary of it. -->

| Gate | Result | When | Evidence |
|---|---|---|---|
| G0 spec | PASS (amended) | 2026-10-07 | T1 `1`; T2 `3`; T3 exit 0; T4 latest migration = 40a's tombstones file (original check, a commit-subject grep, printed 0 while the condition held — replaced, A10); T5 BASE a236a34; T6 `2`; T7 `0`; T8 N=1024; T9 test file absent. #5's premise verified: a fresh DB migrated through all migrations has `0` transactions (the `7` seen in a reused scratch DB were integration leftovers). `db/schema.sql` loads into an empty DB (exit 0), so #10 was rewritten as a structural parity diff. Integration `vi.mock` of `@/lib/plaid` proven workable by P6-40a's sync test. Raw-object decision recorded in the spec. Vacuity: #6/#7 need ≥15 passing scenarios with exact column values and exact `plaid_raw` key sets; #9 fails an upsert missing a column or using COALESCE; #3/#4 fail a wrong type, NOT NULL or default. |
| G1 contract | PASS (1 guardian cycle) | 2026-10-07 | `migrations/1791360000000_plaid-enrichment.sql` (newest) + `db/schema.sql`; additive. #3 on fresh `b8_p640b_scratch`: `11` / `0` / `11`. #4: twelve lines exactly as spec. #5: `0` rows. tsc exit 0. #10 first run: diff `property_id:integer:YES:-` only — pre-existing doc drift (`db/schema.sql` never declared `transactions.property_id`, added by 1786646344365), flagged by the guardian in advance; guardian declared it inline with the partial index and the COALESCE inheritance comment (doc class). Re-run → `PARITY`. Residual drift noted by guardian: `property_balances` table also missing from schema.sql (not compared by #10) — QUEUE hold H5. Guardian session was interrupted once by a usage limit and resumed with context. |
| G2 build | PASS | 2026-10-07 | Orchestrator re-ran all on a freshly recreated `b8_p640b_scratch`: #1 tsc exit 0; #2 `Tests 1033 passed (1033)` (N=1024 + 9 new unit); #3 `11`/`0`/`11`; #4 twelve exact lines; #5 `0`; #6 LA `OK 17`; #7 Auckland `OK 17`; #8 (amended) `1`; #9 `OK 2` exit 0; #10 `PARITY`; #11–#14 empty; #15 `0`; #16 exit 0 (eslint's pages-dir notice is informational). Implementer's mutation log (a)–(d) each red as named, incl. (d) failing only in the negative-offset zone, which is why #6/#7 use two. |
| G3 adversarial | FAIL → implementer (cycle 1) | 2026-10-07 | REVIEW-1: BLOCK B1 + NIT N1. Both INCONCLUSIVE items run: (1) `select '{"r":"A\\u0000B"}'::jsonb` → `ERROR: unsupported Unicode escape sequence`; `select '{"s":"X\\ud800Y"}'::jsonb` → `ERROR: invalid input syntax for type json`; `JSON.stringify` emits exactly those escapes — **B1 CONFIRMED** (causal claim run, A2). (2) P6-40a's suites against 40b's upserts → `Test Files 3 passed (3)`, `Tests 28 passed (28)`. Spec amended (see SPEC.md 'G3 amendment'). |
| G4 integration | PASS/FAIL | <ts> | <full suite, tsc, lint, build, migrate round-trip, INCONCLUSIVE items converted to commands> |

**Cycle 1 G2 re-run (2026-10-07, orchestrator, fresh `b8_p640b_scratch`):** #1 exit 0; #2 `Tests 1037 passed (1037)`; #3 `11/0/11`; #5 `0`; #6 LA `OK 18`; #7 Auckland `OK 18` (floor raised to 18 by the G3 amendment); #8 `1`; #9 `OK 2`; #10 `PARITY`; #11–#14 empty; #15 `0`; #16 exit 0; P6-40a's suites + enrichment against the new upserts `Tests 29 passed (29)`. PASS → REVIEW-2.

**G3 (cycle 1):** PASS — REVIEW-2 ACCEPT_WITH_NITS, 12 hypotheses, 0 BLOCK; N2 (`__proto__` key, unreachable) recorded in NITS.md.

**G4:** PASS 2026-10-07 — `npm test` 1037 passed; tsc exit 0; lint exit 0; `npm run build` compiled; migrate up/down 1/up clean (#3); REVIEW-1's INCONCLUSIVE items both run (jsonb rejection confirmed; 40a suites green, 29 with enrichment after cycle 1); diff money-scan shows only SQL `$n` placeholders.

**Cycle count:** 1 / 3

**Tier (A8):** full pipeline — migration plus the sync write path.
<!-- G2/G3-BLOCK/G4 failures increment. A reviewer-fault (empty falsification log) does NOT. -->

## Adjudications
<!-- Disputes settled by a discriminating command, never by argument (BUILD.md §5.1).
     A disposition may not be recorded as "verified" unless the causal claim behind it was
     itself run as a command. Otherwise it is recorded as a hypothesis. -->
| Claim in dispute | Discriminating command | Output | Decision |
|---|---|---|---|
| #8 as frozen reaches the guard | implementer ran both the stated cwd and repo root | `0` both ways — config/test path never resolved, guard never reached | Spec defect. Amended to the P6-40a form: `(cd apps/web && DATABASE_URL=postgresql://nobody@127.0.0.1:1/b8_finance npx vitest run --config vitest.integration.config.mts app/api/v1/sync/enrichment.test.ts 2>&1 \| grep -c b8_finance)` → `1`. |
| #13/#14 see this task's files | `git diff --name-only $BASE` lists no untracked file | new files invisible | Spec defect. Orchestrator ran `git add -N` on the new files (intent-to-add, nothing staged) before #13/#14; both empty with the files listed by `git diff --name-only $BASE`. |
