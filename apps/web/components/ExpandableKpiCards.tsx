'use client';

import { useState, type ReactNode } from 'react';
import { ChevronDown } from 'lucide-react';

/**
 * "Keep an eye" and "New arrivals" as counts you open, rather than two permanent lists.
 *
 * ─── Why they stopped being full-width cards ──────────────────────────────────────────────────
 *
 * Both sat open above the KPI row, which cost the top of the dashboard to two lists that are
 * usually short and occasionally long — the page's height moved with the owner's week. As counts
 * they join Uncategorized in the row where the other "waiting on you" figures already live, and the
 * rows are one click away. The phone reached the same arrangement first, for the same reason.
 *
 * ─── The panel is a grid item, which is why this renders a Fragment ───────────────────────────
 *
 * The two cards must be DIRECT children of the page's grid or they will not sit in its columns, and
 * the expanded panel must span the whole row rather than stretch one column. A wrapper `<div>`
 * around them would break both. A Fragment keeps all three as siblings the grid can place, and
 * `col-span-full` is what makes the panel full width without lifting state out of this component.
 *
 * ─── One open at a time ───────────────────────────────────────────────────────────────────────
 *
 * Opening the second closes the first. Two panels stacked under one row pushes the page's whole
 * lower half down twice, and the reader loses the picture they were comparing against. They answer
 * different questions and are not read together.
 *
 * The panels themselves are the EXISTING cards, passed in already rendered. They are server
 * components — a list of links with no state — and handing them through as props keeps them that
 * way: nothing here needs to know how a watchlist row looks.
 */
export default function ExpandableKpiCards({
  watchCount, watchOldest, watchPanel,
  arrivalsCount, arrivalsShown, arrivalsPanel, staleFeed,
}: {
  watchCount: number;
  /** Whole days the oldest flag has been open — the figure on this card that actually moves. */
  watchOldest: number;
  watchPanel: ReactNode;
  /** Every row in the window, which is not the same as the number of rows the panel lists. */
  arrivalsCount: number;
  arrivalsShown: number;
  arrivalsPanel: ReactNode;
  /** Whether a bank feed is behind — see the note on the zero case below. */
  staleFeed: boolean;
}) {
  const [open, setOpen] = useState<'watch' | 'arrivals' | null>(null);

  const age = (days: number) => (days === 0 ? 'today' : days === 1 ? '1 day' : `${days} days`);

  return (
    <>
      <Card
        label="Keep an eye"
        value={watchCount.toLocaleString()}
        sub={watchCount === 0 ? 'nothing flagged' : `oldest ${age(watchOldest)}`}
        // Amber past two weeks, never red: nothing on a watchlist is an error, and a colour that
        // shouts on day fifteen has nothing left to say on day sixty. The threshold is the shared
        // one — this card must not disagree with the row it opens.
        amber={watchCount > 0 && watchOldest >= 14}
        open={open === 'watch'}
        onToggle={() => setOpen((v) => (v === 'watch' ? null : 'watch'))}
        disabled={watchCount === 0}
      />
      <Card
        label="New arrivals"
        value={arrivalsCount.toLocaleString()}
        // THE COUNT IS NOT THE LIST'S LENGTH. The reader caps its rows at twelve, so a card
        // counting them would read "12" whether twelve arrived or forty did. When they differ the
        // card says which figure the panel is showing.
        sub={arrivalsCount === 0
          // ZERO ARRIVALS IS AMBIGUOUS AND THE PANEL USED TO SAY SO. While the feed sat open on the
          // page, its empty state distinguished a quiet day from a bank that stopped reporting —
          // and collapsing it into a card would have thrown that away silently, since a card
          // nobody can open never shows its panel. The distinction moves onto the card instead.
          ? (staleFeed ? 'nothing new · a feed is behind' : 'nothing new')
          : arrivalsCount > arrivalsShown
            ? `last 36 hours · showing ${arrivalsShown}`
            : 'in the last 36 hours'}
        amber={arrivalsCount === 0 && staleFeed}
        open={open === 'arrivals'}
        onToggle={() => setOpen((v) => (v === 'arrivals' ? null : 'arrivals'))}
        disabled={arrivalsShown === 0}
      />

      {open !== null && (
        <div className="col-span-full">
          {open === 'watch' ? watchPanel : arrivalsPanel}
        </div>
      )}
    </>
  );
}

function Card({ label, value, sub, amber, open, onToggle, disabled }: {
  label: string; value: string; sub: string;
  amber?: boolean; open: boolean; onToggle: () => void; disabled: boolean;
}) {
  const body = (
    <>
      <div className="flex items-start justify-between gap-2">
        <p className="text-[10px] sm:text-xs font-semibold uppercase tracking-wide sm:tracking-wider text-slate-400 break-words">{label}</p>
        {/* THE ONLY MARK SAYING THIS CARD OPENS. Its neighbours in the row do not, and a control
            that looks exactly like a static card is a control nobody finds. Hidden when there is
            nothing to open, so it never invites a click that does nothing. */}
        {!disabled && (
          <ChevronDown
            size={15}
            className={`shrink-0 text-slate-300 transition-transform ${open ? 'rotate-180' : ''}`}
          />
        )}
      </div>
      <p className={`text-2xl sm:text-3xl font-bold mt-1.5 sm:mt-2 font-mono ${amber ? 'text-amber-600' : 'text-slate-900'}`}>
        {value}
      </p>
      <p className="text-[11px] sm:text-xs mt-1 sm:mt-1.5 text-slate-400">{sub}</p>
    </>
  );

  // `min-w-0` and the smaller mobile padding for the same reason as KpiCard: a grid track grows
  // to its widest unbreakable word unless told it may shrink.
  const shell = 'min-w-0 bg-white rounded-2xl border border-slate-100 shadow-sm p-4 sm:p-6 text-left w-full';

  // A card with nothing behind it stays a card rather than becoming a dead button: `disabled` on a
  // <button> is announced as "unavailable", which is the wrong thing to say about a figure that is
  // simply zero.
  if (disabled) return <div className={shell}>{body}</div>;

  return (
    <button
      type="button"
      onClick={onToggle}
      aria-expanded={open}
      className={`${shell} transition-all hover:border-slate-200 hover:shadow-md ${open ? 'border-slate-300 shadow-md' : ''}`}
    >
      {body}
    </button>
  );
}
