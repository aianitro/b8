// One category's month, transaction by transaction — the phone's drill-down.
//
// THE FOURTH ENDPOINT A SECOND CLIENT HAS HAD TO CREATE, after accounts, properties and the budget
// grid. The web reaches its transactions through a server component that reads the database
// directly, so `/api/v1/transactions` has only ever had a POST; the read side existed as a page,
// not as an interface. Each of the four gaps was invisible until something other than the web asked
// for the same data, which is the argument for having built the phone before more agent depth.
//
// SHAPED FOR THE DRILL-DOWN, NOT FOR THE `transactions` TABLE. The web's own query returns
// seventeen columns plus transfer peers and an effective property, because its page offers editing,
// transfer grouping and property attribution. None of that is reachable from a heatmap tile. What a
// reader tapping a tile wants is what they were charged, by whom, when — and the total, so the sum
// of the rows can be checked against the figure that made them tap.
//
// The TOTAL is computed by the database over the whole set, not by the client over the rows it
// received. Those differ the moment a limit is introduced, and a total a reader can add up
// themselves and find wrong is worse than no total at all.

import { z } from 'zod';
import { dateString, serialId } from './representation';
import { moneyString } from './overview';

/** One charge, as a drill-down row. */
export const CategoryTransactionSchema = z.object({
  id: serialId,
  date: dateString,
  /** Merchant, falling back to the feed's raw name, falling back to a placeholder — the same
   *  coalescing order the dashboard and the digest use, so a row reads the same in all three. */
  label: z.string(),
  /** Positive is money out, matching the sign convention everywhere else in this app. */
  amount: moneyString,
  /** Which account it landed on. The one piece of context a phone reader cannot infer. */
  account: z.string(),
  /**
   * Whether this row is on the watchlist, and the owner's reason if they gave one.
   *
   * CARRIED SO AN EDITOR CAN OPEN WITH THE CURRENT VALUES. A note field that opens blank on a row
   * that already has a note does not look like missing data — it looks like an empty box — and the
   * first save silently replaces what was there.
   *
   * The two are INDEPENDENT since 2026-09-22: a row may hold a note without being watched, and
   * unwatching one keeps its note. They travel together here because an editor offers both.
   */
  watched: z.boolean(),
  note: z.string().nullable(),
});

export const CategoryTransactionsDataSchema = z.object({
  category: z.string(),
  /** 1–12, matching the URL parameter rather than JavaScript's 0-based months. */
  month: z.int().min(1).max(12),
  year: z.int(),
  /** Every row in the set, newest first. */
  rows: z.array(CategoryTransactionSchema),
  /**
   * What COUNTS: the total excluding rows on Keep an eye, which is the figure the tile grades.
   *
   * Summed by the database over the whole set — see the note above on why not by the client.
   *
   * UNCLAMPED, and so capable of being negative where the tile that led here shows zero. The
   * heatmap's figure comes from `monthOutlookRead`, which wraps the sum in `GREATEST(…, 0)` because
   * a category refunded past zero has not "earned" anything and a negative area is meaningless.
   * That clamp is a presentation choice about a tile. Here the rows are on screen and a total that
   * disagrees with the rows beneath it is the one number a reader can catch being wrong.
   */
  spent: moneyString,
  /**
   * The part on Keep an eye, excluded from `spent` and from the tile's grading since 2026-09-22.
   *
   * CARRIED SEPARATELY RATHER THAN OMITTED, because on this ledger it is not a rounding detail: a
   * category whose only charge is flagged grades at zero, and a drill-down that showed the rows
   * without saying why they do not add up to the headline would look like a bug in the total. The
   * money has not gone anywhere — it is being chased — and the reader is owed both numbers.
   */
  pending: moneyString,
  /** How many rows the set holds, whether or not all of them were returned. */
  count: z.int().min(0),
});

export type CategoryTransaction = z.infer<typeof CategoryTransactionSchema>;
export type CategoryTransactionsData = z.infer<typeof CategoryTransactionsDataSchema>;

export const CategoryTransactionsResponseSchema = z.discriminatedUnion('success', [
  z.strictObject({ success: z.literal(true), data: CategoryTransactionsDataSchema }),
  z.strictObject({
    success: z.literal(false),
    error: z.strictObject({ code: z.string().min(1), message: z.string().min(1) }),
  }),
]);
