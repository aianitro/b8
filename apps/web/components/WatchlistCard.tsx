import Link from 'next/link';
import { Flag } from 'lucide-react';
import { WATCHLIST_STALE_DAYS } from '@b8/contracts/overview';
import type { WatchedTransaction } from '@/lib/watchlistRead';
import TransactionEditButton from './TransactionEditButton';
import type { CategoryOption } from '@/lib/transactionEdits';

const fmt = (n: number) =>
  new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 2 }).format(Math.abs(n));

/** Whole days since the flag, as a phrase. */
const age = (days: number) => (days === 0 ? 'today' : days === 1 ? '1 day' : `${days} days`);

// The threshold moved to `@b8/contracts/overview` when the phone's dashboard started raising its
// own "Keep an eye" card on the same judgement. Imported rather than restated: two surfaces calling
// the same flag stale on different days is the quiet kind of drift this repo keeps finding.
const STALE_DAYS = WATCHLIST_STALE_DAYS;

/**
 * What the owner said they were not finished with.
 *
 * ─── Why it sits directly under the bubbles ───────────────────────────────────────────────────
 *
 * The bubbles say where this month's money is and which parts of it are going wrong. Both are
 * answers the app computed. This card is the one thing on the page the owner put there themselves,
 * and it belongs next to the computed picture rather than below the feed: a pending return is a
 * claim that one of those figures is provisional, and it should be read in the same breath.
 *
 * ─── The age is the column that changes ───────────────────────────────────────────────────────
 *
 * A watchlist that only says WHAT is on it becomes wallpaper — the same rows every morning until
 * the eye stops reading them. The number that moves is the age, and it is the thing that should
 * eventually feel wrong: a return pending three days is a process, one pending thirty is a refund
 * nobody is going to chase unless something says so.
 *
 * Amber past two weeks, never red. Nothing here is an error, and a colour that shouts on day
 * fifteen has nothing left to say on day sixty.
 *
 * ─── Empty is not rendered ────────────────────────────────────────────────────────────────────
 *
 * Unlike the arrivals feed, whose emptiness is news — it distinguishes "nothing was spent" from "a
 * bank stopped reporting" — an empty watchlist says only that the owner has not flagged anything.
 * A permanent card reading "nothing to watch" is furniture directly under the page's main picture.
 * The page renders this conditionally; see app/dashboard/page.tsx.
 */
export default function WatchlistCard({ items, categories }: {
  items: WatchedTransaction[];
  /** For the editor's picker. Empty renders the rows without one — see the note on the button. */
  categories: CategoryOption[];
}) {
  const oldest = items[0]?.daysOpen ?? 0; // The read orders oldest first.

  return (
    <div className="bg-white rounded-2xl border border-slate-100 shadow-sm p-6 mb-6">
      <div className="flex items-baseline justify-between mb-4">
        <p className="text-xs font-semibold uppercase tracking-wider text-slate-400">Keeping an eye</p>
        <div className="flex items-baseline gap-3">
          {oldest >= STALE_DAYS && (
            <span className="text-[10px] font-medium text-amber-600">oldest {age(oldest)}</span>
          )}
          <Link href="/transactions?filter=watched" className="text-[10px] text-blue-600 hover:underline">
            Manage
          </Link>
        </div>
      </div>

      <div className="space-y-2.5">
        {items.map((item) => {
          const stale = item.daysOpen >= STALE_DAYS;
          // Money in is shown with its sign and in green. A refund rendered as a bare figure in a
          // list of charges reads as another charge to anyone moving quickly — and on this card
          // a refund landing is often exactly the thing being waited for.
          const inbound = item.amount < 0;
          return (
            // WRAPS ON A PHONE, one line from `sm:` up. Five things already shared this row and
            // the edit button is a sixth; at 358px the note is what loses, and the note is half of
            // why a row is on this list. Below `sm:` the reason takes a line of its own.
            <div key={item.id} className="flex flex-wrap items-baseline gap-x-3 gap-y-0.5 text-sm">
              <Flag size={13} className={`shrink-0 translate-y-0.5 ${stale ? 'text-amber-500' : 'text-slate-300'}`} />
              <span className="text-slate-900 truncate max-w-[10rem] sm:max-w-[14rem]">{item.label}</span>
              <span className="order-last sm:order-none basis-full sm:basis-auto sm:flex-1 text-xs text-slate-400 truncate pl-6 sm:pl-0">
                {item.note ?? <span className="text-slate-300">no reason given</span>}
              </span>
              <span className={`ml-auto sm:ml-0 font-mono text-sm tabular-nums ${inbound ? 'text-green-600' : 'text-slate-700'}`}>
                {inbound ? '+' : ''}{fmt(item.amount)}
              </span>
              <span className={`text-xs w-14 sm:w-16 text-right ${stale ? 'font-semibold text-amber-600' : 'text-slate-400'}`}>
                {age(item.daysOpen)}
              </span>
              {/* Every row here is watched by definition, so the editor opens with the flag on —
                  and unflagging is the commonest thing to do from this list, which is why the
                  button is on the row rather than behind "Manage". */}
              <TransactionEditButton
                categories={categories}
                row={{
                  id: item.id, label: item.label, merchant: item.merchant, date: item.date,
                  amount: item.amount, category: item.category, watched: true, note: item.note,
                }}
              />
            </div>
          );
        })}
      </div>
    </div>
  );
}
