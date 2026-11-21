# P8-42b2 card earn estimate — implementer evidence

Collected on 2026-11-20 on `main`, uncommitted, by the implementer. Every command was run exactly as written in
`SPEC.md`, from the repo root under `bash`, sequentially (never two of lint, unit and integration at once), with
`export PRIOR_REDUCER=6`. Before the final run, the iCloud dataless check printed `0`.

## Verdict

Fifteen of the sixteen acceptance commands pass as written. **Command 12 fails as written**, on lines this task did not
write. Its first check greps every `.tsx` under `apps/web/components` for `(spend|amount)[A-Za-z]*[[:space:]]*:`, and 21
untouched files already match it at HEAD. `git grep` of the same pattern against `HEAD` gives 40 lines, and the working
tree gives the same 40. `git status` lists none of those 21 files. Editing them would break the scope guard (command
13), so they were left alone. This is reported as a spec defect for the orchestrator, below. Restricted to the files
this task owns, the same command passes (see "Command 12" below).

## Fixture digest

```
1dcd2fa812a05d954dacf9e3827dae9703e66565013a9f2fad08ae0b2c2b93b2  apps/web/lib/fixtures/loyalty-earn-cases.json
```
This equals the digest pinned in command 15. The fixture was not edited.

## Measured T-rows

| # | Measured |
|---|---|
| T4 | BASE 104 files / 1410 tests (orchestrator, G0); after this task, `OK unit 105 files 1414 tests` |
| T5 | LINT_BASE 0 errors / 5 warnings; after, `✖ 5 problems (0 errors, 5 warnings)` |
| T6 | 334-test integration baseline with failing set `[]` (orchestrator, G0); after, 344 tests and `[]`, `[]` |
| T7 | `exit=0` |
| T9 | port 3198: `0` listeners before every surface run |
| T10 | `exit=0` |
| T2 | throwaway DB head after commands 4 and 7: `1792900000000_loyalty_earn_rules` |
| T21 | no renderer (as the spec says); wording proved over HTTP and by source checks |

## Acceptance commands, verbatim results

**#1**
```
exit=0
```
**#2**
```
✖ 5 problems (0 errors, 5 warnings)
  0 errors and 1 warning potentially fixable with the `--fix` option.

OK lint 0 errors, warnings not above 5
```
**#3**
```
OK unit 105 files 1414 tests
```
**#4**
```
OK migration up-down-up
```
**#5**
```
OK schema
```
**#6**
```
OK 4 scenarios T42b2-U1..U4 each present once and passed; TZ=UTC
OK 4 scenarios T42b2-U1..U4 each present once and passed; TZ=Pacific/Auckland
```
**#7**
```
OK 344 tests, T42a-C1-C11 and I1-I11 and T42a2-I1-I3 and T42b-I1-I10 and T42b2-I1-I10 each present once and passed
OK no fixture rows left
```
**#8**
```
[]
[]
OK failing set stable and within KNOWN
```
**#9 (9a to 9d)**
```
OK 10 scenarios U1-U10 each present once and passed; latestValueByKey tests >= 6; TZ=UTC
OK 10 scenarios U1-U10 each present once and passed; latestValueByKey tests >= 6; TZ=Pacific/Auckland
OK 3 scenarios T42a2-U1..U3 each present once and passed; TZ=UTC
OK 3 scenarios T42a2-U1..U3 each present once and passed; TZ=Pacific/Auckland
OK as-of bound
OK failure class
OK import end to end
OK sidebar
OK source guards
OK fixtures fabricated
OK coarse source checks
```
**#10 (full output)**
```
H1 PASS 22 page.tsx files on disk, all 22 classified (8 text-bearing)
H2 PASS 22 pages as the recipient: all 200, 0 hold the canary in any case; /transactions lists the ordinary row and the label Gift
H3 PASS the giver sees the canary on /transactions, /accounts/zq41b_check_card, /categories/Fabricated%20Gift%20Shelf, /dashboard, /properties/1
H4 PASS with the reveal date yesterday the recipient sees the canary on all 5 pages; moved back, masked again
H5 PASS recipient searches (full, prefix, payee) render the nonsense block {"count":"0","rows":0}; the amount finds the Gift row; the giver's search finds 1
H6 PASS merchant rule on the gift's payee counts 0 rows for the recipient and 1 for the giver; its Plaid category row is absent for the recipient and present for the giver
H7 PASS 24 alternating giver/recipient requests over 6 pages and routes: each viewer always got their own answer; API bodies byte-identical per viewer
H8 PASS dev-server output (7438 bytes): 0 lines hold the canary in any case, besides 3 access-log lines echoing this script's own search URLs
H9 PASS RSC: 1 /transactions as the recipient: 13716 bytes, ordinary row present, canary absent
H10 PASS giver's /gifts lists the gift and its criterion; recipient's lists none and holds no criterion; the Gifts nav entry is present for both
H11 PASS /travel and /api/v1/loyalty as both users: 200, label and masked suffix present, the 18-character number absent in any case
H12 PASS both users, 8 steps over /travel, /accounts/zq41b_check_card and /api/v1/loyalty: a gift-held fee is no fee for either; revealed, fee date 2026-11-15 and expected by 2026-12-30 (Postgres dates), then overdue, received, no state without a benefit, and no Earns into once unlinked; the held row's name and amount appear on neither /travel nor the API
H13 PASS both users, 8 fixture steps over /travel, /accounts/zq41b_check_card and /api/v1/loyalty: estimate 1500 points since 2026-10-31 (reading) with the held row excluded for both, counted once revealed, excluded again when held; comparison 2026-10-31 to 2026-11-15 estimated 1700 reported 1500 (-11.8%, worth a look false); cleared and unlinked show no figure; the held row's name and the payment, fee and held amounts appear on neither /travel nor the API
OK H1-H13
OK surface
```
**#11**
```
OK classes
OK no class line changed
```
**#12 — FAILS as written (pre-existing lines; spec defect)**
```
apps/web/components/AccountStatementList.tsx:16:  amount: number;
apps/web/components/CashManagementCard.tsx:56:  spendCategories: string[];
… 38 further lines, all from files unchanged since HEAD (21 files in all) …
FAIL a spend or amount key in a page source
```
As a diagnostic only, the same script with just that one grep narrowed to this task's page files
(`apps/web/components/Loyalty*.tsx apps/web/components/Travel*.tsx apps/web/components/AccountEarns*.tsx
apps/web/app/travel`) and everything else unchanged:
```
OK task source guards
```
None of the task's files holds a spend or amount key. Every other guard in command 12 passes on the real tree: the
raw-read, clock/float, one-null-sender, `authorized_date` and comment-figure checks. Earlier in the session the
comment-figure check caught a parameter placeholder written in a comment of `lib/loyaltyEarn.ts`. That comment was
reworded, and the check now passes.

**#13** — no output.

**#14**
```
OK existing tests edited only as allowed; removed lines 3
```
No other output, so the census part is empty. The three removed lines are the three granted allowances: the contract
test's `membership()` fixture, the T42b-I9 key list, and the `OK H1-H13` line in `lib/loyalty.test.ts`.

**#15**
```
fixture shape ok
OK fixture pinned and covered
```
**#16**
```
exit=0
```

## H13 transcript (one real surface-script run)

```
H13 PASS both users, 8 fixture steps over /travel, /accounts/zq41b_check_card and /api/v1/loyalty: estimate 1500 points since 2026-10-31 (reading) with the held row excluded for both, counted once revealed, excluded again when held; comparison 2026-10-31 to 2026-11-15 estimated 1700 reported 1500 (-11.8%, worth a look false); cleared and unlinked show no figure; the held row's name and the payment, fee and held amounts appear on neither /travel nor the API
```
The script prints the since date, both comparison dates, the figures and the percentage from the API body of the
owner's step-H2 and step-H5 responses. The dates are Postgres's (`CURRENT_DATE` plus the fixture's offsets, through
the script's `day()` helper). Every expected value is read from the fixture's `h13` group. These are point counts
from the fabricated fixture, not money.

**Spec gap handled in H13 (please confirm).** The surface script's pre-existing ordinary row on the shared card
(`zq41b-check-plain`, an ordinary purchase dated today since H2) would price into H13's estimate. The fixture's `h13`
figures assume the card holds only H13's own rows. H13 therefore first moves that row to the day before the h13
reading, which puts it outside both the estimate's period and the comparison window. H1 to H12 have already run by
then, and the row lives only in the script's scratch database. The H1 gift row is still held, and the H12 fee row is
an annual fee, so neither is spend. The spec did not say how the shared card's earlier rows should be treated.

## Mutation log

Each mutation was applied by a harness that replaces one exact, unique string, runs the catching command, restores
the original bytes, and compares sha256 before and after. Every row below printed `restored: checksum unchanged`.
After all of them, the full sequence above was run on the restored tree. Integration means
`cd apps/web && npx vitest run --config vitest.integration.config.mts app/api/v1/loyalty/loyaltyEarn.test.ts`.

| # | Mutation (file) | Caught by | Failing scenario / line |
|---|---|---|---|
| M01 | merchant matched as a plain substring, no whole-word boundaries (`lib/loyaltyEarn.ts`) | integration | T42b2-I4, case `M4` |
| M02 | category rule reads the Plaid category instead of `mapped_category` | integration | T42b2-I2 `E5`, I3 `S5`, I4 `M1` |
| M03 | each row rounded before summing (per-row rounding) | integration | T42b2-I2, case `E7` |
| M04 | a card payment counted as a refund (payment words dropped from the credit filter) | integration | T42b2-I3, case `S1` |
| M05 | the annual fee counted as spend | integration | T42b2-I3 `S9`, T42b2-I9 |
| M06 | a gift-held row counted (`gift_masked` rows kept) | integration | T42b2-I7, step `G1` |
| M23 | the same gift-held mutation, over real HTTP | `node apps/web/scripts/gifts-surface-check.mjs` | `H13 FAIL H2: earnEstimate is {…} for the owner` |
| M07 | the period includes the reading's own date (`>=` for since) | integration | T42b2-I5 `P1`, T42b2-I6 `C10` |
| M08 | "today" from the JS clock (`new Date().toISOString()`) | command 12 | `FAIL clock or float in apps/web/lib/loyaltyEarn.ts` (this guard runs before the failing amount-key grep, so the catch is real) |
| S01 | a stored estimate: `ALTER TABLE loyalty_memberships ADD COLUMN earn_estimate NUMERIC` on the throwaway DB | command 5 | exit 1, no `OK schema`; after `DROP COLUMN`, `OK schema` |
| M10 | the transfer-group test dropped | integration | T42b2-I3, case `S4` |
| N03 | the transfer-in-category test dropped | integration | T42b2-I3, case `S5` |
| M11 | `hidden` rows dropped from spend | integration | T42b2-I3, case `S19` |
| M12 | the authorized date used for the period | integration | T42b2-I5, case `P2` |
| M13 | category rule matched as a `LIKE` prefix | integration | T42b2-I4, case `M10` |
| M14 | the last matching rule wins instead of the first | integration | T42b2-I4, case `M1` |
| N09 | rules ordered by rate instead of stored order | integration | T42b2-I1 `K1`, T42b2-I4 `M1` |
| M15 | merchant matched on `name` only | integration | T42b2-I4, case `M7` |
| N08b | merchant matched case-sensitively (no case fold) | integration | T42b2-I3 `S1`, I4 `M2`, I7, I9 |
| M16 | previous reading picked by arrival (any other row) | integration | T42b2-I6 `C12`, T42b2-I8 |
| M17 | an uncategorised credit counted as a refund | integration | T42b2-I3, case `S8` |
| N04 | an income-category credit counted as a refund | integration | T42b2-I3, case `S6` |
| M18 | the fee's refund reduces spend (pairing test dropped) | integration | T42b2-I3, case `S10` |
| N05 | purchases filtered by the word payment in their name | integration | T42b2-I3, case `S16` |
| N06 | every credit account read, not the linked one | integration | T42b2-I2 to I10 (`S1`, `M1`, `P1`, `C1`, `G1` among them) |
| N07 | a future-dated row counted (no cap at `CURRENT_DATE`) | integration | T42b2-I5, case `P1` |
| N10 | a refund priced at the base rate | integration | T42b2-I4, case `M12` |
| N01 | the sum truncated toward zero instead of rounded half away from zero | integration | T42b2-I2 `E2`, T42b2-I7 `G3` |
| M19 | the comparison percentage rounded at the wrong scale | integration | T42b2-I6 `C1`, T42b2-I8 |
| N11 | readings in different units compared | integration | T42b2-I6 `C13`, T42b2-I10 |
| N12 | a nights program shown as a figure instead of missing | integration | T42b2-I2 `E19`, I5 `P11`, I10 |
| N13 | a gift row excluded for everyone even after its reveal date | integration | T42b2-I7, step `G3` |
| N14 | `FROM transactions` read raw, around the gift read path | command 12 | `FAIL raw transactions read in apps/web/lib/loyaltyEarn.ts` (runs before the amount-key grep) |
| N15 | a spend total emitted in the estimate | integration | T42b2-I8 (exact key list), I5 `P1` |
| M20 | an unlink also clears the earn description (`lib/loyaltyStore.ts`) | integration | T42b2-I8, T42b2-I10 |
| N16 | the rules replaced on the pool, outside the PATCH transaction (`lib/loyaltyStore.ts`) | integration | all ten T42b2 tests time out at 5 s: the pool's statements wait on the transaction's row lock. This shows the replacement must be inside the transaction, but it fails by deadlock rather than by observing a partial write. |
| M21 | a second null sender (Set earn rates also sends `earn: null`) (`components/LoyaltyEarnEditor.tsx`) | command 6 | `FAIL UTC U4=failed(1) T42b2-U4: …` |
| M22 | the estimate printed without the word estimated (`components/LoyaltyEarnLine.tsx`) | command 6 | `FAIL UTC U4=failed(1) T42b2-U4: …` (first try survived; see below) |
| N02c | the figure passed through `parseFloat` | command 12 (scoped diagnostic) | `FAIL clock or float in apps/web/lib/loyaltyEarn.ts` |
| N17 | a convenient figure literal hard-coded in a new test (`loyaltyEarn.test.ts`) | command 15 | `FAIL a figure literal in apps/web/app/api/v1/loyalty/loyaltyEarn.test.ts` |

**Survivors, reported as they happened.**
- *M22, first attempt, survived.* T42b2-U4 searched raw source text, and a header comment in `LoyaltyEarnLine.tsx`
  quoted the phrase, so the comment satisfied the check. Fix: U4 now removes comments with the TypeScript compiler
  (`transpileModule`, `removeComments`) before looking for any phrase or for the single home of "estimated since".
  It also gained a fabricated case that proves a phrase found only in a comment is reported missing. The two comments
  that quoted page wording were reworded. On re-run, M22 was caught.
- *N08, first attempt, survived.* That mutation removed the case fold only from the rule text. The rule texts are
  already lower-case, so the change had no effect. N08b removes the fold from both sides and is caught.
- *N02 / N02b survived.* Passing the already-rounded figure through `Number(…)` is not among the tokens command 12
  checks for (`toISOString|new Date(|Date.now(|parseFloat|toFixed|Math.round|getTimezoneOffset`). At the fixture's
  magnitudes the result also stays byte-identical, so no test can tell. With `parseFloat` (N02c) it is caught. This is
  a gap in the guard's token list, raised for the orchestrator. The implementation does no JS arithmetic on figures.

**Spec-listed mutations not run, and why.**
- The threshold `>=` and the threshold computed on the rounded percentage (`C3` to `C6`). The miss rule is the
  contract's `isEarnMiss` in `packages/contracts/loyalty.ts`, which is frozen; the hook blocks writes there. The
  implementation calls it unchanged with the unrounded figure and actual. `C1` to `C15` pass through it.
- A negative zero (`E6`). Postgres `numeric` has no negative zero, and the figure is Postgres's text, so the mutation
  cannot be expressed in this code. `E6` passes.
- `down` dropping `card_account_id` or the benefit columns: `migrations/**` is frozen.
- The create route taking `earn`: the create input type is the contract's, which is frozen. T42b2-U3 covers it.

## Limits

1. No renderer exists (T21 is NO). Wording is proved over real HTTP for the server-rendered output of `/travel` and
   `/accounts/[id]` (command 10, H13), and the controls by source checks (T42b2-U4) and by the PATCH route they call
   (T42b2-I1). No tap was executed. Phone-width (390×844, installed-app display mode) and desktop (1440×900)
   screenshots were taken with headless Chrome against a scratch database (`b8_screens_p42b2`, demo seed plus
   fabricated `ZQ42B2` rows, dropped afterwards). They show the estimate line, the comparison line and the scope
   sentence on `/travel` and under "Earns into" on `/accounts/zq42b2_shot_card`, and the open editor. They show
   figure-like strings, so none is committed; they stay in the session scratchpad.
2. The estimate is a model: no caps, tiers, rotating categories or sign-up bonuses. The points a program actually
   awards appear only at the next reading, and a rate set wrong shows up as a large miss. The spend rule's accepted
   limits (Open questions 4 and 5) apply:
   - a payment with none of the listed words and a shopping-like category;
   - a refund carrying a listed word;
   - an interest or late-fee debit counted at the matching rate;
   - a held purchase omitted until its reveal date.
3. If Postgres midnight passes between a test computing a date and the handler running, `CURRENT_DATE` could differ.
   This window is negligible, and no command waits across midnight.
4. Editing a rule changes the comparison for a past window on the next read (Open question 15).
5. The fixture's expected values were derived by hand. Every case in it agreed with the implementation on the first
   correct run; no disagreement was found.

## Docs read, skills, palette

- Next docs read (from `apps/web/node_modules/next/dist/docs/`):
  - `01-app/01-getting-started/05-server-and-client-components.md`, for the server/client boundary: the earn line
    has no hooks and renders on either side, while the editor is `'use client'`.
  - `01-app/03-api-reference/04-functions/use-router.md`, for `router.refresh()` after a write.
- The `uiux-promax` skill was invoked before any UI code.
- Palette conflict:
  - The skill says to format currency with `Intl.NumberFormat`. The spec (and T42b2-U4) forbids a second formatter
    on these pages and requires the shared text-based `formatBalance`, so the spec was followed.
  - The `/travel` editor and line use `gray-*`, matching that page. The `/accounts` "Earns into" line uses
    `slate-*`, matching the accounts UI.
  - "Worth a look" uses the design system's warning `text-amber-600`.
- `AGENTS.md` was not re-dirtied by `next dev` during this task.

## Figures scan

This file holds no dollar figure, no comma-grouped number, and no real account, balance or name. The only figures are
point counts and a percentage from the fabricated fixture, quoted in the H13 transcript, plus test, file and lint
counts.
