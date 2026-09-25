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
// of three succeeds.
//
// ─── WHAT THE DIALOG SHOWS BEFORE IT IS ASKED ─────────────────────────────────────────────────
//
// A picker, and two lines. The note editor is behind "Add note" because writing one is not what
// anyone opens this for — the category is — and an empty textarea with a placeholder reads as a
// question awaiting an answer, framing the commonest edit with one nobody asked. An existing note
// still shows, since that is information rather than an invitation.
//
// The watch control lost its section heading, which repeated the word its own label already said,
// and lost the half of its explanation that described the default: a row that is NOT flagged
// counts toward its budget, which is true of every other row and needs no saying.
//
// NOTHING CLOSES THE MODAL BUT THE READER. Category used to commit and close, on the argument that
// refiling is the verb people come here for and should cost one gesture. It cost two features the
// ledger already had and the owner missed both: the five-second undo, which has nowhere to live on
// a closed dialog, and the warning that a transfer still owes its pair. A gesture saved is not
// worth a misfile that cannot be taken back.

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { ArrowLeftRight, Flag, Pencil, Plus, Wand2, X } from 'lucide-react';
import { MAX_WATCH_NOTE } from '@b8/contracts/overview';
import {
  createMerchantRule, fetchCounterparts, GROUP_LABELS, groupCategories, isTransferCategory,
  pairAsTransfer, setCategory, setNote, setWatched, type CategoryOption, type Counterpart,
} from '@/lib/transactionEdits';

export interface EditableRow {
  id: number;
  label: string;
  /**
   * The payee as Plaid names it, or null when the feed gave only a raw descriptor.
   *
   * SEPARATE FROM `label`, which falls back to the descriptor and then to 'Unnamed' so a row
   * always has something to show. A rule keyed on a fallback would be keyed on a string that
   * identifies one transaction rather than a payee.
   */
  merchant?: string | null;
  /** ISO `YYYY-MM-DD`. */
  date: string;
  /** Signed, on the app's convention: POSITIVE is money out. */
  amount: number;
  category: string | null;
  watched: boolean;
  note: string | null;
}

/** The ledger's own window, matching `CategorySelect`. Two undo affordances that expire at
 *  different times would be two different promises about the same action. */
const UNDO_WINDOW_MS = 5000;

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
  /**
   * The category as the server last confirmed it, plus what it was before, for the undo window.
   *
   * THIS EDITOR USED TO COMMIT AND CLOSE. That lost the 5-second undo the ledger's own picker has
   * offered since it was written, and the owner noticed — a category chosen by thumb on a phone is
   * exactly the change most likely to be the wrong row, and closing the one surface that could
   * take it back is how a misfile becomes permanent. It stays open now.
   */
  const [category, setCategoryState] = useState(row.category);
  const [undoTo, setUndoTo] = useState<string | null | undefined>(undefined);
  /** Whether anything was written since the dialog opened — see `run`, and `closeModal` below. */
  const [dirty, setDirty] = useState(false);
  /** Rows that could be the other side, once this row owes a pair. `null` while unasked. */
  const [counterparts, setCounterparts] = useState<Counterpart[] | null>(null);
  const [paired, setPaired] = useState(false);
  /** Whether the note editor is showing. Closed on open — see the note beside it. */
  const [noteOpen, setNoteOpen] = useState(false);
  /** How many earlier rows the rule just re-filed, or null while no rule has been made here. */
  const [ruleMade, setRuleMade] = useState<number | null>(null);

  // The window closes on its own, and closes NOTHING ELSE. An expiry that also refreshed would
  // make the dialog disappear unprompted five seconds after a category was picked. A permanent
  // "Undo" is a second history the reader has to reason about; a five-second one is a correction.
  useEffect(() => {
    if (undoTo === undefined) return;
    const t = setTimeout(() => setUndoTo(undefined), UNDO_WINDOW_MS);
    return () => clearTimeout(t);
  }, [undoTo]);

  const trimmed = note.trim();
  const tooLong = trimmed.length > MAX_WATCH_NOTE;
  const unchanged = trimmed === savedNote;

  /**
   * THE REFRESH IS DEFERRED TO CLOSE, AND THAT IS NOT AN OPTIMISATION.
   *
   * It used to run right after every save. On the Uncategorized panel that closed the dialog out
   * from under the reader: `router.refresh()` re-renders the server tree, a row that just got a
   * category is no longer unfiled, so it leaves the list — and the button hosting this modal
   * unmounts, taking the five-second undo with it. The undo was unreachable in exactly the case it
   * was added for.
   *
   * The watchlist panel had the same bug waiting: unflagging a row removes it from "Keep an eye".
   * So the rule is one rule for all three edits rather than a special case for the one that was
   * caught — every list here is defined by a property its own editor can change.
   *
   * The figures above are stale only while the dialog covers them, and they are correct again
   * before it is out of the way.
   */
  async function run(work: () => Promise<void>) {
    setBusy(true);
    setError(null);
    try {
      await work();
      setDirty(true);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'That did not work. Try again.');
    } finally {
      setBusy(false);
    }
  }

  function closeModal() {
    setOpen(false);
    // The KPI counts, the heatmap and the month's grading all move with these edits. One refetch,
    // not a hand-patched copy of what the month says.
    if (dirty) {
      setDirty(false);
      router.refresh();
    }
  }

  function openModal() {
    setNoteText(row.note ?? '');
    setSavedNote(row.note ?? '');
    setWatchedState(row.watched);
    setCategoryState(row.category);
    setUndoTo(undefined);
    setDirty(false);
    setCounterparts(null);
    setPaired(false);
    setNoteOpen(false);
    setRuleMade(null);
    setError(null);
    setOpen(true);
  }

  const groups = groupCategories(categories, row.label);
  const owesAPair = isTransferCategory(category) && !paired;

  /**
   * Asked for only once the row actually owes a pair, and never on open. Most rows edited here are
   * not transfers, and a lookup fired on every dialog would be a query per row read.
   */
  useEffect(() => {
    if (!open || !owesAPair) return;
    let live = true;
    fetchCounterparts(row.id).then((found) => { if (live) setCounterparts(found); });
    return () => { live = false; };
  }, [open, owesAPair, row.id]);

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
          onClick={() => !busy && closeModal()}
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
                onClick={closeModal}
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
              value={category ?? ''}
              disabled={busy}
              onChange={(e) => {
                const next = e.target.value || null;
                const previous = category;
                run(async () => {
                  await setCategory(row.id, next);
                  setCategoryState(next);
                  setUndoTo(previous);
                });
              }}
              className="w-full text-sm border border-slate-200 rounded-lg px-3 py-2 bg-white text-slate-700
                         disabled:opacity-50 focus:outline-none focus:ring-2 focus:ring-slate-900/10"
            >
              <option value="">— uncategorized —</option>
              {/* Rendered from one list so a group cannot be forgotten here and present in the
                  grouping — `suggested` was, on the first pass. */}
              {(['suggested', 'operational', 'capital', 'excluded'] as const).map((key) =>
                groups[key].length > 0 ? (
                  <optgroup key={key} label={GROUP_LABELS[key]}>
                    {groups[key].map((c) => <option key={c.name} value={c.name}>{c.name}</option>)}
                  </optgroup>
                ) : null
              )}
            </select>

            {/* ─── THE RULE, OFFERED WHERE THE FILING HAPPENS ─────────────────────────────
                The owner's ask: "some way of new rule creation should be there during setting up
                category from Uncategorized. it should be smooth experience".

                So it is not a form and not a settings page — it is one sentence with one button,
                appearing only once a category has actually been chosen, saying exactly what it
                will do and to whom. A checkbox BEFORE the category would ask the reader to commit
                to a rule for a filing they have not made yet.

                WHAT MAKES IT SAFE TO BE THIS EASY is that the rule's reach is stated in the same
                breath. The button names the payee; pressing it reports how many earlier rows moved
                with it. Nothing filed by hand is ever among them — the route only touches rows that
                are unfiled or were filed by a rule.

                Shown only for a row that HAS a merchant. A transfer or a manual import often has
                only a raw descriptor, and a rule keyed on "CHASE CREDIT CRD AUTOPAY PPD ID:
                4760039224" would match exactly one transaction for the rest of time. */}
            {row.merchant && category && ruleMade === null && (
              <button
                type="button"
                disabled={busy}
                onClick={() => run(async () => {
                  setRuleMade(await createMerchantRule(row.merchant!, category));
                })}
                className="mt-2 flex w-full items-start gap-2 rounded-lg border border-slate-200 bg-slate-50
                           px-2.5 py-2 text-left hover:border-slate-300 disabled:opacity-50 transition-colors"
              >
                <Wand2 size={13} className="shrink-0 mt-0.5 text-slate-400" />
                <span className="text-[11px] text-slate-600 leading-snug">
                  Always file <span className="font-semibold text-slate-800">{row.merchant}</span> as{' '}
                  <span className="font-semibold text-slate-800">{category}</span>
                </span>
              </button>
            )}

            {ruleMade !== null && (
              <p className="mt-2 flex items-start gap-2 text-[11px] text-emerald-700 leading-snug">
                <Wand2 size={13} className="shrink-0 mt-0.5" />
                <span>
                  {row.merchant} will file as {category} from now on
                  {ruleMade > 0 && `, and ${ruleMade} earlier ${ruleMade === 1 ? 'row' : 'rows'} moved with it`}.
                  {' '}<Link href="/rules" className="underline hover:text-emerald-900">Rules</Link>
                </span>
              </p>
            )}

            {undoTo !== undefined && (
              <div className="mt-1.5 flex items-center gap-1.5 text-xs text-slate-400">
                <span>Updated</span>
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => run(async () => {
                    await setCategory(row.id, undoTo);
                    setCategoryState(undoTo);
                    setUndoTo(undefined);
                  })}
                  className="text-blue-600 hover:text-blue-700 font-medium underline disabled:opacity-50"
                >
                  Undo
                </button>
              </div>
            )}

            {/* HALF A TRANSFER IS NOT A TRANSFER, AND THE OTHER HALF IS NOT A MYSTERY.
                `POST /api/v1/transfers` sets this category itself, which says what the ledger
                considers the real act: pairing IS categorising, and setting the category alone
                leaves a row whose counterpart nothing points at.

                This used to say so and link to the ledger, which was honest and cost nine steps
                across two pages — open the panel, open the row, choose Transfer, read the warning,
                follow the link OFF the dashboard, tick two boxes in a wide table, press Pair,
                come back. The owner asked me to try it. Step three creates the invalid state that
                steps five to eight exist only to repair.

                None of it was necessary. A two-row transfer must net to zero, so the other side is
                an ungrouped row of the exact opposite amount within a few days — the app was
                already computing that (it is what the link's absolute-amount filter did) and then
                making the owner do the finding by eye. It offers instead. The link survives for
                the cases one tap cannot serve: no candidate found, or a three-way group. */}
            {paired && (
              <p className="mt-2 flex items-center gap-1.5 text-[11px] text-emerald-700">
                <ArrowLeftRight size={13} className="shrink-0" />
                Paired. Both sides are now one transfer.
              </p>
            )}

            {owesAPair && (
              <div className="mt-2 rounded-lg bg-amber-50 border border-amber-200 p-2.5">
                <p className="flex items-start gap-2 text-[11px] text-amber-900 leading-snug">
                  <ArrowLeftRight size={14} className="shrink-0 mt-0.5 text-amber-600" />
                  <span>A transfer needs its matching transaction.</span>
                </p>

                {counterparts === null && (
                  <p className="mt-1.5 pl-6 text-[11px] text-amber-700/70">Looking for the other side…</p>
                )}

                {counterparts?.length === 0 && (
                  <p className="mt-1.5 pl-6 text-[11px] text-amber-900">
                    Nothing matching found nearby.{' '}
                    <Link
                      href={`/transactions?amountMin=${Math.abs(row.amount)}&amountMax=${Math.abs(row.amount)}`}
                      className="font-semibold underline hover:text-amber-950"
                    >
                      Find it in the ledger
                    </Link>.
                  </p>
                )}

                {/* One tap per candidate, and the candidate says enough to tell two apart: the
                    account it moved through, the day, and the figure. Five at most — more than
                    that and the amount is not identifying anything, which is the ledger's job. */}
                {counterparts && counterparts.length > 0 && (
                  <ul className="mt-2 space-y-1">
                    {counterparts.map((c) => (
                      <li key={c.id}>
                        <button
                          type="button"
                          disabled={busy}
                          onClick={() => run(async () => {
                            await pairAsTransfer([row.id, c.id]);
                            setPaired(true);
                          })}
                          className="w-full flex items-center gap-2 rounded-md bg-white border border-amber-200
                                     px-2 py-1.5 text-left hover:border-amber-400 disabled:opacity-50 transition-colors"
                        >
                          <ArrowLeftRight size={12} className="shrink-0 text-amber-600" />
                          <span className="min-w-0 flex-1">
                            <span className="block text-[11px] text-slate-700 truncate">{c.label}</span>
                            <span className="block text-[10px] text-slate-400">{c.account} · {c.date}</span>
                          </span>
                          <span className={`text-[11px] font-mono shrink-0 ${c.amount < 0 ? 'text-emerald-600' : 'text-slate-700'}`}>
                            {c.amount < 0 ? '+' : ''}{fmt(c.amount)}
                          </span>
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            )}

            {/* ─── THE NOTE IS BEHIND A BUTTON ────────────────────────────────────────────────
                A two-row textarea sat open on every transaction, and writing a note is not what
                anyone comes here for — the category is. An input with a placeholder reads as a
                field awaiting an answer, so the commonest edit was framed by a question nobody
                had asked. Collapsed, the dialog is a picker and two lines.

                A note that EXISTS still shows, because that is information rather than an
                invitation; it is the empty field that had to go. */}
            {!noteOpen && savedNote !== '' && (
              <div className="mt-4 flex items-start gap-2">
                <p className="flex-1 min-w-0 text-[13px] text-slate-600 leading-snug break-words">{savedNote}</p>
                <button
                  type="button"
                  onClick={() => setNoteOpen(true)}
                  className="shrink-0 text-[11px] text-slate-400 hover:text-slate-700 underline transition-colors"
                >
                  Edit
                </button>
              </div>
            )}

            {!noteOpen && savedNote === '' && (
              <button
                type="button"
                onClick={() => setNoteOpen(true)}
                className="mt-4 flex items-center gap-1.5 text-[11px] text-slate-400 hover:text-slate-700 transition-colors"
              >
                <Plus size={12} /> Add note
              </button>
            )}

            {noteOpen && (
              <div className="mt-4">
                <textarea
                  value={note}
                  onChange={(e) => setNoteText(e.target.value)}
                  disabled={busy}
                  rows={2}
                  autoFocus
                  placeholder="Anything worth remembering about this one"
                  // Not `maxLength`: a hard stop swallows keystrokes with no explanation. The
                  // counter turns red and the save is refused with a reason instead.
                  className={`w-full text-sm border rounded-lg px-3 py-2 text-slate-700 disabled:opacity-50
                              focus:outline-none focus:ring-2 focus:ring-slate-900/10 ${tooLong ? 'border-red-300' : 'border-slate-200'}`}
                />
                <div className="flex items-center justify-between gap-3 mt-1.5">
                  {/* Says what a note IS, because this UI taught the opposite until recently. */}
                  <p className="text-[11px] text-slate-400">Just a note. It does not flag this one.</p>
                  <span className={`text-[11px] tabular-nums ${tooLong ? 'text-red-500' : 'text-slate-300'}`}>
                    {trimmed.length}/{MAX_WATCH_NOTE}
                  </span>
                </div>
                <div className="flex items-center gap-2 mt-2">
                  <button
                    type="button"
                    disabled={busy || unchanged || tooLong}
                    onClick={() => run(async () => {
                      const next = trimmed === '' ? null : trimmed;
                      await setNote(row.id, next);
                      setSavedNote(next ?? '');
                      setNoteOpen(false);
                    })}
                    className="px-3.5 py-1.5 rounded-lg text-xs font-medium bg-slate-900 text-white
                               hover:bg-slate-700 disabled:opacity-40 transition-colors"
                  >
                    {busy ? 'Saving…' : 'Save note'}
                  </button>
                  {/* Restores what is stored rather than merely closing, or reopening would show
                      an edit the reader thought they had abandoned. */}
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => { setNoteText(savedNote); setNoteOpen(false); }}
                    className="text-xs text-slate-400 hover:text-slate-700 disabled:opacity-40 transition-colors"
                  >
                    Cancel
                  </button>
                </div>
              </div>
            )}

            {/* ─── ONE ROW, NO HEADING ────────────────────────────────────────────────────────
                This was a section header over a control whose own label said the same word, and
                a two-line explanation that spent one of those lines describing the DEFAULT — a
                row that is not flagged is counted toward its budget, which is what every other
                row on the page also does and needs no saying.

                The consequence survives for the state that has one. A flagged charge leaving its
                category's overspend measurement is the whole reason the flag matters, and is not
                something to discover later from a tile that went quiet. */}
            <button
              type="button"
              role="switch"
              aria-checked={watched}
              disabled={busy}
              onClick={() => run(async () => {
                await setWatched(row.id, !watched);
                setWatchedState(!watched);
              })}
              className="mt-4 flex items-start gap-2.5 text-left w-full disabled:opacity-50"
            >
              <span className={`shrink-0 mt-0.5 w-5 h-5 rounded-md border flex items-center justify-center transition-colors ${
                watched ? 'bg-amber-500 border-amber-500 text-white' : 'border-slate-300 text-transparent'
              }`}>
                <Flag size={11} fill="currentColor" />
              </span>
              <span className="text-sm text-slate-700 leading-snug">
                Keep an eye
                {watched && (
                  <span className="block text-xs text-slate-400">Left out of budget grading</span>
                )}
              </span>
            </button>
          </div>
        </div>
      )}
    </>
  );
}
