// Composes the whole net-worth statement (ROADMAP.md Phase 0 step 7), which until now the
// dashboard could not state: getNetWorth() summed `accounts` only, so every property was
// missing from the headline figure entirely. Pure — the I/O shell lives at the call site.

import type { Landscape, ValuationMode } from '../../shared/types';
// The cent-rounding and negative-zero idioms come from the budget domain rather than being
// retyped here: one definition of "round to cents" and one of "not a sign", so the two folders
// cannot disagree at the second decimal or on the sign of zero.
import { roundCents } from '../budgetMath';
import { withoutNegativeZero } from './adherence';

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
  /** Set only within realEstateEquity, on both a property's own line and its linked mortgage's
   *  line — the join key groupRealEstateEquity() uses to merge the pair into one net-equity
   *  line. Null everywhere else; a mortgage that isn't property-linked lands in `liabilities`
   *  instead and was never given one. */
  propertyId: number | null;
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
  /** The portion of `liabilities` that is tenant security deposits, signed exactly as it lands
   *  there (so <= 0). Returned rather than left to the caller to re-derive because
   *  net_worth_snapshots.liabilities_security_deposits exists solely to mark where the
   *  definition of `liabilities`/`total` changed — a marker computed a second, independent way
   *  is free to disagree with the figure it claims to decompose, which is worse than no marker.
   *  Accumulated by the very loop that applies it below. */
  liabilitiesSecurityDeposits: number;
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
 *
 * securityDepositsByProperty is required rather than defaulted to an empty Map, and that is
 * deliberate: an omitted argument would read as "this portfolio holds no tenant deposits" and
 * silently overstate net worth by every deposit owed. There is exactly one production caller
 * (lib/netWorth.ts), so the compiler is a cheap way to make a second one decide on purpose.
 */
export function computeNetWorthBreakdown(
  accounts: NetWorthAccount[],
  ledgerBalances: Map<string, number>,
  latestAccountValuations: Map<string, number>,
  latestPropertyValues: Map<number, number>,
  allPropertyIds: number[],
  /** Latest security-deposit magnitude per property, already reduced newest-wins by the caller
   *  (latestTenantFundByProperty in lib/domain/property.ts). Positive magnitudes, as stored;
   *  the sign is derived below. Last-month-rent holdings are deliberately NOT accepted here —
   *  see the deposit loop for why they belong to no component at all. */
  securityDepositsByProperty: Map<number, number>
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
        contributions.push({ kind: 'account', id: a.id, component: 'realEstateEquity', value: -magnitude, propertyId: a.propertyId });
      }
      continue;
    }

    if (isValuation && a.isLiability) {
      liabilities -= magnitude; // stored as a positive amount owed; the sign is derived here
      contributions.push({ kind: 'account', id: a.id, component: 'liabilities', value: -magnitude, propertyId: null });
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
      propertyId: null,
    });
  }

  let propertyTotal = 0;
  for (const [id, value] of latestPropertyValues) {
    if (!excluded.has(id)) {
      propertyTotal += value;
      contributions.push({ kind: 'property', id: String(id), component: 'realEstateEquity', value, propertyId: id });
    }
  }

  // Tenant security deposits. The cash itself sits in the property's trust checking account and
  // is already counted at full value there (operational/capitalFinancial), so this is the one
  // and only place the obligation to hand it back is subtracted — the ledger in
  // domain/propertyLedger.ts still reconciles the account against the bank statement untouched.
  //
  // Deliberately NOT gated on `excluded`/unvaluedPropertyIds, unlike the linked mortgage above,
  // and the asymmetry is the point: a mortgage is netted *against* its property's value, so a
  // naked mortgage with no value to offset it reads as wildly negative equity and the pair is
  // dropped together. A deposit is netted against nothing. It is owed in full whether or not
  // the house has been revalued this quarter, so it is a function of the deposit observation
  // alone — this loop consults no valuation input at all. A property can simultaneously be
  // "equity unknown" and "owes a tenant $X"; both are true, and neither implies the other.
  //
  // Last month's rent held is absent from this function entirely rather than being passed in
  // and skipped: it is the owner's own money, already recognized as rent income on the day it
  // landed by the cash-basis P&L, and booking it as a liability here would make the net-worth
  // statement and the P&L disagree about the same dollar (see db/schema.sql on the table).
  let liabilitiesSecurityDeposits = 0;
  for (const [propertyId, magnitude] of securityDepositsByProperty) {
    liabilities -= magnitude; // stored as a positive amount owed; the sign is derived here
    liabilitiesSecurityDeposits -= magnitude;
    // propertyId stays null on the contribution: the field is documented as exclusive to
    // realEstateEquity, where it is the join key groupRealEstateEquity() merges a property with
    // its mortgage on. Identity for this line travels through kind + id, exactly as it does for
    // every other non-realEstateEquity contribution, which is already all /net-worth needs to
    // resolve the name and link to /properties/{id}.
    // `0 - magnitude`, not `-magnitude`: an explicitly recorded $0 deposit (a waived one) is a
    // real reading that still emits a line, and `-0` is a value Intl.NumberFormat renders as
    // "-$0" and Object.is distinguishes from 0. Subtracting from zero yields positive zero.
    contributions.push({ kind: 'property', id: String(propertyId), component: 'liabilities', value: 0 - magnitude, propertyId: null });
  }

  const realEstateEquity = propertyTotal - linkedMortgageTotal;
  const total = operational + capitalFinancial + realEstateEquity + liabilities;

  return {
    operational, capitalFinancial, realEstateEquity, liabilities, total,
    unvaluedPropertyIds, contributions, liabilitiesSecurityDeposits,
  };
}

export interface RealEstateEquityLine {
  propertyId: number;
  /** Property's own value plus its linked mortgage's (already-negative) contribution — the
   *  same arithmetic computePropertyEquity() does in lib/domain/property.ts, arrived at here
   *  from the contribution list instead so the two views can never disagree. */
  value: number;
}

/**
 * Collapses realEstateEquity's per-account, per-property lines into one net-equity line per
 * property — a rental's value and its mortgage are two contributions to the same total, not
 * two things a reader needs to net in their head. Every realEstateEquity contribution carries
 * a propertyId for exactly this grouping; nothing else in the breakdown does, and nothing else
 * needs merging the same way, since only real estate splits an asset from its financing across
 * two separate rows to begin with.
 */
export function groupRealEstateEquity(contributions: NetWorthContribution[]): RealEstateEquityLine[] {
  const byProperty = new Map<number, number>();
  for (const c of contributions) {
    if (c.component !== 'realEstateEquity' || c.propertyId === null) continue;
    byProperty.set(c.propertyId, (byProperty.get(c.propertyId) ?? 0) + c.value);
  }
  return [...byProperty.entries()].map(([propertyId, value]) => ({ propertyId, value }));
}

// ---------------------------------------------------------------------------------------------
// Year-to-date movement (ROADMAP.md §5 step 31 / P0.5-31, fixing NITS N2), which moved here with
// the figure it qualifies when the dashboard stopped opening on a total.
//
// The bug it exists to close: `net_worth_snapshots.total` changed meaning partway through the
// history. P0-09a began subtracting tenant security deposits from `liabilities`, so a snapshot
// written before that day and one written after are not the same measurement — and a delta taken
// across the boundary understates growth by exactly the deposits held, renders perfectly, and has
// no symptom. `liabilities_security_deposits` exists precisely to mark which side of the change a
// row was written on: NULL means "written under the previous definition".

/** One recorded snapshot, as the ISO date and the two fields a comparison depends on. */
export interface SnapshotPoint {
  /** ISO 'YYYY-MM-DD', which is why the caller selects `snapshot_date::text`. A JS date conversion
   *  of a DATE column resolves in UTC and moves every snapshot back a day in negative-offset
   *  zones, which can select a different baseline as well as print a wrong label. */
  date: string;
  total: number;
  /** NULL = written before the definition changed, and therefore NOT comparable with today's
   *  total. Only its nullness is ever read here, so no sign question arises: the column is stored
   *  signed as it contributes (<= 0) and this function never touches its value. */
  liabilitiesSecurityDeposits: number | null;
}

export interface YtdDelta {
  /** `current − baseline.total`, cent-rounded once. POSITIVE MEANS NET WORTH GREW. Reversing the
   *  subtraction produces an equally plausible dollar figure whose only symptom is that growth
   *  reads as loss. */
  delta: number;
  /** The baseline's own ISO date, so the window can be printed rather than assumed. */
  sinceDate: string;
  /** How many snapshots carry the decomposition. At least 1 by construction. */
  comparableSnapshotCount: number;
  /** How many older rows were skipped for being written under the previous definition — disclosed
   *  rather than silently dropped, because "since March" and "since January" are different claims
   *  about the same number. */
  excludedPreCutoverCount: number;
}

/**
 * The change from the EARLIEST COMPARABLE snapshot to `current`, or null when there is none.
 *
 * Null, never 0. A `0` asserts "net worth did not move"; null says "there is no comparable earlier
 * reading", and the page renders its existing "First recorded reading" copy instead of a $0 delta.
 * This is BUILD.md §10.3's null-is-not-zero rule at the exact site the bug lives.
 *
 * Earliest comparable, not latest: the point of a year-to-date figure is the longest honest window,
 * and the latest comparable row would report a month's movement under a year's label.
 *
 * Ordering is by ISO date rather than by array position, so a caller whose query grew an ORDER BY
 * — or lost one — gets the same baseline. Rounded once, at the subtraction, because both operands
 * are already cent-quantized and the residue is real: 2930000.11 − 2880000.33 is
 * 49999.779999999795 in IEEE-754. Normalised through the same `withoutNegativeZero` the budget
 * domain uses, because rounding a difference of two equal totals can reach negative zero, and a
 * minus sign on a figure that did not move is a lie about direction.
 */
export function comparableYtdDelta(current: number, snapshots: SnapshotPoint[]): YtdDelta | null {
  const ordered = [...snapshots].sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
  const baselineIndex = ordered.findIndex((s) => s.liabilitiesSecurityDeposits !== null);
  if (baselineIndex === -1) return null;

  const baseline = ordered[baselineIndex];
  return {
    delta: withoutNegativeZero(roundCents(current - baseline.total)),
    sinceDate: baseline.date,
    comparableSnapshotCount: ordered.filter((s) => s.liabilitiesSecurityDeposits !== null).length,
    // Everything strictly older than the baseline, which is exactly what was skipped.
    excludedPreCutoverCount: baselineIndex,
  };
}
