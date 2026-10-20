import db from './db';
import { asOfFromDate } from './domain/monthOutlook';
import type {
  AccountFact,
  CashCountFact,
  ContributorFact,
  FreshnessFacts,
  ItemFact,
  OverdraftProjectionFact,
  OverdraftSightingFact,
  ValuationFact,
} from './domain/findingsFreshness';

// The facts every finding's freshness is judged from (ROADMAP.md §5 Phase 5 step 35): when each
// input a finding rests on was last believed true. The judging is `lib/domain/findingsFreshness.ts`;
// this module only reads.
//
// ─── Why the queries are duplicated rather than shared ────────────────────────────────────────
//
// The item grouping repeats `SyncHealthCard`'s and `loadFeedHealth`'s, the valuation date repeats
// `loadValuationFindings`'s expression, the job row repeats `loadJobHealth`'s filter, and the open
// overdraft rows repeat `loadOverdrafts`/`loadForecasts`. SPEC.md forbids refactoring those loaders in
// this step (no card, no route, no existing reader changes), so the duplication is deliberate and
// recorded. What keeps it honest is the integration suite: `scripts/findings-freshness-read.test.ts`
// (R1–R3, R9) runs the real loaders over the same seeded rows and fails if the two disagree.
//
// ─── No clock, no viewer, no row text ─────────────────────────────────────────────────────────
//
// NO CLOCK. `now` is the caller's, and it is used for one thing: the as-of year the contributing
// accounts are read for, derived by the same `asOfFromDate` the assembler checks the context against.
// No query reads Postgres's clock; whether an input is stale is decided in the pure module, against
// that same `now`, so the same rows read at two instants in one year are the same facts (R6).
//
// NO VIEWER, BY CONSTRUCTION. Gift masking (P7-41b) hides a held gift's text — its merchant, its
// name, its note and the rest of the protected columns — from everybody but the giver. It never
// changes which account a row is on, its date, its category or whether it is hidden, because every
// figure in the app must be the same sum for every viewer. This module selects only those kept
// columns of `transactions`, and returns only dates, ids and counts, so there is nothing a viewer
// could change and no reason to ask who is looking. `findingsWiring.test.ts` (T35-W3) checks the
// SQL against `TRANSACTION_COLUMN_MASK`, and the module does not import the gift read path.
//
// NO CREDENTIAL. Items are grouped ON `access_token` and keyed by their smallest account id, exactly
// as `SyncHealthCard` keys them; the token itself is never selected.

/** Every account's class markers and item key. The item key is the smallest id behind its token. */
const ACCOUNTS_SQL = `
  SELECT id AS account_id,
         CASE WHEN access_token IS NOT NULL THEN MIN(id) OVER (PARTITION BY access_token) END AS item_key,
         countable,
         valuation_mode
    FROM accounts
   ORDER BY id`;

/** One row per Plaid item: this app's last successful sync, and Plaid's own refresh record. */
const ITEMS_SQL = `
  SELECT MIN(id)                          AS key,
         MAX(last_synced_at)              AS last_synced_at,
         MAX(item_last_successful_update) AS last_successful_update,
         MAX(item_last_failed_update)     AS last_failed_update
    FROM accounts
   WHERE access_token IS NOT NULL
   GROUP BY access_token
   ORDER BY key`;

/** Each countable account's latest count, or null when it has never been counted. */
const CASH_SQL = `
  SELECT a.id AS account_id,
         (SELECT MAX(c.counted_at) FROM cash_counts c WHERE c.account_id = a.id) AS last_counted_at
    FROM accounts a
   WHERE a.countable = TRUE
   ORDER BY a.id`;

/** Each hand-valued account's latest valuation DATE, in `loadValuationFindings`' own expression. */
const VALUATIONS_SQL = `
  SELECT a.id AS account_id,
         (SELECT MAX(v.valued_at)::date::text FROM account_valuations v WHERE v.account_id = a.id) AS latest_valued_on
    FROM accounts a
   WHERE a.valuation_mode = 'valuation' AND a.access_token IS NULL
   ORDER BY a.id`;

/** The latest scheduled run. Manual syncs are the owner doing the job's work and never count. */
const JOB_SQL = `
  SELECT ran_at FROM sync_log WHERE trigger = 'scheduler' ORDER BY ran_at DESC LIMIT 1`;

/** Open overdraft episodes only: a closed one is not an input to anything. */
const SIGHTINGS_SQL = `
  SELECT account_id, last_seen_at FROM overdraft_episodes WHERE closed_at IS NULL ORDER BY account_id`;

/** Open overdraft forecasts only. */
const PROJECTIONS_SQL = `
  SELECT account_id, projected_at FROM overdraft_forecasts WHERE closed_at IS NULL ORDER BY account_id`;

/** The operational categories, by id and the name `transactions.mapped_category` matches. */
const CATEGORIES_SQL = `
  SELECT id, name FROM budget_categories WHERE landscape = 'operational' ORDER BY id`;

/**
 * Which accounts contributed to which operational category in the year: one row per pair, by
 * EXISTS, so an account with many qualifying rows is one contributor and never one per row. The
 * filters are `readBudgetVsActual`'s: the row is not hidden, its account is tracked, its date is in
 * the year. The category names are passed in from the operational categories alone, so a capital
 * category of the same name contributes nothing of its own. Only kept columns of `transactions` are
 * read here (account, category, hidden, date).
 */
const CONTRIBUTORS_SQL = `
  SELECT c.category, a.id AS account_id
    FROM unnest($2::text[]) AS c(category)
   CROSS JOIN accounts a
   WHERE a.track_transactions = TRUE
     AND EXISTS (SELECT 1
                   FROM transactions t
                  WHERE t.account_id = a.id
                    AND t.mapped_category = c.category
                    AND t.hidden = FALSE
                    AND EXTRACT(YEAR FROM t.date) = $1)
   ORDER BY c.category, a.id`;

/**
 * Every fact freshness needs, read for the instant `now`.
 *
 * Takes no viewer (see the header). `now` sets only the contributors' as-of year; it is not compared
 * with anything here.
 */
export async function loadFreshnessFacts(now: Date): Promise<FreshnessFacts> {
  const year = asOfFromDate(now).year;
  const [accounts, items, cash, valuations, job, sightings, projections, categories] = await Promise.all([
    db.query<{ account_id: string; item_key: string | null; countable: boolean; valuation_mode: string }>(ACCOUNTS_SQL),
    db.query<{ key: string; last_synced_at: Date | null; last_successful_update: Date | null; last_failed_update: Date | null }>(ITEMS_SQL),
    db.query<{ account_id: string; last_counted_at: Date | null }>(CASH_SQL),
    db.query<{ account_id: string; latest_valued_on: string | null }>(VALUATIONS_SQL),
    db.query<{ ran_at: Date }>(JOB_SQL),
    db.query<{ account_id: string; last_seen_at: Date }>(SIGHTINGS_SQL),
    db.query<{ account_id: string; projected_at: Date }>(PROJECTIONS_SQL),
    db.query<{ id: number; name: string }>(CATEGORIES_SQL),
  ]);

  // Names are the join key with `transactions.mapped_category` and are used only inside this
  // function; the facts carry the category id. Within one landscape a name is unique
  // (`UNIQUE(name, landscape)`), so the map is one-to-one.
  const idByName = new Map(categories.rows.map((r) => [r.name, r.id]));
  const pairs = await db.query<{ category: string; account_id: string }>(CONTRIBUTORS_SQL, [year, [...idByName.keys()]]);
  const contributorsById = new Map<number, string[]>();
  for (const r of pairs.rows) {
    const id = idByName.get(r.category) as number;
    contributorsById.set(id, [...(contributorsById.get(id) ?? []), r.account_id]);
  }

  return {
    year,
    accounts: accounts.rows.map((r): AccountFact => ({
      accountId: r.account_id,
      itemKey: r.item_key,
      countable: r.countable,
      // Narrowed at the boundary rather than cast: the column carries a CHECK, but a value from the
      // database is a string as far as this process knows.
      valuationMode: r.valuation_mode === 'valuation' ? 'valuation' : 'ledger',
    })),
    items: items.rows.map((r): ItemFact => ({
      key: r.key,
      lastSyncedAt: r.last_synced_at,
      lastSuccessfulUpdate: r.last_successful_update,
      lastFailedUpdate: r.last_failed_update,
    })),
    cashCounts: cash.rows.map((r): CashCountFact => ({ accountId: r.account_id, lastCountedAt: r.last_counted_at })),
    valuations: valuations.rows.map((r): ValuationFact => ({ accountId: r.account_id, latestValuedOn: r.latest_valued_on })),
    lastSchedulerRun: job.rows[0]?.ran_at ?? null,
    overdraftSightings: sightings.rows.map((r): OverdraftSightingFact => ({ accountId: r.account_id, lastSeenAt: r.last_seen_at })),
    overdraftProjections: projections.rows.map((r): OverdraftProjectionFact => ({ accountId: r.account_id, projectedAt: r.projected_at })),
    contributors: [...contributorsById].map(([categoryId, accountIds]): ContributorFact => ({ categoryId, accountIds })),
  };
}
