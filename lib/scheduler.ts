import { runSync } from './sync';
import { writeNetWorthSnapshot } from './netWorth';
import { runBreachAlert } from './breachAlert';
import { createLogger } from './logger';

const log = createLogger('scheduler');
const DAILY_MS = 24 * 60 * 60 * 1000;
let started = false;

function msUntilNextRun(hour: number): number {
  const next = new Date();
  next.setHours(hour, 0, 0, 0);
  if (next <= new Date()) next.setDate(next.getDate() + 1);
  return next.getTime() - Date.now();
}

async function runAndLog() {
  try {
    // Plain sync first, so its transaction count reflects only what Plaid's own
    // background refresh already had cached — then force refresh right after, so its
    // count reflects only what forcing actually added beyond that. Both are written to
    // sync_log; if the plain phase stays at 0 over time, "Sync Now" isn't pulling
    // anything Plaid wasn't already going to give us and can be dropped.
    const plain = await runSync({ force: false, trigger: 'scheduler' });
    log.info('plain sync phase', { ...plain });

    const forced = await runSync({ force: true, trigger: 'scheduler' });
    log.info('force refresh phase', { ...forced });
  } catch (err) {
    log.error('daily sync failed', { error: err instanceof Error ? err.message : String(err) });
  }

  // Snapshotted after the syncs, and outside their try, for two reasons: it should reflect
  // balances the run just pulled, and a failed sync still leaves a worth-recording position —
  // yesterday's data is a truer snapshot than a missing day. Upserts on date, so the two sync
  // phases plus any manual run collapse into one row.
  try {
    await writeNetWorthSnapshot();
  } catch (err) {
    log.error('net worth snapshot failed', { error: err instanceof Error ? err.message : String(err) });
  }

  // Last, and after the syncs, so the outlook it reads is computed over the transactions this run
  // just pulled rather than yesterday's — an alert about a month the job has not finished loading
  // is an alert about the wrong month.
  //
  // No try here, and that is not an oversight: `runBreachAlert` resolves rather than rejects, by
  // construction, because a mail outage must never cost the sync or the snapshot above it. Its own
  // catch is in `lib/breachAlert.ts` where the failure can also be classified and recorded.
  //
  // No new timer, deliberately. The alert rides this job rather than scheduling itself: two timers
  // would be two ideas of "daily" and two things for Phase 2 step 20's OS cron to find and retire.
  // `runBreachAlert` is exported and contains no timer of its own, so step 20's work is to point
  // cron at it and delete the in-process timer below — in a file step 20 is already rewriting.
  await runBreachAlert();
}

// Runs inside the Next.js server process — only active while the server is up.
// If the laptop is asleep or the server isn't running at the scheduled hour, that
// day's run is skipped; the next sync (scheduled or manual) picks up from wherever
// the cursor + reconciliation left off, so nothing is lost, just delayed.
export function startDailySyncScheduler(hour = 6) {
  if (started) return; // guard against duplicate timers across hot-reloads
  started = true;

  const delay = msUntilNextRun(hour);
  log.info('daily Plaid sync scheduled', { hour, firstRunInMin: Math.round(delay / 60000) });

  setTimeout(() => {
    runAndLog();
    setInterval(runAndLog, DAILY_MS);
  }, delay);
}
