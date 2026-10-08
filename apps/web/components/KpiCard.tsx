import { STATUS_CLASS, type StatusColor } from '@/lib/chartColors';

/**
 * A headline figure: label, value, and an optional line under it. Shared by the dashboard and
 * /budget so the two pages' cards are the same card, not two that drift apart.
 */
export default function KpiCard({ label, value, sub, subColor, highlight, href }: {
  label: string; value: string; sub?: string; subColor?: StatusColor;
  highlight?: StatusColor; href?: string;
}) {
  const content = (
    <>
      {/* `break-words` IS WHAT STOPS THE PAGE SCROLLING SIDEWAYS. A grid track defaults to
          `min-width: auto`, so it grows to fit its widest unbreakable content — and
          "UNCATEGORIZED" is one unbreakable word about 117px across at `text-xs tracking-wider`.
          Three such tracks exceed a 390px viewport, the grid overflows its container, and the whole
          page gains a horizontal scrollbar because of a LABEL.

          It stays as the safety net, and it is no longer what happens. Bounded is not the same as
          good: at 10px with wide tracking "UNCATEGORIZED" measures 86px against the 79px a third of
          a 390px screen leaves inside a card, so it broke MID-WORD, and the three counts read
          "UNCATEGORIZE / D" over two lines. 9px with normal tracking measures 75px and fits on one.

          The phone solves this with `adjustsFontSizeToFit` and a 0.75 floor on an 11px label — an
          effective 8.25px — which CSS has no equivalent of, so the size is picked here instead.
          Measured against this ledger's three labels rather than guessed, and `sm:` upward is
          untouched: a desktop card has four times the width and no such problem. */}
      <p className="text-[9px] sm:text-xs font-semibold uppercase tracking-normal sm:tracking-wider text-slate-400 break-words">
        {label}
      </p>
      {/* Smaller on a phone for the same reason, and because a figure that needs 3xl at 358px of
          screen is a figure that will be truncated instead. */}
      <p className={`text-2xl sm:text-3xl font-bold mt-1.5 sm:mt-2 font-mono ${highlight ? STATUS_CLASS[highlight] : 'text-slate-900'}`}>
        {value}
      </p>
      {sub && <p className={`text-[11px] sm:text-xs mt-1 sm:mt-1.5 ${subColor ? STATUS_CLASS[subColor] : 'text-slate-400'}`}>{sub}</p>}
    </>
  );
  if (href) {
    return (
      <a
        href={href}
        className="block min-w-0 bg-white rounded-2xl border border-slate-100 shadow-sm p-4 sm:p-6 hover:border-slate-200 hover:shadow-md transition-all"
      >
        {content}
      </a>
    );
  }
  return (
    <div className="min-w-0 bg-white rounded-2xl border border-slate-100 shadow-sm p-4 sm:p-6">
      {content}
    </div>
  );
}
