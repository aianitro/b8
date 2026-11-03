'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Check } from 'lucide-react';
import { localIsoDate } from '@/lib/localDate';
import type { ApiResponse } from '@b8/contracts/types';

const fmt = (n: number) =>
  new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 2 }).format(n);

/** `2026-09-30` → "Sep 30, 2026", read as UTC so no zone moves the day. */
function longDate(iso: string): string {
  const [y, m, d] = iso.split('-').map(Number);
  return new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' })
    .format(new Date(Date.UTC(y, m - 1, d)));
}

interface Props {
  accountId: string;
  isLiability: boolean;
  /** The newest recorded valuation, or null if this account has never been valued. */
  latest: { value: number; date: string } | null;
}

/**
 * TYPE IN A VALUATION-MODE ACCOUNT'S CURRENT FIGURE, on the account's own page.
 *
 * Until this card the only place to enter one was the accounts list's hover pencil, and a mortgage
 * had nowhere else to go: the statement reader next door reads brokerage PDFs and is skipped for a
 * liability, and the opening-balance control belongs to ledger-mode accounts. So the owner who
 * opened a mortgage's own page found a chart of the amount owed and no way to move it.
 *
 * DATED, unlike the list's pencil. A mortgage balance is read off a statement that is already days
 * old by the time it is typed, and the series the chart draws is only as honest as its dates. Today
 * is the default and stamps the row at the current time, as the pencil does; an earlier date stamps
 * noon that day, and re-entering the same figure for that day records nothing — the server reads it
 * as the same observation rather than a second one.
 *
 * NOT FOR A LINKED ACCOUNT: Plaid appends a `plaid_balance` row at every sync, and a typed figure
 * would compete with it for "latest". That gate is the caller's.
 */
export default function AccountValuationRecord({ accountId, isLiability, latest }: Props) {
  const router = useRouter();
  const today = localIsoDate();
  const [amount, setAmount] = useState('');
  const [asOf, setAsOf] = useState(today);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<{ tone: 'error' | 'done'; text: string } | null>(null);

  async function save() {
    const value = Number(amount.replace(/[$,\s]/g, ''));
    if (amount.trim() === '' || !Number.isFinite(value)) {
      setMessage({ tone: 'error', text: 'Enter a number.' });
      return;
    }
    // A liability is stored as the amount owed, positive: the minus sign on screen is derived from
    // accounts.is_liability, so a negative here would double-negate the debt into an asset. The
    // server rejects it too — this only says so without a round trip.
    if (value < 0) {
      setMessage({
        tone: 'error',
        text: isLiability ? 'Enter the amount owed as a positive figure.' : 'Enter a positive amount.',
      });
      return;
    }

    setSaving(true);
    setMessage(null);
    try {
      const res = await fetch(`/api/v1/accounts/${accountId}/valuation`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        // `asOf` omitted for today, which stamps the row now rather than at noon — two figures
        // typed on the same day then order by when they were entered, and the later one wins.
        body: JSON.stringify(asOf === today ? { value } : { value, asOf }),
      });
      const body = (await res.json()) as ApiResponse<{ recorded: boolean }>;
      if (!body.success) {
        setMessage({ tone: 'error', text: body.error.message });
        return;
      }
      setMessage(
        body.data.recorded
          ? { tone: 'done', text: `Recorded as of ${longDate(asOf)}.` }
          : { tone: 'done', text: 'That figure was already recorded for that date.' }
      );
      setAmount('');
      router.refresh();
    } catch {
      setMessage({ tone: 'error', text: 'Could not save.' });
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="bg-white rounded-2xl border border-slate-100 shadow-sm p-4 sm:p-5">
      <p className="text-sm font-semibold text-slate-900">
        {isLiability ? 'Record the amount owed' : 'Record a value'}
      </p>
      <p className="text-xs text-slate-500 mt-0.5">
        {latest
          ? `Last recorded ${fmt(latest.value)} on ${longDate(latest.date)}. `
          : 'Nothing recorded yet. '}
        Every entry is kept, so re-entering it each month builds the history above.
      </p>

      <div className="mt-3 flex flex-wrap items-end gap-2">
        <label className="flex flex-col gap-1">
          <span className="text-[10px] font-semibold uppercase tracking-wider text-slate-400">
            {isLiability ? 'Amount owed' : 'Value'}
          </span>
          <span className="flex items-center gap-1.5 bg-white border border-slate-300 rounded-lg px-2 py-1.5 shadow-sm">
            <span className="text-xs text-slate-400">$</span>
            <input
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') save(); }}
              placeholder="0.00"
              inputMode="decimal"
              aria-label={isLiability ? 'Amount owed' : 'Value'}
              className="w-28 text-sm font-mono text-slate-800 outline-none"
            />
          </span>
        </label>

        <label className="flex flex-col gap-1">
          <span className="text-[10px] font-semibold uppercase tracking-wider text-slate-400">As of</span>
          <input
            type="date"
            value={asOf}
            max={today}
            onChange={(e) => setAsOf(e.target.value)}
            aria-label="Date this figure is read from"
            className="text-sm text-slate-800 bg-white border border-slate-300 rounded-lg px-2 py-1.5 shadow-sm outline-none"
          />
        </label>

        <button
          type="button"
          onClick={save}
          disabled={saving}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-slate-200 text-sm text-slate-700 hover:bg-slate-50 disabled:opacity-50 transition-colors"
        >
          <Check size={14} />
          {saving ? 'Saving…' : 'Record'}
        </button>
      </div>

      {message && (
        <p className={`mt-2 text-xs ${message.tone === 'error' ? 'text-red-500' : 'text-emerald-600'}`}>
          {message.text}
        </p>
      )}
    </div>
  );
}
