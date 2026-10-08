import type { LandscapeSummary } from '@/lib/domain/accountsSummary';

const MONTHS = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];

const fmt = (n: number) =>
  new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 }).format(n);
// Signed only once it rounds to a dollar, so a few cents never read "−$0" or "+$0".
const fmtSigned = (n: number) => (Math.abs(n) < 0.5 ? fmt(0) : (n > 0 ? '+' : '−') + fmt(Math.abs(n)));

/**
 * The balances page's three cards, for one tab of the accounts page.
 *
 * STACKED ON A PHONE, three across from `sm:` up. Three columns at 361px leave each figure under
 * 90px, and a seven-figure balance does not fit in that at any readable size. On a phone each card
 * is one line, the label left and the figure right, so the stack costs little height.
 */
export default function AccountsSummaryCards({ summary }: { summary: LandscapeSummary }) {
  const month = MONTHS[new Date().getMonth()];
  const { yearBegin, change, current, counted, noOpening } = summary;
  const cards = [
    {
      label: 'Beginning of Year',
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
    {
      label: 'Current Balance',
      value: fmt(current),
      sub: `${counted} account${counted !== 1 ? 's' : ''}`,
      color: current <= -0.5 ? 'text-red-500' : 'text-slate-900',
    },
  ];

  return (
    <div className="grid grid-cols-1 sm:grid-cols-3 gap-2 sm:gap-4 mb-6">
      {cards.map(({ label, value, sub, color }) => (
        <div
          key={label}
          className="bg-white rounded-2xl border border-slate-100 shadow-sm px-4 py-3 sm:p-6 flex items-center justify-between gap-3 sm:block"
        >
          <div className="min-w-0">
            <p className="text-[10px] font-semibold uppercase tracking-wider text-slate-400 sm:mb-2">{label}</p>
            <p className="text-xs text-slate-400 mt-0.5 sm:hidden">{sub}</p>
          </div>
          <p className={`text-lg sm:text-3xl font-bold font-mono shrink-0 ${color}`}>{value}</p>
          <p className="hidden sm:block text-xs text-slate-400 mt-1.5">{sub}</p>
        </div>
      ))}
    </div>
  );
}
