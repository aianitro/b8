import db from './db';
import { loadYearEnd } from './yearEndRead';
import { loadMonthOutlook } from './monthOutlookRead';
import { loadWatchlist } from './watchlistRead';
import { loadJobHealth } from './jobHealthRead';
import { asOfFromDate } from './domain/monthOutlook';
import type { DigestData, DigestTxn } from './domain/digest';

/**
 * Everything the daily digest renders, read once.
 *
 * I/O only. Not one presentation decision lives here and not one financial rule — `lib/domain/digest.ts`
 * holds both, so both can be fixture-pinned. What this file owns is the three queries and the
 * single clock read they share.
 *
 * ─── One clock read, converted once ───────────────────────────────────────────────────────────
 *
 * `now` is a parameter rather than a `new Date()` inside each query, for the reason
 * `asOfFromDate`'s docblock gives: a second conversion is a second calendar, and the two disagree
 * for the hours around midnight. The daily job runs early in the morning, which is precisely when
 * "this month" and "yesterday" are most likely to be computed on opposite sides of a boundary.
 */

/** How many uncategorized rows the email lists before it falls back to a total. */
const LIST_LIMIT = 8;

/**
 * `Date` → `YYYY-MM-DD` in LOCAL time.
 *
 * `toISOString().slice(0, 10)` is the obvious way to write this and it is wrong here: it converts
 * to UTC first, so any evening west of Greenwich reports tomorrow's date. The digest's whole second
 * widget is "yesterday", so a one-day slip would silently report the wrong day's transactions and
 * look entirely plausible doing it.
 */
function localIso(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

/**
 * The row shape all three transaction queries return, so one mapper serves them.
 *
 * `amount::text` and then `Number()`, never the raw value: `pg` hands a scalar `NUMERIC` back as a
 * STRING while `db.query<T>()`'s type parameter is an unchecked cast that will happily claim it is
 * a number. `'84.20' + 12.5` is `'84.212.5'` — a plausible-looking figure, no type error anywhere.
 */
interface TxnRow {
  date: string;
  label: string;
  amount: string;
  category: string | null;
}

function toTxn(r: TxnRow): DigestTxn {
  const amount = Number(r.amount);
  if (!Number.isFinite(amount)) {
    throw new RangeError(`digestRead: transaction amount is not a number: ${r.amount}`);
  }
  return { date: r.date, label: r.label, amount, category: r.category };
}

/**
 * The merchant, falling back to the feed's raw name, falling back to a placeholder.
 *
 * Copied in SQL from `app/dashboard/page.tsx`'s own recent-arrivals query rather than invented, so
 * a row reads the same in the email as it does on the screen the owner will open to act on it. A
 * second coalescing order would label the same transaction two different ways in two places.
 */
const LABEL = `COALESCE(NULLIF(t.merchant_name, ''), NULLIF(t.name, ''), 'Unnamed')`;

/** Tracked accounts only, visible rows only — the filter every figure in this app is built on. */
const VISIBLE = `JOIN accounts a ON a.id = t.account_id AND a.track_transactions = TRUE`;

export async function loadDigest(now: Date): Promise<DigestData> {
  const year = now.getFullYear();
  const month = now.getMonth(); // 0-based, as `loadYearEnd` and `asOfFromDate` both expect.

  const yesterday = new Date(now);
  yesterday.setDate(yesterday.getDate() - 1);
  const yesterdayIso = localIso(yesterday);

  const [unfiled, unfiledTotals, posted, watching, health, monthRead, yearEnd] = await Promise.all([
    // Largest first — filing the biggest row moves every other figure in the email the most.
    // `ABS`, because a large uncategorized DEPOSIT distorts the year-end projection exactly as
    // hard as a large uncategorized payment does, and 2026-09-11 is the entry in this repo's
    // history where that cost $2,175 of phantom income.
    db.query<TxnRow>(`
      SELECT t.date::text, ${LABEL} AS label, t.amount::text, t.mapped_category AS category
        FROM transactions t ${VISIBLE}
       WHERE t.mapped_category IS NULL AND t.hidden = FALSE
         AND EXTRACT(YEAR FROM t.date) = $1 AND EXTRACT(MONTH FROM t.date) = $2
       ORDER BY ABS(t.amount) DESC, t.id
       LIMIT ${LIST_LIMIT}
    `, [year, month + 1]),

    // Counted over ALL of them, not over the listed sample. A reader who adds up the visible rows
    // would otherwise reach a number no other figure in the email was computed from.
    db.query<{ n: string; out: string; inbound: string }>(`
      SELECT COUNT(*)::text AS n,
             COALESCE(SUM(t.amount) FILTER (WHERE t.amount > 0), 0)::text      AS out,
             COALESCE(ABS(SUM(t.amount) FILTER (WHERE t.amount < 0)), 0)::text AS inbound
        FROM transactions t ${VISIBLE}
       WHERE t.mapped_category IS NULL AND t.hidden = FALSE
         AND EXTRACT(YEAR FROM t.date) = $1 AND EXTRACT(MONTH FROM t.date) = $2
    `, [year, month + 1]),

    // Yesterday in full, and unlimited on purpose: a day is short enough to list completely, and a
    // truncated day is a day the reader cannot reconcile against a statement.
    db.query<TxnRow>(`
      SELECT t.date::text, ${LABEL} AS label, t.amount::text, t.mapped_category AS category
        FROM transactions t ${VISIBLE}
       WHERE t.date = $1::date AND t.hidden = FALSE
       ORDER BY ABS(t.amount) DESC, t.id
    `, [yesterdayIso]),

    // Through the shared reader, so the mail and the dashboard cannot disagree about what is on
    // the list, how it is ordered, or how old an entry is.
    loadWatchlist(),

    // Only surfaced when the job has been missing. See DigestData.jobGap.
    loadJobHealth(now),

    // The same read the dashboard's bubbles are built from, so a category cannot carry one figure
    // on the screen and another in the mail.
    loadMonthOutlook(asOfFromDate(now)),

    // Operational, matching the dashboard's own headline. Capital is a different question with a
    // different cadence and it is not what a daily digest is for.
    loadYearEnd('operational', { year, month }),
  ]);

  const totals = unfiledTotals.rows[0];
  const yesterdayRows = posted.rows.map(toTxn);

  return {
    asOf: { year, month: month + 1, day: now.getDate() },

    // `fresh` says nothing: a message the job just sent does not need to announce that the job ran.
    jobGap: health.status === 'fresh' ? null : health.message,

    uncategorized: {
      rows: unfiled.rows.map(toTxn),
      totalCount: Number(totals?.n ?? 0),
      totalOut: Number(totals?.out ?? 0),
      totalIn: Number(totals?.inbound ?? 0),
    },

    yesterday: {
      date: yesterdayIso,
      rows: yesterdayRows,
      totalOut: yesterdayRows.filter((t) => t.amount > 0).reduce((s, t) => s + t.amount, 0),
      totalIn: yesterdayRows.filter((t) => t.amount < 0).reduce((s, t) => s - t.amount, 0),
    },

    watchlist: watching.map((w) => ({
      date: w.date,
      label: w.label,
      amount: w.amount,
      note: w.note,
      daysOpen: w.daysOpen,
    })),

    // Scoped to the as-of month AND to categories with an allocation. `categoryPacing` emits one
    // record per category PER MONTH — that is what lets an earlier month's breach be reported — so
    // taking the array whole would draw a category once for every month it has a budget in. The
    // dashboard hit exactly that: 28 circles over 21 categories.
    bubbles: monthRead.allPaces
      .filter((p) => p.month === month && p.budgeted > 0)
      .map((p) => ({
        category: p.category,
        budgeted: p.budgeted,
        actual: p.actual,
        projectedRatio: p.projectedRatio,
        tooEarly: p.status === 'too-early' || p.status === 'future' || p.status === 'no-budget',
      })),

    yearEnd: {
      profitLoss: yearEnd.profitLoss,
      netToDate: yearEnd.netToDate,
      points: yearEnd.monthly.map((p, i) => ({
        month: i + 1,
        income: p.income,
        expense: p.expense,
        cumulative: p.cumulative,
        projected: p.projected,
      })),
    },
  };
}
