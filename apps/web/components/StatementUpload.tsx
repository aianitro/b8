'use client';

import { useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { FileUp, Check, X } from 'lucide-react';
import type { StatementReading } from '@/lib/domain/brokerageStatement';
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
 * Beside the pencil rather than instead of it — typing a figure stays the fallback for a statement
 * the reader does not recognise, and for the days between statements.
 */
export default function StatementUpload({ accountId }: { accountId: string }) {
  const router = useRouter();
  const inputRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [reading, setReading] = useState<StatementReading | null>(null);
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
      const body = (await res.json()) as ApiResponse<StatementReading>;
      if (body.success) setReading(body.data);
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
      setMessage({
        tone: 'done',
        text: body.data.recorded ? `Recorded as of ${longDate(reading.asOf)}` : 'Already recorded',
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
        className="flex items-center gap-1 text-[10px] text-slate-400 hover:text-blue-600 disabled:opacity-50 transition-colors"
      >
        <FileUp size={11} />
        {busy && !reading ? 'Reading…' : 'Statement'}
      </button>

      {reading && (
        <div className="rounded-lg border border-slate-200 bg-white shadow-sm px-2.5 py-1.5 text-right">
          <p className="text-[10px] text-slate-400">
            {longDate(reading.asOf)}{reading.accountEnding ? ` · account …${reading.accountEnding}` : ''}
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
