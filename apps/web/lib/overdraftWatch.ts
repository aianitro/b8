import db from './db';
import { createLogger } from './logger';
import { stepEpisodes, type CashObservation, type WatchSettings } from './domain/overdraft';
import { sendWebPush } from './webPush';

const log = createLogger('overdraftWatch');
const round = (n: number) => Math.round(n * 100) / 100;

/**
 * Overdraft watch — the I/O. Rules in lib/domain/overdraft.ts.
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

    const [settingsRes, openRes] = await Promise.all([
      db.query<{ id: string; overdraft_watch: boolean; overdraft_cushion: string }>(
        `SELECT id, overdraft_watch, overdraft_cushion::text FROM accounts WHERE id = ANY($1) AND type = 'depository'`, [ids]),
      db.query<{ account_id: string }>(
        'SELECT account_id FROM overdraft_episodes WHERE closed_at IS NULL AND account_id = ANY($1)', [ids]),
    ]);
    const settings = new Map<string, WatchSettings>(settingsRes.rows.map((r) => [r.id, { watch: r.overdraft_watch, cushion: Number(r.overdraft_cushion) }]));
    const open = new Set(openRes.rows.map((r) => r.account_id));

    for (const step of stepEpisodes(observations, settings, open)) {
      if (step.kind === 'open') {
        // The cushion it opened against is kept with it: the account's own can change later.
        await db.query(
          `INSERT INTO overdraft_episodes (account_id, cushion, low_balance, last_balance) VALUES ($1, $2, $3, $3)
           ON CONFLICT (account_id) WHERE closed_at IS NULL DO NOTHING`,
          [step.accountId, settings.get(step.accountId)!.cushion, round(step.balance)]);
      } else if (step.kind === 'update') {
        await db.query(
          `UPDATE overdraft_episodes SET last_balance = $2, low_balance = LEAST(low_balance, $2), last_seen_at = NOW()
            WHERE account_id = $1 AND closed_at IS NULL`, [step.accountId, round(step.balance)]);
      } else {
        // The close time only: last_balance stays the last reading BELOW the cushion.
        await db.query('UPDATE overdraft_episodes SET closed_at = NOW() WHERE account_id = $1 AND closed_at IS NULL', [step.accountId]);
      }
    }

    // Every open episode not yet on a device — just opened, or opened earlier when no device took
    // it — gets the ping. One ping however many accounts: it says "open the app", once. A closed
    // episode never pushed is never pushed late, and a switched-off account is not pushed at all.
    const unpushed = await db.query<{ id: number }>(
      `SELECT e.id FROM overdraft_episodes e JOIN accounts a ON a.id = e.account_id
        WHERE e.closed_at IS NULL AND e.pushed_at IS NULL AND a.overdraft_watch`);
    if (unpushed.rows.length === 0) return;
    const delivered = await sendWebPush('high');
    log.info('overdraft ping', { episodes: unpushed.rows.length, devices: delivered });
    if (delivered > 0) {
      await db.query('UPDATE overdraft_episodes SET pushed_at = NOW() WHERE id = ANY($1)', [unpushed.rows.map((r) => r.id)]);
    }
  } catch (err) {
    log.error('overdraft watch failed', { error: err instanceof Error ? err.message : String(err) });
  }
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
