// P5-35 — freshness: as of when each finding's worst input is believed true (scenarios F1–F13).
//
// The contract's own refusals are `packages/contracts/findings.test.ts` (T35-C1..C4); the source-level
// rules (no clock, no copied threshold, no protected column, no new consumer) are
// `lib/findingsWiring.test.ts` (T35-W1..W3); the SQL that reads the facts is
// `scripts/findings-freshness-read.test.ts` (T35-R1..R9). What these pin is the judgement: which
// inputs each kind rests on, which state each input is in, and which input is the worst.
//
// FIXTURES ARE FABRICATED. Institutions, accounts and categories are named like `Fabricated Credit
// Union` and `Fixture Checking`; amounts are small bare numbers chosen to exercise nothing — no rule
// here reads an amount. Where a producer is pure it is called for real (`classifySyncHealth`,
// `staleWallets`, `feedFindings`, `staleValuations`, `jobHealth`), so the thresholds are tested
// against what the producer actually decides rather than against a restatement of it.
//
// TIME. One fixed instant, `NOW`, built from UTC components; the as-of triple is derived from it by
// `asOfFromDate` exactly as the assembler requires, so it is the right local date under each of the
// three process zones acceptance #5 runs this file under. Every other instant is `NOW` minus a
// duration, and every valuation date is the as-of date minus whole days by UTC integer arithmetic.
// Nothing below reads the clock except F12, which sets fake system times to prove nothing else does.

import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  FindingSchema,
  FreshnessBasisSchema,
  type Finding,
  type FindingKind,
  type Freshness,
  type FreshnessBasis,
} from '@b8/contracts/findings';
import {
  accountClassOf,
  aggregateFreshness,
  feedInput,
  freshnessInputs,
  freshnessOf,
  unsuppliedFreshness,
  type AccountFact,
  type FreshnessContext,
  type FreshnessFacts,
  type FreshnessInput,
  type ItemFact,
} from './findingsFreshness';
import {
  asOfDate,
  assembleFindings,
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
  type FindingSources,
} from './findings';
import { asOfFromDate } from './monthOutlook';
import type { AsOf } from './pacing';
import type { BreachFinding, ChronicUnderspendFinding, MonthVariance } from './adherence';
import type { DriftFinding } from './drift';
import { feedFindings, STALE_AFTER_HOURS as FEED_STALE_AFTER_HOURS, type FeedFinding } from './feedHealth';
import { classifySyncHealth, STALE_AFTER_DAYS as SYNC_STALE_AFTER_DAYS, type SyncItemHealth } from './syncHealth';
import { jobHealth, type JobHealth } from './jobHealth';
import { staleWallets, STALE_AFTER_DAYS as WALLET_STALE_AFTER_DAYS, type WalletFinding } from './walletStaleness';
import { staleValuations, VALUATION_STALE_DAYS, type ValuationFinding } from './valuationStaleness';
import type { ForecastFinding, OverdraftFinding } from '../overdraftWatch';

// ─── Time ─────────────────────────────────────────────────────────────────────────────────────

const HOUR = 3_600_000;
const DAY = 86_400_000;
const NOW = new Date(Date.UTC(2026, 2, 5, 12));
const ASOF: AsOf = asOfFromDate(NOW);
const ago = (ms: number) => new Date(NOW.getTime() - ms);

const pad2 = (n: number) => String(n).padStart(2, '0');
/** The calendar date `n` days before the as-of date, by UTC integer arithmetic (no zone involved). */
function dateBefore(n: number, asOf: AsOf = ASOF): string {
  const d = new Date(Date.UTC(asOf.year, asOf.month, asOf.day - n));
  return `${d.getUTCFullYear()}-${pad2(d.getUTCMonth() + 1)}-${pad2(d.getUTCDate())}`;
}

// ─── Facts ────────────────────────────────────────────────────────────────────────────────────

function facts(over: Partial<FreshnessFacts> = {}): FreshnessFacts {
  return {
    year: ASOF.year, accounts: [], items: [], cashCounts: [], valuations: [], lastSchedulerRun: null,
    overdraftSightings: [], overdraftProjections: [], contributors: [], ...over,
  };
}
const ctxOf = (over: Partial<FreshnessFacts> = {}): FreshnessContext => ({ now: NOW, facts: facts(over) });

const plaidAccount = (accountId: string, itemKey = accountId): AccountFact =>
  ({ accountId, itemKey, countable: false, valuationMode: 'ledger' });
const cashAccount = (accountId: string): AccountFact => ({ accountId, itemKey: null, countable: true, valuationMode: 'ledger' });
const valuedAccount = (accountId: string): AccountFact =>
  ({ accountId, itemKey: null, countable: false, valuationMode: 'valuation' });
const manualAccount = (accountId: string): AccountFact =>
  ({ accountId, itemKey: null, countable: false, valuationMode: 'ledger' });
const item = (key: string, synced: Date | null, success: Date | null = synced, failed: Date | null = null): ItemFact =>
  ({ key, lastSyncedAt: synced, lastSuccessfulUpdate: success, lastFailedUpdate: failed });

/** One category, contributed to by the given accounts, with their facts. */
function categoryCtx(accounts: AccountFact[], extra: Partial<FreshnessFacts> = {}, categoryId = 7): FreshnessContext {
  return ctxOf({ accounts, contributors: [{ categoryId, accountIds: accounts.map((a) => a.accountId) }], ...extra });
}

// ─── Producer fixtures (fabricated) ───────────────────────────────────────────────────────────

const monthVariance = (month: number, budgeted: number, actual: number): MonthVariance => ({
  month, budgeted, actual, variance: Math.round((actual - budgeted) * 100) / 100,
  ratio: budgeted === 0 ? null : actual / budgeted,
});
const breach = (over: Partial<BreachFinding> = {}): BreachFinding => ({
  kind: 'breach', categoryId: 7, category: 'Fixture Category', scored: true, ...monthVariance(1, 10, 12.5), ...over,
});
const underspend = (over: Partial<ChronicUnderspendFinding> = {}): ChronicUnderspendFinding => ({
  kind: 'chronic-underspend', categoryId: 7, category: 'Fixture Category', scored: true,
  months: [monthVariance(0, 10, 1), monthVariance(1, 10, 2)], budgeted: 20, actual: 3, variance: -17, ...over,
});
const drift = (over: Partial<DriftFinding> = {}): DriftFinding => ({
  accountId: 'acct_fixture_drift', name: 'Fixture Checking', ledgerBalance: 20, expectedBalance: 25, drift: 5,
  observedAt: '2026-03-05T06:00:00.000Z', suggestedBeginningBalance: 5, safeToDerive: true, ...over,
});
const feed = (over: Partial<FeedFinding> = {}): FeedFinding => ({
  institution: 'Fabricated Credit Union', accountCount: 1, state: 'stale', lastSuccessfulUpdate: ago(40 * HOUR),
  hoursStale: 40, institutionStatus: null, institutionStatusAt: null, ...over,
});
const sync = (over: Partial<SyncItemHealth> = {}): SyncItemHealth => ({
  key: 'acct_fixture_sync', bank: 'Fabricated Credit Union', accountCount: 1, daysStale: 3, status: 'stale', ...over,
});
const job = (over: Partial<JobHealth> = {}): JobHealth => ({
  status: 'missed', daysSince: 5, message: 'A fabricated sentence about the daily job.', ...over,
});
const wallet = (over: Partial<WalletFinding> = {}): WalletFinding => ({
  accountId: 'acct_fixture_wallet', name: 'Fixture Wallet', balance: 12, daysSinceCount: 40, reason: 'stale', ...over,
});
const valuation: ValuationFinding = { id: 'acct_fixture_brokerage', name: 'Fixture Brokerage', reason: 'stale', daysSince: 120 };
const overdraft = (over: Partial<OverdraftFinding> = {}): OverdraftFinding => ({
  accountId: 'acct_fixture_od', account: 'Fixture Joint Checking', bank: null, balance: -4.5, cushion: 5,
  since: '2026-03-04 06:00:00+00', seenAt: '2026-03-05 06:00:00+00', ...over,
});
const forecast = (over: Partial<ForecastFinding> = {}): ForecastFinding => ({
  accountId: 'acct_fixture_fc', account: 'Fixture Bills Checking', bank: 'Fabricated Credit Union', cushion: 5,
  low: -2.25, lowOn: '2026-03-09', charges: [{ label: 'CANARY_LABEL', amount: 7.25, on: '2026-03-07' }],
  projectedAt: '2026-03-05 06:00:00+00', ...over,
});

/** The finding's freshness, failing loudly if the conversion yielded nothing or an invalid value. */
function freshnessOfFinding(f: Finding | null): Freshness {
  expect(f).not.toBeNull();
  const r = FindingSchema.safeParse(f);
  expect(r.success, JSON.stringify(r.error?.issues ?? null)).toBe(true);
  return f!.freshness;
}
const summary = (fr: Freshness) => [fr.state, fr.basis, fr.ageDays, fr.undatedInputs] as const;

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

// ─── F1: every kind's input table ──────────────────────────────────────────────────────────────

/**
 * One row per kind × input × state: the fixture, and what freshness must say. This table is both
 * F1's assertion and the evidence table SPEC.md asks for (printed when `T35_PRINT=1`): names and enum
 * values only, and day counts.
 */
interface Row {
  kind: FindingKind;
  input: string;
  freshness: () => Freshness;
  want: readonly [Freshness['state'], FreshnessBasis, number | null, number];
}

const P = 'acct_fixture_plaid';
const plaidCtx = (synced: Date | null, success: Date | null = synced, failed: Date | null = null) =>
  categoryCtx([plaidAccount(P)], { items: [item(P, synced, success, failed)] });
const driftCtx = (synced: Date | null, success: Date | null = synced) =>
  ctxOf({ accounts: [plaidAccount('acct_fixture_drift')], items: [item('acct_fixture_drift', synced, success)] });

const F1_ROWS: Row[] = [
  // budget-breach and budget-underspend: every contributing account, by class.
  ...(['budget-breach', 'budget-underspend'] as const).flatMap((kind): Row[] => {
    const conv = (ctx: FreshnessContext) =>
      freshnessOfFinding(kind === 'budget-breach' ? fromBreach(breach(), ASOF, ctx) : fromChronicUnderspend(underspend(), ASOF, ctx));
    return [
      { kind, input: 'contributor item sync + feed, both 1 hour old', freshness: () => conv(plaidCtx(ago(HOUR))), want: ['fresh', 'sync', 0, 0] },
      { kind, input: 'contributor item sync 20 days old', freshness: () => conv(plaidCtx(ago(20 * DAY), ago(HOUR))), want: ['stale', 'sync', 20, 0] },
      { kind, input: 'contributor item never synced', freshness: () => conv(plaidCtx(null, ago(HOUR))), want: ['never', 'sync', null, 0] },
      { kind, input: 'no contributing account', freshness: () => conv(ctxOf()), want: ['undated', 'none', null, 1] },
    ];
  }),
  // balance-drift: the account's item sync and feed, never `observedAt`.
  { kind: 'balance-drift', input: 'item sync + feed 1 hour old', freshness: () => freshnessOfFinding(fromDrift(drift(), ASOF, driftCtx(ago(HOUR)))), want: ['fresh', 'sync', 0, 0] },
  { kind: 'balance-drift', input: 'item sync 5 days old', freshness: () => freshnessOfFinding(fromDrift(drift(), ASOF, driftCtx(ago(5 * DAY), ago(HOUR)))), want: ['stale', 'sync', 5, 0] },
  { kind: 'balance-drift', input: 'item never synced', freshness: () => freshnessOfFinding(fromDrift(drift(), ASOF, driftCtx(null, ago(HOUR)))), want: ['never', 'sync', null, 0] },
  { kind: 'balance-drift', input: 'account has no item record', freshness: () => freshnessOfFinding(fromDrift(drift(), ASOF, ctxOf())), want: ['undated', 'sync', null, 1] },
  // feed-degraded: the finding's own last success.
  { kind: 'feed-degraded', input: 'last success 1 hour old', freshness: () => freshnessOfFinding(fromFeed(feed({ lastSuccessfulUpdate: ago(HOUR) }), ASOF, ctxOf())), want: ['fresh', 'feed', 0, 0] },
  { kind: 'feed-degraded', input: 'last success 40 hours old', freshness: () => freshnessOfFinding(fromFeed(feed(), ASOF, ctxOf())), want: ['stale', 'feed', 1, 0] },
  { kind: 'feed-degraded', input: 'failing, no success ever', freshness: () => freshnessOfFinding(fromFeed(feed({ state: 'failing', lastSuccessfulUpdate: null, hoursStale: null }), ASOF, ctxOf())), want: ['never', 'feed', null, 0] },
  { kind: 'feed-degraded', input: 'last success later than now', freshness: () => freshnessOfFinding(fromFeed(feed({ lastSuccessfulUpdate: ago(-HOUR) }), ASOF, ctxOf())), want: ['undated', 'feed', null, 1] },
  // sync-stale: the item's last successful sync, by the producer's key.
  { kind: 'sync-stale', input: 'item sync 1 hour old', freshness: () => freshnessOfFinding(fromSync(sync(), ASOF, ctxOf({ items: [item('acct_fixture_sync', ago(HOUR))] }))), want: ['fresh', 'sync', 0, 0] },
  { kind: 'sync-stale', input: 'item sync 3 days old', freshness: () => freshnessOfFinding(fromSync(sync(), ASOF, ctxOf({ items: [item('acct_fixture_sync', ago(3 * DAY))] }))), want: ['stale', 'sync', 3, 0] },
  { kind: 'sync-stale', input: 'item never synced', freshness: () => freshnessOfFinding(fromSync(sync({ status: 'never', daysStale: null }), ASOF, ctxOf({ items: [item('acct_fixture_sync', null)] }))), want: ['never', 'sync', null, 0] },
  { kind: 'sync-stale', input: 'no item record for the key', freshness: () => freshnessOfFinding(fromSync(sync(), ASOF, ctxOf())), want: ['undated', 'sync', null, 1] },
  // job-overdue: the latest scheduled run, judged by the producer.
  { kind: 'job-overdue', input: 'scheduled run 1 minute old', freshness: () => freshnessOfFinding(fromJob(job(), ASOF, ctxOf({ lastSchedulerRun: ago(60_000) }))), want: ['fresh', 'job-run', 0, 0] },
  { kind: 'job-overdue', input: 'scheduled run 5 days old', freshness: () => freshnessOfFinding(fromJob(job(), ASOF, ctxOf({ lastSchedulerRun: ago(5 * DAY) }))), want: ['stale', 'job-run', 5, 0] },
  { kind: 'job-overdue', input: 'no scheduled run ever', freshness: () => freshnessOfFinding(fromJob(job({ status: 'never', daysSince: null }), ASOF, ctxOf())), want: ['never', 'job-run', null, 0] },
  { kind: 'job-overdue', input: 'scheduled run later than now', freshness: () => freshnessOfFinding(fromJob(job(), ASOF, ctxOf({ lastSchedulerRun: ago(-HOUR) }))), want: ['undated', 'job-run', null, 1] },
  // cash-uncounted: the wallet's last count.
  ...((): Row[] => {
    const W = 'acct_fixture_wallet';
    const conv = (ctx: FreshnessContext) => freshnessOfFinding(fromWallet(wallet(), ASOF, ctx));
    return [
      { kind: 'cash-uncounted', input: 'counted 1 day ago', freshness: () => conv(ctxOf({ cashCounts: [{ accountId: W, lastCountedAt: ago(DAY) }] })), want: ['fresh', 'cash-count', 1, 0] },
      { kind: 'cash-uncounted', input: 'counted 40 days ago', freshness: () => conv(ctxOf({ cashCounts: [{ accountId: W, lastCountedAt: ago(40 * DAY) }] })), want: ['stale', 'cash-count', 40, 0] },
      { kind: 'cash-uncounted', input: 'never counted', freshness: () => conv(ctxOf({ cashCounts: [{ accountId: W, lastCountedAt: null }] })), want: ['never', 'cash-count', null, 0] },
      { kind: 'cash-uncounted', input: 'wallet absent from the read', freshness: () => conv(ctxOf()), want: ['undated', 'cash-count', null, 1] },
    ];
  })(),
  // valuation-stale: the latest valuation DATE against the as-of date.
  ...((): Row[] => {
    const V = 'acct_fixture_brokerage';
    const conv = (latestValuedOn: string | null) =>
      freshnessOfFinding(fromValuation(valuation, ASOF, ctxOf({ valuations: [{ accountId: V, latestValuedOn }] })));
    return [
      { kind: 'valuation-stale', input: 'valued 10 days before the as-of date', freshness: () => conv(dateBefore(10)), want: ['fresh', 'valuation', 10, 0] },
      { kind: 'valuation-stale', input: 'valued 120 days before the as-of date', freshness: () => conv(dateBefore(120)), want: ['stale', 'valuation', 120, 0] },
      { kind: 'valuation-stale', input: 'never valued', freshness: () => conv(null), want: ['never', 'valuation', null, 0] },
      { kind: 'valuation-stale', input: 'malformed date (February 30)', freshness: () => conv('2026-02-30'), want: ['undated', 'valuation', null, 1] },
    ];
  })(),
  // overdraft-open and overdraft-forecast: the open row's sighting or projection. Their columns are
  // NOT NULL, so `never` is unreachable for these two kinds (asserted below, not invented).
  { kind: 'overdraft-open', input: 'open episode seen 1 hour ago', freshness: () => freshnessOfFinding(fromOverdraft(overdraft(), ASOF, ctxOf({ overdraftSightings: [{ accountId: 'acct_fixture_od', lastSeenAt: ago(HOUR) }] }))), want: ['fresh', 'overdraft-sighting', 0, 0] },
  { kind: 'overdraft-open', input: 'open episode seen 4 days ago', freshness: () => freshnessOfFinding(fromOverdraft(overdraft(), ASOF, ctxOf({ overdraftSightings: [{ accountId: 'acct_fixture_od', lastSeenAt: ago(4 * DAY) }] }))), want: ['stale', 'overdraft-sighting', 4, 0] },
  { kind: 'overdraft-open', input: 'episode closed since the producer read it', freshness: () => freshnessOfFinding(fromOverdraft(overdraft(), ASOF, ctxOf())), want: ['undated', 'overdraft-sighting', null, 1] },
  { kind: 'overdraft-forecast', input: 'open forecast projected 1 hour ago', freshness: () => freshnessOfFinding(fromForecast(forecast(), ASOF, ctxOf({ overdraftProjections: [{ accountId: 'acct_fixture_fc', projectedAt: ago(HOUR) }] }))), want: ['fresh', 'overdraft-projection', 0, 0] },
  { kind: 'overdraft-forecast', input: 'open forecast projected 4 days ago', freshness: () => freshnessOfFinding(fromForecast(forecast(), ASOF, ctxOf({ overdraftProjections: [{ accountId: 'acct_fixture_fc', projectedAt: ago(4 * DAY) }] }))), want: ['stale', 'overdraft-projection', 4, 0] },
  { kind: 'overdraft-forecast', input: 'forecast closed since the producer read it', freshness: () => freshnessOfFinding(fromForecast(forecast(), ASOF, ctxOf())), want: ['undated', 'overdraft-projection', null, 1] },
];

describe('P5-35 freshness: the input table', () => {
  it('T35-F1: every kind has a dating rule for fresh, stale, never and undated, and none defaults to fresh', () => {
    const lines: string[] = [];
    for (const row of F1_ROWS) {
      const fr = row.freshness();
      expect(summary(fr), `${row.kind} | ${row.input}`).toEqual(row.want);
      lines.push(`${row.kind} | ${row.input} -> ${fr.state} / ${fr.basis}${fr.ageDays === null ? '' : ` / ${fr.ageDays} days`} / undated ${fr.undatedInputs}`);
    }
    // Every kind appears with every reachable state.
    const kinds = new Set(F1_ROWS.map((r) => r.kind));
    expect(kinds.size).toBe(10);
    for (const kind of kinds) {
      const states = new Set(F1_ROWS.filter((r) => r.kind === kind).map((r) => r.want[0]));
      const expected = kind.startsWith('overdraft-') ? ['fresh', 'stale', 'undated'] : ['fresh', 'stale', 'never', 'undated'];
      expect([...states].sort(), kind).toEqual([...expected].sort());
    }
    // `never` is unreachable for the two overdraft kinds, not forgotten: their only input is a NOT NULL
    // column of an open row, so the read hands over a `Date` or no row at all. Over a grid of ages,
    // present and absent rows, neither kind produces `never`.
    for (const ms of [undefined, -DAY, 0, HOUR, DAY, 3 * DAY, 400 * DAY]) {
      const at = ms === undefined ? undefined : ago(ms);
      const open = fromOverdraft(overdraft(), ASOF, ctxOf({ overdraftSightings: at ? [{ accountId: 'acct_fixture_od', lastSeenAt: at }] : [] }));
      const fc = fromForecast(forecast(), ASOF, ctxOf({ overdraftProjections: at ? [{ accountId: 'acct_fixture_fc', projectedAt: at }] : [] }));
      expect(open.freshness.state).not.toBe('never');
      expect(fc.freshness.state).not.toBe('never');
    }
    if (process.env.T35_PRINT === '1') console.log(`\nP5-35 kind x input x state\n${lines.join('\n')}\n`);
  });
});

// ─── F2: the worst input ───────────────────────────────────────────────────────────────────────

// Returns the dated member of the union, not the union, so a fixture can read its `lastObserved`
// back without a cast: the helper only ever builds a fresh or stale input.
const dated = (
  basis: FreshnessBasis,
  state: 'fresh' | 'stale',
  ageDays: number,
  lastObserved?: string,
): Extract<FreshnessInput, { state: 'fresh' | 'stale' }> =>
  ({ basis, state, ageDays, lastObserved: lastObserved ?? (basis === 'valuation' ? dateBefore(ageDays) : ago(ageDays * DAY).toISOString()) });

/** Every ordering of a short list. */
function permutations<T>(xs: readonly T[]): T[][] {
  if (xs.length <= 1) return [[...xs]];
  return xs.flatMap((x, i) => permutations([...xs.slice(0, i), ...xs.slice(i + 1)]).map((p) => [x, ...p]));
}

describe('P5-35 freshness: aggregation', () => {
  it('T35-F2: the worst input is the oldest of the worst state, never beats stale beats undated beats fresh, and ties follow the basis order', () => {
    // Inputs aged 3 and 40 days select the 40, in both orders and whichever state they share.
    for (const state of ['fresh', 'stale'] as const) {
      const a = dated('sync', state, 3);
      const b = dated('cash-count', state, 40);
      for (const order of [[a, b], [b, a]]) expect(summary(aggregateFreshness(order))).toEqual([state, 'cash-count', 40, 0]);
    }
    // Through a real context: a budget category whose two contributors are 3 and 40 days stale.
    const two = categoryCtx([plaidAccount('acct_a'), plaidAccount('acct_b')], {
      items: [item('acct_a', ago(3 * DAY), ago(HOUR)), item('acct_b', ago(40 * DAY), ago(HOUR))],
    });
    expect(summary(fromBreach(breach(), ASOF, two).freshness)).toEqual(['stale', 'sync', 40, 0]);

    // `never` beats a 400-day stale input.
    const never: FreshnessInput = { basis: 'cash-count', state: 'never' };
    for (const order of permutations([dated('sync', 'stale', 400), never])) {
      expect(summary(aggregateFreshness(order))).toEqual(['never', 'cash-count', null, 0]);
    }
    // stale beats undated beats fresh, and the undated input is counted in each.
    const undatedFeed: FreshnessInput = { basis: 'feed', state: 'undated' };
    for (const order of permutations([dated('sync', 'fresh', 1), undatedFeed, dated('valuation', 'stale', 120)])) {
      expect(summary(aggregateFreshness(order))).toEqual(['stale', 'valuation', 120, 1]);
    }
    for (const order of permutations([dated('sync', 'fresh', 9), undatedFeed])) {
      expect(summary(aggregateFreshness(order))).toEqual(['undated', 'feed', null, 1]);
    }
    // A stale input younger than a fresh one is still the worst: state first, then age.
    expect(summary(aggregateFreshness([dated('valuation', 'fresh', 50), dated('sync', 'stale', 3)])))
      .toEqual(['stale', 'sync', 3, 0]);

    // Equal ages tie-break by the contract's basis order, read from the schema, independent of input
    // order: for every pair of dated bases, the one listed first wins.
    const datedBases = FreshnessBasisSchema.options.filter((b) => b !== 'none');
    for (let i = 0; i < datedBases.length; i++) {
      for (let k = i + 1; k < datedBases.length; k++) {
        const pair = [dated(datedBases[i], 'stale', 5), dated(datedBases[k], 'stale', 5)];
        for (const order of permutations(pair)) {
          expect(aggregateFreshness(order).basis, `${datedBases[i]} vs ${datedBases[k]}`).toBe(datedBases[i]);
        }
      }
    }
    // Same basis and same whole-day age: the earlier instant, whichever comes first.
    const early = dated('sync', 'stale', 5, ago(5 * DAY + 2 * HOUR).toISOString());
    const late = dated('sync', 'stale', 5, ago(5 * DAY + HOUR).toISOString());
    for (const order of permutations([late, early])) expect(aggregateFreshness(order).lastObserved).toBe(early.lastObserved);
  });

  it('T35-F3: undated is never fresh — an empty set, an unsupplied context, and fresh plus undated are each undated with the right count', () => {
    const want = { state: 'undated', basis: 'none', lastObserved: null, ageDays: null, undatedInputs: 1 };
    // The empty input set counts as one undated input (G1 ruling).
    expect(aggregateFreshness([])).toEqual(want);
    // No context at all: exactly one undated input, for every kind, through every conversion.
    expect(unsuppliedFreshness()).toEqual(want);
    expect(freshnessOf('sync-stale', { key: 'k' }, ASOF, undefined)).toEqual(want);
    const noContext = assembleFindings({ asOf: ASOF, ...fullSources() });
    expect(noContext.findings.length).toBeGreaterThan(9);
    for (const f of noContext.findings) expect(f.freshness, f.kind).toEqual(want);
    // A category with no contributing account: the empty set, one undated input.
    expect(fromBreach(breach(), ASOF, categoryCtx([])).freshness).toEqual(want);
    // One fresh and one undated input: undated, counted once.
    const fresh = dated('sync', 'fresh', 0);
    expect(summary(aggregateFreshness([fresh, { basis: 'none', state: 'undated' }]))).toEqual(['undated', 'none', null, 1]);
    // Two undated inputs are counted as two.
    expect(aggregateFreshness([{ basis: 'none', state: 'undated' }, { basis: 'feed', state: 'undated' }, fresh]).undatedInputs).toBe(2);
    // No result anywhere above is fresh.
    expect([aggregateFreshness([]), unsuppliedFreshness()].some((f) => f.state === 'fresh')).toBe(false);
  });
});

// ─── F4: the producers' own thresholds, at the boundary ────────────────────────────────────────

describe('P5-35 freshness: agreement with the producers', () => {
  it('T35-F4: at each boundary, every finding a producer emits is stale or never, and every state it does not emit is fresh', () => {
    // Sync: the constant minus one day, and the constant, in whole days.
    const syncItems = [
      { key: 's_inside', bank: null, accountCount: 1, lastSyncedAt: ago((SYNC_STALE_AFTER_DAYS - 1) * DAY) },
      { key: 's_at', bank: null, accountCount: 1, lastSyncedAt: ago(SYNC_STALE_AFTER_DAYS * DAY) },
      { key: 's_never', bank: null, accountCount: 1, lastSyncedAt: null },
    ];
    const syncCtx = ctxOf({ items: syncItems.map((s) => item(s.key, s.lastSyncedAt)) });
    const syncOut = classifySyncHealth(syncItems, NOW);
    const emittedSync = syncOut.map((h) => fromSync(h, ASOF, syncCtx)).filter((f) => f !== null);
    expect(emittedSync.map((f) => f.key).sort()).toEqual(['s_at', 's_never']);
    for (const f of emittedSync) expect(['stale', 'never'], f.key).toContain(f.freshness.state);
    expect(freshnessOf('sync-stale', { key: 's_inside' }, ASOF, syncCtx).state).toBe('fresh');

    // Wallets: the constant minus one day, and the constant.
    const counted = (accountId: string, ms: number | null) =>
      ({ accountId, name: 'Fixture Wallet', balance: 3, lastCountedAt: ms === null ? null : ago(ms).toISOString() });
    const wallets = [counted('w_inside', (WALLET_STALE_AFTER_DAYS - 1) * DAY), counted('w_at', WALLET_STALE_AFTER_DAYS * DAY), counted('w_never', null)];
    const walletCtx = ctxOf({ cashCounts: wallets.map((w) => ({ accountId: w.accountId, lastCountedAt: w.lastCountedAt === null ? null : ago(w.accountId === 'w_inside' ? (WALLET_STALE_AFTER_DAYS - 1) * DAY : WALLET_STALE_AFTER_DAYS * DAY) })) });
    const walletOut = staleWallets(wallets, NOW);
    expect(walletOut.map((w) => w.accountId).sort()).toEqual(['w_at', 'w_never']);
    for (const w of walletOut) expect(['stale', 'never'], w.accountId).toContain(fromWallet(w, ASOF, walletCtx).freshness.state);
    expect(freshnessOf('cash-uncounted', { accountId: 'w_inside' }, ASOF, walletCtx).state).toBe('fresh');

    // Feed: exactly the constant in hours, and one millisecond past it (strictly greater, on ms).
    const exactly = ago(FEED_STALE_AFTER_HOURS * HOUR);
    const past = ago(FEED_STALE_AFTER_HOURS * HOUR + 1);
    const obs = (institution: string, ok: Date | null, failed: Date | null = null) =>
      ({ institution, accountCount: 1, lastSuccessfulUpdate: ok, lastFailedUpdate: failed, institutionStatus: null, institutionStatusAt: null });
    const feedOut = feedFindings([obs('Fabricated Exact', exactly), obs('Fabricated Past', past), obs('Fabricated Failing', null, ago(HOUR))], NOW);
    expect(feedOut.map((f) => f.institution).sort()).toEqual(['Fabricated Failing', 'Fabricated Past']);
    for (const f of feedOut) expect(['stale', 'never'], f.institution).toContain(fromFeed(f, ASOF, ctxOf()).freshness.state);
    expect(freshnessOf('feed-degraded', { lastSuccessfulUpdate: exactly }, ASOF, ctxOf()).state).toBe('fresh');
    // The same boundary on the feed INPUT of an item (what a budget or drift finding rests on).
    expect(feedInput(item('k', NOW, exactly), NOW).state).toBe('fresh');
    expect(feedInput(item('k', NOW, past), NOW).state).toBe('stale');

    // Valuations: the constant minus one calendar day, and the constant.
    const valued = [
      { id: 'v_inside', name: 'Fixture Brokerage', latestValuedOn: dateBefore(VALUATION_STALE_DAYS - 1) },
      { id: 'v_at', name: 'Fixture Pension', latestValuedOn: dateBefore(VALUATION_STALE_DAYS) },
      { id: 'v_never', name: 'Fixture Annuity', latestValuedOn: null },
    ];
    const valuationCtx = ctxOf({ valuations: valued.map((v) => ({ accountId: v.id, latestValuedOn: v.latestValuedOn })) });
    const valuationOut = staleValuations(valued, asOfDate(ASOF));
    expect(valuationOut.map((v) => v.id).sort()).toEqual(['v_at', 'v_never']);
    for (const v of valuationOut) expect(['stale', 'never'], v.id).toContain(fromValuation(v, ASOF, valuationCtx).freshness.state);
    expect(freshnessOf('valuation-stale', { id: 'v_inside' }, ASOF, valuationCtx).state).toBe('fresh');
    expect(freshnessOf('valuation-stale', { id: 'v_inside' }, ASOF, valuationCtx).ageDays).toBe(VALUATION_STALE_DAYS - 1);
  });
});

// ─── F5: a future observation ──────────────────────────────────────────────────────────────────

/** Every number under a key named like an age, anywhere in `v`. */
function ages(v: unknown): number[] {
  if (v === null || typeof v !== 'object') return [];
  return Object.entries(v).flatMap(([k, x]) => (k === 'ageDays' && typeof x === 'number' ? [x] : ages(x)));
}

describe('P5-35 freshness: the future', () => {
  it('T35-F5: an observation one millisecond or one day after now is undated for every instant basis, and no age is negative', () => {
    for (const ahead of [1, DAY]) {
      const t = new Date(NOW.getTime() + ahead);
      const cases: [string, Finding | null, FreshnessBasis][] = [
        ['sync', fromSync(sync(), ASOF, ctxOf({ items: [item('acct_fixture_sync', t)] })), 'sync'],
        ['feed (finding)', fromFeed(feed({ lastSuccessfulUpdate: t }), ASOF, ctxOf()), 'feed'],
        ['feed (item input)', fromDrift(drift(), ASOF, driftCtx(ago(HOUR), t)), 'feed'],
        ['cash-count', fromWallet(wallet(), ASOF, ctxOf({ cashCounts: [{ accountId: 'acct_fixture_wallet', lastCountedAt: t }] })), 'cash-count'],
        ['job-run', fromJob(job(), ASOF, ctxOf({ lastSchedulerRun: t })), 'job-run'],
        ['overdraft-sighting', fromOverdraft(overdraft(), ASOF, ctxOf({ overdraftSightings: [{ accountId: 'acct_fixture_od', lastSeenAt: t }] })), 'overdraft-sighting'],
        ['overdraft-projection', fromForecast(forecast(), ASOF, ctxOf({ overdraftProjections: [{ accountId: 'acct_fixture_fc', projectedAt: t }] })), 'overdraft-projection'],
      ];
      for (const [label, f, basis] of cases) {
        const fr = freshnessOfFinding(f);
        expect([fr.state, fr.basis, fr.ageDays, fr.undatedInputs], `${label} +${ahead}ms`).toEqual(['undated', basis, null, 1]);
      }
      // A valuation dated after the as-of date is undated too, never a negative age.
      const v = fromValuation(valuation, ASOF, ctxOf({ valuations: [{ accountId: 'acct_fixture_brokerage', latestValuedOn: dateBefore(-1) }] }));
      expect(summary(v.freshness)).toEqual(['undated', 'valuation', null, 1]);
    }
    // Across a whole assembled list with every input in the future, no age anywhere is below zero.
    const t = new Date(NOW.getTime() + 1);
    const everything = assembleFindings({ asOf: ASOF, ...fullSources(), freshness: futureCtx(t) });
    expect(everything.findings.length).toBeGreaterThan(9);
    for (const a of ages(everything)) expect(a).toBeGreaterThanOrEqual(0);
    for (const f of everything.findings) expect(f.freshness.state, f.kind).not.toBe('fresh');
  });
});

// ─── F6–F9: drift, feed identity, account classes, budget kinds ────────────────────────────────

describe('P5-35 freshness: what dates which finding', () => {
  it('T35-F6: drift is dated by the item sync, not by observedAt', () => {
    // A stable balance whose last change was 200 days ago, on an item synced an hour ago: fresh.
    const oldChange = drift({ observedAt: ago(200 * DAY).toISOString() });
    expect(summary(fromDrift(oldChange, ASOF, driftCtx(ago(HOUR))).freshness)).toEqual(['fresh', 'sync', 0, 0]);
    // No Plaid balance observed at all, item synced an hour ago: fresh, not undated.
    expect(summary(fromDrift(drift({ observedAt: null }), ASOF, driftCtx(ago(HOUR))).freshness)).toEqual(['fresh', 'sync', 0, 0]);
    // A recent observedAt does not rescue an item that never synced.
    expect(summary(fromDrift(drift({ observedAt: ago(HOUR).toISOString() }), ASOF, driftCtx(null, ago(HOUR))).freshness))
      .toEqual(['never', 'sync', null, 0]);
    // And a fresh observedAt beside a 10-day-old sync is stale by the sync.
    expect(summary(fromDrift(drift({ observedAt: NOW.toISOString() }), ASOF, driftCtx(ago(10 * DAY), ago(HOUR))).freshness))
      .toEqual(['stale', 'sync', 10, 0]);
  });

  it('T35-F7: an unknown feed is undated, failure-only is never, and identity is the key, never the institution name', () => {
    expect(feedInput(item('k', NOW, null, null), NOW)).toEqual({ basis: 'feed', state: 'undated' });
    expect(feedInput(item('k', NOW, null, ago(HOUR)), NOW)).toEqual({ basis: 'feed', state: 'never' });
    // Through a budget finding: the unknown feed is one undated input beside a fresh sync.
    expect(summary(fromBreach(breach(), ASOF, plaidCtx(ago(HOUR), null, null)).freshness)).toEqual(['undated', 'feed', null, 1]);
    expect(summary(fromBreach(breach(), ASOF, plaidCtx(ago(HOUR), null, ago(HOUR))).freshness)).toEqual(['never', 'feed', null, 0]);

    // Two items with no bank — both `Unknown` to the producer — keep their own records, by key.
    const out = classifySyncHealth([
      { key: 'k_first', bank: null, accountCount: 1, lastSyncedAt: ago(3 * DAY) },
      { key: 'k_second', bank: null, accountCount: 2, lastSyncedAt: ago(10 * DAY) },
    ], NOW);
    expect(out.map((h) => h.bank)).toEqual(['Unknown', 'Unknown']);
    const ctx = ctxOf({ items: [item('k_first', ago(3 * DAY)), item('k_second', ago(10 * DAY))] });
    const byKey = Object.fromEntries(out.map((h) => [h.key, fromSync(h, ASOF, ctx)!.freshness.ageDays]));
    expect(byKey).toEqual({ k_first: 3, k_second: 10 });
    // Reversing the facts changes nothing: no record overwrote the other.
    const reversed = ctxOf({ items: [item('k_second', ago(10 * DAY)), item('k_first', ago(3 * DAY))] });
    expect(Object.fromEntries(out.map((h) => [h.key, fromSync(h, ASOF, reversed)!.freshness.ageDays]))).toEqual(byKey);

    // Two feeds both named `Unknown institution`, different dates: each its own freshness.
    const a = fromFeed(feed({ institution: 'Unknown institution', lastSuccessfulUpdate: ago(40 * HOUR) }), ASOF, ctxOf());
    const b = fromFeed(feed({ institution: 'Unknown institution', lastSuccessfulUpdate: ago(5 * DAY) }), ASOF, ctxOf());
    expect([a.freshness.ageDays, b.freshness.ageDays]).toEqual([1, 5]);
  });

  it('T35-F8: account classes — Plaid-linked uses sync and feed, countable the last count, valuation-mode the date, manual ledger is undated', () => {
    expect(accountClassOf(plaidAccount('a'))).toBe('plaid-linked');
    expect(accountClassOf(cashAccount('a'))).toBe('countable-cash');
    expect(accountClassOf(valuedAccount('a'))).toBe('valuation');
    expect(accountClassOf(manualAccount('a'))).toBe('manual-ledger');
    // A token wins over every other marker; countable wins over valuation-mode.
    expect(accountClassOf({ accountId: 'a', itemKey: 'a', countable: true, valuationMode: 'valuation' })).toBe('plaid-linked');
    expect(accountClassOf({ accountId: 'a', itemKey: null, countable: true, valuationMode: 'valuation' })).toBe('countable-cash');

    const inputsFor = (a: AccountFact, extra: Partial<FreshnessFacts> = {}) =>
      freshnessInputs('budget-breach', { categoryId: 7 }, ASOF, categoryCtx([a], extra));
    expect(inputsFor(plaidAccount(P), { items: [item(P, ago(HOUR))] }).map((i) => [i.basis, i.state]))
      .toEqual([['sync', 'fresh'], ['feed', 'fresh']]);
    expect(inputsFor(cashAccount('c'), { cashCounts: [{ accountId: 'c', lastCountedAt: ago(DAY) }] }).map((i) => [i.basis, i.state]))
      .toEqual([['cash-count', 'fresh']]);
    expect(inputsFor(valuedAccount('v'), { valuations: [{ accountId: 'v', latestValuedOn: dateBefore(3) }] }).map((i) => [i.basis, i.state]))
      .toEqual([['valuation', 'fresh']]);
    expect(inputsFor(manualAccount('m')).map((i) => [i.basis, i.state])).toEqual([['none', 'undated']]);
    // As findings: the manual ledger account is never fresh.
    expect(summary(fromBreach(breach(), ASOF, categoryCtx([manualAccount('m')])).freshness)).toEqual(['undated', 'none', null, 1]);
    expect(summary(fromBreach(breach(), ASOF, categoryCtx([cashAccount('c')], { cashCounts: [{ accountId: 'c', lastCountedAt: null }] })).freshness))
      .toEqual(['never', 'cash-count', null, 0]);
    // A contributor the read does not know is undated, not fresh.
    expect(summary(fromBreach(breach(), ASOF, ctxOf({ contributors: [{ categoryId: 7, accountIds: ['acct_gone'] }] })).freshness))
      .toEqual(['undated', 'none', null, 1]);
  });

  it('T35-F9: budget kinds — a contributor 20 days unsynced is stale, an earlier-month contributor counts, none is undated, one stale of two is stale', () => {
    // The headline case: "under budget" over a feed that stopped three weeks ago.
    const dead = plaidCtx(ago(20 * DAY), ago(20 * DAY));
    expect(summary(fromBreach(breach(), ASOF, dead).freshness)).toEqual(['stale', 'sync', 20, 0]);
    expect(summary(fromChronicUnderspend(underspend(), ASOF, dead).freshness)).toEqual(['stale', 'sync', 20, 0]);
    // The feed input counts on its own: the app's own sync ran an hour ago, Plaid's refresh 20 days ago.
    const deadFeed = plaidCtx(ago(HOUR), ago(20 * DAY));
    expect(summary(fromChronicUnderspend(underspend(), ASOF, deadFeed).freshness)).toEqual(['stale', 'feed', 20, 0]);
    // Contributors are the year's: a breach in January rests on the same accounts as one in a later
    // month, and an underspend window that ended months ago still rests on them.
    for (const month of [0, 1, 11]) {
      expect(summary(fromBreach(breach({ month }), ASOF, dead).freshness), `month ${month}`).toEqual(['stale', 'sync', 20, 0]);
    }
    // No contributor at all: undated.
    expect(summary(fromChronicUnderspend(underspend(), ASOF, categoryCtx([])).freshness)).toEqual(['undated', 'none', null, 1]);
    // One stale and one fresh contributor: stale, by the stale one.
    const mixed = categoryCtx([plaidAccount('acct_ok'), plaidAccount('acct_dead')], {
      items: [item('acct_ok', ago(HOUR)), item('acct_dead', ago(20 * DAY), ago(HOUR))],
    });
    expect(summary(fromBreach(breach(), ASOF, mixed).freshness)).toEqual(['stale', 'sync', 20, 0]);
    // Two accounts behind one item contribute that item's inputs once.
    const shared = categoryCtx([plaidAccount('acct_1', 'acct_1'), plaidAccount('acct_2', 'acct_1')], { items: [item('acct_1', ago(HOUR), null, null)] });
    expect(fromBreach(breach(), ASOF, shared).freshness.undatedInputs).toBe(1);
    // A different category's contributors are not this one's.
    const other = categoryCtx([plaidAccount('acct_dead')], { items: [item('acct_dead', ago(20 * DAY))] }, 99);
    expect(summary(fromBreach(breach(), ASOF, other).freshness)).toEqual(['undated', 'none', null, 1]);
  });
});

// ─── F10: N3 ───────────────────────────────────────────────────────────────────────────────────

/**
 * `jobHealth` exactly as it was before P5-35 (commit 0fa8526), frozen here as the differential
 * oracle. It is NOT exported and nothing else calls it: its only job is to say what the old function
 * returned, so the fixed one can be shown to agree on every ordinary run.
 */
function jobHealthBeforeP535(lastRun: Date | null, now: Date, scheduledHour = 6): JobHealth {
  if (lastRun === null) {
    return { status: 'never', daysSince: null, message: 'The daily job has never run on this machine.' };
  }
  const days = Math.floor((now.getTime() - lastRun.getTime()) / 86_400_000);
  if (lastRun.toDateString() === now.toDateString()) {
    return { status: 'fresh', daysSince: 0, message: 'The daily job ran today.' };
  }
  const overdueFrom = new Date(now);
  overdueFrom.setHours(scheduledHour + 6, 0, 0, 0);
  if (days <= 1 && now < overdueFrom) {
    return { status: 'fresh', daysSince: days, message: 'The daily job ran yesterday.' };
  }
  if (days <= 1) {
    return { status: 'late', daysSince: days, message: "Today's run has not happened yet. The last one was yesterday." };
  }
  return {
    status: 'missed',
    daysSince: days,
    message: days === 2
      ? 'The daily job has not run since the day before yesterday. Sync, backups and this message are all behind.'
      : `The daily job has not run for ${days} days. Sync, backups and this message are all behind.`,
  };
}

describe('P5-35 jobHealth (N3)', () => {
  it('T35-F10: daysSince is never negative, ordinary runs keep their verdict, and the skew case no longer returns -1', () => {
    // `now` values in LOCAL time (the producer's calendar), around midnight, month and year ends and
    // the two DST changes of the zones acceptance #5 runs under; `lastRun` from three days before to
    // two days after, in quarter-hour steps.
    const nows = [
      new Date(2026, 2, 5, 12), new Date(2026, 2, 5, 23, 30), new Date(2026, 2, 6, 0, 15), new Date(2026, 0, 31, 23, 45),
      new Date(2026, 1, 1, 0, 30), new Date(2026, 11, 31, 23, 59), new Date(2027, 0, 1, 5, 59), new Date(2026, 2, 8, 1, 30),
      new Date(2026, 2, 8, 3, 30), new Date(2026, 3, 5, 2, 30), new Date(2026, 8, 27, 3, 0), new Date(2026, 10, 1, 1, 30),
      new Date(2026, 9, 19, 11, 59), new Date(2026, 9, 19, 12, 0),
    ];
    let compared = 0;
    let differed = 0;
    let future = 0;
    for (const now of nows) {
      for (let q = -3 * 96; q <= 2 * 96; q++) {
        const lastRun = new Date(now.getTime() + q * 15 * 60_000);
        const got = jobHealth(lastRun, now);
        expect(got.daysSince === null || got.daysSince >= 0, `${lastRun.getTime()} vs ${now.getTime()}`).toBe(true);
        const finding = fromJob(got, asOfFromDate(now));
        if (got.status !== 'fresh') expect(FindingSchema.safeParse(finding).success).toBe(true);
        if (lastRun.getTime() <= now.getTime()) {
          compared++;
          const before = jobHealthBeforeP535(lastRun, now);
          if (JSON.stringify(got) !== JSON.stringify(before)) differed++;
          expect(got).toEqual(before);
        } else {
          future++;
          // A future-stamped run is a run at `now`.
          expect(got).toEqual(jobHealth(now, now));
          expect(got).toEqual({ status: 'fresh', daysSince: 0, message: 'The daily job ran today.' });
        }
      }
    }
    expect(compared).toBeGreaterThan(2000);
    expect(differed).toBe(0);
    expect(jobHealth(null, NOW)).toEqual(jobHealthBeforeP535(null, NOW));

    // The reported skew case: a run stamped one hour after `now`, across local midnight.
    const skewNow = new Date(2026, 2, 5, 23, 30);
    const skewRun = new Date(skewNow.getTime() + HOUR);
    const before = jobHealthBeforeP535(skewRun, skewNow);
    const after = jobHealth(skewRun, skewNow);
    expect(before.daysSince).toBe(-1);
    expect(after).toEqual({ status: 'fresh', daysSince: 0, message: 'The daily job ran today.' });
    if (process.env.T35_PRINT === '1') {
      console.log(`\nP5-35 jobHealth differential: ${compared} past-or-equal pairs compared, ${differed} differed; ${future} future pairs all read as a run at now`);
      console.log(`skew case (run one hour after now, across midnight): before status ${before.status} daysSince ${before.daysSince}; after status ${after.status} daysSince ${after.daysSince}\n`);
    }
  });
});

// ─── F11: overdraft rows ───────────────────────────────────────────────────────────────────────

describe('P5-35 freshness: overdraft rows', () => {
  it('T35-F11: an open episode or forecast is stale at or beyond the sync constant and fresh inside it, from the Date, never the text', () => {
    // The producer's text fields say something absurd on purpose: if they were parsed, the result
    // would differ. Freshness reads only the `Date` the read hands over.
    const od = overdraft({ seenAt: '1999-01-01 00:00:00+00', since: '1999-01-01 00:00:00+00' });
    const fc = forecast({ projectedAt: 'not a timestamp' });
    for (const [ms, state] of [
      [(SYNC_STALE_AFTER_DAYS - 1) * DAY, 'fresh'],
      [SYNC_STALE_AFTER_DAYS * DAY - 1, 'fresh'],
      [SYNC_STALE_AFTER_DAYS * DAY, 'stale'],
      [30 * DAY, 'stale'],
    ] as const) {
      const at = ago(ms);
      const open = fromOverdraft(od, ASOF, ctxOf({ overdraftSightings: [{ accountId: 'acct_fixture_od', lastSeenAt: at }] }));
      const proj = fromForecast(fc, ASOF, ctxOf({ overdraftProjections: [{ accountId: 'acct_fixture_fc', projectedAt: at }] }));
      expect([open.freshness.state, open.freshness.basis, open.freshness.lastObserved], `episode ${ms}`)
        .toEqual([state, 'overdraft-sighting', at.toISOString()]);
      expect([proj.freshness.state, proj.freshness.basis, proj.freshness.lastObserved], `forecast ${ms}`)
        .toEqual([state, 'overdraft-projection', at.toISOString()]);
    }
    // The finding's own text is carried untouched.
    expect(fromOverdraft(od, ASOF, ctxOf()).seenAt).toBe('1999-01-01 00:00:00+00');
    // Another account's open row is not this one's.
    const elsewhere = ctxOf({ overdraftSightings: [{ accountId: 'acct_other', lastSeenAt: ago(HOUR) }] });
    expect(summary(fromOverdraft(od, ASOF, elsewhere).freshness)).toEqual(['undated', 'overdraft-sighting', null, 1]);
  });
});

// ─── F12, F13: purity and non-interference ─────────────────────────────────────────────────────

/** A fixture with every kind, and a context that dates every input of it. */
function fullSources(): FindingSources {
  return {
    adherence: [breach({ month: 1 }), breach({ categoryId: 9, category: 'Fixture Fixed Line', scored: false }), underspend()],
    drift: [drift(), drift({ accountId: 'acct_fixture_drift_2', observedAt: null, safeToDerive: false })],
    feed: [feed({ state: 'failing', lastSuccessfulUpdate: null, hoursStale: null }), feed()],
    sync: [sync({ status: 'never', daysStale: null, key: 'acct_fixture_sync_2' }), sync()],
    job: job(),
    wallets: [wallet({ reason: 'never', daysSinceCount: null, accountId: 'acct_fixture_wallet_2' }), wallet()],
    valuations: [{ id: 'acct_fixture_pension', name: 'Fixture Pension', reason: 'never' }, valuation],
    overdrafts: [overdraft()],
    forecasts: [forecast()],
  };
}

function fullFacts(): FreshnessFacts {
  return facts({
    accounts: [
      plaidAccount('acct_fixture_drift'), plaidAccount('acct_fixture_drift_2'), plaidAccount('acct_fixture_sync'),
      plaidAccount('acct_fixture_sync_2'), cashAccount('acct_fixture_wallet'), cashAccount('acct_fixture_wallet_2'),
      valuedAccount('acct_fixture_brokerage'), valuedAccount('acct_fixture_pension'), manualAccount('acct_fixture_card'),
    ],
    items: [
      item('acct_fixture_drift', ago(HOUR)), item('acct_fixture_drift_2', ago(3 * DAY), ago(HOUR)),
      item('acct_fixture_sync', ago(3 * DAY)), item('acct_fixture_sync_2', null, null, ago(HOUR)),
    ],
    cashCounts: [{ accountId: 'acct_fixture_wallet', lastCountedAt: ago(40 * DAY) }, { accountId: 'acct_fixture_wallet_2', lastCountedAt: null }],
    valuations: [{ accountId: 'acct_fixture_brokerage', latestValuedOn: dateBefore(120) }, { accountId: 'acct_fixture_pension', latestValuedOn: null }],
    lastSchedulerRun: ago(5 * DAY),
    overdraftSightings: [{ accountId: 'acct_fixture_od', lastSeenAt: ago(HOUR) }],
    overdraftProjections: [{ accountId: 'acct_fixture_fc', projectedAt: ago(4 * DAY) }],
    contributors: [
      { categoryId: 7, accountIds: ['acct_fixture_drift', 'acct_fixture_wallet'] },
      // A manual ledger account alone: this category's findings are undated.
      { categoryId: 9, accountIds: ['acct_fixture_card'] },
    ],
  });
}

/** Every instant in the full facts moved to `t`, every date to the day after the as-of date. */
function futureCtx(t: Date): FreshnessContext {
  const f = fullFacts();
  return {
    now: NOW,
    facts: {
      ...f,
      items: f.items.map((i) => item(i.key, t, t)),
      cashCounts: f.cashCounts.map((c) => ({ ...c, lastCountedAt: t })),
      valuations: f.valuations.map((v) => ({ ...v, latestValuedOn: dateBefore(-1) })),
      lastSchedulerRun: t,
      overdraftSightings: f.overdraftSightings.map((s) => ({ ...s, lastSeenAt: t })),
      overdraftProjections: f.overdraftProjections.map((p) => ({ ...p, projectedAt: t })),
      // Valuation-mode and countable contributors only, so a manual account cannot make this pass.
      contributors: [{ categoryId: 7, accountIds: ['acct_fixture_drift'] }, { categoryId: 9, accountIds: ['acct_fixture_brokerage'] }],
    },
  };
}

function deepFreeze<T>(o: T): T {
  if (o && typeof o === 'object' && !Object.isFrozen(o) && !(o instanceof Date)) {
    Object.freeze(o);
    for (const v of Object.values(o)) deepFreeze(v);
  }
  return o;
}

const withoutFreshness = (fs: readonly Finding[]) => fs.map(({ freshness: _freshness, ...rest }) => rest);

describe('P5-35 freshness: purity', () => {
  it('T35-F12: no hidden clock, no mutation, no aliasing, and an as-of triple that is not the local date of now throws RangeError', () => {
    const ctx: FreshnessContext = { now: NOW, facts: fullFacts() };
    const out = assembleFindings({ asOf: ASOF, ...fullSources(), freshness: ctx });
    // Not vacuous: the fixture has every state.
    expect(new Set(out.findings.map((f) => f.freshness.state))).toEqual(new Set(['fresh', 'stale', 'never', 'undated']));

    // A spied Date.now is never called…
    const nowSpy = vi.spyOn(Date, 'now');
    const spied = assembleFindings({ asOf: ASOF, ...fullSources(), freshness: { now: NOW, facts: fullFacts() } });
    expect(nowSpy).not.toHaveBeenCalled();
    nowSpy.mockRestore();
    expect(spied).toEqual(out);
    // …and two system times give the same answer.
    vi.useFakeTimers();
    vi.setSystemTime(new Date(Date.UTC(2019, 0, 1, 3)));
    const early = assembleFindings({ asOf: ASOF, ...fullSources(), freshness: { now: NOW, facts: fullFacts() } });
    vi.setSystemTime(new Date(Date.UTC(2033, 6, 15, 22)));
    const late = assembleFindings({ asOf: ASOF, ...fullSources(), freshness: { now: NOW, facts: fullFacts() } });
    vi.useRealTimers();
    expect(early).toEqual(late);
    expect(early).toEqual(out);

    // Deep-frozen inputs, context included: no throw, nothing written, the same answer.
    const input = deepFreeze({ asOf: { ...ASOF }, ...fullSources(), freshness: { now: new Date(NOW), facts: fullFacts() } });
    const snapshot = JSON.stringify(input);
    const frozenOut = assembleFindings(input);
    expect(JSON.stringify(input)).toBe(snapshot);
    expect(frozenOut).toEqual(out);

    // No returned object, and no Date, is an object from the input.
    const inputObjects = new Set<unknown>();
    const collect = (v: unknown) => { if (v && typeof v === 'object') { inputObjects.add(v); Object.values(v).forEach(collect); } };
    collect(input);
    for (const r of [input.freshness.facts.items, input.freshness.facts.cashCounts]) for (const x of r) for (const v of Object.values(x)) inputObjects.add(v);
    const shared: string[] = [];
    const check = (v: unknown, path: string) => {
      if (v && typeof v === 'object') {
        if (inputObjects.has(v)) shared.push(path);
        Object.entries(v).forEach(([k, x]) => check(x, `${path}.${k}`));
      }
    };
    check(frozenOut, 'out');
    expect(shared).toEqual([]);
    // And no two findings share one freshness object.
    const objs = frozenOut.findings.map((f) => f.freshness);
    expect(new Set(objs).size).toBe(objs.length);

    // The as-of triple must be the local date of `now`.
    const nextDay = asOfFromDate(new Date(NOW.getTime() + DAY));
    expect(() => assembleFindings({ asOf: nextDay, drift: [drift()], freshness: ctx })).toThrow(RangeError);
    expect(() => assembleFindings({ asOf: nextDay, freshness: ctx })).toThrow(RangeError);
    expect(() => fromDrift(drift(), nextDay, ctx)).toThrow(RangeError);
    // Contributors read for another year are refused too.
    expect(() => assembleFindings({ asOf: ASOF, freshness: { now: NOW, facts: facts({ year: ASOF.year - 1 }) } })).toThrow(RangeError);
    // An invalid instant is refused rather than judged.
    expect(() => assembleFindings({ asOf: ASOF, freshness: { now: new Date(Number.NaN), facts: facts() } })).toThrow(RangeError);
    // A duplicate key in the facts is refused rather than silently merged.
    expect(() => fromSync(sync(), ASOF, ctxOf({ items: [item('acct_fixture_sync', ago(HOUR)), item('acct_fixture_sync', ago(DAY))] })))
      .toThrow(RangeError);
  });

  it('T35-F13: freshness changes no count, order, severity, confidence or other field, and permuting its inputs reorders nothing', () => {
    const without = assembleFindings({ asOf: ASOF, ...fullSources() });
    const withCtx = assembleFindings({ asOf: ASOF, ...fullSources(), freshness: { now: NOW, facts: fullFacts() } });
    expect(withCtx.findings).toHaveLength(without.findings.length);
    expect(withCtx.notEvaluated).toEqual(without.notEvaluated);
    expect(withoutFreshness(withCtx.findings)).toEqual(withoutFreshness(without.findings));
    // The two runs really differ in freshness, so the equality above is not vacuous.
    expect(withCtx.findings.map((f) => f.freshness)).not.toEqual(without.findings.map((f) => f.freshness));

    // A future context (everything undated) orders the same way too.
    const future = assembleFindings({ asOf: ASOF, ...fullSources(), freshness: futureCtx(new Date(NOW.getTime() + 1)) });
    expect(withoutFreshness(future.findings)).toEqual(withoutFreshness(without.findings));

    // Permuting every list in the facts changes nothing at all, freshness included.
    const f = fullFacts();
    const rev = <T>(xs: readonly T[]) => [...xs].reverse();
    const permuted: FreshnessFacts = {
      ...f, accounts: rev(f.accounts), items: rev(f.items), cashCounts: rev(f.cashCounts), valuations: rev(f.valuations),
      overdraftSightings: rev(f.overdraftSightings), overdraftProjections: rev(f.overdraftProjections),
      contributors: rev(f.contributors).map((c) => ({ ...c, accountIds: rev(c.accountIds) })),
    };
    expect(assembleFindings({ asOf: ASOF, ...fullSources(), freshness: { now: NOW, facts: permuted } })).toEqual(withCtx);

    // A stale and a fresh finding of the same kind and producer state share a severity.
    const staleSync = fromSync(sync(), ASOF, ctxOf({ items: [item('acct_fixture_sync', ago(10 * DAY))] }))!;
    const freshSync = fromSync(sync(), ASOF, ctxOf({ items: [item('acct_fixture_sync', ago(HOUR))] }))!;
    expect([staleSync.freshness.state, freshSync.freshness.state]).toEqual(['stale', 'fresh']);
    expect(staleSync.severity).toBe(freshSync.severity);
    const neverBreach = fromBreach(breach(), ASOF, plaidCtx(null));
    const freshBreach = fromBreach(breach(), ASOF, plaidCtx(ago(HOUR)));
    expect([neverBreach.freshness.state, freshBreach.freshness.state]).toEqual(['never', 'fresh']);
    expect(neverBreach.severity).toBe(freshBreach.severity);
    expect(neverBreach.confidence).toBe(freshBreach.confidence);
  });
});
