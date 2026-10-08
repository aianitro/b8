// The three cards on the accounts page: year-open, change since, and now, per landscape. Pure, so
// the rules below are tested rather than eyeballed; the page gathers the inputs.
//
// The cards add up exactly what the list beneath them shows, so a card and the column of balances
// it sits over cannot disagree. That is why this does not reuse the balances page's definition,
// which counts tracked ledger accounts only: most capital accounts are valued, not tracked, and
// that tab's cards would have summed close to nothing.

import type { Landscape, ValuationMode } from '@b8/contracts/types';
import { roundCents } from '../budgetMath';

export interface SummaryAccount {
  id: string;
  landscape: Landscape;
  valuationMode: ValuationMode;
  isLiability: boolean;
}

export interface SummaryInputs {
  /** Current ledger balance per account; absent for an untracked account, which has none. */
  ledgerBalances: Record<string, number>;
  /** The year's beginning balance per ledger account; absent means it was never entered (0). */
  beginningBalances: Record<string, number>;
  /** Latest valuation per valued account, stored as a magnitude. */
  latestValuations: Record<string, number>;
  /** Latest valuation recorded by Jan 1 per valued account; absent means none by then. */
  openingValuations: Record<string, number>;
  /** Earliest valuation recorded after Jan 1, per valued account: the stand-in opening for one
   *  first valued later in the year. */
  firstValuations: Record<string, number>;
}

export interface LandscapeSummary {
  yearBegin: number;
  current: number;
  /** current − yearBegin, so the three cards always add up. */
  change: number;
  /** Accounts with a current balance, i.e. the ones counted. */
  counted: number;
  /** Valued accounts first valued after Jan 1, whose opening is that first valuation instead.
   *  Counting from zero would book an account's whole value as this year's change, which is the
   *  larger error; the card says how many there are rather than hide the estimate. */
  noOpening: number;
}

export function summarizeLandscape(
  accounts: SummaryAccount[],
  landscape: Landscape,
  inputs: SummaryInputs,
): LandscapeSummary {
  let yearBegin = 0;
  let current = 0;
  let counted = 0;
  let noOpening = 0;

  for (const a of accounts) {
    if (a.landscape !== landscape) continue;

    if (a.valuationMode === 'valuation') {
      // Valuations are magnitudes; a liability's counts against the total, as in net worth.
      const sign = a.isLiability ? -1 : 1;
      const now = inputs.latestValuations[a.id];
      if (now === undefined) continue; // never valued: the list shows "Set value", not a figure
      counted++;
      current += sign * now;
      let opening = inputs.openingValuations[a.id];
      if (opening === undefined) {
        noOpening++;
        opening = inputs.firstValuations[a.id] ?? now;
      }
      yearBegin += sign * opening;
    } else {
      const now = inputs.ledgerBalances[a.id];
      if (now === undefined) continue; // untracked: the list shows a dash
      counted++;
      current += now;
      yearBegin += inputs.beginningBalances[a.id] ?? 0;
    }
  }

  yearBegin = roundCents(yearBegin);
  current = roundCents(current);
  return { yearBegin, current, change: roundCents(current - yearBegin), counted, noOpening };
}
