// Freshness: as of when each finding's worst input is believed true (ROADMAP.md §5 Phase 5 step 35).
//
// WHY THIS EXISTS. A finding is only as true as the oldest fact it rests on. "This category is under
// budget" over a bank feed that stopped importing weeks ago is not good news; it is missing data
// dressed as good news. Step 36 will narrate findings, and it must be able to say "as of when" — or
// "this cannot be dated" — without working it out again in its own way. So the per-kind rule of what
// a finding rests on, and how old that is, has exactly one implementation, here.
//
// WHAT AN INPUT IS. A recorded fact the finding's truth rests on, with the column that says when it
// was last believed true (SPEC.md "Inputs by kind"): an item's last successful sync, Plaid's last
// successful refresh of the item, a wallet's last count, an account's latest valuation date, the
// daily job's last scheduled run, an open overdraft episode's last sighting, an open forecast's
// projection. The facts are read by `lib/findingsFreshnessRead.ts`; this module only judges them.
//
// THRESHOLDS ARE THE PRODUCERS' OWN, IMPORTED BY NAME. A freshness rule with its own idea of "stale"
// would be a second definition of the same threshold, and the two would drift — the defect this
// directory exists to prevent. `STALE_AFTER_DAYS` is exported by both `syncHealth.ts` (the sync
// cadence) and `walletStaleness.ts` (the counting cadence) with different values, so each is imported
// under an alias that says which it is. Each comparator is the producer's too: whole floored days and
// `>=` for sync, wallets and overdraft rows; strictly greater, on milliseconds, for the feed;
// calendar days and `>=` for valuations; and for the job, the producer's own verdict (its late-after
// hour is private to `jobHealth.ts` and is deliberately not re-derived here). `findingsWiring.test.ts`
// (T35-W1) fails if a numeric literal other than a unit constant appears in this file.
//
// FOUR STATES, NEVER CONFLATED. `never` is a recorded absence (no count row, never synced, a feed with
// a failure and no success). `undated` is a missing or unusable record (a manual ledger account, a
// feed with neither timestamp, no contributing account, no context supplied, an observation later
// than `now`, a malformed date). An undated input is never reported as fresh, and a finding with no
// inputs at all is undated, not fresh.
//
// ONE INSTANT. Everything is judged against the `now` in the context. The assembler's as-of triple
// must be `asOfFromDate(now)` — the same process-local conversion the overview uses — and a context
// whose instant names a different day throws `RangeError` rather than judging one calendar against
// another. Instant ages are millisecond subtraction, which no time zone can move; a valuation is a
// calendar date and is compared with the as-of calendar date by integer day numbers, never turned
// into an instant at midnight.
//
// PURE. No clock, no database, no randomness, no parsing of timestamp text: instants arrive as `Date`
// objects (pg `timestamptz`), and the valuation date as Postgres's own `YYYY-MM-DD` rendering.
//
// FRESHNESS CHANGES NOTHING ELSE. It is attached to a finding after the finding is converted; it never
// feeds severity, confidence, ordering or whether a finding exists (T35-F13).

import {
  FreshnessBasisSchema,
  FreshnessSchema,
  type FindingKind,
  type Freshness,
  type FreshnessBasis,
  type FreshnessState,
} from '@b8/contracts/findings';
import { STALE_AFTER_DAYS as SYNC_STALE_AFTER_DAYS } from './syncHealth';
import { STALE_AFTER_HOURS as FEED_STALE_AFTER_HOURS } from './feedHealth';
import { STALE_AFTER_DAYS as WALLET_STALE_AFTER_DAYS } from './walletStaleness';
import { VALUATION_STALE_DAYS } from './valuationStaleness';
import { jobHealth } from './jobHealth';
import { asOfFromDate } from './monthOutlook';
import type { AsOf } from './pacing';

const HOUR_MS = 3_600_000;
const DAY_MS = 86_400_000;

// ─── The facts, as the read module hands them over ─────────────────────────────────────────────
//
// Dates, ids and counts only. No institution or account name, no transaction text and no amount:
// these facts are the same for every viewer by construction, because nothing in them is maskable.

/**
 * One account, as much as is needed to decide which class of input dates it.
 *
 * `itemKey` is the Plaid item the account belongs to, keyed the way `SyncHealthCard` keys an item
 * (the smallest account id behind one access token), and null exactly when the account has no token.
 * The token itself is never read.
 */
export interface AccountFact {
  accountId: string;
  itemKey: string | null;
  countable: boolean;
  valuationMode: 'ledger' | 'valuation';
}

/**
 * One Plaid item. `lastSyncedAt` is this app's last successful sync of it (`MAX(last_synced_at)`;
 * `sync.ts` advances it only after a success). The two feed columns are Plaid's own refresh record.
 */
export interface ItemFact {
  key: string;
  lastSyncedAt: Date | null;
  lastSuccessfulUpdate: Date | null;
  lastFailedUpdate: Date | null;
}

/** A countable account's latest count, or null when it has never been counted. */
export interface CashCountFact {
  accountId: string;
  lastCountedAt: Date | null;
}

/**
 * A hand-valued account's latest valuation as a CALENDAR DATE (`MAX(valued_at)::date`, rendered by
 * Postgres in its session zone — the expression `loadValuationFindings` uses), or null when never
 * valued. A string, not a `Date`: a date is not an instant, and inventing a midnight would invent a
 * zone with it.
 */
export interface ValuationFact {
  accountId: string;
  latestValuedOn: string | null;
}

/** An open overdraft episode: when the balance was last read below the cushion. */
export interface OverdraftSightingFact {
  accountId: string;
  lastSeenAt: Date;
}

/** An open overdraft forecast: when its latest projection was computed. */
export interface OverdraftProjectionFact {
  accountId: string;
  projectedAt: Date;
}

/**
 * The accounts that contributed at least one budget-visible transaction to an operational category
 * in `FreshnessFacts.year` — the row filter `readBudgetVsActual` applies (`hidden = FALSE`,
 * `track_transactions = TRUE`, the year of `date`). Each account once, however many rows it has.
 */
export interface ContributorFact {
  categoryId: number;
  accountIds: readonly string[];
}

export interface FreshnessFacts {
  /** The calendar year the contributors were read for: the as-of year of the read's `now`. */
  year: number;
  accounts: readonly AccountFact[];
  items: readonly ItemFact[];
  cashCounts: readonly CashCountFact[];
  valuations: readonly ValuationFact[];
  /** The latest `sync_log.ran_at` with `trigger = 'scheduler'`; manual syncs never count. */
  lastSchedulerRun: Date | null;
  overdraftSightings: readonly OverdraftSightingFact[];
  overdraftProjections: readonly OverdraftProjectionFact[];
  contributors: readonly ContributorFact[];
}

/** What freshness is judged from: one instant and the facts read for it. */
export interface FreshnessContext {
  now: Date;
  facts: FreshnessFacts;
}

// ─── Inputs and their states ───────────────────────────────────────────────────────────────────

/** One input, judged. A dated input carries its observation in its own precision and its age. */
export type FreshnessInput =
  | { basis: FreshnessBasis; state: 'never' | 'undated' }
  | { basis: FreshnessBasis; state: 'fresh' | 'stale'; lastObserved: string; ageDays: number };

const never = (basis: FreshnessBasis): FreshnessInput => ({ basis, state: 'never' });
const undated = (basis: FreshnessBasis): FreshnessInput => ({ basis, state: 'undated' });

/**
 * An instant input, judged by its producer's comparator.
 *
 * `null` is a recorded absence (`never`). An instant later than `now` — a skewed clock, or a sync
 * that committed a few milliseconds after the caller read its clock — is `undated`: it is never
 * carried as a negative age, and never clamped to zero, which would read as "observed just now". An
 * invalid `Date` is `undated` for the same reason a malformed date string is.
 */
function instantInput(
  basis: FreshnessBasis,
  at: Date | null,
  now: Date,
  isStale: (ms: number, ageDays: number) => boolean,
): FreshnessInput {
  if (at === null) return never(basis);
  const ms = now.getTime() - at.getTime();
  if (!Number.isFinite(ms) || ms < 0) return undated(basis);
  const ageDays = Math.floor(ms / DAY_MS);
  return { basis, state: isStale(ms, ageDays) ? 'stale' : 'fresh', lastObserved: at.toISOString(), ageDays };
}

/** Whole days, `>=`: `classifySyncHealth`'s comparator, with its constant. */
const syncStale = (_ms: number, ageDays: number) => ageDays >= SYNC_STALE_AFTER_DAYS;
/** Milliseconds, strictly greater: `feedState`'s comparator, with its constant. Not the floored day. */
const feedStale = (ms: number) => ms > FEED_STALE_AFTER_HOURS * HOUR_MS;
/** Whole days, `>=`: `staleWallets`' comparator, with its constant. */
const walletStale = (_ms: number, ageDays: number) => ageDays >= WALLET_STALE_AFTER_DAYS;

/** The item's last successful sync. An item the read does not have is `undated`, not fresh. */
export function syncInput(item: ItemFact | undefined, now: Date): FreshnessInput {
  if (item === undefined) return undated('sync');
  return instantInput('sync', item.lastSyncedAt, now, syncStale);
}

/**
 * Plaid's last successful refresh of the item.
 *
 * A success recorded is dated. Neither success nor failure recorded is the feed's `unknown` state —
 * nobody has observed this feed — and that is `undated`, not fresh and not never (SPEC.md
 * disposition 3: this is how an unknown feed becomes visible without a new kind). A failure with no
 * success ever is `never`: a recorded absence of the thing that dates it.
 */
export function feedInput(item: ItemFact | undefined, now: Date): FreshnessInput {
  if (item === undefined) return undated('feed');
  if (item.lastSuccessfulUpdate !== null) {
    return instantInput('feed', item.lastSuccessfulUpdate, now, feedStale);
  }
  return item.lastFailedUpdate === null ? undated('feed') : never('feed');
}

/** A wallet's last count. A wallet the read does not have is `undated`; one never counted, `never`. */
export function cashInput(fact: CashCountFact | undefined, now: Date): FreshnessInput {
  if (fact === undefined) return undated('cash-count');
  return instantInput('cash-count', fact.lastCountedAt, now, walletStale);
}

/** `YYYY-MM-DD`, captured. Shape only; whether it is a real date is the contract's rule, below. */
const CALENDAR_DATE = /^(\d{4})-(\d{2})-(\d{2})$/;

/** A calendar date as a whole-day number, by UTC arithmetic — no zone can move it. */
const dayNumber = (year: number, month0: number, day: number) => Date.UTC(year, month0, day) / DAY_MS;

/**
 * An account's latest valuation date, against the as-of calendar date.
 *
 * The age is the integer calendar-day difference of the two dates, as `staleValuations` computes it,
 * compared `>=` with `VALUATION_STALE_DAYS`. The observation stays a date. A string that is not a
 * real `YYYY-MM-DD` date — checked by the contract's own date primitive, so this module has no second
 * idea of what a valid date is — is `undated`, as is a date after the as-of date.
 */
export function valuationInput(fact: ValuationFact | undefined, asOf: AsOf): FreshnessInput {
  if (fact === undefined) return undated('valuation');
  const text = fact.latestValuedOn;
  if (text === null) return never('valuation');
  const m = CALENDAR_DATE.exec(text);
  if (m === null || !FreshnessSchema.shape.lastObserved.safeParse(text).success) return undated('valuation');
  const [, y, mo, d] = m;
  const ageDays = dayNumber(asOf.year, asOf.month, asOf.day) - dayNumber(Number(y), Number(mo) - 1, Number(d));
  if (!Number.isInteger(ageDays) || ageDays < 0) return undated('valuation');
  return { basis: 'valuation', state: ageDays >= VALUATION_STALE_DAYS ? 'stale' : 'fresh', lastObserved: text, ageDays };
}

/**
 * The daily job's last scheduled run, judged by the producer itself.
 *
 * `jobHealth`'s own verdict for the run and `now`: `fresh` is fresh, `late` and `missed` are stale.
 * Its late-after hour is private to that module, and calling it is the only way to agree with it
 * without copying it. A run later than `now` is `undated` here (the producer, since N3, reads such a
 * run as one at `now`; freshness says plainly that the record cannot be dated).
 */
export function jobInput(lastRun: Date | null, now: Date): FreshnessInput {
  return instantInput('job-run', lastRun, now, () => jobHealth(lastRun, now).status !== 'fresh');
}

/**
 * An open overdraft episode's last sighting, or an open forecast's projection.
 *
 * Both rows are rewritten by every sync that observes the account, so they age at the sync cadence:
 * `syncHealth`'s constant and comparator (SPEC.md Q5 — there is no threshold of their own). A row the
 * read no longer has — the episode or forecast closed between the producer's read and this one — is
 * `undated`.
 */
export function overdraftInput(
  basis: 'overdraft-sighting' | 'overdraft-projection',
  at: Date | undefined,
  now: Date,
): FreshnessInput {
  if (at === undefined) return undated(basis);
  return instantInput(basis, at, now, syncStale);
}

// ─── Account classes ──────────────────────────────────────────────────────────────────────────

export type AccountClass = 'plaid-linked' | 'countable-cash' | 'valuation' | 'manual-ledger';

/**
 * Which kind of record dates an account (SPEC.md "Account classes"), in the spec's precedence: a
 * token makes it Plaid-linked whatever else is true of it; then countable; then valuation-mode; and
 * anything left is a manual ledger — a hand-added card, a CSV-imported account — for which the
 * database keeps no record of as of when it is believed complete (Q1).
 */
export function accountClassOf(a: AccountFact): AccountClass {
  if (a.itemKey !== null) return 'plaid-linked';
  if (a.countable) return 'countable-cash';
  if (a.valuationMode === 'valuation') return 'valuation';
  return 'manual-ledger';
}

// ─── Aggregation ───────────────────────────────────────────────────────────────────────────────

/**
 * The precedence of states, worst first (SPEC.md Q6, the owner's default): an input never observed
 * outranks a stale one, a stale one outranks an undated one, and fresh is last.
 */
const STATE_PRECEDENCE: readonly FreshnessState[] = ['never', 'stale', 'undated', 'fresh'];

/**
 * The tie-break between inputs of equal state and age: the contract's own basis order, read from the
 * schema rather than restated, so reordering it there is the one change that reorders it here.
 */
const BASIS_ORDER: readonly FreshnessBasis[] = FreshnessBasisSchema.options;

const ageOf = (i: FreshnessInput) => ('ageDays' in i ? i.ageDays : 0);
const observedOf = (i: FreshnessInput) => ('lastObserved' in i ? i.lastObserved : '');

/** Worst first: state, then oldest, then basis order, then the earlier observation. Total. */
function worseFirst(a: FreshnessInput, b: FreshnessInput): number {
  return STATE_PRECEDENCE.indexOf(a.state) - STATE_PRECEDENCE.indexOf(b.state)
    || ageOf(b) - ageOf(a)
    || BASIS_ORDER.indexOf(a.basis) - BASIS_ORDER.indexOf(b.basis)
    // Same basis and same whole-day age: the earlier observation is the older one. Both strings are
    // in one precision (ISO instants for one basis, dates for the other), so text order is time order.
    || (observedOf(a) < observedOf(b) ? -1 : observedOf(a) > observedOf(b) ? 1 : 0);
}

/**
 * The freshness of a set of inputs.
 *
 * The state is the worst input's: any `never` gives `never`; else any stale dated input gives
 * `stale`; else any undated input gives `undated`; else `fresh`. The basis, observation and age are
 * the worst input's — for `stale` and `fresh`, the oldest dated input in that state. `undatedInputs`
 * counts every undated input, so a `stale` or `never` finding that also rests on something undatable
 * says so.
 *
 * AN EMPTY SET IS ONE UNDATED INPUT (G1 ruling, CONTRACT.md ambiguity 1): a finding with nothing to
 * date it is undated, and the missing record is itself the undatable input.
 *
 * Independent of input order: the sort key is total, and runs on a copy.
 */
export function aggregateFreshness(inputs: readonly FreshnessInput[]): Freshness {
  if (inputs.length === 0) return unsuppliedFreshness();
  const undatedInputs = inputs.filter((i) => i.state === 'undated').length;
  const worst = [...inputs].sort(worseFirst)[0];
  if (worst.state === 'fresh' || worst.state === 'stale') {
    return { state: worst.state, basis: worst.basis, lastObserved: worst.lastObserved, ageDays: worst.ageDays, undatedInputs };
  }
  return { state: worst.state, basis: worst.basis, lastObserved: null, ageDays: null, undatedInputs };
}

/**
 * No context supplied: `undated`, basis `none`, one undated input. A fresh object on every call, so no
 * two findings share one.
 */
export function unsuppliedFreshness(): Freshness {
  return { state: 'undated', basis: 'none', lastObserved: null, ageDays: null, undatedInputs: 1 };
}

// ─── The facts, indexed, and the context checked against the as-of date ────────────────────────

export interface Judgement {
  now: Date;
  asOf: AsOf;
  lastSchedulerRun: Date | null;
  accounts: Map<string, AccountFact>;
  items: Map<string, ItemFact>;
  cash: Map<string, CashCountFact>;
  valuations: Map<string, ValuationFact>;
  sightings: Map<string, Date>;
  projections: Map<string, Date>;
  contributors: Map<number, readonly string[]>;
}

/**
 * A map by key that refuses a duplicate. Every key here is unique by the read's SQL; a duplicate
 * means two records claim to be one item or one account, and silently keeping either would be
 * exactly the merge-by-name failure this step rules out (two `Unknown` banks overwriting each other).
 */
function byKey<T, K>(rows: readonly T[], key: (r: T) => K, what: string): Map<K, T> {
  const out = new Map<K, T>();
  for (const r of rows) {
    const k = key(r);
    if (out.has(k)) throw new RangeError(`findingsFreshness: duplicate ${what} ${String(k)} in the facts`);
    out.set(k, r);
  }
  return out;
}

/**
 * Throws `RangeError` unless the context and the as-of triple describe one day: `asOfFromDate(now)`
 * must equal `asOf`, and the contributors must have been read for `asOf.year`. A context for another
 * day would judge one calendar against another, and contributors read for another year would date a
 * budget finding by the wrong year's accounts.
 */
export function assertContextMatchesAsOf(ctx: FreshnessContext, asOf: AsOf): void {
  if (!(ctx.now instanceof Date) || !Number.isFinite(ctx.now.getTime())) {
    throw new RangeError('findingsFreshness: the context instant is not a valid Date');
  }
  const derived = asOfFromDate(ctx.now);
  if (derived.year !== asOf.year || derived.month !== asOf.month || derived.day !== asOf.day) {
    throw new RangeError(
      `findingsFreshness: the as-of triple ${JSON.stringify(asOf)} is not the local date of the context instant ${JSON.stringify(derived)}`,
    );
  }
  if (ctx.facts.year !== asOf.year) {
    throw new RangeError(`findingsFreshness: contributors were read for ${ctx.facts.year}, the as-of year is ${asOf.year}`);
  }
}

/**
 * The index, built once per facts object. A cache keyed by the facts' identity changes no output —
 * the same object always yields the same index — and spares a list of findings from re-indexing the
 * same facts once per finding.
 *
 * PRECONDITION: A FACTS OBJECT IS NEVER MUTATED AFTER IT IS PASSED IN. The key is the object's
 * identity, not its contents, so a caller that pushed a row into `facts.items` after a first call
 * would be judged against the index of the old contents. No caller does: `loadFreshnessFacts` builds
 * a fresh object per read, and the findings digest (`lib/findingsDigestRead.ts`) builds one per
 * request and discards it. The cache is kept rather than dropped (P5-36 SPEC.md Q8), and a caller
 * that needs different facts passes a different object.
 */
const INDEXES = new WeakMap<FreshnessFacts, Omit<Judgement, 'now' | 'asOf'>>();

function judgementOf(ctx: FreshnessContext, asOf: AsOf): Judgement {
  assertContextMatchesAsOf(ctx, asOf);
  const f = ctx.facts;
  let index = INDEXES.get(f);
  if (index === undefined) {
    index = {
      lastSchedulerRun: f.lastSchedulerRun,
      accounts: byKey(f.accounts, (a) => a.accountId, 'account'),
      items: byKey(f.items, (i) => i.key, 'item'),
      cash: byKey(f.cashCounts, (c) => c.accountId, 'cash account'),
      valuations: byKey(f.valuations, (v) => v.accountId, 'valued account'),
      sightings: new Map([...byKey(f.overdraftSightings, (s) => s.accountId, 'open episode')].map(([k, s]) => [k, s.lastSeenAt])),
      projections: new Map([...byKey(f.overdraftProjections, (p) => p.accountId, 'open forecast')].map(([k, p]) => [k, p.projectedAt])),
      contributors: new Map([...byKey(f.contributors, (c) => c.categoryId, 'category')].map(([k, c]) => [k, c.accountIds])),
    };
    INDEXES.set(f, index);
  }
  return { ...index, now: ctx.now, asOf };
}

// ─── The per-kind input rules ──────────────────────────────────────────────────────────────────

/**
 * What dates one account, by its class. A Plaid-linked account rests on two inputs (its item's sync
 * and its item's feed); a countable wallet on its last count; a valuation-mode account on its latest
 * valuation date; a manual ledger account on nothing the database records, which is one undated
 * input. An account the read does not have at all is undated too, never fresh.
 *
 * `seen` deduplicates by record, so two accounts behind one item contribute that item's two inputs
 * once — an unknown feed is one undatable record, not one per account.
 */
function accountInputs(accountId: string, j: Judgement, seen: Set<string>): FreshnessInput[] {
  const a = j.accounts.get(accountId);
  if (a === undefined) return [undated('none')];
  switch (accountClassOf(a)) {
    case 'plaid-linked': {
      const key = a.itemKey as string;
      if (seen.has(`item:${key}`)) return [];
      seen.add(`item:${key}`);
      const item = j.items.get(key);
      return [syncInput(item, j.now), feedInput(item, j.now)];
    }
    case 'countable-cash':
      return [cashInput(j.cash.get(accountId), j.now)];
    case 'valuation':
      return [valuationInput(j.valuations.get(accountId), j.asOf)];
    case 'manual-ledger':
      return [undated('none')];
  }
}

/**
 * A budget finding rests on every account that contributed to its category this year. The budget
 * allocation itself is owner-authored configuration, not an observation, and is not an input. No
 * contributing account at all is the empty set: undated.
 */
function contributorInputs(categoryId: number, j: Judgement): FreshnessInput[] {
  const accounts = j.contributors.get(categoryId) ?? [];
  const seen = new Set<string>();
  return [...new Set(accounts)].flatMap((id) => accountInputs(id, j, seen));
}

/**
 * Drift is dated by the account's item: its sync and its feed. NOT by `DriftFinding.observedAt` —
 * `plaid_balance` valuation rows are a change log, so their newest date is when the balance last
 * CHANGED, and a stable balance would read as ancient (SPEC.md F6). An account with no item record
 * is undated.
 */
function driftInputs(accountId: string, j: Judgement): FreshnessInput[] {
  const a = j.accounts.get(accountId);
  if (a === undefined || a.itemKey === null) return [undated('sync')];
  const item = j.items.get(a.itemKey);
  return [syncInput(item, j.now), feedInput(item, j.now)];
}

/**
 * The input rule for every kind, keyed by kind and checked with `satisfies` against `FindingKind`, so
 * a kind added to the contract without a dating rule fails `tsc` rather than defaulting to anything.
 *
 * Each rule takes only the producer fields it needs, typed structurally, so this module imports no
 * producer type from outside `lib/domain`.
 */
export const FRESHNESS_RULES = {
  'budget-breach': (f: { categoryId: number }, j: Judgement) => contributorInputs(f.categoryId, j),
  'budget-underspend': (f: { categoryId: number }, j: Judgement) => contributorInputs(f.categoryId, j),
  'balance-drift': (f: { accountId: string }, j: Judgement) => driftInputs(f.accountId, j),
  // Self-contained: the finding's own last success. Its institution name is not a key, and the app's
  // own sync of the same item is the `sync-stale` finding's input, not this one's.
  'feed-degraded': (f: { lastSuccessfulUpdate: Date | null }, j: Judgement) =>
    [instantInput('feed', f.lastSuccessfulUpdate, j.now, feedStale)],
  // By the producer's `key`, never by its `bank` text, which is `Unknown` for every item with no bank.
  'sync-stale': (h: { key: string }, j: Judgement) => [syncInput(j.items.get(h.key), j.now)],
  'job-overdue': (_h: object, j: Judgement) => [jobInput(j.lastSchedulerRun, j.now)],
  'cash-uncounted': (f: { accountId: string }, j: Judgement) => [cashInput(j.cash.get(f.accountId), j.now)],
  'valuation-stale': (f: { id: string }, j: Judgement) => [valuationInput(j.valuations.get(f.id), j.asOf)],
  'overdraft-open': (f: { accountId: string }, j: Judgement) =>
    [overdraftInput('overdraft-sighting', j.sightings.get(f.accountId), j.now)],
  'overdraft-forecast': (f: { accountId: string }, j: Judgement) =>
    [overdraftInput('overdraft-projection', j.projections.get(f.accountId), j.now)],
} as const satisfies { [K in FindingKind]: (producer: never, j: Judgement) => FreshnessInput[] };

/** The inputs one producer finding of `kind` rests on, judged against the context. */
export function freshnessInputs<K extends FindingKind>(
  kind: K,
  producer: Parameters<(typeof FRESHNESS_RULES)[K]>[0],
  asOf: AsOf,
  ctx: FreshnessContext,
): FreshnessInput[] {
  const rule = FRESHNESS_RULES[kind] as (p: typeof producer, j: Judgement) => FreshnessInput[];
  return rule(producer, judgementOf(ctx, asOf));
}

/**
 * The freshness of one producer finding of `kind`. With no context, `undated` with one undated input
 * (never fresh by default); with one, the kind's inputs aggregated. Throws `RangeError` when the
 * context's instant is not the as-of date.
 */
export function freshnessOf<K extends FindingKind>(
  kind: K,
  producer: Parameters<(typeof FRESHNESS_RULES)[K]>[0],
  asOf: AsOf,
  ctx: FreshnessContext | undefined,
): Freshness {
  if (ctx === undefined) return unsuppliedFreshness();
  return aggregateFreshness(freshnessInputs(kind, producer, asOf, ctx));
}
