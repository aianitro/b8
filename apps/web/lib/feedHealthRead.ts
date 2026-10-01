import db from './db';
import { feedFindings, type FeedFinding, type FeedObservation } from './domain/feedHealth';

/**
 * The I/O shell for `lib/domain/feedHealth.ts` — one row per Plaid item, from the freshness
 * columns `lib/sync.ts` writes.
 *
 * Grouped by `access_token` because an item is the unit Plaid refreshes and the unit that fails:
 * the ten Chase accounts went dark together and are one finding, not ten. The token is grouped ON
 * but never SELECTED — a credential has no business in a render tree, and the reader needs the
 * institution name, not the key.
 *
 * Manual accounts have no token and are excluded by the WHERE clause rather than by the domain's
 * `unknown` state, so they never reach a rule that would have to know what they are.
 */
export async function loadFeedHealth(now: Date = new Date()): Promise<FeedFinding[]> {
  const { rows } = await db.query<{
    institution: string; account_count: string;
    last_successful_update: Date | null; last_failed_update: Date | null;
    institution_status: string | null; institution_status_at: Date | null;
  }>(`
    SELECT COALESCE(MIN(bank), 'Unknown institution') AS institution,
           COUNT(*)::text                             AS account_count,
           MAX(item_last_successful_update)           AS last_successful_update,
           MAX(item_last_failed_update)               AS last_failed_update,
           -- MIN, not MAX: these are one item-level fact duplicated across the item's accounts, so
           -- every row in the group carries the same value and the aggregate is only here to satisfy
           -- the GROUP BY. MIN over identical values is that value; it is not choosing a winner.
           MIN(item_institution_status)               AS institution_status,
           MIN(item_institution_status_at)            AS institution_status_at
      FROM accounts
     WHERE access_token IS NOT NULL
     GROUP BY access_token
  `);

  const observations: FeedObservation[] = rows.map((r) => ({
    institution: r.institution,
    accountCount: Number(r.account_count),
    lastSuccessfulUpdate: r.last_successful_update,
    lastFailedUpdate: r.last_failed_update,
    // Narrowed at the boundary rather than cast. The column carries a CHECK, but a value arriving
    // from the database is a string as far as this process knows, and asserting it into the union
    // would turn a future schema change into a silent type lie here.
    institutionStatus:
      r.institution_status === 'HEALTHY' || r.institution_status === 'DEGRADED' || r.institution_status === 'DOWN'
        ? r.institution_status
        : null,
    institutionStatusAt: r.institution_status_at,
  }));
  return feedFindings(observations, now);
}
