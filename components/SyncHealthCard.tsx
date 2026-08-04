import db from '@/lib/db';
import SyncHealthChart, { type SyncHealthData } from './charts/SyncHealthChart';

interface Row {
  day: string;
  plain: string;
  force: string;
  errors: string;
}

async function getSyncHealth(): Promise<{ data: SyncHealthData[]; totalRuns: number }> {
  const [rowsResult, runsResult] = await Promise.all([
    db.query<Row>(`
      SELECT
        TO_CHAR(DATE_TRUNC('day', ran_at), 'Mon DD')                        AS day,
        COALESCE(SUM(synced) FILTER (WHERE phase = 'plain'), 0)::text       AS plain,
        COALESCE(SUM(synced) FILTER (WHERE phase = 'force'), 0)::text       AS force,
        COALESCE(SUM(errors), 0)::text                                     AS errors
      FROM sync_log
      WHERE ran_at > NOW() - INTERVAL '30 days'
      GROUP BY DATE_TRUNC('day', ran_at)
      ORDER BY DATE_TRUNC('day', ran_at)
    `),
    db.query<{ count: string }>(
      `SELECT COUNT(*)::text AS count FROM sync_log WHERE ran_at > NOW() - INTERVAL '30 days'`
    ),
  ]);

  const data = rowsResult.rows.map((r) => ({
    day: r.day,
    plain: Number(r.plain),
    force: Number(r.force),
    errors: Number(r.errors),
  }));

  return { data, totalRuns: Number(runsResult.rows[0]?.count ?? 0) };
}

export default async function SyncHealthCard() {
  const { data, totalRuns } = await getSyncHealth();

  if (totalRuns === 0) return null;

  const totalPlain = data.reduce((s, d) => s + d.plain, 0);
  const totalForce = data.reduce((s, d) => s + d.force, 0);
  const totalErrors = data.reduce((s, d) => s + d.errors, 0);

  // The open question this answers (see lib/scheduler.ts): does the plain-sync phase ever
  // find transactions the force-refresh phase wouldn't have caught on its own?
  const verdict = totalErrors > 0
    ? `${totalErrors} sync error${totalErrors === 1 ? '' : 's'} in the last 30 days across ${totalRuns} run${totalRuns === 1 ? '' : 's'} — check accounts for a stale connection.`
    : totalPlain === 0 && totalForce > 0
    ? `Plain sync hasn't found anything force refresh didn't already catch in the last 30 days (${totalRuns} run${totalRuns === 1 ? '' : 's'}) — the plain phase may be droppable.`
    : totalPlain > 0
    ? `Plain sync has caught ${totalPlain} transaction${totalPlain === 1 ? '' : 's'} on its own in the last 30 days that force refresh would've had to find otherwise.`
    : `${totalRuns} sync run${totalRuns === 1 ? '' : 's'} in the last 30 days, nothing new to report yet.`;

  return (
    <div className="mt-6">
      <SyncHealthChart data={data} />
      <p className={`text-xs mt-3 ${totalErrors > 0 ? 'text-red-500' : 'text-slate-400'}`}>{verdict}</p>
    </div>
  );
}
