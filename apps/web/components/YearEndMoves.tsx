import type { MoveSince, YearEndMoves } from '@/lib/yearEndSnapshots';

const fmt = (n: number) =>
  new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 }).format(Math.abs(n));
const signed = (n: number) => `${n > 0 ? '+' : n < 0 ? '−' : '±'}${fmt(n)}`;
const tone = (n: number) => (Math.round(n) > 0 ? 'text-green-600' : Math.round(n) < 0 ? 'text-red-600' : 'text-slate-400');
const short = (iso: string) => new Date(`${iso}T12:00:00`).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });

/** "yesterday" when the baseline is yesterday's snapshot, else its date: a missed morning shows. */
function sinceLabel(s: MoveSince, today: string): string {
  const y = new Date(`${today}T12:00:00`);
  y.setDate(y.getDate() - 1);
  return s.from === y.toISOString().slice(0, 10) ? 'yesterday' : short(s.from);
}

/**
 * The Projected P/L card's second line: how far the year-end moved since yesterday and since the
 * month began. Silent until the first snapshot exists.
 */
export function YearEndMoveLine({ moves, today }: { moves: YearEndMoves; today: string }) {
  const parts = [
    moves.sinceYesterday && { key: 'y', s: moves.sinceYesterday, label: `since ${sinceLabel(moves.sinceYesterday, today)}` },
    moves.sinceMonthStart && moves.sinceMonthStart.from !== moves.sinceYesterday?.from
      && { key: 'm', s: moves.sinceMonthStart, label: `since ${short(moves.sinceMonthStart.from)}` },
  ].filter(Boolean) as { key: string; s: MoveSince; label: string }[];
  if (parts.length === 0) return null;
  // One line each: two figures side by side do not fit a phone's half-width card.
  return (
    <div className="text-slate-400">
      {parts.map((p) => (
        <p key={p.key} className="whitespace-nowrap">
          {Math.round(p.s.move.total) === 0
            ? <>unchanged {p.label}</>
            : <><span className={`font-mono ${tone(p.s.move.total)}`}>{signed(p.s.move.total)}</span> {p.label}</>}
        </p>
      ))}
    </div>
  );
}

const PARTS = [
  { key: 'spending', label: 'Spending this month', hint: 'what you spent, against the month’s plan' },
  { key: 'budget', label: 'Budget edits', hint: 'plans changed, or unspent money carried in' },
  { key: 'past', label: 'Past months', hint: 'late arrivals, refunds, re-filed transactions' },
  { key: 'closed', label: 'Month closed', hint: 'a month went from plan to what it actually was' },
] as const;

/**
 * Why the year-end moved, on the budget page: the move split into its four parts, for each period,
 * and the categories behind the spending part. The parts always add up to the move.
 */
export function YearEndMovesPanel({ moves, today }: { moves: YearEndMoves; today: string }) {
  const cols = [
    moves.sinceYesterday && { key: 'y', s: moves.sinceYesterday, label: `Since ${sinceLabel(moves.sinceYesterday, today)}` },
    moves.sinceMonthStart && { key: 'm', s: moves.sinceMonthStart, label: `Since ${short(moves.sinceMonthStart.from)}` },
  ].filter(Boolean) as { key: string; s: MoveSince; label: string }[];
  if (cols.length === 0) return null;

  // The categories whose spending moved most over the longer period.
  const longest = cols[cols.length - 1].s.move;
  const movers = longest.categories.filter((c) => Math.round(c.spending) !== 0)
    .sort((a, b) => Math.abs(b.spending) - Math.abs(a.spending)).slice(0, 4);

  return (
    <div className="bg-white rounded-2xl border border-slate-100 shadow-sm p-4 sm:p-6 mb-8">
      <p className="text-xs font-semibold uppercase tracking-wider text-slate-400 mb-3">What moved the year-end</p>
      <table className="w-full text-sm">
        <thead>
          <tr className="text-left text-xs text-slate-400">
            <th className="pb-2 font-medium" />
            {cols.map((c) => <th key={c.key} className="pb-2 font-medium text-right pl-3 whitespace-nowrap">{c.label}</th>)}
          </tr>
        </thead>
        <tbody>
          {PARTS.map((p) => (
            <tr key={p.key} className="border-t border-slate-50">
              <td className="py-2">
                <p className="text-slate-700">{p.label}</p>
                <p className="text-[11px] text-slate-400">{p.hint}</p>
              </td>
              {cols.map((c) => <td key={c.key} className={`py-2 pl-3 text-right font-mono whitespace-nowrap ${tone(c.s.move[p.key])}`}>{signed(c.s.move[p.key])}</td>)}
            </tr>
          ))}
          <tr className="border-t border-slate-200">
            <td className="pt-2 font-semibold text-slate-900">Projected P/L</td>
            {cols.map((c) => <td key={c.key} className={`pt-2 pl-3 text-right font-mono font-semibold whitespace-nowrap ${tone(c.s.move.total)}`}>{signed(c.s.move.total)}</td>)}
          </tr>
        </tbody>
      </table>
      {movers.length > 0 && (
        <div className="mt-4">
          <p className="text-xs text-slate-400 mb-1.5">Spending behind it, {cols[cols.length - 1].label.replace(/^Since/, 'since')}</p>
          <ul className="space-y-1">
            {movers.map((c) => (
              <li key={c.name} className="flex items-baseline justify-between gap-3 text-sm">
                <span className="min-w-0 truncate text-slate-700">{c.name}</span>
                <span className={`shrink-0 font-mono ${tone(c.spending)}`}>{signed(c.spending)}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
