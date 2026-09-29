/**
 * Recording a cash count, and the adjustment it implies, as one indivisible act.
 *
 * The I/O shell around `lib/domain/cashCount.ts`, same split the rest of the app uses: the arithmetic
 * and the sign convention are pure and tested there; what is here is the database work.
 *
 * ─── WHY ONE TRANSACTION, AND WHY IT IS NOT MERELY TIDY ───────────────────────────────────────
 *
 * A count writes two rows that only mean anything together: the adjustment that moves the wallet to
 * the counted figure, and the `cash_counts` record saying a count happened and what it found. Half of
 * that pair is worse than neither.
 *
 * Adjustment without the count record: the wallet reads correctly and the app believes it has never
 * been counted, so it nags about staleness that was just resolved — and the adjustment becomes an
 * unexplained transaction nobody can trace to a decision.
 *
 * Count record without the adjustment: the app reports the wallet as freshly counted while its
 * balance is still the stale figure the count just disproved. That is the worse half, because it is
 * silent: a confidently wrong balance wearing a fresh timestamp.
 */
import { randomUUID } from 'node:crypto';
import db from '@/lib/db';
import { reconcileCashCount, type CashCountOutcome } from '@/lib/domain/cashCount';

export interface RecordCountArgs {
  accountId: string;
  /** What was actually in the wallet. */
  counted: number;
  /**
   * What to file the adjustment as, or `null` to leave it unfiled.
   *
   * Unfiled is a first-class answer, not a fallback. Requiring itemisation at count time is how
   * counting stops happening, and an uncounted wallet is worse than an unitemised lump — so an
   * adjustment with no category lands in the uncategorised bucket, where the coverage bound already
   * reports how much of the month the headline could not see. The money is visible either way; the
   * only question is whether it is attributed.
   */
  mappedCategory: string | null;
}

export type RecordCountResult =
  | { ok: true; outcome: CashCountOutcome; adjustmentTransactionId: number | null }
  | { ok: false; code: 'NOT_FOUND' | 'NOT_A_LEDGER_ACCOUNT' | 'INVALID'; message: string };

/**
 * The ledger balance of an account: money in minus money out.
 *
 * Spelled the same way as `app/balances/page.tsx` rather than `-SUM(amount)`, which is algebraically
 * identical but reads as a sign trick. If one of them ever changes, the other should be found by
 * searching for this shape.
 */
const BALANCE_SQL = `
  SELECT COALESCE(
           COALESCE(ABS(SUM(amount) FILTER (WHERE amount < 0)), 0)
         - COALESCE(SUM(amount) FILTER (WHERE amount > 0), 0), 0)::float8 AS balance
    FROM transactions WHERE account_id = $1`;

export async function recordCashCount(args: RecordCountArgs): Promise<RecordCountResult> {
  if (!Number.isFinite(args.counted) || args.counted < 0) {
    return { ok: false, code: 'INVALID', message: 'counted must be a number and cannot be negative' };
  }

  const client = await db.connect();
  try {
    await client.query('BEGIN');

    // `FOR UPDATE` on the account row, not on the transactions: two counts of the same wallet
    // arriving together would otherwise both read the same balance and both write an adjustment for
    // the same gap, closing it twice. Locking the account serialises them, and the second one then
    // reads the balance the first produced and correctly finds nothing to adjust.
    const account = await client.query<{ valuation_mode: string }>(
      'SELECT valuation_mode FROM accounts WHERE id = $1 FOR UPDATE',
      [args.accountId]
    );
    if (account.rows.length === 0) {
      await client.query('ROLLBACK');
      return { ok: false, code: 'NOT_FOUND', message: 'No such account.' };
    }
    // A valuation-mode account's balance IS its latest valuation; counting one would write an
    // adjustment against a number nothing derives from transactions, so the row would land in the
    // ledger and change nothing on screen.
    if (account.rows[0].valuation_mode !== 'ledger') {
      await client.query('ROLLBACK');
      return {
        ok: false,
        code: 'NOT_A_LEDGER_ACCOUNT',
        message: 'Counting applies to ledger accounts; this one is valued, not counted.',
      };
    }

    const balance = await client.query<{ balance: number }>(BALANCE_SQL, [args.accountId]);
    const outcome = reconcileCashCount(balance.rows[0]?.balance ?? 0, args.counted);

    let adjustmentTransactionId: number | null = null;
    if (outcome.adjustment) {
      const name = outcome.adjustment.direction === 'spent'
        ? 'Cash spent (found by counting)'
        : 'Cash received (found by counting)';
      const inserted = await client.query<{ id: number }>(
        `INSERT INTO transactions (plaid_transaction_id, account_id, date, amount, name, mapped_category)
         VALUES ($1, $2, CURRENT_DATE, $3, $4, $5) RETURNING id`,
        [`manual_${randomUUID()}`, args.accountId, outcome.adjustment.amount, name, args.mappedCategory]
      );
      adjustmentTransactionId = inserted.rows[0].id;
    }

    // Written whether or not there was an adjustment. The count that finds nothing is the one this
    // table exists for: without it, a wallet nobody spends from reports as never counted forever.
    await client.query(
      `INSERT INTO cash_counts (account_id, counted, expected, adjustment_transaction_id)
       VALUES ($1, $2, $3, $4)`,
      [args.accountId, outcome.counted, outcome.expected, adjustmentTransactionId]
    );

    await client.query('COMMIT');
    return { ok: true, outcome, adjustmentTransactionId };
  } catch (err) {
    await client.query('ROLLBACK').catch(() => undefined);
    throw err;
  } finally {
    client.release();
  }
}

export interface WalletStatus {
  accountId: string;
  name: string;
  balance: number;
  lastCountedAt: string | null;
}

/** Every ledger account that has ever been counted, plus the manual ones that never have. */
export async function walletStatuses(): Promise<WalletStatus[]> {
  const { rows } = await db.query<WalletStatus>(`
    SELECT a.id AS "accountId",
           a.name,
           COALESCE(
             COALESCE(ABS(SUM(t.amount) FILTER (WHERE t.amount < 0)), 0)
           - COALESCE(SUM(t.amount) FILTER (WHERE t.amount > 0), 0), 0)::float8 AS balance,
           (SELECT max(c.counted_at) FROM cash_counts c WHERE c.account_id = a.id) AS "lastCountedAt"
      FROM accounts a
      LEFT JOIN transactions t ON t.account_id = a.id
     WHERE a.valuation_mode = 'ledger' AND a.access_token IS NULL
     GROUP BY a.id, a.name
     ORDER BY a.name
  `);
  return rows;
}
