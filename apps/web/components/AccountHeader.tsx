'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { ArrowLeft, Pencil } from 'lucide-react';
import { ACCOUNT_TYPES, accountTypeLabel } from '@/lib/accountTypes';

type Landscape = 'operational' | 'capital';

interface Props {
  id: string;
  name: string;
  type: string;
  subtype: string | null;
  bank: string | null;
  mask: string | null;
  landscape: Landscape;
  /** Shown after the badges, e.g. "valued, not ledgered". */
  note?: string;
}

const LANDSCAPE_BADGE: Record<Landscape, string> = {
  operational: 'bg-blue-50 text-blue-700',
  capital:     'bg-violet-50 text-violet-700',
};

// `text-base` below `sm` on every field: iOS zooms the page into any input under 16px.
// No autoFocus on the panel: on a phone it raises the keyboard over the form being opened.
const FIELD = 'w-full text-base sm:text-sm border border-slate-200 rounded-lg px-3 py-2 bg-white text-slate-800 focus:outline-none focus:ring-1 focus:ring-slate-400';

/** The key a type is chosen by — the same one `accountTypeLabel` matches on. */
const typeKey = (type: string, subtype: string | null) => subtype ?? type;

/**
 * The account's identity and the one place to change it.
 *
 * MOVED HERE FROM THE /accounts LIST. Name, type, bank and landscape were inline edits on every
 * row there, revealed by a pencil that appears on hover — which a phone never does, so on the PWA
 * they were invisible controls. They are settings of one account, and this is that account's page.
 */
export default function AccountHeader({ id, name, type, subtype, bank, mask, landscape, note }: Props) {
  const router = useRouter();
  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [form, setForm] = useState({ name, bank: bank ?? '', type: typeKey(type, subtype), landscape });

  // A Plaid-synced subtype ("ira", "money market") is not one of the canonical choices. It is
  // offered as itself, so opening the form and saving something else does not quietly rewrite it.
  const typeKnown = ACCOUNT_TYPES.some((t) => typeKey(t.type, t.subtype) === typeKey(type, subtype));

  function open() {
    setForm({ name, bank: bank ?? '', type: typeKey(type, subtype), landscape });
    setError(null);
    setEditing(true);
  }

  async function save(e: React.FormEvent) {
    e.preventDefault();
    const trimmed = form.name.trim();
    if (!trimmed) { setError('Name cannot be empty.'); return; }

    // Only what changed. The endpoint applies fields one at a time, so sending all four would
    // rewrite type and subtype on every save — and erase a synced subtype nobody touched.
    const body: Record<string, unknown> = {};
    if (trimmed !== name) body.name = trimmed;
    if (form.bank.trim() !== (bank ?? '')) body.bank = form.bank.trim() || null;
    if (form.landscape !== landscape) body.landscape = form.landscape;
    if (form.type !== typeKey(type, subtype)) {
      const chosen = ACCOUNT_TYPES.find((t) => typeKey(t.type, t.subtype) === form.type);
      if (chosen) { body.type = chosen.type; body.subtype = chosen.subtype; }
    }
    if (Object.keys(body).length === 0) { setEditing(false); return; }

    setSaving(true);
    setError(null);
    const res = await fetch(`/api/v1/accounts/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    }).catch(() => null);
    setSaving(false);
    if (!res?.ok) { setError('Could not save. Try again.'); return; }
    setEditing(false);
    router.refresh();
  }

  return (
    <header>
      <Link href="/accounts" className="inline-flex items-center gap-1.5 text-sm text-slate-400 hover:text-slate-600 transition-colors mb-3">
        <ArrowLeft size={14} /> Accounts
      </Link>
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          <h1 className="text-2xl font-bold text-slate-900 break-words">{name}</h1>
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1 mt-1.5 text-sm text-slate-500">
            <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${LANDSCAPE_BADGE[landscape]}`}>{landscape}</span>
            <span className="text-xs px-2 py-0.5 rounded-full font-medium bg-slate-100 text-slate-600">{accountTypeLabel(type, subtype)}</span>
            {bank && <span>{bank}</span>}
            {mask && <span className="text-slate-400 tabular-nums">•••• {mask}</span>}
            {note && <span className="text-slate-400">{note}</span>}
          </div>
        </div>
        {!editing && (
          <button
            type="button"
            onClick={open}
            className="shrink-0 inline-flex items-center gap-1.5 rounded-lg border border-slate-300 px-3 py-1.5 text-sm font-medium text-slate-700 hover:bg-slate-50 transition-colors"
          >
            <Pencil size={14} /> Edit
          </button>
        )}
      </div>

      {editing && (
        <form onSubmit={save} className="mt-4 bg-white rounded-2xl border border-slate-100 shadow-sm p-4 sm:p-6">
          <div className="grid gap-4 sm:grid-cols-2">
            <label className="block">
              <span className="text-xs font-semibold uppercase tracking-wider text-slate-400">Name</span>
              <input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} className={`${FIELD} mt-1`} autoComplete="off" />
            </label>
            <label className="block">
              <span className="text-xs font-semibold uppercase tracking-wider text-slate-400">Bank</span>
              <input value={form.bank} onChange={(e) => setForm({ ...form, bank: e.target.value })} placeholder="Bank name" className={`${FIELD} mt-1`} autoComplete="off" />
            </label>
            <label className="block">
              <span className="text-xs font-semibold uppercase tracking-wider text-slate-400">Type</span>
              <select value={form.type} onChange={(e) => setForm({ ...form, type: e.target.value })} className={`${FIELD} mt-1`}>
                {!typeKnown && <option value={typeKey(type, subtype)}>{accountTypeLabel(type, subtype)}</option>}
                {ACCOUNT_TYPES.map((t) => <option key={t.label} value={typeKey(t.type, t.subtype)}>{t.label}</option>)}
              </select>
            </label>
            <label className="block">
              <span className="text-xs font-semibold uppercase tracking-wider text-slate-400">Landscape</span>
              <select value={form.landscape} onChange={(e) => setForm({ ...form, landscape: e.target.value as Landscape })} className={`${FIELD} mt-1`}>
                <option value="operational">Operational</option>
                <option value="capital">Capital</option>
              </select>
            </label>
          </div>
          {error && <p className="text-red-500 text-sm mt-3">{error}</p>}
          <div className="flex justify-end gap-2 mt-5">
            <button type="button" onClick={() => setEditing(false)} disabled={saving} className="px-4 py-2 rounded-lg text-sm font-medium text-slate-600 hover:bg-slate-100 disabled:opacity-50">
              Cancel
            </button>
            <button type="submit" disabled={saving} className="px-4 py-2 rounded-lg text-sm font-medium bg-slate-900 text-white hover:bg-slate-800 disabled:opacity-50">
              {saving ? 'Saving…' : 'Save'}
            </button>
          </div>
        </form>
      )}
    </header>
  );
}
