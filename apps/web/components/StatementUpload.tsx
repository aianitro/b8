'use client';

import { useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { FileUp, Check, X } from 'lucide-react';
import type { StatementPreview } from '@/lib/domain/brokerageStatement';
import type { ApiResponse } from '@b8/contracts/types';

const fmt = (n: number) =>
  new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: 2 }).format(n);

/** `2026-09-30` → "Sep 30, 2026", read as UTC so no zone moves the day. */
function longDate(iso: string): string {
  const [y, m, d] = iso.split('-').map(Number);
  return new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' })
    .format(new Date(Date.UTC(y, m - 1, d)));
}

/**
 * Record an investment account's value from its statement PDF: pick the file, check what was read,
 * save. The server reads the PDF and replies with a preview; nothing is recorded until the owner
 * presses the tick, and the value is dated to the statement rather than to today.
 *
 * ON THE ACCOUNT'S OWN PAGE, not in the accounts list — the owner's call: uploading a statement is
 * a visit to one account, and the list's rows are for scanning. The list keeps its pencil, so
 * typing a figure stays the fallback for a statement the reader does not recognise.
 *
 * THE PERIOD'S SHARES RECEIVED come with it: each "Transfer into Account" row, ticked unless the
 * ledger already has it, recorded as an income transaction the way earlier vests were entered by
 * hand. The statement does not say whether shares came from a vest or an ESPP purchase, so each
 * row carries a switch; RSU is the default because vests are the common case.
 */
type Kind = 'rsu' | 'espp';
export default function StatementUpload({ accountId }: { accountId: string }) {
  const router = useRouter();
  const inputRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [reading, setReading] = useState<StatementPreview | null>(null);
  // Per shares-received row, by index: whether to record it, and as what.
  const [picks, setPicks] = useState<{ on: boolean; kind: Kind }[]>([]);
  const [message, setMessage] = useState<{ tone: 'error' | 'done'; text: string } | null>(null);

  async function onFile(file: File | undefined) {
    if (!file) return;
    setBusy(true);
    setMessage(null);
    setReading(null);
    const form = new FormData();
    form.append('file', file);
    try {
      const res = await fetch(`/api/v1/accounts/${accountId}/statement`, { method: 'POST', body: form });
      const body = (await res.json()) as ApiResponse<StatementPreview>;
      if (body.success) {
        setReading(body.data);
        setPicks(body.data.transfersIn.map((t) => ({ on: !t.recorded, kind: 'rsu' as Kind })));
      }
      else setMessage({ tone: 'error', text: body.error.message });
    } catch {
      setMessage({ tone: 'error', text: 'Could not upload the statement.' });
    } finally {
      setBusy(false);
      // Cleared so choosing the same file again still fires `change`.
      if (inputRef.current) inputRef.current.value = '';
    }
  }

  async function save() {
    if (!reading) return;
    setBusy(true);
    try {
      const res = await fetch(`/api/v1/accounts/${accountId}/valuation`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ value: reading.value, asOf: reading.asOf }),
      });
      const body = (await res.json()) as ApiResponse<{ recorded: boolean }>;
      if (!body.success) {
        setMessage({ tone: 'error', text: body.error.message });
        return;
      }

      // Then the ticked shares-received rows, if any. The value is already saved at this point, so
      // a failure here says so rather than implying nothing was recorded.
      const rows = reading.transfersIn
        .map((t, i) => ({ t, p: picks[i] }))
        .filter(({ t, p }) => p?.on && !t.recorded)
        .map(({ t, p }) => ({ date: t.date, security: t.security, quantity: t.quantity, amount: t.amount, kind: p.kind }));
      let added = 0;
      if (rows.length > 0) {
        const tr = await fetch(`/api/v1/accounts/${accountId}/statement/transfers`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ rows }),
        });
        const tb = (await tr.json()) as ApiResponse<{ recorded: number; skipped: number }>;
        if (!tb.success) {
          setMessage({ tone: 'error', text: `Value saved, but the shares received were not: ${tb.error.message}` });
          setReading(null);
          router.refresh();
          return;
        }
        added = tb.data.recorded;
      }

      const valueText = body.data.recorded ? `Recorded as of ${longDate(reading.asOf)}` : 'Value already recorded';
      setMessage({
        tone: 'done',
        text: added > 0 ? `${valueText} · ${added} ${added === 1 ? 'vest' : 'vests'} added` : valueText,
      });
      setReading(null);
      router.refresh();
    } catch {
      setMessage({ tone: 'error', text: 'Could not save.' });
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex flex-col items-end gap-1">
      <input
        ref={inputRef}
        type="file"
        accept="application/pdf"
        className="hidden"
        onChange={(e) => onFile(e.target.files?.[0])}
      />
      <button
        type="button"
        onClick={() => inputRef.current?.click()}
        disabled={busy}
        title="Upload a statement"
        className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-slate-200 text-sm text-slate-700 hover:bg-slate-50 disabled:opacity-50 transition-colors"
      >
        <FileUp size={14} />
        {busy && !reading ? 'Reading…' : 'Upload statement'}
      </button>

      {reading && (
        <div className="rounded-lg border border-slate-200 bg-white shadow-sm px-2.5 py-1.5 text-right">
          <p className="text-[10px] text-slate-400">
            {reading.portfolio ?? reading.institution} · {longDate(reading.asOf)}{reading.accountEnding ? ` · …${reading.accountEnding}` : ''}
          </p>
          <div className="flex items-center justify-end gap-1">
            <span className="text-xs font-mono font-semibold text-slate-800">{fmt(reading.value)}</span>
            <button type="button" onClick={save} disabled={busy} title="Record this value"
                    className="p-1 text-emerald-600 hover:text-emerald-700 disabled:opacity-50">
              <Check size={13} />
            </button>
            <button type="button" onClick={() => setReading(null)} disabled={busy} title="Discard"
                    className="p-1 text-slate-400 hover:text-slate-600 disabled:opacity-50">
              <X size={13} />
            </button>
          </div>
          {reading.transfersIn.length > 0 && (
            <div className="mt-1.5 pt-1.5 border-t border-slate-100 space-y-1">
              <p className="text-[10px] text-slate-400">Shares received — add as income</p>
              {reading.transfersIn.map((t, i) => (
                <label key={i} className={`flex items-center justify-end gap-1.5 text-[11px] ${t.recorded ? 'text-slate-300' : 'text-slate-600'}`}>
                  <span>{longDate(t.date).replace(/, \d{4}$/, '')} · {t.quantity} sh</span>
                  <span className="font-mono">{fmt(t.amount)}</span>
                  {t.recorded ? (
                    <span className="text-[10px]">recorded</span>
                  ) : (
                    <>
                      <button
                        type="button"
                        onClick={(e) => { e.preventDefault(); setPicks((ps) => ps.map((p, j) => (j === i ? { ...p, kind: p.kind === 'rsu' ? 'espp' : 'rsu' } : p))); }}
                        title="Switch between RSU vest and ESPP purchase"
                        className="px-1 rounded bg-slate-100 text-[10px] font-medium text-slate-600 hover:bg-slate-200"
                      >
                        {picks[i]?.kind === 'espp' ? 'ESPP' : 'RSU'}
                      </button>
                      <input
                        type="checkbox"
                        checked={picks[i]?.on ?? false}
                        onChange={(e) => setPicks((ps) => ps.map((p, j) => (j === i ? { ...p, on: e.target.checked } : p)))}
                        className="accent-emerald-600"
                      />
                    </>
                  )}
                </label>
              ))}
            </div>
          )}
        </div>
      )}

      {message && (
        <p className={`text-[10px] max-w-[14rem] text-right ${message.tone === 'error' ? 'text-red-500' : 'text-emerald-600'}`}>
          {message.text}
        </p>
      )}
    </div>
  );
}
