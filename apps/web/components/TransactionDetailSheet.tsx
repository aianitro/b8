'use client';

import { useCallback, useEffect, useRef, useState, type ReactNode, type SyntheticEvent } from 'react';
import { createPortal } from 'react-dom';
import { useRouter } from 'next/navigation';
import { X, MapPin, ExternalLink, Plus } from 'lucide-react';
import MerchantMark from './MerchantMark';
import type { TransactionDetail } from '@/lib/transactionDetail';
import { setDate, setNote } from '@/lib/transactionEdits';
import { localIsoDate } from '@/lib/localDate';
import { MAX_WATCH_NOTE as MAX_NOTE } from '@b8/contracts/overview';
import { useVisibleViewport } from '@/lib/useVisibleViewport';
import type { ApiResponse } from '@b8/contracts/types';

const fmt = (n: number) =>
  new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 2 }).format(n);

/** `2026-03-04` → "Wed, Mar 4, 2026". Read as UTC on both sides, so no zone can move the day. */
function longDate(iso: string): string {
  const [y, m, d] = iso.split('-').map(Number);
  return new Intl.DateTimeFormat('en-US', { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' })
    .format(new Date(Date.UTC(y, m - 1, d)));
}

/** The host a link points at, which is what the owner recognises — not the full URL. */
const host = (url: string) => new URL(url).hostname.replace(/^www\./, '');

/**
 * A button around a row's merchant mark and name that opens the transaction's detail sheet.
 *
 * THE NAME, NOT THE ROW. Both lists put controls in every row — a category picker, toggles, a
 * swipe to delete — so a whole-row tap would compete with every one of them. The name is the one
 * part of a row that did nothing when tapped, and it is where the eye already goes.
 */
export function TransactionDetailButton({ transactionId, children, className = '' }: {
  transactionId: number;
  children: ReactNode;
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className={`text-left min-w-0 cursor-pointer hover:[&_.detail-title]:text-blue-600 ${className}`}
      >
        {children}
      </button>
      {open && <TransactionDetailSheet transactionId={transactionId} onClose={() => setOpen(false)} />}
    </>
  );
}

/**
 * The detail sheet: a bottom sheet on a phone, a centred dialog from `sm` up.
 *
 * Fetched when opened rather than shipped with every row: the lists render hundreds of rows and
 * the detail of almost none of them is ever looked at. Everything shown comes from the curated
 * `TransactionDetail`, so a section with nothing in it is simply not rendered.
 */
export default function TransactionDetailSheet({ transactionId, onClose: close }: { transactionId: number; onClose: () => void }) {
  const router = useRouter();
  const [detail, setDetail] = useState<TransactionDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  // Whether a note or a date was saved while open. The list behind shows both, so it is refetched on the way
  // out — not on save, which would re-render the list under a sheet that is still being read. A ref,
  // because it is only ever read from a handler, never to render.
  const dirty = useRef(false);
  const onClose = useCallback(() => {
    close();
    if (dirty.current) router.refresh();
  }, [close, router]);

  // The note field raises a keyboard, and iOS draws it OVER the layout viewport, so `items-end`
  // alone parks the sheet behind the keys. `lib/useVisibleViewport.ts` has the whole story; the
  // flag sheet in `TransactionTable` hit it twice before using this.
  const visible = useVisibleViewport(true);

  useEffect(() => {
    let live = true;
    fetch(`/api/v1/transactions/${transactionId}`)
      .then((r) => r.json() as Promise<ApiResponse<TransactionDetail>>)
      .then((body) => {
        if (!live) return;
        if (body.success) setDetail(body.data);
        else setError(body.error.message);
      })
      .catch(() => { if (live) setError('Could not load this transaction.'); });
    return () => { live = false; };
  }, [transactionId]);

  // Esc closes, and the page behind does not scroll while the sheet is up.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', onKey);
    const overflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = overflow;
    };
  }, [onClose]);

  // A PORTAL, AND EVERY EVENT STOPPED AT ITS EDGE. On the account page the sheet's owner sits in
  // a swipe row moved by a CSS transform, and a transformed ancestor turns `position: fixed` into
  // "fixed to that row" — so the sheet is mounted on <body>. React still bubbles a portal's events
  // through the component tree, though, so without the stops a tap on the backdrop would close the
  // sheet and then reach the button that opened it, and scrolling the sheet would swipe the row.
  const stop = (e: SyntheticEvent) => e.stopPropagation();
  return createPortal(
    <div
      className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-slate-900/40"
      style={visible ? {
        top: visible.top, left: visible.left, width: visible.width, height: visible.height,
        right: 'auto', bottom: 'auto',
      } : undefined}
      onClick={(e) => { e.stopPropagation(); onClose(); }}
      onTouchStart={stop}
      onTouchMove={stop}
      onTouchEnd={stop}
      onTouchCancel={stop}
      onKeyDown={stop}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Transaction details"
        onClick={(e) => e.stopPropagation()}
        style={visible ? { maxHeight: visible.height * 0.85 } : undefined}
        className="bg-white w-full sm:max-w-md max-h-[85vh] overflow-y-auto rounded-t-2xl sm:rounded-2xl shadow-2xl pb-[env(safe-area-inset-bottom)]"
      >
        <div className="sticky top-0 bg-white flex items-start gap-3 px-5 pt-5 pb-3 border-b border-slate-100">
          <div className="min-w-0 flex-1">
            {detail ? (
              <div className="flex items-center gap-3 min-w-0">
                <MerchantMark logoUrl={detail.logoUrl} title={detail.title} />
                <div className="min-w-0">
                  <p className="font-semibold text-slate-900 truncate">{detail.title ?? 'Transaction'}</p>
                  <a href={`/accounts/${detail.account.id}`} className="text-xs text-slate-500 hover:text-blue-600">
                    {detail.account.name}
                  </a>
                </div>
              </div>
            ) : (
              <p className="font-semibold text-slate-400">{error ? 'Transaction' : 'Loading…'}</p>
            )}
          </div>
          <button type="button" onClick={onClose} aria-label="Close" autoFocus className="p-1 -m-1 text-slate-400 hover:text-slate-600">
            <X size={18} />
          </button>
        </div>

        {error && <p className="px-5 py-6 text-sm text-red-500">{error}</p>}
        {!detail && !error && <div className="px-5 py-10" />}
        {detail && <DetailBody d={detail} onChanged={() => { dirty.current = true; }} />}
      </div>
    </div>,
    document.body
  );
}

function DetailBody({ d, onChanged }: { d: TransactionDetail; onChanged: () => void }) {
  const income = d.amount < 0;
  const loc = d.location;
  const cityLine = loc ? [[loc.city, loc.region].filter(Boolean).join(', '), loc.postalCode].filter(Boolean).join(' ') : '';
  const plaidCategory = [d.plaidCategory, d.plaidCategoryDetailed].filter(Boolean).join(' › ');

  return (
    <div className="px-5 py-4 space-y-5 text-sm">
      <div>
        <p className={`text-3xl font-bold font-mono ${income ? 'text-emerald-600' : 'text-slate-900'}`}>
          {income ? '+' : '−'}{fmt(Math.abs(d.amount))}
        </p>
        <div className="flex flex-wrap gap-1.5 mt-2 empty:hidden">
          {d.watched && <Chip className="bg-amber-50 text-amber-700">Watching</Chip>}
          {d.hidden && <Chip className="bg-slate-100 text-slate-500">Hidden</Chip>}
        </div>
      </div>

      <Section title="When">
        {d.dateEditable
          ? <DateEditor transactionId={d.id} initial={d.date} onSaved={onChanged} />
          : <Field label="Posted">{longDate(d.date)}</Field>}
        {d.authorizedDate && <Field label="Authorized">{longDate(d.authorizedDate)}</Field>}
      </Section>

      {loc && (
        <Section title="Where">
          <div className="flex items-start gap-2 text-slate-700">
            <MapPin size={15} className="mt-0.5 shrink-0 text-slate-400" />
            <div className="min-w-0">
              {loc.address && <p>{loc.address}</p>}
              {cityLine && <p>{cityLine}</p>}
              {loc.country && loc.country !== 'US' && <p>{loc.country}</p>}
              {loc.storeNumber && <p className="text-xs text-slate-400 mt-0.5">Store #{loc.storeNumber}</p>}
            </div>
          </div>
          {d.mapsUrl && (
            <a href={d.mapsUrl} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 mt-2 text-blue-600 hover:text-blue-700 font-medium">
              Open in Maps <ExternalLink size={13} />
            </a>
          )}
        </Section>
      )}

      {(d.website || d.counterparties.length > 0) && (
        <Section title="Merchant">
          {d.website && (
            <Field label="Website">
              <a href={d.website} target="_blank" rel="noopener noreferrer" className="text-blue-600 hover:text-blue-700">{host(d.website)}</a>
            </Field>
          )}
          {d.counterparties.map((c, i) => (
            <Field key={i} label={c.type ?? 'Counterparty'}>
              {c.website
                ? <a href={c.website} target="_blank" rel="noopener noreferrer" className="text-blue-600 hover:text-blue-700">{c.name}</a>
                : c.name}
            </Field>
          ))}
        </Section>
      )}

      {(d.paymentChannel || d.paymentMethod || d.paymentProcessor) && (
        <Section title="Payment">
          {d.paymentChannel && <Field label="Channel">{d.paymentChannel}</Field>}
          {d.paymentMethod && <Field label="Method">{d.paymentMethod}</Field>}
          {d.paymentProcessor && <Field label="Processor">{d.paymentProcessor}</Field>}
        </Section>
      )}

      <Section title="Category">
        <Field label="Budget">{d.budgetCategory ?? <span className="text-amber-600">Uncategorized</span>}</Field>
        {plaidCategory && (
          <Field label="Bank says">
            {plaidCategory}
            {d.plaidConfidence && <span className="text-slate-400"> · {d.plaidConfidence.toLowerCase()} confidence</span>}
          </Field>
        )}
      </Section>

      {/* Always rendered now: the note editor is here, and a transaction with no note is exactly
          the one someone opens this to annotate. */}
      <Section title="Notes">
        {d.bankDescription && <Field label="Statement text"><span className="font-mono text-xs break-all">{d.bankDescription}</span></Field>}
        <NoteEditor transactionId={d.id} initial={d.note} onSaved={onChanged} />
      </Section>

      {!d.enriched && (
        <p className="text-xs text-slate-400">
          No extra details from the bank for this transaction — it was entered by hand, imported, or
          arrived before details were kept.
        </p>
      )}
    </div>
  );
}

/**
 * Move a hand-entered cash row to the day it actually happened.
 *
 * Offered only when the route says `dateEditable` — a hand-entered row on a cash wallet. A cash
 * count files what it found under the day of the count, and a spend remembered later is entered on
 * the day it is remembered; both are usually some other day. The route moves the other half of a
 * wallet-to-wallet move with it, so a move never shows as leaving on one day and arriving on another.
 */
function DateEditor({ transactionId, initial, onSaved }: {
  transactionId: number;
  initial: string;
  onSaved: () => void;
}) {
  const [saved, setSaved] = useState(initial);
  const [value, setValue] = useState(initial);
  const [editing, setEditing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Today on THIS device's calendar, not UTC's — the same rule the cash forms date their rows by.
  const today = localIsoDate();

  async function save() {
    setBusy(true);
    setError(null);
    try {
      await setDate(transactionId, value);
      setSaved(value);
      setEditing(false);
      onSaved();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'That did not work. Try again.');
    } finally {
      setBusy(false);
    }
  }

  if (!editing) {
    return (
      <Field label="Date">
        {longDate(saved)}{' '}
        <button
          type="button"
          onClick={() => { setValue(saved); setEditing(true); }}
          className="ml-1 text-xs text-slate-400 hover:text-slate-700 underline transition-colors"
        >
          Change
        </button>
      </Field>
    );
  }

  return (
    <div>
      <div className="flex items-center gap-2">
        {/* `text-base` below `sm`: iOS zooms the page into any field under 16px. */}
        <input
          type="date"
          value={value}
          max={today}
          onChange={(e) => setValue(e.target.value)}
          disabled={busy}
          aria-label="Date"
          className="flex-1 min-w-0 text-base sm:text-sm border border-slate-200 rounded-lg px-3 py-1.5 text-slate-700 disabled:opacity-50 focus:outline-none focus:ring-2 focus:ring-slate-900/10"
        />
        <button
          type="button"
          disabled={busy || value === '' || value === saved || value > today}
          onClick={save}
          className="px-3.5 py-1.5 rounded-lg text-xs font-medium bg-slate-900 text-white hover:bg-slate-700 disabled:opacity-40 transition-colors"
        >
          {busy ? 'Saving…' : 'Save'}
        </button>
        <button
          type="button"
          disabled={busy}
          onClick={() => { setValue(saved); setError(null); setEditing(false); }}
          className="text-xs text-slate-400 hover:text-slate-700 disabled:opacity-40 transition-colors"
        >
          Cancel
        </button>
      </div>
      {error && <p className="text-xs text-red-500 mt-1">{error}</p>}
    </div>
  );
}

/**
 * Write, change or clear the owner's note on ANY transaction — not only a flagged one.
 *
 * WHY HERE. The flag is "keep an eye on this", and on the transactions page its sheet was the only
 * note field, so annotating a row meant flagging it; on an account's page there was no way at all.
 * This sheet opens from both, so one editor here covers both. It sends `{ note }` alone through
 * `setNote`, which leaves the flag untouched — a note is a note.
 *
 * Collapsed behind "Add note" for the dashboard editor's reason: an open empty field reads as a
 * question awaiting an answer. An existing note shows as text with an Edit beside it.
 */
function NoteEditor({ transactionId, initial, onSaved }: {
  transactionId: number;
  initial: string | null;
  onSaved: () => void;
}) {
  const [saved, setSaved] = useState(initial ?? '');
  const [text, setText] = useState(initial ?? '');
  const [editing, setEditing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const trimmed = text.trim();
  // Not `maxLength`: a hard stop swallows keystrokes with no explanation. The counter turns red and
  // the save is refused instead.
  const tooLong = trimmed.length > MAX_NOTE;

  async function save() {
    setBusy(true);
    setError(null);
    try {
      const next = trimmed === '' ? null : trimmed;
      await setNote(transactionId, next);
      setSaved(next ?? '');
      setText(next ?? '');
      setEditing(false);
      onSaved();
    } catch (e) {
      // The route says why — a gift-held row, a note over the limit — so show its words.
      setError(e instanceof Error ? e.message : 'That did not work. Try again.');
    } finally {
      setBusy(false);
    }
  }

  if (!editing) {
    return saved === '' ? (
      <button
        type="button"
        onClick={() => setEditing(true)}
        className="flex items-center gap-1.5 text-slate-500 hover:text-slate-800 transition-colors"
      >
        <Plus size={14} /> Add note
      </button>
    ) : (
      <div className="flex items-start gap-3">
        <p className="flex-1 min-w-0 text-slate-800 whitespace-pre-wrap break-words">{saved}</p>
        <button
          type="button"
          onClick={() => setEditing(true)}
          className="shrink-0 text-xs text-slate-400 hover:text-slate-700 underline transition-colors"
        >
          Edit
        </button>
      </div>
    );
  }

  return (
    <div>
      {/* `text-base` below `sm`: iOS zooms the page into any field under 16px. Autofocus is fine
          here, unlike on open: the keyboard comes up because "Add note" or "Edit" was tapped. */}
      <textarea
        value={text}
        onChange={(e) => setText(e.target.value)}
        disabled={busy}
        rows={3}
        autoFocus
        placeholder="Anything worth remembering about this one"
        className={`w-full text-base sm:text-sm border rounded-lg px-3 py-2 text-slate-700 disabled:opacity-50
                    focus:outline-none focus:ring-2 focus:ring-slate-900/10 ${tooLong ? 'border-red-300' : 'border-slate-200'}`}
      />
      <div className="flex items-center justify-between gap-3 mt-1">
        <p className="text-[11px] text-slate-400">Just a note. It does not flag this one.</p>
        <span className={`text-[11px] tabular-nums ${tooLong ? 'text-red-500' : 'text-slate-300'}`}>
          {trimmed.length}/{MAX_NOTE}
        </span>
      </div>
      {error && <p className="text-xs text-red-500 mt-1">{error}</p>}
      <div className="flex items-center gap-2 mt-2">
        <button
          type="button"
          disabled={busy || tooLong || trimmed === saved}
          onClick={save}
          className="px-3.5 py-1.5 rounded-lg text-xs font-medium bg-slate-900 text-white hover:bg-slate-700 disabled:opacity-40 transition-colors"
        >
          {busy ? 'Saving…' : 'Save note'}
        </button>
        {/* Restores what is stored, or reopening would show an edit the reader abandoned. */}
        <button
          type="button"
          disabled={busy}
          onClick={() => { setText(saved); setError(null); setEditing(false); }}
          className="text-xs text-slate-400 hover:text-slate-700 disabled:opacity-40 transition-colors"
        >
          Cancel
        </button>
      </div>
    </div>
  );
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section>
      <h3 className="text-[10px] font-semibold uppercase tracking-wider text-slate-400 mb-1.5">{title}</h3>
      <div className="space-y-1">{children}</div>
    </section>
  );
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex items-baseline justify-between gap-4">
      <span className="text-slate-500 shrink-0">{label}</span>
      <span className="text-slate-800 text-right min-w-0 break-words">{children}</span>
    </div>
  );
}

function Chip({ className, children }: { className: string; children: ReactNode }) {
  return <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${className}`}>{children}</span>;
}
