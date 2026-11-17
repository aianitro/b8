// Which posted charge a photographed receipt belongs to — the rules, with no I/O.
//
// THE SITUATION. At a restaurant the owner photographs the receipt and confirms the charge they
// expect: the bill plus the tip they wrote. Days later the bank posts the real charge. If it is that
// amount, the receipt is linked to it. If the merchant's charge arrives for a different amount, that
// is the alert: a tip that grew, a second swipe, a wrong bill. Card terminals charge exact amounts,
// so ANY difference counts, down to a cent — the owner's choice.
//
// TWO WAYS TO BE THE CHARGE, IN THIS ORDER.
//
//   1. EXACT. A charge of exactly the expected amount, inside the window, is the charge — whatever
//      the bank calls the merchant. Bank merchant text is often unrecognisable ("TST* 4021 OAK"),
//      and an exact amount in a few days' window is strong evidence on its own. Several exact ones:
//      the one whose name agrees best, then the one nearest the meal's day.
//   2. SAME MERCHANT, DIFFERENT AMOUNT. With no exact charge, one whose merchant text agrees with the
//      receipt's is taken as the charge, and its difference is the alert. The nearest amount wins,
//      then the nearest day. Without an agreeing name nothing is claimed: an alert about a stranger's
//      charge would be noise, and the overdue alert covers the case where nothing turns up.
//
// THE WINDOW is from the day before the meal (a phone's calendar can lead the bank's) to seven days
// after it. Restaurants usually post within three; seven covers weekends and slow processors, and
// is the same seven after which a receipt still waiting becomes an overdue alert.
//
// PENDING CHARGES NEVER REACH THIS. Sync stores only posted rows, and a restaurant's pending charge
// is the pre-tip authorisation, so comparing against it would raise an alert on every meal.

export const WINDOW_BEFORE_DAYS = 1;
export const WINDOW_AFTER_DAYS = 7;

export interface WaitingReceipt {
  id: number;
  /** `YYYY-MM-DD`, the phone's calendar day of the meal. */
  capturedOn: string;
  /** Positive: money out. */
  expected: number;
  merchant: string | null;
  rejectedIds: readonly number[];
}

export interface ChargeCandidate {
  id: number;
  /** `YYYY-MM-DD`, posted. */
  date: string;
  /** Plaid's sign: positive is money out. */
  amount: number;
  merchantName: string | null;
  name: string | null;
}

export type ReceiptVerdict =
  | { kind: 'matched'; transactionId: number; charged: number }
  | { kind: 'mismatch'; transactionId: number; charged: number }
  | { kind: 'none' };

const cents = (n: number) => Math.round(n * 100);

/** Whole days from `a` to `b`, both `YYYY-MM-DD`. */
export function daysBetween(a: string, b: string): number {
  return Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 86_400_000);
}

/** Whether a charge posted on `date` can be the receipt's: the window above. */
export function inWindow(capturedOn: string, date: string): boolean {
  const d = daysBetween(capturedOn, date);
  return d >= -WINDOW_BEFORE_DAYS && d <= WINDOW_AFTER_DAYS;
}

/** Whether a receipt still waiting on `today` has run out of window — the overdue alert. */
export function isOverdue(capturedOn: string, today: string): boolean {
  return daysBetween(capturedOn, today) > WINDOW_AFTER_DAYS;
}

// Words in bank text that name the card processor or the business form, not the merchant. Toast's
// "TST*", Square's "SQ *", and so on: two receipts from different restaurants both paid through
// Square must not agree on "sq".
const NOISE = new Set([
  'tst', 'sq', 'sqr', 'toast', 'pos', 'sp', 'pp', 'paypal', 'clover', 'ckc', 'pmt', 'pymt', 'purchase',
  'the', 'and', 'of', 'llc', 'inc', 'ltd', 'co', 'corp', 'restaurant', 'restaurants', 'rest',
]);

/** Lower-case words of three or more letters, without digits, processor tags or business forms. */
export function merchantWords(text: string | null): string[] {
  if (!text) return [];
  return text
    .toLowerCase()
    .replace(/['’]/g, '')
    .split(/[^a-z]+/)
    .filter((w) => w.length >= 3 && !NOISE.has(w));
}

/**
 * How well a receipt's merchant agrees with a charge's bank text: 0 is not at all. One point per
 * receipt word the bank text has, where a bank word cut short (banks truncate at a fixed width)
 * counts if it is at least four letters and starts the receipt's word; and one more when the words
 * run together agree ("TACOBELL" against "Taco Bell").
 */
export function merchantAgreement(receipt: string | null, charge: ChargeCandidate): number {
  const mine = merchantWords(receipt);
  if (mine.length === 0) return 0;
  const theirs = [...merchantWords(charge.merchantName), ...merchantWords(charge.name)];
  if (theirs.length === 0) return 0;
  let score = 0;
  for (const w of new Set(mine)) {
    if (theirs.some((t) => t === w || (t.length >= 4 && w.startsWith(t)) || (w.length >= 4 && t.startsWith(w)))) score += 1;
  }
  const joinedMine = mine.join('');
  const joinedTheirs = [merchantWords(charge.merchantName).join(''), merchantWords(charge.name).join('')];
  if (joinedMine.length >= 5 && joinedTheirs.some((j) => j.length >= 5 && (j.includes(joinedMine) || joinedMine.includes(j)))) {
    score += 1;
  }
  return score;
}

/** Which charge, if any, is this receipt's — and whether it agrees. Rules in the header. */
export function judgeReceipt(receipt: WaitingReceipt, charges: readonly ChargeCandidate[]): ReceiptVerdict {
  const rejected = new Set(receipt.rejectedIds);
  const pool = charges.filter((c) => c.amount > 0 && !rejected.has(c.id) && inWindow(receipt.capturedOn, c.date));
  const distance = (c: ChargeCandidate) => Math.abs(daysBetween(receipt.capturedOn, c.date));
  const want = cents(receipt.expected);

  const exact = pool.filter((c) => cents(c.amount) === want);
  if (exact.length > 0) {
    const best = [...exact].sort((a, b) =>
      merchantAgreement(receipt.merchant, b) - merchantAgreement(receipt.merchant, a) || distance(a) - distance(b) || a.id - b.id)[0];
    return { kind: 'matched', transactionId: best.id, charged: best.amount };
  }

  const same = pool.filter((c) => merchantAgreement(receipt.merchant, c) > 0);
  if (same.length > 0) {
    const best = [...same].sort((a, b) =>
      Math.abs(cents(a.amount) - want) - Math.abs(cents(b.amount) - want) || distance(a) - distance(b) || a.id - b.id)[0];
    return { kind: 'mismatch', transactionId: best.id, charged: best.amount };
  }
  return { kind: 'none' };
}

/** A linked charge's verdict, for a link the owner made by hand: the same exact-cents rule. */
export function verdictForLink(expected: number, charged: number): 'matched' | 'mismatch' {
  return cents(expected) === cents(charged) ? 'matched' : 'mismatch';
}

// ─── What the model read, and what to propose ─────────────────────────────────────────────────

export interface ReceiptReading {
  merchant: string | null;
  subtotal: number | null;
  tax: number | null;
  tip: number | null;
  total: number | null;
}

const money = (n: number | null) => (n !== null && Number.isFinite(n) && n > 0 ? Math.round(n * 100) / 100 : null);

/**
 * The charge to propose for the owner to confirm. The total when one was read — on a signed slip
 * that is the handwritten one, tip included. Otherwise the parts that were read, added up. Null when
 * there is nothing to add: the owner types it.
 */
export function proposedCharge(r: ReceiptReading): number | null {
  const total = money(r.total);
  if (total !== null) return total;
  const parts = [r.subtotal, r.tax, r.tip].map(money).filter((n): n is number => n !== null);
  if (money(r.subtotal) === null) return null;
  return Math.round(parts.reduce((s, n) => s + n, 0) * 100) / 100;
}

/**
 * The model's answer, checked field by field. Anything that is not the right type, not finite, not
 * positive, or absurd for a meal is dropped rather than trusted — the owner confirms the figure
 * anyway, and a blank field is honest where a wrong one is not.
 */
export function cleanReading(raw: unknown): ReceiptReading {
  const o = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) && v > 0 && v < 1_000_000 ? Math.round(v * 100) / 100 : null);
  const merchant = typeof o.merchant === 'string' ? o.merchant.replace(/\s+/g, ' ').trim().slice(0, 200) : '';
  return {
    merchant: merchant === '' ? null : merchant,
    subtotal: num(o.subtotal),
    tax: num(o.tax),
    tip: num(o.tip),
    total: num(o.total),
  };
}
