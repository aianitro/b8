import db from './db';
import { createLogger } from './logger';
import { checkMove, closedMonths, leftover, type YearMonth } from './domain/unspent';

const log = createLogger('unspent');

/**
 * Unspent budget — the I/O. Rules in lib/domain/unspent.ts; tables and the effective-plan function
 * in migrations/1791900000000_budget-unspent.sql.
 *
 * ─── Which readers see a carry, and which must not ────────────────────────────────────────────
 *
 * A carry raises ONE MONTH's plan, so every reader that grades or projects a month joins
 * `effective_budget(year)`: the month outlook (tiles, pacing), the year-end projection, the budget
 * grid's month cells, a drilldown's month, a category's own page, and the budget page's
 * expected-so-far. The ANNUAL "budget minus spent" figures do not — "Budget remaining", the yearly
 * budget-vs-actual list — because a closed month's leftover is already counted there as remaining,
 * and adding the carry as well would count the same dollars twice.
 */

/** The spending categories a bucket can belong to or a carry can land in. */
const SPENDING = `bc.is_income = FALSE AND bc.exclude_from_budget = FALSE`;

/**
 * Record each closable month's close, once: a row per spending category that had a plan, holding
 * its leftover (zero when it spent its plan or more). Called by the daily job; resolves rather than
 * rejects.
 *
 * A MONTH IS CLOSED IN ONE PASS AND NEVER REVISITED. If any row exists for it, it is skipped whole:
 * re-running it later would close categories created since — whose year-less schedule gives them a
 * plan for that month — with a leftover they never had.
 */
export async function recordCloses(now: Date = new Date()): Promise<number> {
  try {
    const today = { year: now.getFullYear(), month: now.getMonth() + 1, day: now.getDate() };
    let written = 0;
    for (const ym of closedMonths(today)) {
      const done = await db.query('SELECT 1 FROM budget_unspent WHERE year = $1 AND month = $2 LIMIT 1', [ym.year, ym.month]);
      if (done.rows.length > 0) continue;

      // The month's plan from effective_budget() — carries into it count — rounded to cents before
      // the subtraction, so `amount` is exactly `planned − actual` of the stored figures. Actual is
      // the month outlook's: tracked accounts, not hidden, net of refunds, floored at zero.
      const rows = await db.query<{ id: number; planned: string; actual: string }>(`
        SELECT bc.id,
               ROUND(COALESCE(eb.monthly_amounts[$2], eb.annual_budget / 12), 2)::text AS planned,
               GREATEST(COALESCE((
                 SELECT SUM(t.amount) FROM transactions t
                   JOIN accounts a ON a.id = t.account_id AND a.track_transactions = TRUE
                  WHERE t.mapped_category = bc.name AND t.hidden = FALSE
                    AND EXTRACT(YEAR FROM t.date) = $1 AND EXTRACT(MONTH FROM t.date) = $2), 0), 0)::text AS actual
          FROM budget_categories bc
          JOIN effective_budget($1) eb ON eb.category_id = bc.id
         WHERE ${SPENDING}
      `, [ym.year, ym.month]);

      for (const r of rows.rows) {
        const planned = Number(r.planned);
        if (!(planned > 0)) continue;
        const actual = Number(r.actual);
        const res = await db.query(
          `INSERT INTO budget_unspent (category_id, year, month, amount, planned, actual)
           VALUES ($1, $2, $3, $4, $5, $6) ON CONFLICT (category_id, year, month) DO NOTHING`,
          [r.id, ym.year, ym.month, leftover(planned, actual), planned, actual]
        );
        written += res.rowCount ?? 0;
      }
      log.info('closed month', { year: ym.year, month: ym.month, categories: written });
    }
    return written;
  } catch (err) {
    log.error('recording closes failed', { error: err instanceof Error ? err.message : String(err) });
    return 0;
  }
}

export interface UnspentBucket {
  categoryId: number;
  category: string;
  landscape: string;
  /** What is still to allocate. */
  balance: number;
  /** Each closed month's contribution, newest first; zero months included. */
  closes: { year: number; month: number; amount: number; planned: number; actual: number }[];
  /** Each allocation, newest first. */
  moves: { id: number; amount: number; action: 'carry' | 'release'; toCategory: string | null; toYear: number | null; toMonth: number | null; at: string }[];
}

/** Every category that has ever had a leftover, with its balance and history. */
export async function loadBuckets(): Promise<UnspentBucket[]> {
  const [closes, moves] = await Promise.all([
    db.query<{ category_id: number; name: string; landscape: string; year: number; month: number; amount: string; planned: string; actual: string }>(`
      SELECT u.category_id, bc.name, bc.landscape, u.year, u.month, u.amount::text, u.planned::text, u.actual::text
        FROM budget_unspent u JOIN budget_categories bc ON bc.id = u.category_id
       ORDER BY u.year DESC, u.month DESC`),
    db.query<{ id: number; category_id: number; amount: string; action: 'carry' | 'release'; to_name: string | null; to_year: number | null; to_month: number | null; at: string }>(`
      SELECT m.id, m.category_id, m.amount::text, m.action, tc.name AS to_name, m.to_year, m.to_month, m.created_at::text AS at
        FROM budget_unspent_moves m LEFT JOIN budget_categories tc ON tc.id = m.to_category_id
       ORDER BY m.created_at DESC`),
  ]);

  const buckets = new Map<number, UnspentBucket>();
  for (const c of closes.rows) {
    const b = buckets.get(c.category_id) ?? { categoryId: c.category_id, category: c.name, landscape: c.landscape, balance: 0, closes: [], moves: [] };
    b.closes.push({ year: c.year, month: c.month, amount: Number(c.amount), planned: Number(c.planned), actual: Number(c.actual) });
    b.balance += Number(c.amount);
    buckets.set(c.category_id, b);
  }
  for (const m of moves.rows) {
    const b = buckets.get(m.category_id);
    if (!b) continue;
    b.moves.push({ id: m.id, amount: Number(m.amount), action: m.action, toCategory: m.to_name, toYear: m.to_year, toMonth: m.to_month, at: m.at });
    b.balance -= Number(m.amount);
  }
  return [...buckets.values()]
    .map((b) => ({ ...b, balance: Math.round(b.balance * 100) / 100 }))
    .filter((b) => b.closes.some((c) => c.amount > 0));
}

export type AllocateResult = { ok: true } | { ok: false; status: number; message: string };

/**
 * Carry part of a bucket into a month, or release it to savings.
 *
 * Serialised per bucket under an advisory lock, inside one transaction, so two allocations made at
 * the same moment cannot each see enough balance and overdraw it together.
 */
export async function allocate(input: {
  categoryId: number;
  amount: number;
  action: 'carry' | 'release';
  toCategoryId?: number;
  to?: YearMonth;
}, now: Date = new Date()): Promise<AllocateResult> {
  const client = await db.connect();
  try {
    await client.query('BEGIN');
    await client.query('SELECT pg_advisory_xact_lock(hashtext($1))', [`unspent:${input.categoryId}`]);

    const bal = await client.query<{ balance: string }>(`
      SELECT (COALESCE((SELECT SUM(amount) FROM budget_unspent WHERE category_id = $1), 0)
            - COALESCE((SELECT SUM(amount) FROM budget_unspent_moves WHERE category_id = $1), 0))::text AS balance`,
      [input.categoryId]);
    const today = { year: now.getFullYear(), month: now.getMonth() + 1 };
    const check = checkMove({ amount: input.amount, balance: Number(bal.rows[0].balance), action: input.action, to: input.to, today });
    if (!check.ok) { await client.query('ROLLBACK'); return { ok: false, status: 400, message: check.reason }; }

    if (input.action === 'carry') {
      const dest = await client.query(`SELECT 1 FROM budget_categories bc WHERE bc.id = $1 AND ${SPENDING}`, [input.toCategoryId]);
      if (dest.rows.length === 0) { await client.query('ROLLBACK'); return { ok: false, status: 400, message: 'Carry into a spending category.' }; }
    }

    await client.query(
      `INSERT INTO budget_unspent_moves (category_id, amount, action, to_category_id, to_year, to_month)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [input.categoryId, Math.round(input.amount * 100) / 100, input.action,
       input.action === 'carry' ? input.toCategoryId : null,
       input.action === 'carry' ? input.to!.year : null,
       input.action === 'carry' ? input.to!.month : null]
    );
    await client.query('COMMIT');
    return { ok: true };
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}
