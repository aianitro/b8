'use client';

import { useEffect, useState, type ReactNode, type SyntheticEvent } from 'react';
import { createPortal } from 'react-dom';
import { X, MapPin, ExternalLink } from 'lucide-react';
import MerchantMark from './MerchantMark';
import type { TransactionDetail } from '@/lib/transactionDetail';
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
export default function TransactionDetailSheet({ transactionId, onClose }: { transactionId: number; onClose: () => void }) {
  const [detail, setDetail] = useState<TransactionDetail | null>(null);
  const [error, setError] = useState<string | null>(null);

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
        {detail && <DetailBody d={detail} />}
      </div>
    </div>,
    document.body
  );
}

function DetailBody({ d }: { d: TransactionDetail }) {
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
        <Field label="Posted">{longDate(d.date)}</Field>
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

      {(d.bankDescription || d.note) && (
        <Section title="Notes">
          {d.bankDescription && <Field label="Statement text"><span className="font-mono text-xs break-all">{d.bankDescription}</span></Field>}
          {d.note && <Field label="Your note">{d.note}</Field>}
        </Section>
      )}

      {!d.enriched && (
        <p className="text-xs text-slate-400">
          No extra details from the bank for this transaction — it was entered by hand, imported, or
          arrived before details were kept.
        </p>
      )}
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
