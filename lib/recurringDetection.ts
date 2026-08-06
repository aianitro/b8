import db from './db';

// A simple recurrence heuristic — merchant + near-fixed amount + ~monthly cadence — over
// transactions already in the database. Not fuzzy-matched merchant names (Plaid's own
// "NETFLIX.COM" vs "Netflix" drift would need real clustering); this is deliberately the v1
// version, matching ROADMAP.md's own framing of this as a starting heuristic, not a full
// subscription-management feature.

export interface RecurringCharge {
  merchant: string;
  predictedDate: string;   // ISO date (YYYY-MM-DD)
  predictedAmount: number; // most recent occurrence's amount
  occurrenceCount: number;
  lastDate: string;
}

const MIN_GAP_DAYS = 24;
const MAX_GAP_DAYS = 36;
const MAX_AMOUNT_VARIANCE = 0.2; // consecutive occurrences must stay within 20% of each other
const MIN_OCCURRENCES = 3;       // at least 2 consistent gaps between 3 charges
const LOOKBACK_DAYS = 150;

interface RawTxn {
  date: string;
  amount: number;
}

export async function detectUpcomingRecurring(limit = 7): Promise<RecurringCharge[]> {
  const result = await db.query<{ merchant: string; date: string; amount: string }>(`
    SELECT COALESCE(t.merchant_name, t.name) AS merchant, t.date::text AS date, t.amount::text AS amount
    FROM transactions t
    JOIN accounts a ON a.id = t.account_id AND a.track_transactions = TRUE
    WHERE t.hidden = FALSE
      AND t.amount > 0
      AND t.date >= CURRENT_DATE - INTERVAL '${LOOKBACK_DAYS} days'
      AND COALESCE(t.merchant_name, t.name) IS NOT NULL
    ORDER BY COALESCE(t.merchant_name, t.name), t.date
  `);

  const byMerchant = new Map<string, RawTxn[]>();
  for (const r of result.rows) {
    if (!byMerchant.has(r.merchant)) byMerchant.set(r.merchant, []);
    byMerchant.get(r.merchant)!.push({ date: r.date, amount: Number(r.amount) });
  }

  const candidates: RecurringCharge[] = [];

  for (const [merchant, txns] of byMerchant) {
    if (txns.length < MIN_OCCURRENCES) continue;

    const gaps: number[] = [];
    let consistent = true;
    for (let i = 1; i < txns.length; i++) {
      const gapDays = (new Date(txns[i].date).getTime() - new Date(txns[i - 1].date).getTime()) / 86400000;
      const amountDiff = Math.abs(txns[i].amount - txns[i - 1].amount) / Math.max(txns[i].amount, txns[i - 1].amount);
      if (gapDays < MIN_GAP_DAYS || gapDays > MAX_GAP_DAYS || amountDiff > MAX_AMOUNT_VARIANCE) {
        consistent = false;
        break;
      }
      gaps.push(gapDays);
    }
    if (!consistent) continue;

    const avgGap = gaps.reduce((s, g) => s + g, 0) / gaps.length;
    const last = txns[txns.length - 1];
    const predictedDate = new Date(new Date(last.date).getTime() + avgGap * 86400000);

    candidates.push({
      merchant,
      predictedDate: predictedDate.toISOString().slice(0, 10),
      predictedAmount: last.amount,
      occurrenceCount: txns.length,
      lastDate: last.date,
    });
  }

  // Grace window: a charge predicted a few days ago that hasn't posted yet is still "upcoming"
  // in any useful sense, not a miss — subscription billing runs a day or two late often enough
  // that filtering strictly to future dates would hide charges that are, practically, still due.
  const graceStart = new Date();
  graceStart.setDate(graceStart.getDate() - 5);
  const graceStartStr = graceStart.toISOString().slice(0, 10);

  return candidates
    .filter((c) => c.predictedDate >= graceStartStr)
    .sort((a, b) => a.predictedDate.localeCompare(b.predictedDate))
    .slice(0, limit);
}
