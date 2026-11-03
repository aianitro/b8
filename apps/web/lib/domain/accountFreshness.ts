/**
 * How current one account's figure is — the line under the balance on its own page.
 *
 * ─── Why two timestamps and not one ───────────────────────────────────────────────────────────
 *
 * A synced account carries two different facts, and a reader who sees only one of them draws the
 * wrong conclusion from it:
 *
 *   - WHEN THE FEED LAST SUCCEEDED. Plaid's own `last_successful_update` for the item, not our
 *     `last_synced_at`: the sync job stamps the latter every time it runs, including runs where
 *     the call to Plaid failed, so it answers "did the job run" rather than "did data arrive".
 *   - WHEN THE FIGURE LAST MOVED. `recordPlaidBalances` appends a valuation only when the balance
 *     has CHANGED, so a brokerage's newest row is Friday's close all weekend. Read alone that
 *     looks like a feed that died on Friday; it is a market that was shut.
 *
 * Saying both distinguishes the two, which is the whole point: "Synced today at 6:00 AM · value
 * last changed Oct 31" is a healthy weekend, and the same second half without the first is not.
 *
 * ─── What each kind of account gets ───────────────────────────────────────────────────────────
 *
 * A hand-kept valued account has no feed, so it gets the date it was last valued — the fact its
 * own staleness rule is built on (see valuationStaleness.ts, which decides when that date is old
 * enough to nag about; this module only reports it).
 *
 * A hand-kept LEDGER account gets nothing. Its balance is the sum of rows the owner imports, each
 * carrying its own date, and there is no moment at which that balance was "confirmed" by anyone.
 *
 * Dates are rendered in an explicit zone rather than the process's own, so the page and its tests
 * agree about which day a 6 AM sync fell on wherever either happens to run.
 */

export interface FreshnessInput {
  /** Whether Plaid holds a token for this account. */
  linked: boolean;
  valuationMode: 'ledger' | 'valuation';
  /** Plaid's last successful pull for the item this account belongs to. */
  lastSuccessfulUpdate: Date | null;
  /** Plaid's last failed pull for that item. */
  lastFailedUpdate: Date | null;
  /** When our own sync job last walked this account, whatever came of it. */
  lastSyncedAt: Date | null;
  /** The newest recorded valuation, whatever recorded it. */
  latestObservationAt: Date | null;
}

export interface AccountFreshness {
  /** `warn` is a feed that last failed, or a figure that was never recorded at all. */
  tone: 'ok' | 'warn';
  /** The line as shown. */
  text: string;
  /** The same facts with full dates and times, for the element's title. */
  title: string;
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** The calendar date a moment falls on in `timeZone`, as `YYYY-MM-DD`. */
function dayIn(d: Date, timeZone: string): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(d);
}

/** The clock time in `timeZone`, e.g. `6:00 AM`. */
function clockIn(d: Date, timeZone: string): string {
  return new Intl.DateTimeFormat('en-US', { timeZone, hour: 'numeric', minute: '2-digit' }).format(d);
}

/** The calendar day before `iso`, by date arithmetic — a DST day is not 24 hours long. */
function dayBefore(iso: string): string {
  const [y, m, d] = iso.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d - 1)).toISOString().slice(0, 10);
}

/** `Oct 31`, or `Oct 31, 2025` once the year is not the one being read in. */
function monthDay(iso: string, todayIso: string): string {
  const [y, m, d] = iso.split('-').map(Number);
  return y === Number(todayIso.slice(0, 4)) ? `${MONTHS[m - 1]} ${d}` : `${MONTHS[m - 1]} ${d}, ${y}`;
}

/**
 * `today at 6:00 AM` while the time of day still tells the reader something, and a bare date once
 * it does not: "Oct 26 at 6:00 AM" is two facts where one was wanted.
 */
function whenLabel(at: Date, now: Date, timeZone: string): string {
  const day = dayIn(at, timeZone);
  const today = dayIn(now, timeZone);
  if (day === today) return `today at ${clockIn(at, timeZone)}`;
  if (day === dayBefore(today)) return `yesterday at ${clockIn(at, timeZone)}`;
  return monthDay(day, today);
}

/** `Nov 2, 2026 at 6:00 AM` — the unabbreviated form, for the title. */
function fullLabel(at: Date, timeZone: string): string {
  const [y, m, d] = dayIn(at, timeZone).split('-').map(Number);
  return `${MONTHS[m - 1]} ${d}, ${y} at ${clockIn(at, timeZone)}`;
}

export function accountFreshness(input: FreshnessInput, now: Date, timeZone: string): AccountFreshness | null {
  const { linked, valuationMode, lastSuccessfulUpdate, lastFailedUpdate, lastSyncedAt, latestObservationAt } = input;
  const valued = valuationMode === 'valuation';

  if (!linked) {
    if (!valued) return null;
    return latestObservationAt
      ? {
          tone: 'ok',
          text: `Last valued ${whenLabel(latestObservationAt, now, timeZone)}`,
          title: `Value last recorded ${fullLabel(latestObservationAt, timeZone)}.`,
        }
      : { tone: 'warn', text: 'Never valued', title: 'No value has ever been recorded for this account.' };
  }

  // A failure that is newer than the last success, or one with no success behind it at all. The
  // other way round — a failure older than the last success — is a feed that already recovered,
  // and saying so would raise an alarm about a problem that is over.
  const failing = lastFailedUpdate !== null && (lastSuccessfulUpdate === null || lastFailedUpdate > lastSuccessfulUpdate);
  if (failing) {
    const failedAt = lastFailedUpdate!;
    return {
      tone: 'warn',
      text: lastSuccessfulUpdate
        ? `Last sync failed ${whenLabel(failedAt, now, timeZone)} · last good sync ${whenLabel(lastSuccessfulUpdate, now, timeZone)}`
        : `Last sync failed ${whenLabel(failedAt, now, timeZone)} · never synced successfully`,
      title: lastSuccessfulUpdate
        ? `Last failed update ${fullLabel(failedAt, timeZone)}. Last successful update ${fullLabel(lastSuccessfulUpdate, timeZone)}.`
        : `Last failed update ${fullLabel(failedAt, timeZone)}. This account has never synced successfully.`,
    };
  }

  // Plaid's reading where there is one; failing that, the run our own job recorded. A linked
  // account with neither has been connected and not yet walked.
  const confirmedAt = lastSuccessfulUpdate ?? lastSyncedAt;
  if (!confirmedAt) {
    return { tone: 'warn', text: 'Never synced', title: 'This account has not been synced yet.' };
  }

  // The second clause is for a valued account only: a ledger account's chart is drawn from its
  // transactions, not from the recorded valuations, so "value last changed" would date a figure
  // that is not the one above it. Dropped too when the figure moved at the very sync just named,
  // which the first clause has then already dated.
  const changed = valued && latestObservationAt && dayIn(latestObservationAt, timeZone) !== dayIn(confirmedAt, timeZone)
    ? latestObservationAt
    : null;

  return {
    tone: 'ok',
    text: changed
      ? `Synced ${whenLabel(confirmedAt, now, timeZone)} · value last changed ${whenLabel(changed, now, timeZone)}`
      : `Synced ${whenLabel(confirmedAt, now, timeZone)}`,
    title: changed
      ? `Last successful update ${fullLabel(confirmedAt, timeZone)}. Value last recorded ${fullLabel(changed, timeZone)}.`
      : `Last successful update ${fullLabel(confirmedAt, timeZone)}.`,
  };
}
