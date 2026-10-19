import db from './db';
import { visibleTransactions } from './giftReadPath';
import { findRecurringCharges, type RecurringCharge } from './recurringHeuristic';

// I/O shell over the recurrence heuristic in recurringHeuristic.ts — pulls the candidate
// charges out of Postgres and hands them to the pure matcher.
//
// NO GIFT ROW, FOR ANY VIEWER (P7-41b). The upcoming-charges list is grouped by merchant text and
// shown to whoever opens it; a gift's real merchant must not appear there as a "subscription" to the
// person it is for. Rows held by an unrevealed gift are left out for everyone, through
// `visibleTransactions(null)` and its `gift_masked` flag.

export type { RecurringCharge } from './recurringHeuristic';

const LOOKBACK_DAYS = 150;

export async function detectUpcomingRecurring(limit = 7): Promise<RecurringCharge[]> {
  const result = await db.query<{ merchant: string; date: string; amount: string }>(`
    SELECT COALESCE(t.merchant_name, t.name) AS merchant, t.date::text AS date, t.amount::text AS amount
    FROM ${visibleTransactions(null)} t
    JOIN accounts a ON a.id = t.account_id AND a.track_transactions = TRUE
    WHERE t.hidden = FALSE
      AND NOT t.gift_masked
      AND t.amount > 0
      AND t.date >= CURRENT_DATE - INTERVAL '${LOOKBACK_DAYS} days'
      AND COALESCE(t.merchant_name, t.name) IS NOT NULL
    ORDER BY COALESCE(t.merchant_name, t.name), t.date
  `);

  return findRecurringCharges(
    result.rows.map((r) => ({ merchant: r.merchant, date: r.date, amount: Number(r.amount) })),
    new Date(),
    limit
  );
}
