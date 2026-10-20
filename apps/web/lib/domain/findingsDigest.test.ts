// P5-36 — the findings digest: carriage, the reader's order, dating, coverage (scenarios D1–D12).
//
// The source-level rules (no clock, no threshold, no severity written, a thin page) are
// `lib/findingsWiring.test.ts` (T36-W1..W5); the loader against a real database is
// `scripts/findings-digest-read.test.ts` (T36-L1..L7). What these pin is the composition itself: which
// items, in which order, saying what about their age and about the sources that never ran.
//
// FIXTURES ARE FABRICATED. Findings are built through the real conversions from fabricated producer
// findings (`Fabricated Credit Union`, `Fixture Checking`, `Fixture Category`), so every input is a
// value the assembler could really hand over; amounts are small bare numbers no rule here reads. Where
// a scenario needs a particular freshness, the converted finding's freshness is replaced with a
// coherent one (it is checked against the contract's schema before use), because the digest's rules
// are about the freshness it is given, not about how step 35 derived it.
//
// TIME. One fixed instant built from UTC components, its as-of triple by `asOfFromDate`, so the as-of
// date is right under each of the three process zones acceptance #5 runs this file under. The digest
// reads no clock; D10 sets fake system times to prove it, and pins exact sentences so a zone that
// changed any wording would fail here.

import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  FindingSchema,
  FindingKindSchema,
  FreshnessSchema,
  SeveritySchema,
  type Finding,
  type FindingKind,
  type Freshness,
  type FreshnessBasis,
} from '@b8/contracts/findings';
import {
  BASIS_WORDS,
  composeDigest,
  DIGEST_KIND_ORDER,
  SOURCE_LABELS,
  type DigestPeriod,
  type FindingsDigest,
} from './findingsDigest';
import {
  asOfDate,
  assembleFindings,
  FINDING_SOURCES,
  fromBreach,
  fromChronicUnderspend,
  fromDrift,
  fromFeed,
  fromForecast,
  fromJob,
  fromOverdraft,
  fromSync,
  fromValuation,
  fromWallet,
  type FindingSource,
} from './findings';
import type { FreshnessContext, FreshnessFacts } from './findingsFreshness';
import { asOfFromDate } from './monthOutlook';
import type { AsOf } from './pacing';
import type { BreachFinding, ChronicUnderspendFinding, MonthVariance } from './adherence';
import type { DriftFinding } from './drift';
import type { FeedFinding } from './feedHealth';
import type { SyncItemHealth } from './syncHealth';
import type { JobHealth } from './jobHealth';
import type { WalletFinding } from './walletStaleness';
import type { ValuationFinding } from './valuationStaleness';
import type { ForecastFinding, OverdraftFinding } from '../overdraftWatch';

// ─── Time ─────────────────────────────────────────────────────────────────────────────────────

const HOUR = 3_600_000;
const DAY = 86_400_000;
const NOW = new Date(Date.UTC(2026, 2, 5, 12));
const ASOF: AsOf = asOfFromDate(NOW);
const PERIOD: DigestPeriod = { type: 'asOf', date: asOfDate(ASOF) };
const ago = (ms: number) => new Date(NOW.getTime() - ms);

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

// ─── Producer fixtures (fabricated), converted for real ───────────────────────────────────────

const monthVariance = (month: number, budgeted: number, actual: number): MonthVariance => ({
  month, budgeted, actual, variance: actual - budgeted, ratio: budgeted === 0 ? null : actual / budgeted,
});
const breach = (over: Partial<BreachFinding> = {}): BreachFinding => ({
  kind: 'breach', categoryId: 7, category: 'Fixture Category', scored: true, ...monthVariance(1, 4, 6), ...over,
});
const underspend = (over: Partial<ChronicUnderspendFinding> = {}): ChronicUnderspendFinding => ({
  kind: 'chronic-underspend', categoryId: 8, category: 'Fixture Other Category', scored: true,
  months: [monthVariance(0, 4, 1), monthVariance(1, 4, 2)], budgeted: 8, actual: 3, variance: -5, ...over,
});
const drift = (over: Partial<DriftFinding> = {}): DriftFinding => ({
  accountId: 'acct_fixture_drift', name: 'Fixture Credit Card', ledgerBalance: -6, expectedBalance: -4, drift: 2,
  observedAt: '2026-03-05T06:00:00.000Z', suggestedBeginningBalance: -2, safeToDerive: true, ...over,
});
const feed = (over: Partial<FeedFinding> = {}): FeedFinding => ({
  institution: 'Fabricated Credit Union', accountCount: 1, state: 'stale', lastSuccessfulUpdate: ago(40 * HOUR),
  hoursStale: 40, institutionStatus: null, institutionStatusAt: null, ...over,
});
const sync = (over: Partial<SyncItemHealth> = {}): SyncItemHealth => ({
  key: 'acct_fixture_sync', bank: 'Fabricated Credit Union', accountCount: 1, daysStale: 3, status: 'stale', ...over,
});
const job = (over: Partial<JobHealth> = {}): JobHealth => ({
  status: 'missed', daysSince: 2, message: 'A fabricated sentence about the daily job.', ...over,
});
const wallet = (over: Partial<WalletFinding> = {}): WalletFinding => ({
  accountId: 'acct_fixture_wallet', name: 'Fixture Wallet', balance: 3, daysSinceCount: 40, reason: 'stale', ...over,
});
const valuation = (over: Partial<ValuationFinding> = {}): ValuationFinding =>
  ({ id: 'acct_fixture_brokerage', name: 'Fixture Brokerage', reason: 'stale', daysSince: 120, ...over } as ValuationFinding);
const overdraft = (over: Partial<OverdraftFinding> = {}): OverdraftFinding => ({
  accountId: 'acct_fixture_od', account: 'Fixture Checking', bank: null, balance: -4.5, cushion: 5,
  since: '2026-03-04 06:00:00+00', seenAt: '2026-03-05 06:00:00+00', ...over,
});
const forecast = (over: Partial<ForecastFinding> = {}): ForecastFinding => ({
  accountId: 'acct_fixture_fc', account: 'Fixture Bills Checking', bank: 'Fabricated Credit Union', cushion: 5,
  low: -2.25, lowOn: '2026-03-09', charges: [{ label: 'CANARY_LABEL', amount: 7.25, on: '2026-03-07' }],
  projectedAt: '2026-03-05 06:00:00+00', ...over,
});

/** The conversion's output, non-null, checked against the contract. */
function ok<T extends Finding | null>(f: T): Finding {
  expect(f).not.toBeNull();
  const r = FindingSchema.safeParse(f);
  expect(r.success, JSON.stringify(r.error?.issues ?? null)).toBe(true);
  return f as Finding;
}

// ─── Freshness fixtures, each checked against the contract ────────────────────────────────────

function fr(f: Freshness): Freshness {
  const r = FreshnessSchema.safeParse(f);
  expect(r.success, JSON.stringify(r.error?.issues ?? null)).toBe(true);
  return f;
}
const fresh = (ageDays: number, basis: FreshnessBasis = 'sync') =>
  fr({ state: 'fresh', basis, lastObserved: ago(ageDays * DAY).toISOString(), ageDays, undatedInputs: 0 });
const stale = (ageDays: number, basis: FreshnessBasis = 'sync', undatedInputs = 0) =>
  fr({ state: 'stale', basis, lastObserved: ago(ageDays * DAY).toISOString(), ageDays, undatedInputs });
const never = (basis: FreshnessBasis = 'sync', undatedInputs = 0) =>
  fr({ state: 'never', basis, lastObserved: null, ageDays: null, undatedInputs });
const undated = (basis: FreshnessBasis = 'none', undatedInputs = 1) =>
  fr({ state: 'undated', basis, lastObserved: null, ageDays: null, undatedInputs });

/** The finding with its freshness replaced, the result checked against the contract. */
const dated = (f: Finding, freshness: Freshness): Finding => ok({ ...f, freshness } as Finding);

/** One finding of each of the ten kinds, through the real conversions. */
function tenKinds(): Finding[] {
  return [
    ok(fromBreach(breach(), ASOF)),
    ok(fromChronicUnderspend(underspend(), ASOF)),
    ok(fromDrift(drift(), ASOF)),
    ok(fromFeed(feed({ state: 'failing' }), ASOF)),
    ok(fromSync(sync(), ASOF)),
    ok(fromJob(job(), ASOF)),
    ok(fromWallet(wallet(), ASOF)),
    ok(fromValuation(valuation(), ASOF)),
    ok(fromOverdraft(overdraft(), ASOF)),
    ok(fromForecast(forecast(), ASOF)),
  ];
}

const NONE: { notEvaluated: FindingSource[] } = { notEvaluated: [] };

/** Every statement a digest carries: headline, coverage, and each item's. */
const statementsOf = (d: FindingsDigest) => [d.statement, d.coverage.statement, ...d.items.map((i) => i.dating.statement)];

const ALL_CLEAR = /all clear|good news|nothing to report|no issues|all good|on track|nothing wrong|healthy|up to date|up-to-date/i;
const HEALTH_WORDS = /\b(fresh|healthy|ok|recovered)\b/i;

/** A deterministic permutation of `xs` from `seed` — a fixed LCG, so every run sees the same orders. */
function permute<T>(xs: readonly T[], seed: number): T[] {
  const out = [...xs];
  let s = seed;
  for (let i = out.length - 1; i > 0; i--) {
    s = (s * 1103515245 + 12345) % 2147483648;
    const j = s % (i + 1);
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

function deepFreeze<T>(x: T): T {
  if (x !== null && typeof x === 'object' && !Object.isFrozen(x)) {
    Object.freeze(x);
    for (const v of Object.values(x)) deepFreeze(v);
  }
  return x;
}

// ─── D1: carriage ──────────────────────────────────────────────────────────────────────────────

describe('P5-36 digest: carriage', () => {
  it('T36-D1: one item per finding — none dropped, added or merged; each finding deep-equal and a different object', () => {
    const input = [
      ...tenKinds(),
      // Two sync findings for one bank name, different items: not the same problem.
      ok(fromSync(sync({ key: 'acct_fixture_sync_2' }), ASOF)),
      ok(fromSync(sync({ key: 'acct_fixture_sync_3', status: 'never', daysStale: null }), ASOF)),
      // Two breaches with one subject name.
      ok(fromBreach(breach({ month: 0 }), ASOF)),
    ];
    const d = composeDigest(input, PERIOD, NONE);
    expect(d.items).toHaveLength(input.length);
    // Each input appears exactly once, as a copy.
    const remaining = [...input];
    for (const item of d.items) {
      const i = remaining.findIndex((f) => JSON.stringify(f) === JSON.stringify(item.finding));
      expect(i, item.finding.kind).toBeGreaterThanOrEqual(0);
      expect(item.finding).toEqual(remaining[i]);
      expect(input.includes(item.finding)).toBe(false);
      remaining.splice(i, 1);
    }
    expect(remaining).toEqual([]);
    expect(d.items.filter((i) => i.finding.kind === 'sync-stale').map((i) => i.finding.subject.name))
      .toEqual(['Fabricated Credit Union', 'Fabricated Credit Union', 'Fabricated Credit Union']);
    expect(d.items.filter((i) => i.finding.kind === 'budget-breach')).toHaveLength(2);
    expect(new Set(d.items.map((i) => i.finding.kind))).toEqual(new Set(FindingKindSchema.options));
  });
});

// ─── D2: the reader's order ────────────────────────────────────────────────────────────────────

describe('P5-36 digest: the reader order', () => {
  it('T36-D2: severity first, then the Q3 kind table, then input order; the same in every input order', () => {
    const breachA = ok(fromBreach(breach({ category: 'Fixture Category A', categoryId: 11 }), ASOF));
    const breachB = ok(fromBreach(breach({ category: 'Fixture Category B', categoryId: 12 }), ASOF));
    const input = [
      ok(fromSync(sync({ status: 'never', daysStale: null }), ASOF)),
      ok(fromValuation(valuation({ reason: 'never' } as Partial<ValuationFinding>), ASOF)),
      ok(fromForecast(forecast(), ASOF)),
      breachA,
      breachB,
      ok(fromDrift(drift(), ASOF)),
      ok(fromOverdraft(overdraft(), ASOF)),
      ok(fromFeed(feed(), ASOF)),
      ok(fromChronicUnderspend(underspend(), ASOF)),
      ok(fromWallet(wallet(), ASOF)),
    ];
    // The fixture is what it claims: the "never" sync and valuation are warnings, as is the forecast.
    expect(input.slice(0, 3).map((f) => f.severity)).toEqual(['warning', 'warning', 'warning']);

    const want: FindingKind[] = [
      'overdraft-open',
      'overdraft-forecast', 'budget-breach', 'budget-breach', 'balance-drift', 'sync-stale', 'valuation-stale',
      'feed-degraded', 'cash-uncounted', 'budget-underspend',
    ];
    const orders = [input, [...input].reverse(), ...[1, 2, 3, 4, 5, 6].map((seed) => permute(input, seed))];
    expect(orders).toHaveLength(8);
    for (const order of orders) {
      const d = composeDigest(order, PERIOD, NONE);
      expect(d.items.map((i) => i.finding.kind)).toEqual(want);
      // Severity never decreases in rank: no notice before a warning, no warning before a critical.
      const ranks = d.items.map((i) => SeveritySchema.options.indexOf(i.finding.severity));
      expect(ranks).toEqual([...ranks].sort((a, b) => a - b));
      // The forecast precedes both "never" warnings.
      const kinds = d.items.map((i) => i.finding.kind);
      expect(kinds.indexOf('overdraft-forecast')).toBeLessThan(kinds.indexOf('sync-stale'));
      expect(kinds.indexOf('overdraft-forecast')).toBeLessThan(kinds.indexOf('valuation-stale'));
      // Two of one kind keep their input order.
      const names = d.items.filter((i) => i.finding.kind === 'budget-breach').map((i) => i.finding.subject.name);
      const inputNames = order.filter((f) => f.kind === 'budget-breach').map((f) => f.subject.name);
      expect(names).toEqual(inputNames);
      // Only the order changed: the findings themselves are the input's, untouched.
      expect([...d.items.map((i) => JSON.stringify(i.finding))].sort()).toEqual([...order.map((f) => JSON.stringify(f))].sort());
    }
    // The kind table is the spec's, exactly.
    expect(DIGEST_KIND_ORDER).toEqual([
      'overdraft-open', 'overdraft-forecast', 'budget-breach', 'balance-drift', 'feed-degraded', 'sync-stale',
      'job-overdue', 'cash-uncounted', 'valuation-stale', 'budget-underspend',
    ]);
  });
});

// ─── D3: period ────────────────────────────────────────────────────────────────────────────────

describe('P5-36 digest: the period', () => {
  it('T36-D3: a real date is echoed; impossible dates throw; an as-of finding of another day throws; a month finding is not compared', () => {
    expect(composeDigest([], PERIOD, NONE).period).toEqual(PERIOD);
    for (const date of ['2026-02-30', '2026-13-01', '2026-1-5', '', '2026-02-29']) {
      expect(() => composeDigest([], { type: 'asOf', date }, NONE), date).toThrow(RangeError);
    }
    expect(composeDigest([], { type: 'asOf', date: '2028-02-29' }, NONE).period).toEqual({ type: 'asOf', date: '2028-02-29' });
    expect(() => composeDigest([], { type: 'month', month: '2026-03' } as unknown as DigestPeriod, NONE)).toThrow(RangeError);

    // An as-of finding dated one day off.
    const drifted = ok(fromDrift(drift(), ASOF));
    const dayBefore = asOfDate({ ...ASOF, day: ASOF.day - 1 });
    expect(() => composeDigest([drifted], { type: 'asOf', date: dayBefore }, NONE)).toThrow(RangeError);
    expect(composeDigest([drifted], PERIOD, NONE).items).toHaveLength(1);
    // A month finding and a months finding are about a calendar month, not compared with the day.
    const monthly = [ok(fromBreach(breach(), ASOF)), ok(fromChronicUnderspend(underspend(), ASOF))];
    expect(composeDigest(monthly, { type: 'asOf', date: '2027-07-01' }, NONE).items).toHaveLength(2);
  });
});

// ─── D4: dating statements ─────────────────────────────────────────────────────────────────────

describe('P5-36 digest: dating statements', () => {
  it('T36-D4: ages with the right plural and a basis label; never says never; undated cannot be dated; undated inputs are counted aloud', () => {
    const base = ok(fromDrift(drift(), ASOF));
    const one = (freshness: Freshness) => composeDigest([dated(base, freshness)], PERIOD, NONE).items[0];

    for (const [freshness, words] of [
      [fresh(0), '0 days'], [fresh(1), '1 day'], [fresh(2), '2 days'],
      [stale(0), '0 days'], [stale(1), '1 day'], [stale(20), '20 days'],
    ] as const) {
      const item = one(freshness);
      expect(item.dating.statement).toContain(`${words} ago`);
      if (freshness.ageDays === 1) expect(item.dating.statement).not.toContain('1 days');
      expect(item.dating.statement).toContain(BASIS_WORDS[freshness.basis]);
      expect(item.dating.statement).toContain('successful sync');
      expect({ ...item.dating, statement: undefined, caveat: undefined }).toEqual({
        state: freshness.state, basis: freshness.basis, ageDays: freshness.ageDays, undatedInputs: 0,
        statement: undefined, caveat: undefined,
      });
    }
    // Each basis has its own words in a dated statement.
    const labelled: [FreshnessBasis, string][] = [
      ['feed', 'bank feed refresh'], ['cash-count', 'cash count'], ['job-run', 'daily job'],
      ['overdraft-sighting', 'below the cushion'], ['overdraft-projection', 'overdraft projection'],
    ];
    for (const [basis, words] of labelled) expect(one(fresh(3, basis)).dating.statement).toContain(words);
    const valued = one(fr({ state: 'stale', basis: 'valuation', lastObserved: '2025-11-01', ageDays: 124, undatedInputs: 0 }));
    expect(valued.dating.statement).toContain('valuation');
    expect(valued.dating.statement).toContain('124 days');

    const n = one(never('sync'));
    expect(n.dating.statement).toMatch(/\bnever\b/);
    expect(n.dating.ageDays).toBeNull();
    expect(n.dating.statement).not.toMatch(/\d+ days?/);

    const u = one(undated());
    expect(u.dating.statement).toContain('cannot be dated');
    expect(u.dating.ageDays).toBeNull();
    expect(u.dating.statement).not.toMatch(/0 days/);
    expect(u.dating.statement).toContain('1 input');
    const u3 = one(undated('sync', 3));
    expect(u3.dating.statement).toContain('cannot be dated');
    expect(u3.dating.statement).toContain('3 inputs');
    expect(u3.dating.undatedInputs).toBe(3);

    // A stale finding that also rests on something undatable says both, with the count.
    const s = one(stale(4, 'sync', 2));
    expect(s.dating.statement).toContain('4 days ago');
    expect(s.dating.statement).toContain('cannot be dated');
    expect(s.dating.statement).toContain('2 inputs');
    expect(s.dating.undatedInputs).toBe(2);
    // So does a never finding.
    const nu = one(never('sync', 1));
    expect(nu.dating.statement).toMatch(/\bnever\b/);
    expect(nu.dating.statement).toContain('1 input behind it cannot be dated');
    // And a fully dated finding says nothing about undatable inputs.
    expect(one(fresh(2)).dating.statement).not.toContain('cannot be dated');
  });
});

// ─── D5: fresh is not health ───────────────────────────────────────────────────────────────────

describe('P5-36 digest: freshness is not health', () => {
  it('T36-D5: a failing feed with a fresh last success carries the caveat and says failing; no failure kind is worded as working', () => {
    const failing = ok(fromFeed(feed({ state: 'failing', lastSuccessfulUpdate: ago(HOUR), hoursStale: 1 }), ASOF));
    const withCaveat = composeDigest([dated(failing, fresh(0, 'feed'))], PERIOD, NONE).items[0];
    expect(withCaveat.dating.caveat).toBe('recent-success-feed-still-failing');
    expect(withCaveat.dating.statement).toContain('failing');
    expect(withCaveat.dating.statement).not.toMatch(HEALTH_WORDS);

    const staleFeed = ok(fromFeed(feed({ state: 'stale' }), ASOF));
    expect(composeDigest([dated(staleFeed, stale(2, 'feed'))], PERIOD, NONE).items[0].dating.caveat).toBeNull();
    // Failing, but its freshness is stale: the caveat is for the misleading combination only.
    expect(composeDigest([dated(failing, stale(2, 'feed'))], PERIOD, NONE).items[0].dating.caveat).toBeNull();

    const failureKinds = [
      failing, staleFeed,
      ok(fromSync(sync(), ASOF)), ok(fromSync(sync({ status: 'never', daysStale: null }), ASOF)),
      ok(fromJob(job(), ASOF)), ok(fromJob(job({ status: 'late', daysSince: 0 }), ASOF)),
    ];
    const states = (basis: FreshnessBasis) => [fresh(0, basis), fresh(1, basis), stale(5, basis), never(basis), undated(basis)];
    for (const f of failureKinds) {
      const basis: FreshnessBasis = f.kind === 'feed-degraded' ? 'feed' : f.kind === 'sync-stale' ? 'sync' : 'job-run';
      for (const freshness of states(basis)) {
        const item = composeDigest([dated(f, freshness)], PERIOD, NONE).items[0];
        expect({ kind: f.kind, state: freshness.state, s: item.dating.statement })
          .not.toEqual(expect.objectContaining({ s: expect.stringMatching(HEALTH_WORDS) }));
      }
    }
    // No other kind has a caveat, in any state.
    for (const f of tenKinds().filter((x) => x.kind !== 'feed-degraded')) {
      for (const freshness of [fresh(0), stale(9), never(), undated()]) {
        expect(composeDigest([dated(f, freshness)], PERIOD, NONE).items[0].dating.caveat, f.kind).toBeNull();
      }
    }
  });
});

// ─── D6: coverage and status ───────────────────────────────────────────────────────────────────

describe('P5-36 digest: coverage and status', () => {
  it('T36-D6: an empty list is none-reported only when every source ran; coverage partitions the nine in canonical order', () => {
    expect(composeDigest([], PERIOD, NONE).status).toBe('none-reported');
    const one = composeDigest([], PERIOD, { notEvaluated: ['forecasts'] });
    expect(one.status).toBe('incomplete');
    expect(one.coverage.notEvaluated).toEqual(['forecasts']);

    const all = composeDigest([], PERIOD, { notEvaluated: [...FINDING_SOURCES].reverse() });
    expect(all.status).toBe('incomplete');
    expect(all.coverage.evaluated).toEqual([]);
    expect(all.coverage.statement).toContain('No source was evaluated');
    expect(all.statement).toContain('No source was evaluated');

    const withFinding = composeDigest([ok(fromDrift(drift(), ASOF))], PERIOD, { notEvaluated: ['valuations', 'adherence'] });
    expect(withFinding.status).toBe('findings');
    expect(withFinding.coverage.notEvaluated).toEqual(['adherence', 'valuations']);

    for (let seed = 1; seed <= 12; seed++) {
      const missing = permute(FINDING_SOURCES, seed).slice(0, seed % FINDING_SOURCES.length);
      const d = composeDigest([], PERIOD, { notEvaluated: missing });
      expect(d.coverage.notEvaluated).toEqual(FINDING_SOURCES.filter((s) => missing.includes(s)));
      expect(d.coverage.evaluated).toEqual(FINDING_SOURCES.filter((s) => !missing.includes(s)));
      expect([...d.coverage.evaluated, ...d.coverage.notEvaluated].sort()).toEqual([...FINDING_SOURCES].sort());
      for (const s of missing) {
        expect(d.coverage.statement).toContain(SOURCE_LABELS[s]);
        expect(d.coverage.statement).toContain(s);
      }
      expect(d.status).toBe(missing.length === 0 ? 'none-reported' : 'incomplete');
    }
    // A repeated source appears once.
    const repeated = composeDigest([], PERIOD, { notEvaluated: ['sync', 'sync', 'job'] });
    expect(repeated.coverage.notEvaluated).toEqual(['sync', 'job']);
    expect(repeated.coverage.statement.split('sync status')).toHaveLength(2);
    // A source the vocabulary does not know is refused rather than silently dropped.
    expect(() => composeDigest([], PERIOD, { notEvaluated: ['rent' as FindingSource] })).toThrow(RangeError);
  });
});

// ─── D7: empty is not good news ────────────────────────────────────────────────────────────────

describe('P5-36 digest: an empty digest is a count, not a verdict', () => {
  it('T36-D7: no headline, coverage or item statement in any status uses an all-clear phrase; the empty headlines carry their counts', () => {
    const digests = [
      composeDigest(tenKinds(), PERIOD, NONE),
      composeDigest(tenKinds(), PERIOD, { notEvaluated: ['feed'] }),
      composeDigest([], PERIOD, { notEvaluated: ['feed', 'job'] }),
      composeDigest([], PERIOD, { notEvaluated: [...FINDING_SOURCES] }),
      composeDigest([], PERIOD, NONE),
    ];
    expect(digests.map((d) => d.status)).toEqual(['findings', 'findings', 'incomplete', 'incomplete', 'none-reported']);
    for (const d of digests) for (const s of statementsOf(d)) expect(s).not.toMatch(ALL_CLEAR);

    const none = digests[4].statement;
    expect(none).toMatch(/\b9\b/);
    expect(none).toContain('reported');
    expect(digests[2].statement).toMatch(/\b2\b/);
    expect(digests[3].statement).toMatch(/\b9\b/);
    // And every freshness state's item statement, for every kind.
    for (const f of tenKinds()) {
      for (const freshness of [fresh(0), stale(3), never(), undated()]) {
        for (const s of statementsOf(composeDigest([dated(f, freshness)], PERIOD, NONE))) expect(s).not.toMatch(ALL_CLEAR);
      }
    }
  });
});

// ─── D8, D9: tallies, never upgraded ───────────────────────────────────────────────────────────

const NINE_FRESHNESS = [fresh(0), fresh(2), stale(9), stale(4, 'sync', 2), never(), never('sync', 1), undated(), undated('sync', 3), undated('feed', 1)];

function nineItems(): Finding[] {
  const kinds = tenKinds().filter((f) => f.kind !== 'balance-drift');
  return kinds.map((f, i) => dated(f, NINE_FRESHNESS[i]));
}

describe('P5-36 digest: tallies', () => {
  it('T36-D8: the four state tallies equal an independent count, sum to the item count, and undated inputs are the sum', () => {
    const input = nineItems();
    const d = composeDigest(input, PERIOD, NONE);
    const count = (state: string) => input.filter((f) => f.freshness.state === state).length;
    expect({ fresh: d.dating.fresh, stale: d.dating.stale, never: d.dating.never, undated: d.dating.undated })
      .toEqual({ fresh: count('fresh'), stale: count('stale'), never: count('never'), undated: count('undated') });
    expect(d.dating).toEqual({ fresh: 2, stale: 2, never: 2, undated: 3, undatedInputs: 8 });
    expect(d.dating.fresh + d.dating.stale + d.dating.never + d.dating.undated).toBe(d.items.length);
    expect(d.dating.undatedInputs).toBe(input.reduce((s, f) => s + f.freshness.undatedInputs, 0));
  });

  it('T36-D9: an item\'s state is the finding\'s own; an undated item counts only as undated; a changed state moves exactly one count', () => {
    const input = nineItems();
    const d = composeDigest(input, PERIOD, NONE);
    for (const item of d.items) expect(item.dating.state).toBe(item.finding.freshness.state);

    const plusUndated = composeDigest([...input, dated(ok(fromDrift(drift(), ASOF)), undated())], PERIOD, NONE);
    expect(plusUndated.dating).toEqual({ ...d.dating, undated: d.dating.undated + 1, undatedInputs: d.dating.undatedInputs + 1 });

    // Swap one finding from fresh to never: fresh loses one, never gains one, nothing else moves.
    const swapped = [...input];
    swapped[0] = dated(input[0], never(input[0].freshness.basis === 'none' ? 'sync' : input[0].freshness.basis));
    const s = composeDigest(swapped, PERIOD, NONE);
    expect(s.dating).toEqual({ ...d.dating, fresh: d.dating.fresh - 1, never: d.dating.never + 1 });
    // And undated to fresh: undated loses one, fresh gains one, and that item's undated input goes too.
    const back = [...input];
    const idx = input.findIndex((f) => f.freshness.state === 'undated' && f.freshness.undatedInputs === 1);
    back[idx] = dated(input[idx], fresh(1));
    expect(composeDigest(back, PERIOD, NONE).dating)
      .toEqual({ ...d.dating, undated: d.dating.undated - 1, fresh: d.dating.fresh + 1, undatedInputs: d.dating.undatedInputs - 1 });
  });
});

// ─── D10: purity ───────────────────────────────────────────────────────────────────────────────

describe('P5-36 digest: purity', () => {
  it('T36-D10: no clock, no aliasing, no mutation, no dependence on notEvaluated order or the process zone', () => {
    const input = nineItems();
    vi.useFakeTimers();
    vi.setSystemTime(new Date(Date.UTC(2026, 0, 1)));
    const a = composeDigest(input, PERIOD, { notEvaluated: ['job'] });
    vi.setSystemTime(new Date(Date.UTC(2031, 6, 15, 23, 59)));
    const b = composeDigest(input, PERIOD, { notEvaluated: ['job'] });
    vi.useRealTimers();
    expect(b).toEqual(a);
    expect(composeDigest(input, PERIOD, { notEvaluated: ['job'] })).toEqual(a);

    // Deep-frozen inputs are read, never written.
    const frozen = deepFreeze(structuredClone(input));
    const frozenCoverage = deepFreeze({ notEvaluated: ['sync', 'feed'] as FindingSource[] });
    const fromFrozen = composeDigest(frozen, deepFreeze({ ...PERIOD }), frozenCoverage);
    expect(fromFrozen.items).toHaveLength(input.length);

    // Mutating an output finding leaves the input alone, and the reverse.
    const copy = structuredClone(input);
    const out = composeDigest(copy, PERIOD, NONE);
    (out.items[0].finding.subject as { name: string }).name = 'Mutated';
    expect(copy).toEqual(input);
    const before = structuredClone(out.items[1].finding);
    (copy.find((f) => JSON.stringify(f) === JSON.stringify(before))!.subject as { name: string }).name = 'Mutated too';
    expect(out.items[1].finding).toEqual(before);

    // The order of notEvaluated does not matter.
    for (let seed = 1; seed <= 5; seed++) {
      expect(composeDigest(input, PERIOD, { notEvaluated: permute(['sync', 'feed', 'wallets'], seed) as FindingSource[] }))
        .toEqual(composeDigest(input, PERIOD, { notEvaluated: ['wallets', 'sync', 'feed'] }));
    }

    // Exact sentences: this file runs under three process zones (acceptance #5), and a zone that
    // changed any of them would fail here.
    const pinned = composeDigest([dated(ok(fromDrift(drift(), ASOF)), stale(3))], PERIOD, { notEvaluated: ['job'] });
    expect(pinned.statement).toBe('1 finding reported by 8 of 9 sources. 1 source was not evaluated, so the list may be incomplete.');
    expect(pinned.coverage.statement).toBe('8 of 9 sources were evaluated. Not evaluated: daily job.');
    expect(pinned.items[0].dating.statement).toBe(
      'Its oldest input is the last successful sync, 3 days ago, older than that source is expected to be.');
    // The period is echoed, not re-derived: the fixture's as-of date is the process-local date of
    // `NOW`, which is a day later in Auckland, and the digest must carry whichever it is handed.
    expect(pinned.period).toEqual(PERIOD);
    expect(pinned.period).not.toBe(PERIOD);
  });
});

// ─── D11: no money text ────────────────────────────────────────────────────────────────────────

describe('P5-36 digest: no money in prose', () => {
  it('T36-D11: across all ten kinds and every state, no statement contains a dollar sign or a two-decimal figure', () => {
    const states = [fresh(0), fresh(1), stale(12), stale(3, 'sync', 2), never(), undated()];
    for (const freshness of states) {
      const input = tenKinds().map((f) => dated(f, freshness));
      // Not vacuous: the findings do carry two-decimal money strings, negative ones included.
      expect(JSON.stringify(input)).toMatch(/"-\d+\.\d{2}"/);
      const d = composeDigest(input, PERIOD, { notEvaluated: ['job'] });
      for (const s of statementsOf(d)) {
        expect(s).not.toMatch(/\$/);
        expect(s).not.toMatch(/\d\.\d{2}\b/);
      }
      // The figures stay in the carried findings, with their producer's sign.
      const od = d.items.find((i) => i.finding.kind === 'overdraft-open')!.finding;
      expect(od.kind === 'overdraft-open' && od.balance).toBe('-4.50');
    }
  });
});

// ─── D12: end to end through the real assembler ────────────────────────────────────────────────

describe('P5-36 digest: end to end', () => {
  it('T36-D12: producer inputs for all ten kinds through assembleFindings with a freshness context, then composeDigest', () => {
    const facts: FreshnessFacts = {
      year: ASOF.year,
      accounts: [
        { accountId: 'acct_fixture_drift', itemKey: 'acct_fixture_drift', countable: false, valuationMode: 'ledger' },
        { accountId: 'acct_fixture_wallet', itemKey: null, countable: true, valuationMode: 'ledger' },
        { accountId: 'acct_fixture_brokerage', itemKey: null, countable: false, valuationMode: 'valuation' },
      ],
      items: [
        { key: 'acct_fixture_drift', lastSyncedAt: ago(HOUR), lastSuccessfulUpdate: ago(HOUR), lastFailedUpdate: null },
        { key: 'acct_fixture_sync', lastSyncedAt: ago(3 * DAY), lastSuccessfulUpdate: ago(3 * DAY), lastFailedUpdate: null },
      ],
      cashCounts: [{ accountId: 'acct_fixture_wallet', lastCountedAt: ago(40 * DAY) }],
      valuations: [{ accountId: 'acct_fixture_brokerage', latestValuedOn: '2025-11-01' }],
      lastSchedulerRun: ago(2 * DAY),
      overdraftSightings: [{ accountId: 'acct_fixture_od', lastSeenAt: ago(HOUR) }],
      overdraftProjections: [{ accountId: 'acct_fixture_fc', projectedAt: ago(2 * HOUR) }],
      contributors: [{ categoryId: 7, accountIds: ['acct_fixture_wallet'] }],
    };
    const ctx: FreshnessContext = { now: NOW, facts };
    const sources = {
      adherence: [breach(), underspend()],
      drift: [drift()],
      feed: [feed({ state: 'failing', lastSuccessfulUpdate: ago(HOUR), hoursStale: 1 })],
      sync: [sync()],
      job: job(),
      wallets: [wallet()],
      valuations: [valuation()],
      overdrafts: [overdraft()],
      forecasts: [forecast()],
    };
    const assembled = assembleFindings({ asOf: ASOF, freshness: ctx, ...sources });
    const d = composeDigest(assembled.findings, PERIOD, { notEvaluated: assembled.notEvaluated });
    for (const item of d.items) expect(FindingSchema.safeParse(item.finding).success, item.finding.kind).toBe(true);
    expect([...d.items.map((i) => i.finding.kind)].sort()).toEqual([...FindingKindSchema.options].sort());
    expect(d.coverage.notEvaluated).toEqual([]);
    expect(d.status).toBe('findings');
    // The failing feed with an hour-old success is the caveat's case, through the real freshness rule.
    const feedItem = d.items.find((i) => i.finding.kind === 'feed-degraded')!;
    expect(feedItem.dating.state).toBe('fresh');
    expect(feedItem.dating.caveat).toBe('recent-success-feed-still-failing');

    // Omitting a source makes it not evaluated in the digest, and none of its findings appear.
    const { valuations: _omitted, ...withoutValuations } = sources;
    const partial = assembleFindings({ asOf: ASOF, freshness: ctx, ...withoutValuations });
    const p = composeDigest(partial.findings, PERIOD, { notEvaluated: partial.notEvaluated });
    expect(p.coverage.notEvaluated).toEqual(['valuations']);
    expect(p.items.some((i) => i.finding.kind === 'valuation-stale')).toBe(false);
    expect(p.items).toHaveLength(d.items.length - 1);
    expect(p.coverage.statement).toContain('valuations');
  });
});

// ─── Evidence: printed when T36_PRINT=1 (names, enum values, counts and sentences; no figures) ─────

describe('P5-36 evidence', () => {
  it('the caveat and status table, and one digest per status', () => {
    const rows: string[] = [];
    const failingFeed = ok(fromFeed(feed({ state: 'failing', lastSuccessfulUpdate: ago(HOUR), hoursStale: 1 }), ASOF));
    const kinds: [string, Finding, FreshnessBasis][] = [
      ['feed-degraded (failing)', failingFeed, 'feed'],
      ['feed-degraded (stale)', ok(fromFeed(feed(), ASOF)), 'feed'],
      ['sync-stale', ok(fromSync(sync(), ASOF)), 'sync'],
      ['job-overdue', ok(fromJob(job(), ASOF)), 'job-run'],
      ['balance-drift', ok(fromDrift(drift(), ASOF)), 'sync'],
    ];
    for (const [label, f, basis] of kinds) {
      for (const freshness of [fresh(0, basis), stale(5, basis), never(basis), undated(basis)]) {
        const d = composeDigest([dated(f, freshness)], PERIOD, NONE);
        rows.push(`| ${label} | ${freshness.state} | ${d.items[0].dating.caveat ?? 'null'} | ${d.status} |`);
      }
    }
    expect(rows).toHaveLength(20);
    const show = (title: string, d: FindingsDigest) => [
      `### ${title} — status ${d.status}`,
      `- headline: ${d.statement}`,
      `- coverage: ${d.coverage.statement}`,
      `- tallies: fresh ${d.dating.fresh}, stale ${d.dating.stale}, never ${d.dating.never}, undated ${d.dating.undated}, undated inputs ${d.dating.undatedInputs}`,
      ...d.items.map((i, n) => `${n + 1}. ${i.finding.kind} (${i.finding.severity}) — ${i.dating.statement}`),
    ].join('\n');
    const withFindings = composeDigest(
      [...nineItems(), dated(ok(fromFeed(feed({ state: 'failing', lastSuccessfulUpdate: ago(HOUR), hoursStale: 1 }), ASOF)), fresh(0, 'feed'))],
      PERIOD, { notEvaluated: ['drift'] });
    const printed = [
      '| kind | freshness state | caveat | status |', '|---|---|---|---|', ...rows, '',
      show('findings', withFindings), '',
      show('incomplete', composeDigest([], PERIOD, { notEvaluated: ['forecasts', 'wallets'] })), '',
      show('none-reported', composeDigest([], PERIOD, NONE)),
    ].join('\n');
    expect(printed).not.toMatch(/\$|\d\.\d{2}\b/);
    if (process.env.T36_PRINT === '1') console.log(`\n${printed}\n`);
  });
});
