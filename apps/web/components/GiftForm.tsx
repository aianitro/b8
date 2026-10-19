'use client';

// Gifts (P7-41b) — the form that marks a purchase in advance. Everything it sends is text: the
// amount stays the string typed (the route checks it is a two-decimal figure and the database
// compares it exactly), and the dates are the `YYYY-MM-DD` the date inputs produce — never a JS
// Date. An empty amount or merchant is sent as null, which means "any", never as 0 or ''.

import { useState } from 'react';
import { useRouter } from 'next/navigation';

const input = 'w-full rounded-lg border border-slate-300 px-3 py-2 text-sm';

export default function GiftForm({ accounts }: { accounts: { id: string; name: string }[] }) {
  const router = useRouter();
  const [form, setForm] = useState({ amount: '', merchant: '', accountId: '', windowStart: '', windowEnd: '', revealDate: '' });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const set = (k: keyof typeof form) => (e: { target: { value: string } }) => setForm({ ...form, [k]: e.target.value });

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    setError(null);
    const res = await fetch('/api/v1/gifts', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        amount: form.amount.trim() === '' ? null : form.amount.trim(),
        merchant: form.merchant.trim() === '' ? null : form.merchant,
        accountId: form.accountId === '' ? null : form.accountId,
        windowStart: form.windowStart,
        windowEnd: form.windowEnd,
        revealDate: form.revealDate,
      }),
    });
    const body = await res.json().catch(() => null);
    setSaving(false);
    if (!body?.success) {
      setError(body?.error?.message ?? 'That did not work. Try again.');
      return;
    }
    setForm({ amount: '', merchant: '', accountId: '', windowStart: '', windowEnd: '', revealDate: '' });
    router.refresh();
  }

  return (
    <form onSubmit={submit} className="bg-white rounded-2xl border border-slate-100 shadow-sm p-6 mb-8 space-y-4">
      <h2 className="text-lg font-semibold text-slate-900">Mark a gift</h2>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <label className="text-xs text-slate-500">Exact amount (optional)
          <input className={input} inputMode="decimal" value={form.amount} onChange={set('amount')} />
        </label>
        <label className="text-xs text-slate-500">Merchant contains (optional)
          <input className={input} value={form.merchant} onChange={set('merchant')} />
        </label>
        <label className="text-xs text-slate-500">Account (optional)
          <select className={input} value={form.accountId} onChange={set('accountId')}>
            <option value="">Any account</option>
            {accounts.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
          </select>
        </label>
        <label className="text-xs text-slate-500">Reveal on
          <input type="date" className={input} value={form.revealDate} onChange={set('revealDate')} required />
        </label>
        <label className="text-xs text-slate-500">Expected from
          <input type="date" className={input} value={form.windowStart} onChange={set('windowStart')} required />
        </label>
        <label className="text-xs text-slate-500">Expected until
          <input type="date" className={input} value={form.windowEnd} onChange={set('windowEnd')} required />
        </label>
      </div>
      {error && <p className="text-red-500 text-sm">{error}</p>}
      <button type="submit" disabled={saving}
        className="px-4 py-2 bg-blue-600 text-white rounded hover:bg-blue-700 text-sm disabled:opacity-50">
        {saving ? 'Saving…' : 'Mark gift'}
      </button>
    </form>
  );
}
