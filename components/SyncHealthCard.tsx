import { AlertTriangle, CheckCircle2 } from 'lucide-react';
import db from '@/lib/db';
import SyncHealthChart, { type SyncHealthData } from './charts/SyncHealthChart';
import CollapsibleSection from './CollapsibleSection';
import { classifySyncHealth, type SyncItemInput } from '@/lib/domain/syncHealth';

interface Row {
  day: string;
  plain: string;
  force: string;
  errors: string;
}

async function getSyncActivity(): Promise<{ data: SyncHealthData[]; totalRuns: number }> {
  const [rowsResult, runsResult] = await Promise.all([
    db.query<Row>(`
      SELECT
        TO_CHAR(DATE_TRUNC('day', ran_at), 'Mon DD')                        AS day,
        COALESCE(SUM(synced) FILTER (WHERE phase = 'plain'), 0)::text       AS plain,
        COALESCE(SUM(synced) FILTER (WHERE phase = 'force'), 0)::text       AS force,
        COALESCE(SUM(errors), 0)::text                                      AS errors
      FROM sync_log
      WHERE ran_at > NOW() - INTERVAL '30 days'
      GROUP BY DATE_TRUNC('day', ran_at)
      ORDER BY DATE_TRUNC('day', ran_at)
    `),
    db.query<{ count: string }>(
      `SELECT COUNT(*)::text AS count FROM sync_log WHERE ran_at > NOW() - INTERVAL '30 days'`
    ),
  ]);

  return {
    data: rowsResult.rows.map((r) => ({
      day: r.day, plain: Number(r.plain), force: Number(r.force), errors: Number(r.errors),
    })),
    totalRuns: Number(runsResult.rows[0]?.count ?? 0),
  };
}

// One row per Plaid Item (one bank login), because that is the unit that fails and the unit
// re-auth applies to. Grouped by access_token, but the token itself never leaves this function
// — it is the credential. The key sent onward is a representative account id, which is already
// public (it appears in /accounts/[id] URLs).
async function getItems(): Promise<SyncItemInput[]> {
  const result = await db.query<{ key: string; bank: string | null; account_count: string; last_synced_at: Date | null }>(`
    SELECT MIN(id)               AS key,
           MIN(bank)             AS bank,
           COUNT(*)::text        AS account_count,
           MAX(last_synced_at)   AS last_synced_at
      FROM accounts
     WHERE access_token IS NOT NULL
     GROUP BY access_token
  `);
  return result.rows.map((r) => ({
    key: r.key,
    bank: r.bank,
    accountCount: Number(r.account_count),
    lastSyncedAt: r.last_synced_at,
  }));
}

export default async function SyncHealthCard() {
  const [{ data, totalRuns }, items] = await Promise.all([getSyncActivity(), getItems()]);

  if (items.length === 0 && totalRuns === 0) return null;

  const health = classifySyncHealth(items);
  const unhealthy = health.filter((h) => h.status !== 'ok');
  const staleAccounts = unhealthy.reduce((s, h) => s + h.accountCount, 0);

  const totalPlain = data.reduce((s, d) => s + d.plain, 0);
  const totalForce = data.reduce((s, d) => s + d.force, 0);
  const totalErrors = data.reduce((s, d) => s + d.errors, 0);

  return (
    <div className="mt-6 space-y-3">
      {unhealthy.length > 0 ? (
        <div className="border border-amber-200 bg-amber-50 rounded-2xl p-5">
          <div className="flex items-start gap-3">
            <AlertTriangle size={16} className="text-amber-600 shrink-0 mt-0.5" />
            <div className="min-w-0 flex-1">
              <p className="text-sm font-semibold text-amber-900">
                {unhealthy.length} connection{unhealthy.length === 1 ? '' : 's'} not syncing
                {staleAccounts > 0 && ` · ${staleAccounts} account${staleAccounts === 1 ? '' : 's'} affected`}
              </p>
              <p className="text-xs text-amber-700/80 mt-0.5">
                A connection stops updating when its bank login needs re-authorizing. Transactions
                and balances behind it are frozen until it is reconnected — nothing is lost, but
                nothing new arrives either.
              </p>

              <ul className="space-y-1.5 mt-3">
                {unhealthy.map((h) => (
                  <li key={h.key} className="flex items-center justify-between gap-4 text-xs">
                    <span className="font-medium text-amber-900 truncate">{h.bank}</span>
                    <span className="flex items-center gap-3 shrink-0">
                      <span className="text-amber-700/70">
                        {h.accountCount} account{h.accountCount === 1 ? '' : 's'}
                      </span>
                      <span className="font-semibold text-amber-900 w-28 text-right">
                        {h.status === 'never' ? 'never synced' : `${h.daysStale} days ago`}
                      </span>
                    </span>
                  </li>
                ))}
              </ul>

              <p className="text-[11px] text-amber-700/70 mt-3">
                Use <span className="font-medium">Connect</span> above and pick the same bank to
                re-authorize it — existing accounts are matched back to their history rather than
                duplicated.
              </p>
            </div>
          </div>
        </div>
      ) : (
        <div className="flex items-center gap-2 text-xs text-slate-400 px-1">
          <CheckCircle2 size={13} className="text-emerald-500 shrink-0" />
          All {health.length} connection{health.length === 1 ? '' : 's'} syncing normally.
        </div>
      )}

      {/* Demoted behind a toggle. This chart answers an engineering question — is the plain
          sync phase earning its keep next to force refresh (see lib/scheduler.ts) — which is
          worth being able to check, but is not what someone opening this page is looking for.
          The per-connection status above is. */}
      {totalRuns > 0 && (
        <CollapsibleSection
          title="Sync activity"
          summary={`${totalRuns} runs · ${totalPlain} found by plain, ${totalForce} by force${totalErrors > 0 ? ` · ${totalErrors} errors` : ''}`}
        >
          <SyncHealthChart data={data} />
          <p className="text-xs text-slate-400 mt-3">
            {totalPlain === 0 && totalForce > 0
              ? 'Plain sync has found nothing force refresh did not already catch — the plain phase may be droppable.'
              : `Plain sync found ${totalPlain} transaction${totalPlain === 1 ? '' : 's'} on its own vs ${totalForce} by force refresh, so both phases are earning their place.`}
            {totalErrors > 0 && ` ${totalErrors} run-level error${totalErrors === 1 ? '' : 's'} in this window — sync_log records these as a per-run total, so the per-connection status above is the place to see which one is affected.`}
          </p>
        </CollapsibleSection>
      )}
    </div>
  );
}
