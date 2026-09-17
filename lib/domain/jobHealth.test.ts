import { describe, expect, it } from 'vitest';
import { jobHealth } from './jobHealth';

const at = (iso: string) => new Date(iso);

describe('jobHealth', () => {
  it('says nothing is wrong when the job ran today', () => {
    expect(jobHealth(at('2026-09-17T06:00:00'), at('2026-09-17T09:30:00'))).toMatchObject({
      status: 'fresh',
      daysSince: 0,
    });
  });

  it('does not cry wolf on a normal morning before the laptop was opened', () => {
    // Scheduled 06:00, opened at 09:00, yesterday's run is the most recent. Flagging this would
    // mark every ordinary day as a fault, and a warning that is usually wrong is one nobody reads.
    expect(jobHealth(at('2026-09-16T06:00:00'), at('2026-09-17T09:00:00')).status).toBe('fresh');
  });

  it('calls it late once the morning has clearly passed', () => {
    const verdict = jobHealth(at('2026-09-16T06:00:00'), at('2026-09-17T13:00:00'));
    expect(verdict.status).toBe('late');
    expect(verdict.message).toContain('has not happened yet');
  });

  it('calls a real gap what it is, and says what else is behind', () => {
    // The point of the finding: a missed job is not just a missed email. The sync and the backup
    // rode on it too, and an owner reading "no email yesterday" would not infer that.
    const verdict = jobHealth(at('2026-09-12T06:00:00'), at('2026-09-17T09:00:00'));
    expect(verdict).toMatchObject({ status: 'missed', daysSince: 5 });
    expect(verdict.message).toContain('5 days');
    expect(verdict.message).toContain('backups');
  });

  it('reads naturally at two days rather than saying "2 days"', () => {
    expect(jobHealth(at('2026-09-15T06:00:00'), at('2026-09-17T09:00:00')).message)
      .toContain('the day before yesterday');
  });

  it('separates "never run here" from "ran a very long time ago"', () => {
    // A fresh checkout has never run the job; telling that owner it has been 4,000 days is nonsense.
    const verdict = jobHealth(null, at('2026-09-17T09:00:00'));
    expect(verdict).toMatchObject({ status: 'never', daysSince: null });
    expect(verdict.message).toContain('never run');
  });

  it('measures against the scheduled hour it is given, not a hard-coded six', () => {
    // Same gap, two schedules: a job due at 06:00 is overdue by 13:00, one due at 22:00 is not.
    const lastRun = at('2026-09-16T22:00:00');
    expect(jobHealth(lastRun, at('2026-09-17T13:00:00'), 6).status).toBe('late');
    expect(jobHealth(lastRun, at('2026-09-17T13:00:00'), 22).status).toBe('fresh');
  });

  it('treats a run earlier today as fresh even before the usual hour', () => {
    // A manual run at 02:00 is still a run today.
    expect(jobHealth(at('2026-09-17T02:00:00'), at('2026-09-17T23:00:00')).status).toBe('fresh');
  });
});
