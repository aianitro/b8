# GATES — P8-42b2-card-earn-estimate

## G0 — spec gate — 2026-11-20 — FAIL (cycle 1)

**Open questions:** every default (OQ1–OQ16) accepted, per the owner's standing instruction to take spec defaults.

**Dry checks by the orchestrator:**
- Every acceptance block parses (`bash -n`).
- `done < <(…)` works on `/bin/bash` 3.2.57 (`ok-procsub`).
- Lint prints its summary line on the clean tree.
- The P8-42b line references used by #9 and #11 (275, 280, 286, 293, 298, 301, 306, 316, 332, 340) land on the
  expected block starts and ends.

**Reason for FAIL — public-repo rule.** The draft carries about 20 money-like fabricated figures in plan text
(Conventions, Scenarios, #15), for example the exact arithmetic cases. AGENTS.md forbids a money-like figure in any
tracked file and exempts only counts, versions and `evals/golden/`. Test files in the repo already hold fabricated
amounts, but no spec under `plan/` does, and this one must not start the practice. Required rework:
1. Move every exact arithmetic case into a test fixture file. The file states at its top that it is fabricated, and the
   spec pins it by `shasum -a 256` so it stays binding: the orchestrator writes it at G0, and the implementer may not
   edit it.
2. The spec then refers to cases by id and states the rule (round once, half away from zero, …) without a figure.
3. Delete #15's decoy first block.

## G0 — spec gate — 2026-11-21 — PASS (cycle 2)

**Rework:** all exact arithmetic cases moved into `apps/web/lib/fixtures/loyalty-earn-cases.json`, whose `note` field
declares it fabricated. The spec draft carried the file's content in a fenced block; the orchestrator wrote that block
to disk and replaced it in the spec with a pointer and the file's sha256 `1dcd2fa812a05d954dacf9e3827dae9703e66565013a9f2fad08ae0b2c2b93b2`, which also fills command 15's four
`SHA256_PENDING` placeholders. The spec now has `0` money-like figures (`grep -cE "[0-9]+\.[0-9]{2}\b"`), and the
remaining `$<digit>` hits are shell positional parameters.

**Fixture verified independently** by a Python `Decimal` recomputation (first-match rules, round once half away from
zero, `-0` to `0`, scale 2 for usd):
- 16 of 19 estimate cases computed, `0` mismatches; E14, E15 and E19 carry no single-figure expectation.
- Every comparison case's percentage and 25%-threshold flag agree.

**Toolchain:**
- T2 `1792800000000_loyalty_card_benefit`; T14 `0` rows; T16 `1`; T19 `true`; T20 `3`; T23 `json ok`.
- T4–T10 as measured at P8-42b G4 on the same tree: 104/1410, 0/5, 334 `[]`, tsc `exit=0`, node ok, `OK H1-H12`,
  build `exit=0`.
- T11/T12: command 9 on the unmodified tree, through its prefix-guarded extraction of P8-42b lines 275–340, gives all
  eleven OK lines. Command 11 gives `OK classes`, `OK no class line changed`.
- T17: on `main`, uncommitted.

**Command 15 on the unmodified tree:** `fixture shape ok`, then fails only on the missing new test file, as expected.

Spec frozen.

## G1 — contract gate — 2026-11-21 — PASS (amendment A1)

Guardian deliverables, all **additive**:
- `migrations/1792900000000_loyalty_earn_rules.sql` (new; now the newest migration): `loyalty_memberships.earn_base_rate`
  and the table `loyalty_earn_rules` with `UNIQUE (membership_id, position)` and cascade on membership delete.
- `db/schema.sql`, `packages/contracts/loyalty.ts` and `CONTRACT.md`.

**A1:** the guardian predicted that #5's index pattern could not match, because `pg_get_indexdef` quotes the keyword
`position`. Measured, the throwaway DB prints `… USING btree (membership_id, "position")`. The pattern now matches the
quoted form (recorded in the spec).

Orchestrator re-runs:
- #4 `OK migration up-down-up`.
- #5 (after A1) `OK schema`.
- tsc: one expected consumer error, in `lib/loyaltyStore.ts`.
- Money-like figure scan of the migration, CONTRACT.md and the added contract/schema comment lines: none.

**Guardian resolutions accepted:**
- Merchant charset and length live in the contract only; the database keeps a shared trimmed 1–100 bound.
- Rates are validated as text, never as floats.
- Rule input is a discriminated union on `kind`.
- Duplicate rules are refused by case- and space-folded comparison.
- Three cross-field refines were deliberately left out (the percentage's rounding, estimate unit equal to membership
  unit, comparison `to` equal to `asOf`), so contract fixtures can cover every unit. The integration tests pin those
  values instead.

Lease closed.

## G2 — build gate — 2026-11-21 — PASS (cycle 0, amendment A2, interpretation A3)

**Implementer's report:** 15 of 16 commands green; #12 failed with `FAIL a spend or amount key in a page source`. It
also reported three spec issues rather than absorbing them.

**A2 (orchestrator):** #12's spend/amount-key scan covered every component, and 21 untouched component files match it at
`HEAD` (`git grep -c … HEAD -- 'apps/web/components/*.tsx' | wc -l` → `21`). It is narrowed to the task's page surface
(`components/Loyalty*`, `Travel*`, `AccountEarns*`, `app/travel/*.tsx`). The implementer's surviving float mutation
N02b (`Number(figure) * 1`) led to a new refusal of `Number(` in `lib/loyaltyEarn.ts` and `components/LoyaltyEarn*.tsx`;
neither file uses it today. Mutation proof: appending a `Number()` helper to `LoyaltyEarnLine.tsx` gives
`FAIL Number() on an earn figure`; reverted (`cmp` identical), `OK task source guards`.

**A3 (interpretation, accepted):** the surface script's pre-existing plain row `zq41b-check-plain` is an ordinary
purchase on the same scratch card, dated today, so it would price into H13's estimate. H13 moves it to the day before
its reading, in the script's own scratch DB, after H12 has finished (`current = 'H13'` precedes the UPDATE), so H1–H12
cannot see the change.

**Not runnable by the implementer, because the code is frozen:** mutations to `isEarnMiss` (contract), to the
migration's down, and to the create input. Negative zero cannot be expressed in Postgres numeric (fixture E6 passes).

**iCloud:** `0` dataless files under the read paths.

**Every acceptance command re-run by the orchestrator on the final tree** (`PRIOR_REDUCER=6`):
- #1 `exit=0`.
- #2 `OK lint 0 errors, warnings not above 5`.
- #3 `OK unit 105 files 1414 tests`.
- #4 `OK migration up-down-up`.
- #5 `OK schema`.
- #6 `OK 4 scenarios T42b2-U1..U4 each present once and passed`, for TZ=UTC and Pacific/Auckland.
- #7 `OK 344 tests, T42a-C1-C11 and I1-I11 and T42a2-I1-I3 and T42b-I1-I10 and T42b2-I1-I10 each present once and
  passed`, `OK no fixture rows left`.
- #8 `[]`, `[]`, `OK failing set stable and within KNOWN`.
- #9 all eleven regression OK lines.
- #10 `OK H1-H13`, `OK surface`.
- #11 `OK classes`, `OK no class line changed`.
- #12 (after A2) `OK task source guards`.
- #13 no output.
- #14 `OK existing tests edited only as allowed; removed lines 3`.
- #15 `OK fixture pinned and covered`.
- #16 `exit=0`.
- The fixture's sha256 is unchanged (`1dcd2fa8…2b93b2`).

**Orchestrator read of `lib/loyaltyEarn.ts` EARN_SQL:**
- rows come from `visibleTransactions(null)` with `NOT t.gift_masked`;
- category rules use exact trimmed, case-folded equality on `mapped_category`, and merchant rules match a whole-word
  phrase in the folded `name` or `merchant_name`;
- transfers and transfer-named categories are excluded, as are income categories for credits;
- the window comes from `CURRENT_DATE`, capped at `CURRENT_DATE`;
- the total is rounded once with `round(…, scale)`.

**Evidence:**
- 40 mutations, all 9 required ones caught.
- N16 (rules replaced outside the transaction) is caught only by a timeout, not by observing a partial write.
- Screenshots exist in the scratchpad only, since they show fabricated figures, and are not committed.

## G3 — adversarial gate — 2026-11-21 — PASS (cycle 0)

REVIEW-1 (persisted by script from the reviewer's transcript): **ACCEPT_WITH_NITS**, 29 hypotheses, 27 refuted and 2
confirmed as NITs, with 7 NITs in all. No BLOCK, no scope violation. A2 and A3 were reviewed and found to hide nothing.

Inconclusives, run by the orchestrator:
- Merchant escaping in the Postgres ARE for `&`, `'` and `-` → `t|t|t|f` (each literal; `a-b` does not match `axb`).
- Fee-watch logic in `lib/loyaltyStore.ts` unchanged → no output.
- Decimal literals in added comments → only `LoyaltyEarnEditor.tsx:34`, plus a section number `§9.3`.

**REVIEW NIT 1 fixed by the orchestrator** (comment-only, one line): that comment held a rate example in figures, and
now says it in words. The public-repo rule is about figures in comments, so this was not left as a follow-up. The
remaining six NITs are NITS.md N1–N6.

## G4 — integration gate — 2026-11-21 — PASS

Fresh run after the G3 comment edit:
- iCloud: dataless `0`.
- tsc `exit=0`.
- #2 `OK lint 0 errors, warnings not above 5`.
- #3 `OK unit 105 files 1414 tests`.
- #6 OK for both zones.
- #12 `OK task source guards`.
- #13 no output.
- #14 `OK existing tests edited only as allowed; removed lines 3`.
- #15 `OK fixture pinned and covered`.

G2's #4, #5, #7–#11 and #16 stand: the only change since is that comment.

**Migration** `1792900000000_loyalty_earn_rules.sql` is additive (one nullable column and one new table). It is safe on
prod, where no membership exists yet.

**Public-repo scan** of added lines, excluding the declared-fabricated fixture: no money-like figure in comments or
docs. The one regex hit is a sed line range in the spec's toolchain table.

**Cycle count:** G0 2, the rest 0. **MERGED.**
