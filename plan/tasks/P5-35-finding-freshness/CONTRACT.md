# CONTRACT — P5-35-finding-freshness
**Author:** contract-guardian
**Lease:** opened by the orchestrator at G1 · closed by the orchestrator at G1

## Change
| File | Change | Class (§9.2) |
|---|---|---|
| `packages/contracts/findings.ts` | New exports `FreshnessStateSchema`, `FreshnessBasisSchema`, `FreshnessSchema` and the types `Freshness`, `FreshnessState`, `FreshnessBasis`. A required, non-nullable, strict `freshness: FreshnessSchema` key added to each of the ten members, placed after `period`. No existing field, refinement or vocabulary changed; `job-overdue.daysSince` stays `z.int().min(0).nullable()`. | **breaking** in form (new required field); admitted without the nullable-then-tighten route for the reasons below |
| `packages/contracts/findings.test.ts` | none by me. The implementer adapts fixtures and adds T35-C1..C4 (test files are not contract, §2) | additive |
| `packages/contracts/index.ts`, `CONTRACT_SCHEMAS`, `overview.ts`, `shared/types.ts` | none | none |
| `migrations/**`, `db/schema.sql` | none | none |

New imports: none. `giftDate` (from `./gifts`) was already imported; the instant check uses Zod's own `z.iso.datetime()`.

### Class, confirmed under §9.2
§9.2 classes "new required field" as **breaking**. This change is breaking in form: every value that parsed under P5-34 now fails, because `freshness` is missing. I confirm that class and do not relabel it additive.

§9.2 prefers "add nullable, backfill, tighten later" for a breaking change. That route exists to protect consumers and stored values while they are migrated. Neither exists here, so I waive it:
1. **No consumer.** No non-test file imports `@b8/contracts/findings` or `lib/domain/findings*` except the declared modules (`lib/domain/findings*.ts`, `lib/findingsFreshnessRead.ts`). Acceptance #10 proves this and must print no file, `rc=1`. The orchestrator should run #10 at G1 against the current tree as well as at G2.
2. **Nothing stored or served.** No table, no column, no route, no payload carries a `Finding`. There are no historical values to become unreadable.
3. **A nullable step would do harm.** A nullable `freshness` would let a converter that forgot the key read as "nothing to say", which is the exact conflation (undated read as fresh) this task exists to prevent. The intermediate state is worse than the break.

The spec's description "additive in effect" holds only while conditions 1 and 2 hold. Once step 36 consumes this shape, any change to `freshness` is breaking in effect as well, including a reorder of `FreshnessBasisSchema` (see ambiguity 7).

**Expected and correct after this change, until the implementer lands:** `packages/contracts/findings.test.ts` fixtures lack `freshness`, so the existing T34 contract scenarios that assert a valid parse will fail at runtime. `apps/web/lib/domain/findings.ts` builds `Finding` values without `freshness`, so `(cd apps/web && npx tsc --noEmit)` will fail, and root `npx tsc --noEmit` may also fail. G1 must not require either `tsc` to be clean. The implementer makes both clean; acceptance #1 and #2 enforce it at G2.

## Rationale
A finding is only as true as the oldest fact it rests on. "Under budget" over a dead feed is missing data presented as good news. Freshness makes that age a property of the finding itself, so no consumer has to work it out again in its own way.

What the schema pins is limited to **self-consistency**. Which inputs belong to which kind, the per-input thresholds, and the aggregation order are owned by the producers and by `findingsFreshness.ts`, and are tested there (F1 to F13). If the schema restated a threshold or a per-kind rule as literals, there would be a second definition of it, which is the defect this directory exists to prevent. So the schema refuses a value that contradicts itself. It does not judge whether a correctly shaped value is the right answer.

`FreshnessSchema` is a strict object, like every other object in this file: an extra key is refused, not stripped.

## Field names, and why
| Field | Type | Why this name |
|---|---|---|
| `state` | `'fresh' \| 'stale' \| 'never' \| 'undated'` | The spec's four words. |
| `basis` | `'sync' \| 'feed' \| 'valuation' \| 'cash-count' \| 'job-run' \| 'overdraft-sighting' \| 'overdraft-projection' \| 'none'` | The spec's closed list, in the spec's order, kebab-cased like `FindingKindSchema`. |
| `lastObserved` | `YYYY-MM-DD` (real date) or ISO instant, or `null` | Deliberately **not** `observedAt`. `balance-drift.observedAt` already exists and means when the Plaid balance last *changed*, which is a change log, not a confirmation. That is the trap F6 tests. If both fields shared a name, a converter could copy one into the other and look correct. Not suffixed `At`, because for a valuation it is a date, not an instant. |
| `ageDays` | non-negative integer, or `null` | The unit is in the name. Existing fields (`daysSince`, `daysStale`, `daysSinceCount`) each differ by kind; one neutral name avoids looking like any one of them. |
| `undatedInputs` | non-negative integer | The spec's own word (Disposition 3: "counted in `undatedInputs`"). |

## Coherence rules (refinements on `FreshnessSchema`)
1. `lastObserved !== null` exactly when `state` is `fresh` or `stale`.
2. `ageDays !== null` exactly when `lastObserved !== null`. Together with rule 1, `fresh` and `stale` have both fields, and `never` and `undated` have neither.
3. `fresh` requires `undatedInputs === 0`.
4. `undated` requires `undatedInputs >= 1`.
5. `basis: 'none'` only with `state: 'undated'`.
6. **Precision:** for basis `valuation`, `lastObserved` must be a calendar date. For any other basis it must be an instant.
7. `ageDays` is `z.int().min(0)`: below zero is refused, and so is a fraction. `undatedInputs` is `z.int().min(0)`.

## Ambiguities resolved, and why
1. **An empty input set and an unsupplied context each count as one undated input.** The spec requires both "a finding with no inputs is `undated`" and "`undated` requires at least one undated input". Both hold only if the missing record is itself counted as the undatable input. F3 already pins the unsupplied-context count at exactly 1, and the same rule is applied to an empty set (for example, zero contributing accounts). **Implementer: `undatedInputs` for an empty set is 1, not 0.** If 0 were emitted, the schema would refuse it.
2. **`basis: 'none'` is only valid with `undated`.** Rules 1 and 6 already exclude `none` from `fresh` and `stale`, because there is no precision for "none". For `never`, the worst input is the one never observed, and every such input has a listed kind (sync, feed, cash count, valuation, job run). A `never` with no named basis would hide which observation is missing. This follows from the spec's definition of basis; it adds no new semantics.
3. **For `never` and `undated`, the contract leaves the basis free** (apart from ambiguity 2). One example is a feed with neither timestamp recorded: the finding may be `undated` with `basis: 'feed'`, or `undated` with `none` for a manual ledger account. Which one is chosen is the freshness module's rule, and F1 asserts it per kind and state.
4. **One spelling of an instant: `Date.prototype.toISOString()` output** (`2026-03-05T06:00:00.000Z`, UTC, with `Z`), validated by `z.iso.datetime()`. An explicit offset (`+00:00`) is refused, and so is Postgres's text rendering (`2026-03-05 06:00:00+00`). `timestamptz` was not reused, because it is an unconstrained `z.string()`, and C4 needs an instant to be told apart from a bare date by its shape. The read module hands over `Date` objects; the assembler serialises them with `toISOString()`.
5. **A valuation date reuses `giftDate`:** `YYYY-MM-DD`, a real date, checked by integer arithmetic and never by the JS date parser. `2026-02-30` is refused. That matches the spec's rule that a malformed date makes the input `undated` and is never carried.
6. **No coherence between `ageDays` and `state` beyond presence.** For example, `stale` with `ageDays: 0` is accepted. The feed judges staleness in milliseconds against an hour threshold, and the job's `late` can be 0 days, so a stale input can floor to 0 days. Pinning "stale implies age at or above a threshold" would copy a threshold into the contract. F4 tests the boundary against the real producers.
7. **No coherence between `freshness` and the member's own fields.** For example, `sync-stale` with `status: 'never'` but `freshness.state: 'fresh'` is accepted by the schema. Pinning it would restate the per-kind input table as schema literals. F1 owns that table. **The order of `FreshnessBasisSchema` is load-bearing:** it is the tie-break when two dated inputs have equal age. The implementer should read it from `FreshnessBasisSchema.options` and not keep a second list. Reordering the list is a semantic change.
8. **N3 is unchanged on the contract side:** `job-overdue.daysSince` stays `>= 0`. The fix belongs in the producer (`jobHealth.ts`). C3 and probe line `job daysSince -1` check this.
9. **No other member comment or field changed.** The P5-34 note on `feed-degraded` ("an unobserved feed is invisible ... recorded for step 35") is still true of that kind. Step 35 shows an unknown feed through `undatedInputs` on other findings, not through a new state, as Disposition 3 requires.

## Domain invariants preserved
- **Derived, not stored:** freshness is computed at read time. No migration, table or column. `account_valuations` and the other observation tables stay append-only.
- **Money:** no money field added or changed. The only new numbers are counts of days and inputs, which are integers `>= 0`.
- **Null semantics:** `null` in `lastObserved` and `ageDays` means "no dated worst input" (`never` or `undated`). It never means zero, and zero never means `null`, because rules 1 and 2 refuse both conflations. `never` (a recorded absence) and `undated` (no usable record) are separate states and are never merged.
- **Inheritance:** not applicable. No nullable field here means "inherit".

## Migration
None.

## Backfill / data correction required
None. Nothing is persisted.

## Controls for the orchestrator (G1)
Run from the repo root under `bash`. Money values are built from small integers by `M()`, so no figure is written down. Fixture names are fabricated. **Expected output: one line `OK 17 valid, 59 invalid`, then `exit=0`.** Any `UNEXPECTED` line is a failure.

The 59 invalid values are:
- 39 generated: for each of the 13 base fixtures, `freshness` omitted, `freshness: null`, and an extra key inside `freshness`.
- 20 named cases.

```bash
cd /Users/andreianpilogov/Documents/b8/app && cat > "${TMPDIR:-/tmp}/p35-control.mts" <<'EOF'
import { FindingSchema } from '/Users/andreianpilogov/Documents/b8/app/packages/contracts/findings.ts';
const M = (n: number) => n.toFixed(2);
const asOf = { type: 'asOf', date: '2026-03-05' } as const;
const acct = { type: 'account', id: 'acct_fixture_1', name: 'Fixture Checking' };
const inst = { type: 'institution', name: 'Fabricated Credit Union' };
const cat = { type: 'category', id: 7, name: 'Fixture Category' };
const w = { severity: 'warning', confidence: 'observed' };
const I = (d: string) => `${d}T06:00:00.000Z`;
const fr = (state: string, basis: string, lastObserved: string | null, ageDays: number | null, undatedInputs: number) => ({ state, basis, lastObserved, ageDays, undatedInputs });
const base: Record<string, any> = {
  breach: { kind: 'budget-breach', severity: 'notice', confidence: 'inferred', subject: cat, period: { type: 'month', month: '2026-12' }, freshness: fr('stale', 'sync', I('2026-02-13'), 20, 1), scored: false, budgeted: M(0), actual: M(3), variance: M(3), ratio: null },
  underspend: { kind: 'budget-underspend', severity: 'notice', confidence: 'inferred', subject: cat, period: { type: 'months', months: ['2026-03', '2026-06'] }, freshness: fr('undated', 'none', null, null, 1), scored: true, budgeted: M(20), actual: M(2), variance: M(-18), monthly: ['2026-03', '2026-06'].map((month) => ({ month, budgeted: M(10), actual: M(1), variance: M(-9), ratio: 0.1 })) },
  drift: { kind: 'balance-drift', ...w, subject: acct, period: asOf, freshness: fr('fresh', 'sync', I('2026-03-05'), 0, 0), ledgerBalance: M(-5), expectedBalance: M(-8), drift: M(-3), suggestedBeginningBalance: M(-3), observedAt: null, safeToDerive: false },
  feedNever: { kind: 'feed-degraded', ...w, subject: inst, period: asOf, freshness: fr('never', 'feed', null, null, 0), accountCount: 2, state: 'failing', lastSuccessfulUpdate: null, hoursStale: null, institutionStatus: null, institutionStatusAt: null },
  feedStale: { kind: 'feed-degraded', severity: 'notice', confidence: 'observed', subject: inst, period: asOf, freshness: fr('stale', 'feed', '2026-03-01T00:00:00.000Z', 4, 0), accountCount: 1, state: 'stale', lastSuccessfulUpdate: '2026-03-01T00:00:00.000Z', hoursStale: 96, institutionStatus: 'HEALTHY', institutionStatusAt: '2026-02-01T00:00:00.000Z' },
  syncNever: { kind: 'sync-stale', ...w, subject: inst, period: asOf, freshness: fr('never', 'sync', null, null, 0), key: 'acct_fixture_1', accountCount: 1, daysStale: null, status: 'never' },
  syncStale: { kind: 'sync-stale', severity: 'notice', confidence: 'observed', subject: inst, period: asOf, freshness: fr('stale', 'sync', I('2026-03-02'), 3, 0), key: 'acct_fixture_1', accountCount: 1, daysStale: 3, status: 'stale' },
  job: { kind: 'job-overdue', ...w, subject: { type: 'system', name: 'daily-job' }, period: asOf, freshness: fr('never', 'job-run', null, null, 0), status: 'never', daysSince: null, message: 'The daily job has never run on this machine.' },
  wallet: { kind: 'cash-uncounted', ...w, subject: acct, period: asOf, freshness: fr('never', 'cash-count', null, null, 0), balance: M(-1), daysSinceCount: null, reason: 'never' },
  valuation: { kind: 'valuation-stale', severity: 'notice', confidence: 'observed', subject: acct, period: asOf, freshness: fr('stale', 'valuation', '2025-11-05', 120, 0), reason: 'stale', daysSince: 120 },
  valuationNever: { kind: 'valuation-stale', ...w, subject: acct, period: asOf, freshness: fr('never', 'valuation', null, null, 0), reason: 'never', daysSince: null },
  overdraft: { kind: 'overdraft-open', severity: 'critical', confidence: 'observed', subject: acct, period: asOf, freshness: fr('fresh', 'overdraft-sighting', I('2026-03-05'), 0, 0), bank: null, balance: M(-4), cushion: M(5), since: '2026-03-04 06:00:00+00', seenAt: '2026-03-05 06:00:00+00' },
  forecast: { kind: 'overdraft-forecast', severity: 'warning', confidence: 'projected', subject: acct, period: asOf, freshness: fr('fresh', 'overdraft-projection', I('2026-03-05'), 0, 0), bank: 'Fabricated Credit Union', cushion: M(5), low: M(-2), lowOn: '2026-03-09', projectedAt: '2026-03-05 06:00:00+00' },
};
const b = base;
const jobLate0 = { ...b.job, status: 'late', daysSince: 0, message: 'Fixture message.', freshness: fr('stale', 'job-run', '2026-03-04T23:00:00.000Z', 0, 0) };
const valid: Record<string, any> = {
  ...base,
  'job late daysSince 0 (C3)': jobLate0,
  'job late daysSince 3 (C3)': { ...jobLate0, daysSince: 3, freshness: fr('stale', 'job-run', I('2026-03-02'), 3, 0) },
  'never with undated inputs counted': { ...b.breach, freshness: fr('never', 'feed', null, null, 2) },
  'undated naming the feed': { ...b.drift, freshness: fr('undated', 'feed', null, null, 1) },
};
const omit = (o: any, k: string) => { const c = { ...o }; delete c[k]; return c; };
const withF = (o: any, f: any) => ({ ...o, freshness: f });
const invalid: Record<string, any> = {};
for (const [n, f] of Object.entries(base)) {
  invalid[`${n}: freshness omitted`] = omit(f, 'freshness');
  invalid[`${n}: freshness null`] = withF(f, null);
  invalid[`${n}: extra key in freshness`] = withF(f, { ...f.freshness, note: 'CANARY' });
}
Object.assign(invalid, {
  'fresh without observation or age': withF(b.drift, fr('fresh', 'sync', null, null, 0)),
  'stale without age': withF(b.syncStale, fr('stale', 'sync', I('2026-03-02'), null, 0)),
  'never with observation and age': withF(b.syncNever, fr('never', 'sync', I('2026-03-01'), 4, 0)),
  'never with age only': withF(b.syncNever, fr('never', 'sync', null, 0, 0)),
  'undated with observation and age': withF(b.drift, fr('undated', 'feed', I('2026-03-01'), 4, 1)),
  'fresh with an undated input': withF(b.drift, fr('fresh', 'sync', I('2026-03-05'), 0, 1)),
  'undated with zero undated inputs': withF(b.underspend, fr('undated', 'none', null, null, 0)),
  'negative age': withF(b.syncStale, fr('stale', 'sync', I('2026-03-02'), -1, 0)),
  'fractional age': withF(b.syncStale, fr('stale', 'sync', I('2026-03-02'), 1.5, 0)),
  'negative undated count': withF(b.syncNever, fr('never', 'sync', null, null, -1)),
  'state outside four': withF(b.drift, fr('unknown', 'sync', null, null, 1)),
  'basis outside list': withF(b.drift, fr('fresh', 'plaid-balance', I('2026-03-05'), 0, 0)),
  'basis none on fresh': withF(b.drift, fr('fresh', 'none', I('2026-03-05'), 0, 0)),
  'basis none on never': withF(b.wallet, fr('never', 'none', null, null, 0)),
  'valuation basis as an instant (C4)': withF(b.valuation, fr('stale', 'valuation', '2025-11-05T00:00:00.000Z', 120, 0)),
  'sync basis as a bare date (C4)': withF(b.syncStale, fr('stale', 'sync', '2026-03-02', 3, 0)),
  'instant as pg text': withF(b.syncStale, fr('stale', 'sync', '2026-03-02 06:00:00+00', 3, 0)),
  'instant with an offset': withF(b.syncStale, fr('stale', 'sync', '2026-03-02T06:00:00+00:00', 3, 0)),
  'valuation date not real': withF(b.valuation, fr('stale', 'valuation', '2026-02-30', 5, 0)),
  'job daysSince -1 (C3)': { ...jobLate0, daysSince: -1 },
});
let bad = 0;
for (const [n, f] of Object.entries(valid)) { const r = FindingSchema.safeParse(f); if (!r.success) { bad++; console.log('UNEXPECTED reject', n, JSON.stringify(r.error.issues)); } }
for (const [n, f] of Object.entries(invalid)) if (FindingSchema.safeParse(f).success) { bad++; console.log('UNEXPECTED accept', n); }
if (bad === 0) console.log(`OK ${Object.keys(valid).length} valid, ${Object.keys(invalid).length} invalid`);
process.exit(bad ? 1 : 0);
EOF
npx tsx "${TMPDIR:-/tmp}/p35-control.mts"; echo "exit=$?"
```

Expected: `OK 17 valid, 59 invalid`, then `exit=0`.

If `tsx` cannot be resolved in this workspace, run the same body as a throwaway vitest file outside the tree. Do not add it to the repository: acceptance #8 allows only the declared files.

### Discrimination probes
Apply each probe to a scratch copy of `packages/contracts/findings.ts`, never to the tree. Point the script's import at the copy, and apply one probe at a time.

1. **Remove the `fresh ⇒ undatedInputs === 0` refinement** (the `.refine` whose message begins `a 'fresh' finding has no undated inputs`). Expected: exactly one line, `UNEXPECTED accept fresh with an undated input`, then `exit=1`. This proves the control detects an undated input being hidden inside `fresh`.
2. **Replace the precision refinement's predicate with `() => true`** (the `.refine` whose message begins `lastObserved is a calendar date for basis 'valuation'`). Expected: exactly two lines, `UNEXPECTED accept valuation basis as an instant (C4)` and `UNEXPECTED accept sync basis as a bare date (C4)`, then `exit=1`. This proves the precision rule is enforced by the refinement and not by the union alone.

### Also run at G1
```bash
grep -rlE "domain/findings|@b8/contracts/findings|findingsFreshnessRead" apps/web packages --include='*.ts' --include='*.tsx' --exclude-dir=node_modules --exclude-dir=.next | grep -vE '\.test\.ts$|lib/domain/findings[A-Za-z]*\.ts$|packages/contracts/findings\.ts$|lib/findingsFreshnessRead\.ts$' ; echo "rc=$?"
```
Expected: no file listed, `rc=1`. This is acceptance #10, and it is the condition that admits this breaking change.

`npx tsc --noEmit` (root) and `(cd apps/web && npx tsc --noEmit)` are **expected to fail at G1**, because the implementer has not yet added `freshness` in `apps/web/lib/domain/findings.ts` and the test fixtures. Record each failure. Check that every error names a missing `freshness` and that no error is in `packages/contracts/findings.ts` itself. Any error located inside `findings.ts` is a contract defect and returns to G1.
