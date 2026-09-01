# NITS — P0.5-28-category-control-mode
<!-- Findings real enough to record, not severe enough to block a gate. Each names who owns it. -->

## N1 — `app/categories/page.tsx` will hold a type lie once this merges
Raised by contract-guardian, confirmed by the orchestrator at G1.

`app/categories/page.tsx:9` runs its **own** explicit-column `SELECT` into
`db.query<BudgetCategory>()`, separate from the API route's. It does not select `control_mode`,
so every row it hands `CategoryManager` is typed as carrying a required `control_mode` that is
`undefined` at runtime.

Inert today — nothing reads the field — but it is this spec's own listed failure mode, in the
"or the reverse" direction: *"`shared/types.ts`'s field typed optional/nullable despite the schema
guaranteeing `NOT NULL`, or the reverse."*

**The repair is the `SELECT`, never the type.** Making the field optional would move the lie into
the contract and hand every downstream reader a fallback for a state the database cannot produce.
Out of scope here — the spec makes that file an explicit non-goal and only the API route's `GET`
is in scope (acceptance #12). Owner: a follow-up task.

## N2 — a stray `-- down migration` comment in an Up body silently truncates the migration
Found at G1 while testing a contract-guardian hypothesis that turned out to be backwards.

`node-pg-migrate` splits SQL migrations with
`new RegExp('^\\s*--[\\s-]*' + direction + '\\s+migration', 'im')` via `content.search()`
(`node_modules/node-pg-migrate/dist/bundle/index.js:2690`). `search()` returns the **first** match,
so a second `-- up migration ...` line later in the file is harmless — the guardian's hypothesis
was refuted by direct test.

The **inverse** is not harmless and was confirmed by direct test: a comment line matching
`^\s*--[\s-]*down\s+migration` inside the **Up** body ends the Up section there. Everything after
it is silently skipped and `node-pg-migrate up` still **exits 0**. Measured: a probe migration
creating two tables, with such a comment between them, created only the first and reported success.

No live instance — all 8 migrations in `migrations/` carry exactly one up marker and one down
marker, this task's included. But this repo writes unusually long prose comments inside migrations,
which is exactly the condition that makes a line beginning "down migration ..." plausible.

**Suggested guard**, one regex over `migrations/*.sql` in CI or the pre-commit hook: fail when a
file contains more than one line matching either marker pattern. Owner: build-system follow-up,
alongside P-1's missing test coverage (`GATES.md`).

## N3 — `shared/types.ts` carries the same drift `db/schema.sql` did
Raised by contract-guardian, confirmed at G1.

`BudgetCategory` is missing `is_debt_service` and `sort_order`, both live columns. The guardian
correctly did **not** add them: the frozen spec declares only `db/schema.sql`'s drift in scope, and
a minimal contract diff is what makes the single-writer role reviewable.

Worth noting the shape of it: the type surface and the reference schema drifted from the same
migration (`1786644696767_debt-service-categories.sql`), and this task repairs one half. Owner: a
follow-up contract task — and a reason to consider whether anything mechanically checks
`shared/types.ts` against the live schema the way nothing checked `db/schema.sql` until G0 caught it.

---

# From adversarial review (REVIEW-1, G3) — N4–N8
All ACCEPT_WITH_NITS. None blocked the gate; none is a defect in the shipped diff.

## N4 — no test pins the predicate's fail-safe behaviour for an out-of-union value
`adherence.test.ts` supplies one of the three valid literals in every fixture. `isScoredCategory`
excludes `undefined` and unknown strings correctly, but only as a *consequence* of `===`, never as an
asserted contract.

This is worth doing sooner than the others because **N1 is live**: `app/categories/page.tsx:9` omits
`control_mode` from its own SELECT, so it produces rows carrying `control_mode: undefined` today. The
plausible future refactor — rewriting the fourth conjunct as `control_mode !== 'fixed'` once
`variable-necessary` grows its own handling — would silently admit every one of those rows into the
scored set, and nothing in the suite would go red.

Fix: two cases pinning `undefined` and `'whatever'` to `false`. Cheap, and it locks the direction.

## N5 — acceptance #21 is structurally vacuous
`SELECT COUNT(*) … WHERE control_mode IS NULL` returns `0` for any implementation with a `NOT NULL`
column, seeded or not. The spec concedes this and leans on #22, which spot-checks 6 of 21. Recorded
so "completeness was gate-proven" is never claimed — it was proven by G1, G2 and G3/I1, not by #21.

## N6 — acceptance #3–8 cannot distinguish a passing test from a skipped one
`vitest --reporter=verbose | grep -cF "<name>"` counts the name line vitest prints for skipped and
failing tests too, and the pipeline's exit status is grep's. Only #2 catches red. Not exploited here
(I5 confirmed 9 passed, 0 skipped), but the six "pinned by name" guarantees are weaker than G0's
analysis assumed. A future spec should pair a name-grep with an assertion on the summary line.

## N7 — the demo dataset's scored set is empty by construction
`scripts/seed-demo.mjs:370` inserts categories without `control_mode`, so every demo category lands
at `'fixed'` and the scored set matches zero rows in demo mode. Out of scope here — no metric ships
and the seeder is not in this diff — but step 29 will otherwise discover it as a divide-by-zero, and
the README screenshots are generated from this seeder.

## N8 — "under-inclusion is silent but harmless" is directionally indeterminate
The spec's phrase understates it. An average over a set that silently shrinks moves unpredictably,
not conservatively. Two concrete paths, both owner-accepted and neither producing a wrong number in
*this* task: `One time` is seeded `fixed`, so an elective purchase booked to the catch-all is
invisible to a future headline — a gaming path, not merely an omission; and any category created via
`POST /api/categories` after merge is `'fixed'` with no write path out, so the scored set decays as
the taxonomy grows. Carry into step 29's spec as a stated input rather than re-litigating here.
