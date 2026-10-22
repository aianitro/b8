'use client';

// Gifts (P7-41b) — the form that marks a purchase in advance. Everything it sends is text: the
// amount stays the string typed (the route checks it is a two-decimal figure and the database
// compares it exactly), and the dates are the `YYYY-MM-DD` the date inputs produce — never a JS
// Date. An empty amount or merchant is sent as null, which means "any", never as 0 or ''.
//
// ─── THE WINDOW OPENS ON THE GIVER'S TODAY (P7-41c) ───────────────────────────────────────────
//
// "Expected from" and "Expected until" start at the giver's own calendar date (`giftFormDefaults`),
// read from this browser with `localIsoDate` — never the first ten characters of an ISO timestamp,
// which are the UTC date and already tomorrow every evening west of Greenwich. A gift made at night with tomorrow's date
// cannot match tonight's purchase; that is the bug this default exists to prevent.
//
// The date is read with `useSyncExternalStore`, whose server snapshot is null: the server renders
// the two inputs empty, hydration agrees with it, and the browser then fills in ITS date. The
// server's calendar never reaches the form, and there is no hydration mismatch to warn about.
// A date the giver has typed is kept in state; until then the field follows the default, which is
// re-read from `localIsoDate()` on every render. After a gift is saved the dates go back to unset
// (`BLANK`), NOT to the date of the save: a pinned date would still say yesterday when the giver
// marks a second gift after midnight with the page left open, and a one-day window on yesterday
// misses tonight's purchase — the failure this default exists to prevent.

import { useState, useSyncExternalStore } from 'react';
import { useRouter } from 'next/navigation';
import { localIsoDate } from '@/lib/localDate';
import { giftFormDefaults } from '@/lib/domain/giftMatch';

// `text-base` below `sm`: iOS zooms the page into any input under 16px, and in the installed app
// there is no pinch-out to undo it. The taller padding below `sm` makes each field a full touch target.
const input = 'mt-1 block w-full min-w-0 rounded-lg border border-slate-300 bg-white px-3 py-2.5 sm:py-2 text-base sm:text-sm text-slate-900';
// iOS draws a date field at its own intrinsic width and centres the value, so in a one-column grid
// it overflows the card; `appearance-none` lets it take the column's width, the value left-aligned.
const dateInput = `${input} appearance-none min-h-11 sm:min-h-0 [&::-webkit-date-and-time-value]:text-left`;
const label = 'block text-xs text-slate-500';

/** The form's fields. A null date is one the giver has not set: it shows today's default. */
interface GiftFormState {
  amount: string;
  merchant: string;
  accountId: string;
  windowStart: string | null;
  windowEnd: string | null;
  revealDate: string;
}

const BLANK: GiftFormState = { amount: '', merchant: '', accountId: '', windowStart: null, windowEnd: null, revealDate: '' };

/** Nothing to subscribe to: the date is read on every render, and a render is all that needs it. */
const noSubscription = () => () => {};

export default function GiftForm({ accounts }: { accounts: { id: string; name: string }[] }) {
  const router = useRouter();
  const [form, setForm] = useState<GiftFormState>(BLANK);
  const today = useSyncExternalStore(noSubscription, () => localIsoDate(), () => null);
  const defaults = today === null ? null : giftFormDefaults(today);
  const windowStart = form.windowStart ?? defaults?.windowStart ?? '';
  const windowEnd = form.windowEnd ?? defaults?.windowEnd ?? '';
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
        windowStart,
        windowEnd,
        revealDate: form.revealDate,
      }),
    });
    const body = await res.json().catch(() => null);
    setSaving(false);
    if (!body?.success) {
      setError(body?.error?.message ?? 'That did not work. Try again.');
      return;
    }
    setForm(BLANK);
    router.refresh();
  }

  return (
    <form onSubmit={submit} className="bg-white rounded-2xl border border-slate-100 shadow-sm p-4 sm:p-6 mb-6 sm:mb-8 space-y-4">
      <h2 className="text-lg font-semibold text-slate-900">Mark a gift</h2>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <label className={label}>Exact amount (optional)
          <input className={input} inputMode="decimal" value={form.amount} onChange={set('amount')} />
        </label>
        <label className={label}>Merchant contains (optional)
          <input className={input} value={form.merchant} onChange={set('merchant')} />
        </label>
        <label className={label}>Account (optional)
          <select className={input} value={form.accountId} onChange={set('accountId')}>
            <option value="">Any account</option>
            {accounts.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
          </select>
        </label>
        <label className={label}>Reveal on
          <input type="date" className={dateInput} value={form.revealDate} onChange={set('revealDate')} required />
        </label>
        <label className={label}>Expected from
          <input type="date" className={dateInput} value={windowStart} onChange={set('windowStart')} required />
        </label>
        <label className={label}>Expected until
          <input type="date" className={dateInput} value={windowEnd} onChange={set('windowEnd')} required />
        </label>
      </div>
      {error && <p className="text-red-500 text-sm">{error}</p>}
      {/* Full width below `sm`, where it sits under the thumb; its usual size above. */}
      <button type="submit" disabled={saving}
        className="w-full sm:w-auto px-4 py-3 sm:py-2 bg-blue-600 text-white rounded-lg sm:rounded hover:bg-blue-700 text-base sm:text-sm disabled:opacity-50">
        {saving ? 'Saving…' : 'Mark gift'}
      </button>
    </form>
  );
}
