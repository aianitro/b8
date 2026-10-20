# CONTRACT — P5-34-finding-vocabulary
**Author:** contract-guardian
**Lease:** opened by the orchestrator at G1 · closed by the orchestrator at G1

## Change
| File | Change | Class (§9.2) |
|---|---|---|
| `packages/contracts/findings.ts` (new) | `FindingSchema` (strict discriminated union on `kind`, ten members), its vocabularies (`SeveritySchema`, `ConfidenceSchema`, `FindingKindSchema`), `SubjectSchema`, `PeriodSchema`, the per-member schemas, `calendarMonth`, and the inferred types `Finding`, `FindingKind`, `Severity`, `Confidence`, `Subject`, `Period`; a compile-time `FindingKindIsExact` check | additive |
| `packages/contracts/findings.test.ts` (new) | scenarios C1–C6 — **written by the implementer**, per the G0 process ruling; not part of this contract change | additive |
| `packages/contracts/index.ts`, `CONTRACT_SCHEMAS` | none — subpath import `@b8/contracts/findings` only | none |
| `migrations/**`, `db/schema.sql` | none | none |

No existing file was edited. The new file imports only `zod` and siblings: `./representation` (`serialId`, `timestamptz`, `dateString`), `./overview` (`moneyString`, and the `state` / `institutionStatus` / `daysSinceCount` / `reason` field schemas of `FeedFindingSchema` and `WalletFindingSchema`), `./gifts` (`giftDate`) and `./exact` (type-only).

## Rationale
One shape for "a thing worth telling the owner", so steps 35 and 36 consume one vocabulary instead of ten producer-specific ones, each with its own ranking and its own spelling of "unknown". The contract states *what a finding is*; the mapping from producer state to severity and confidence is SPEC.md's table and has exactly one implementation, the conversion module, where V1–V11 test it.

Strict objects rather than stripping ones: the assembler authors these values end to end, and the leak the vocabulary most needs to catch is an extra key (a merchant label from `ForecastFinding.charges`). A stripping schema would remove it silently and hide the leak; a strict one rejects the value.

## Ambiguities resolved, and why
1. **Chronic-underspend per-month evidence is CARRIED as `monthly`.** The spec's carried-field list for `budget-underspend` names the window totals and "the qualifying months as the period", but `ChronicUnderspendFinding.months` is a `MonthVariance[]` holding per-month `budgeted`/`actual`/`variance`/`ratio`. V13 requires every producer sentinel to appear in the serialised Finding except a dropped set that equals exactly `ForecastFinding.charges`, and the spec says the exactness checks "force a decision for any producer field not listed". Dropping the per-month figures would make the dropped set larger than `charges` and fail V13; they are figures, not row text, so the privacy reason for dropping does not apply. Shape: `monthly: [{ month: 'YYYY-MM', budgeted, actual, variance (money strings), ratio (number | null) }]`. A refinement requires `monthly[i].month === period.months[i]` for every `i` and equal lengths, so the breakdown and the period are one truth, not two. **Orchestrator: if you read the spec as dropping these, say so and I will remove the field; V13's dropped set would then have to change, which is a spec amendment.**
2. **Subject type and period type are narrowed per kind** (category + month for `budget-breach`, category + months for `budget-underspend`, institution + asOf for `feed-degraded` and `sync-stale`, system + asOf for `job-overdue`, account + asOf for the other five). The mapping table fixes these per kind; they are structural (what the finding is about), not calibration. `SubjectSchema` and `PeriodSchema` are still exported as the four-type and three-type unions, for C2 and for consumers.
3. **Severity and confidence are NOT narrowed per kind or state.** Every member accepts all three of each. Pinning them would restate the mapping table as schema literals, a second definition of it beside the conversion module (and W1 forbids severity literals outside `lib/domain/findings*.ts`). The mapping is tested by V1–V11, not by the schema.
4. **"Never ⇔ null" is enforced as a refinement on five members**, because "never" read as "zero" is the failure SPEC.md names first:
   - `sync-stale`: `daysStale === null` exactly when `status === 'never'`.
   - `job-overdue`: `daysSince === null` exactly when `status === 'never'`.
   - `cash-uncounted`: `daysSinceCount === null` exactly when `reason === 'never'`.
   - `valuation-stale`: `daysSince === null` exactly when `reason === 'never'`.
   - `feed-degraded`: `hoursStale === null` exactly when `lastSuccessfulUpdate === null` (the producer computes the one from the other).
   Each is a property the producer already guarantees, so no real output is rejected. **Consequence for the implementer's C4:** "null parses" must use a fixture in the matching state (for example `reason: 'never'` with `daysSinceCount: null`); a `stale` fixture with a null count is correctly rejected.
5. **Unreportable states are not member values.** `sync-stale.status` is `'stale' | 'never'` (no `'ok'`); `job-overdue.status` is `'late' | 'missed' | 'never'` (no `'fresh'`); `feed-degraded.state` is `'failing' | 'stale'` (no `'unknown'`, no `'ok'`), reused from `FeedFindingSchema.shape.state`.
6. **Calendar month.** New primitive `calendarMonth`: `^\d{4}-(?:0[1-9]|1[0-2])$`. Rejects `2026-00`, `2026-13`, `2026-1`. No existing primitive described a month.
7. **Calendar date.** `asOf.date` reuses `giftDate` from `gifts.ts` — `YYYY-MM-DD` and a real date (rejects `2026-1-5` and `2026-02-30`), checked by integer arithmetic, never by `Date`. `dateString` (unconstrained) was not used for the period because C6 requires `2026-1-5` to fail. The schema is therefore stricter than the assembler's own `RangeError` (which bounds day only to 1–31): an as-of triple such as February 30 would format and then fail to parse. That is the schema detecting a value the domain should never produce; the overview's `AsOf` triple comes from a real clock read.
8. **`months` period is strictly ascending** (no repeats), non-empty. Zero-padded text compares in calendar order as strings.
9. **`overdraft-forecast.lowOn` uses `dateString`** (the producer reads `low_on::text`, a calendar date). `since`, `seenAt`, `projectedAt`, `observedAt`, `lastSuccessfulUpdate`, `institutionStatusAt` use `timestamptz`. Both primitives are `z.string()`; the distinct names record which column type each describes.
10. **Field names follow the producer**, except where the field became the subject: `categoryId`/`category` → `subject.{id,name}`; `accountId`/`name` (drift, wallet), `id`/`name` (valuation), `accountId`/`account` (overdraft, forecast) → `subject.{id,name}`; feed `institution` and sync `bank` → `subject.name`. The producers' own `kind` (`'breach'`, `'chronic-underspend'`) becomes the finding `kind`, and breach `month` (0-based) becomes `period.month` (1-based text).
11. **`sync-stale` subject name `'Unknown'`.** The producer itself substitutes the text `Unknown` for a null bank before it emits. That substitution is inherited, not introduced; fixing it means changing `syncHealth.ts`, which this task forbids. Recorded for step 35.
12. **No sign restriction on any money field**, and no `-0.00` rejection: `moneyString` is reused unchanged. `-0.00` is excluded by the conversion's formatter (V3, V12), not by representation.
13. **Ratios** use `z.number().nullable()`; Zod 4's `z.number()` already refuses `Infinity` and `NaN`.

## Domain invariants preserved
- **Derived, not stored:** no table, no column, no persistence. The finding list is a derived read assembled per call.
- **Money:** `moneyString` (exactly two decimals, decimal string), never a float; sign as the producer emitted it.
- **Null semantics:** every nullable field is present and `null` means unknown/never — never `0`, `""`, `'HEALTHY'` or `Infinity`. `institutionStatus: null` means unread. Five never/null pairings are enforced (ambiguity 4).
- **Inheritance:** not applicable — no nullable field here means "inherit".

## Migration
None.

## Backfill / data correction required
None.

## Consumers checked
- No existing file imports `findings.ts`; nothing existing can change behaviour. The orchestrator runs `npx tsc --noEmit` (root) and `(cd apps/web && npx tsc --noEmit)` at G1; I have no shell.
- `FindingKindIsExact` fails compilation if the kind list and the union discriminants diverge.

## Controls for the orchestrator (G1)
Run from the repo root under `bash`. Money values are built from small integers by `M()` so no figure is written down. Expected output: a single line `OK 13 valid, 24 invalid`. Any `UNEXPECTED` line is a failure.

```bash
cd /Users/andreianpilogov/Documents/b8/app && cat > "${TMPDIR:-/tmp}/p34-control.mts" <<'EOF'
import { FindingSchema, SubjectSchema, PeriodSchema } from '/Users/andreianpilogov/Documents/b8/app/packages/contracts/findings.ts';
const M = (n: number) => n.toFixed(2);
const asOf = { type: 'asOf', date: '2026-03-05' } as const;
const acct = { type: 'account', id: 'acct_fixture_1', name: 'Fixture Checking' };
const inst = { type: 'institution', name: 'Fabricated Credit Union' };
const cat = { type: 'category', id: 7, name: 'Fixture Category' };
const w = { severity: 'warning', confidence: 'observed' };
const valid: Record<string, any> = {
  breach: { kind: 'budget-breach', severity: 'notice', confidence: 'inferred', subject: cat, period: { type: 'month', month: '2026-12' }, scored: false, budgeted: M(0), actual: M(3), variance: M(3), ratio: null },
  underspend: { kind: 'budget-underspend', severity: 'notice', confidence: 'inferred', subject: cat, period: { type: 'months', months: ['2026-03', '2026-06', '2026-07'] }, scored: true, budgeted: M(30), actual: M(3), variance: M(-27), monthly: ['2026-03', '2026-06', '2026-07'].map((month) => ({ month, budgeted: M(10), actual: M(1), variance: M(-9), ratio: 0.1 })) },
  drift: { kind: 'balance-drift', ...w, subject: acct, period: asOf, ledgerBalance: M(-5), expectedBalance: M(-8), drift: M(-3), suggestedBeginningBalance: M(-3), observedAt: null, safeToDerive: false },
  feedNever: { kind: 'feed-degraded', ...w, subject: inst, period: asOf, accountCount: 2, state: 'failing', lastSuccessfulUpdate: null, hoursStale: null, institutionStatus: null, institutionStatusAt: null },
  feedStale: { kind: 'feed-degraded', severity: 'notice', confidence: 'observed', subject: inst, period: asOf, accountCount: 1, state: 'stale', lastSuccessfulUpdate: '2026-03-01T00:00:00.000Z', hoursStale: 96, institutionStatus: 'HEALTHY', institutionStatusAt: '2026-02-01T00:00:00.000Z' },
  syncNever: { kind: 'sync-stale', ...w, subject: inst, period: asOf, key: 'acct_fixture_1', accountCount: 1, daysStale: null, status: 'never' },
  syncStale: { kind: 'sync-stale', severity: 'notice', confidence: 'observed', subject: inst, period: asOf, key: 'acct_fixture_1', accountCount: 1, daysStale: 3, status: 'stale' },
  job: { kind: 'job-overdue', ...w, subject: { type: 'system', name: 'daily-job' }, period: asOf, status: 'never', daysSince: null, message: 'The daily job has never run on this machine.' },
  wallet: { kind: 'cash-uncounted', ...w, subject: acct, period: asOf, balance: M(-1), daysSinceCount: null, reason: 'never' },
  valuation: { kind: 'valuation-stale', severity: 'notice', confidence: 'observed', subject: acct, period: asOf, reason: 'stale', daysSince: 120 },
  valuationNever: { kind: 'valuation-stale', ...w, subject: acct, period: asOf, reason: 'never', daysSince: null },
  overdraft: { kind: 'overdraft-open', severity: 'critical', confidence: 'observed', subject: acct, period: asOf, bank: null, balance: M(-4), cushion: M(5), since: '2026-03-04 06:00:00+00', seenAt: '2026-03-05 06:00:00+00' },
  forecast: { kind: 'overdraft-forecast', severity: 'warning', confidence: 'projected', subject: acct, period: asOf, bank: 'Fabricated Credit Union', cushion: M(5), low: M(-2), lowOn: '2026-03-09', projectedAt: '2026-03-05 06:00:00+00' },
};
const v = valid;
const omit = (o: any, k: string) => { const c = { ...o }; delete c[k]; return c; };
const invalid: Record<string, any> = {
  'forecast carries charges': { ...v.forecast, charges: [{ label: 'CANARY', amount: 1, on: '2026-03-07' }] },
  'drift omits observedAt': omit(v.drift, 'observedAt'),
  'money unpadded': { ...v.drift, drift: '1.5' },
  'money bare number': { ...v.drift, drift: 3 },
  'money empty': { ...v.drift, drift: '' },
  'month 13': { ...v.breach, period: { type: 'month', month: '2026-13' } },
  'month 00': { ...v.breach, period: { type: 'month', month: '2026-00' } },
  'month unpadded': { ...v.breach, period: { type: 'month', month: '2026-1' } },
  'months empty': { ...v.underspend, period: { type: 'months', months: [] }, monthly: [] },
  'months descending': { ...v.underspend, period: { type: 'months', months: ['2026-07', '2026-06', '2026-03'] }, monthly: [...v.underspend.monthly].reverse() },
  'monthly disagrees with period': { ...v.underspend, monthly: v.underspend.monthly.slice(1) },
  'date unpadded': { ...v.drift, period: { type: 'asOf', date: '2026-1-5' } },
  'date not real': { ...v.drift, period: { type: 'asOf', date: '2026-02-30' } },
  'wallet never with zero days': { ...v.wallet, daysSinceCount: 0 },
  'valuation stale with null days': { ...v.valuation, daysSince: null },
  'feed hours null but success recorded': { ...v.feedStale, hoursStale: null },
  'feed state unknown': { ...v.feedNever, state: 'unknown' },
  'sync status ok': { ...v.syncStale, status: 'ok' },
  'job status fresh': { ...v.job, status: 'fresh', daysSince: 0 },
  'kind outside the ten': { ...v.drift, kind: 'property-anomaly' },
  'severity outside three': { ...v.drift, severity: 'high' },
  'confidence numeric': { ...v.drift, confidence: 0.9 },
  'breach about an account': { ...v.breach, subject: acct },
  'ratio infinite': { ...v.breach, ratio: Infinity },
};
let bad = 0;
for (const [n, f] of Object.entries(valid)) if (!FindingSchema.safeParse(f).success) { bad++; console.log('UNEXPECTED reject', n, JSON.stringify(FindingSchema.safeParse(f).error?.issues)); }
for (const [n, f] of Object.entries(invalid)) if (FindingSchema.safeParse(f).success) { bad++; console.log('UNEXPECTED accept', n); }
if (!SubjectSchema.safeParse(inst).success || PeriodSchema.safeParse({ type: 'range' }).success) { bad++; console.log('UNEXPECTED union'); }
if (bad === 0) console.log(`OK ${Object.keys(valid).length} valid, ${Object.keys(invalid).length} invalid`);
process.exit(bad ? 1 : 0);
EOF
npx tsx "${TMPDIR:-/tmp}/p34-control.mts"; echo "exit=$?"
```

Expected: `OK 13 valid, 24 invalid` then `exit=0`.

Discrimination probes (apply one at a time to a scratch copy, never to the tree): replacing `z.strictObject` with a stripping object on `OverdraftForecastFindingSchema` must turn `forecast carries charges` into `UNEXPECTED accept`; deleting the refinement on `CashUncountedFindingSchema` must turn `wallet never with zero days` into `UNEXPECTED accept`.

Also run, and expect `exit=0` from both:
```bash
npx tsc --noEmit; echo "exit=$?"
(cd apps/web && npx tsc --noEmit; echo "exit=$?")
```

If `tsx` is not resolvable in this workspace, run the same body as a throwaway vitest file outside the tree; do not add it to the repository (acceptance #8 allows only the declared files).
