// Per-connection sync health (ROADMAP.md §1 "Account health/staleness indicator").
//
// Why staleness rather than the error count: lib/sync.ts advances accounts.last_synced_at only
// after syncItem() succeeds, so a timestamp that stops moving means that connection's syncs are
// *failing*, not merely finding nothing. sync_log's `errors` column, by contrast, is an
// aggregate per run with no per-item attribution — which is structurally why the old widget
// could only say "25 sync errors, check accounts" without ever naming which one. Staleness can
// name it, which is the difference between a statistic and something you can act on.
//
// A Plaid Item (one bank login) is the unit that fails, not an individual account: re-auth
// happens per Item, and when it lapses every account behind it goes stale together.

export type SyncStatus = 'ok' | 'stale' | 'never';

export interface SyncItemInput {
  /** Stable, non-secret identifier — an account id, never the access_token. */
  key: string;
  bank: string | null;
  accountCount: number;
  lastSyncedAt: Date | string | null;
}

export interface SyncItemHealth {
  key: string;
  bank: string;
  accountCount: number;
  /** Whole days since the last successful sync; null when it has never synced. */
  daysStale: number | null;
  status: SyncStatus;
}

/**
 * Two days, because the scheduler runs daily: one missed run is already a signal, but a single
 * day's gap can just be a run that hasn't fired yet today. Flagging at 2 catches a genuinely
 * broken connection on its second day rather than crying wolf every morning.
 */
export const STALE_AFTER_DAYS = 2;

export function classifySyncHealth(items: SyncItemInput[], now: Date = new Date()): SyncItemHealth[] {
  const classified = items.map((item) => {
    if (item.lastSyncedAt === null) {
      return { key: item.key, bank: item.bank ?? 'Unknown', accountCount: item.accountCount, daysStale: null, status: 'never' as const };
    }
    const ms = now.getTime() - new Date(item.lastSyncedAt).getTime();
    const daysStale = Math.floor(ms / 86_400_000);
    return {
      key: item.key,
      bank: item.bank ?? 'Unknown',
      accountCount: item.accountCount,
      daysStale,
      status: (daysStale >= STALE_AFTER_DAYS ? 'stale' : 'ok') as SyncStatus,
    };
  });

  // Worst first, and never-synced above merely-stale: a connection that has never worked is a
  // different (usually setup) problem from one that stopped working, and burying it under a
  // 3-day-old item would be the wrong order of attention.
  return classified.sort((a, b) => {
    if (a.status === 'never' && b.status !== 'never') return -1;
    if (b.status === 'never' && a.status !== 'never') return 1;
    return (b.daysStale ?? 0) - (a.daysStale ?? 0);
  });
}
