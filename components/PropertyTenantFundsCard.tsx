'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Plus, X } from 'lucide-react';
import type { TenantHeldFunds } from '@/lib/domain/property';
import type { TenantFundKind } from '@/shared/types';

interface Props {
  propertyId: number;
  funds: TenantHeldFunds;
  /** Rentals only. A primary residence has no tenant to hold money for, so the form would be an
   *  invitation to record something that cannot exist — the figures themselves stay visible
   *  either way, so a deposit recorded before a reclassification never becomes invisible. */
  canRecord: boolean;
}

const fmt = (n: number) =>
  new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 }).format(n);

const today = () => new Date().toISOString().slice(0, 10);

// A dash, never a zero. `value === null` means no reading has ever been entered — the amount is
// unknown — while a recorded 0 is a real statement (a waived deposit; last month's rent applied
// and not yet re-collected). Rendering the first as "$0" would assert on the page that a tenant
// paid nothing, which is the whole regression this card exists to avoid; hence the explicit
// conditional rather than a `fmt(value ?? 0)`.
function Figure({ label, value, note }: { label: string; value: number | null; note: string }) {
  return (
    <div>
      <p className="text-[10px] uppercase tracking-wide text-slate-400">{label}</p>
      {value === null ? (
        <p className="text-2xl font-mono font-semibold text-slate-300 leading-tight mt-1" title="No amount recorded">
          —
        </p>
      ) : (
        <p className="text-2xl font-mono font-semibold text-slate-900 leading-tight mt-1">{fmt(value)}</p>
      )}
      <p className="text-[11px] text-slate-400 mt-1">{value === null ? 'Not recorded' : note}</p>
    </div>
  );
}

// Money the property holds that arrived from its tenant. Both figures are shown because "you are
// holding $X of tenant money" is true of both; only the deposit is *owed back*, and only it is
// subtracted from net worth (lib/domain/netWorth.ts). Last month's rent was already recognized as
// rent income by the cash-basis P&L on the day it landed, so counting it as a liability here
// would make this page and the P&L disagree about the same dollar — the note under each figure
// says which is which rather than leaving a reader to infer it from the totals.
export default function PropertyTenantFundsCard({ propertyId, funds, canRecord }: Props) {
  const router = useRouter();
  const [, startTransition] = useTransition();
  const [open, setOpen] = useState(false);
  const [kind, setKind] = useState<TenantFundKind>('security_deposit');
  const [value, setValue] = useState('');
  const [valuedAt, setValuedAt] = useState(today());
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function record(e: React.FormEvent) {
    e.preventDefault();
    const parsed = Number(value.replace(/[$,\s]/g, ''));
    if (value.trim() === '' || !Number.isFinite(parsed)) { setError('Enter a number'); return; }
    if (parsed < 0) { setError('Enter a positive amount'); return; }

    setSaving(true); setError(null);
    const res = await fetch(`/api/properties/${propertyId}/tenant-funds`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      // Sent as a date-only string; the column is timestamptz and takes midnight local.
      body: JSON.stringify({ kind, value: parsed, valued_at: valuedAt || undefined }),
    });
    setSaving(false);

    if (!res.ok) {
      const body = await res.json().catch(() => null);
      setError(body?.error?.message ?? 'Could not save');
      return;
    }
    setValue('');
    setValuedAt(today());
    setOpen(false);
    startTransition(async () => { await router.refresh(); });
  }

  return (
    <div className="bg-white rounded-2xl border border-slate-100 shadow-sm p-6">
      <div className="flex items-center justify-between gap-3 mb-5">
        <p className="text-xs font-semibold uppercase tracking-wider text-slate-400">Tenant money held</p>
        {canRecord && (
          <button
            onClick={() => setOpen((v) => !v)}
            className="flex items-center gap-1 text-[11px] text-slate-400 hover:text-slate-700 transition-colors shrink-0"
          >
            {open ? <><X size={11} /> Close</> : <><Plus size={11} /> Record amount</>}
          </button>
        )}
      </div>

      <div className="grid grid-cols-2 gap-6">
        <Figure
          label="Security deposit"
          value={funds.securityDeposit}
          note="Owed back at move-out — subtracted from net worth"
        />
        <Figure
          label="Last month's rent"
          value={funds.lastMonthRent}
          note="Already counted as rent income — not a liability"
        />
      </div>

      {open && (
        <form onSubmit={record} className="mt-5 pt-5 border-t border-slate-100 flex items-end gap-2">
          <div>
            <label className="block text-[10px] font-medium text-slate-400 mb-1">Holding</label>
            <select
              value={kind}
              onChange={(e) => setKind(e.target.value as TenantFundKind)}
              className="text-sm border border-slate-200 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-slate-900/10"
            >
              <option value="security_deposit">Security deposit</option>
              <option value="last_month_rent">Last month&apos;s rent</option>
            </select>
          </div>
          <div className="flex-1">
            <label className="block text-[10px] font-medium text-slate-400 mb-1">Amount</label>
            <input
              value={value}
              onChange={(e) => setValue(e.target.value)}
              placeholder="2,500"
              inputMode="decimal"
              className="w-full text-sm font-mono border border-slate-200 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-slate-900/10"
            />
          </div>
          <div>
            <label className="block text-[10px] font-medium text-slate-400 mb-1">As of</label>
            <input
              type="date"
              value={valuedAt}
              max={today()}
              onChange={(e) => setValuedAt(e.target.value)}
              className="text-sm border border-slate-200 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-slate-900/10"
            />
          </div>
          <button
            type="submit"
            disabled={saving}
            className="flex items-center gap-1 px-3 py-2 bg-slate-900 hover:bg-slate-700 text-white rounded-lg text-sm font-medium disabled:opacity-40 transition-colors"
          >
            <Plus size={14} />
            {saving ? 'Saving…' : 'Record'}
          </button>
        </form>
      )}

      {open && (
        // Says out loud what append-only means here, because the alternative reading — "this
        // edits the amount" — is the natural one and would make an entry look destructive.
        <p className="text-[11px] text-slate-400 mt-3">
          Each entry is a reading, not an edit: recording a new amount supersedes the last one and
          keeps it on the record. Enter $0 for a deposit that was waived or refunded.
        </p>
      )}

      {error && <p className="text-xs text-red-600 mt-3">{error}</p>}
    </div>
  );
}
