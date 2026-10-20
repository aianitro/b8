// One vocabulary for "a thing worth telling the owner" (ROADMAP.md §5 Phase 5 step 34): the
// conversions from each existing producer into `@b8/contracts/findings`, and the one function that
// assembles them into a single list.
//
// WHY THIS IS THE ONLY PLACE A SEVERITY IS WRITTEN. Ten producers each detect something and each
// has its own idea of how bad it is — a sort order, a push priority, a `scored` flag. Steps 35 and
// 36 put them in one list. If every consumer ranked them itself, the rankings would diverge exactly
// the way the two "pick the newest valuation" reducers once did. So the mapping from a producer's
// own state to a severity and a confidence (SPEC.md's mapping table) has exactly one
// implementation, here, and `findingsWiring.test.ts` (W1) fails if a severity literal is assigned
// anywhere else in the app.
//
// DERIVED, NOT INVENTED. Every severity below is read off a state the producer already computed —
// its own `scored` flag, its own `never`/`stale` reason, its own `failing`/`stale` state — and the
// conversions never rank a state above one the producer itself sorts ahead of it (V11). Nothing
// here re-derives `scored`, re-applies a threshold, or filters anything the producer reported,
// except the two "reportable" predicates the UI already applies (sync `ok`, job `fresh`), because
// those producers emit healthy items alongside unhealthy ones and a healthy item is not a finding.
//
// WHAT A CONVERSION DOES TO A VALUE. It copies. Money is formatted once per field, by the same three
// steps as `wireMoney` (round to the cent, drop the minus sign from zero, print two decimals) — it is
// not imported from `lib/overviewRead.ts` because that file imports the database, and V12 pins that
// the two agree. No sign is changed: `drift.ts` has already normalised Plaid's owed-as-positive
// balances, and applying the flip again here would be the double-normalisation BUILD.md §10.3 names.
// No arithmetic, no date differences: every count of days or hours is the producer's. A producer's
// null stays null — "never counted" is not "counted today", and `institutionStatus: null` (unread) is
// not `HEALTHY`.
//
// PURE. No clock, no database, no randomness. The as-of date is an argument, in the same 0-based
// triple the overview already uses, so a test means the same thing in December as in March and
// under any process time zone.
//
// NOTHING EXISTING IMPORTS THIS YET. Step 35 (freshness) and step 36 (the composed digest) are its
// first consumers; the overview payload deliberately does not carry the list in this step (SPEC.md,
// "Decision on the overview payload").

import { roundCents } from '../budgetMath';
import { withoutNegativeZero } from './adherence';
import { daysInMonth } from './pacing';
import type { AsOf } from './pacing';
import type { AdherenceFinding, BreachFinding, ChronicUnderspendFinding, MonthVariance } from './adherence';
import type { DriftFinding } from './drift';
import type { FeedFinding } from './feedHealth';
import type { SyncItemHealth } from './syncHealth';
import type { JobHealth } from './jobHealth';
import type { WalletFinding } from './walletStaleness';
import type { ValuationFinding } from './valuationStaleness';
// Type-only, deliberately: `overdraftWatch.ts` owns the database reads that produce these, and a
// value import would make this pure module load a connection pool (W4 enforces the distinction).
import type { ForecastFinding, OverdraftFinding } from '../overdraftWatch';
import type { Finding, FindingKind, Severity } from '@b8/contracts/findings';

/** The member of the union for one kind. */
export type FindingOf<K extends FindingKind> = Extract<Finding, { kind: K }>;

// ─── Formatting: the only numeric and calendar acts in this module ─────────────────────────────

/**
 * A producer's money figure as the vocabulary's two-decimal string.
 *
 * The same three steps as `wireMoney` in `lib/overviewRead.ts`, in the same order, so the string a
 * step-36 digest shows can never disagree with the one the dashboard shows by a cent: round to the
 * cent (`roundCents`, the repo's one rounding rule), turn `-0` into `0` so `-0.004` does not print as
 * `"-0.00"`, then print two places. V12 runs both over a table of awkward inputs and requires equality.
 *
 * A non-finite input throws rather than printing `"NaN"` or `"Infinity"`. No producer emits one, and
 * a list that silently carried an unparseable figure would be worse than a loud failure here.
 */
export function findingMoney(value: number): string {
  if (!Number.isFinite(value)) {
    throw new RangeError(`findingMoney: a money figure must be finite, got ${value}`);
  }
  return withoutNegativeZero(roundCents(value)).toFixed(2);
}

const pad2 = (n: number) => String(n).padStart(2, '0');

function assertYear(year: number): void {
  // Four digits, because the calendar text this renders into is `YYYY-…` and the contract refuses
  // anything else; a year outside that is a caller defect, not a value to format.
  if (!Number.isInteger(year) || year < 1 || year > 9999) {
    throw new RangeError(`findings: year must be an integer 1-9999, got ${year}`);
  }
}

/**
 * A 0-based month (January = 0, the indexing `monthly_amounts`, `MonthVariance.month` and `AsOf.month`
 * all use) as 1-based calendar text: month 0 of 2026 is `'2026-01'`, month 11 is `'2026-12'`.
 *
 * The `+ 1` lives here and nowhere else in this module. A month outside 0–11 throws: rendering 12 as
 * `'2026-13'`, or -1 as `'2026-00'`, would be the off-by-one this repo has already paid for, made
 * plausible-looking.
 */
export function calendarMonthOf(year: number, month: number): string {
  assertYear(year);
  if (!Number.isInteger(month) || month < 0 || month > 11) {
    throw new RangeError(`findings: month must be an integer 0-11 (0 = January), got ${month}`);
  }
  return `${String(year).padStart(4, '0')}-${pad2(month + 1)}`;
}

/**
 * The as-of triple as `'YYYY-MM-DD'`, month plus one.
 *
 * Integer formatting, never a `Date`: building a local-midnight `Date` and taking the first ten
 * characters of its ISO string reads the UTC day, which is the day before under any positive offset,
 * and this module must give the same answer in every process time zone (the scenario suite runs
 * under three).
 *
 * The day is bounded by the month's real length (`daysInMonth`, the one definition of it in this
 * directory), not merely by 1–31: the contract's date primitive refuses February 30, and formatting
 * one here would emit a list that fails its own schema.
 */
export function asOfDate(asOf: AsOf): string {
  assertYear(asOf.year);
  const length = daysInMonth(asOf.year, asOf.month);
  if (!Number.isInteger(asOf.day) || asOf.day < 1 || asOf.day > length) {
    throw new RangeError(
      `findings: as-of day must be an integer 1-${length} for month ${asOf.month} of ${asOf.year}, got ${asOf.day}`,
    );
  }
  return `${calendarMonthOf(asOf.year, asOf.month)}-${pad2(asOf.day)}`;
}

const asOfPeriod = (asOf: AsOf) => ({ type: 'asOf' as const, date: asOfDate(asOf) });

// ─── The conversions, one per kind ─────────────────────────────────────────────────────────────
//
// Each takes one producer finding and the as-of triple and returns one Finding, or `null` for the
// two producers that also emit healthy items. Severity and confidence are assigned inline, beside
// the producer state they are read from, so the table in SPEC.md can be checked against this file
// row by row.

/**
 * A month that drew more than its budget.
 *
 * `warning` when the category is scored, `notice` when it is not — `scored` is the producer's flag,
 * copied, never re-derived (no `isScoredCategory` here). An unscored breach (a fixed line over its
 * budget) is still a finding: the producer reported it, and dropping it would be a second filter.
 *
 * The year is the as-of year: the caller contract `AdherenceInput` already states (pacing.ts) is that
 * one adherence run covers one calendar year, and that year is the as-of point's.
 */
export function fromBreach(f: BreachFinding, asOf: AsOf): FindingOf<'budget-breach'> {
  return {
    kind: 'budget-breach',
    severity: f.scored ? 'warning' : 'notice',
    confidence: 'inferred',
    subject: { type: 'category', id: f.categoryId, name: f.category },
    period: { type: 'month', month: calendarMonthOf(asOf.year, f.month) },
    scored: f.scored,
    budgeted: findingMoney(f.budgeted),
    actual: findingMoney(f.actual),
    variance: findingMoney(f.variance),
    // Null when nothing was budgeted: null stays null, never 0 and never Infinity.
    ratio: f.ratio,
  };
}

function monthlyOf(year: number, m: MonthVariance) {
  return {
    month: calendarMonthOf(year, m.month),
    budgeted: findingMoney(m.budgeted),
    actual: findingMoney(m.actual),
    variance: findingMoney(m.variance),
    ratio: m.ratio,
  };
}

/**
 * A budget line that ran far under in every qualifying month of its window.
 *
 * `notice` whatever `scored` says: an under-spent line is a wrong budget, not money at risk. The
 * period is the producer's qualifying months, in the producer's (calendar) order and not assumed
 * contiguous — $0-budget months are absent by construction. The window totals are the producer's,
 * not re-summed here, and `monthly` carries its per-month evidence (CONTRACT.md ambiguity 1).
 */
export function fromChronicUnderspend(f: ChronicUnderspendFinding, asOf: AsOf): FindingOf<'budget-underspend'> {
  return {
    kind: 'budget-underspend',
    severity: 'notice',
    confidence: 'inferred',
    subject: { type: 'category', id: f.categoryId, name: f.category },
    period: { type: 'months', months: f.months.map((m) => calendarMonthOf(asOf.year, m.month)) },
    scored: f.scored,
    budgeted: findingMoney(f.budgeted),
    actual: findingMoney(f.actual),
    variance: findingMoney(f.variance),
    monthly: f.months.map((m) => monthlyOf(asOf.year, m)),
  };
}

/**
 * A ledger that disagrees with the bank. `warning` for either `safeToDerive` value and either sign of
 * `drift`: whether the fix is to move the opening balance changes what to DO, not how much it
 * matters. All four figures keep the producer's sign; nothing here re-applies the owed-as-positive
 * flip.
 */
export function fromDrift(f: DriftFinding, asOf: AsOf): FindingOf<'balance-drift'> {
  return {
    kind: 'balance-drift',
    severity: 'warning',
    confidence: 'observed',
    subject: { type: 'account', id: f.accountId, name: f.name },
    period: asOfPeriod(asOf),
    ledgerBalance: findingMoney(f.ledgerBalance),
    expectedBalance: findingMoney(f.expectedBalance),
    drift: findingMoney(f.drift),
    suggestedBeginningBalance: findingMoney(f.suggestedBeginningBalance),
    observedAt: f.observedAt,
    safeToDerive: f.safeToDerive,
  };
}

/**
 * A Plaid feed failing or gone quiet. `failing` is `warning` and `stale` is `notice`, the producer's
 * own order (it sorts failing first). `institutionStatus` is carried as read and never consulted:
 * `null` is UNREAD, not healthy, and a `HEALTHY` bank behind a stale feed says the problem is this
 * connection, which is a reason to report it, not to soften it. Timestamps become ISO strings as
 * `wireFeedFinding` renders them.
 */
export function fromFeed(f: FeedFinding, asOf: AsOf): FindingOf<'feed-degraded'> {
  return {
    kind: 'feed-degraded',
    severity: f.state === 'failing' ? 'warning' : 'notice',
    confidence: 'observed',
    subject: { type: 'institution', name: f.institution },
    period: asOfPeriod(asOf),
    accountCount: f.accountCount,
    state: f.state,
    lastSuccessfulUpdate: f.lastSuccessfulUpdate === null ? null : f.lastSuccessfulUpdate.toISOString(),
    hoursStale: f.hoursStale,
    institutionStatus: f.institutionStatus,
    institutionStatusAt: f.institutionStatusAt === null ? null : f.institutionStatusAt.toISOString(),
  };
}

/**
 * A connection this app has not synced. `ok` is not a finding and yields `null` — the same predicate
 * `SyncHealthCard` applies (`status !== 'ok'`), restated rather than imported because the card is a
 * component and this is a pure module (SPEC.md non-goals: no refactor of the duplicated predicate).
 * `never` is `warning` and `stale` is `notice`, the producer's own order.
 *
 * The subject name is the producer's `bank`, which the producer has already turned into the text
 * `Unknown` when the bank is null. That substitution is inherited, not introduced (CONTRACT.md
 * ambiguity 11; recorded for step 35).
 */
export function fromSync(h: SyncItemHealth, asOf: AsOf): FindingOf<'sync-stale'> | null {
  if (h.status === 'ok') return null;
  return {
    kind: 'sync-stale',
    severity: h.status === 'never' ? 'warning' : 'notice',
    confidence: 'observed',
    subject: { type: 'institution', name: h.bank },
    period: asOfPeriod(asOf),
    key: h.key,
    accountCount: h.accountCount,
    daysStale: h.daysStale,
    status: h.status,
  };
}

/**
 * The daily job not having run. `fresh` yields `null`, as the dashboard page and the digest read
 * treat it. `missed` and `never` are `warning`, `late` is `notice`: a late run is today's that has not
 * happened yet, a missed one is a day that did not happen. The producer's sentence is carried
 * verbatim — this step composes no wording.
 */
export function fromJob(h: JobHealth, asOf: AsOf): FindingOf<'job-overdue'> | null {
  if (h.status === 'fresh') return null;
  return {
    kind: 'job-overdue',
    severity: h.status === 'late' ? 'notice' : 'warning',
    confidence: 'observed',
    subject: { type: 'system', name: 'daily-job' },
    period: asOfPeriod(asOf),
    status: h.status,
    daysSince: h.daysSince,
    message: h.message,
  };
}

/**
 * A cash wallet nobody has confirmed. `never` is `warning` (a balance no human has ever verified),
 * `stale` is `notice`. `daysSinceCount` stays null for `never`; zero would read as "counted today".
 */
export function fromWallet(f: WalletFinding, asOf: AsOf): FindingOf<'cash-uncounted'> {
  return {
    kind: 'cash-uncounted',
    severity: f.reason === 'never' ? 'warning' : 'notice',
    confidence: 'observed',
    subject: { type: 'account', id: f.accountId, name: f.name },
    period: asOfPeriod(asOf),
    balance: findingMoney(f.balance),
    daysSinceCount: f.daysSinceCount,
    reason: f.reason,
  };
}

/**
 * A hand-valued account never valued, or valued too long ago. `never` is `warning`, `stale` is
 * `notice`. The producer's `never` variant has no `daysSince` key at all; here the key is present and
 * null, so "no count" cannot be read as "the converter forgot the field".
 */
export function fromValuation(f: ValuationFinding, asOf: AsOf): FindingOf<'valuation-stale'> {
  return {
    kind: 'valuation-stale',
    severity: f.reason === 'never' ? 'warning' : 'notice',
    confidence: 'observed',
    subject: { type: 'account', id: f.id, name: f.name },
    period: asOfPeriod(asOf),
    reason: f.reason,
    daysSince: f.reason === 'never' ? null : f.daysSince,
  };
}

/**
 * An open overdraft episode — the only `critical` in the vocabulary. The producer pushes it at `high`
 * priority and calls an overdraft fee "the one cost that is pure waste": money is being lost now.
 */
export function fromOverdraft(f: OverdraftFinding, asOf: AsOf): FindingOf<'overdraft-open'> {
  return {
    kind: 'overdraft-open',
    severity: 'critical',
    confidence: 'observed',
    subject: { type: 'account', id: f.accountId, name: f.account },
    period: asOfPeriod(asOf),
    bank: f.bank,
    balance: findingMoney(f.balance),
    cushion: findingMoney(f.cushion),
    since: f.since,
    seenAt: f.seenAt,
  };
}

/**
 * An open overdraft forecast: `warning`, `projected` — about a future that has not happened, so never
 * `critical` and never `observed`.
 *
 * `charges` IS NOT CARRIED. It holds transaction-derived merchant labels, and this list is
 * household-wide; the contract's strict member would refuse it anyway. Listed field by field rather
 * than spread-and-delete, so a field added to `ForecastFinding` later is never carried by accident:
 * the producer-field exactness check in `findings.test.ts` fails `tsc` until somebody decides
 * whether it is carried or dropped.
 */
export function fromForecast(f: ForecastFinding, asOf: AsOf): FindingOf<'overdraft-forecast'> {
  return {
    kind: 'overdraft-forecast',
    severity: 'warning',
    confidence: 'projected',
    subject: { type: 'account', id: f.accountId, name: f.account },
    period: asOfPeriod(asOf),
    bank: f.bank,
    cushion: findingMoney(f.cushion),
    low: findingMoney(f.low),
    lowOn: f.lowOn,
    projectedAt: f.projectedAt,
  };
}

/** Either adherence kind, dispatched on the producer's own `kind`. */
export function fromAdherence(f: AdherenceFinding, asOf: AsOf): FindingOf<'budget-breach' | 'budget-underspend'> {
  return f.kind === 'breach' ? fromBreach(f, asOf) : fromChronicUnderspend(f, asOf);
}

// ─── The registries ────────────────────────────────────────────────────────────────────────────

/** The nine sources the assembler accepts, in canonical order — the order `notEvaluated` uses and
 * the tie-break between equal severities. Listed as SPEC.md lists them; the order carries no
 * judgement beyond being fixed. */
export const FINDING_SOURCES = [
  'adherence',
  'drift',
  'feed',
  'sync',
  'job',
  'wallets',
  'valuations',
  'overdrafts',
  'forecasts',
] as const;

export type FindingSource = (typeof FINDING_SOURCES)[number];

/**
 * The conversion registry: every kind the contract names, with the source it comes from, the
 * producer type it converts and the function that does it.
 *
 * Keyed by kind and checked with `satisfies` against `FindingKind`, so a kind added to the contract
 * without a conversion — or a conversion for a kind the contract does not name — fails `tsc`. The
 * wiring test W2 checks the same equality over the source text, so it also fails without a compile.
 */
export const FINDING_CONVERSIONS = {
  'budget-breach': { source: 'adherence', producer: 'BreachFinding', convert: fromBreach },
  'budget-underspend': { source: 'adherence', producer: 'ChronicUnderspendFinding', convert: fromChronicUnderspend },
  'balance-drift': { source: 'drift', producer: 'DriftFinding', convert: fromDrift },
  'feed-degraded': { source: 'feed', producer: 'FeedFinding', convert: fromFeed },
  'sync-stale': { source: 'sync', producer: 'SyncItemHealth', convert: fromSync },
  'job-overdue': { source: 'job', producer: 'JobHealth', convert: fromJob },
  'cash-uncounted': { source: 'wallets', producer: 'WalletFinding', convert: fromWallet },
  'valuation-stale': { source: 'valuations', producer: 'ValuationFinding', convert: fromValuation },
  'overdraft-open': { source: 'overdrafts', producer: 'OverdraftFinding', convert: fromOverdraft },
  'overdraft-forecast': { source: 'forecasts', producer: 'ForecastFinding', convert: fromForecast },
} as const satisfies {
  [K in FindingKind]: {
    source: FindingSource;
    producer: string;
    convert: (input: never, asOf: AsOf) => FindingOf<K> | null;
  };
};

// ─── The assembler ─────────────────────────────────────────────────────────────────────────────

/**
 * Each producer's output as the producer returns it. Every key is optional, and an omitted key — or
 * one present but `undefined` — means "this producer was not run", which the result reports in
 * `notEvaluated`. A supplied empty array means "run, and found nothing". The difference is the whole
 * point: an empty list read as "all clear" when a source was never supplied is the P0.5-29a N11
 * defect at the digest's scale.
 *
 * `job` is one verdict, not a list, because `jobHealth` returns one; a `fresh` verdict is supplied
 * and clean.
 */
export interface FindingSources {
  adherence?: readonly AdherenceFinding[];
  drift?: readonly DriftFinding[];
  feed?: readonly FeedFinding[];
  sync?: readonly SyncItemHealth[];
  job?: JobHealth;
  wallets?: readonly WalletFinding[];
  valuations?: readonly ValuationFinding[];
  overdrafts?: readonly OverdraftFinding[];
  forecasts?: readonly ForecastFinding[];
}

export interface FindingsInput extends FindingSources {
  /** The overview's as-of triple: month 0-based (January = 0), never a clock read. */
  asOf: AsOf;
}

export interface AssembledFindings {
  /** Worst first; ties by source order, then by the producer's own order. */
  findings: Finding[];
  /** The sources that were not supplied, in `FINDING_SOURCES` order. */
  notEvaluated: FindingSource[];
}

/** Worst first, as `SeveritySchema` lists them. */
const SEVERITY_RANK: Record<Severity, number> = { critical: 0, warning: 1, notice: 2 };

/** One source's findings, converted, in the producer's order, unreportable items removed. */
function convertSource(sources: FindingSources, source: FindingSource, asOf: AsOf): Finding[] {
  const present = <T>(xs: T | undefined): xs is T => xs !== undefined;
  const keep = <T>(xs: (T | null)[]): T[] => xs.filter((x): x is T => x !== null);
  switch (source) {
    case 'adherence':
      return present(sources.adherence) ? sources.adherence.map((f) => fromAdherence(f, asOf)) : [];
    case 'drift':
      return present(sources.drift) ? sources.drift.map((f) => fromDrift(f, asOf)) : [];
    case 'feed':
      return present(sources.feed) ? sources.feed.map((f) => fromFeed(f, asOf)) : [];
    case 'sync':
      return present(sources.sync) ? keep(sources.sync.map((h) => fromSync(h, asOf))) : [];
    case 'job':
      return present(sources.job) ? keep([fromJob(sources.job, asOf)]) : [];
    case 'wallets':
      return present(sources.wallets) ? sources.wallets.map((f) => fromWallet(f, asOf)) : [];
    case 'valuations':
      return present(sources.valuations) ? sources.valuations.map((f) => fromValuation(f, asOf)) : [];
    case 'overdrafts':
      return present(sources.overdrafts) ? sources.overdrafts.map((f) => fromOverdraft(f, asOf)) : [];
    case 'forecasts':
      return present(sources.forecasts) ? sources.forecasts.map((f) => fromForecast(f, asOf)) : [];
  }
}

/**
 * Every supplied producer's findings as one list, and the producers that were not supplied.
 *
 * ONE FINDING PER REPORTABLE PRODUCER FINDING. Nothing is merged, deduplicated or correlated: a feed
 * finding and a sync finding for the same institution name are two findings, because this step does
 * not decide that they are one problem. An overdraft episode and a forecast on one account cannot
 * both be open (the producer closes the forecast when the episode opens), and nothing here
 * synthesises either.
 *
 * DETERMINISTIC ORDER. Severity first (`critical`, `warning`, `notice`), then `FINDING_SOURCES`
 * order, then the position in the producer's own list — all three keys explicit, so the result does
 * not lean on `Array.prototype.sort` stability and does not depend on the key order of `input`.
 *
 * PURE. Inputs are read, never written; the sort runs on a fresh array of fresh objects, and no
 * returned object shares a reference with an input. The as-of date is validated (and a bad one
 * throws `RangeError`) before any source is read.
 */
export function assembleFindings(input: FindingsInput): AssembledFindings {
  const { asOf } = input;
  asOfDate(asOf);

  const notEvaluated = FINDING_SOURCES.filter((s) => input[s] === undefined);
  const ranked = FINDING_SOURCES.flatMap((source, sourceRank) =>
    convertSource(input, source, asOf).map((finding, position) => ({ finding, sourceRank, position })),
  );
  ranked.sort((a, b) =>
    SEVERITY_RANK[a.finding.severity] - SEVERITY_RANK[b.finding.severity]
    || a.sourceRank - b.sourceRank
    || a.position - b.position);

  return { findings: ranked.map((r) => r.finding), notEvaluated };
}
