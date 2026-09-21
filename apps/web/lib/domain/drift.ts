// Reconciliation drift detection (ROADMAP.md Phase 0 step 8 / §1g): compares what Plaid says
// an account holds against what this app's own ledger computes from beginning balance plus
// transactions. A gap means a transaction was missed, duplicated, mis-signed, or the beginning
// balance is wrong — the exact failure the budget spreadsheet was papering over with manual
// `correction` / `pending` / `diff` rows.
//
// This only works because lib/plaidBalances.ts records plaid_balance rows for *every* linked
// account rather than only the capital ones: a ledger-mode checking account has no other reason
// to carry a valuation, and it is precisely the kind of account that drifts.

import { roundCents } from '../budgetMath';

// Plaid reports `balances.current` as a positive magnitude for credit and loan accounts (the
// amount owed), while this app's ledger balance for the same account is negative by
// construction — beginning balance plus signed transactions. Comparing the two raw would report
// roughly double the balance as "drift" on every credit card in the list.
const OWED_AS_POSITIVE = new Set(['credit', 'loan']);

export interface DriftInput {
  accountId: string;
  name: string;
  /** Plaid account type: 'depository' | 'credit' | 'loan' | 'investment' | ... */
  type: string;
  ledgerBalance: number;
  /** Latest recorded plaid_balance, or null when Plaid has never reported one. */
  plaidBalance: number | null;
  observedAt: string | null;
  /** This year's beginning balance as currently stored (0 when no row exists). */
  currentBeginningBalance: number;
  /** False when no account_balances row exists for the year — see `safeToDerive` below. */
  hasBeginningBalance: boolean;
}

export interface DriftFinding {
  accountId: string;
  name: string;
  ledgerBalance: number;
  /** Plaid's figure, normalized into this app's sign convention. */
  expectedBalance: number;
  /** expected − ledger. Positive means the ledger is short of what Plaid reports. */
  drift: number;
  observedAt: string | null;
  /** The beginning balance that would make the ledger agree with the bank. */
  suggestedBeginningBalance: number;
  /**
   * Whether reconciling by adjusting the beginning balance is legitimate here.
   *
   * The distinction matters, and getting it wrong would repeat the exact sin this feature
   * exists to end. Adjusting the beginning balance assumes the transaction history is complete
   * and infers what the start-of-year balance must have been. That is sound for an account
   * that was never initialized — the opening figure is genuinely unknown. It is *not* sound
   * for an account that already had one and has since diverged: there the gap is evidence of a
   * missing, duplicated, or mis-signed transaction, and silently moving the opening balance to
   * absorb it is precisely what the budget spreadsheet's manual `correction` rows were doing.
   */
  safeToDerive: boolean;
}

/** Normalizes Plaid's magnitude into the ledger's signed convention. Exported for testing. */
export function normalizePlaidBalance(type: string, plaidBalance: number): number {
  return OWED_AS_POSITIVE.has(type.toLowerCase()) ? -plaidBalance : plaidBalance;
}

/**
 * Accounts whose ledger disagrees with Plaid by more than `threshold` dollars, worst first.
 *
 * Accounts Plaid has never reported a balance for are skipped rather than reported as drifting
 * by their whole balance — a manually-created account has no Plaid figure to disagree with, and
 * flagging it every day would train the alert to be ignored.
 *
 * The default $1 threshold is deliberately tight. This is a reconciliation check, not an
 * anomaly heuristic: a correct ledger should match to the cent, and the dollar of slack only
 * absorbs rounding, not real gaps.
 */
export function detectDrift(rows: DriftInput[], threshold = 1): DriftFinding[] {
  const findings: DriftFinding[] = [];

  for (const row of rows) {
    if (row.plaidBalance === null) continue;

    const expectedBalance = roundCents(normalizePlaidBalance(row.type, row.plaidBalance));
    const drift = roundCents(expectedBalance - roundCents(row.ledgerBalance));

    if (Math.abs(drift) > threshold) {
      findings.push({
        accountId: row.accountId,
        name: row.name,
        ledgerBalance: roundCents(row.ledgerBalance),
        expectedBalance,
        drift,
        observedAt: row.observedAt,
        // ledger = beginning + ytdNet, so shifting the opening figure by exactly the drift
        // lands the ledger on the bank's number without touching any transaction.
        suggestedBeginningBalance: roundCents(row.currentBeginningBalance + drift),
        safeToDerive: !row.hasBeginningBalance,
      });
    }
  }

  // Worst first: with a long account list the useful question is "what is most wrong",
  // not "what is alphabetically first".
  return findings.sort((a, b) => Math.abs(b.drift) - Math.abs(a.drift));
}
