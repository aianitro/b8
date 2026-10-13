// The year-end snapshot and the move read against it, on a scratch database. One fabricated spend
// category under a prefix; yesterday's snapshot is made from today's with that category's month
// lowered, so the only move is that category's spending. Removed afterwards.

import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import db from '@/lib/db';
import { loadYearEndMoves, writeYearEndSnapshot } from '@/lib/yearEndSnapshots';

const P = 'ye-moves-test';
const ACCOUNT = `${P}-acct`;
const CAT = `${P}-groceries`;

async function cleanup() {
  await db.query('DELETE FROM year_end_snapshots WHERE snapshot_date >= CURRENT_DATE - 40');
  await db.query('DELETE FROM transactions WHERE plaid_transaction_id LIKE $1', [`${P}-%`]);
  await db.query('DELETE FROM accounts WHERE id = $1', [ACCOUNT]);
  await db.query('DELETE FROM budget_categories WHERE name LIKE $1', [`${P}-%`]);
}

beforeEach(async () => {
  await cleanup();
  await db.query(`INSERT INTO accounts (id, name, type, landscape, track_transactions) VALUES ($1, 'Fabricated', 'depository', 'operational', TRUE)`, [ACCOUNT]);
  await db.query(`INSERT INTO budget_categories (name, annual_budget, landscape) VALUES ($1, 1200, 'operational')`, [CAT]);
  // This month: 150 spent against a plan of 100 — over, so every extra unit moves the year-end.
  await db.query(
    `INSERT INTO transactions (plaid_transaction_id, account_id, date, amount, name, mapped_category) VALUES ($1, $2, CURRENT_DATE, 150, 'Fabricated', $3)`,
    [`${P}-t1`, ACCOUNT, CAT]);
});

afterAll(async () => { await cleanup(); await db.end(); });

describe('year-end snapshot', () => {
  it('writes once a day, and names a category whose month moved since yesterday', async () => {
    expect(await writeYearEndSnapshot()).toBeGreaterThan(0);
    expect(await writeYearEndSnapshot()).toBe(0); // first write of the day wins

    // Yesterday = today's snapshot with this category's current month at 120 instead of 150.
    const month = Number((await db.query<{ m: number }>('SELECT EXTRACT(MONTH FROM CURRENT_DATE)::int AS m')).rows[0].m);
    await db.query(`
      INSERT INTO year_end_snapshots (snapshot_date, landscape, category_name, is_income, plan, actuals)
      SELECT CURRENT_DATE - 1, landscape, category_name, is_income, plan,
             CASE WHEN category_name = $1 THEN actuals[1:${month - 1}] || ARRAY[120::numeric] || actuals[${month + 1}:12] ELSE actuals END
        FROM year_end_snapshots WHERE snapshot_date = CURRENT_DATE`, [CAT]);

    const { sinceYesterday, streak } = await loadYearEndMoves('operational');
    const move = sinceYesterday!.move;
    // The overspend lies between yesterday's snapshot and this morning's: the streak restarts today.
    expect(streak).toMatchObject({ days: 0, sinceTracking: false, slippedToday: false });
    expect(move.categories.find((c) => c.name === CAT)?.spending).toBe(-30);
    // On the 1st, yesterday is last month and every category also moves by its month closing.
    if (new Date().getDate() !== 1) {
      expect(move).toMatchObject({ total: -30, spending: -30, budget: 0, past: 0, closed: 0 });
      expect(move.categories.map((c) => c.name)).toEqual([CAT]);
    }
  });

  it('is silent before any snapshot exists', async () => {
    expect(await loadYearEndMoves('operational')).toEqual({ sinceYesterday: null, sinceMonthStart: null, streak: null });
  });

  it('counts days held when spending has not moved since yesterday', async () => {
    await writeYearEndSnapshot();
    await db.query(`
      INSERT INTO year_end_snapshots (snapshot_date, landscape, category_name, is_income, plan, actuals)
      SELECT CURRENT_DATE - 3, landscape, category_name, is_income, plan, actuals
        FROM year_end_snapshots WHERE snapshot_date = CURRENT_DATE`);
    const { streak } = await loadYearEndMoves('operational');
    expect(streak).toMatchObject({ days: 3, sinceTracking: true, slippedToday: false });
  });
});
