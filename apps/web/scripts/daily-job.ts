/**
 * The daily job, as a process that starts, works and exits.
 *
 * This exists because the in-process timer could not be trusted to run current code. Registered at
 * server boot, its closure holds the module graph from that moment; a code change after boot is
 * invisible to it, and that shipped the wrong email on two consecutive mornings. A process started
 * per run has no such window — it reads the code as it is on disk, every time.
 *
 * Run by `npm run job:daily`, and by the OS timer that `docs/DEPLOY.md` installs.
 *
 * EXIT CODES MATTER HERE, unlike in the server: a timer with no exit code to read has no way to
 * tell "ran and failed" from "ran". `runDailyJob` resolves rather than rejects by construction —
 * a mail outage must not cost the sync — so a non-zero exit here means the job could not run at
 * all, not that one of its three parts failed. Those are reported in the log and in `alert_sends`.
 */
import db from '../lib/db';
import { createLogger } from '../lib/logger';
import { runDailyJob } from '../lib/scheduler';

const log = createLogger('daily-job');

async function main(): Promise<void> {
  const startedAt = Date.now();
  log.info('daily job starting', { pid: process.pid });
  await runDailyJob();
  log.info('daily job finished', { seconds: Math.round((Date.now() - startedAt) / 1000) });
}

main()
  .then(async () => {
    // Without this the pool keeps the event loop alive and a cron run never exits, which over a
    // month is thirty stuck processes rather than one visible failure.
    await db.end();
    process.exit(0);
  })
  .catch(async (err) => {
    log.error('daily job could not run', { error: err instanceof Error ? err.message : String(err) });
    await db.end().catch(() => {});
    process.exit(1);
  });
