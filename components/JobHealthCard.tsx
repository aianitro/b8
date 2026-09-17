import { AlarmClockOff } from 'lucide-react';
import type { JobHealth } from '@/lib/domain/jobHealth';

/**
 * The daily job has not been running — the only alert on this page about the app's own machinery
 * rather than about money.
 *
 * ─── Why it sits in the bell with the feed and the drift ──────────────────────────────────────
 *
 * Those two say "a figure below may be wrong". This says "every figure below may be old, and the
 * backups are missing too". It is the same kind of claim about the same page, so it belongs in the
 * same place rather than as a fourth thing to notice somewhere else.
 *
 * ─── Silent when healthy, like its siblings ───────────────────────────────────────────────────
 *
 * A strip reporting "the job ran today" every day is noise competing with the figures the page
 * exists to show — and worse, it trains the eye to skip the strip, which is where the one useful
 * message will eventually appear.
 */
export default function JobHealthCard({ health }: { health: JobHealth }) {
  if (health.status === 'fresh') return null;

  // `late` is a normal afternoon on a laptop that was closed all morning; `missed` and `never` are
  // situations. Amber for the first, a heavier amber for the rest — never red, because nothing here
  // is wrong with the data, only absent.
  const serious = health.status !== 'late';

  return (
    <div className={`rounded-xl border p-4 ${serious ? 'border-amber-300 bg-amber-50' : 'border-slate-200 bg-white'}`}>
      <div className="flex items-start gap-2.5">
        <AlarmClockOff size={15} className={`mt-0.5 shrink-0 ${serious ? 'text-amber-600' : 'text-slate-400'}`} />
        <div>
          <p className={`text-sm ${serious ? 'text-amber-900' : 'text-slate-600'}`}>{health.message}</p>
          {serious && (
            // The remedy, because an alert that only names a problem makes the reader go and find
            // out how to fix it — and this one is fixed by a single command.
            <p className="text-xs text-amber-700/80 mt-1.5">
              Run <code className="font-mono">npm run job:daily</code> to catch up, or check that the
              scheduled job is still installed.
            </p>
          )}
        </div>
      </div>
    </div>
  );
}
