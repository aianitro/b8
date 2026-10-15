import db from './db';
import { createLogger } from './logger';
import { loadYearEndStates } from './yearEndRead';
import { decompose, holdStreak, yearEndPath, type CategoryState, type HoldStreak, type Moment, type YearEndMove, type YearEndPathPoint } from './domain/yearEndMoves';

const log = createLogger('yearEndSnapshots');

/**
 * The year-end P/L's memory — one snapshot a morning, per landscape and category, so the dashboard
 * can say how far the projection moved since yesterday and since the month began, and why.
 * Table: migrations/1792200000000_year-end-snapshots.sql. The split: lib/domain/yearEndMoves.ts.
 *
 * The snapshot is the plan and the actuals, not the projected figure: the figure can be recomputed
 * from them, and only they can say WHICH input moved it.
 */

type Landscape = 'operational' | 'capital';
const LANDSCAPES: Landscape[] = ['operational', 'capital'];

/** The database's calendar day, as `{ iso, year, month }` with a 0-based month. */
async function today(): Promise<{ iso: string; year: number; month: number }> {
  const iso = (await db.query<{ d: string }>('SELECT CURRENT_DATE::text AS d')).rows[0].d;
  return { iso, year: Number(iso.slice(0, 4)), month: Number(iso.slice(5, 7)) - 1 };
}

/**
 * This morning's snapshot, both landscapes. Written once a day and WHOLE: per landscape, all of its
 * categories or none, under a lock and an exists check in one transaction. A row-level "skip if
 * present" would let a second run that day add a category created in between, and one snapshot
 * would then mix two mornings. Resolves always.
 */
export async function writeYearEndSnapshot(): Promise<number> {
  try {
    const t = await today();
    let written = 0;
    for (const landscape of LANDSCAPES) {
      const states = await loadYearEndStates(landscape, t);
      const client = await db.connect();
      try {
        await client.query('BEGIN');
        await client.query('SELECT pg_advisory_xact_lock(hashtext($1))', [`year-end-snapshot:${landscape}`]);
        const done = await client.query('SELECT 1 FROM year_end_snapshots WHERE snapshot_date = $1 AND landscape = $2 LIMIT 1', [t.iso, landscape]);
        if (done.rows.length === 0) {
          for (const c of states) {
            await client.query(
              `INSERT INTO year_end_snapshots (snapshot_date, landscape, category_name, is_income, plan, actuals)
               VALUES ($1, $2, $3, $4, $5, $6)`,
              [t.iso, landscape, c.name, c.isIncome, c.plan, c.actuals]);
            written++;
          }
        }
        await client.query('COMMIT');
      } catch (err) {
        await client.query('ROLLBACK').catch(() => {});
        throw err;
      } finally {
        client.release();
      }
    }
    log.info('year-end snapshot', { rows: written });
    return written;
  } catch (err) {
    log.error('year-end snapshot failed', { error: err instanceof Error ? err.message : String(err) });
    return 0;
  }
}

export interface MoveSince {
  /** The snapshot's date, `YYYY-MM-DD` — shown, since a missed morning makes "yesterday" older. */
  from: string;
  move: YearEndMove;
}

export interface YearEndMoves {
  sinceYesterday: MoveSince | null;
  sinceMonthStart: MoveSince | null;
  /** Days in a row this year's spending has not moved the year-end down (`holdStreak`). */
  streak: HoldStreak | null;
}

/**
 * How the projection moved since the last snapshot before today, and since the month's first one.
 * Either is null when there is no such snapshot in this year — the first day after this ships, and
 * every 1 January. Read against the live figures, so the move is in the number on the card.
 */
export async function loadYearEndMoves(landscape: Landscape): Promise<YearEndMoves> {
  const { t, points, now } = await loadYearEndPoints(landscape);
  const monthStart = `${t.iso.slice(0, 7)}-01`;
  const since = (p: { date: string; moment: Moment } | undefined): MoveSince | null =>
    p ? { from: p.date, move: decompose(p.moment, now) } : null;
  return {
    sinceYesterday: since(points.filter((p) => p.date < t.iso).pop()),
    sinceMonthStart: since(points.find((p) => p.date >= monthStart)),
    streak: holdStreak([...points, { date: t.iso, moment: now }], t.iso),
  };
}

/**
 * This year's snapshots up to and including this morning's, every one, and the live state. The
 * moves above and the path below both read this, so the chart's steps are the card's moves.
 */
async function loadYearEndPoints(landscape: Landscape) {
  const t = await today();
  const yearStart = `${t.iso.slice(0, 4)}-01-01`;
  // The streak and the path walk them all, and the two baselines are among them. A few dozen rows
  // a day, so a year is still a small read.
  const [snaps, live] = await Promise.all([
    db.query<{ d: string; category_name: string; is_income: boolean; plan: string[]; actuals: string[] }>(
      `SELECT snapshot_date::text AS d, category_name, is_income, plan::text[], actuals::text[]
         FROM year_end_snapshots WHERE landscape = $1 AND snapshot_date >= $2 AND snapshot_date <= $3
        ORDER BY snapshot_date`,
      [landscape, yearStart, t.iso]),
    loadYearEndStates(landscape, t),
  ]);
  const byDate = new Map<string, CategoryState[]>();
  for (const r of snaps.rows) {
    byDate.set(r.d, [...(byDate.get(r.d) ?? []), { name: r.category_name, isIncome: r.is_income, plan: r.plan.map(Number), actuals: r.actuals.map(Number) }]);
  }
  const points: { date: string; moment: Moment }[] = [...byDate].map(([date, categories]) => ({ date, moment: { month: Number(date.slice(5, 7)) - 1, categories } }));
  const now: Moment = { month: t.month, categories: live };
  return { t, points, now };
}

/**
 * The projected year-end P/L, morning by morning this year, ending on the live figure — the P&L
 * page's chart. This morning's snapshot is replaced by the live state rather than drawn beside it:
 * two points on one date would read as a move made at midnight. Empty before the first snapshot.
 */
export async function loadYearEndPath(landscape: Landscape): Promise<YearEndPathPoint[]> {
  const { t, points, now } = await loadYearEndPoints(landscape);
  if (points.length === 0) return [];
  return yearEndPath([...points.filter((p) => p.date < t.iso), { date: t.iso, moment: now }]);
}
