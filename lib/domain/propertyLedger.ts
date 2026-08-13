// A property's operating-cash ledger: opening balance, every attributed transaction in date
// order, a running balance beside each, and the closing position.
//
// This is the direct replacement for the shape the budget spreadsheet's per-property sheets
// take — a Beginning balance row, dated movements, a Balance column carried down. Reproducing
// that shape is the point: it is how the owner already reads these properties, and a statement
// they cannot tie back to a running balance is a statement they cannot trust.
//
// Distinct from computePropertyPnl(), which answers "did this property earn money this year"
// by classifying flows into income / expenses / debt service. This answers the different and
// more basic question "where did the cash actually go, in order" — the one you need to
// reconcile against a bank statement. The P&L nets a mortgage payment out of NOI; the ledger
// shows it leaving the account on the first of the month like everything else.

import { roundCents } from '../budgetMath';

export interface LedgerInput {
  id: number;
  date: string;
  description: string;
  category: string | null;
  /** App convention: positive is an outflow, negative is an inflow. */
  amount: number;
  /** Name of the account the transaction actually sits on. */
  accountName: string;
  /** True when this transaction reaches the property by an explicit tag rather than its
   *  account's linkage — surfaced so a manual attribution is visibly a manual attribution. */
  taggedDirectly: boolean;
}

export interface LedgerRow extends LedgerInput {
  /** Balance after this transaction is applied. */
  balance: number;
}

export interface PropertyLedger {
  beginningBalance: number;
  rows: LedgerRow[];
  endingBalance: number;
  /** Total in / out over the period, for a summary line that doesn't require re-summing rows. */
  totalIn: number;
  totalOut: number;
}

/**
 * Builds the running balance from the opening position forward.
 *
 * Sorted here rather than trusted from the caller: a running balance computed over rows in
 * arbitrary order produces a column of numbers that are individually plausible and collectively
 * meaningless, which is worse than an obvious error. Ties broken by id so a day with several
 * movements is at least stable between renders.
 *
 * Rounded at each step, not once at the end, because the displayed column must actually add up
 * — a reader checking two adjacent rows against their bank is the entire audience for this view.
 */
export function buildPropertyLedger(
  beginningBalance: number,
  transactions: LedgerInput[]
): PropertyLedger {
  const sorted = [...transactions].sort(
    (a, b) => a.date.localeCompare(b.date) || a.id - b.id
  );

  let balance = roundCents(beginningBalance);
  let totalIn = 0;
  let totalOut = 0;
  const rows: LedgerRow[] = [];

  for (const t of sorted) {
    // Positive amounts are outflows, so they reduce the balance.
    balance = roundCents(balance - t.amount);
    if (t.amount < 0) totalIn = roundCents(totalIn - t.amount);
    else totalOut = roundCents(totalOut + t.amount);
    rows.push({ ...t, balance });
  }

  return {
    beginningBalance: roundCents(beginningBalance),
    rows,
    endingBalance: balance,
    totalIn,
    totalOut,
  };
}
