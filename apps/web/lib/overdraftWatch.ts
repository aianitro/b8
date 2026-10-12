import db from './db';
import { createLogger } from './logger';
import { stepEpisodes, stepForecasts, watchedBalance, type CashObservation, type WatchSettings } from './domain/overdraft';
import { detectCashSeries, projectBalance, type CashProjection, type CashTxn } from './domain/cashForecast';
import { sendWebPush } from './webPush';

const log = createLogger('overdraftWatch');
const round = (n: number) => Math.round(n * 100) / 100;
/** History read for the forecast's series: enough for three monthly instalments and a late one. */
const HISTORY_DAYS = 120;

/**
 * Overdraft watch — the I/O. Rules in lib/domain/overdraft.ts and lib/domain/cashForecast.ts.
 *
 * Two warnings per cash account: an EPISODE while it is below its cushion, and a FORECAST while its
 * next week's recurring charges would take it there.
 *
 * Runs at the end of every sync's reconcile pass — the daily job's and every manual one — on the
 * balances Plaid has just reported, so a shortfall is seen the first time any sync sees it, not at
 * the next morning's job.
 *
 * THE PUSH IS THE APP'S CONSTANT PING, with no account and no figure in it: the owner's decision for
 * every push (lib/domain/pushPing.ts) is that nothing financial lands on a lock screen. The ping
 * opens the dashboard, whose warning bell names the account.
 *
 * Resolves, always: a failure here must never cost the sync its transactions.
 */
export async function checkOverdraft(observations: readonly CashObservation[]): Promise<void> {
  try {
    if (observations.length === 0) return;
    const ids = observations.map((o) => o.accountId);

    const [settingsRes, episodesRes, forecastsRes, todayRes] = await Promise.all([
      db.query<{ id: string; overdraft_watch: boolean; overdraft_cushion: string }>(
        `SELECT id, overdraft_watch, overdraft_cushion::text FROM accounts WHERE id = ANY($1) AND type = 'depository'`, [ids]),
      db.query<{ account_id: string }>(
        'SELECT account_id FROM overdraft_episodes WHERE closed_at IS NULL AND account_id = ANY($1)', [ids]),
      db.query<{ account_id: string }>(
        'SELECT account_id FROM overdraft_forecasts WHERE closed_at IS NULL AND account_id = ANY($1)', [ids]),
      // The database's calendar day, as the transactions are dated by it.
      db.query<{ today: string }>('SELECT CURRENT_DATE::text AS today'),
    ]);
    const settings = new Map<string, WatchSettings>(settingsRes.rows.map((r) => [r.id, { watch: r.overdraft_watch, cushion: Number(r.overdraft_cushion) }]));
    const episodeOpen = new Set(episodesRes.rows.map((r) => r.account_id));
    const forecastOpen = new Set(forecastsRes.rows.map((r) => r.account_id));
    const today = todayRes.rows[0].today;

    const episodeSteps = stepEpisodes(observations, settings, episodeOpen);
    // Open after this sync: what was open, plus what opens, minus what closes.
    const openAfter = new Set(episodeOpen);
    for (const e of episodeSteps) { if (e.kind === 'open') openAfter.add(e.accountId); if (e.kind === 'close') openAfter.delete(e.accountId); }

    const projections = await project(observations, settings, openAfter, today);
    const forecastSteps = stepForecasts(observations, settings, openAfter, forecastOpen, projections);

    // ONE TRANSACTION, so an episode opening and the forecast it supersedes closing land together.
    const client = await db.connect();
    try {
      await client.query('BEGIN');
      for (const step of episodeSteps) {
        if (step.kind === 'open') {
          // The cushion it opened against is kept with it: the account's own can change later.
          await client.query(
            `INSERT INTO overdraft_episodes (account_id, cushion, low_balance, last_balance) VALUES ($1, $2, $3, $3)
             ON CONFLICT (account_id) WHERE closed_at IS NULL DO NOTHING`,
            [step.accountId, settings.get(step.accountId)!.cushion, round(step.balance)]);
        } else if (step.kind === 'update') {
          await client.query(
            `UPDATE overdraft_episodes SET last_balance = $2, low_balance = LEAST(low_balance, $2), last_seen_at = NOW()
              WHERE account_id = $1 AND closed_at IS NULL`, [step.accountId, round(step.balance)]);
        } else {
          // The close time only: last_balance stays the last reading BELOW the cushion.
          await client.query('UPDATE overdraft_episodes SET closed_at = NOW() WHERE account_id = $1 AND closed_at IS NULL', [step.accountId]);
        }
      }
      for (const step of forecastSteps) {
        if (step.kind === 'close') {
          await client.query(
            `UPDATE overdraft_forecasts SET closed_at = NOW(), closed_reason = $2 WHERE account_id = $1 AND closed_at IS NULL`,
            [step.accountId, step.reason]);
          continue;
        }
        const args = [step.accountId, step.cushion, round(step.balance), round(step.projection.low), step.projection.lowOn, JSON.stringify(step.projection.charges)];
        if (step.kind === 'open') {
          await client.query(
            `INSERT INTO overdraft_forecasts (account_id, cushion, balance, projected_low, low_on, charges) VALUES ($1, $2, $3, $4, $5, $6)
             ON CONFLICT (account_id) WHERE closed_at IS NULL DO NOTHING`, args);
        } else {
          // Every projection column together, never a subset: the row describes one projection.
          await client.query(
            `UPDATE overdraft_forecasts SET cushion = $2, balance = $3, projected_low = $4, low_on = $5, charges = $6, projected_at = NOW()
              WHERE account_id = $1 AND closed_at IS NULL`, args);
        }
      }
      await client.query('COMMIT');
    } catch (err) {
      await client.query('ROLLBACK').catch(() => {});
      throw err;
    } finally {
      client.release();
    }

    await ping();
  } catch (err) {
    log.error('overdraft watch failed', { error: err instanceof Error ? err.message : String(err) });
  }
}

/**
 * Each candidate account's 7-day projection: watched, observed with a balance, and not already
 * below its cushion. Read from the account's own last four months.
 */
async function project(
  observations: readonly CashObservation[],
  settings: ReadonlyMap<string, WatchSettings>,
  openAfter: ReadonlySet<string>,
  today: string,
): Promise<Map<string, CashProjection>> {
  const balances = new Map<string, number>();
  for (const o of observations) {
    const b = watchedBalance(o);
    if (b !== null && settings.get(o.accountId)?.watch && !openAfter.has(o.accountId)) balances.set(o.accountId, b);
  }
  const out = new Map<string, CashProjection>();
  if (balances.size === 0) return out;
  const { rows } = await db.query<{ account_id: string; date: string; amount: string; label: string }>(
    `SELECT account_id, date::text, amount::text, COALESCE(NULLIF(merchant_name, ''), name, '') AS label
       FROM transactions WHERE account_id = ANY($1) AND date > $2::date - ${HISTORY_DAYS} AND date <= $2::date`,
    [[...balances.keys()], today]);
  const byAccount = new Map<string, CashTxn[]>();
  for (const r of rows) byAccount.set(r.account_id, [...(byAccount.get(r.account_id) ?? []), { date: r.date, amount: Number(r.amount), label: r.label }]);
  for (const [id, balance] of balances) {
    out.set(id, projectBalance(balance, detectCashSeries(byAccount.get(id) ?? [], today), today));
  }
  return out;
}

/**
 * The ping, for every open episode or forecast not yet on a device — just opened, or opened earlier
 * when no device took it. One ping however many: it says "open the app", once. High urgency when an
 * account is already below its cushion; normal for a forecast, which leaves days. A closed one is
 * never pushed late, and a switched-off account is not pushed at all.
 */
async function ping(): Promise<void> {
  const [episodes, forecasts] = await Promise.all([
    db.query<{ id: number }>(
      `SELECT e.id FROM overdraft_episodes e JOIN accounts a ON a.id = e.account_id
        WHERE e.closed_at IS NULL AND e.pushed_at IS NULL AND a.overdraft_watch`),
    db.query<{ id: number }>(
      `SELECT f.id FROM overdraft_forecasts f JOIN accounts a ON a.id = f.account_id
        WHERE f.closed_at IS NULL AND f.pushed_at IS NULL AND a.overdraft_watch`),
  ]);
  if (episodes.rows.length === 0 && forecasts.rows.length === 0) return;
  const delivered = await sendWebPush(episodes.rows.length > 0 ? 'high' : 'normal');
  log.info('overdraft ping', { episodes: episodes.rows.length, forecasts: forecasts.rows.length, devices: delivered });
  if (delivered === 0) return;
  await db.query('UPDATE overdraft_episodes SET pushed_at = NOW() WHERE id = ANY($1)', [episodes.rows.map((r) => r.id)]);
  await db.query('UPDATE overdraft_forecasts SET pushed_at = NOW() WHERE id = ANY($1)', [forecasts.rows.map((r) => r.id)]);
}

export interface OverdraftFinding {
  accountId: string;
  account: string;
  bank: string | null;
  balance: number;
  cushion: number;
  since: string;
  /** When `balance` was read: the last sync that saw it below the cushion. */
  seenAt: string;
}

/** The open episodes, for the dashboard's warning bell. */
export async function loadOverdrafts(): Promise<OverdraftFinding[]> {
  const { rows } = await db.query<{ account_id: string; name: string; bank: string | null; last_balance: string; overdraft_cushion: string; opened_at: string; last_seen_at: string }>(`
    SELECT e.account_id, a.name, a.bank, e.last_balance::text, a.overdraft_cushion::text, e.opened_at::text, e.last_seen_at::text
      FROM overdraft_episodes e JOIN accounts a ON a.id = e.account_id
     WHERE e.closed_at IS NULL AND a.overdraft_watch
     ORDER BY e.last_balance`);
  return rows.map((r) => ({
    accountId: r.account_id, account: r.name, bank: r.bank,
    balance: Number(r.last_balance), cushion: Number(r.overdraft_cushion), since: r.opened_at, seenAt: r.last_seen_at,
  }));
}

export interface ForecastFinding {
  accountId: string;
  account: string;
  bank: string | null;
  cushion: number;
  low: number;
  lowOn: string;
  charges: { label: string; amount: number; on: string }[];
  /** When the projection was made — the last sync that saw it coming. */
  projectedAt: string;
}

/** The open forecasts, for the dashboard's warning bell. */
export async function loadForecasts(): Promise<ForecastFinding[]> {
  const { rows } = await db.query<{ account_id: string; name: string; bank: string | null; cushion: string; projected_low: string; low_on: string; charges: { label: string; amount: number; on: string }[]; projected_at: string }>(`
    SELECT f.account_id, a.name, a.bank, f.cushion::text, f.projected_low::text, f.low_on::text, f.charges, f.projected_at::text
      FROM overdraft_forecasts f JOIN accounts a ON a.id = f.account_id
     WHERE f.closed_at IS NULL AND a.overdraft_watch
     ORDER BY f.low_on, f.projected_low`);
  return rows.map((r) => ({
    accountId: r.account_id, account: r.name, bank: r.bank, cushion: Number(r.cushion),
    low: Number(r.projected_low), lowOn: r.low_on, charges: r.charges, projectedAt: r.projected_at,
  }));
}
