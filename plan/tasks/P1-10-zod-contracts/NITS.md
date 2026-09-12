# NITS — P1-10-zod-contracts

Six findings from REVIEW-1 (verdict `ACCEPT_WITH_NITS`, 30 hypotheses, 24 refuted, 0 blocking).
None contradicts the frozen spec; none was a reason to block. One was corrected during G4 because it
was the orchestrator's own deviation; the rest are recorded as follow-ups.

## N1 — RESOLVED at G4. The zod range was not the one the spec asked for
`package.json` carried `"zod": "^4.6.2"`. SPEC's Contracts-touched table asks for "a range compatible
with the version already resolved (`4.4.3`)" and CONTRACT.md item 1 names `npm install zod@^4.4.3`.
`^4.6.2` *excludes* 4.4.3, so the range was narrower than specified.

**This was the orchestrator's error, not the implementer's** — I ran the install and let npm write
the resolved version as the floor. Corrected to `^4.4.3`; the installed version stays 4.6.2, which
satisfies it. Re-verified: `npm ci` `exit=0`, zod resolves at 4.6.2, acceptance #37/#38/#39 still
`true`/`1`/`1`.

Worth keeping, because the gate could not see it: **acceptance #38 matches the major only**
(`"zod":\s*"\^?4\.`), so it passed against a range the spec did not intend. A command satisfiable
without the intended behaviour, in a spec whose own G0 gate was twice failed for exactly that class.

## N2 — `shapes.ts:6` and `index.test.ts:82` say "thirteen columns"; `budget_categories` has twelve
`db/schema.sql:165-187` declares twelve. Both comments contradict their own arithmetic in the same
sentence — ten type fields plus `is_debt_service` and `sort_order` is twelve. The control itself is
correct; only the number a reader would check it against is wrong. Comment-only fix.

## N3 — the stated reason for leaving timestamps unconstrained is false
`representation.ts:101` says "nothing in the app parses these values back."
`components/RelativeTime.tsx:6` computes `Date.now() - new Date(iso).getTime()`, and its only caller
passes `Account.last_synced_at` (`components/AccountsList.tsx:201`). Consequence: `timestamptz` and
`dateString` accept `''` and `'not a date'` — values a `TIMESTAMPTZ`/`DATE NOT NULL` column cannot
produce — while `ApiErrorSchema.code` carries `.min(1)` for a weaker reason.

Relatedly `representation.ts:110` frames a `::text`-cast DATE as a future change, but
`app/transactions/page.tsx:95` already does `t.date::text AS date` today. Harmless while nothing
validates; the *reason* is what needs correcting, not necessarily the schema.

## N4 — the `AccountSchema` disclosure names one of two reasons, and misses a second shape entirely
**Measured at G4 against `b8_demo`, running the page queries verbatim through `pg`:**

```
app/accounts/page.tsx   -> 11 keys, property_id absent, last_synced_at typeof object (Date)
app/categories/page.tsx -> created_at typeof object (Date), annual_budget typeof string
```

So a real row from the accounts page fails `AccountSchema` on **two** keys, not the one the comment
names: the missing `property_id` *and* `last_synced_at`, which `pg` hands over as a `Date` while the
schema declares a string. The repo already types that column `Date | null` at
`components/SyncHealthCard.tsx:45`.

The same class applies, undisclosed, to `BudgetCategorySchema.created_at` against
`app/categories/page.tsx` — and that producer never crosses `Response.json` at all, so a
wire-shaped schema can never validate it. Two of the seven shapes (`Account`, `BudgetSummary`) have
no `Response.json` producer anywhere: `ApiResponse<Account|…|BudgetSummary>` appears nowhere in the
repo.

**Not a defect in this diff.** Schemas describing the JSON wire value is the guardian's recorded
decision, and this task wires nothing. But the successor task will follow the disclosure, add
`property_id`, call `.parse()` on a page rather than through `Response.json`, and get a rejection it
was told not to expect. **This is the note the route migration must read first**, and it is a
stronger finding than its severity label suggests.

## N5 — NaN/Infinity rejection is a rule the database does not hold
`'NaN'::numeric` is storable in `annual_budget` (no CHECK), and PG14+ accepts `'Infinity'` — the
latter rejected by `numericString`'s regex with no comment, unlike NaN. Same *form* as the
`annual_budget >= 0` constraint SPEC non-goal #4 forbids inventing, and the spec did not leave this
one open; CONTRACT.md lists it under judgements it believed were open.

Not escalated, because no writer can reach it: JSON cannot carry `NaN`, `PATCH` guards
`Number.isFinite` (`app/api/categories/route.ts:99`), and `normalizeMonthlyAmounts` maps non-finite
to `0`. Residual exposure is a row written by a future direct-SQL or CSV path that the column accepts
and the contract calls malformed.

## N6 — the inbound-use invitation in the comments cannot be taken
`shapes.ts:9-10` and `:25-26` both reason about these schemas "later pointed at an *inbound*
payload." They cannot be, in the direction that matters: `POST /api/categories` requires
`typeof annual_budget === 'number'` (`app/api/categories/route.ts:21`) and the client sends a JS
number, which `numericString` refuses by design. The row schemas describe responses only. Worth
stating outright so the route-migration task does not reach for `BudgetCategorySchema` as a request
validator and conclude the contract is wrong.
