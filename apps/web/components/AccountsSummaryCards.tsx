import type { LandscapeSummary } from '@/lib/domain/accountsSummary';
import { figureSize } from '@/lib/figureSize';

const MONTHS = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];

const fmt = (n: number) =>
  new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 }).format(n);
// Signed only once it rounds to a dollar, so a few cents never read "−$0" or "+$0".
const fmtSigned = (n: number) => (Math.abs(n) < 0.5 ? fmt(0) : (n > 0 ? '+' : '−') + fmt(Math.abs(n)));

/**
 * The balances page's three cards, for one tab of the accounts page.
 *
 * THREE ACROSS AT EVERY WIDTH, as the balances page had them — the owner's call, after a phone
 * version that stacked them as one-line rows. Side by side they read as one sentence (opened at,
 * moved by, stands at), which a stack breaks up. To fit a third of a 390px screen the phone gets
 * the dashboard's small-card sizing: a 9px label, a figure at `text-base`, and a 10px caption that
 * may wrap. A seven-figure balance does not fit at `text-base`, so `figureSize` steps it down by
 * length rather than letting it break mid-number; `break-words` stays as the last backstop.
 */
export default function AccountsSummaryCards({ summary }: { summary: LandscapeSummary }) {
  const month = MONTHS[new Date().getMonth()];
  const { yearBegin, change, current, counted, noOpening } = summary;
  // Current balance leads, at the owner's request: it is the figure the tab is opened for; the
  // year's opening and its change are context for it.
  const cards = [
    {
      label: 'Current Balance',
      value: fmt(current),
      sub: `${counted} account${counted !== 1 ? 's' : ''}`,
      color: current <= -0.5 ? 'text-red-500' : 'text-slate-900',
    },
    {
      // "Year Begin" in the installed app, where the longer label wrapped to two lines in a third
      // of a phone's width; the browser keeps the full phrase.
      label: (<><span className="standalone:hidden">Beginning of Year</span><span className="hidden standalone:inline">Year Begin</span></>),
      value: fmt(yearBegin),
      sub: noOpening > 0 ? `Jan 1 opening · ${noOpening} first valued later` : 'Jan 1 opening',
      color: 'text-slate-900',
    },
    {
      label: 'YTD Change',
      value: fmtSigned(change),
      sub: `through ${month}`,
      color: change <= -0.5 ? 'text-red-500' : 'text-emerald-600',
    },
  ];

  return (
    <div className="grid grid-cols-3 gap-2 sm:gap-4 mb-6">
      {cards.map(({ label, value, sub, color }, i) => (
        <div key={i} className="min-w-0 bg-white rounded-2xl border border-slate-100 shadow-sm p-3 sm:p-6">
          <p className="text-[9px] sm:text-[10px] font-semibold uppercase tracking-normal sm:tracking-wider text-slate-400 mb-1 sm:mb-2">{label}</p>
          <p className={`${figureSize(value)} sm:text-3xl font-bold font-mono break-words ${color}`}>{value}</p>
          <p className="text-[10px] sm:text-xs text-slate-400 mt-1 sm:mt-1.5">{sub}</p>
        </div>
      ))}
    </div>
  );
}
