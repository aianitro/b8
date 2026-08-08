// Composes the whole net-worth statement (ROADMAP.md Phase 0 step 7), which until now the
// dashboard could not state: getNetWorth() summed `accounts` only, so every property was
// missing from the headline figure entirely. Pure — the I/O shell lives at the call site.

import type { Landscape, ValuationMode } from '../../shared/types';

export interface NetWorthAccount {
  id: string;
  landscape: Landscape;
  valuationMode: ValuationMode;
  isLiability: boolean;
  /** Set when this is a mortgage secured against a property. */
  propertyId: number | null;
}

export type NetWorthComponent = 'operational' | 'capitalFinancial' | 'realEstateEquity' | 'liabilities';

/** One line item behind a component total, so a page can show its makeup without re-deriving
 *  the classification rules — the one place a double-count could creep back in. */
export interface NetWorthContribution {
  kind: 'account' | 'property';
  id: string;
  component: NetWorthComponent;
  /** Signed exactly as it lands in the component total. */
  value: number;
}

export interface NetWorthBreakdown {
  operational: number;
  capitalFinancial: number;
  realEstateEquity: number;
  liabilities: number;
  total: number;
  /** Properties with no valuation on record: excluded entirely, and worth disclosing. */
  unvaluedPropertyIds: number[];
  contributions: NetWorthContribution[];
}

/**
 * The four components are deliberately non-overlapping so they sum to `total` exactly.
 *
 * The trap this exists to avoid: a mortgage is both a valuation-mode liability account *and*
 * the subtrahend in its property's equity. Counting it in each place would subtract the same
 * debt twice. So the rule is that a property-linked mortgage is counted only inside
 * realEstateEquity; an unlinked liability falls through to `liabilities` and is counted there.
 *
 * A property with no valuation is dropped along with its mortgages rather than valued at 0.
 * Both alternatives are wrong — counting a $0 house understates net worth by the whole
 * property, counting the debt alone makes equity wildly negative — so neither is chosen
 * silently: the ids come back in unvaluedPropertyIds for the caller to disclose.
 */
export function computeNetWorthBreakdown(
  accounts: NetWorthAccount[],
  ledgerBalances: Map<string, number>,
  latestAccountValuations: Map<string, number>,
  latestPropertyValues: Map<number, number>,
  allPropertyIds: number[]
): NetWorthBreakdown {
  const unvaluedPropertyIds = allPropertyIds.filter((id) => !latestPropertyValues.has(id));
  const excluded = new Set(unvaluedPropertyIds);

  let operational = 0;
  let capitalFinancial = 0;
  let liabilities = 0;
  let linkedMortgageTotal = 0;
  const contributions: NetWorthContribution[] = [];

  for (const a of accounts) {
    const isValuation = a.valuationMode === 'valuation';
    const magnitude = isValuation
      ? (latestAccountValuations.get(a.id) ?? 0)
      : (ledgerBalances.get(a.id) ?? 0);

    if (isValuation && a.isLiability && a.propertyId !== null) {
      // Netted against its property below — unless that property has no valuation, in which
      // case the pair is dropped together rather than leaving a naked debt.
      if (!excluded.has(a.propertyId)) {
        linkedMortgageTotal += magnitude;
        contributions.push({ kind: 'account', id: a.id, component: 'realEstateEquity', value: -magnitude });
      }
      continue;
    }

    if (isValuation && a.isLiability) {
      liabilities -= magnitude; // stored as a positive amount owed; the sign is derived here
      contributions.push({ kind: 'account', id: a.id, component: 'liabilities', value: -magnitude });
      continue;
    }

    // A ledger account's running balance already carries its own sign (a credit card is
    // negative by construction), so it is added as-is regardless of is_liability.
    if (a.landscape === 'operational') operational += magnitude;
    else capitalFinancial += magnitude;
    contributions.push({
      kind: 'account', id: a.id,
      component: a.landscape === 'operational' ? 'operational' : 'capitalFinancial',
      value: magnitude,
    });
  }

  let propertyTotal = 0;
  for (const [id, value] of latestPropertyValues) {
    if (!excluded.has(id)) {
      propertyTotal += value;
      contributions.push({ kind: 'property', id: String(id), component: 'realEstateEquity', value });
    }
  }

  const realEstateEquity = propertyTotal - linkedMortgageTotal;
  const total = operational + capitalFinancial + realEstateEquity + liabilities;

  return { operational, capitalFinancial, realEstateEquity, liabilities, total, unvaluedPropertyIds, contributions };
}
