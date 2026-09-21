/**
 * Did the daily job run when it should have?
 *
 * ─── What an "uptime check" can and cannot be on one machine ──────────────────────────────────
 *
 * ROADMAP.md step 20 asks for an uptime check. The usual shape is an external service that expects
 * a ping and shouts when one does not arrive — and that is the only shape that can report a machine
 * being off, because a check running ON the machine cannot speak while the machine is silent. It is
 * also a third party holding a signal about this household's app, which is a `BUILD.md` §5.1
 * escalation nobody has made.
 *
 * So this is the honest local half: it cannot tell you the job is not running right now, but it can
 * tell you, the moment you next look, that it did not run yesterday. On a laptop that closes at
 * night, "yesterday was missed" is the finding that actually occurs; "the machine is off" is
 * something the owner already knows.
 *
 * ─── Derived from `sync_log`, deliberately, rather than from a new heartbeat table ────────────
 *
 * Every scheduler run already writes two rows there with a timestamp. A separate heartbeat table
 * would be a second record of the same event, and the two would eventually disagree about whether
 * a run happened — the failure this repo has already had with duplicated definitions, aimed at the
 * one signal whose whole job is to be trusted.
 */

export type JobStatus = 'fresh' | 'late' | 'missed' | 'never';

export interface JobHealth {
  status: JobStatus;
  /** Whole days since the last run; `null` when there has never been one. */
  daysSince: number | null;
  /** One sentence, ready to render. Says what happened, not what the reader should feel. */
  message: string;
}

/**
 * Hours past the scheduled time before a run counts as late rather than merely pending.
 *
 * Six, not one. The job is scheduled for 06:00 and a laptop is routinely opened at nine; flagging
 * at 07:00 would mark a normal morning as a fault every day, and a warning that is usually wrong is
 * a warning nobody reads. Past noon, a missing run means something.
 */
const LATE_AFTER_HOURS = 6;

/** Whole days between two instants, floored — the unit a person thinks in. */
function daysBetween(then: Date, now: Date): number {
  return Math.floor((now.getTime() - then.getTime()) / 86_400_000);
}

/**
 * The verdict, given when the job last ran.
 *
 * `lastRun` is `null` when `sync_log` has no scheduler row at all, which is a genuinely different
 * state from "it ran a long time ago": a fresh checkout has never run the job, and telling that
 * owner it has been "4,000 days" would be nonsense.
 */
export function jobHealth(lastRun: Date | null, now: Date, scheduledHour = 6): JobHealth {
  if (lastRun === null) {
    return { status: 'never', daysSince: null, message: 'The daily job has never run on this machine.' };
  }

  const days = daysBetween(lastRun, now);

  // Ran today, whatever the hour. Nothing to say.
  if (lastRun.toDateString() === now.toDateString()) {
    return { status: 'fresh', daysSince: 0, message: 'The daily job ran today.' };
  }

  // Yesterday's run, and today's is not yet overdue — a normal morning before the laptop opened.
  const overdueFrom = new Date(now);
  overdueFrom.setHours(scheduledHour + LATE_AFTER_HOURS, 0, 0, 0);
  if (days <= 1 && now < overdueFrom) {
    return { status: 'fresh', daysSince: days, message: 'The daily job ran yesterday.' };
  }

  if (days <= 1) {
    return {
      status: 'late',
      daysSince: days,
      message: "Today's run has not happened yet. The last one was yesterday.",
    };
  }

  return {
    status: 'missed',
    daysSince: days,
    message:
      days === 2
        ? 'The daily job has not run since the day before yesterday. Sync, backups and this message are all behind.'
        : `The daily job has not run for ${days} days. Sync, backups and this message are all behind.`,
  };
}
