import db from './db';
import { jobHealth, type JobHealth } from './domain/jobHealth';

/**
 * When the daily job last ran, and what that means.
 *
 * Read from `sync_log` rather than from a heartbeat table of its own: every scheduler run already
 * writes rows there, and a second record of one event is two things that can disagree about whether
 * it happened — which is the failure this repo has had before, aimed here at the one signal whose
 * entire purpose is to be trusted.
 *
 * Scoped to `trigger = 'scheduler'`, so pressing "Sync Now" does not make a week-old gap look
 * healthy. A manual sync is the owner doing the job's work by hand, which is evidence the job is
 * NOT running rather than evidence that it is.
 */
export async function loadJobHealth(now: Date = new Date()): Promise<JobHealth> {
  const { rows } = await db.query<{ ran_at: string }>(
    `SELECT ran_at::text FROM sync_log WHERE trigger = 'scheduler' ORDER BY ran_at DESC LIMIT 1`
  );
  const last = rows[0]?.ran_at;
  return jobHealth(last ? new Date(last) : null, now);
}
