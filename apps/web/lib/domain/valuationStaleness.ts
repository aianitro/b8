/**
 * Investment accounts valued by hand whose figure has gone stale.
 *
 * A synced account refreshes itself; one valued by hand is only as current as the last time the
 * owner entered it, and net worth carries that figure silently whatever its age. This names the
 * ones worth refreshing.
 *
 * ─── Why 100 days ─────────────────────────────────────────────────────────────────────────────
 *
 * The brokerage the owner values by hand sends its statement QUARTERLY, and the statement upload
 * is the intended way to refresh it. A month-scale threshold would nag for two months of every
 * quarter with nothing new to upload. A quarter plus a week's grace for the statement to arrive
 * means the reminder fires when a statement has been MISSED — which is the thing worth saying.
 *
 * Assets only. A loan valued by hand moves on a schedule its own payments already describe, and a
 * mortgage is netted against its property, which has its own revaluation rhythm.
 *
 * Dates are ISO `YYYY-MM-DD` and compared as calendar dates; see netWorthPeriods.ts for why.
 */

export const VALUATION_STALE_DAYS = 100;

export interface ValuedAccount {
  id: string;
  name: string;
  /** `YYYY-MM-DD` of the latest recorded value, or null if it has never been valued. */
  latestValuedOn: string | null;
}

export type ValuationFinding =
  | { id: string; name: string; reason: 'never' }
  | { id: string; name: string; reason: 'stale'; daysSince: number };

function daysBetween(fromIso: string, toIso: string): number {
  const at = (iso: string) => { const [y, m, d] = iso.split('-').map(Number); return Date.UTC(y, m - 1, d); };
  return Math.round((at(toIso) - at(fromIso)) / 86_400_000);
}

/** Never-valued first, then the oldest; accounts within the threshold are not findings. */
export function staleValuations(accounts: readonly ValuedAccount[], today: string): ValuationFinding[] {
  const findings: ValuationFinding[] = [];
  for (const a of accounts) {
    if (a.latestValuedOn === null) findings.push({ id: a.id, name: a.name, reason: 'never' });
    else {
      const daysSince = daysBetween(a.latestValuedOn, today);
      if (daysSince >= VALUATION_STALE_DAYS) findings.push({ id: a.id, name: a.name, reason: 'stale', daysSince });
    }
  }
  const rank = (f: ValuationFinding) => (f.reason === 'never' ? Infinity : f.daysSince);
  return findings.sort((x, y) => rank(y) - rank(x));
}

/** One finding as a sentence, for the dashboard card and the daily email alike. */
export function valuationFindingText(f: ValuationFinding): string {
  return f.reason === 'never'
    ? `${f.name} has never been valued — upload a statement or enter its value.`
    : `${f.name} was last valued ${f.daysSince} days ago — upload its latest statement.`;
}
