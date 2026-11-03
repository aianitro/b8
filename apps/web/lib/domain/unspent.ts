/**
 * Unspent budget — the pure rules. The tables and the effective-plan function are in
 * migrations/1791900000000_budget-unspent.sql; the I/O is lib/unspentStore.ts.
 *
 * When a month closes, each spending category's LEFTOVER (its plan for the month minus what it
 * spent, when positive) goes into that category's bucket. The owner allocates a bucket by hand:
 * CARRY an amount into a month — this month or later, this category or another — which raises that
 * month's plan, or RELEASE it to savings. Overspent months add nothing and take nothing. Until
 * allocated, a leftover counts as saved: no projection assumes it will be spent.
 *
 * Months here are 1-BASED, as the tables store them. The rest of the app's month indices are
 * 0-based; the conversion happens at this module's edge, once.
 */

export interface YearMonth { year: number; month: number }

/** The first month whose close fills a bucket — the owner's starting point. */
export const UNSPENT_START: YearMonth = { year: 2026, month: 9 };

const index = (ym: YearMonth) => ym.year * 12 + (ym.month - 1);
const fromIndex = (i: number): YearMonth => ({ year: Math.floor(i / 12), month: (i % 12) + 1 });

/**
 * Days into a month before the month BEFORE it is closed. Charges authorised on the last days of a
 * month post a day or three later; closing on the 1st would miss them, overstate the leftover, and
 * — since a close is written once — never correct it.
 */
export const CLOSE_GRACE_DAYS = 3;

/**
 * The months that may be closed as of `today` (1-based month, plus the day): every month from
 * UNSPENT_START up to last month — or up to the month before last while last month is still inside
 * its grace days.
 *
 * `graceDays` is an argument so the owner can close a month early from the budget page. At 0 the
 * result is every month that has ENDED: the subtraction still steps back one month, so no grace
 * however short can reach the month now running, whose `actual` is a part-month figure.
 */
export function closedMonths(
  today: YearMonth & { day: number },
  start: YearMonth = UNSPENT_START,
  graceDays: number = CLOSE_GRACE_DAYS,
): YearMonth[] {
  const lastClosable = index(today) - (today.day > graceDays ? 1 : 2);
  const out: YearMonth[] = [];
  for (let i = index(start); i <= lastClosable; i++) out.push(fromIndex(i));
  return out;
}

export interface CloseSchedule {
  /** Months that have ended, are in range, and have no close recorded — earliest first. */
  pending: YearMonth[];
  /** The month the next close covers: the earliest pending one, or the month now running. */
  next: YearMonth;
  /** The day the daily job closes `next` on — the grace day of the month after it. */
  closesOn: YearMonth & { day: number };
  /** Whether `next` is already past its grace, so the job's next run would take it. */
  ready: boolean;
}

/**
 * What the budget page says when no bucket is waiting: which month is next to close and when.
 *
 * An empty card is indistinguishable from a removed feature — the owner read one as the other —
 * so the card stays on the page and names the date instead of disappearing.
 */
export function closeSchedule(
  today: YearMonth & { day: number },
  closed: readonly YearMonth[],
  start: YearMonth = UNSPENT_START,
): CloseSchedule {
  const done = new Set(closed.map(index));
  const pending = closedMonths(today, start, 0).filter((ym) => !done.has(index(ym)));
  // With nothing pending the next close is of the month now running, which has not ended: that is
  // a date to report, never a month `closeNow` may take.
  const next = pending[0] ?? { year: today.year, month: today.month };
  const after = fromIndex(index(next) + 1);
  return {
    pending,
    next,
    closesOn: { ...after, day: CLOSE_GRACE_DAYS + 1 },
    ready: closedMonths(today, start).some((m) => index(m) === index(next)),
  };
}

/** A month's leftover, to the cent; zero when the category spent its plan or more. */
export function leftover(planned: number, actual: number): number {
  return Math.max(0, Math.round((planned - actual) * 100) / 100);
}

export type MoveCheck = { ok: true } | { ok: false; reason: string };

/**
 * Whether an allocation may be made. Amounts are compared in cents so a balance can be allocated
 * in full however the two were rounded on the way here.
 */
export function checkMove(args: {
  amount: number;
  balance: number;
  action: 'carry' | 'release';
  to?: YearMonth;
  today: YearMonth;
}): MoveCheck {
  const cents = Math.round(args.amount * 100);
  if (!Number.isFinite(args.amount) || cents <= 0) return { ok: false, reason: 'Enter an amount above zero.' };
  if (cents > Math.round(args.balance * 100)) return { ok: false, reason: 'That is more than this category has unspent.' };
  if (args.action === 'carry') {
    if (!args.to || args.to.month < 1 || args.to.month > 12) return { ok: false, reason: 'Choose a month to carry it into.' };
    // A closed month's plan is history: carrying into it would rewrite a month already judged.
    if (index(args.to) < index(args.today)) return { ok: false, reason: 'Carry into this month or a later one.' };
  }
  return { ok: true };
}
