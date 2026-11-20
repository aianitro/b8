# GATES — P8-42b-card-annual-instruments

## G0 — spec gate — 2026-11-20 — PASS

**Open questions:** every default accepted (owner's standing instruction for this phase: "take spec defaults").
Notably OQ1 fee rule by row name only (whole-word `annual membership fee` / `annual fee`, amount > 0, not a transfer);
OQ4 window 45 days; OQ5 one card ↔ one membership (unique index, 409 `CARD_ALREADY_LINKED`); OQ6 three benefit
columns on `loyalty_memberships`; OQ7 a gift-held row is never a fee for any viewer, `/travel` and four membership
routes become `numeric-only`, `/accounts/[id]` stays `text-bearing`; OQ9 fee amount not shown anywhere; OQ11 only the
latest fee counts.

**Toolchain rows, measured by the orchestrator:** T1 `1`. T2/T3 throwaway DB at head, `pgmigrations` rows `35`.
T4 103/1406. T5 0 errors / 5 warnings. T6 324, failing `[]` (as measured at P8-42a2 G4). T7 `exit=0`. T8 `exit=0`.
T9 port `0`, `OK H1-H11`. T10 `exit=0`. T11 the twelve P8-42a2 lines start as the regression commands expect
(`set -e; for TZV …`, `RESET; echo "OK as-of bound"`, `echo "OK failure class"`, …, `echo "OK coarse source
checks"`). T12 commands 9-12 on the unmodified tree: `OK 10 scenarios U1-U10 …` ×2, `OK 3 scenarios T42a2-U1..U3 …`
×2, `OK as-of bound`, `OK failure class`, `OK import end to end`, `OK sidebar`, `OK source guards`, `OK fixtures
fabricated`, `OK coarse source checks`. T13 `Test Files  1 passed (1)`. T14 `0`. T15 `reached`. T16 `6`. T18 the
surface script's gift INSERTs at lines 140-144. iCloud: `0` dataless files under the paths the commands read.

**T17 adjudicated:** work happens on `main`, uncommitted, as in P8-42a and P8-42a2. `git merge-base HEAD main` is then
`HEAD`, and `git diff --name-only HEAD` plus untracked files is exactly the task's change, so command 16 is not
vacuous. Nothing may be committed before G4.

**Dry checks of the new commands:** every extracted block parses (`bash -n`). On the unmodified tree #5 exits 1
under `set -e`, as expected before the migration.

**Amendment A0 (orchestrator):** command 14 failed with `[: too many arguments` on the unmodified tree. Cause: macOS
`/bin/bash` 3.2.57 brace-expands a double-quoted `{ …, … }` pattern nested inside `"$( … )"`; `bash -x` showed one
grep split into two. Every `[ "$(grep -cF "<pattern>" "$R|$X")" = 1 ]` in #14 (six lines) became
`p="<pattern>"; [ "$(grep -cF -- "$p" "$R|$X")" = 1 ]`. The patterns are unchanged. Verified per line on the unmodified
tree: the unchanged-class lines (seven routes `no-transaction-data`, `/accounts/[id]` `text-bearing` in both files)
pass; the four lines needing this task fail. No other command contains the construct.

Spec frozen.

## G1 — contract gate — 2026-11-20 — PASS

Guardian deliverables: `migrations/1792800000000_loyalty_card_benefit.sql` (new, the newest migration: listing ends
`1792600000000_receipt-captures.sql`, `1792700000000_loyalty.sql`, this one), `db/schema.sql`,
`packages/contracts/loyalty.ts`, `CONTRACT.md`. Change class **additive**.

Orchestrator re-runs: **#4** `OK migration up-down-up`. **#5** every schema assertion passes (table set, column sets,
no stored fee/state/amount column, the partial unique index, the `db/schema.sql` block, no stale comment in schema or
contracts, benefit columns only in the new migration); the command then stops at `FAIL stale reserved comment in the
store` on `apps/web/lib/loyaltyStore.ts:10,375`, which is implementer surface. `tsc`: the only errors are the expected
consumers (`lib/loyaltyStore.ts` 2, `app/api/v1/loyalty/loyaltyResponses.ts` 2).

**Guardian resolutions accepted:** credit type is enforced by the route (400 `INVALID_INPUT`), not the database; no
column DEFAULT for the window (the route writes 45 when absent, keeping the all-or-none CHECK); the three benefit
columns are null together or all set; added refines — card id and name null together, `feeWatch` null exactly when no
card, `state` null exactly when no benefit (the implementer's fixtures must respect these); `cardAccountName` may be
`''`. The applied migration `1792700000000_loyalty.sql` keeps its old header comment (applied migrations are never
edited; #5 does not read it).

Lease closed.

## G2 — build gate — 2026-11-20 — PASS (cycle 0, amendments A1 and A2)

**Implementer's report:** every command green except #3 and #9, both failing on one existing test, `T42a-U8`. That
test pinned all eleven loyalty routes and `/travel` to `no-transaction-data` and the surface script to `OK H1-H11`,
while #13 and #14 require this task's reclassification (OQ7). It was raised, not absorbed.

**A1 (orchestrator):** the five pinned lines of `T42a-U8` were rewritten to the new required state at the same
strictness: the four membership-view routes `numeric-only` via a literal list, the other seven `no-transaction-data`,
`/travel` `numeric-only` in the registry and the script, and `OK H1-H12`. The orchestrator applied this mechanical
edit itself. A guard pinning the file's diff to exactly those lines (5 removed, 7 added) is in the spec and runs with
#17: `OK A1 limited to T42a-U8`.

**A2 (orchestrator):** after A1, #15 failed with `FAIL clock or float in apps/web/lib/loyalty.test.ts`. The match is
that file's pre-existing line 494 (T42a's own absence regex, present at `HEAD`). #15 now excludes exactly that file
from its scoped list. Mutation proof: appending `new Date()` to `lib/loyaltyStore.ts` gives `FAIL clock or float in
apps/web/lib/loyaltyStore.ts`; reverted, `OK task source guards`.

**iCloud:** `0` dataless files under the read paths.

**Every acceptance command re-run by the orchestrator on the final tree** (bash, `PRIOR_REDUCER=6`):
- #1 `exit=0`.
- #2 `✖ 5 problems (0 errors, 5 warnings)`, `exit=0`.
- #3 `Test Files  104 passed (104)`, `Tests  1410 passed (1410)`.
- #4 `OK migration up-down-up`.
- #5 `OK schema`.
- #6 `OK 4 scenarios T42b-U1..U4 each present once and passed`, for TZ=UTC and Pacific/Auckland.
- #7 `OK 334 tests, T42a-C1-C11 and I1-I11 and T42a2-I1-I3 and T42b-I1-I10 each present once and passed`, `OK no fixture rows left`.
- #8 `[]`, `[]`, `OK failing set stable and within KNOWN`.
- #9 `OK 10 scenarios U1-U10 …` ×2 and `OK 3 scenarios T42a2-U1..U3 …` ×2.
- #10 `OK as-of bound`, `OK failure class`.
- #11 `OK import end to end`.
- #12 `OK sidebar`, `OK source guards`, `OK fixtures fabricated`, `OK coarse source checks`.
- #13 `H1 PASS` to `H12 PASS`, then `OK H1-H12`, `OK surface`.
- #14 `OK classes`.
- #15 (after A2) `OK task source guards`.
- #16 no output.
- #17 `OK existing tests only gained the new keys; removed lines 3`.
- A1 guard: `OK A1 limited to T42a-U8`.
- #18 `exit=0`.

**Orchestrator read of the core query** (`lib/loyaltyStore.ts` FEE_WATCH_SQL), which matches the spec:
- name-only whole-word fee phrases; `amount > 0`, not in a transfer group;
- rows from `visibleTransactions(null)` with gift-masked rows excluded;
- a refund cancels only the latest fee of the negated amount on or before it;
- `received` needs `COALESCE(issued_on, created_at::date) >= fee date`;
- `awaiting` while `CURRENT_DATE <= fee + window`.

**Evidence gaps, flagged for G3/G4:**
- The spec's phone and desktop screenshots were not taken. UI wording is proved over HTTP by H12 and by U4.
- Roughly 14 of the spec's listed mutations were not run; EVIDENCE.md lists them.
- Known gap outside the spec: two refunds can both cancel the same fee.

## G3 — adversarial gate — 2026-11-20 — PASS (cycle 0)

REVIEW-1 (persisted by script from the reviewer's transcript): **ACCEPT_WITH_NITS**. 36 hypotheses, all refuted
except one uncatchable spec mutation. Three NITs, recorded as NITS.md N1–N3 with the evidence gap as N4. No BLOCK, no
scope violation. A1 and A2 were reviewed and found not to weaken anything.

Inconclusives, run by the orchestrator; both files were restored byte-identical (`cmp`):
- Deleting the refund-pairing subquery gives `Tests  10 passed (10)` on `loyaltyCard.test.ts`. This confirms N1: the
  spec mutation "refund cancels every equal fee" cannot be caught, because it changes no output.
- Rendering `got it` in place of `received` in `LoyaltyFeeWatchLine.tsx` gives `H12 FAIL step 6: the pages do not
  say received (owner)`, so H12's page positives are real.

**N3 ratified:** both narrowings are forced by facts that predate this task (H3's giver view, existing db-importing
components).

## G4 — integration gate — 2026-11-20 — PASS

Fresh run on the final tree:
- iCloud: dataless `0`.
- Unit: `Test Files  104 passed (104)`, `Tests  1410 passed (1410)`.
- Lint: `✖ 5 problems (0 errors, 5 warnings)`.
- tsc: `exit=0`.
- Scope guard #16: no output.

G2's #4, #5, #7, #8, #13 and #18 stand for the same tree; the G3 mutations were reverted and verified with `cmp`.

**Migration** `1792800000000_loyalty_card_benefit.sql` is additive: three nullable columns, one table CHECK and one
partial unique index. It is safe on prod, where no membership has a card yet, so the index cannot conflict.

**Public-repo scan** of added lines:
- Comments, docs and plan text contain no money-like figure.
- Test code contains fabricated ZQ42B fixture amounts, as 24 existing test files already do, including several added
  after the rule. No real card, program or member names appear.

**Accepted evidence gap:** NITS.md N4 (screenshots).

**Cycle count:** 0 / 3. **MERGED.**
