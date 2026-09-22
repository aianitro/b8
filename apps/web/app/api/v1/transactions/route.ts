import { NextRequest } from 'next/server';
import { randomUUID } from 'crypto';
import db from '@/lib/db';
import type { ApiResponse } from '@b8/contracts/types';
import { createLogger } from '@/lib/logger';
import {
  CategoryTransactionsDataSchema,
  type CategoryTransactionsData,
} from '@b8/contracts/categoryTransactions';

const log = createLogger('transactions');

export const dynamic = 'force-dynamic';

/**
 * One category's month, transaction by transaction — what a heatmap tile drills into.
 *
 * THE FOURTH ENDPOINT A SECOND CLIENT HAS HAD TO CREATE. This file has had a POST since the day a
 * transaction needed re-creating by hand, and no GET at all: the web reads its transactions through
 * a server component, so the read side existed as a page rather than as an interface. Accounts,
 * properties and the budget grid went the same way, and each gap stayed invisible until something
 * other than the web asked for the data.
 *
 * ─── The predicates are the tile's, deliberately, and that is the whole job ───────────────────
 *
 * A reader taps a figure and expects the rows underneath to add up to it. That only holds if this
 * query filters exactly as `monthOutlookRead.ts` does when it computes the figure:
 *
 *   * `a.track_transactions = TRUE` — an untracked account's rows are in the ledger and count
 *     toward no budget.
 *   * `t.hidden = FALSE` — hiding a row says "do not count this", and the tile does not count it.
 *   * `t.mapped_category = $1` — exact, not `ILIKE`: categories are chosen from a list, and a fuzzy
 *     match here would silently fold two of them together.
 *
 * Copying those by resemblance is how they drift; they are stated here with the reason, and the
 * reason is that a drill-down which disagrees with the figure that opened it is worse than none.
 *
 * ─── Bounded at TODAY, not at the end of the month ────────────────────────────────────────────
 *
 * The tile shows the month TO DATE — `monthOutlookRead` runs to the as-of day — so this does too,
 * via `LEAST(month end, CURRENT_DATE)`. For any past month that is the whole month and the clause
 * costs nothing; for the current one it is the difference between the rows adding up and not. A
 * post-dated row is the case it actually excludes, and the tile excludes it too.
 */
export async function GET(req: NextRequest) {
  const params = req.nextUrl.searchParams;
  const category = params.get('category')?.trim();
  const monthRaw = params.get('month');

  if (!category) {
    return Response.json(
      { success: false, error: { code: 'INVALID_INPUT', message: 'category is required' } } satisfies ApiResponse<never>,
      { status: 400 }
    );
  }

  // Parsed strictly. `parseInt('13months')` is 13 and `Number('')` is 0, and both would reach the
  // query as a month that cannot exist — a 400 is the honest answer to a request nobody meant.
  const month = monthRaw !== null && /^\d{1,2}$/.test(monthRaw) ? Number(monthRaw) : NaN;
  if (!Number.isInteger(month) || month < 1 || month > 12) {
    return Response.json(
      { success: false, error: { code: 'INVALID_INPUT', message: 'month must be an integer from 1 to 12' } } satisfies ApiResponse<never>,
      { status: 400 }
    );
  }

  try {
    const year = new Date().getFullYear();
    const args = [category, year, month];

    const [rows, totals] = await Promise.all([
      db.query<{ id: number; date: string; label: string; amount: string; account: string; watched: boolean; note: string | null }>(`
        SELECT t.id,
               t.date::text AS date,
               COALESCE(NULLIF(t.merchant_name, ''), NULLIF(t.name, ''), 'Unnamed') AS label,
               t.amount::text AS amount,
               a.name AS account,
               (t.watched_at IS NOT NULL) AS watched,
               t.watch_note AS note
          FROM transactions t
          JOIN accounts a ON a.id = t.account_id AND a.track_transactions = TRUE
         WHERE t.mapped_category = $1
           AND t.hidden = FALSE
           AND t.date >= make_date($2::int, $3::int, 1)
           AND t.date <= LEAST((make_date($2::int, $3::int, 1) + INTERVAL '1 month - 1 day')::date, CURRENT_DATE)
         ORDER BY t.date DESC, t.id DESC
      `, args),

      // Counted and summed over the SAME set rather than over the rows above. They are identical
      // today because nothing is limited; they stop being identical the moment a limit is added,
      // and a total a reader can add up and find wrong is worse than no total at all.
      db.query<{ spent: string; count: string }>(`
        SELECT COALESCE(SUM(t.amount), 0)::numeric(14,2)::text AS spent, COUNT(*)::text AS count
          FROM transactions t
          JOIN accounts a ON a.id = t.account_id AND a.track_transactions = TRUE
         WHERE t.mapped_category = $1
           AND t.hidden = FALSE
           AND t.date >= make_date($2::int, $3::int, 1)
           AND t.date <= LEAST((make_date($2::int, $3::int, 1) + INTERVAL '1 month - 1 day')::date, CURRENT_DATE)
      `, args),
    ]);

    const data: CategoryTransactionsData = {
      category,
      month,
      year,
      rows: rows.rows.map((r) => ({
        id: r.id,
        date: r.date,
        label: r.label,
        // `::text` then through as a string: `pg` hands NUMERIC back as a string already, and
        // `db.query<T>`'s type parameter is an unchecked cast that would happily claim otherwise.
        amount: r.amount,
        account: r.account,
        // A BOOLEAN, not the timestamp. The phone's editor needs to know whether the flag is set;
        // when it was set is the digest's question, and it is answered from `watchlist` where the
        // age is the column that matters.
        watched: r.watched,
        note: r.note,
      })),
      spent: totals.rows[0]?.spent ?? '0.00',
      count: Number(totals.rows[0]?.count ?? 0),
    };

    // Validated on the way out, like the budget grid: a payload that does not match the contract is
    // this handler's bug, and it should fail here rather than in the client's `parse`.
    return Response.json(
      { success: true, data: CategoryTransactionsDataSchema.parse(data) } satisfies ApiResponse<CategoryTransactionsData>
    );
  } catch (err) {
    log.error('GET failed', { error: err instanceof Error ? err.message : String(err) });
    return Response.json(
      { success: false, error: { code: 'SERVER_ERROR', message: 'Failed to read transactions' } } satisfies ApiResponse<never>,
      { status: 500 }
    );
  }
}

// Manually create a transaction — used e.g. to recreate one that Plaid dropped/deduped away,
// or any other hand-entered entry. Gets a synthetic plaid_transaction_id (never collides with
// a real Plaid one) so it behaves like any other row everywhere else in the app.
export async function POST(req: NextRequest) {
  try {
    const { account_id, date, amount, name, merchant_name, mapped_category } = await req.json() as {
      account_id: string;
      date: string;
      amount: number;
      name?: string | null;
      merchant_name?: string | null;
      mapped_category?: string | null;
    };

    if (!account_id || !date || typeof amount !== 'number' || !Number.isFinite(amount)) {
      return Response.json(
        { success: false, error: { code: 'BAD_REQUEST', message: 'account_id, date, and amount are required' } } satisfies ApiResponse<null>,
        { status: 400 }
      );
    }

    const id = `manual_${randomUUID()}`;
    const result = await db.query<{ id: number }>(
      `INSERT INTO transactions (plaid_transaction_id, account_id, date, amount, name, merchant_name, mapped_category)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       RETURNING id`,
      [id, account_id, date, amount, name?.trim() || null, merchant_name?.trim() || null, mapped_category || null]
    );

    return Response.json({ success: true, data: { id: result.rows[0].id } } satisfies ApiResponse<{ id: number }>, { status: 201 });
  } catch (err) {
    log.error('POST failed', { error: err instanceof Error ? err.message : String(err) });
    return Response.json(
      { success: false, error: { code: 'SERVER_ERROR', message: 'Failed to create transaction' } } satisfies ApiResponse<null>,
      { status: 500 }
    );
  }
}
