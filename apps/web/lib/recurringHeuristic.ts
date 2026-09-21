// The pure core of recurring-charge detection — merchant + near-fixed amount + ~monthly
// cadence. Kept free of DB and wall-clock dependencies so the gap/variance math is unit
// testable (ROADMAP.md §2, testing priority tier 1); recurringDetection.ts is the I/O shell.
//
// Deliberately v1: merchant names are matched exactly, not clustered, so Plaid's own
// "NETFLIX.COM" vs "Netflix" drift will read as two merchants. That matches ROADMAP.md's
// framing of this as a starting heuristic, not a subscription-management feature.

export interface RecurringCharge {
  merchant: string;
  predictedDate: string;   // ISO date (YYYY-MM-DD)
  predictedAmount: number; // most recent occurrence's amount
  occurrenceCount: number;
  lastDate: string;
}

export interface RawTxn {
  merchant: string;
  date: string;
  amount: number;
}

export const MIN_GAP_DAYS = 24;
export const MAX_GAP_DAYS = 36;
export const MAX_AMOUNT_VARIANCE = 0.2; // consecutive occurrences must stay within 20% of each other
export const MIN_OCCURRENCES = 3;       // at least 2 consistent gaps between 3 charges
export const GRACE_DAYS = 5;

const DAY_MS = 86400000;
const toIsoDate = (d: Date) => d.toISOString().slice(0, 10);

/**
 * @param txns  Charges to consider, ascending by date within each merchant.
 * @param today Reference date for the "still upcoming" grace window, injected rather than
 *              read from the clock so callers and tests are not time-dependent.
 */
export function findRecurringCharges(txns: RawTxn[], today: Date, limit = 7): RecurringCharge[] {
  const byMerchant = new Map<string, RawTxn[]>();
  for (const t of txns) {
    if (!byMerchant.has(t.merchant)) byMerchant.set(t.merchant, []);
    byMerchant.get(t.merchant)!.push(t);
  }

  const candidates: RecurringCharge[] = [];

  for (const [merchant, merchantTxns] of byMerchant) {
    if (merchantTxns.length < MIN_OCCURRENCES) continue;

    const gaps: number[] = [];
    let consistent = true;
    for (let i = 1; i < merchantTxns.length; i++) {
      const gapDays =
        (new Date(merchantTxns[i].date).getTime() - new Date(merchantTxns[i - 1].date).getTime()) / DAY_MS;
      const amountDiff =
        Math.abs(merchantTxns[i].amount - merchantTxns[i - 1].amount) /
        Math.max(merchantTxns[i].amount, merchantTxns[i - 1].amount);
      if (gapDays < MIN_GAP_DAYS || gapDays > MAX_GAP_DAYS || amountDiff > MAX_AMOUNT_VARIANCE) {
        consistent = false;
        break;
      }
      gaps.push(gapDays);
    }
    if (!consistent) continue;

    const avgGap = gaps.reduce((s, g) => s + g, 0) / gaps.length;
    const last = merchantTxns[merchantTxns.length - 1];
    const predictedDate = new Date(new Date(last.date).getTime() + avgGap * DAY_MS);

    candidates.push({
      merchant,
      predictedDate: toIsoDate(predictedDate),
      predictedAmount: last.amount,
      occurrenceCount: merchantTxns.length,
      lastDate: last.date,
    });
  }

  // Grace window: a charge predicted a few days ago that hasn't posted yet is still "upcoming"
  // in any useful sense, not a miss — subscription billing runs a day or two late often enough
  // that filtering strictly to future dates would hide charges that are, practically, still due.
  const graceStartStr = toIsoDate(new Date(today.getTime() - GRACE_DAYS * DAY_MS));

  return candidates
    .filter((c) => c.predictedDate >= graceStartStr)
    .sort((a, b) => a.predictedDate.localeCompare(b.predictedDate))
    .slice(0, limit);
}
