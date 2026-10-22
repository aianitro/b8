# CONTRACT — P7-41c-gift-attach
**Author:** contract-guardian
**Lease:** opened by the orchestrator before dispatch (2026-10-22) · closed <orchestrator records from `.claude/bin/lease`>. This role cannot run the lease script, so the timestamps are the orchestrator's to fill.

## Change
| File | Change | Class (§9.2) |
|---|---|---|
| `packages/contracts/gifts.ts` | **New exports:** `GiftAttachRequestSchema` (strict object, one field `transactionId: GiftTransactionIdSchema`); `GiftCandidateListSchema` (`z.array(GiftCandidateSchema)`, at most 50 items, strictly descending by `date` then `transactionId`); `GiftCandidateListResponseSchema` (`apiResponseSchema(GiftCandidateListSchema)`); types `GiftAttachRequest`, `GiftCandidateList`. **Comment-only edits:** header route table gains the two routes and names who may call them; `GiftErrorCodeSchema`'s docblock states what `INVALID_INPUT`, `NOT_FOUND` and `ALREADY_RESOLVED` mean on the two new routes; `GiftCandidateSchema`'s docblock covers its use in the list and the `Unnamed` label fallback; `GiftResponseSchema`'s one-line docblock now also names `POST …/attach`. | **additive** |
| `packages/contracts/index.ts` | none (`export * from './gifts'` already carries the new names) | — |
| `migrations/**`, `db/schema.sql` | none | — |

**Not changed, by type or by meaning:** `GiftSchema` (including its state/candidates refinement), `GiftCandidateSchema`'s fields, `GiftStateSchema`, `GiftErrorCodeSchema`'s values, `GiftCreateRequestSchema`, `GiftChooseRequestSchema`, `GiftListSchema`, `GiftResponseSchema`, `GiftListResponseSchema`, every primitive. No non-comment line of `gifts.ts` was removed or rewritten (SPEC acceptance #12); every code change is an inserted line.

## Class: additive, and why it is not a semantic change
- Every new schema is a new name. No existing consumer imports it, so nothing that compiles today can change behaviour.
- No new error code. The two new routes use `INVALID_INPUT` (400), `NOT_FOUND` (404) and `ALREADY_RESOLVED` (409). Those codes gain new emitters, but each keeps its existing meaning: "the input cannot be acted on", "no such gift for this viewer", "the gift is past the point where this action applies". The docblock now says so per route. A client already branching on these codes for `choose` and `cancel` reads them the same way on `attach`.
- The N7 fix (sync no longer claims a row for a gift whose reveal date has come) changes `linkFreshRows`, not a contract field. `revealed`, `state` and `candidates` keep their definitions. An `awaiting` gift past its reveal date was already a state the schema admitted; it now simply cannot gain a candidate in that state.
- `GiftSchema`'s refinement already admits both post-attach shapes: `matched` with exactly one candidate, `choose` with one or more. Attach needs no new state and no new shape for the gift.

## Rationale

### Why the attach body is its own schema and not `GiftChooseRequestSchema`
The two bodies are byte-identical today. They are separate because they mean different things: `choose` picks among rows the gift already holds, `attach` brings in a row it does not. If they shared one schema, a later change to one route (for example, a second field on `choose`) would silently change the other. The cost is three lines.

### Why the body carries a transaction id and nothing else
Whether a row qualifies is decided by the handler against committed data under lock, never by the request. A body that carried a criterion, a category or a target state would invite the handler to trust it. Strict refuses stray keys (`state`, `giftId`, `category`), which is P7-41a's and P7-41b's choice for objects this app authors at both ends.

### Why the list reuses `GiftCandidateSchema` unchanged
A listed row and a held row are the same projection of a ledger row for the same reader: id, date, stored amount text, account, label as the giver sees it. A second item shape would be a second definition of "a candidate row as the giver sees it", which is the drift this role exists to prevent. Its `amount` stays `moneyString` and not "positive": the list is a read, the row can change before the giver clicks, and `attach` re-checks it.

### Why the order and the cap are in the schema
SPEC.md fixes both: `date` descending, then `transactionId` descending, at most 50 rows. They are part of what a consumer may rely on, not a presentation detail. Newest first is what makes the cap drop the least likely rows. Stating them only in prose would leave C4 as the single guard. In the schema, any parse of the route's output (the integration fixtures, a future client) catches a reversed sort or a missing LIMIT. Strictly descending (`>` on the pair, not `>=`) also refuses a duplicated row, which a join gone wrong would produce. Dates compare as `YYYY-MM-DD` strings, which order exactly as the dates do; nothing here parses a date.

The cap is the literal 50 in the schema and in the docblock. It is not exported as a constant. The store's `LIMIT` must use the same number; a mismatch fails C4 and any route-output parse, not silently.

### Why a closed gift's list is a 409, never `[]`
Owner decision Q5. `[]` would read as "nothing fits", which is false for a closed gift and would invite the giver to wait. The docblock states it so the meaning of `[]` is unambiguous: an open gift with nothing to attach right now.

### No migration
`gift_transactions` already has `prior_mapped_category` and `prior_rule_applied`, which is everything attach records. No column distinguishes an attached link from a synced one; SPEC.md makes them indistinguishable by design, and masking is keyed on the link and `reveal_date`, not on provenance. The candidate horizon (creation date minus 7 days) derives from `gifts.created_at`, which exists. Nothing new is stored, so nothing can go stale.

## Domain invariants preserved
- **Derived, not stored:** no column; eligibility (`state IN ('awaiting','choose') AND reveal_date > CURRENT_DATE`) and the horizon are computed by Postgres in the statement that reads the gift.
- **Money:** amounts stay decimal text end to end (`moneyString` items, `amount::text` from the store). The schema neither converts nor rounds.
- **Null semantics:** the list is `[]` when empty, never null (`z.array`, not nullable). A row with neither merchant nor name is labelled `Unnamed`, never `''`. Criteria NULL still means "any" (unchanged).
- **Inheritance:** no new column, so nothing new inherits.

## Control script
The orchestrator runs this from the repo root under `bash`. This role has no Bash, so the result is **not run** and nothing here is reported as green. The script imports the real `gifts.ts`, parses 38 fabricated fixtures (13 must be accepted, 25 refused), prints one `FAIL` line per mismatch, and checks the totals so a deleted fixture also fails.

```
S="$(mktemp -d)/p41c-contract-control.mts"
cat > "$S" <<'EOF'
import { pathToFileURL } from 'node:url';
import { resolve } from 'node:path';

const g: any = await import(pathToFileURL(resolve(process.argv[2])).href);

const row = (id: number, date: string, extra: Record<string, unknown> = {}) => ({
  transactionId: id,
  date,
  amount: '0.01',
  accountId: 'acct-ZQ41C',
  accountName: 'ZQ41C-account',
  label: 'ZQ41C-label',
  ...extra,
});
const desc = (n: number) => Array.from({ length: n }, (_, i) => row(n - i, '2026-03-01'));
const gift = (state: string, candidates: unknown[]) => ({
  id: 7,
  recipientUserId: 2,
  recipientDisplayName: 'ZQ41C-recipient',
  amount: '0.01',
  merchant: 'ZQ41C-merchant',
  accountId: null,
  accountName: null,
  windowStart: '2026-03-01',
  windowEnd: '2026-03-01',
  revealDate: '2026-04-01',
  state,
  revealed: false,
  noticeAt: null,
  createdAt: '2026-03-01T00:00:00.000Z',
  candidates,
});

const A = g.GiftAttachRequestSchema;
const L = g.GiftCandidateListSchema;
const LR = g.GiftCandidateListResponseSchema;
const GR = g.GiftResponseSchema;
const E = g.GiftErrorCodeSchema;

const cases: Array<[string, any, unknown, boolean]> = [
  ['attach body: one positive id', A, { transactionId: 1 }, true],
  ['attach body: large id', A, { transactionId: 2147483647 }, true],
  ['attach body: empty object', A, {}, false],
  ['attach body: id as string', A, { transactionId: '1' }, false],
  ['attach body: id zero', A, { transactionId: 0 }, false],
  ['attach body: id negative', A, { transactionId: -1 }, false],
  ['attach body: id fractional', A, { transactionId: 1.5 }, false],
  ['attach body: extra key giftId', A, { transactionId: 1, giftId: 7 }, false],
  ['attach body: extra key state', A, { transactionId: 1, state: 'matched' }, false],
  ['attach body: null', A, null, false],
  ['attach body: array', A, [1], false],

  ['list: empty', L, [], true],
  ['list: date desc, then id desc', L, [row(9, '2026-03-02'), row(8, '2026-03-02'), row(12, '2026-03-01')], true],
  ['list: exactly 50 rows', L, desc(50), true],
  ['list: Unnamed label', L, [row(3, '2026-03-01', { label: 'Unnamed' })], true],
  ['list: 51 rows', L, desc(51), false],
  ['list: dates ascending', L, [row(1, '2026-03-01'), row(2, '2026-03-02')], false],
  ['list: same date, ids ascending', L, [row(1, '2026-03-01'), row(2, '2026-03-01')], false],
  ['list: duplicated row', L, [row(1, '2026-03-01'), row(1, '2026-03-01')], false],
  ['list: null', L, null, false],
  ['list: item with extra key', L, [row(1, '2026-03-01', { merchant: 'ZQ41C-extra' })], false],
  ['list: item with impossible date', L, [row(1, '2026-02-30')], false],
  ['list: item amount not at cent scale', L, [row(1, '2026-03-01', { amount: '0.1' })], false],
  ['list: item amount as number', L, [row(1, '2026-03-01', { amount: 0.01 })], false],
  ['list: item id zero', L, [row(0, '2026-03-01')], false],

  ['list response: success, empty', LR, { success: true, data: [] }, true],
  ['list response: success, ordered rows', LR, { success: true, data: [row(2, '2026-03-02'), row(1, '2026-03-01')] }, true],
  ['list response: ALREADY_RESOLVED', LR, { success: false, error: { code: 'ALREADY_RESOLVED', message: 'ZQ41C closed' } }, true],
  ['list response: NOT_FOUND', LR, { success: false, error: { code: 'NOT_FOUND', message: 'ZQ41C not found' } }, true],
  ['list response: data null', LR, { success: true, data: null }, false],
  ['list response: data missing', LR, { success: true }, false],
  ['list response: unordered data', LR, { success: true, data: [row(1, '2026-03-01'), row(2, '2026-03-02')] }, false],

  ['attach response: matched, one candidate', GR, { success: true, data: gift('matched', [row(5, '2026-02-20')]) }, true],
  ['attach response: choose, three candidates', GR, { success: true, data: gift('choose', [row(3, '2026-03-01'), row(4, '2026-03-01'), row(5, '2026-02-20')]) }, true],
  ['attach response: matched, two candidates', GR, { success: true, data: gift('matched', [row(3, '2026-03-01'), row(5, '2026-02-20')]) }, false],
  ['attach response: awaiting, one candidate', GR, { success: true, data: gift('awaiting', [row(5, '2026-02-20')]) }, false],

  ['error code: ALREADY_RESOLVED still listed', E, 'ALREADY_RESOLVED', true],
  ['error code: no new code was added', E, 'ALREADY_ATTACHED', false],
];

let accepted = 0;
let refused = 0;
let failed = 0;
for (const [label, schema, value, ok] of cases) {
  const r = schema.safeParse(value).success;
  if (r !== ok) {
    failed++;
    console.log('FAIL', label, 'expected', ok ? 'accept' : 'refuse');
  } else if (ok) accepted++;
  else refused++;
}
if (failed || accepted !== 13 || refused !== 25) {
  console.log('FAIL totals', { accepted, refused, failed });
  process.exit(1);
}
console.log(`OK P7-41c contract control: ${accepted} valid accepted, ${refused} invalid refused, ${cases.length} fixtures`);
EOF
(cd apps/web && npx tsx "$S" ../../packages/contracts/gifts.ts); echo "exit=$?"
```

Expected: `OK P7-41c contract control: 13 valid accepted, 25 invalid refused, 38 fixtures` then `exit=0`.

`tsx` is a devDependency of `apps/web`, so it resolves from that directory. `zod` resolves from `packages/contracts` through the workspace's `node_modules`, as it does for the app. The fixtures carry only `ZQ41C` canaries and the smallest positive amount; nothing in them is a real figure.

## Consumers checked (predicted; not run by this role)
- **`(cd apps/web && npx tsc --noEmit)`: predicted 0 errors.** Every change is a new export or a comment. No existing schema's inferred type changed, so no consumer's type changed. Compile risks I checked by reading: `z.array(...).max(...).refine(...)` is a `ZodType` and is accepted by `apiResponseSchema<T extends z.ZodType>`; the order check reads `rows[i]` and tests it against `undefined`, so it compiles with or without `noUncheckedIndexedAccess`; no non-null assertion is used. If tsc reports anything in `packages/contracts/gifts.ts`, it is mine to fix and the task returns to G1.
- **Name collisions through `export *`:** the five new names (`GiftAttachRequestSchema`, `GiftCandidateListSchema`, `GiftCandidateListResponseSchema`, and the types `GiftAttachRequest`, `GiftCandidateList`) start with `Gift`. No other module re-exported by `index.ts` declares a `Gift`-prefixed name.
- **`packages/contracts/index.test.ts`:** unaffected. Gifts are not in `CONTRACT_SCHEMAS`.
- **T41b-W9 / W8 on a gift-path file:** `gifts.ts` still contains no clock read, no date construction, no ISO-string slicing, no float parsing, no rounding call, no multiplication and no log call. Dates in the order check compare as strings.
- **Acceptance #12:** the removed lines in `git diff -U0` are all comment lines (the `//` header, ` *` docblock lines, and the one-line `/** … */` above `GiftResponseSchema`). Every code line is an insertion.

## Handed to the implementer
1. **Parse at the edge.** Parse the attach body with `GiftAttachRequestSchema` only AFTER the viewer-is-giver check has passed. A non-giver's malformed body must get the 404, not a 400 (C6).
2. **List query:** `ORDER BY t.date DESC, t.id DESC LIMIT 50`. Project exactly `GiftCandidateSchema`'s fields: `t.date::text`, `t.amount::text`, the account's id and name, and the label `COALESCE(t.merchant_name, t.name, 'Unnamed')` (or the ledger's existing label expression if it already does this; do not write a second one). Parse the route's own output with `GiftCandidateListResponseSchema` in the integration tests, so order and cap are checked by the contract as well as by C4.
3. **Attach response:** `GiftResponseSchema`, status 200, the gift re-read after commit as `GET …/[id]` would read it (held candidates ascending by `transactionId`).
4. **Refusal messages:** one fixed `INVALID_INPUT` message for every unattachable row; one fixed `ALREADY_RESOLVED` message for both routes. Neither may contain row text, a criterion or a digit string from the row.
5. **Eligibility** is `g.state IN ('awaiting','choose') AND g.reveal_date > CURRENT_DATE`, in the SQL that locks the gift. It is the exact negation of `GiftSchema.revealed` plus the state test; do not compute it in JS.

## Backfill / data correction required
None. No existing row changes, and no CSV backup is needed. Rollback is a revert with no `down` (SPEC.md Rollback): rows attached while the change was live stay correctly linked and restorable through `cancel`.

## Spec ambiguities resolved here
- **Name of the list schema.** SPEC.md describes it but does not name it. I named it `GiftCandidateListSchema` / `GiftCandidateListResponseSchema`, following `GiftListSchema` / `GiftListResponseSchema`.
- **Order and cap enforced in the schema, not only stated.** SPEC.md says the item schema is "unchanged", which it is. The array around it carries the order and the cap, as reasoned above.
- **Floor uses the row's posted `date`.** SPEC.md Q1 says "posted date". The authorized date is not consulted for the horizon, unlike the sync window. I recorded this in the docblock so the list and the floor function agree.
