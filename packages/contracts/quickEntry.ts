// What the phone needs to enter a valuation, and nothing more.
//
// ROADMAP.md §5 Phase 3 step 24 screen 4. Deliberately NARROW: these are not the `accounts` and
// `properties` rows, they are the fields a quick-entry screen renders and posts against. Exporting
// the whole row would couple the phone to columns it never reads and make every future column a
// contract change — the `/api/v1/overview` lesson from P1-11a, applied before it costs anything.

import { z } from 'zod';

/**
 * An account whose balance is a VALUATION rather than a flow.
 *
 * `valuation_mode = 'valuation'` accounts are the only ones a human can meaningfully update by hand:
 * a ledger account's balance is derived from its transactions, so typing a number at it would be
 * overwritten by the next sync. The endpoint filters on that, so the phone cannot offer an entry
 * that would silently be discarded.
 */
export const ValuationAccountSchema = z.object({
  id: z.string(),
  name: z.string(),
  type: z.string(),
  landscape: z.string(),
  /** Liabilities are stored as a POSITIVE amount owed; the sign is derived in domain/netWorth.ts. */
  isLiability: z.boolean(),
  /** The most recent valuation, or null if none has ever been entered. */
  latestValue: z.number().nullable(),
  latestAt: z.string().nullable(),
});

export const PropertyRowSchema = z.object({
  id: z.int(),
  nickname: z.string(),
  type: z.string(),
  latestValue: z.number().nullable(),
  latestAt: z.string().nullable(),
});

export const QuickEntryDataSchema = z.object({
  accounts: z.array(ValuationAccountSchema),
  properties: z.array(PropertyRowSchema),
});

export type ValuationAccount = z.infer<typeof ValuationAccountSchema>;
export type PropertyRow = z.infer<typeof PropertyRowSchema>;
export type QuickEntryData = z.infer<typeof QuickEntryDataSchema>;

export const QuickEntryResponseSchema = z.discriminatedUnion('success', [
  z.object({ success: z.literal(true), data: QuickEntryDataSchema }),
  z.object({
    success: z.literal(false),
    error: z.object({ code: z.string(), message: z.string() }),
  }),
]);
