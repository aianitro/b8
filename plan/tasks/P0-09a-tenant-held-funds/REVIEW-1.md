# REVIEW-1 — P0-09a-tenant-held-funds
**Verdict:** ACCEPT_WITH_NITS
**Reviewer:** adversarial-reviewer

27 hypotheses tested; 21 refuted, 2 confirmed as nits, 4 items returned as INCONCLUSIVE for the
orchestrator to execute. No BLOCK findings, no scope violations.

## Falsification log

| # | Hypothesis | Method | Result |
|---|---|---|---|
| 1 | One of the eight verbatim-named tests passes the grep but asserts something weaker than its numbered SPEC requirement — the gate exists in name only | Read all eight bodies (`lib/domain/netWorth.test.ts:236–335`, `lib/domain/property.test.ts:172–193`) against SPEC "What each new test must assert" 1–8, item by item. #3 asserts the delta against a held-fixed baseline (a no-op impl fails). #6 asserts array *equality* on the filtered lines — stronger than SPEC's "no more than one". #7 sums every `component==='liabilities'` line and pins the `$0` line at exactly `value: 0`. #8 asserts all four SPEC clauses plus empty `realEstateEquity` contributions. #9 asserts `null` vs `0` *and* that the newest reading (`0`, May) beats the older (`2500`, Jan) — a last-row-wins reducer fails it | REFUTED |
| 2 | Acceptance #4 is vacuous: it passes an empty Map to the same function twice | Read `netWorth.test.ts:249–265`. The final `toEqual` is trivially true given `deposits.size === 0`, but the two preceding assertions carry the content: a `last_month_rent` row resolves to 3000 under its own kind and is absent from the `security_deposit` map. A bleed-through implementation fails at `expect(deposits.size).toBe(0)` | REFUTED (see NIT-3: the *production* filter is not what this exercises) |
| 3 | The deposit loop consults `unvaluedPropertyIds`/`excluded`/`latestPropertyValues` indirectly, so a deposit on an unvalued property is silently dropped (SPEC's named G0-6 failure mode) | `lib/domain/netWorth.ts:149–162`: loop iterates `securityDepositsByProperty` alone; no reference to `excluded`, `latestPropertyValues`, `allPropertyIds`, or `a.propertyId`. Test #8 covers it | REFUTED |
| 4 | `liabilitiesSecurityDeposits` can disagree with the deposit portion folded into `liabilities` — a marker that lies | `netWorth.ts:150–152`: `liabilities -= magnitude` and `liabilitiesSecurityDeposits -= magnitude` are consecutive statements in one loop over one Map, no second derivation. Empty Map ⇒ both untouched, marker `0` (not NULL) — the contract-correct post-cutover value. Zero entry ⇒ `x -= 0` leaves `+0` | REFUTED |
| 5 | Sign inversion — negated twice, not at all, or into the wrong component | `liabilities -= magnitude` once (`:151`); contribution `value: 0 - magnitude` once (`:161`); `total` folds it in once (`:165`). Storage is positive-magnitude with `CHECK (value >= 0)`, plus the route's `value < 0` → 400. A negative row cannot exist to be double-negated | REFUTED |
| 6 | `-0` leaks to the render for an explicitly waived `$0` deposit ("−$0" on the card) | `netWorth.ts:161` uses `0 - magnitude`, not `-magnitude`; test #7 pins `value: 0`; the marker starts at `0` and uses `-=`, so `+0` | REFUTED |
| 7 | `null` collapses to `0` between SQL and the DOM | Traced end to end: `app/properties/[id]/page.tsx:220–231` (no coalesce; `Number(r.value)` only on rows that exist) → `lib/domain/property.ts:178–179` (`Map.has()` ternary) → `page.tsx:299–302` (`!== null`, not truthiness — a recorded `$0` still shows) → `PropertyTenantFundsCard.tsx:32,39` (`value === null ?` for figure and note). Grepped the surface: no `?? 0`, `\|\| 0`, or falsy check | REFUTED |
| 8 | Stale "latest": a second reducer, or last-row-wins | `lib/domain/property.ts:151` delegates to `latestValueByKey`; both readers go through it | REFUTED for distinct timestamps; **CONFIRMED for exact ties** — NIT-1 |
| 9 | Double-count: the deposit netted out of the trust-checking ledger balance as well as `liabilities` | `propertyLedger.ts`/`propertyPnl.ts` byte-identical to HEAD; the account loop never reads `securityDepositsByProperty`; `ledgerBalances` untouched | REFUTED |
| 10 | The mortgage at a deposit-carrying property is double-subtracted | The mortgage still `continue`s into `linkedMortgageTotal` (`:96–104`); the deposit loop keys off a different Map and never inspects accounts. Test #8 has both on property 9 and pins `liabilities === -2200` | REFUTED |
| 11 | Missing exclusion filters (`hidden`, `exclude_from_budget`) | SPEC non-goal forbids gating on either; neither query references them, and neither joins `transactions` or `budget_categories` | REFUTED (correctly absent) |
| 12 | JOIN where EXISTS was needed / landscape double-count | Both queries single-table, no join; `property_id` is a real FK; no landscape column on the series | REFUTED |
| 13 | Domain layer branches on `properties.type` | `type` appears only at `app/properties/[id]/page.tsx:300,362`; absent from both domain modules and the route | REFUTED |
| 14 | The new required 6th parameter is passed a wrongly-derived value somewhere | One production call site (`lib/netWorth.ts:98–105`) fed by `latestTenantFundByProperty(..., 'security_deposit')` over rows of both kinds; 19 test sites pass `new Map()`. `writeNetWorthSnapshot` reuses `computeCurrentNetWorth`, so scheduler and dashboard cannot diverge | REFUTED |
| 15 | The snapshot marker goes stale on the upsert path (the G1 hazard) | `lib/netWorth.ts:127–141`: column present in the INSERT list *and* `ON CONFLICT DO UPDATE SET`, from `r.liabilitiesSecurityDeposits`. 7 columns, `CURRENT_DATE` + `$1..$6` | REFUTED |
| 16 | Server/client boundary violation | `PropertyTenantFundsCard.tsx` is `'use client'` and imports only types; `lib/domain/property.ts` imports only `./observations`. Props are `number` and `{number\|null, number\|null}` — serializable | REFUTED |
| 17 | Non-deterministic new tests | All eight use literal fixtures and fixed ISO timestamps; no `Date.now()`, no order dependence, no DB | REFUTED |
| 18 | Real-data leakage | New figures 2500/1800/3000/2200/0 reuse the pre-existing fabricated portfolio. Nothing resembles a real balance | REFUTED |
| 19 | Silently swallowed errors on the write path | No try/catch — a DB error becomes a 500, not a fake success. Client shows `'Could not save'` and does not clear the form. The only catch guards the error-body parse | REFUTED |
| 20 | Scope creep | `app/properties/page.tsx` has no tenant-fund reference; the two domain files byte-identical; net-worth diff is one line, `hint` only | REFUTED |
| 21 | The corrected caption is itself inaccurate, or #11 passes vacuously | `hint: 'Unsecured loans and tenant deposits held'` sits on the `key: 'liabilities'` line so `grep -A3` finds it; names both populations and no longer asserts "not secured against a property" | REFUTED |
| 22 | Float artifact from a NUMERIC-sourced deposit | SPEC requires summing cent-precise magnitudes as-is, one subtraction, no re-rounding; the code does that, and both figures land in `NUMERIC(14,2)`. Route rounds input with `roundCents` | REFUTED |
| 23 | The route mishandles hostile input | `route.ts:23–75`: unknown `kind` → 400; non-number/non-finite `value` → 400; negative → 400; future `valued_at` → 400; missing property → 404. All four DB CHECKs pre-empted by an application 400 | REFUTED |
| 24 | The route 500s on input classes it does not guard | Non-JSON body, literal `null` body, and a non-integer `:id` all escape as 500s | CONFIRMED — NIT-4 (identical to the `valuation/route.ts` it mirrors) |
| 25 | `/net-worth`'s disclosures contradict each other for an unvalued property holding a deposit | `app/net-worth/page.tsx:121–132` still says such a property "is excluded entirely," while the breakdown lists it by name under "Other debt" | CONFIRMED — NIT-2 (non-goal forbade touching it) |
| 26 | The `$0` deposit line disappears, so the component stops adding up | `NetWorthBreakdown.tsx:47` hides zero lines *by default* behind a toggle; `c.amount` unaffected, nothing dropped from any sum. Pre-existing and untouched | REFUTED |
| 27 | The `liabilities` tile vanishes when deposits exactly cancel the account total | `app/net-worth/page.tsx:138` hides the tile only when `amount === 0 && lines.length === 0`; any recorded deposit puts a line in `lines` | REFUTED |

## Findings

### [NIT-1] `components/PropertyTenantFundsCard.tsx`:160–163 (with `lib/domain/observations.ts`:38) — same-day corrections are silently ignored, with no delete affordance to fall back on
`latestValueByKey` breaks ties with strict `>`, so on an exact `valued_at` tie the **first row the
query returns wins**. The entry form defaults to a date-only string, cast to session midnight — so
two readings entered the same day carry byte-identical timestamps.

**Failure scenario:** owner records `250` (typo for `2500`), notices immediately, records `2500`
the same day. Both rows land at the same midnight `timestamptz`. The query has no `ORDER BY`
(deliberately), returns heap order, so the **$250 row wins**. The card keeps showing `$250`, net
worth stays under-reduced by $2,250, and the card's own copy — "recording a new amount supersedes
the last one" — is false. `max={today()}` blocks a future date, and unlike
`PropertyValuationHistory` (which has a `DELETE`) there is no way to remove the bad row. The
correction is impossible until the next calendar day.

Not a BLOCK: SPEC's "Null semantics" convention *mandates* reusing `latestValueByKey` rather than
writing a second reducer, so the tie behavior is inherited, and no acceptance criterion or stated
convention covers ties.

### [NIT-2] `app/net-worth/page.tsx`:121–132 — the unvalued-property banner contradicts the deposit line beneath it
For SPEC's own fixture D (property 9: no valuation, $180,000 mortgage, $2,200 deposit) the amber
banner reads "…has no recorded valuation, so it is excluded entirely — along with any mortgage
against it… neither side is counted," while the breakdown below lists that same property by name
under "Other debt" at −$2,200. Both render, on one page, about one property. Same "correct number
under a false description" class the SPEC corrected the `hint` for. Non-goal put everything in
that file except the `hint`/`label` out of scope, so this is correctly a follow-up, not an
implementer fault. Suggested: "excluded from real-estate equity" rather than "excluded entirely."

### [NIT-3] `lib/netWorth.ts`:95 — the literal that keeps last month's rent out of net worth is covered by no acceptance command
SPEC negative control #1 is asserted by acceptance #4, but #4 exercises
`latestTenantFundByProperty(rows, 'security_deposit')` directly in the test file. If line 95's
argument were changed — or the filter removed so the whole table reached
`computeNetWorthBreakdown` — last month's rent would start reducing net worth and **all eleven
acceptance commands would still return their expected values**. The behavior is correct in this
diff; the gate protecting it does not reach the production wiring. A consequence of toolchain row
T2 (no database, so the I/O shell is unreachable by test), not of the implementation.

### [NIT-4] `app/api/properties/[id]/tenant-funds/route.ts`:19,69 — three input classes return 500 instead of 4xx
`await req.json()` on a non-JSON body, a literal `null` JSON body (destructuring throws), and a
non-integer `:id` (`WHERE id = $1` raises before the 404 check) all escape as unhandled 500s.
Identical to `app/api/properties/[id]/valuation/route.ts`, which this deliberately mirrors — a
pre-existing shape carried forward, not a regression. Not reachable from the card's own form.

### [NIT-5] `components/PropertyTenantFundsCard.tsx`:21 — `today()` uses the exact conversion `lib/domain/property.ts`:34 documents as wrong
`new Date().toISOString().slice(0, 10)`. At a UTC+ offset the default "As of" date and the `max`
attribute are yesterday's local date; at UTC− after ~20:00, tomorrow's. Precedent, not invention:
`PropertyValuationHistory.tsx:21` is character-identical. One follow-up should fix both call sites
using the existing `toDateInputValue`.

### [NIT-6] deployment ordering — `lib/netWorth.ts`:57–59 hard-fails both headline pages if the migration is unapplied
The tenant-funds query sits inside `Promise.all` in `computeCurrentNetWorth`, so on a database
without `property_tenant_funds` both `/dashboard` and `/net-worth` 500 rather than degrading. That
is the right choice — a silent empty deposit set would overstate net worth, which is what the
required-6th-parameter design exists to prevent. Recorded only so the migration is run before the
code is deployed.

## Scope violations
None found. `propertyLedger.ts`/`propertyPnl.ts` byte-identical to HEAD; `app/properties/page.tsx`
carries no tenant-fund reference; `app/net-worth/page.tsx` is the one authorized `hint` edit with
`label`, `href`, and the generic resolution at lines 96–101 untouched; `shared/types.ts` gained
only `TenantFundKind`, matching CONTRACT.md. `scripts/seed-demo.mjs` correctly left alone and
already recorded as NITS.md N1.

## Inconclusive — requires execution
All four were converted into commands and run by the orchestrator; outcomes recorded in
`GATES.md` "G3 review". Summary: **NIT-1 CONFIRMED** (reducer returned 250, not 2500);
**NIT-3 CONFIRMED** (mutation of line 95 left all acceptance commands green); pre-existing tests
verified un-weakened (0 `expect()` removed); the working-tree discrepancy was a stale snapshot in
the reviewer's inherited context, not a real difference.
