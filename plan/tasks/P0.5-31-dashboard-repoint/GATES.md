# GATES — P0.5-31-dashboard-repoint
<!-- Append-only audit trail. -->

| Gate | Result | When | Evidence |
|---|---|---|---|
| G0 spec | **PASS** | 2026-09-02 | 60 acceptance commands. Every before-state claim re-measured by the orchestrator; one suspected vacuity chased down and found closed by a non-obvious command pairing; two conflicts ruled. A tree defect that made acceptance #1 unsatisfiable was found and fixed at this gate. See the G0 log. |
| G1 contract | **SKIP** | 2026-09-02 | Contracts touched: none. Every column the page needs exists; `MonthOutlook`/`CategorizationCoverage` are module-local. Re-opens if the implementer reports otherwise — note the spec re-defers **N21** precisely because discharging it would need a `CHECK` migration, i.e. G1. |
| G2 build | **PASS** | 2026-09-02 | All 60 rows re-run. `tsc` 0, lint `1 problem (0 errors, 1 warning)`, build compiles, `21 passed (21)` / `399 passed (399)`. Every transition count confirmed. Two implementer-disclosed gate gaps independently mutation-verified as closed. Two spec defects adjudicated. See the G2 log. |
| G3 adversarial | **PASS** | 2026-09-02 | ACCEPT_WITH_NITS, 26 hypotheses (20 refuted), no BLOCK. N40–N51 recorded. **N51 verified by the orchestrator and escalated to the owner — see the G4 log.** |
| G4 integration | **PASS on its checklist**, **release held** | 2026-09-02 | Suite/tsc/lint/build/round-trip all clean and every reviewer INCONCLUSIVE item run. **Merge withheld pending an owner decision**: a migration merged on 2026-09-01 has never been applied to the dev database, so this diff would 500 the dashboard there. See below. |

**Cycle count:** 0 / 3

## G0 log

**The tree could not satisfy acceptance #1 when the spec was written, and the spec caught it.**
`npx tsc --noEmit` was exiting **2**, not 0 — `.next/types/cache-life.d 2.ts` (TS6200) and
`.next/types/routes.d 2.ts` (TS2300). **36** Finder/iCloud duplicates had accumulated since the last
sweep, including `lib/domain/pacing 2.ts` and `lib/domain/pacing.test 2.ts` — the same shape that
broke P0.5-29a's `tsc` and P0.5-29a's G4 migration round-trip.

Disposition, by class rather than by a blanket delete:

| Class | Count | Action |
|---|---|---|
| `.next/**` generated output | 27 | **deleted** — regenerable by `next build`, and actively breaking `tsc` |
| source + `plan/` | 8 | **quarantined** outside the repo, reversible |
| `.git/index 2` | 1 | **left alone** — a stale copy of git's index from 2026-07-29. Git does not read it and it is inert; deleting inside `.git` on a hunch is not warranted |

The spec's suggested remedy was a single `find … -delete`, which would have swept `.git/index 2`
with the rest. Looking before deleting is why that did not happen. Re-measured after:
`tsc exit=0`, `369 passed (369)`, zero duplicates outside `.git`.

**Every before-state claim re-measured, not accepted:**

| # | Claim (today → required) | Measured today |
|---|---|---|
| 30 | `netWorth\|net_worth\|Net Worth` on the dashboard, 26 → 0 | **26** |
| 31 | `new Date(` on the dashboard, 7 → 1 | **7** |
| 32 | `monthsElapsed\|expectedYearSpend\|yearPacePct\|pctYear\|getMonth() + 1`, 14 → 0 | **14** |
| 33 | `EXTRACT(YEAR FROM CURRENT_DATE)`, 5 → 0 | **5** |
| 34 | `EXTRACT(MONTH FROM t.date)::int - 1`, 0 → 1 | **0** |
| 35b | `control_mode` on the page, 0 → ≥1 | **0** |
| 47 | `control_mode` in the seed, 0 → >0 | **0** |
| 56 | stale README caption, 1 → 0 | **1** |
| 40/41/42 | adherence 47, pacing 24, four-file diff 0 | **47 / 24 / 0** |
| — | `lib/domain/monthOutlook.ts` must not yet exist | absent |

**A suspected vacuity, chased and closed.** Acceptance #35 expects `0` **both before and after**
(`detectAdherence(`/`scoredHeadline(`/`categoryPacing(` absent from the page), so it cannot witness a
transition. On its own it is satisfied by a page that calls *nothing* — an implementation could
delete net worth, strip the year-pace family, add the SQL and render a static hero, passing #30–#36
with `monthOutlook` never wired in, while the module's own 20 tests stayed green.

It is closed, but by a pairing worth writing down because it is not obvious from either command
alone: **#35a** (`^import .*from '@/lib/domain/monthOutlook';` → `1`) proves the import exists, and
**#3** pins lint at exactly `1 problem (0 errors, 1 warning)`. Verified by experiment — adding an
unused import to a linted file produces `✖ 2 problems (0 errors, 2 warnings)`, failing #3. So
*import present* + *no extra lint warning* ⇒ **the import is used**. The wiring is gated; it just
takes two commands and a lint config to see it.

**Explicitly not gated, and the spec says so rather than pretending otherwise.** No command proves
DOM order or that a human reads a budget question first; #36 (first `data-testid` in the file is
`month-outlook-hero`) is labelled a source-order proxy, not a gate. That is the honest disposition
for a repo with no component-test toolchain, and it is better than a grep dressed up as proof.

## Adjudications — G0
| Claim in dispute | Basis | Decision |
|---|---|---|
| **A1. §5 vs BUILD.md §5.1 on screenshots.** §5 binds the screenshot set into "this step's diff, not a follow-up". Regenerating it means backing up, truncating and restoring the dev database holding **real financial data** (README §77) — a §5.1 human escalation. The spec resolved for §5.1 and asked to be overturned if I disagreed. | BUILD.md's escalation triggers bind the orchestrator; §5 is an ordering document, not a safety one. Where they meet at a safety boundary, the boundary wins. | **Spec upheld. The owner captures the images; no agent performs the destructive sequence.** This is not an override of §5 so much as a split of its deliverable at the safety line: the seed fix and the README caption **do** land in this diff, and #38 requires `docs/screenshots/**` byte-identical, which makes the staleness *visible and blocking* rather than silently forgotten. **Consequence recorded honestly: this task can reach MERGED with an outstanding owner handoff**, and the queue must carry it rather than let §5's "part of this step's diff" quietly go unmet. |
| **A2. Do the "This Year" card and year-pace bar survive the re-point?** §5's supporting-card list (category pacing, uncategorized queue, off-cycle and breach alerts) omits them; neither §5 nor ITEM.md says whether they die or relocate. The spec removed them. | The incumbent defect (`monthsElapsed = getMonth() + 1`, treating 1 April as 33.3% elapsed against a true 24.7%, inflating expected spend and flattering the pace) lives in exactly that family, and acceptance #32 requires it gone. Relocating a defective card would carry the defect to a new file — the N2 mistake, which §5 elsewhere goes out of its way to prevent. | **Removal upheld.** Surfaced to the owner as the one aesthetic decision the roadmap did not make, since "delete" and "move to `/budget`" are both defensible readings of a silence. |

## G2 log — 60 rows re-run by the orchestrator

| Check | Result |
|---|---|
| #1 `tsc` | exit `0` |
| #2 suite, nothing skipped | `1` — `Test Files 21 passed (21)`, `Tests 399 passed (399)` (369 + 24 + 6) |
| #3 lint | `✖ 1 problem (0 errors, 1 warning)` — the pairing that proves the import is *used* still holds |
| build | `✓ Compiled successfully` |
| #38 `docs/screenshots/**` byte-identical | `0` — **no agent captured a screenshot** |

**The ideology change, as measured transitions:**

| # | Before → After |
|---|---|
| 30 `netWorth\|net_worth\|Net Worth` on the dashboard | **26 → 0** — §5's exit criterion, literally |
| 31 `new Date(` | **7 → 1** |
| 32 `monthsElapsed\|expectedYearSpend\|yearPacePct\|pctYear\|getMonth() + 1` | **14 → 0** — the incumbent defect removed, not relocated (A2) |
| 33 `EXTRACT(YEAR FROM CURRENT_DATE)` | **5 → 0** |
| 34 `EXTRACT(MONTH FROM t.date)::int - 1` | **0 → 1** |
| 35 / 35a domain calls / `monthOutlook` import | **0 → 0** / **1** |
| 35b `control_mode` on the page | **0 → 4** |
| 47 `control_mode` in the seed | **0 → 3** — N7 discharged |
| 56 / 57 README caption | **1 → 0** / **0 → 1** |
| 40 / 41 / 42 tripwires | **47 / 24 / 0** — adherence and pacing untouched |

**An orchestrator error, recorded.** My first sweep scored #56 as failing. I had approximated its
command as `grep -c 'net-worth.jpg' README.md` instead of reading it. The real #56 is
`grep -c 'net worth composed from its four parts'` → `0`, which passes; `net-worth.jpg` legitimately
survives because `/net-worth` still exists and is still screenshotted. **The failure was in my proxy,
not the work** — the same class of error as G2's A2 on the previous task, and the reason gates must
run the spec's literal command rather than a paraphrase of it.

**Two gate gaps the implementer found and closed *itself*, independently verified by mutation:**

| Mutation | Suite | Verdict |
|---|---|---|
| swap `breach` / `projected-breach` in the ladder | `1 failed \| 398 passed` | the adjacency it added is real; **acceptance #9 would have passed with the ladder mis-ordered** before it |
| drop `budgeted > 0` from the breach condition | `4 failed \| 395 passed` | the most heavily gated line in the module |
| collapse `nothing-to-score` into `on-track` | `1 failed \| 398 passed` | N12's distinction is gated at the surface that can first get it wrong |

`sha256(lib/domain/monthOutlook.ts)` `fefcde2e…53ba` before and after all three; reverted
byte-identically. This is the third consecutive task where the implementer disclosed a gap rather
than shipping it green, and the second where its own disclosure was the cheapest route to the fix.

## Adjudications — G2
| Claim in dispute | Discriminating command | Output | Decision |
|---|---|---|---|
| **A3. The frozen spec's Fixture H9 is arithmetically impossible.** Its row 2 (`$300` at day 8 of 30 against a `$500` month) is asserted to produce `state: 'on-track'`. The implementer substituted `300 → 100` and asked for confirmation rather than assuming it. | `node -e` on the fixture's own inputs | `$300 / (8/30)` → **projected `$1,125`** against `$500` — a projected breach, so `'on-track'` is unreachable from the fixture's own inputs. `$100` → `$375` → on-track. | **Substitution upheld, and the spec is the defect.** The change is one input; every assertion H9 states is preserved. Correct escalation by the implementer: reported, not absorbed. Note the frozen spec file itself was **not** edited (`SPEC.md` mtime 14:29, `.frozen` 14:34), which is the rule holding by convention here since the scope-guard hook is inactive (QUEUE.md H2). |
| **A4. Acceptance #52 is unsatisfiable by ordinary code.** `grep -c 'comparableYtdDelta' app/net-worth/page.tsx` expects exactly `1`, but an import line plus a call site is inherently 2 occurrences. The implementer satisfied it with an import alias and flagged it as "uncomfortably close to grep-gaming". | Read the resulting code | `import { comparableYtdDelta as ytdDelta, … }` at `:11`, used at `:80`. The alias is live, not dead. | **Code accepted; the spec is the defect.** An exact-count `grep` for "this symbol appears" should have been `-ge 1`, and forcing a code shape to satisfy a counter is the tail wagging the dog. The gate still holds by the same pairing as #35a: the import exists, and lint pinned at one problem proves it is used. **Recorded as a spec-authoring lesson for step 32's spec, and the disclosure is to the implementer's credit.** |
| **A5. The seed writes no `liabilities_security_deposits`**, so `comparableYtdDelta` returns `null` on demo data and the corrected YTD delta will not appear in a regenerated `net-worth.jpg`. | Reported by the implementer, outside the declared seed changes | — | **Accepted as out of scope, and carried to the owner handoff** — it changes what the screenshot can show. Not a defect in this diff. |

## G3 log

ACCEPT_WITH_NITS. 26 hypotheses, 20 refuted, each with method — including the ones that mattered
most on a task whose renderer is ungated: no reachable crash path (all seven `assertCallerContract`
throws proved unreachable from what the page can supply), `STATE_COPY` exhaustive by type so no
state renders blank, no `null` rendered as `0`, and no category in the wrong bucket. It also
**re-derived and upheld G2's A3 ruling** on the impossible H9 fixture independently.

Twelve nits, N40–N51. The reviewer declined to BLOCK N40 (an `on-track` hero renderable over
unbudgeted discretionary spend) with reasoning I accept: the ladder producing it is the frozen
spec's own rung table, gated and mutation-verified; the offending text is renderer copy in the layer
the spec explicitly declared ungated; no number is wrong; and step 32 already owns the threshold
below which a figure refuses to be authoritative. Charging a cycle for a spec silence would be the
wrong incentive on a task where the implementer disclosed two of its own gate gaps.

## G4 log — integration

| §7.5 item | Result |
|---|---|
| Full suite | `Test Files 21 passed (21)`, `Tests 399 passed (399)` |
| Types / lint / build | exit `0` / `1 problem (0 errors, 1 warning)` / `✓ Compiled successfully` |
| Migration round-trip (throwaway `b8_roundtrip_p0531`) | `8 → 0 → 8`, 16 tables, clean |
| INCONCLUSIVE items | **all five run** — see below |
| Truthfulness | `monthOutlook(` has one non-test caller; `detectAdherence(`/`scoredHeadline(`/`categoryPacing(` have none outside `lib/domain/**` |
| No real financial data | screenshots byte-identical (#38); no agent ran `seed:demo` against `.env.local` |

**Reviewer INCONCLUSIVE items, converted to commands and run:**

| # | Result |
|---|---|
| N43 orphaned mappings | `0` — no category rename has orphaned a mapping today |
| N47 clock seam | `psql CURRENT_DATE` = `2026-09-02`, Node local = `2026-09-02` — **the two calendars agree in this deployment**; the seam is real in principle, not live in practice |
| N46 comparison window | 15 snapshots, earliest `2026-08-08`, and **`0` carry `liabilities_security_deposits`** |
| N51 premise | **confirmed, and worse than stated — see below** |
| N44 cardinality | not run: needs a live server against seeded data; deferred to the owner's page-open list, item 4 |

**N46 is wider than G2's A5 recorded.** A5 noted the *demo seed* writes no
`liabilities_security_deposits`. Measured against the **real** database: `0` of `15` snapshot rows
carry it either. So `comparableYtdDelta` returns `null` on real data too, and `/net-worth` renders
"First recorded reading" rather than the corrected delta. **The N2 fix is correct and currently
invisible on both datasets.** Not a defect in this diff; the column populates as new snapshots
accrue.

### Release held — an operational gap this gate found, outside the diff

**`migrations/1788271200000_category-control-mode.sql` — merged 2026-09-01 as P0.5-28 — has never
been applied to the dev database.**

```
pgmigrations: ... 1787871600000_tenant-held-funds   (2026-08-31)   ← last applied
migrations/:  ... 1788271200000_category-control-mode              ← on disk, never run
psql: SELECT control_mode FROM budget_categories → ERROR: column "control_mode" does not exist
```

Consequences, in order of severity:

1. **`GET /api/categories` is already broken against the real database** and has been since
   2026-09-01 — P0.5-28 added `control_mode` to that SELECT. This predates the current task.
2. **Merging this diff extends that failure to the dashboard**, which selects `control_mode` at
   `app/dashboard/page.tsx:111`. The main page would 500 rather than one API route.
3. **Even after the migration runs**, the column defaults to `'fixed'` for every existing row
   (`ADD COLUMN control_mode TEXT NOT NULL DEFAULT 'fixed'`), so `isScoredCategory` admits nothing
   and the new hero renders **"Nothing to score yet"** — which is N51, verified.
4. **Nothing in the app can change that.** `control_mode` appears in `app/api/categories/route.ts`
   only inside the GET's SELECT list; the PATCH handler branches on `is_income`, `annual_budget`,
   `dedicated_account_id`, `monthly_amounts` and `name`, and has no `control_mode` branch. No UI
   references it. The hero's "Classify your categories" link leads to a page with no such control.

**Why this is escalated rather than fixed here.** Applying the migration is a write to the database
holding real financial data — the owner's call, not an agent's. Adding a `control_mode` write path
is a new API surface and a new UI control: out of this task's declared scope and frozen spec, and
plausibly its own roadmap step. **Step 28's exit criterion — *"every operational category carries a
control classification, and the set the headline number is computed over can be named out loud"* —
is met in the schema and not in the running system.** That gap was invisible while every consumer
was a pure function over fabricated fixtures; the first real surface is what surfaced it.

**The task itself passes.** Every gate criterion is met, the diff is correct against its spec, and
nothing here is the implementer's or the reviewer's to fix. The hold is on *merging into a state the
owner has not chosen*, not on the work.
