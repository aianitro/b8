// The Phase 0 keystone (ROADMAP.md): net worth from a dual-regime balance model rather than
// getNetWorth()'s pure flow-derived sum, which is structurally incapable of representing
// market-value assets, real estate, or amortizing liabilities. Pure functions only — the I/O
// shell (querying accounts/ledger balances/account_valuations) lives at the call site, same
// split as lib/plaidMatch.ts and lib/budgetMath.ts.

import type { Landscape } from '../../shared/types';
import { roundCents } from '../budgetMath';

export type ValuationMode = 'ledger' | 'valuation';

export interface AccountRegime {
  id: string;
  landscape: Landscape;
  valuationMode: ValuationMode;
  isLiability: boolean;
}

export interface ValuationRow {
  accountId: string;
  value: number;
  valuedAt: Date | string;
}

export interface AccountContribution {
  id: string;
  landscape: Landscape;
  value: number; // signed contribution to net worth
}

export interface NetWorthStatement {
  total: number;
  operational: number;
  capital: number;
  byAccount: AccountContribution[];
}

/**
 * Reduces a raw (possibly multi-row-per-account, unsorted) valuation history down to each
 * account's most recent observation. account_valuations is append-only by design (§1f will
 * later replay this same history into net_worth_snapshots), so "current value" is always a
 * derived read, never a stored column.
 */
export function latestValuationByAccount(rows: ValuationRow[]): Map<string, number> {
  const latest = new Map<string, { value: number; valuedAtMs: number }>();
  for (const row of rows) {
    const valuedAtMs = new Date(row.valuedAt).getTime();
    const existing = latest.get(row.accountId);
    if (!existing || valuedAtMs > existing.valuedAtMs) {
      latest.set(row.accountId, { value: row.value, valuedAtMs });
    }
  }
  return new Map([...latest].map(([accountId, v]) => [accountId, v.value]));
}

export interface ObservedBalance {
  accountId: string;
  value: number;
}

/**
 * Filters a batch of freshly-observed balances down to the ones worth appending, by dropping
 * any whose value is unchanged since that account's last recorded observation.
 *
 * Why dedupe at all: the scheduler runs two sync phases (plain + force) daily, and each
 * reconciles every Plaid item — so recording unconditionally would append two identical rows
 * per account per day forever, plus more on every manual sync. Keeping only changes makes
 * account_valuations a change-log whose row count tracks actual movement rather than sync
 * frequency, which is what both the value-over-time chart (§1f) and drift detection (§1g)
 * actually want to read. A gap between rows means "unchanged", not "unobserved".
 *
 * Values are rounded to cents before comparison because the column is NUMERIC(14,2): an
 * unrounded 110.229999 from Plaid would store as 110.23 and then compare unequal on the next
 * sync, appending a spurious row every single run.
 */
export function balancesToRecord(
  observed: ObservedBalance[],
  lastRecorded: Map<string, number>
): ObservedBalance[] {
  return observed
    .map((o) => ({ accountId: o.accountId, value: roundCents(o.value) }))
    .filter((o) => lastRecorded.get(o.accountId) !== o.value);
}

/**
 * Net worth = Σ(ledger-mode running balance) + Σ(valuation-mode latest value, liabilities
 * negated). `is_liability` only flips sign for valuation-mode accounts, deliberately: a
 * ledger-mode account's running balance already carries the correct sign through
 * beginning_balance + Σ transactions (see getNetWorth() in app/dashboard/page.tsx) — that
 * model needs no help from is_liability today, and re-signing it here would double-negate
 * accounts the flow model already represents correctly. A valuation-mode liability's value
 * (e.g. a mortgage balance) is always entered as a positive amount owed — the natural way to
 * type it in — and this function is what turns that into a negative contribution.
 */
export function computeNetWorth(
  accounts: AccountRegime[],
  ledgerBalances: Map<string, number>,
  latestValuations: Map<string, number>
): NetWorthStatement {
  const byAccount: AccountContribution[] = [];
  let total = 0;
  let operational = 0;
  let capital = 0;

  for (const account of accounts) {
    const magnitude =
      account.valuationMode === 'valuation'
        ? (latestValuations.get(account.id) ?? 0)
        : (ledgerBalances.get(account.id) ?? 0);

    const value = account.valuationMode === 'valuation' && account.isLiability ? -magnitude : magnitude;

    byAccount.push({ id: account.id, landscape: account.landscape, value });
    total += value;
    if (account.landscape === 'operational') operational += value;
    else capital += value;
  }

  return { total, operational, capital, byAccount };
}
