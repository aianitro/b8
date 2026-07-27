import { runSync } from './sync';

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
    console.log('[scheduler] plain sync phase:', plain);

    const forced = await runSync({ force: true, trigger: 'scheduler' });
    console.log('[scheduler] force refresh phase:', forced);
  } catch (err) {
    console.error('[scheduler] daily sync failed:', err instanceof Error ? err.message : err);
  }
}

// Runs inside the Next.js server process — only active while the server is up.
// If the laptop is asleep or the server isn't running at the scheduled hour, that
// day's run is skipped; the next sync (scheduled or manual) picks up from wherever
// the cursor + reconciliation left off, so nothing is lost, just delayed.
export function startDailySyncScheduler(hour = 6) {
  if (started) return; // guard against duplicate timers across hot-reloads
  started = true;

  const delay = msUntilNextRun(hour);
  console.log(`[scheduler] daily Plaid sync scheduled for ${hour}:00 local time (first run in ${Math.round(delay / 60000)} min)`);

  setTimeout(() => {
    runAndLog();
    setInterval(runAndLog, DAILY_MS);
  }, delay);
}
