# REVIEW-1 — P8-42b2-card-earn-estimate
**Verdict:** ACCEPT_WITH_NITS
**Reviewer:** adversarial-reviewer

## Falsification log
| # | Hypothesis | Method | Result |
|---|---|---|---|
| 1 | Merchant `match_text` can act as a regex metacharacter in the Postgres ARE: `&`, `'`, `-`, or a space reaches the pattern unescaped. | Read `literalPhrase` in `apps/web/lib/loyaltyEarn.ts:150-151`. It folds the text, then `regexp_replace(..., '([^[:alnum:]])', '\\\1', 'g')` puts a backslash before every non-alphanumeric character. `String.raw` keeps the backslashes, and the tagged template tolerates `\1`. With standard_conforming_strings, the SQL literal is `\\\1`, so the output is a backslash plus the character. In an ARE, a backslash before a non-alphanumeric character is that literal character. Spaces take the same path, and M1, M5, M6 and M7 (spaces in "zq42b2 hotelco") pass at G2, so the escape works at runtime. `&`, `'` and `-` in a match text are never tested end to end (no fixture match contains them). | REFUTED by reading; the untested characters are listed under Inconclusive |
| 2 | SQL injection through match_text, or a route path that bypasses the contract charset. | The rule text is a bound parameter in `replaceEarn` (unnest of `$3::text[]`). In EARN_SQL it is read as the column `r.match_text`, never interpolated. The only writer is the PATCH, through `LoyaltyEarnInputSchema`. The DB bound (1 to 100 chars, any character) is reachable only by direct SQL, and point 1 escapes every non-alphanumeric character anyway. | REFUTED |
| 3 | A card payment named without the listed words counts as a refund. | Spec OQ4 states and accepts this as a known limit. | REFUTED (by spec) |
| 4 | A refund of the annual fee reduces spend. | `spend` CTE lines 206-208: credit holds refund/reversal/reversed AND EXISTS a fee_debit on the same account with `f.amount = -c.amount` (NUMERIC) AND `f.date <= c.date`. `fee_debits` has no window bound, so a fee before `since` still pairs. A fee-worded credit is already dropped by NOT_A_REFUND_WORDS. | REFUTED |
| 5 | An income-category credit, or one with a null category, counts as a refund. | Line 203 requires `mapped_category IS NOT NULL`. Line 204 is an EXISTS on `budget_categories` with `is_income`, not a JOIN, so a name in two landscapes cannot double. The match is exact and case-sensitive (NIT 4). | REFUTED |
| 6 | The transfer-category test differs from `isTransferCategory`. | `position('transfer' IN lower(coalesce(...))) = 0` against `/transfer/i.test(name)` in `lib/transactionEdits.ts:85`. Equivalent for this ASCII word, and a null category passes in both. A category that legitimately contains "transfer" is excluded, as the spec mandates. | REFUTED |
| 7 | Hidden rows are dropped, or `exclude_from_budget`, landscape or is_liability are consulted. | Rows come from `visibleTransactions(null)` with no `hidden` filter, and no other flag is read. Spend cases S19 and S21 cover hidden and budget-excluded rows. | REFUTED |
| 8 | A purchase named like a payment is dropped. | Line 201: a purchase is filtered only by FEE_WORDS. S16 covers it. | REFUTED |
| 9 | First match is not stored order, or mixed kinds tie. | MATCHED_RATE does `ORDER BY r.position LIMIT 1`. UNIQUE(membership_id, position) leaves no tie. Positions come from `WITH ORDINALITY` over the submitted array. M1 and M2 cover reversal. | REFUTED |
| 10 | The rule replace can half-apply: a write outside the transaction, or a concurrent PATCH interleaving. | `patchMembership` calls `replaceEarn(client, ...)` inside `inTransaction` on the same client, after the membership UPDATE. That UPDATE row-locks the membership, so concurrent earn PATCHes serialise. A constraint error throws, rolls back, and `fromPgError` maps it to 400 or rethrows. No pool query is in the write path. I1 covers the third-rule-invalid case with a checksum. | REFUTED |
| 11 | Period boundaries are wrong: the reading's own date included, tomorrow included, or the fallback window off by one. | `s.date > w.since AND s.date <= w.until`, with `until = LEAST(COALESCE(until, CURRENT_DATE), CURRENT_DATE)`. Fallback is `CURRENT_DATE - $7::int` with $7 = 30, a strict `>`, so 30 posted days including today. A future reading gives an empty window and `round(0, scale)`, a true zero. `since` is emitted as `w.since::text`. Covered by P1, P7, P8, P9 to P11. | REFUTED |
| 12 | A same-date typed correction becomes "previous", or a late entry with an older as_of moves the window. | `previousReadings` runs the shared reducer over readings whose asOf differs from the current asOf. The current asOf is the maximum, so "differs" means "strictly earlier". Covered by C12, C15, P5, P6. | REFUTED |
| 13 | The comparison crosses units or nights. | `before.unit === now.unit` is required. `earnUnit` returns null for nights, so both figures are null. C13, E19 and P11 cover it. | REFUTED |
| 14 | The percentage is computed from unrounded figures or double-rounded, or worthALook comes from the rounded percent. | `percent` = `round(100*((cur-prev) - e.figure)/abs(e.figure), 1)`, where `e.figure` is already the once-rounded emitted value. Postgres numeric division keeps 16 or more significant digits, far beyond the distance any realistic quotient has from a half point. worthALook is `isEarnMiss` on the emitted text, using BigInt minor units. A zero estimate gives a null percent and `a !== 0`. C3 to C9 cover it. | REFUTED |
| 15 | A negative zero, or a non-canonical scale, is emitted. | Postgres numeric has no negative zero. `round(x, 0)` gives scale 0, `round(x, 2)` gives scale 2, and COALESCE gives a plain zero at the unit's scale. `actual` is cur minus prev of balances whose per-unit scale CHECK makes them canonical. E6 covers it. | REFUTED |
| 16 | The estimate differs by viewer, a held row counts for the giver, or the merchant text of a held row leaks. | The only ledger source is `visibleTransactions(null)` with `NOT t.gift_masked`. No viewer parameter reaches EARN_SQL. I7 asserts byte-identical bodies for owner, second user and read token across the reveal steps, plus forbiddenText. H13 does the same over HTTP for both users. | REFUTED |
| 17 | Merchant or transaction text reaches output on a numeric-only surface. | The response carries only `earn.rules[].match`, which is the owner's configuration and explicitly in the response shape (OQ12). The figures carry only since, basis, unit, amount and the comparison keys. The contract objects are strict. I8 asserts neither the row name nor the amount text appears in the overview. | REFUTED |
| 18 | Something derived is written. | `earnFiguresOf` and `earnDescriptionsOf` only SELECT. The single writer is `replaceEarn`. The migration adds only `earn_base_rate` and `loyalty_earn_rules`, with no figure-named columns. I8 checks the checksum across two GETs. | REFUTED |
| 19 | A JS float touches a figure or rate. | `loyaltyEarn.ts` does integer arithmetic only on array indices (`push(...) - 1`) and scale constants. Rates and amounts are text to and from SQL. The contract's `Number(m[1])` applies to at most three integer digits of a rate: exact, and not on the banned list. The UI does string work only (`trimRate`, `formatBalance`). | REFUTED |
| 20 | A2's narrowing hides a component this diff touched. | The touched components are LoyaltyEarnLine, LoyaltyEarnEditor, LoyaltyCardLink and AccountEarnsInto. All four fall inside `Loyalty*` or `AccountEarns*`. `app/accounts/[id]/page.tsx` and the travel page are unmodified per git status. | REFUTED |
| 21 | A3's row move breaks a later step or the cleanup. | H13 is the last step. `current = 'H13'` precedes the UPDATE (script line 497 before 502). The only later action is `dropdb` of the scratch DB (line 599). The plain row moves to `reading.day - 1`, before both the estimate period and the comparison window. | REFUTED |
| 22 | The tests are vacuous: cases are not loaded by id, or the I-tests do not cross Postgres date boundaries. | Each group loops the fixture and pushes to `seen`, ending in `expect(seen).toEqual(ids(group))`. Expected values come from the pinned fixture, not recomputed. Dates come from `pgDay`/`day()`, which call `CURRENT_DATE + n` in Postgres. I1 inserts directly to prove the DB CHECKs. | REFUTED |
| 23 | Scope creep: caps, tiers, alerts, a new route or a new error code. | None in the diff. I9 asserts 11 route files. The mapping for `loyalty_earn_rules_membership_position_key` reuses INVALID_INPUT. | REFUTED |
| 24 | A server-only import reaches the client. | LoyaltyEarnEditor (`use client`) imports a contract type and `./LoyaltyRequest`. LoyaltyEarnLine imports `@/lib/domain/loyalty`, which imports only `./observations` and contracts. No `db` import. | REFUTED |
| 25 | `null` renders as `0`. | LoyaltyEarnLine renders "No earn rates set" when `earn` is null and "No estimate for this unit" when the estimate is null, and returns nothing when unlinked. A zero renders through `formatBalance`. | REFUTED |
| 26 | A figure appears in an added comment. | Grepped decimal literals in comment lines of every new or changed source. `LoyaltyEarnEditor.tsx:34` contained a rate example in figures (redacted; fixed at G3). This is the same rate as fixture K1. Command 12's pattern `[0-9]+\.[0-9]{2}([^0-9]|$)` cannot match a four-decimal figure. | CONFIRMED (NIT 1) |
| 27 | The annual-fee concept has two definitions. | `FEE_WORDS` is defined twice: `loyaltyStore.ts:245` and `loyaltyEarn.ts:136`. They are textually equivalent today but separate. | CONFIRMED (NIT 2) |
| 28 | The merchant duplicate key and the SQL fold disagree. | JS `\s+` against `[[:space:]]+`. The merchant charset allows only ASCII space as whitespace, so the two cannot disagree. | REFUTED |
| 29 | A rate spelling slips through: `.5`, `1.`, a value just over the maximum, a fifth decimal, or a JSON number. | `isEarnRateText` regex `^(\d{1,3})(?:\.(\d{1,4}))?$` with the max test, and `z.string()`. U1 uses the rateRefuse and rateRefuseNonString lists. | REFUTED |

## Findings

### [NIT] apps/web/components/LoyaltyEarnEditor.tsx:34 — a rate literal in a source comment, invisible to command 12
The comment reads a stored rate in figures and the same rate as typed (redacted here: the comment was fixed at G3). This value is fixture K1's base rate. Non-goal line 31 says "No figure literal ... in any source comment". Scenario 33 and command 12 narrow that to money-looking numbers, and the scan's two-decimal pattern cannot see a four-decimal figure. This is not money and not real data. Under the literal reading of non-goal 31 it is still a figure in a comment. The fix is one line: describe the example in words. The orchestrator may escalate this to BLOCK if it reads non-goal 31 literally.

### [NIT] apps/web/lib/loyaltyEarn.ts:136 and apps/web/lib/loyaltyStore.ts:245 — two definitions of the annual-fee phrase
The fee watch and the earn estimate each define their own `FEE_WORDS` regex. They match the same phrases today. A future edit to one, for example adding a fee phrase, would leave the fee watch and the estimate disagreeing about which row is the annual fee. That is the "two definitions of one concept" class. Follow-up: export one constant, without changing any feeWatch value.

### [NIT] apps/web/lib/loyaltyEarn.ts:163 — the category rule trims only spaces on the row side
`lower(btrim(s.mapped_category))` uses the default btrim, which removes spaces only. Stored `match_text` is JS-trimmed, which removes all whitespace, and the CHECK enforces `btrim(..., E' \t\n\r\f\x0B')`. A `mapped_category` with a trailing tab or NBSP will not match a category rule, but the spec says "after both are trimmed". No fixture case hits this.

### [NIT] apps/web/lib/loyaltyEarn.ts:204 — the income test is case-sensitive
`bc.name = c.mapped_category` is exact. Consider a credit categorised `zq salary` when the budget category is `ZQ Salary`, `is_income`. That credit counts as a refund, and its income is subtracted from the estimate. This conforms to the spec's "same name", but it is looser than the category rule's case-folding.

### [NIT] apps/web/lib/loyaltyEarn.ts:66-80 and apps/web/lib/loyaltyStore.ts:355-363 — read skew across pool connections
The descriptions (two `Promise.all` queries), the membership rows and the figures run as separate statements on `db`, which is a pool with no snapshot. Under a concurrent earn PATCH, one response can show `earn` from the new rules and `earnEstimate` priced by the old ones, or the reverse. Observations and fee watches already follow the same pattern.

### [NIT] apps/web/components/LoyaltyEarnEditor.tsx:42-43,74 — the draft is not reset
"Cancel" hides the form but keeps the unsaved draft. The `useState` initialisers are not re-synced after `router.refresh()` when another user changes the rates.

### [NIT] apps/web/scripts/gifts-surface-check.mjs:517 — a raw `FROM transactions` in a changed non-test file
Non-goal line 26 says "No raw `FROM transactions` ... in any non-test file this task changes". The scratch-DB harness line `SELECT id FROM transactions WHERE plaid_transaction_id = ...` is a harness, not a production read path, and command 12 checks only `apps/web/(lib|components|app)`. It is a spec-wording overlap, not a production defect.

## Scope violations
- None. Every changed or untracked path is in command 13's allow list. `apps/web/lib/fixtures/` holds only `loyalty-earn-cases.json`.

## Inconclusive — requires execution
- The merchant charset characters `&`, `'` and `-` are never exercised end to end. Run the following. Expected `t|t|t|f`:
```
psql -d postgres -At <<'SQL'
select 'zq at&t-store' ~ ('(^|[^[:alnum:]])' || regexp_replace('zq at&t', '([^[:alnum:]])', '\\\1', 'g') || '($|[^[:alnum:]])'),
       'zq joe''s diner' ~ ('(^|[^[:alnum:]])' || regexp_replace('joe''s', '([^[:alnum:]])', '\\\1', 'g') || '($|[^[:alnum:]])'),
       'zq a-b' ~ ('(^|[^[:alnum:]])' || regexp_replace('a-b', '([^[:alnum:]])', '\\\1', 'g') || '($|[^[:alnum:]])'),
       'zq axb' ~ ('(^|[^[:alnum:]])' || regexp_replace('a-b', '([^[:alnum:]])', '\\\1', 'g') || '($|[^[:alnum:]])');
SQL
```
- Confirm that no fee-watch logic changed in `loyaltyStore.ts`. Expected: no output.
```
git diff -U0 HEAD -- apps/web/lib/loyaltyStore.ts | grep -nE '^[+-].*(FEE_WORDS|REFUND_WORDS|feeWatchesOf|fee_rows|annual)'
```
- Find decimal literals of any length in added comment lines, which command 12 misses. Expected: only the `LoyaltyEarnEditor.tsx:34` hit from NIT 1.
```
for f in apps/web/lib/loyaltyEarn.ts apps/web/components/LoyaltyEarnEditor.tsx apps/web/components/LoyaltyEarnLine.tsx migrations/1792900000000_loyalty_earn_rules.sql; do grep -nE '^[[:space:]]*(//|/\*|\*|--).*[0-9]+\.[0-9]+' "$f"; done
```
