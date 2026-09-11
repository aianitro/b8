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
  }>(`
    SELECT COALESCE(MIN(bank), 'Unknown institution') AS institution,
           COUNT(*)::text                             AS account_count,
           MAX(item_last_successful_update)           AS last_successful_update,
           MAX(item_last_failed_update)               AS last_failed_update
      FROM accounts
     WHERE access_token IS NOT NULL
     GROUP BY access_token
  `);

  const observations: FeedObservation[] = rows.map((r) => ({
    institution: r.institution,
    accountCount: Number(r.account_count),
    lastSuccessfulUpdate: r.last_successful_update,
    lastFailedUpdate: r.last_failed_update,
  }));
  return feedFindings(observations, now);
}
