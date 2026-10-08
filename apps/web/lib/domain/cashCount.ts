/**
 * What counting a wallet implies for the ledger.
 *
 * Pure: the I/O shell (reading the ledger balance, writing the adjustment, recording the count)
 * lives at the call site, same split as `valuation.ts` and `budgetMath.ts`.
 *
 * ─── THE SIGN CONVENTION IS THE WHOLE RISK HERE ───────────────────────────────────────────────
 *
 * In `transactions`, a POSITIVE amount is money OUT and a NEGATIVE amount is money IN — the balance
 * is `money in − money out`, which `lib/netWorth.ts`'s ledger query spells out. Getting this backwards does
 * not fail loudly: it produces an adjustment of exactly the right magnitude in exactly the wrong
 * direction, so the wallet lands twice as far from the truth as before the count and the ledger looks
 * internally consistent throughout. That is why the direction is named in the return type rather than
 * left implicit in a sign the caller has to remember.
 */
import { roundCents } from '../budgetMath';

export interface CashCountOutcome {
  /** What the ledger believed, rounded to cents. */
  expected: number;
  /** What was actually in the wallet. */
  counted: number;
  /**
   * `counted − expected`. Negative means the wallet holds LESS than the ledger thought — money was
   * spent and never recorded, which is the ordinary case and the entire reason for counting.
   */
  difference: number;
  /**
   * The transaction to write, or `null` when the count agreed.
   *
   * A NULL adjustment is not a no-op: the count is still recorded, and that record is the only thing
   * that distinguishes "counted on Sunday and it matched" from "not counted since April". A wallet
   * nobody spends from produces nothing but null adjustments, and is exactly the wallet whose
   * staleness would otherwise be invisible.
   */
  adjustment: CashAdjustment | null;
}

export interface CashAdjustment {
  /** Signed for `transactions.amount`: positive spends, negative adds. */
  amount: number;
  /**
   * What happened, in the ledger's terms rather than the sign's.
   *
   * `spent`  — the wallet is lighter than the ledger thought; money left and was never recorded.
   * `found`  — the wallet is heavier; money arrived from somewhere the ledger never saw. Rarer, and
   *            worth keeping distinct rather than calling it negative spending: the two want
   *            different default categories and read differently to a person.
   */
  direction: 'spent' | 'found';
  /** Magnitude, always positive — for prose like "173 spent since the last count". */
  magnitude: number;
}

/**
 * Compare a count against what the ledger believed.
 *
 * Both inputs are rounded to cents before comparison. Without that, a ledger balance carrying float
 * dust from summing NUMERIC through JS produces a difference of a fraction of a penny, which is not
 * zero, so every count would write a meaningless adjustment and no count would ever be recorded as
 * having agreed.
 */
export function reconcileCashCount(expected: number, counted: number): CashCountOutcome {
  const e = roundCents(expected);
  const c = roundCents(counted);
  const difference = roundCents(c - e);

  if (difference === 0) {
    return { expected: e, counted: c, difference: 0, adjustment: null };
  }

  // BOTH directions are `-difference`, and the first version of this special-cased one of them the
  // wrong way round: `counted − expected` is already signed correctly for a balance, and
  // `transactions.amount` is its inverse, so negating once is the entire conversion. Writing it as a
  // branch invited the branch to disagree with itself, which it promptly did — the spend case was
  // right and the inflow case doubled the error instead of correcting it. Caught by the round-trip
  // test below, not by reading it.
  return {
    expected: e,
    counted: c,
    difference,
    adjustment: {
      amount: roundCents(-difference),
      direction: difference < 0 ? 'spent' : 'found',
      magnitude: Math.abs(difference),
    },
  };
}

/**
 * How stale a wallet's balance is, in whole days, or `null` if it has never been counted.
 *
 * Never-counted is deliberately NOT reported as "infinitely stale": a wallet set up this morning and
 * one abandoned in April are different situations, and collapsing them would make the first look like
 * a problem and the second look ordinary. The caller decides how to present each.
 */
export function daysSinceCount(lastCountedAt: Date | string | null, now: Date = new Date()): number | null {
  if (lastCountedAt === null) return null;
  const then = typeof lastCountedAt === 'string' ? new Date(lastCountedAt) : lastCountedAt;
  if (Number.isNaN(then.getTime())) return null;
  const ms = now.getTime() - then.getTime();
  // Floor, not round: a count 47 hours ago is "1 day ago" until it is genuinely two days old.
  return Math.max(0, Math.floor(ms / 86_400_000));
}
