# EVIDENCE — P7-41c-gift-attach
**Author:** implementer · **Tree:** main at `68e83a1` plus uncommitted changes (not committed, per instructions)
**Contract digest after implementation:** `788d0a939c1c9dd5da89d1d32af3ae3a51364114b029f457ae98f043ed74695f  packages/contracts/gifts.ts` (unchanged from the G1 close; the file was not edited by this role).

Every command below was run from the repository root under `bash`, plainly (no `rtk`), with
`export PRIOR_UNIT=35 PRIOR_INT=41`. The command bodies were extracted from SPEC.md by script, not
retyped. Output is verbatim; where only the final lines are quoted, the spec asks for exactly those
lines. No figure that looks like money appears in this file: the one transcript below has every
amount replaced by `<redacted>`.

## Files changed

Modified: `apps/web/lib/domain/giftMatch.ts`, `apps/web/lib/giftStore.ts`,
`apps/web/lib/giftSurfaceRegistry.ts`, `apps/web/app/api/v1/gifts/giftResponses.ts` (header comment
only), `apps/web/app/api/v1/gifts/giftSurfaces.test.ts` (additions only),
`apps/web/components/GiftForm.tsx`, `apps/web/components/GiftList.tsx`.
Added: `apps/web/app/api/v1/gifts/[id]/candidates/route.ts`, `apps/web/app/api/v1/gifts/[id]/attach/route.ts`,
`apps/web/lib/giftAttach.test.ts` (U1–U9), `apps/web/app/api/v1/gifts/giftAttach.test.ts` (C1–C13).
`apps/web/app/api/v1/gifts/giftTestKit.ts` was not changed (allowed, not needed). `AGENTS.md` did not
reappear dirty after `next dev` (command 7) or the build.

## Toolchain rows (T1–T18)

Measured by the orchestrator at G0 (GATES.md) and not re-measured here except where a command below
re-proves them: T1 `1`; T2 `gift_transactions`; T3 connection refused on port 1; T4 `1`;
T5 BASE 94 files / 1327 tests; T6 `exit=0`; T7 LINT_BASE 0 errors / 5 warnings; T8 integration failing
set `[]` on the unmodified tree, KNOWN left as frozen; T9 PRIOR_UNIT = 35 (all three zones),
PRIOR_INT = 41; T10 `exit=0`; T11 `0` (re-checked by this role immediately before command 7: `0`);
T12 `exit=0`; T13 `-780` / `480`; T14 a SHA; T15 `exit=0`. T16, T17, T18: not required (NO).

## Acceptance commands

**#1** `(cd apps/web && npx tsc --noEmit; echo "exit=$?")`
```
exit=0
```

**#2** `npm run lint; echo "exit=$?"` (tail)
```
✖ 5 problems (0 errors, 5 warnings)
  0 errors and 1 warning potentially fixable with the `--fix` option.

exit=0
```
0 errors, 5 warnings = LINT_BASE. The five are the pre-existing ones (a `window.location.assign`
warning, two unused constants in `lib/domain/digest.ts`, an unused directive in `public/sw.js`, an
unused destructured element in `scripts/seed-demo.mjs`); none is in a file this task touched.

**#3** `npm test 2>&1 | tail -8`
```
 Test Files  95 passed (95)
      Tests  1336 passed (1336)
   Start at  09:36:22
   Duration  6.95s (tests 62%, import 20%, transform 17%, worker 2%)

    Isolate  95 workers spawned · ~147ms startup each (spawn + environment, per file)
             at least ~1.85s faster with isolate: false — reuses workers across files instead of one per file
```
BASE plus 1 file and plus 9 tests exactly; 0 failed; no existing unit test removed (#9).

**#4** (three zones) — final lines:
```
OK 9 scenarios U1-U9 each present once and passed; prior unit scenarios >= 35; TZ=UTC
OK 9 scenarios U1-U9 each present once and passed; prior unit scenarios >= 35; TZ=Pacific/Auckland
OK 9 scenarios U1-U9 each present once and passed; prior unit scenarios >= 35; TZ=America/Los_Angeles
```

**#5** (whole integration config) — final line:
```
OK 266 tests, C1-C13 each present once and passed; T41b passed 41 >= 41
```

**#6** (stability, two runs) — the two failing sets and the final line:
```
[]
[]
OK failing set stable and within KNOWN
```
(The command also prints pre-existing `[reid-dump …]` diagnostic lines from another suite's fixtures
between runs; they carry fabricated `P640f` tokens and no gift data.)

**#7** `node apps/web/scripts/gifts-surface-check.mjs; echo "exit=$?"` — full output:
```
H1 PASS 20 page.tsx files on disk, all 20 classified (7 text-bearing)
H2 PASS 20 pages as the recipient: all 200, 0 hold the canary in any case; /transactions lists the ordinary row and the label Gift
H3 PASS the giver sees the canary on /transactions, /accounts/zq41b_check_card, /categories/Fabricated%20Gift%20Shelf, /dashboard, /properties/1
H4 PASS with the reveal date yesterday the recipient sees the canary on all 5 pages; moved back, masked again
H5 PASS recipient searches (full, prefix, payee) render the nonsense block {"count":"0","rows":0}; the amount finds the Gift row; the giver's search finds 1
H6 PASS merchant rule on the gift's payee counts 0 rows for the recipient and 1 for the giver; its Plaid category row is absent for the recipient and present for the giver
H7 PASS 24 alternating giver/recipient requests over 6 pages and routes: each viewer always got their own answer; API bodies byte-identical per viewer
H8 PASS dev-server output (7295 bytes): 0 lines hold the canary in any case, besides 3 access-log lines echoing this script's own search URLs
H9 PASS RSC: 1 /transactions as the recipient: 12528 bytes, ordinary row present, canary absent
H10 PASS giver's /gifts lists the gift and its criterion; recipient's lists none and holds no criterion; the Gifts nav entry is present for both
OK H1-H10
exit=0
```

**#8** (scope guard) — no output from either `comm`.
```
```

**#9** (additions-only on existing tests and kits) — no output (grep exit 1).
```
```

**#10** (added-lines guard) — no output (grep exit 1). A first run flagged one added comment line in
`components/GiftForm.tsx` that named the forbidden UTC slice in prose to warn against it; the comment
was reworded to describe it without the literal, and the rerun is empty.
```
```

**#11** (untouched files) — no output.
```
```

**#12** (contract guard):
```
packages/contracts/gifts.ts
```
then no output from the removed-line filter.

**#13** `npm run build; echo "exit=$?"` (tail)
```
├ ƒ /transactions


ƒ Proxy (Middleware)

○  (Static)   prerendered as static content
ƒ  (Dynamic)  server-rendered on demand

exit=0
```

## Mutation log

**Not run by this role.** The orchestrator's instruction for this dispatch was "Do not run the
orchestrator's mutation list"; the twenty mutations in SPEC.md are the orchestrator's to apply at
G2/G3. No mutation result is claimed here.

## Sample transcript (fabricated data; amounts redacted)

Captured by a throwaway integration file (created, run against `b8_p41c_throwaway`, then deleted; it
is not in the tree). The owner is the giver, `Test User Two` the recipient, the row carries the
canary `ZQ41CDEMO`.
```
GET /api/v1/gifts/1/candidates as the giver
  -> 200 {"success":true,"data":[{"transactionId":14,"date":"2026-10-20","amount":"<redacted>","accountId":"zq41b_card","accountName":"ZQ41B Fabricated Card","label":"ZQ41CDEMO Merchant"}]}
GET /api/v1/gifts/1/candidates as the recipient (real gift id)
  -> 404 {"success":false,"error":{"code":"NOT_FOUND","message":"No such gift."}}
GET /api/v1/gifts/999999999/candidates as the recipient (unknown id)
  -> 404 {"success":false,"error":{"code":"NOT_FOUND","message":"No such gift."}}
POST /api/v1/gifts/1/attach {"transactionId":14} as the recipient (real gift id)
  -> 404 {"success":false,"error":{"code":"NOT_FOUND","message":"No such gift."}}
POST /api/v1/gifts/999999999/attach {"transactionId":14} as the recipient (unknown id)
  -> 404 {"success":false,"error":{"code":"NOT_FOUND","message":"No such gift."}}
POST /api/v1/gifts/1/attach {"transactionId":14} as the giver
  -> 200 {"success":true,"data":{"id":1,"recipientUserId":1630,"recipientDisplayName":"Test User Two","amount":null,"merchant":"ZQ41CDEMO","accountId":null,"accountName":null,"windowStart":"2026-10-24","windowEnd":"2026-10-25","revealDate":"2099-12-31","state":"matched","revealed":false,"noticeAt":null,"createdAt":"2026-10-22T16:38:50.377636Z","candidates":[{"transactionId":14,"date":"2026-10-20","amount":"<redacted>","accountId":"zq41b_card","accountName":"ZQ41B Fabricated Card","label":"ZQ41CDEMO Merchant"}]}}
GET /api/v1/transactions/14 as the recipient
  -> 200 {"success":true,"data":{"id":14,"date":"2026-10-20","authorizedDate":null,"amount":"<redacted>","title":"Gift","bankDescription":null,"logoUrl":null,"website":null,"account":{"id":"zq41b_card","name":"ZQ41B Fabricated Card"},"budgetCategory":"ZQ41B Gift Shelf","plaidCategory":null,"plaidCategoryDetailed":null,"plaidConfidence":null,"paymentChannel":null,"paymentMethod":null,"paymentProcessor":null,"location":null,"mapsUrl":null,"counterparties":[],"note":null,"watched":false,"hidden":false,"enriched":false}}
```
The four recipient answers are byte-identical, for the real gift id and for an unknown one.

## C9 — `pg_stat_activity` observations

Printed by `T41c-C9` itself in the run of command 5 (and every standalone run): each sub-case polls
`pg_stat_activity` for a backend waiting, directly or through the row's tuple-lock queue, on the
holder's backend, and only then lets the holder commit or roll back. Verbatim:
```
C9(a) backend waiting (Lock/transactionid) on: SELECT id FROM transactions WHERE id = $1 FOR UPDATE
C9(b) backend waiting (Lock/transactionid) on: SELECT id FROM transactions WHERE id = $1 FOR UPDATE
C9(c) backend waiting (Lock/transactionid) on: SELECT g.id, to_char(g.created_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US') AS created_at, (g.created_at::date)::text AS created_date, g.state, g.amount::text AS amount, g.merchant, g.account_id, g.window_start::text AS window_start, g.window_end::text AS window_end, g.reveal_date::text AS reveal_date, CURRENT_DATE::text AS today FROM gifts g WHERE g.id = $1 AND g.giver_user_id = $2 FOR UPDATE
C9(d) iteration 0: backend waiting (Lock/tuple) on: SELECT id FROM transactions WHERE id = $1 FOR UPDATE | backend waiting (Lock/transactionid) on: SELECT id FROM transactions WHERE id = $1 FOR UPDATE
C9(d) iteration 5: backend waiting (Lock/transactionid) on: SELECT id FROM transactions WHERE id = $1 FOR UPDATE | backend waiting (Lock/tuple) on: SELECT id FROM transactions WHERE id = $1 FOR UPDATE
```
(a) and (b) wait on the row lock (a Plaid removal; an amount revision); (c) waits on the gift lock
after taking the row; (d) records iterations 0 (one giver) and 5 (two givers): both attaches wait,
one on the holder's transaction and the other queued behind it on the tuple. Every one of the ten
(d) iterations waits for two blocked backends before releasing; only two are printed to keep the
output short.

## Lock order, and why attach cannot deadlock

Attach takes **the row, then the gift** — the order `linkFreshRows` holds them in, since the sync
has inserted or updated its rows before it locks gifts. It first runs `SELECT id FROM transactions
WHERE id = $1 FOR UPDATE`, then, holding that row, asks in a fresh statement whether the row is linked
to any gift; if it is (or the row is gone), attach refuses without ever requesting a gift lock (it
reads the gift unlocked only to choose between the 400 and the 409). Only an unlinked row is held
while attach waits for `SELECT … FROM gifts … FOR UPDATE`, and it stays unlinked for as long as attach
holds it, because every linker must lock it first (another attach) or links only rows it has itself
just inserted (the sync). `chooseGift`, `cancelGift` and `runGiftSweep` lock the gift and then touch
only the rows that gift HOLDS — never an unlinked row — so none of them ever waits for a row attach
holds, and no wait cycle can form with them. Against the sync, both sides go row then gift; the
sync's gift-phase writes touch only its own fresh rows, which attach cannot see or lock, so the
sync never waits on attach's row after taking a gift. The integration suite exercises this as C9
(deterministic holds) and C10 (ten concurrent real syncs against attach, no rejection and no
deadlock text in either result).

## How the form's initial render avoids the server's calendar

`components/GiftForm.tsx` reads today with `useSyncExternalStore(noSubscription, () => localIsoDate(),
() => null)`. During server rendering and hydration React uses the server snapshot, `null`, so the two
date inputs render empty on the server and hydrate as empty: there is no server-calendar default and
nothing for hydration to disagree about. Immediately after hydration React re-renders with the client
snapshot, the browser's own `localIsoDate()`, and the inputs show `giftFormDefaults(today)`. A date the
giver types is kept in state; until then the field follows the default, which is re-read from
`localIsoDate()` on every render. After a successful submit the form resets to `BLANK`, whose dates are
null, so the fields go back to following the live default rather than being pinned to the date of the
save (changed in G3 cycle 1, N1; see below). This is checked by U8 (AST) and the build, not by a
browser.

## What cannot be proved here

1. The two client components are not rendered in a browser or a jsdom test (T16 is NO). Their
   behaviour is checked by the AST wiring tests (U8: the form's only source of today is a call to
   `localIsoDate` from `@/lib/localDate`, its reset re-reads it, it has no `toISOString`,
   `getTimezoneOffset` or `new Date(`; the default is re-read by `useSyncExternalStore` on every render,
   and the submit's reset leaves both dates null; the list fetches `/candidates` only inside a click handler and
   posts `{ transactionId }` alone to `/attach`; each checker also run against fabricated violators)
   and by the build. In particular, that the form shows the giver's local date after hydration in a
   browser whose zone differs from the server's is not exercised; the mechanism is described above.
2. C9 and C10 prove outcomes under Postgres row and gift locks on a throwaway database, not
   production concurrency.
3. Command 7 runs against `next dev` and does not call the two new routes; C6 and the extended X1/X14
   do.
4. Push, mail and Plaid are stubbed as in P7-41b.
5. The duplicate `T41b-S13` title noted at T9 was renamed to `T41b-S15` by the orchestrator before the
   freeze (`24a106b`); this task does not touch it.

## Ambiguities resolved by the implementer

- **A read-scope token's POST to attach.** C6 lists "the recipient by read bearer token" among the
  callers whose POST must answer the 404, while S30 says "a read-scope token for anyone: 403
  `INSUFFICIENT_SCOPE`". The boundary (`authorize`, and `proxy.ts`, which is off limits) refuses a
  read-scope write before any handler runs, so a 404 there is not reachable in production. I followed
  S30: a read token's POST answers 403 for the recipient, for an unknown id and for the giver, and C6
  asserts that this 403 is byte-identical for a real gift and an unknown id (so it reveals nothing),
  while the same token's GET answers the one 404. Every other C6 caller and body gets the 404.
- **The candidate floor applies to attach too.** C5 requires a row dated the day before the floor to
  be refused by attach as well as left out of the list, so attach checks the floor in addition to
  `isAttachCandidate`. `isAttachCandidate` itself carries no floor, so U2's parity with `isCandidate`
  holds exactly.
- **The cap is applied after the criteria.** The store reads the rows on or after the floor through
  `visibleTransactions(giver)`, decides each with `isAttachCandidate`, and keeps the first 50 by
  date then id descending. A SQL `LIMIT 50` before the criteria would have needed the criteria
  restated in SQL (a second definition) or could cut every qualifying row.
- **Refusal precedence.** For the giver's own gift: a closed gift answers 409 whatever row was named;
  otherwise any unattachable row is the one 400. A malformed body on the giver's own gift is the same
  fixed 400 message (`ATTACH_REFUSED_MESSAGE`).
- **Palette.** `GiftList.tsx` and `GiftForm.tsx` use `slate-*` with `blue-600` buttons; the new control
  follows those files rather than the `uiux-promax` tokens (the skill was not invoked), per "follow the
  file you are in".
- **Shared label expression.** The ledger label (`merchant`, else `name`, else `Unnamed`) that
  `candidatesOf` already used was lifted into one constant in `lib/giftStore.ts` so the held list and
  the candidate list cannot label a row two ways. The link-and-file statements are written out a second
  time in `attachToGift` rather than shared with `linkFreshRows`, because the spec allows exactly one
  change to `linkFreshRows` (N7); C1 pins the two to the same outcome.

## Scan of this file

Searched with `grep -nE '\$[0-9]|[0-9]{1,3}(,[0-9]{3})+'`: the only hits are SQL parameter
placeholders (`$1`, `$2`) in the quoted C9 observations and the lock-order paragraph. No dollar figure
and no comma-grouped number.

## G3 cycle 1 — fixes N1 and N2 (2026-10-22)

`git status` was checked first. Nothing is committed, and `packages/contracts/gifts.ts` still hashes to
`788d0a939c1c9dd5da89d1d32af3ae3a51364114b029f457ae98f043ed74695f`.

**N1, `components/GiftForm.tsx`.** The submit's reset was `setForm({ ...BLANK, ...giftFormDefaults(localIsoDate()) })`.
That pinned both dates to the moment of the save, so a second gift marked after midnight with the page
left open still showed yesterday. The reset is now `setForm(BLANK)`. The dates are null again, and the
fields follow the live default (`useSyncExternalStore` → `localIsoDate()` on every render). The header
comment now says why.

U8 changed in two ways:
- It now requires the default to be live. There must be a `useSyncExternalStore` call whose snapshot
  calls `localIsoDate()`.
- It requires every `setForm` in the submit handler to leave both dates null. The checker follows
  same-file constants and spreads in order. A spread of anything other than such a constant, or a date
  given any value but `null`, counts as pinning the dates.

New fabricated violators, each of which U8 reports: the first-render defaults (M18 shape), the
render's `today`, a fresh `localIsoDate()` (the N1 defect itself), a typed-over date, and a `today` not
read through `useSyncExternalStore`. All other U8 assertions are kept.

Mutations applied to the REAL `components/GiftForm.tsx`, one at a time, each reverted with a `cmp`
against a saved copy (byte-identical; sha256 `dcb0749c2ff926a92aa57a04b5d8757351c677b291c7f9b952b791957e4a0436`
before and after):
```
== mutation: setForm({ ...BLANK, windowStart: windowStart, windowEnd: windowEnd });
     × T41c-U8: … 18ms
      Tests  1 failed | 8 passed (9)
== mutation: setForm({ ...BLANK, ...giftFormDefaults(localIsoDate()) });
     × T41c-U8: … 19ms
      Tests  1 failed | 8 passed (9)
byte-identical
```
The first is M18: the reset reuses the dates the form showed. The second is the pre-fix reset. U8 fails
for both.

**N2, `app/api/v1/gifts/giftAttach.test.ts` C5.** The C5 gift has an amount criterion, so the refund and
the zero row were refused by the amount check before the money-out guard ever ran. C5 gains a
merchant-only gift: `ZQ41CMON` on the card, no amount criterion. It gets three rows that carry the
merchant: a zero row, a refund, and a control. The list must hold exactly the control row. The zero
row and the refund must each get the same fixed 400 body as C5's other refusals, add no link, and
leave the row unchanged. The control row then attaches with 200. No new scenario id was added.

M4 was applied temporarily (`rowCents <= BigInt(0)` → `rowCents < BigInt(0)` in `isCandidate`) and C5
was run alone:
```
     × T41c-C5: no linked, hand-entered, imported, refund, zero, transfer, near-miss, other-merchant, other-account or before-floor row is listed or attachable; a qualifying control is both 148ms
AssertionError: expected [ 5836, 5834 ] to deeply equal [ 5836 ]
      Tests  1 failed | 12 skipped (13)
byte-identical
```
Under the mutation, the zero row was listed. After the revert, `lib/domain/giftMatch.ts` is
byte-identical to the saved copy: sha256
`346b1e2daf6735514fceb278f4f230da4acb63b03ff8acdc2020212c6d658f4b` before and after.

**Re-run after both fixes.** Plain bash, `PRIOR_UNIT=35 PRIOR_INT=41`, command text from SPEC.md:
- #1 `exit=0`
- #2 `✖ 5 problems (0 errors, 5 warnings)`, `exit=0`
- #3 `Test Files  95 passed (95)` / `Tests  1336 passed (1336)`
- #4:
  ```
  OK 9 scenarios U1-U9 each present once and passed; prior unit scenarios >= 35; TZ=UTC
  OK 9 scenarios U1-U9 each present once and passed; prior unit scenarios >= 35; TZ=Pacific/Auckland
  OK 9 scenarios U1-U9 each present once and passed; prior unit scenarios >= 35; TZ=America/Los_Angeles
  ```
- #5 `OK 266 tests, C1-C13 each present once and passed; T41b passed 41 >= 41`. The C9 observations
  were printed again with the same shapes as above: (a) and (b) waited on the row, (c) on the gift, and
  (d) iterations 0 and 5 each had two waiters.
- #8, #9, #10, #11: no output.
- #12: `packages/contracts/gifts.ts`, then no output.
- #13: `exit=0`.

Not re-run in this cycle: #6 and #7. They were not in the cycle's list.
