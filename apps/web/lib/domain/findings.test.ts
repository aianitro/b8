// P5-34 — the conversions and the assembler (scenarios V1–V14, A1–A8).
//
// The contract's own refusals are `packages/contracts/findings.test.ts` (C1–C6); the source-level
// wiring is `lib/findingsWiring.test.ts` (W1–W6). What these pin is behaviour: which producer state
// becomes which severity, that a producer's null stays null and its sign stays its sign, and that
// the assembled list says which producers it was never given.
//
// FIXTURES ARE FABRICATED. Institutions, accounts and categories are named like `Fabricated Credit
// Union` and `Fixture Checking`; amounts are small bare numbers chosen to exercise a rule, not taken
// from anywhere. Where a producer is pure it is called for real (`detectDrift`, `feedFindings`,
// `classifySyncHealth`, `staleWallets`, `staleValuations`), so the conversions are tested against
// what the producer actually emits rather than against a hand-written guess at it.
//
// TIME. Every instant is built from explicit components (`Date.UTC(…)`), and nothing below reads the
// clock; acceptance #5 runs this file under three process time zones.

import { afterEach, describe, expect, it, vi } from 'vitest';

// `lib/overviewRead.ts` reaches `./db`, which builds a `pg.Pool` at module scope. V12 needs its
// `wireMoney` and nothing else; the mock makes any SQL a loud failure rather than a connection, the
// same isolation `overviewRead.test.ts` uses.
vi.mock('../db', () => ({
  default: {
    query: () => {
      throw new Error('the pure finding fixtures must not reach the database');
    },
  },
}));

import { wireMoney } from '../overviewRead';
import { FindingSchema, type Finding, type FindingKind, type Severity } from '@b8/contracts/findings';
import type { Assert, Equals } from '@b8/contracts/exact';
import {
  FINDING_CONVERSIONS,
  FINDING_SOURCES,
  asOfDate,
  assembleFindings,
  calendarMonthOf,
  findingMoney,
  fromAdherence,
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
  type FindingOf,
  type FindingSources,
  type FindingsInput,
} from './findings';
import type { AsOf } from './pacing';
import type { BreachFinding, ChronicUnderspendFinding, MonthVariance } from './adherence';
import { detectDrift, type DriftFinding } from './drift';
import { feedFindings, type FeedFinding, type FeedObservation } from './feedHealth';
import { classifySyncHealth, type SyncItemHealth } from './syncHealth';
import type { JobHealth } from './jobHealth';
import { staleWallets, type WalletFinding } from './walletStaleness';
import { staleValuations, type ValuationFinding } from './valuationStaleness';
import type { ForecastFinding, OverdraftFinding } from '../overdraftWatch';

// ─── Every producer field has a carriage decision (type level) ──────────────────────────────────
//
// SPEC.md: "the type-level and runtime exactness checks force a decision for any producer field not
// listed". These are the type-level half: each producer's key set, written out. A field added to a
// producer fails `tsc` here (acceptance #1) until somebody decides whether the conversion carries it
// or — as `charges` is — drops it; V13 is the runtime half. Distributive over unions, so both
// variants of `ValuationFinding` count.

type KeysOf<T> = T extends unknown ? keyof T : never;
export type ProducerFieldsAreDecided = [
  Assert<Equals<KeysOf<BreachFinding>,
    'kind' | 'categoryId' | 'category' | 'scored' | 'month' | 'budgeted' | 'actual' | 'variance' | 'ratio'>>,
  Assert<Equals<KeysOf<ChronicUnderspendFinding>,
    'kind' | 'categoryId' | 'category' | 'scored' | 'months' | 'budgeted' | 'actual' | 'variance'>>,
  Assert<Equals<KeysOf<MonthVariance>, 'month' | 'budgeted' | 'actual' | 'variance' | 'ratio'>>,
  Assert<Equals<KeysOf<DriftFinding>,
    'accountId' | 'name' | 'ledgerBalance' | 'expectedBalance' | 'drift' | 'observedAt'
    | 'suggestedBeginningBalance' | 'safeToDerive'>>,
  Assert<Equals<KeysOf<FeedFinding>,
    'institution' | 'accountCount' | 'state' | 'lastSuccessfulUpdate' | 'hoursStale' | 'institutionStatus'
    | 'institutionStatusAt'>>,
  Assert<Equals<KeysOf<SyncItemHealth>, 'key' | 'bank' | 'accountCount' | 'daysStale' | 'status'>>,
  Assert<Equals<KeysOf<JobHealth>, 'status' | 'daysSince' | 'message'>>,
  Assert<Equals<KeysOf<WalletFinding>, 'accountId' | 'name' | 'balance' | 'daysSinceCount' | 'reason'>>,
  Assert<Equals<KeysOf<ValuationFinding>, 'id' | 'name' | 'reason' | 'daysSince'>>,
  Assert<Equals<KeysOf<OverdraftFinding>,
    'accountId' | 'account' | 'bank' | 'balance' | 'cushion' | 'since' | 'seenAt'>>,
  // `charges` is listed because it IS decided: dropped, for privacy. V13 pins that it is the only one.
  Assert<Equals<KeysOf<ForecastFinding>,
    'accountId' | 'account' | 'bank' | 'cushion' | 'low' | 'lowOn' | 'charges' | 'projectedAt'>>,
];

// ─── Fixtures ──────────────────────────────────────────────────────────────────────────────────

const ASOF: AsOf = { year: 2026, month: 2, day: 5 };
const utc = (y: number, m: number, d: number, h = 0) => new Date(Date.UTC(y, m, d, h));
const NOW = utc(2026, 2, 5, 12);

const monthVariance = (month: number, budgeted: number, actual: number): MonthVariance => ({
  month, budgeted, actual, variance: Math.round((actual - budgeted) * 100) / 100,
  ratio: budgeted === 0 ? null : actual / budgeted,
});

const breach = (over: Partial<BreachFinding> = {}): BreachFinding => ({
  kind: 'breach', categoryId: 7, category: 'Fixture Category', scored: true,
  ...monthVariance(4, 10, 12.5), ...over,
});

const underspend = (over: Partial<ChronicUnderspendFinding> = {}): ChronicUnderspendFinding => ({
  kind: 'chronic-underspend', categoryId: 8, category: 'Fixture Groceries', scored: true,
  months: [monthVariance(2, 10, 1), monthVariance(5, 10, 2), monthVariance(6, 10, 3)],
  budgeted: 30, actual: 6, variance: -24, ...over,
});

const drift = (over: Partial<DriftFinding> = {}): DriftFinding => ({
  accountId: 'acct_fixture_drift', name: 'Fixture Checking', ledgerBalance: 20, expectedBalance: 25,
  drift: 5, observedAt: '2026-03-05T06:00:00.000Z', suggestedBeginningBalance: 5, safeToDerive: true, ...over,
});

const feed = (over: Partial<FeedFinding> = {}): FeedFinding => ({
  institution: 'Fabricated Credit Union', accountCount: 2, state: 'stale',
  lastSuccessfulUpdate: utc(2026, 2, 1), hoursStale: 108, institutionStatus: 'HEALTHY',
  institutionStatusAt: utc(2026, 1, 1), ...over,
});

const sync = (over: Partial<SyncItemHealth> = {}): SyncItemHealth => ({
  key: 'acct_fixture_sync', bank: 'Fabricated Credit Union', accountCount: 1, daysStale: 3, status: 'stale', ...over,
});

const job = (over: Partial<JobHealth> = {}): JobHealth => ({
  status: 'missed', daysSince: 4, message: 'A fabricated sentence about the daily job.', ...over,
});

const wallet = (over: Partial<WalletFinding> = {}): WalletFinding => ({
  accountId: 'acct_fixture_wallet', name: 'Fixture Wallet', balance: 12, daysSinceCount: 40, reason: 'stale', ...over,
});

const valuationStale: ValuationFinding = { id: 'acct_fixture_brokerage', name: 'Fixture Brokerage', reason: 'stale', daysSince: 120 };
const valuationNever: ValuationFinding = { id: 'acct_fixture_pension', name: 'Fixture Pension', reason: 'never' };

const overdraft = (over: Partial<OverdraftFinding> = {}): OverdraftFinding => ({
  accountId: 'acct_fixture_od', account: 'Fixture Joint Checking', bank: null, balance: -4.5, cushion: 5,
  since: '2026-03-04 06:00:00+00', seenAt: '2026-03-05 06:00:00+00', ...over,
});

const CANARY = 'CANARY_MERCHANT_LABEL';
const forecast = (over: Partial<ForecastFinding> = {}): ForecastFinding => ({
  accountId: 'acct_fixture_fc', account: 'Fixture Bills Checking', bank: 'Fabricated Credit Union',
  cushion: 5, low: -2.25, lowOn: '2026-03-09',
  charges: [{ label: CANARY, amount: 7.25, on: '2026-03-07' }, { label: `${CANARY}_2`, amount: 1.5, on: '2026-03-08' }],
  projectedAt: '2026-03-05 06:00:00+00', ...over,
});

/** The as-of period every state-of-the-world finding carries. A7 pins its text; these pin its use. */
const AS_OF_PERIOD = { type: 'asOf', date: asOfDate(ASOF) } as const;

/**
 * A fixture exercising every reportable state of every kind, in each producer's own order. Breach
 * months avoid January so a parse here is not what detects a missing `+ 1` (V1 and A7 own that).
 */
function fullSources(): FindingSources {
  return {
    adherence: [breach({ month: 11 }), breach({ categoryId: 9, category: 'Fixture Fixed Line', scored: false }), underspend()],
    drift: [drift(), drift({ accountId: 'acct_fixture_drift_2', drift: -3, safeToDerive: false, observedAt: null })],
    feed: [feed({ state: 'failing', lastSuccessfulUpdate: null, hoursStale: null, institutionStatus: null, institutionStatusAt: null }), feed()],
    sync: [sync({ status: 'never', daysStale: null, key: 'acct_fixture_sync_2' }), sync()],
    job: job({ status: 'never', daysSince: null, message: 'A fabricated sentence about a job that never ran.' }),
    wallets: [wallet({ reason: 'never', daysSinceCount: null, accountId: 'acct_fixture_wallet_2' }), wallet()],
    valuations: [valuationNever, valuationStale],
    overdrafts: [overdraft()],
    forecasts: [forecast()],
  };
}

const parsesAll = (fs: readonly Finding[]) => fs.every((f) => FindingSchema.safeParse(f).success);
const severities = (fs: readonly Finding[]) => fs.map((f) => f.severity);
const RANK: Record<Severity, number> = { critical: 0, warning: 1, notice: 2 };
const nonIncreasing = (ss: Severity[]) => ss.every((s, i) => i === 0 || RANK[ss[i - 1]] <= RANK[s]);

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

// ─── V: the conversions ────────────────────────────────────────────────────────────────────────

describe('P5-34 conversions', () => {
  it('T34-V1: budget-breach — scored is warning, unscored is notice and still emitted; months are 1-based', () => {
    const scored = fromBreach(breach({ scored: true }), ASOF);
    expect([scored.severity, scored.confidence]).toEqual(['warning', 'inferred']);
    expect(scored.scored).toBe(true);

    const unscored = fromBreach(breach({ scored: false }), ASOF);
    expect(unscored).not.toBeNull();
    expect([unscored.severity, unscored.confidence]).toEqual(['notice', 'inferred']);
    expect(unscored.scored).toBe(false);
    // Through the assembler too: an unscored breach is not filtered out anywhere on the way.
    const assembled = assembleFindings({ asOf: ASOF, adherence: [breach({ scored: false })] });
    expect(assembled.findings.map((f) => f.kind)).toEqual(['budget-breach']);

    // Month 0 is January and month 11 is December, of the as-of year.
    expect(fromBreach(breach({ month: 0 }), ASOF).period).toEqual({ type: 'month', month: '2026-01' });
    expect(fromBreach(breach({ month: 11 }), ASOF).period).toEqual({ type: 'month', month: '2026-12' });
    expect(fromBreach(breach({ month: 4 }), { year: 2025, month: 11, day: 31 }).period)
      .toEqual({ type: 'month', month: '2025-05' });
    expect(() => fromBreach(breach({ month: 12 }), ASOF)).toThrow(RangeError);

    // Spend against nothing budgeted: the ratio stays null, never 0 and never Infinity.
    const unbudgeted = fromBreach(breach(monthVariance(3, 0, 4)), ASOF);
    expect(unbudgeted.ratio).toBeNull();
    expect(unbudgeted.budgeted).toBe('0.00');
    expect(unbudgeted.subject).toEqual({ type: 'category', id: 7, name: 'Fixture Category' });
    expect(FindingSchema.safeParse(unbudgeted).success).toBe(true);
  });

  it('T34-V2: budget-underspend — notice for scored and unscored; non-contiguous months ascend as text', () => {
    for (const scored of [true, false]) {
      const f = fromChronicUnderspend(underspend({ scored }), ASOF);
      expect([f.severity, f.confidence, f.scored]).toEqual(['notice', 'inferred', scored]);
    }
    const f = fromChronicUnderspend(underspend(), ASOF);
    // Qualifying months [2, 5, 6] — not contiguous, and not widened into a March-to-July range.
    expect(f.period).toEqual({ type: 'months', months: ['2026-03', '2026-06', '2026-07'] });
    expect(f.monthly.map((m) => m.month)).toEqual(['2026-03', '2026-06', '2026-07']);
    // The window totals are the producer's, carried — not re-summed from the months.
    expect([f.budgeted, f.actual, f.variance]).toEqual(['30.00', '6.00', '-24.00']);
    expect(f.monthly[0]).toEqual({ month: '2026-03', budgeted: '10.00', actual: '1.00', variance: '-9.00', ratio: 0.1 });
    // The edges of the year, in one window.
    const edges = fromChronicUnderspend(underspend({
      months: [monthVariance(0, 10, 1), monthVariance(1, 10, 1), monthVariance(11, 10, 1)],
    }), ASOF);
    expect(edges.period).toEqual({ type: 'months', months: ['2026-01', '2026-02', '2026-12'] });
    expect(FindingSchema.safeParse(f).success).toBe(true);
    expect(FindingSchema.safeParse(edges).success).toBe(true);
  });

  it('T34-V3: balance-drift — warning either way, signs kept, observedAt null kept, no -0.00', () => {
    // Real producer output for a credit account: the ledger and Plaid's figure are both negative in
    // the ledger's convention, and the conversion must not flip either again.
    const [owed] = detectDrift([{
      accountId: 'acct_fixture_card', name: 'Fixture Card', type: 'credit', ledgerBalance: -50.25,
      plaidBalance: 48.75, observedAt: null, currentBeginningBalance: 0, hasBeginningBalance: false,
    }]);
    const a = fromDrift(owed, ASOF);
    expect(a.ledgerBalance).toBe('-50.25');
    expect(a.expectedBalance).toBe('-48.75');
    expect(a.drift).toBe('1.50');
    expect(a.observedAt).toBeNull();
    expect([a.severity, a.confidence, a.safeToDerive]).toEqual(['warning', 'observed', true]);
    expect(a.subject).toEqual({ type: 'account', id: 'acct_fixture_card', name: 'Fixture Card' });
    expect(a.period).toEqual(AS_OF_PERIOD);

    // A negative drift stays negative, and safeToDerive false is still a warning.
    const b = fromDrift(drift({ ledgerBalance: 40, expectedBalance: 35, drift: -5, suggestedBeginningBalance: -5, safeToDerive: false }), ASOF);
    expect([b.drift, b.suggestedBeginningBalance]).toEqual(['-5.00', '-5.00']);
    expect([b.severity, b.safeToDerive]).toEqual(['warning', false]);
    expect(b.observedAt).toBe('2026-03-05T06:00:00.000Z');

    // A figure that rounds to zero from below prints as zero, not "-0.00".
    const c = fromDrift(drift({ ledgerBalance: -0.004, expectedBalance: -0, drift: -0.001, suggestedBeginningBalance: -0 }), ASOF);
    expect(JSON.stringify(c)).not.toContain('-0.00');
    expect([c.ledgerBalance, c.expectedBalance, c.drift]).toEqual(['0.00', '0.00', '0.00']);
    for (const f of [a, b, c]) expect(FindingSchema.safeParse(f).success).toBe(true);
  });

  it('T34-V4: feed-degraded — failing is warning, stale is notice; unread status and no-success hours stay null', () => {
    const failing = fromFeed(feed({
      state: 'failing', lastSuccessfulUpdate: null, hoursStale: null, institutionStatus: null, institutionStatusAt: null,
    }), ASOF);
    expect([failing.severity, failing.confidence]).toEqual(['warning', 'observed']);
    expect(failing.institutionStatus).toBeNull();
    expect(failing.institutionStatusAt).toBeNull();
    expect(failing.hoursStale).toBeNull();
    expect(failing.lastSuccessfulUpdate).toBeNull();

    // Stale beside a HEALTHY bank: reported, at notice, with the status carried as-is.
    const stale = fromFeed(feed(), ASOF);
    expect([stale.severity, stale.confidence]).toEqual(['notice', 'observed']);
    expect(stale.institutionStatus).toBe('HEALTHY');
    expect(stale.lastSuccessfulUpdate).toBe('2026-03-01T00:00:00.000Z');
    expect(stale.institutionStatusAt).toBe('2026-02-01T00:00:00.000Z');
    expect(stale.hoursStale).toBe(108);
    // A stale feed with an unread status is still unread — not HEALTHY.
    expect(fromFeed(feed({ institutionStatus: null, institutionStatusAt: null }), ASOF).institutionStatus).toBeNull();
    // A HEALTHY status does not lower a failing feed either.
    expect(fromFeed(feed({ state: 'failing' }), ASOF).severity).toBe('warning');
    expect(stale.subject).toEqual({ type: 'institution', name: 'Fabricated Credit Union' });
    expect(stale.period).toEqual(AS_OF_PERIOD);
    expect(FindingSchema.safeParse(failing).success && FindingSchema.safeParse(stale).success).toBe(true);
  });

  it('T34-V5: sync-stale — ok yields nothing, never is warning with null days, stale is notice', () => {
    expect(fromSync(sync({ status: 'ok', daysStale: 0 }), ASOF)).toBeNull();
    expect(fromSync(sync({ status: 'ok', daysStale: 1 }), ASOF)).toBeNull();

    const never = fromSync(sync({ status: 'never', daysStale: null, bank: 'Unknown' }), ASOF)!;
    expect([never.severity, never.confidence, never.status]).toEqual(['warning', 'observed', 'never']);
    expect(never.daysStale).toBeNull();
    // The producer's own `Unknown` for a null bank, inherited and not re-spelled.
    expect(never.subject).toEqual({ type: 'institution', name: 'Unknown' });

    const stale = fromSync(sync(), ASOF)!;
    expect([stale.severity, stale.status, stale.daysStale, stale.key, stale.accountCount])
      .toEqual(['notice', 'stale', 3, 'acct_fixture_sync', 1]);
    expect(stale.period).toEqual(AS_OF_PERIOD);
    expect(FindingSchema.safeParse(never).success && FindingSchema.safeParse(stale).success).toBe(true);
  });

  it('T34-V6: job-overdue — fresh yields nothing, late is notice, missed and never are warning; message verbatim', () => {
    expect(fromJob(job({ status: 'fresh', daysSince: 0, message: 'The daily job ran today.' }), ASOF)).toBeNull();
    const late = fromJob(job({ status: 'late', daysSince: 1, message: 'A fabricated late sentence.' }), ASOF)!;
    expect([late.severity, late.confidence, late.daysSince]).toEqual(['notice', 'observed', 1]);
    const missed = fromJob(job(), ASOF)!;
    expect([missed.severity, missed.daysSince]).toEqual(['warning', 4]);
    const message = 'The daily job has never run on this machine.';
    const never = fromJob(job({ status: 'never', daysSince: null, message }), ASOF)!;
    expect([never.severity, never.status]).toEqual(['warning', 'never']);
    expect(never.daysSince).toBeNull();
    expect(never.message).toBe(message);
    expect(late.message).toBe('A fabricated late sentence.');
    expect(never.subject).toEqual({ type: 'system', name: 'daily-job' });
    expect(never.period).toEqual(AS_OF_PERIOD);
    for (const f of [late, missed, never]) expect(FindingSchema.safeParse(f).success).toBe(true);
  });

  it('T34-V7: cash-uncounted — never is warning with a null count, stale is notice; a negative balance keeps its sign', () => {
    const never = fromWallet(wallet({ reason: 'never', daysSinceCount: null, balance: -3.5 }), ASOF);
    expect([never.severity, never.confidence, never.reason]).toEqual(['warning', 'observed', 'never']);
    expect(never.daysSinceCount).toBeNull();
    expect(never.balance).toBe('-3.50');
    const stale = fromWallet(wallet(), ASOF);
    expect([stale.severity, stale.reason, stale.daysSinceCount, stale.balance]).toEqual(['notice', 'stale', 40, '12.00']);
    expect(stale.subject).toEqual({ type: 'account', id: 'acct_fixture_wallet', name: 'Fixture Wallet' });
    expect(stale.period).toEqual(AS_OF_PERIOD);
    expect(FindingSchema.safeParse(never).success && FindingSchema.safeParse(stale).success).toBe(true);
  });

  it('T34-V8: valuation-stale — never is warning with daysSince null (present, not absent), stale is notice with the count', () => {
    const never = fromValuation(valuationNever, ASOF);
    expect([never.severity, never.confidence, never.reason]).toEqual(['warning', 'observed', 'never']);
    expect('daysSince' in never).toBe(true);
    expect(never.daysSince).toBeNull();
    const stale = fromValuation(valuationStale, ASOF);
    expect([stale.severity, stale.reason, stale.daysSince]).toEqual(['notice', 'stale', 120]);
    expect(stale.subject).toEqual({ type: 'account', id: 'acct_fixture_brokerage', name: 'Fixture Brokerage' });
    expect(stale.period).toEqual(AS_OF_PERIOD);
    expect(FindingSchema.safeParse(never).success && FindingSchema.safeParse(stale).success).toBe(true);
  });

  it('T34-V9: overdraft-open — critical and observed; a negative balance keeps its sign; bank null stays null', () => {
    const f = fromOverdraft(overdraft(), ASOF);
    expect([f.severity, f.confidence]).toEqual(['critical', 'observed']);
    expect(f.balance).toBe('-4.50');
    expect(f.cushion).toBe('5.00');
    expect(f.bank).toBeNull();
    expect([f.since, f.seenAt]).toEqual(['2026-03-04 06:00:00+00', '2026-03-05 06:00:00+00']);
    expect(f.subject).toEqual({ type: 'account', id: 'acct_fixture_od', name: 'Fixture Joint Checking' });
    expect(f.period).toEqual(AS_OF_PERIOD);
    expect(fromOverdraft(overdraft({ bank: 'Fabricated Credit Union' }), ASOF).bank).toBe('Fabricated Credit Union');
    expect(FindingSchema.safeParse(f).success).toBe(true);
  });

  it('T34-V10: overdraft-forecast — warning and projected; the charges canary appears nowhere', () => {
    const f = fromForecast(forecast(), ASOF);
    expect([f.severity, f.confidence]).toEqual(['warning', 'projected']);
    expect([f.low, f.cushion, f.lowOn, f.projectedAt]).toEqual(['-2.25', '5.00', '2026-03-09', '2026-03-05 06:00:00+00']);
    expect('charges' in f).toBe(false);
    expect(JSON.stringify(f)).not.toContain(CANARY);
    expect(f.bank).toBe('Fabricated Credit Union');
    expect(fromForecast(forecast({ bank: null }), ASOF).bank).toBeNull();
    expect(f.period).toEqual(AS_OF_PERIOD);
    expect(FindingSchema.safeParse(f).success).toBe(true);
  });

  it("T34-V11: within each sorting producer, converted severity never rises along the producer's own order", () => {
    const feedOut = feedFindings([
      { institution: 'Fabricated Savings Bank', accountCount: 1, lastSuccessfulUpdate: utc(2026, 1, 20), lastFailedUpdate: null, institutionStatus: 'HEALTHY', institutionStatusAt: null },
      { institution: 'Fabricated Credit Union', accountCount: 2, lastSuccessfulUpdate: utc(2026, 2, 4), lastFailedUpdate: utc(2026, 2, 5), institutionStatus: null, institutionStatusAt: null },
      { institution: 'Fabricated Thrift', accountCount: 1, lastSuccessfulUpdate: utc(2026, 2, 1), lastFailedUpdate: null, institutionStatus: 'DEGRADED', institutionStatusAt: null },
    ] satisfies FeedObservation[], NOW);
    const syncOut = classifySyncHealth([
      { key: 'acct_a', bank: 'Fabricated Savings Bank', accountCount: 1, lastSyncedAt: utc(2026, 1, 25) },
      { key: 'acct_b', bank: null, accountCount: 1, lastSyncedAt: null },
      { key: 'acct_c', bank: 'Fabricated Thrift', accountCount: 2, lastSyncedAt: utc(2026, 2, 1) },
    ], NOW).filter((h) => h.status !== 'ok');
    const walletOut = staleWallets([
      { accountId: 'w1', name: 'Fixture Wallet', balance: 12, lastCountedAt: '2026-01-01T00:00:00.000Z' },
      { accountId: 'w2', name: 'Fixture Purse', balance: 3, lastCountedAt: null },
    ], NOW);
    const valuationOut = staleValuations([
      { id: 'v1', name: 'Fixture Brokerage', latestValuedOn: '2025-10-01' },
      { id: 'v2', name: 'Fixture Pension', latestValuedOn: null },
    ], '2026-03-05');

    // Both states present in each, so the property is not vacuously true of a one-state list.
    expect(new Set(feedOut.map((f) => f.state))).toEqual(new Set(['failing', 'stale']));
    expect(new Set(syncOut.map((h) => h.status))).toEqual(new Set(['never', 'stale']));
    expect(new Set(walletOut.map((w) => w.reason))).toEqual(new Set(['never', 'stale']));
    expect(new Set(valuationOut.map((v) => v.reason))).toEqual(new Set(['never', 'stale']));

    const lists: Severity[][] = [
      feedOut.map((f) => fromFeed(f, ASOF).severity),
      syncOut.map((h) => fromSync(h, ASOF)!.severity),
      walletOut.map((w) => fromWallet(w, ASOF).severity),
      valuationOut.map((v) => fromValuation(v, ASOF).severity),
    ];
    for (const ss of lists) {
      expect(nonIncreasing(ss), ss.join(',')).toBe(true);
      // And the producer's worst state is strictly worse than its other one.
      expect(RANK[ss[0]]).toBeLessThan(RANK[ss[ss.length - 1]]);
    }
  });

  it('T34-V12: every money string equals wireMoney for the same number', () => {
    const inputs = [
      -0.004, 0.005, 1.005, -0, 0, 1e-7, -1e-7, 2.675, -2.675, 0.015, -0.005, 1.1 + 2.2,
      123456789.995, 9007199254.74, -9007199254.74, 0.1 * 3, -1.115, 1e12 + 0.125,
    ];
    expect(inputs.length).toBeGreaterThanOrEqual(12);
    for (const n of inputs) {
      const want = wireMoney(n);
      expect(findingMoney(n), String(n)).toBe(want);
      // Through the conversions, not only the helper.
      expect(fromWallet(wallet({ balance: n }), ASOF).balance, `wallet ${n}`).toBe(want);
      const od = fromOverdraft(overdraft({ balance: n, cushion: n }), ASOF);
      expect([od.balance, od.cushion], `overdraft ${n}`).toEqual([want, want]);
      expect(fromForecast(forecast({ low: n }), ASOF).low, `forecast ${n}`).toBe(want);
      expect(fromBreach(breach({ budgeted: n, actual: n, variance: n }), ASOF).variance, `breach ${n}`).toBe(want);
      expect(want).not.toBe('-0.00');
    }
    expect(() => findingMoney(Number.NaN)).toThrow(RangeError);
    expect(() => findingMoney(Infinity)).toThrow(RangeError);
  });

  it('T34-V13: every producer field reaches the Finding, except exactly ForecastFinding.charges', () => {
    // Each leaf of each producer fixture is a distinct sentinel. Money sentinels have two non-zero
    // decimals so the producer's number and the Finding's string print the same digits; months and
    // instants are rendered the way the vocabulary renders them; nulls must stay null under their
    // own key. What is left over, per kind, is the dropped set.
    type Leaf = { path: string[]; value: unknown };
    const leaves = (v: unknown, path: string[] = []): Leaf[] => {
      if (v instanceof Date || v === null || typeof v !== 'object') return [{ path, value: v }];
      return Object.entries(v).flatMap(([k, x]) => leaves(x, [...path, k]));
    };
    const found = (producer: object, finding: object): { missing: string[] } => {
      const text = JSON.stringify(finding);
      const missing: string[] = [];
      for (const { path, value } of leaves(producer)) {
        const key = path[path.length - 1];
        let ok: boolean;
        if (value === null) {
          ok = (finding as Record<string, unknown>)[key] === null;
        } else if (value instanceof Date) {
          ok = text.includes(JSON.stringify(value.toISOString()));
        } else if (key === 'month' && typeof value === 'number') {
          ok = text.includes(JSON.stringify(calendarMonthOf(ASOF.year, value)));
        } else if (typeof value === 'boolean') {
          ok = text.includes(`"${key}":${value}`);
        } else if (key === 'kind') {
          // The producer's own discriminant became the finding's kind; checked by the kind itself.
          ok = (finding as { kind: string }).kind === ({ breach: 'budget-breach', 'chronic-underspend': 'budget-underspend' } as Record<string, string>)[value as string];
        } else {
          ok = text.includes(typeof value === 'string' ? JSON.stringify(value) : String(value));
        }
        if (!ok) missing.push(path.join('.'));
      }
      return { missing };
    };

    const populated: { kind: FindingKind; producer: object; finding: Finding | null }[] = [];
    const add = <T extends object>(kind: FindingKind, producer: T, convert: (p: T, a: AsOf) => Finding | null) =>
      populated.push({ kind, producer, finding: convert(producer, ASOF) });

    add('budget-breach', { kind: 'breach', categoryId: 9101, category: 'S_breach_category', scored: true, month: 9, budgeted: 9102.25, actual: 9103.75, variance: 1.55, ratio: 1.3301 } as BreachFinding, fromBreach);
    add('budget-breach', { kind: 'breach', categoryId: 9111, category: 'S_breach_category_2', scored: false, month: 3, budgeted: 0, actual: 9113.25, variance: 9113.25, ratio: null } as BreachFinding, fromAdherence);
    add('budget-underspend', {
      kind: 'chronic-underspend', categoryId: 9201, category: 'S_under_category', scored: false,
      months: [
        { month: 1, budgeted: 9211.25, actual: 9212.25, variance: 9213.25, ratio: 0.4101 },
        { month: 4, budgeted: 9221.25, actual: 9222.25, variance: 9223.25, ratio: 0.4202 },
        { month: 8, budgeted: 9231.25, actual: 9232.25, variance: 9233.25, ratio: 0.4303 },
      ],
      budgeted: 9241.25, actual: 9242.25, variance: -9243.25,
    } as ChronicUnderspendFinding, fromChronicUnderspend);
    add('balance-drift', { accountId: 'S_drift_id', name: 'S_drift_name', ledgerBalance: -9301.25, expectedBalance: -9302.75, drift: -9303.15, observedAt: 'S_drift_observed', suggestedBeginningBalance: 9304.35, safeToDerive: false } as DriftFinding, fromDrift);
    add('balance-drift', drift({ accountId: 'S_drift_id_2', observedAt: null, safeToDerive: true }), fromDrift);
    add('feed-degraded', { institution: 'S_feed_inst', accountCount: 9401, state: 'stale', lastSuccessfulUpdate: utc(2025, 6, 7, 8), hoursStale: 9402, institutionStatus: 'DEGRADED', institutionStatusAt: utc(2025, 5, 6, 7) } as FeedFinding, fromFeed);
    add('feed-degraded', feed({ institution: 'S_feed_inst_2', state: 'failing', lastSuccessfulUpdate: null, hoursStale: null, institutionStatus: null, institutionStatusAt: null }), fromFeed);
    add('sync-stale', { key: 'S_sync_key', bank: 'S_sync_bank', accountCount: 9501, daysStale: 9502, status: 'stale' } as SyncItemHealth, fromSync);
    add('sync-stale', { key: 'S_sync_key_2', bank: 'S_sync_bank_2', accountCount: 9511, daysStale: null, status: 'never' } as SyncItemHealth, fromSync);
    add('job-overdue', { status: 'missed', daysSince: 9601, message: 'S_job_message' } as JobHealth, fromJob);
    add('job-overdue', { status: 'never', daysSince: null, message: 'S_job_message_2' } as JobHealth, fromJob);
    add('cash-uncounted', { accountId: 'S_wallet_id', name: 'S_wallet_name', balance: -9701.25, daysSinceCount: 9702, reason: 'stale' } as WalletFinding, fromWallet);
    add('cash-uncounted', { accountId: 'S_wallet_id_2', name: 'S_wallet_name_2', balance: 9711.25, daysSinceCount: null, reason: 'never' } as WalletFinding, fromWallet);
    add('valuation-stale', { id: 'S_val_id', name: 'S_val_name', reason: 'stale', daysSince: 9801 } as ValuationFinding, fromValuation);
    add('valuation-stale', { id: 'S_val_id_2', name: 'S_val_name_2', reason: 'never' } as ValuationFinding, fromValuation);
    add('overdraft-open', { accountId: 'S_od_id', account: 'S_od_account', bank: 'S_od_bank', balance: -9901.25, cushion: 9902.75, since: 'S_od_since', seenAt: 'S_od_seen' } as OverdraftFinding, fromOverdraft);
    add('overdraft-open', overdraft({ accountId: 'S_od_id_2', bank: null }), fromOverdraft);
    add('overdraft-forecast', {
      accountId: 'S_fc_id', account: 'S_fc_account', bank: 'S_fc_bank', cushion: 9951.25, low: -9952.75,
      lowOn: 'S_fc_low_on', charges: [{ label: 'S_fc_charge_label', amount: 9953.25, on: 'S_fc_charge_on' }],
      projectedAt: 'S_fc_projected',
    } as ForecastFinding, fromForecast);
    add('overdraft-forecast', forecast({ accountId: 'S_fc_id_2', bank: null }), fromForecast);

    // Every kind is exercised.
    expect(new Set(populated.map((p) => p.kind)).size).toBe(10);

    const dropped = new Set<string>();
    for (const { kind, producer, finding } of populated) {
      expect(finding, kind).not.toBeNull();
      expect(finding!.kind).toBe(kind);
      for (const path of found(producer, finding!).missing) dropped.add(`${kind}:${path.split('.')[0]}`);
    }
    // The dropped set is exactly the forecast's charges — non-vacuously, since the fixture holds some.
    expect([...dropped].sort()).toEqual(['overdraft-forecast:charges']);
  });

  it('T34-V14: one Finding per reportable producer finding; sync ok and job fresh yield none', () => {
    const syncs = [sync({ status: 'ok', daysStale: 0, key: 'k1' }), sync({ key: 'k2' }), sync({ status: 'never', daysStale: null, key: 'k3' }), sync({ status: 'ok', daysStale: 1, key: 'k4' })];
    const src: FindingSources = {
      adherence: [breach(), breach({ month: 5 }), underspend()],
      drift: [drift(), drift({ accountId: 'acct_2' })],
      feed: [feed(), feed({ state: 'failing' }), feed({ institution: 'Fabricated Thrift' })],
      sync: syncs,
      job: job({ status: 'fresh', daysSince: 0 }),
      wallets: [wallet()],
      valuations: [valuationNever, valuationStale],
      overdrafts: [overdraft(), overdraft({ accountId: 'acct_od_2' })],
      forecasts: [forecast()],
    };
    const { findings } = assembleFindings({ asOf: ASOF, ...src });
    const count = (k: FindingKind) => findings.filter((f) => f.kind === k).length;
    expect(count('budget-breach') + count('budget-underspend')).toBe(3);
    expect(count('balance-drift')).toBe(2);
    expect(count('feed-degraded')).toBe(3);
    expect(count('sync-stale')).toBe(syncs.filter((h) => h.status !== 'ok').length);
    expect(count('sync-stale')).toBe(2);
    expect(findings.some((f) => f.kind === 'sync-stale' && (f.status as string) === 'ok')).toBe(false);
    expect(count('job-overdue')).toBe(0);
    expect(count('cash-uncounted')).toBe(1);
    expect(count('valuation-stale')).toBe(2);
    expect(count('overdraft-open')).toBe(2);
    expect(count('overdraft-forecast')).toBe(1);
    expect(findings).toHaveLength(3 + 2 + 3 + 2 + 0 + 1 + 2 + 2 + 1);

    for (const status of ['late', 'missed', 'never'] as const) {
      const one = assembleFindings({ asOf: ASOF, job: job({ status, daysSince: status === 'never' ? null : 1 }) });
      expect(one.findings.map((f) => f.kind), status).toEqual(['job-overdue']);
    }
  });
});

// ─── A: the assembler ──────────────────────────────────────────────────────────────────────────

describe('P5-34 assembler', () => {
  it('T34-A1: with every source omitted, there are no findings and all nine sources are named, in order', () => {
    const out = assembleFindings({ asOf: ASOF });
    expect(out.findings).toEqual([]);
    expect(out.notEvaluated).toEqual([
      'adherence', 'drift', 'feed', 'sync', 'job', 'wallets', 'valuations', 'overdrafts', 'forecasts',
    ]);
    expect(out.notEvaluated).toEqual([...FINDING_SOURCES]);
    // An explicitly undefined source is omitted too.
    const undef = assembleFindings({ asOf: ASOF, adherence: undefined, job: undefined, drift: [] });
    expect(undef.notEvaluated).toEqual(['adherence', 'feed', 'sync', 'job', 'wallets', 'valuations', 'overdrafts', 'forecasts']);
  });

  it('T34-A2: supplied but empty is evaluated and clean — no findings, nothing unevaluated', () => {
    const out = assembleFindings({
      asOf: ASOF, adherence: [], drift: [], feed: [], sync: [], job: job({ status: 'fresh', daysSince: 0 }),
      wallets: [], valuations: [], overdrafts: [], forecasts: [],
    });
    expect(out).toEqual({ findings: [], notEvaluated: [] });
  });

  it('T34-A3: omitting only valuations names it, emits no valuation finding, and keeps everything else', () => {
    const { valuations: _omitted, ...rest } = fullSources();
    const out = assembleFindings({ asOf: ASOF, ...rest });
    expect(out.notEvaluated).toEqual(['valuations']);
    expect(out.findings.some((f) => f.kind === 'valuation-stale')).toBe(false);
    expect(out.findings.length).toBeGreaterThan(0);
    expect(new Set(out.findings.map((f) => f.kind)).size).toBe(9);
  });

  it('T34-A4: worst first, producer order kept within a source, and independent of input key order', () => {
    const src = fullSources();
    const out = assembleFindings({ asOf: ASOF, ...src });
    expect(nonIncreasing(severities(out.findings))).toBe(true);
    expect(out.findings[0].kind).toBe('overdraft-open');
    expect(severities(out.findings)).toContain('notice');

    // Within one source and one severity, the producer's order survives — not alphabetical, not by id.
    const drifts = assembleFindings({
      asOf: ASOF,
      drift: [drift({ accountId: 'acct_z', name: 'Zeta' }), drift({ accountId: 'acct_a', name: 'Alpha' }), drift({ accountId: 'acct_m', name: 'Mu' })],
    }).findings.map((f) => f.subject.name);
    expect(drifts).toEqual(['Zeta', 'Alpha', 'Mu']);

    // Equal severities from different sources fall in the fixed source order.
    const tie = assembleFindings({ asOf: ASOF, forecasts: [forecast()], drift: [drift()], feed: [feed({ state: 'failing' })] });
    expect(tie.findings.map((f) => f.kind)).toEqual(['balance-drift', 'feed-degraded', 'overdraft-forecast']);

    // The same sources, keys inserted in reverse: deep-equal.
    const reversed = Object.fromEntries(Object.entries({ asOf: ASOF, ...src }).reverse()) as unknown as FindingsInput;
    expect(Object.keys(reversed)[0]).toBe('forecasts');
    expect(assembleFindings(reversed)).toEqual(out);
  });

  it('T34-A5: pure — frozen inputs, no shared references, no clock read', () => {
    const deepFreeze = <T>(o: T): T => {
      if (o && typeof o === 'object' && !Object.isFrozen(o)) {
        Object.freeze(o);
        for (const v of Object.values(o)) deepFreeze(v);
      }
      return o;
    };
    const input = deepFreeze({ asOf: { ...ASOF }, ...fullSources() });
    const snapshot = JSON.stringify(input);
    const out = assembleFindings(input);
    expect(JSON.stringify(input)).toBe(snapshot);

    // No object in the output is an object from the input.
    const inputObjects = new Set<unknown>();
    const collect = (v: unknown) => {
      if (v && typeof v === 'object') { inputObjects.add(v); Object.values(v).forEach(collect); }
    };
    collect(input);
    const shared: string[] = [];
    const check = (v: unknown, path: string) => {
      if (v && typeof v === 'object') {
        if (inputObjects.has(v)) shared.push(path);
        Object.entries(v).forEach(([k, x]) => check(x, `${path}.${k}`));
      }
    };
    check(out, 'out');
    expect(shared).toEqual([]);

    // The clock is never consulted: neither `Date.now()` nor a zero-argument `new Date()`…
    const nowSpy = vi.spyOn(Date, 'now');
    const RealDate = Date;
    let bareConstructions = 0;
    class CountingDate extends RealDate {
      constructor(...args: ConstructorParameters<DateConstructor> | []) {
        if (args.length === 0) bareConstructions++;
        super(...(args as ConstructorParameters<DateConstructor>));
      }
    }
    vi.stubGlobal('Date', CountingDate);
    const counted = assembleFindings({ asOf: ASOF, ...fullSources() });
    vi.unstubAllGlobals();
    expect(nowSpy).not.toHaveBeenCalled();
    expect(bareConstructions).toBe(0);

    // …and two different system times give the same answer.
    vi.useFakeTimers();
    vi.setSystemTime(new RealDate(RealDate.UTC(2020, 0, 1, 3)));
    const early = assembleFindings({ asOf: ASOF, ...fullSources() });
    vi.setSystemTime(new RealDate(RealDate.UTC(2031, 6, 15, 22)));
    const late = assembleFindings({ asOf: ASOF, ...fullSources() });
    expect(early).toEqual(late);
    expect(early).toEqual(out);
    expect(counted).toEqual(out);
  });

  it('T34-A6: a fixture exercising every kind in every state yields only schema-valid findings, all ten kinds', () => {
    const out = assembleFindings({ asOf: ASOF, ...fullSources() });
    for (const f of out.findings) {
      const r = FindingSchema.safeParse(f);
      expect(r.success, `${f.kind}: ${JSON.stringify(r.error?.issues ?? null)}`).toBe(true);
    }
    expect(parsesAll(out.findings)).toBe(true);
    expect(new Set(out.findings.map((f) => f.kind))).toEqual(new Set(Object.keys(FINDING_CONVERSIONS)));
    expect(new Set(out.findings.map((f) => f.kind)).size).toBe(10);
    // Every state the mapping table names is present.
    const states = new Set(out.findings.map((f) => `${f.kind}/${f.severity}`));
    for (const s of [
      'budget-breach/warning', 'budget-breach/notice', 'budget-underspend/notice', 'balance-drift/warning',
      'feed-degraded/warning', 'feed-degraded/notice', 'sync-stale/warning', 'sync-stale/notice',
      'job-overdue/warning', 'cash-uncounted/warning', 'cash-uncounted/notice', 'valuation-stale/warning',
      'valuation-stale/notice', 'overdraft-open/critical', 'overdraft-forecast/warning',
    ]) expect(states.has(s), s).toBe(true);
    expect(out.notEvaluated).toEqual([]);
  });

  it('T34-A7: the as-of triple formats with month plus one, and an impossible one throws RangeError', () => {
    expect(asOfDate({ year: 2026, month: 0, day: 5 })).toBe('2026-01-05');
    expect(asOfDate({ year: 2026, month: 11, day: 31 })).toBe('2026-12-31');
    expect(asOfDate({ year: 2028, month: 1, day: 29 })).toBe('2028-02-29');
    const jan = assembleFindings({ asOf: { year: 2026, month: 0, day: 5 }, drift: [drift()] });
    expect(jan.findings[0].period).toEqual({ type: 'asOf', date: '2026-01-05' });
    const dec = assembleFindings({ asOf: { year: 2026, month: 11, day: 31 }, wallets: [wallet()] });
    expect(dec.findings[0].period).toEqual({ type: 'asOf', date: '2026-12-31' });

    for (const bad of [
      { year: 2026, month: 12, day: 1 },
      { year: 2026, month: -1, day: 1 },
      { year: 2026, month: 0, day: 0 },
      { year: 2026, month: 0, day: 32 },
      { year: 2026, month: 1, day: 30 },
      { year: 2026, month: 1.5, day: 1 },
    ]) {
      expect(() => asOfDate(bad), JSON.stringify(bad)).toThrow(RangeError);
      // Thrown even when no source would have used it — an invalid triple is never formatted.
      expect(() => assembleFindings({ asOf: bad }), JSON.stringify(bad)).toThrow(RangeError);
    }
  });

  it('T34-A8: no merge across kinds, and no charges label anywhere in the full output', () => {
    const name = 'Fabricated Credit Union';
    const both = assembleFindings({ asOf: ASOF, feed: [feed({ institution: name })], sync: [sync({ bank: name })] });
    expect(both.findings.map((f) => [f.kind, f.subject.name])).toEqual([
      ['feed-degraded', name],
      ['sync-stale', name],
    ]);

    const src = fullSources();
    expect(JSON.stringify(src.forecasts)).toContain(CANARY);
    const out = assembleFindings({ asOf: ASOF, ...src });
    expect(out.findings.some((f) => f.kind === 'overdraft-forecast')).toBe(true);
    expect(JSON.stringify(out)).not.toContain(CANARY);
    expect(JSON.stringify(out)).not.toContain('charges');
  });
});

// ─── Evidence: the mapping table, as the code computes it ──────────────────────────────────────
//
// SPEC.md "Evidence required" asks for a printed kind × producer-state table generated by a test run.
// It is asserted here against the spec's table and printed only when `T34_PRINT=1`, so an ordinary run
// stays quiet. Names and enum values only, no figures.

describe('P5-34 evidence', () => {
  it('the mapping table computed from the conversions equals SPEC.md', () => {
    const row = (state: string, f: Finding | null) =>
      f === null ? `${state} -> (no finding)` : `${f.kind} | ${state} -> ${f.severity} / ${f.confidence}`;
    const table = [
      row('scored: true', fromBreach(breach({ scored: true }), ASOF)),
      row('scored: false', fromBreach(breach({ scored: false }), ASOF)),
      row('scored: true', fromChronicUnderspend(underspend({ scored: true }), ASOF)),
      row('scored: false', fromChronicUnderspend(underspend({ scored: false }), ASOF)),
      row('safeToDerive: true', fromDrift(drift({ safeToDerive: true }), ASOF)),
      row('safeToDerive: false', fromDrift(drift({ safeToDerive: false }), ASOF)),
      row('state: failing', fromFeed(feed({ state: 'failing' }), ASOF)),
      row('state: stale', fromFeed(feed(), ASOF)),
      row('status: never', fromSync(sync({ status: 'never', daysStale: null }), ASOF)),
      row('status: stale', fromSync(sync(), ASOF)),
      row('sync-stale | status: ok', fromSync(sync({ status: 'ok', daysStale: 0 }), ASOF)),
      row('status: never', fromJob(job({ status: 'never', daysSince: null }), ASOF)),
      row('status: missed', fromJob(job(), ASOF)),
      row('status: late', fromJob(job({ status: 'late', daysSince: 1 }), ASOF)),
      row('job-overdue | status: fresh', fromJob(job({ status: 'fresh', daysSince: 0 }), ASOF)),
      row('reason: never', fromWallet(wallet({ reason: 'never', daysSinceCount: null }), ASOF)),
      row('reason: stale', fromWallet(wallet(), ASOF)),
      row('reason: never', fromValuation(valuationNever, ASOF)),
      row('reason: stale', fromValuation(valuationStale, ASOF)),
      row('open episode', fromOverdraft(overdraft(), ASOF)),
      row('open forecast', fromForecast(forecast(), ASOF)),
    ];
    expect(table).toEqual([
      'budget-breach | scored: true -> warning / inferred',
      'budget-breach | scored: false -> notice / inferred',
      'budget-underspend | scored: true -> notice / inferred',
      'budget-underspend | scored: false -> notice / inferred',
      'balance-drift | safeToDerive: true -> warning / observed',
      'balance-drift | safeToDerive: false -> warning / observed',
      'feed-degraded | state: failing -> warning / observed',
      'feed-degraded | state: stale -> notice / observed',
      'sync-stale | status: never -> warning / observed',
      'sync-stale | status: stale -> notice / observed',
      'sync-stale | status: ok -> (no finding)',
      'job-overdue | status: never -> warning / observed',
      'job-overdue | status: missed -> warning / observed',
      'job-overdue | status: late -> notice / observed',
      'job-overdue | status: fresh -> (no finding)',
      'cash-uncounted | reason: never -> warning / observed',
      'cash-uncounted | reason: stale -> notice / observed',
      'valuation-stale | reason: never -> warning / observed',
      'valuation-stale | reason: stale -> notice / observed',
      'overdraft-open | open episode -> critical / observed',
      'overdraft-forecast | open forecast -> warning / projected',
    ]);
    if (process.env.T34_PRINT === '1') console.log(`\nP5-34 mapping table\n${table.join('\n')}\n`);
  });
});

// `FindingOf` is exported for consumers; referenced here so the type stays exercised by `tsc`.
export type BreachMember = FindingOf<'budget-breach'>;
