/**
 * Overdraft watch — the pure rules. Tables in migrations/1792000000000_overdraft-watch.sql; the I/O
 * is lib/overdraftWatch.ts.
 *
 * An overdraft fee is the one cost in this ledger that is pure waste and avoidable with a day's
 * notice, so this watches every linked cash account at each sync and says so the moment one falls
 * below its cushion (zero unless the owner set one).
 *
 * ─── Which balance ────────────────────────────────────────────────────────────────────────────
 *
 * The LOWER of Plaid's available and current. Pending debits are what trigger the fee and `current`
 * lags them, so available is usually the honest one — but a bank that folds an overdraft line into
 * available reports it ABOVE current, and then current is the truth. Taking the lower of the two
 * errs toward warning, which is the side to err on for a fee.
 *
 * ─── Episodes, not days ───────────────────────────────────────────────────────────────────────
 *
 * One EPISODE per stretch an account spends below its cushion. The push goes out once, when the
 * episode opens — or on the next sync, if that attempt reached no device — and not again until the
 * account recovers and falls back. A balance sitting below zero for a week is one message, not
 * seven; the bell carries it for the rest of the week.
 */

/** One cash account as Plaid reported it on this sync. */
export interface CashObservation {
  accountId: string;
  current: number | null;
  available: number | null;
}

/** The owner's per-account settings. */
export interface WatchSettings {
  watch: boolean;
  cushion: number;
}

/** The balance watched: the lower of the two Plaid reports, or null when it reported neither. */
export function watchedBalance(o: CashObservation): number | null {
  const figures = [o.current, o.available].filter((v): v is number => typeof v === 'number' && Number.isFinite(v));
  return figures.length === 0 ? null : Math.min(...figures);
}

export type EpisodeStep =
  | { kind: 'open'; accountId: string; balance: number }
  | { kind: 'update'; accountId: string; balance: number }
  | { kind: 'close'; accountId: string; balance: number };

/**
 * What this sync's observations do to the episodes.
 *
 * - below the cushion, nothing open → OPEN one;
 * - below, one open → UPDATE it (its low and last balance);
 * - at or above, one open → CLOSE it.
 *
 * Left exactly as it was — no news is not a recovery — when Plaid reported neither balance, and
 * when the owner has switched the watch off: an episode is closed by a balance back above the
 * cushion and by nothing else (migrations/1792000000000_overdraft-watch.sql). Switched off, it is
 * simply not shown and not pushed.
 */
export function stepEpisodes(
  observations: readonly CashObservation[],
  settings: ReadonlyMap<string, WatchSettings>,
  open: ReadonlySet<string>,
): EpisodeStep[] {
  const steps: EpisodeStep[] = [];
  for (const o of observations) {
    const s = settings.get(o.accountId);
    if (!s || !s.watch) continue;
    const balance = watchedBalance(o);
    if (balance === null) continue;
    const below = Math.round(balance * 100) < Math.round(s.cushion * 100);
    if (below) steps.push({ kind: open.has(o.accountId) ? 'update' : 'open', accountId: o.accountId, balance });
    else if (open.has(o.accountId)) steps.push({ kind: 'close', accountId: o.accountId, balance });
  }
  return steps;
}

/** One sync's projection for an account, as `./cashForecast`'s `projectBalance` returns it. */
export interface ForecastInput {
  low: number;
  lowOn: string;
  charges: { label: string; amount: number; on: string }[];
}

export type ForecastStep =
  | { kind: 'open' | 'refresh'; accountId: string; cushion: number; balance: number; projection: ForecastInput }
  | { kind: 'close'; accountId: string; reason: 'cleared' | 'episode' };

/**
 * What this sync's projections do to the forecasts (migrations/1792100000000_overdraft-forecast.sql).
 *
 * - an episode is open after this sync's steps → CLOSE any open forecast as `episode` and open
 *   none: the account is already below, and the episode carries it from here;
 * - projected low strictly below the cushion → OPEN one, or REFRESH the open one whole;
 * - at or above, one open → CLOSE it as `cleared`. An account with no projection (no steady series)
 *   is flat, which clears.
 *
 * As with episodes, an account not observed, with the watch off, or with no balance is left alone.
 */
export function stepForecasts(
  observations: readonly CashObservation[],
  settings: ReadonlyMap<string, WatchSettings>,
  episodeOpen: ReadonlySet<string>,
  forecastOpen: ReadonlySet<string>,
  projections: ReadonlyMap<string, ForecastInput>,
): ForecastStep[] {
  const steps: ForecastStep[] = [];
  const cents = (n: number) => Math.round(n * 100);
  for (const o of observations) {
    const s = settings.get(o.accountId);
    if (!s || !s.watch) continue;
    const balance = watchedBalance(o);
    if (balance === null) continue;
    const isOpen = forecastOpen.has(o.accountId);
    if (episodeOpen.has(o.accountId)) {
      if (isOpen) steps.push({ kind: 'close', accountId: o.accountId, reason: 'episode' });
      continue;
    }
    const p = projections.get(o.accountId);
    if (p && cents(p.low) < cents(s.cushion) && p.charges.length > 0) {
      steps.push({ kind: isOpen ? 'refresh' : 'open', accountId: o.accountId, cushion: s.cushion, balance, projection: p });
    } else if (isOpen) {
      steps.push({ kind: 'close', accountId: o.accountId, reason: 'cleared' });
    }
  }
  return steps;
}
