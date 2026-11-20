# REVIEW-1 — P8-42b-card-annual-instruments
**Verdict:** ACCEPT_WITH_NITS
**Reviewer:** adversarial-reviewer

I tried to disprove the diff against the frozen spec and could not. No BLOCK finding. There are three NITs and four evidence or interpretation items for the orchestrator. Amendment A1 does not weaken T42a-U8.

## Falsification log
| # | Hypothesis | Method | Result |
|---|---|---|---|
| 1 | The whole-word regex lets `ANNUAL FEES` and `BIANNUAL FEE` through as fees. | Read `FEE_WORDS` at `apps/web/lib/loyaltyStore.ts:231`: `(^|[^[:alnum:]])annual (membership )?fee($|[^[:alnum:]])`. In `fees`, the `s` after `fee` and the `i` before `annual` are both alnum, so neither row matches. I3 (n) and (n2) assert this. | REFUTED |
| 2 | Doubled spaces, mixed case, a trailing reference, or a null `name` breaks detection or throws. | `FOLDED_NAME` (`:233`) is `regexp_replace(lower(coalesce(t.name,'')),'[[:space:]]+',' ','g')`. Null becomes '' and never matches. A trailing ` 00123` is preceded by a space, which is non-alnum. I3 (c), (e) and (f) cover these. | REFUTED |
| 3 | Late fee, interest, foreign transaction fee, or merchant-only text is read as a fee. | Only `name` is read. Category, `merchant_name` and `plaid_*` are never in `card_rows`. I3 (g), (h), (i) and (o) cover these. | REFUTED |
| 4 | Sign inversion: a negative or zero row is read as a fee. | `fees` requires `amount > 0` and `refunds` requires `amount < 0`. There is no JS negation. Pairing is `r.amount = -latest.amount` on NUMERIC in SQL. I3 (j) and (k) cover these. | REFUTED |
| 5 | A hidden fee row is dropped, or a Plaid-less card finds nothing. | `TRANSACTION_COLUMN_MASK` keeps `hidden` and `visibleTransactions` filters no rows. Nothing reads `access_token` or `plaid_raw`. I3 (b) and (d) cover these. | REFUTED |
| 6 | A transfer-group row or another account's row counts. | `fees` has `transfer_group_id IS NULL`. The lateral pick has `f.account_id = l.card_account_id`. I3 (l) and (m) cover these. | REFUTED |
| 7 | An equal-amount card payment voids the fee. | `refunds` requires a fee, `refund`, `reversal` or `reversed` whole word. I5 tests `PAYMENT THANK YOU`. | REFUTED |
| 8 | A refund dated before the fee, a refund on another card, or a refund of a different amount voids it. | Read: `r.date >= latest.date`, `r.account_id = l.card_account_id`, exact amount. I5 has all three standing cases. | REFUTED |
| 9 | A refund that maps to an older equal fee makes the latest fee look cancelled. | The subquery (`:276-278`) must return `latest.id`. With the refund at T-100, it maps to the T-400 fee and the T-20 fee stands. I5 `mid` asserts this. | REFUTED |
| 10 | Two refunds cancelling one fee (implementer's known gap) changes any output. | Only the single latest fee L matters. Any refund R with `R.date >= L.date` already has L as the latest equal-amount fee on or before R.date, so many-to-one never changes output. | REFUTED (see NIT 1) |
| 11 | An older fee is resurrected after the latest is refunded. | The lateral picks the latest fee first, and `fee` is empty if it is cancelled. Nothing falls back. I5 `late` asserts `no_fee_seen`. | REFUTED |
| 12 | Insertion order or `authorized_date` decides which fee or which date. | `ORDER BY f.date DESC, f.id DESC` with `date` only. In I4, the newer-dated row is inserted first (lower id), and `authorizedDays: -23` is asserted to be ignored. | REFUTED |
| 13 | Off by one at E (`<` vs `<=`). | `CURRENT_DATE <= fee.date + window` is `awaiting`. I6 asserts T-45 is awaiting with expectedBy=T, T-46 is overdue, and the window-10 pair. Mutation M2 was run and caught. | REFUTED |
| 14 | `received` does not win over overdue, or the wrong kind or membership closes the watch. | The CASE order puts `received` before the date test. The EXISTS checks `i.membership_id = l.id AND i.kind = l.benefit_kind`. I6 (T-100 + instrument) and I7 (travel_credit, other membership, `other` kind) cover these. | REFUTED |
| 15 | `created_at` overrides a known `issued_on`, or a zone moves the recorded date. | `COALESCE(i.issued_on, i.created_at::date)` uses the session zone, as the spec allows. I7 fixtures are midday-local `timestamp`, so no zone moves them. I7 case `issued -31, created 0` stays awaiting. | REFUTED |
| 16 | Matching instruments, a join to the account, or refunds duplicate a membership line. | Instruments and refunds use EXISTS. `accounts` is a LEFT JOIN on the PK. Both laterals are `LIMIT 1`. `viewOf` throws unless the membership appears exactly once (I4 tie, I7 two instruments). | REFUTED |
| 17 | A gift-held fee is excluded only for non-givers, so viewers disagree. | The store reads `visibleTransactions(null)` plus `NOT t.gift_masked`. With viewer NULL, `giver_user_id IS DISTINCT FROM NULL` is true for every gift, because `giver_user_id` is NOT NULL (gifts migration line 82). No viewer parameter exists in the store. I8 tests owner, giver, full and read tokens, and reveal +30/+1/0/-1, with a control card. | REFUTED |
| 18 | Any new query reads `transactions` raw. | `FEE_WATCH_SQL` uses `${visibleTransactions(null)}`. The account page's new block calls `earningOfCard`, which reads `loyalty_memberships` and `loyalty_programs` only. Command #15 scans every changed non-test source. | REFUTED |
| 19 | `/accounts/[id]`'s new block leaks ledger text or the fee amount to the recipient. | `AccountEarnsInto` renders the program name, member display name, benefit description, fee date and state only. The amount is never selected: `fees` and `latest` carry `amount`, but the outer SELECT emits `date` only. | REFUTED |
| 20 | The fee amount reaches JSON, a log, or a page. | The outer SELECT is id/feeDate/expectedBy/state. Logs carry `{code}` or `{count}` only. `LoyaltyFeeWatchSchema` is strict with no amount key. I9 asserts the amount text is absent. | REFUTED |
| 21 | A non-credit account links, or an unknown id gives 500. | `SELECT type … FOR SHARE` gives `not_credit` and a 400 with nothing written. I1 covers depository, investment, loan and an unknown id, and checks the loyalty checksum. | REFUTED |
| 22 | A lost race on one card returns 500. | 23505 with constraint `loyalty_memberships_one_per_card` maps to 409. The sequential 409 in I1 already proves the constraint-name mapping (otherwise it would rethrow and give 500). The concurrent pair asserts `[200,409]`. | REFUTED |
| 23 | Unlink clears instruments or the benefit. | The UPDATE touches `benefit_*` only when `'benefit' in body`. I1 and I9 check the benefit and `instrumentSum`. | REFUTED |
| 24 | A read-scope bearer token or no session can write. | `callerOf` runs first in PATCH. I1 and I10 assert 403 `INSUFFICIENT_SCOPE` and 401, with the checksum unchanged. | REFUTED |
| 25 | The default window is not written, a half benefit is stored, or the description is untrimmed. | `benefit.windowDays ?? 45` and `storedText` trims. `null` sets all three to null. The table CHECKs are all-or-none, 1-365, and trimmed 1-200. I2 covers all of these, including direct-SQL 23514. | REFUTED |
| 26 | Something derived is stored. | The only writes are `patchMembership`'s UPDATE (number, tier, card, three benefit columns). Command #5 regex `fee|state|status|expect|…` over loyalty columns. I9 checksum across GETs and transaction inserts and deletes. | REFUTED |
| 27 | I-tests depend on the JS clock, or boundary tests do not cross the boundary. | Every date comes from `CURRENT_DATE + n` in SQL or from `pgDay`. I6 asserts both sides of E. There is no `new Date` in the file. | REFUTED |
| 28 | H12's "both viewers" check is vacuous, or the `overdue`/`received` text checks are vacuous. | `both()` fetches each viewer separately and compares the JSON views. Step 3 asserts `/travel` has no `overdue`/`received`, so the step 5 and 6 positives on `/travel` are real. On the account page, the only static "received" text renders only for non-liability valuation accounts, so it does not render on a card. | REFUTED |
| 29 | U4 passes without the controls. | Each checker is run against fabricated violating sources that must fail, and then on the real tree. The AST check proves `unlinkCard` is attached via `onClick` to the `Unlink card` button. | REFUTED |
| 30 | A1 weakens T42a-U8 beyond the reclassification. | Read `lib/loyalty.test.ts:384-396`. The per-route class is still an exact `toEqual` against a literal four-file list. `/travel` is exact `['numeric-only']`. The script string checks are exact. 7 added lines, none outside the class/terminal intent. | REFUTED |
| 31 | A2's whole-file exclusion hides a new clock use in `lib/loyalty.test.ts`. | The A1 guard pins the diff to 5 removed and 7 added lines. I read all 7 added lines: no clock or float token. | REFUTED |
| 32 | Server/client boundary: a client file pulls in `lib/db`. | `LoyaltyCardLink`, `TravelBoard`, `LoyaltyMembershipLine` and `LoyaltyProgramCard` import types, `send` and siblings only. `LoyaltyFeeWatchLine` has no hooks and is type-only. The store is imported only by server `page.tsx` files. | REFUTED |
| 33 | Scope creep: earn estimate, alerts, transfers, a new route, or a figure in comments. | None found. 11 route files (I10). Grep for money-looking figures in comments of changed files: only pre-existing schema and contract lines. | REFUTED |
| 34 | Two definitions of the fee watch. | One SQL (`FEE_WATCH_SQL`) feeds `loadOverview`, `membershipView` and `earningOfCard`. One renderer (`LoyaltyFeeWatchLine`) is used by both pages. | REFUTED |
| 35 | The 14 unrun mutations would survive. | Traced each by reading. Caught: pick-by-id (I4), authorized_date (I4), resurrection (I5 late), kind or membership ignored (I7), join repetition (I7 + `viewOf`), unlink clearing (I1, I9), stored column (#5), amount emitted (I9, U2), `/travel` unclassified (#14), giver-only (I8), index dropped (I1 23505, #5), down dropping the card (#4). Exception: "refund cancels every equal fee" cannot change any output (row 10). | REFUTED except one (NIT 1) |
| 36 | The `/accounts/[id]` gate hides "Earns into" for a linked card whose type later changes, so the two pages disagree. | The page gates on `account.type === 'credit'`. The spec's visible-text table says non-credit means no `Earns into`, so this matches the spec. `/travel` still shows the link. | REFUTED (spec-conformant) |

## Findings

### [NIT] apps/web/lib/loyaltyStore.ts:276-278 — the refund-pairing subquery is a no-op
**Failure scenario:** None in output. `latest` is the greatest (date, id) fee on the card. Any refund with `r.date >= latest.date` and amount `-latest.amount` therefore always maps to `latest`. Removing the subquery yields identical results for every input. The spec mutation "Let a refund cancel every equal fee → T42b-I5 pairing" cannot fail any test, and the implementer's flagged gap "two refunds can both cancel the same fee" has no observable effect. This is a spec-level redundancy, not wrong behaviour. I am recording it so G4 does not count that mutation as provable.

### [NIT] apps/web/components/LoyaltyCardLink.tsx:59 — `Number(windowText)` coerces input the comment says is refused
**Failure scenario:** The owner types `0x1F` or `1e1` into "Days after the fee". `Number` turns these into 31 and 10, and they are stored silently. The comment at lines 15-17 says anything that is not a whole number "is refused … never rounded here". The contract is still enforced, so the value is always 1-365. This is UI only.

### [NIT] apps/web/scripts/gifts-surface-check.mjs:431-434 and apps/web/lib/loyaltyCardUi.test.ts:42 — both checks are narrower than the spec text
H12 step 2 checks the held name and amount on `/travel` and the API for both viewers, but on `/accounts/<card>` it checks the name for the recipient only and never checks the amount. U4's db/ledger check is limited to loyalty page files rather than "No component". Both are recorded in EVIDENCE.md "Interpretations". Both are forced by pre-existing facts: the account page is text-bearing and shows the giver their own row (H3), and four unrelated components import `@/lib/db`. The orchestrator should ratify them; they should not be read as silently passed.

## Scope violations
- None. Every changed file matches command 16's allowed set. `plan/QUEUE.md` is under `plan/`, which the scope guard excludes. `giftReadPath.ts`, `giftMask.ts`, `sync.ts`, `netWorth.ts`, `package.json`, `evals/` and migration 1792700000000 are not in the git status.

## Evidence gaps (from GATES.md G2; not code defects)
- The phone-width and desktop screenshots required by "Evidence required — limits (1)" were not taken.
- 14 mutations were not run. By reading, 13 of them are caught by existing scenarios (log row 35). The 14th cannot be caught (NIT 1).

## Inconclusive — requires execution
- **H12 account-page positives are not vacuous.** Mutate `LoyaltyFeeWatchLine.tsx` so the received branch renders `got it` instead of `received`. Run `node apps/web/scripts/gifts-surface-check.mjs`. Expect `H12 FAIL step 6: the pages do not say received`. Revert and confirm `OK H1-H12`.
- **NIT 1 should be confirmed by mutation.** Delete lines 276-278 of `apps/web/lib/loyaltyStore.ts`, keeping the closing `)` of `NOT EXISTS`. Run `(cd apps/web && DATABASE_URL=postgresql://localhost/b8_p42a_throwaway npx vitest run --config vitest.integration.config.mts app/api/v1/loyalty/loyaltyCard.test.ts)`. The prediction is 10/10 pass, which would confirm the spec mutation "refund cancels every equal fee" is uncatchable. Revert afterwards.

```yaml
verdict: ACCEPT_WITH_NITS
falsification_log: "36 hypotheses, table above; 35 REFUTED, row 35 REFUTED except one uncatchable mutation (NIT 1)"
findings:
  - severity: NIT
    file: apps/web/lib/loyaltyStore.ts
    line: 276
    claim: "refund-pairing subquery is implied by latest-fee selection plus r.date >= latest.date; dead conjunct"
    failure_scenario: "none in output; spec mutation 'refund cancels every equal fee' survives every test, and the two-refunds gap is unobservable"
    contradicts: "SPEC Evidence required, mutation list (I5 pairing claim)"
  - severity: NIT
    file: apps/web/components/LoyaltyCardLink.tsx
    line: 59
    claim: "Number() coerces hex and exponent window text, contrary to the file's comment"
    failure_scenario: "typing 0x1F stores a 31-day window silently"
    contradicts: "file comment lines 15-17 only; contract still enforced"
  - severity: NIT
    file: apps/web/scripts/gifts-surface-check.mjs
    line: 431
    claim: "H12 step 2 leak check narrowed on /accounts/<card>; U4 db check narrowed to loyalty files"
    failure_scenario: "not a code failure; spec literal is unsatisfiable given H3 and four existing db-importing components; needs orchestrator ratification"
    contradicts: "SPEC T42b-H12 step 2 and T42b-U4 wording"
scope_violations: []
```

No BLOCK. Fee rule, refund pairing, state boundaries, gift path, link rules, benefit storage, no-stored-state, test vacuity, A1/A2 and scope all held up under reading. Run the two inconclusive commands above (H12 "received" mutation; delete loyaltyStore.ts:276-278 and expect 10/10) before G4. Screenshots and 14 unrun mutations remain evidence gaps, not code defects.
