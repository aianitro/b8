// Per-property profit & loss (ROADMAP.md Phase 0 step 9 / §1e), the replacement for the budget
// spreadsheet's hand-maintained "Myrtle Beach" and "Gastonia" sheets.
//
// Attribution is by linked account, not by category. The income categories happen to be
// per-property already ("Rent Myrtle Beach"), but the expense ones are shared and generic
// ("Property Taxes", "Utilities/Maintenance") — so a category-based split would silently
// attribute a primary-residence repair to a rental. A dedicated trust account per property does
// not have that ambiguity, which is what accounts.property_id was deliberately left generic for.

import { roundCents } from '../budgetMath';

export interface PnlTransaction {
  category: string | null;
  /** App convention: positive is an outflow, negative is an inflow. */
  amount: number;
  /** True when the transaction belongs to a linked mortgage/loan account. */
  isDebtService: boolean;
}

export interface PnlLine {
  label: string;
  amount: number;
}

export interface PropertyPnl {
  income: PnlLine[];
  operatingExpenses: PnlLine[];
  grossIncome: number;
  totalOperatingExpenses: number;
  /** Income less operating expenses. Excludes debt service, per the standard definition. */
  netOperatingIncome: number;
  /** Everything paid on linked loan accounts: principal + interest + escrow, still bundled. */
  debtService: number;
  /** What actually hit the bank: NOI less debt service. */
  cashFlow: number;
  /** Change in recorded market value over the period, or null when it can't be established. */
  appreciation: number | null;
  /**
   * cashFlow + appreciation. Deliberately EXCLUDES principal paydown, which needs the
   * amortization split from step 6 — so this understates total return by however much of the
   * year's payments went to principal. Erring low is the safe direction, but the omission is
   * surfaced rather than buried: see `principalPaydownKnown`.
   */
  totalReturn: number | null;
  principalPaydownKnown: false;
}

const UNCATEGORIZED = 'Uncategorized';

/**
 * A property that is cash-flow negative can still be earning a return through appreciation and
 * principal paydown — showing only one of those numbers misrepresents it, which is the specific
 * failure the roadmap calls out for Myrtle Beach. So cash flow and total return are both
 * reported, and the component that can't be computed yet is named rather than silently omitted.
 */
export function computePropertyPnl(
  transactions: PnlTransaction[],
  valueAtStart: number | null,
  valueAtEnd: number | null
): PropertyPnl {
  const incomeBy = new Map<string, number>();
  const expenseBy = new Map<string, number>();
  let debtService = 0;

  for (const t of transactions) {
    if (t.isDebtService) {
      // Kept out of operating expenses entirely: NOI is defined before financing, and mixing
      // a mortgage payment in would make the property look unprofitable at the operating level
      // when it may not be.
      //
      // Negated because loan accounts carry the opposite sign convention: a mortgage PAYMENT
      // arrives as a negative amount, since from the loan's perspective it *reduces* what is
      // owed — while in this app negative means an inflow. Taken raw, a year of mortgage
      // payments reads as income and the property looks cash-flow positive when it is not.
      // Same inversion normalizePlaidBalance() handles for credit/loan balances.
      debtService += -t.amount;
      continue;
    }
    const label = t.category ?? UNCATEGORIZED;
    if (t.amount < 0) {
      incomeBy.set(label, (incomeBy.get(label) ?? 0) + -t.amount);
    } else {
      expenseBy.set(label, (expenseBy.get(label) ?? 0) + t.amount);
    }
  }

  const toLines = (m: Map<string, number>): PnlLine[] =>
    [...m.entries()].map(([label, amount]) => ({ label, amount: roundCents(amount) }))
      .sort((a, b) => b.amount - a.amount);

  const income = toLines(incomeBy);
  const operatingExpenses = toLines(expenseBy);

  const grossIncome = roundCents(income.reduce((s, l) => s + l.amount, 0));
  const totalOperatingExpenses = roundCents(operatingExpenses.reduce((s, l) => s + l.amount, 0));
  const netOperatingIncome = roundCents(grossIncome - totalOperatingExpenses);
  const cashFlow = roundCents(netOperatingIncome - roundCents(debtService));

  const appreciation =
    valueAtStart === null || valueAtEnd === null ? null : roundCents(valueAtEnd - valueAtStart);

  return {
    income,
    operatingExpenses,
    grossIncome,
    totalOperatingExpenses,
    netOperatingIncome,
    debtService: roundCents(debtService),
    cashFlow,
    appreciation,
    totalReturn: appreciation === null ? null : roundCents(cashFlow + appreciation),
    principalPaydownKnown: false,
  };
}
