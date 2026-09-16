import { runSync } from './sync';
import { runDailyDigest } from './dailyDigest';
import { writeNetWorthSnapshot } from './netWorth';
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

/**
 * The whole daily job: sync, snapshot, digest. Exported so a PROCESS can be the scheduler.
 *
 * `scripts/daily-job.ts` calls exactly this and exits, which is what `npm run job:daily` and the
 * OS timer run. The in-process timer below calls the same function, so there is one definition of
 * "the daily job" and not two that drift.
 */
export async function runDailyJob() {
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
  // No try here, and that is not an oversight: `runDailyDigest` resolves rather than rejects, by
  // construction, because a mail outage must never cost the sync or the snapshot above it. Its own
  // catch is in `lib/dailyDigest.ts` where the failure can also be classified and recorded.
  //
  // No new timer, deliberately. The mail rides this job rather than scheduling itself: two timers
  // would be two ideas of "daily" and two things for Phase 2 step 20's OS cron to find and retire.
  // `runDailyDigest` is exported and contains no timer of its own, so step 20's work is to point
  // cron at it and delete the in-process timer below — in a file step 20 is already rewriting.
  //
  // THIS REPLACED `runBreachAlert`, which the owner read and called "not informative, not
  // actionable". The guardrail modules are still in the tree and still tested; nothing schedules
  // them. Two emails a day from one app is one email a day that gets filtered.
  //
  // ─── THIS TIMER HOLDS THE CODE IT WAS BORN WITH, AND THAT HAS ALREADY COST A SEND ──────────
  //
  // On 2026-09-15 the 06:00 digest went out in the previous evening's template — no bubbles widget,
  // and wording the owner had already had changed. Nothing was wrong with the code, which was
  // correct and committed hours earlier. What was wrong is WHEN it was read.
  //
  // `instrumentation.ts` runs once at server boot and registers the interval below. Every import
  // reachable from this file is resolved at that moment, so the timer's closure holds the module
  // graph as the process found it at startup. Next's hot reload swaps modules for incoming HTTP
  // REQUESTS; it does not reach inside a timer registered before the change. The dev server had
  // started at 16:50 and the bubbles landed at 17:03, so the timer spent the night holding a build
  // from thirteen minutes before the feature existed.
  //
  // A LAZY `await import('./dailyDigest')` HERE DOES NOT FIX IT, and that is measured rather than
  // assumed: a probe module dynamically imported from a boot-registered interval kept returning its
  // boot-time value for a minute after the file on disk had changed. Next's module cache for this
  // context is not invalidated by the edit. Do not re-attempt that fix.
  //
  // What actually works, in order of durability:
  //   1. Restart the dev server after changing anything the digest renders. Manual, and the only
  //      thing available today.
  //   2. Phase 2 step 20's OS cron, which starts a process per run and therefore cannot hold a
  //      stale anything. That is the cure, and this is now a reason to bring it forward.
  await runDailyDigest();
}

// Runs inside the Next.js server process — only active while the server is up.
// If the laptop is asleep or the server isn't running at the scheduled hour, that
// day's run is skipped; the next sync (scheduled or manual) picks up from wherever
// the cursor + reconciliation left off, so nothing is lost, just delayed.
/**
 * Registers the in-process daily timer — unless an OS timer has taken over.
 *
 * ─── THIS TIMER HAS SHIPPED THE WRONG EMAIL TWICE ─────────────────────────────────────────────
 *
 * On 2026-09-15 and again on 09-16 the 06:00 digest went out in a template that was hours or days
 * out of date, while the code on disk had been correct and committed the whole time. The cause is
 * structural and is documented at the call site below: this timer is registered at server boot and
 * its closure holds the module graph as the process found it then. Next's hot reload swaps modules
 * for HTTP requests and never reaches inside a timer. Restarting the server fixes it exactly until
 * the next edit, which is why "remember to restart" failed twice.
 *
 * `SCHEDULER_IN_PROCESS=false` turns this off so an OS timer can own the job instead. A new process
 * per run cannot hold stale anything — that is the entire fix, and it is Phase 2 step 20.
 *
 * DEFAULT IS ON. A default of off would mean that anyone who has not installed the OS timer
 * silently gets no sync, no snapshot and no mail, which is a worse failure than a stale template
 * because nothing arrives to look wrong.
 */
export function startDailySyncScheduler(hour = 6) {
  if (process.env.SCHEDULER_IN_PROCESS === 'false') {
    log.info('in-process scheduler disabled; an OS timer is expected to run the daily job');
    return;
  }
  if (started) return; // guard against duplicate timers across hot-reloads
  started = true;

  const delay = msUntilNextRun(hour);
  log.info('daily Plaid sync scheduled', { hour, firstRunInMin: Math.round(delay / 60000) });

  setTimeout(() => {
    void runDailyJob();
    setInterval(() => void runDailyJob(), DAILY_MS);
  }, delay);
}
