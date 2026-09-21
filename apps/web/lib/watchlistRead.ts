import db from './db';

/**
 * What the owner has flagged to come back to, read once and shared.
 *
 * The digest and the dashboard both show this list, and they read it through here rather than each
 * writing the query. Two copies would drift on the parts that are easy to get subtly different and
 * impossible to notice: the ordering, the day arithmetic, and whether hidden rows are included.
 * This repo has already watched a duplicated definition produce two answers for one number.
 */

export interface WatchedTransaction {
  id: number;
  /** ISO `YYYY-MM-DD` of the transaction, not of when it was flagged. */
  date: string;
  /** Merchant, falling back to the feed's raw name. Never null. */
  label: string;
  /** Signed, on the app's convention: POSITIVE is money out. */
  amount: number;
  /** The budget category, or null if it has none. */
  category: string | null;
  /** The owner's reason, or null if they flagged it without writing one. */
  note: string | null;
  /** Whole days since it was flagged. 0 means today. */
  daysOpen: number;
}

interface Row {
  id: number;
  date: string;
  label: string;
  amount: string;
  category: string | null;
  watch_note: string | null;
  days_open: string;
}

/**
 * Every flagged transaction, oldest flag first.
 *
 * NOT SCOPED TO A MONTH, unlike most reads in this app. A return pending since June is the entry
 * that most needs chasing, and a month-scoped list would drop it on the first of July — exactly
 * when it stopped being recent enough to remember unaided.
 *
 * Oldest first is the partial index's own order and the order that puts the forgotten thing at the
 * top. The entry flagged an hour ago needs no reminding.
 *
 * HIDDEN ROWS ARE INCLUDED, and that is not an oversight. Hiding a transaction says "do not count
 * this"; watching one says "I am not finished with this". Both are true of a charge excluded from
 * the budget while its refund is chased, which is precisely the case the flag exists for.
 */
export async function loadWatchlist(): Promise<WatchedTransaction[]> {
  const { rows } = await db.query<Row>(`
    SELECT t.id,
           t.date::text AS date,
           COALESCE(NULLIF(t.merchant_name, ''), NULLIF(t.name, ''), 'Unnamed') AS label,
           t.amount::text,
           t.mapped_category AS category,
           t.watch_note,
           -- Whole days, computed by POSTGRES against ITS clock. In JS this would be a second
           -- calendar and a subtraction across a DST boundary; here it is one clock, the same one
           -- that wrote watched_at.
           FLOOR(EXTRACT(EPOCH FROM (NOW() - t.watched_at)) / 86400)::text AS days_open
      FROM transactions t
      JOIN accounts a ON a.id = t.account_id AND a.track_transactions = TRUE
     WHERE t.watched_at IS NOT NULL
     ORDER BY t.watched_at ASC, t.id
  `);

  return rows.map((r) => {
    const amount = Number(r.amount);
    // `pg` hands a scalar NUMERIC back as a STRING while `db.query<T>` is an unchecked cast, so a
    // missed conversion here is a string that concatenates instead of adding, with no type error.
    if (!Number.isFinite(amount)) {
      throw new RangeError(`watchlistRead: amount is not a number: ${r.amount}`);
    }
    return {
      id: r.id,
      date: r.date,
      label: r.label,
      amount,
      category: r.category,
      note: r.watch_note,
      daysOpen: Math.max(0, Number(r.days_open)),
    };
  });
}
