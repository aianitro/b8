import db from './db';
import { assembleFindings, asOfDate, type FindingSource, type FindingSources } from './domain/findings';
import type { FreshnessContext } from './domain/findingsFreshness';
import type { DigestPeriod } from './domain/findingsDigest';
import type { GiftViewer } from './domain/giftMask';
import { asOfFromDate } from './domain/monthOutlook';
import { classifySyncHealth, type SyncItemInput } from './domain/syncHealth';
import { staleWallets } from './domain/walletStaleness';
import { walletStatuses } from './cashCountStore';
import { findBalanceDrift } from './drift';
import { loadFeedHealth } from './feedHealthRead';
import { loadFreshnessFacts } from './findingsFreshnessRead';
import { loadJobHealth } from './jobHealthRead';
import { loadMonthOutlook } from './monthOutlookRead';
import { loadForecasts, loadOverdrafts } from './overdraftWatch';
import { loadValuationFindings } from './valuationStalenessRead';
import type { Finding } from '@b8/contracts/findings';

// What the findings digest at `/digest` is composed from (ROADMAP.md §5 Phase 5 step 36): every
// producer run once, the freshness facts read once, and the findings assembled. The composing is
// `lib/domain/findingsDigest.ts`; this module only reads.
//
// ─── Every source is the dashboard's own reader ───────────────────────────────────────────────
//
// Each of the nine sources is the exact call the dashboard (or the overview payload behind it) makes
// for the same thing, so "worth telling" has one definition: the feed, drift, job, valuation,
// overdraft and forecast loaders; `staleWallets` over `walletStatuses`; and the month outlook's own
// adherence findings, which already carry the operational, `hidden` and `exclude_from_budget`
// filters. Nothing here adds, removes or re-derives a filter. `scripts/findings-digest-read.test.ts`
// (T36-L2) runs each reader beside this module over the same rows and fails if any differs.
//
// The one exception is the sync source: the item query `SyncHealthCard` runs is private to that
// component, and SPEC.md forbids refactoring the card in this step, so the grouping is repeated
// below, verbatim in meaning. T36-L2 computes the expected value with its own SQL and pins this one.
//
// ─── A failed source is not evaluated, never empty ────────────────────────────────────────────
//
// A source whose read throws is left out of the assembler's input, which is exactly how the
// assembler spells "not evaluated" — and the page names it. Turning the failure into an empty list
// would make a broken query read as "checked, and found nothing", the one confusion the coverage
// record exists to prevent. The error is logged (its message only: a driver error names a relation
// or a column, never a row) and the page still renders (SPEC.md Q5).
//
// The freshness facts are the same: if their read throws, no freshness context is passed, and every
// finding is `undated` with one undated input. A failed facts read never falls back to `fresh`.
//
// ─── No clock, no viewer-dependent figure, no row text ────────────────────────────────────────
//
// NO CLOCK. `now` is the page's one clock read. It is passed to every reader that takes an instant,
// and the as-of triple and the period are derived from it here with the same process-local
// `asOfFromDate` the assembler checks the freshness context against. No query below reads
// Postgres's clock (T36-W1, T36-L6).
//
// THE VIEWER IS TAKEN AND NOT USED, deliberately. Every figure in the app is the same sum for every
// viewer (P7-41b), and the dashboard already shows these breach and drift figures to everybody; a
// digest that masked them for one person would disagree with that screen. What the digest must
// guarantee instead is that it carries no transaction text, which the contract's strict members
// already enforce and T36-L4 proves for a held gift. The argument stays required, as on
// `loadOverview`, so a caller cannot forget to say who is looking if a later step ever needs to know.
// This module does not import the gift read path and reads no transaction text for any reason.

/** What the page composes the digest from. */
export interface FindingsDigestInput {
  /** The assembled findings, in the assembler's own order. */
  findings: Finding[];
  /** The sources that were not supplied or whose read failed, in canonical order. */
  notEvaluated: FindingSource[];
  /** The as-of day of `now`, from the integer triple — never from a UTC slice of an ISO string. */
  period: DigestPeriod;
}

/**
 * One row per Plaid item, as `SyncHealthCard` groups them: on the token, keyed by the smallest
 * account id, the token itself never selected.
 */
const SYNC_ITEMS_SQL = `
  SELECT MIN(id)               AS key,
         MIN(bank)             AS bank,
         COUNT(*)::text        AS account_count,
         MAX(last_synced_at)   AS last_synced_at
    FROM accounts
   WHERE access_token IS NOT NULL
   GROUP BY access_token`;

async function loadSyncItems(): Promise<SyncItemInput[]> {
  const { rows } = await db.query<{ key: string; bank: string | null; account_count: string; last_synced_at: Date | null }>(SYNC_ITEMS_SQL);
  return rows.map((r) => ({ key: r.key, bank: r.bank, accountCount: Number(r.account_count), lastSyncedAt: r.last_synced_at }));
}

/** The read's result, or `undefined` — "not evaluated" — when it throws. The failure is logged. */
async function attempt<T>(what: string, read: () => Promise<T>): Promise<T | undefined> {
  try {
    return await read();
  } catch (err) {
    console.error(`findingsDigestRead: the ${what} read failed and is reported as not evaluated: ${err instanceof Error ? err.message : String(err)}`);
    return undefined;
  }
}

/**
 * The findings, the sources not evaluated, and the period, for the instant `now`.
 *
 * Every read is issued at once; none waits on another. A read that fails is not evaluated (see the
 * header), so this never throws for a source's sake.
 */
export async function loadFindingsDigestInput(_viewer: GiftViewer, now: Date): Promise<FindingsDigestInput> {
  const asOf = asOfFromDate(now);
  const today = asOfDate(asOf);

  const [adherence, drift, feed, sync, job, wallets, valuations, overdrafts, forecasts, facts] = await Promise.all([
    attempt('adherence', async () => (await loadMonthOutlook(asOf)).outlook.findings),
    attempt('drift', () => findBalanceDrift()),
    attempt('feed', () => loadFeedHealth(now)),
    attempt('sync', async () => classifySyncHealth(await loadSyncItems(), now)),
    attempt('job', () => loadJobHealth(now)),
    attempt('wallets', async () => staleWallets(await walletStatuses(), now)),
    attempt('valuations', () => loadValuationFindings(today)),
    attempt('overdrafts', () => loadOverdrafts()),
    attempt('forecasts', () => loadForecasts()),
    attempt('freshness facts', () => loadFreshnessFacts(now)),
  ]);

  const sources: FindingSources = { adherence, drift, feed, sync, job, wallets, valuations, overdrafts, forecasts };
  const freshness: FreshnessContext | undefined = facts === undefined ? undefined : { now, facts };
  const { findings, notEvaluated } = assembleFindings({ asOf, freshness, ...sources });

  return { findings, notEvaluated, period: { type: 'asOf', date: today } };
}
