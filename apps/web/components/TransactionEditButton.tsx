'use client';

// Everything the dashboard's two panels can change about a row: its category, its note, its flag.
//
// ─── The phone's editor, on the web, and why it is one modal rather than three controls ───────
//
// The owner asked for the rows under "Keep an eye" and "New arrivals" to be editable the way the
// phone's are. The phone opens one screen with three sections; this is that screen. Inline controls
// were the alternative — a `<select>` and a flag on every row — and they do not survive the width:
// these panels are read at 358px inside a dashboard, where a row already carries a label, a figure
// and an age.
//
// ─── A NOTE IS A NOTE; WATCHING IS A FLAG; NEITHER IMPLIES THE OTHER ─────────────────────────
//
// The web had one way to write a note: the flag modal, whose save sent `{ watched: true, note }`.
// So writing a comment put the row on the watchlist — the exact fusion the schema enforced until
// `watch_note` became `note`, and the one the owner reported when an annotated Airbnb charge
// appeared on a list it had no business being on. The phone was fixed that day; this was not,
// because flagging was the only door and flagging was what the door was for.
//
// Here they are two sections with two saves. `setNote` and `setWatched` each name one column, and
// the route leaves an unnamed column alone.
//
// ─── Three saves, not one ─────────────────────────────────────────────────────────────────────
//
// No "Save" button collecting all three. Each edit commits on its own, as it does on the phone,
// because they are independent facts and a combined save would have to decide what to do when one
// of three succeeds. Category commits on change and closes — refiling is the verb people come here
// for and it is done in one gesture.

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Flag, Pencil, X } from 'lucide-react';
import { MAX_WATCH_NOTE } from '@b8/contracts/overview';
import {
  groupCategories, setCategory, setNote, setWatched, type CategoryOption,
} from '@/lib/transactionEdits';

export interface EditableRow {
  id: number;
  label: string;
  /** ISO `YYYY-MM-DD`. */
  date: string;
  /** Signed, on the app's convention: POSITIVE is money out. */
  amount: number;
  category: string | null;
  watched: boolean;
  note: string | null;
}

const fmt = (n: number) =>
  new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 2 }).format(Math.abs(n));

export default function TransactionEditButton({ row, categories }: {
  row: EditableRow;
  categories: CategoryOption[];
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [note, setNoteText] = useState(row.note ?? '');
  // The flag as the SERVER last confirmed it, so the toggle reflects a save rather than a wish.
  const [watched, setWatchedState] = useState(row.watched);
  const [savedNote, setSavedNote] = useState(row.note ?? '');

  const trimmed = note.trim();
  const tooLong = trimmed.length > MAX_WATCH_NOTE;
  const unchanged = trimmed === savedNote;

  async function run(work: () => Promise<void>, thenClose = false) {
    setBusy(true);
    setError(null);
    try {
      await work();
      // The panels are server-rendered inside the dashboard, so the figures above them — the KPI
      // counts, the heatmap, the month's grading — move with this edit rather than going stale
      // behind it. One refetch, not a hand-patched copy of what the month says.
      router.refresh();
      if (thenClose) setOpen(false);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'That did not work. Try again.');
    } finally {
      setBusy(false);
    }
  }

  function openModal() {
    setNoteText(row.note ?? '');
    setSavedNote(row.note ?? '');
    setWatchedState(row.watched);
    setError(null);
    setOpen(true);
  }

  const groups = groupCategories(categories, /payment/i.test(row.label));

  return (
    <>
      <button
        type="button"
        onClick={openModal}
        aria-label={`Edit ${row.label}`}
        title="Category, note, and whether to keep an eye on it"
        className="shrink-0 p-1 -m-1 rounded text-slate-300 hover:text-slate-600 transition-colors"
      >
        <Pencil size={13} />
      </button>

      {open && (
        // The backdrop closes it, which is the gesture people try first. `items-end sm:items-center`
        // puts the card at the BOTTOM on a phone, within reach of a thumb, and centred on a desktop
        // where there is no thumb and a centred dialog is the convention.
        <div
          className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/30 backdrop-blur-sm"
          onClick={() => !busy && setOpen(false)}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            className="bg-white w-full sm:w-[26rem] rounded-t-2xl sm:rounded-2xl shadow-xl border border-slate-100
                       p-5 sm:p-6 max-h-[85dvh] overflow-y-auto pb-[calc(1.25rem+env(safe-area-inset-bottom))] sm:pb-6"
          >
            <div className="flex items-start justify-between gap-3 mb-4">
              <div className="min-w-0">
                <h3 className="text-sm font-semibold text-slate-900 truncate">{row.label}</h3>
                <p className="text-xs text-slate-400 mt-0.5">
                  {row.date} · {row.amount < 0 ? '+' : ''}{fmt(row.amount)} · {row.category ?? 'uncategorized'}
                </p>
              </div>
              <button
                type="button"
                onClick={() => setOpen(false)}
                disabled={busy}
                aria-label="Close"
                className="shrink-0 p-1 -m-1 text-slate-300 hover:text-slate-600 disabled:opacity-40"
              >
                <X size={18} />
              </button>
            </div>

            {error && <p className="text-xs text-red-500 mb-3">{error}</p>}

            <label className="block text-[10px] font-semibold uppercase tracking-wider text-slate-400 mb-1.5">
              Category
            </label>
            <select
              value={row.category ?? ''}
              disabled={busy}
              onChange={(e) => run(() => setCategory(row.id, e.target.value || null), true)}
              className="w-full text-sm border border-slate-200 rounded-lg px-3 py-2 bg-white text-slate-700
                         disabled:opacity-50 focus:outline-none focus:ring-2 focus:ring-slate-900/10"
            >
              <option value="">— uncategorized —</option>
              {groups.operational.length > 0 && (
                <optgroup label="Operational">
                  {groups.operational.map((c) => <option key={c.name} value={c.name}>{c.name}</option>)}
                </optgroup>
              )}
              {groups.capital.length > 0 && (
                <optgroup label="Capital">
                  {groups.capital.map((c) => <option key={c.name} value={c.name}>{c.name}</option>)}
                </optgroup>
              )}
              {groups.excluded.length > 0 && (
                <optgroup label="Other">
                  {groups.excluded.map((c) => <option key={c.name} value={c.name}>{c.name}</option>)}
                </optgroup>
              )}
            </select>

            <label className="block text-[10px] font-semibold uppercase tracking-wider text-slate-400 mt-5 mb-1.5">
              Note
            </label>
            <textarea
              value={note}
              onChange={(e) => setNoteText(e.target.value)}
              disabled={busy}
              rows={2}
              placeholder="Anything worth remembering about this one"
              // Not `maxLength`: a hard stop swallows keystrokes with no explanation. The counter
              // turns red and the save is refused with a reason instead.
              className={`w-full text-sm border rounded-lg px-3 py-2 text-slate-700 disabled:opacity-50
                          focus:outline-none focus:ring-2 focus:ring-slate-900/10 ${tooLong ? 'border-red-300' : 'border-slate-200'}`}
            />
            <div className="flex items-center justify-between gap-3 mt-1.5">
              {/* Says what a note IS, because this UI taught the opposite until today. */}
              <p className="text-[11px] text-slate-400">Just a note. It does not flag this one.</p>
              <span className={`text-[11px] tabular-nums ${tooLong ? 'text-red-500' : 'text-slate-300'}`}>
                {trimmed.length}/{MAX_WATCH_NOTE}
              </span>
            </div>
            <button
              type="button"
              disabled={busy || unchanged || tooLong}
              onClick={() => run(async () => {
                const next = trimmed === '' ? null : trimmed;
                await setNote(row.id, next);
                setSavedNote(next ?? '');
              })}
              className="mt-2 px-3.5 py-1.5 rounded-lg text-xs font-medium bg-slate-900 text-white
                         hover:bg-slate-700 disabled:opacity-40 transition-colors"
            >
              {busy ? 'Saving…' : unchanged && savedNote !== (row.note ?? '') ? 'Saved' : 'Save note'}
            </button>

            <label className="block text-[10px] font-semibold uppercase tracking-wider text-slate-400 mt-5 mb-1.5">
              Keep an eye
            </label>
            <button
              type="button"
              role="switch"
              aria-checked={watched}
              disabled={busy}
              onClick={() => run(async () => {
                await setWatched(row.id, !watched);
                setWatchedState(!watched);
              })}
              className="flex items-start gap-2.5 text-left w-full disabled:opacity-50"
            >
              <span className={`shrink-0 mt-0.5 w-5 h-5 rounded-md border flex items-center justify-center transition-colors ${
                watched ? 'bg-amber-500 border-amber-500 text-white' : 'border-slate-300 text-transparent'
              }`}>
                <Flag size={11} fill="currentColor" />
              </span>
              <span className="text-sm text-slate-700 leading-snug">
                {watched ? 'On the list' : 'Not on the list'}
                {/* THE CONSEQUENCE, ON SCREEN. A flagged charge is left out of its category's
                    overspend measurement — the whole reason the flag matters, and not something
                    to discover from a tile that went quiet. */}
                <span className="block text-xs text-slate-400">
                  {watched
                    ? 'Left out of its budget grading'
                    : 'Counted toward its budget as normal'}
                </span>
              </span>
            </button>
          </div>
        </div>
      )}
    </>
  );
}
