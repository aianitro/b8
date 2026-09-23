'use client';

import { useState, useEffect, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Trash2, Eye, EyeOff, Copy, Flag } from 'lucide-react';
import CategorySelect from './CategorySelect';
import TransferLinkButton from './TransferLinkButton';

type AccountOption = { id: string; name: string; landscape: string };
type GroupPeer = { account_name: string; amount: number | string };

type TxRow = {
  id: number;
  account_id: string;
  date: string;
  amount: number | string;
  name: string | null;
  merchant_name: string | null;
  plaid_category: string | null;
  mapped_category: string | null;
  transfer_group_id: number | null;
  group_peers: GroupPeer[] | null;
  account_name: string;
  account_landscape: string;
  hidden: boolean;
  /** ISO timestamp of when this was flagged to keep an eye on; null means it is not flagged. */
  watched_at: string | null;
  /** Why it was flagged, in the owner's words. Null is a flag with no reason written yet. */
  note: string | null;
  /** Explicit per-transaction tag; null means it inherits from the account. */
  property_id: number | null;
  /** Nickname of the property this actually lands on, tag or inherited — null if neither. */
  effective_property: string | null;
};

type PropertyOption = { id: number; nickname: string };

import type { Landscape } from '@b8/contracts/types';
type CategoryOption = { name: string; landscape: Landscape; exclude_from_budget: boolean };

interface Props {
  transactions: TxRow[];
  categories: CategoryOption[];
  accounts: AccountOption[];
  properties: PropertyOption[];
}

const fmt = (n: number) =>
  new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(Math.abs(n));

const UNDO_WINDOW_MS = 5000;

type BulkUndo = { prevById: Map<number, string | null>; category: string | null; count: number };

function DeleteButton({ transactionId }: { transactionId: number }) {
  const router = useRouter();
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);

  async function doDelete() {
    setBusy(true);
    await fetch(`/api/v1/transactions/${transactionId}`, { method: 'DELETE' });
    router.refresh();
  }

  return (
    <>
      <button
        onClick={() => setConfirming(true)}
        disabled={busy}
        className="text-slate-400 hover:text-red-500 disabled:opacity-30 transition-colors"
        title="Delete transaction"
      >
        <Trash2 size={14} />
      </button>

      {confirming && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 backdrop-blur-sm"
          onClick={() => setConfirming(false)}
        >
          <div
            className="bg-white rounded-2xl shadow-xl border border-slate-100 p-6 w-80 mx-4"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-center w-10 h-10 rounded-full bg-red-50 mb-4">
              <Trash2 size={18} className="text-red-500" />
            </div>
            <h3 className="text-sm font-semibold text-slate-900 mb-1">Delete transaction?</h3>
            <p className="text-xs text-slate-400 mb-5">This action cannot be undone.</p>
            <div className="flex gap-2">
              <button
                onClick={() => setConfirming(false)}
                className="flex-1 px-4 py-2 rounded-xl text-sm font-medium border border-slate-200 text-slate-600 hover:bg-slate-50 transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={doDelete}
                disabled={busy}
                className="flex-1 px-4 py-2 rounded-xl text-sm font-medium bg-red-500 text-white hover:bg-red-600 disabled:opacity-50 transition-colors"
              >
                {busy ? 'Deleting…' : 'Delete'}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}

// Shared <option> groups for a budget-category <select>, used by both the bulk-apply bar and
// the duplicate-transaction form.
function CategoryOptionsList({ categories }: { categories: CategoryOption[] }) {
  return (
    <>
      {(['operational', 'capital'] as const).map((ls) => {
        const group = categories.filter((c) => !c.exclude_from_budget && c.landscape === ls).sort((a, b) => a.name.localeCompare(b.name));
        if (group.length === 0) return null;
        return (
          <optgroup key={ls} label={ls.charAt(0).toUpperCase() + ls.slice(1)}>
            {group.map((c) => <option key={c.name} value={c.name}>{c.name}</option>)}
          </optgroup>
        );
      })}
      {(() => {
        const excl = categories.filter((c) => c.exclude_from_budget).sort((a, b) => a.name.localeCompare(b.name));
        return excl.length > 0 ? (
          <optgroup key="other" label="Other">
            {excl.map((c) => <option key={c.name} value={c.name}>{c.name}</option>)}
          </optgroup>
        ) : null;
      })()}
    </>
  );
}

function DuplicateButton({ transaction, accounts, categories }: {
  transaction: TxRow;
  accounts: AccountOption[];
  categories: CategoryOption[];
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [date, setDate] = useState(transaction.date);
  const [accountId, setAccountId] = useState(transaction.account_id);
  const [merchant, setMerchant] = useState(transaction.merchant_name ?? transaction.name ?? '');
  const [amount, setAmount] = useState(String(transaction.amount));
  const [category, setCategory] = useState(transaction.mapped_category ?? '');

  function openModal() {
    setDate(transaction.date);
    setAccountId(transaction.account_id);
    setMerchant(transaction.merchant_name ?? transaction.name ?? '');
    setAmount(String(transaction.amount));
    setCategory(transaction.mapped_category ?? '');
    setError(null);
    setOpen(true);
  }

  async function create() {
    const amountNum = parseFloat(amount);
    if (!date || !accountId || isNaN(amountNum)) {
      setError('Enter a valid date, account, and amount');
      return;
    }
    setBusy(true);
    setError(null);
    const res = await fetch('/api/v1/transactions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        account_id: accountId,
        date,
        amount: amountNum,
        name: merchant || null,
        merchant_name: merchant || null,
        mapped_category: category || null,
      }),
    });
    const data = await res.json();
    setBusy(false);
    if (!data.success) {
      setError(data.error?.message ?? 'Failed to create transaction');
      return;
    }
    setOpen(false);
    router.refresh();
  }

  return (
    <>
      <button
        onClick={openModal}
        className="text-slate-400 hover:text-blue-500 transition-colors"
        title="Duplicate transaction"
      >
        <Copy size={14} />
      </button>

      {open && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 backdrop-blur-sm"
          onClick={() => !busy && setOpen(false)}
        >
          <div
            className="bg-white rounded-2xl shadow-xl border border-slate-100 p-6 w-96 mx-4"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-center w-10 h-10 rounded-full bg-blue-50 mb-4">
              <Copy size={18} className="text-blue-500" />
            </div>
            <h3 className="text-sm font-semibold text-slate-900 mb-1">Duplicate transaction</h3>
            <p className="text-xs text-slate-400 mb-4">Creates a new, independent transaction — edit any field first.</p>

            <div className="space-y-3">
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-medium text-slate-500 mb-1">Date</label>
                  <input
                    type="date"
                    value={date}
                    onChange={(e) => setDate(e.target.value)}
                    className="w-full text-sm border border-slate-200 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-slate-900/10"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-500 mb-1">Amount ($)</label>
                  <input
                    type="number"
                    step="0.01"
                    value={amount}
                    onChange={(e) => setAmount(e.target.value)}
                    title="Positive = expense, negative = income/refund"
                    className="w-full text-sm border border-slate-200 rounded-lg px-3 py-2 font-mono focus:outline-none focus:ring-2 focus:ring-slate-900/10"
                  />
                </div>
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-500 mb-1">Merchant / description</label>
                <input
                  value={merchant}
                  onChange={(e) => setMerchant(e.target.value)}
                  className="w-full text-sm border border-slate-200 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-slate-900/10"
                />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-medium text-slate-500 mb-1">Account</label>
                  <select
                    value={accountId}
                    onChange={(e) => setAccountId(e.target.value)}
                    className="w-full text-sm border border-slate-200 rounded-lg px-3 py-2 bg-white focus:outline-none focus:ring-2 focus:ring-slate-900/10"
                  >
                    {(['operational', 'capital'] as const).map((ls) => {
                      const group = accounts.filter((a) => a.landscape === ls);
                      if (group.length === 0) return null;
                      return (
                        <optgroup key={ls} label={ls.charAt(0).toUpperCase() + ls.slice(1)}>
                          {group.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
                        </optgroup>
                      );
                    })}
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-500 mb-1">Budget category</label>
                  <select
                    value={category}
                    onChange={(e) => setCategory(e.target.value)}
                    className="w-full text-sm border border-slate-200 rounded-lg px-3 py-2 bg-white focus:outline-none focus:ring-2 focus:ring-slate-900/10"
                  >
                    <option value="">— uncategorized —</option>
                    <CategoryOptionsList categories={categories} />
                  </select>
                </div>
              </div>
            </div>

            {error && <p className="text-xs text-red-500 mt-3">{error}</p>}

            <div className="flex gap-2 mt-5">
              <button
                onClick={() => setOpen(false)}
                disabled={busy}
                className="flex-1 px-4 py-2 rounded-xl text-sm font-medium border border-slate-200 text-slate-600 hover:bg-slate-50 disabled:opacity-50 transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={create}
                disabled={busy}
                className="flex-1 px-4 py-2 rounded-xl text-sm font-medium bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-50 transition-colors"
              >
                {busy ? 'Creating…' : 'Create copy'}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}

/**
 * Flag a transaction to come back to, with a reason.
 *
 * ─── Why this is a modal and not `window.prompt` ──────────────────────────────────────────────
 *
 * It was a prompt box, which was the smallest thing that could work and was wrong for three
 * reasons. It looks like 1998 next to the rest of this table. It cannot show the transaction it is
 * about, so the owner is typing a reason for "some row I clicked" with the row hidden behind a
 * system dialog. And it is untestable from automation — a native dialog blocks the browser event
 * loop, so the one control in this feature nobody could exercise was the one everybody uses.
 *
 * The idiom is `DuplicateButton`'s, deliberately: same backdrop, same card, same field styling,
 * same Cancel/confirm pair. A second modal convention in one table is how a UI starts feeling
 * assembled rather than designed.
 *
 * The reason stays OPTIONAL. Flagging something and writing why later is a normal way to use a list
 * like this, so the confirm button is never disabled on an empty field.
 */
function WatchToggleButton({ transaction }: { transaction: TxRow }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState('');

  const watched = transaction.watched_at !== null;
  const label = transaction.merchant_name ?? transaction.name ?? 'this transaction';

  async function send(nextWatched: boolean, note: string | null) {
    setBusy(true);
    setError(null);
    const res = await fetch(`/api/v1/transactions/${transaction.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ watched: nextWatched, note }),
    });
    const data = await res.json().catch(() => null);
    setBusy(false);
    if (!data?.success) {
      // The route answers with a stated reason — a note over the limit says how long it was — so
      // show that rather than a generic failure.
      setError(data?.error?.message ?? 'That did not work. Try again.');
      return;
    }
    setOpen(false);
    router.refresh();
  }

  function openModal() {
    setNote(transaction.note ?? '');
    setError(null);
    setOpen(true);
  }

  return (
    <>
      <button
        onClick={openModal}
        className={`disabled:opacity-30 transition-colors ${watched ? 'text-amber-500 hover:text-amber-600' : 'text-slate-400 hover:text-amber-500'}`}
        title={watched ? `Keeping an eye on this${transaction.note ? `: ${transaction.note}` : ''}` : 'Keep an eye on this one'}
        data-testid="watch-toggle"
      >
        <Flag size={14} fill={watched ? 'currentColor' : 'none'} />
      </button>

      {open && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 backdrop-blur-sm"
          onClick={() => !busy && setOpen(false)}
        >
          <div
            className="bg-white rounded-2xl shadow-xl border border-slate-100 p-6 w-96 mx-4"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-center w-10 h-10 rounded-full bg-amber-50 mb-4">
              <Flag size={18} className="text-amber-500" />
            </div>
            <h3 className="text-sm font-semibold text-slate-900 mb-1">
              {watched ? 'Keeping an eye on this' : 'Keep an eye on this one'}
            </h3>
            {/* The row, named. A prompt box could not say which transaction it was about. */}
            <p className="text-xs text-slate-400 mb-4">
              {label} · {fmt(Number(transaction.amount))} · {transaction.date}
            </p>

            <label className="block text-xs font-medium text-slate-500 mb-1">Why? (optional)</label>
            <input
              value={note}
              onChange={(e) => setNote(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !busy) void send(true, note);
                if (e.key === 'Escape' && !busy) setOpen(false);
              }}
              maxLength={200}
              autoFocus
              placeholder="returning to Zara"
              className="w-full text-sm border border-slate-200 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-slate-900/10"
            />
            {/* Counts down only near the limit. A counter that is always on is chrome; one that
                appears at 160 characters is a warning. */}
            {note.length > 160 && (
              <p className="text-xs text-slate-400 mt-1">{200 - note.length} characters left</p>
            )}

            {error && <p className="text-xs text-red-500 mt-3">{error}</p>}

            <div className="flex gap-2 mt-5">
              {watched ? (
                <button
                  onClick={() => send(false, null)}
                  disabled={busy}
                  className="flex-1 px-4 py-2 rounded-xl text-sm font-medium border border-slate-200 text-slate-600 hover:bg-slate-50 disabled:opacity-50 transition-colors"
                >
                  Stop watching
                </button>
              ) : (
                <button
                  onClick={() => setOpen(false)}
                  disabled={busy}
                  className="flex-1 px-4 py-2 rounded-xl text-sm font-medium border border-slate-200 text-slate-600 hover:bg-slate-50 disabled:opacity-50 transition-colors"
                >
                  Cancel
                </button>
              )}
              <button
                onClick={() => send(true, note)}
                disabled={busy}
                className="flex-1 px-4 py-2 rounded-xl text-sm font-medium bg-amber-500 text-white hover:bg-amber-600 disabled:opacity-50 transition-colors"
              >
                {busy ? 'Saving…' : watched ? 'Save note' : 'Keep an eye'}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}

function HideToggleButton({ transactionId, hidden }: { transactionId: number; hidden: boolean }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);

  async function toggle() {
    setBusy(true);
    await fetch(`/api/v1/transactions/${transactionId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ hidden: !hidden }),
    });
    router.refresh();
    setBusy(false);
  }

  return (
    <button
      onClick={toggle}
      disabled={busy}
      className="text-slate-400 hover:text-slate-600 disabled:opacity-30 transition-colors"
      title={hidden ? 'Unhide — include in budget again' : 'Hide from budget'}
    >
      {hidden ? <EyeOff size={14} /> : <Eye size={14} />}
    </button>
  );
}

const LANDSCAPE_BADGE: Record<string, string> = {
  operational: 'bg-blue-50 text-blue-600',
  capital: 'bg-violet-50 text-violet-600',
};

export default function TransactionTable({ transactions, categories, accounts, properties }: Props) {
  const router = useRouter();
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [bulkCategory, setBulkCategory] = useState('');
  const [bulkProperty, setBulkProperty] = useState('');
  const [isPending, startTransition] = useTransition();
  const [sortField, setSortField] = useState<'date' | 'amount'>('date');
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('desc');
  const [transferError, setTransferError] = useState<string | null>(null);
  const [bulkUndo, setBulkUndo] = useState<BulkUndo | null>(null);

  useEffect(() => {
    if (!bulkUndo) return;
    const t = setTimeout(() => setBulkUndo(null), UNDO_WINDOW_MS);
    return () => clearTimeout(t);
  }, [bulkUndo]);

  useEffect(() => {
    // Deliberately in an effect, not a lazy useState initializer: sessionStorage isn't available
    // during SSR, so reading it synchronously during render would make the client's first
    // hydration pass disagree with the server-rendered HTML (a real hydration mismatch, since
    // sort order controls row order). Restoring post-hydration trades one harmless post-mount
    // re-render for correctness here.
    const savedField = sessionStorage.getItem('txSortField');
    const savedDir = sessionStorage.getItem('txSortDir');
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (savedField === 'date' || savedField === 'amount') setSortField(savedField);
    if (savedDir === 'asc' || savedDir === 'desc') setSortDir(savedDir);
  }, []);

  function toggleSort(field: 'date' | 'amount') {
    const nextDir = field === sortField ? (sortDir === 'desc' ? 'asc' : 'desc') : 'desc';
    sessionStorage.setItem('txSortField', field);
    sessionStorage.setItem('txSortDir', nextDir);
    setSortField(field);
    setSortDir(nextDir);
  }

  const sorted = [...transactions].sort((a, b) => {
    const cmp = sortField === 'amount'
      ? Number(a.amount) - Number(b.amount) || a.id - b.id
      : a.date < b.date ? -1 : a.date > b.date ? 1 : a.id - b.id;
    return sortDir === 'desc' ? -cmp : cmp;
  });

  const allIds = transactions.map((t) => t.id);
  const allSelected = allIds.length > 0 && allIds.every((id) => selected.has(id));
  const someSelected = selected.size > 0;

  const selectedSum = transactions
    .filter((t) => selected.has(t.id))
    .reduce((s, t) => s + Number(t.amount), 0);
  const canPairAsTransfer = selected.size >= 2 && Math.abs(selectedSum) < 0.01;

  function toggleAll() {
    setTransferError(null);
    if (allSelected) {
      setSelected(new Set());
    } else {
      setSelected(new Set(allIds));
    }
  }

  function toggleRow(id: number) {
    setTransferError(null);
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }

  function applyBulk() {
    if (!bulkCategory || selected.size === 0) return;
    const category = bulkCategory === '__clear__' ? null : bulkCategory;
    const ids = Array.from(selected);
    const prevById = new Map(
      ids.map((id) => [id, transactions.find((t) => t.id === id)?.mapped_category ?? null])
    );
    startTransition(async () => {
      const res = await fetch('/api/v1/transactions/bulk', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ids, mapped_category: category }),
      });
      if (!res.ok) {
        console.error('Bulk update failed', await res.text());
        return;
      }
      setSelected(new Set());
      setBulkCategory('');
      setBulkUndo({ prevById, category, count: ids.length });
      await router.refresh();
    });
  }

  // Tagging is separate from the category bulk-apply rather than folded into one "Apply": the
  // two answer different questions (what kind of spending is this / which property is it for),
  // and the case this exists for — attributing a property's history from before it had its own
  // account — is a pure property operation with no category change involved.
  function applyBulkProperty() {
    if (!bulkProperty || selected.size === 0) return;
    const propertyId = bulkProperty === '__clear__' ? null : Number(bulkProperty);
    const ids = Array.from(selected);
    startTransition(async () => {
      const res = await fetch('/api/v1/transactions/bulk', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ids, property_id: propertyId }),
      });
      if (!res.ok) {
        console.error('Bulk property tag failed', await res.text());
        return;
      }
      setSelected(new Set());
      setBulkProperty('');
      await router.refresh();
    });
  }

  function undoBulk() {
    if (!bulkUndo) return;
    const { prevById } = bulkUndo;
    setBulkUndo(null);
    startTransition(async () => {
      await Promise.all(
        Array.from(prevById.entries()).map(([id, prevCategory]) =>
          fetch(`/api/v1/transactions/${id}`, {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ mapped_category: prevCategory }),
          })
        )
      );
      await router.refresh();
    });
  }

  function pairAsTransfer() {
    const ids = Array.from(selected);
    startTransition(async () => {
      const res = await fetch('/api/v1/transfers', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ids }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => null);
        setTransferError(body?.error?.message ?? 'Failed to pair as transfer');
        return;
      }
      setTransferError(null);
      setSelected(new Set());
      await router.refresh();
    });
  }

  return (
    <div className="relative">
      {/* `-mx-4 md:mx-0` lets the scroll region reach the screen edges on a phone, so the last
          column can be brought fully into view instead of stopping against a 16px gutter. */}
      <div className="bg-white rounded-2xl border border-slate-100 shadow-sm overflow-x-auto -mx-4 md:mx-0">
        {/* `min-w-[56rem]` IS WHAT MAKES THE SCROLL WORK. The wrapper has had `overflow-x-auto`
            all along and it did nothing, because `w-full` told the table to be exactly as wide as
            its container — so nine columns compressed into 390px rather than overflowing it, and
            every cell wrapped to three lines. A table that cannot exceed its container has nothing
            to scroll.

            HORIZONTAL SCROLL RATHER THAN RESTACKING INTO CARDS, deliberately, and it is the weaker
            of the two. Cards read better on a phone — the phone app's own lists are two-line rows
            for exactly that reason. But this table carries nine columns, bulk selection, inline
            category editing, transfer pairing and a row menu, and restacking it is a rewrite of 873
            lines rather than a layout change. Scroll loses no column and no control. If this page
            becomes a daily phone destination rather than an occasional one, cards are the answer
            and this comment is the argument for doing it properly. */}
        <table className="w-full min-w-[56rem] text-sm">
          <thead className="sticky top-0 z-10">
            <tr className="bg-slate-50 border-b border-slate-100">
              <th className="px-4 py-3 w-10">
                <input
                  type="checkbox"
                  checked={allSelected}
                  ref={(el) => { if (el) el.indeterminate = someSelected && !allSelected; }}
                  onChange={toggleAll}
                  className="rounded border-slate-300 text-slate-800 focus:ring-slate-900/20 cursor-pointer"
                />
              </th>
              <th className="px-6 py-3 text-left text-xs font-semibold uppercase tracking-wider text-slate-400 w-28">
                <button
                  onClick={() => toggleSort('date')}
                  className="flex items-center gap-1 hover:text-slate-600 transition-colors"
                >
                  Date
                  {sortField === 'date' && <span className="text-slate-300">{sortDir === 'desc' ? '↓' : '↑'}</span>}
                </button>
              </th>
              <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wider text-slate-400">Merchant</th>
              <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wider text-slate-400">Account</th>
              <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wider text-slate-400">Plaid category</th>
              <th className="px-4 py-3 text-right text-xs font-semibold uppercase tracking-wider text-slate-400">
                <button
                  onClick={() => toggleSort('amount')}
                  className="flex items-center gap-1 ml-auto hover:text-slate-600 transition-colors"
                >
                  Amount
                  {sortField === 'amount' && <span className="text-slate-300">{sortDir === 'desc' ? '↓' : '↑'}</span>}
                </button>
              </th>
              <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wider text-slate-400 w-44">Budget category</th>
              <th className="px-6 py-3 text-left text-xs font-semibold uppercase tracking-wider text-slate-400 w-36">Transfer</th>
              <th className="px-4 py-3 w-14" />
            </tr>
          </thead>
          <tbody>
            {sorted.map((t, i) => {
              const isChecked = selected.has(t.id);
              const isTransfer = Boolean(t.mapped_category?.toLowerCase().includes('transfer'));
              const needsPairing = isTransfer && t.transfer_group_id === null;
              const peerLabel = t.transfer_group_id && t.group_peers?.length
                ? t.group_peers.length === 1
                  ? `${t.group_peers[0].account_name} · ${fmt(Number(t.group_peers[0].amount))}`
                  : `${t.group_peers.length + 1}-way · ${t.group_peers.map((p) => p.account_name).join(', ')}`
                : null;

              return (
                <tr
                  key={t.id}
                  className={`group border-b border-slate-50 last:border-0 transition-colors
                    ${isChecked
                      ? 'bg-blue-50/60'
                      : t.transfer_group_id
                      ? 'bg-violet-50/30'
                      : needsPairing
                      ? 'bg-amber-50/30'
                      : i % 2 === 1
                      ? 'bg-slate-50/50'
                      : 'bg-white'}
                    ${t.hidden ? 'opacity-40' : ''}
                    hover:bg-slate-50`}
                >
                  <td className="px-4 py-3.5">
                    <input
                      type="checkbox"
                      checked={isChecked}
                      onChange={() => toggleRow(t.id)}
                      className="rounded border-slate-300 text-slate-800 focus:ring-slate-900/20 cursor-pointer"
                    />
                  </td>
                  <td className="px-6 py-3.5 text-slate-400 whitespace-nowrap text-xs font-mono">{t.date}</td>
                  <td className="px-4 py-3.5">
                    <span className="font-medium text-slate-800">
                      {t.merchant_name ?? t.name ?? <span className="text-slate-300">—</span>}
                    </span>
                    {t.name && t.merchant_name && t.name !== t.merchant_name && (
                      <div className="text-xs text-slate-400 mt-0.5">{t.name}</div>
                    )}
                  </td>
                  <td className="px-4 py-3.5">
                    <div className="flex items-center gap-1.5">
                      <a href={`/accounts/${t.account_id}`} className="text-xs text-slate-500 whitespace-nowrap hover:text-blue-600 transition-colors">
                        {t.account_name}
                      </a>
                      <span className={`text-xs px-1.5 py-0.5 rounded-full font-medium ${LANDSCAPE_BADGE[t.account_landscape] ?? ''}`}>
                        {t.account_landscape}
                      </span>
                      {/* Shown only for an explicit tag, in amber to match the ledger's marker
                          for the same thing. An inherited attribution is already implied by the
                          account name sitting right beside it, so badging that too would put a
                          property chip on every row of a rental's account and teach the reader
                          to ignore the one case that is actually worth noticing. */}
                      {t.property_id !== null && t.effective_property && (
                        <span className="text-xs px-1.5 py-0.5 rounded-full font-medium bg-amber-50 text-amber-700 whitespace-nowrap"
                              title="Tagged to this property, overriding the account">
                          {t.effective_property}
                        </span>
                      )}
                    </div>
                  </td>
                  <td className="px-4 py-3.5 text-slate-400 text-xs whitespace-nowrap">{t.plaid_category ?? '—'}</td>
                  <td className={`px-4 py-3.5 text-right font-mono font-medium whitespace-nowrap ${Number(t.amount) < 0 ? 'text-emerald-600' : 'text-slate-900'}`}>
                    {Number(t.amount) < 0 ? '+' : ''}{fmt(Number(t.amount))}
                  </td>
                  <td className="px-4 py-3.5">
                    <CategorySelect
                      transactionId={t.id}
                      current={t.mapped_category}
                      categories={categories}
                      description={t.name ?? t.merchant_name}
                    />
                  </td>
                  <td className="px-6 py-3.5">
                    <TransferLinkButton
                      transactionId={t.id}
                      groupId={t.transfer_group_id}
                      peerLabel={peerLabel}
                      required={needsPairing}
                      isTransfer={isTransfer}
                    />
                  </td>
                  <td className="px-4 py-3.5">
                    <div className="flex items-center gap-2">
                      <DuplicateButton transaction={t} accounts={accounts} categories={categories} />
                      <WatchToggleButton transaction={t} />
                      <HideToggleButton transactionId={t.id} hidden={t.hidden} />
                      <DeleteButton transactionId={t.id} />
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {/* Bulk action bar */}
      {someSelected && (
        <div className="fixed bottom-6 left-1/2 -translate-x-1/2 z-50 flex items-center gap-3 bg-slate-900 text-white rounded-2xl shadow-2xl px-5 py-3.5 border border-slate-700">
          <span className="text-sm font-medium text-slate-300 whitespace-nowrap">
            {selected.size} selected
          </span>
          {selected.size >= 2 && (
            <span className={`text-xs font-mono whitespace-nowrap ${Math.abs(selectedSum) < 0.01 ? 'text-emerald-400' : 'text-amber-400'}`}>
              sum {selectedSum >= 0 ? '+' : '−'}{fmt(selectedSum)}
            </span>
          )}
          <div className="w-px h-5 bg-slate-700" />
          {selected.size >= 2 && (
            <>
              <button
                onClick={pairAsTransfer}
                disabled={isPending || !canPairAsTransfer}
                title={canPairAsTransfer ? undefined : 'Selected amounts must sum to 0'}
                className="px-3 py-1.5 bg-violet-600 text-white rounded-lg text-sm font-semibold hover:bg-violet-700 disabled:opacity-40 disabled:cursor-not-allowed transition-colors whitespace-nowrap"
              >
                {isPending ? '…' : '⇄ Pair as Transfer'}
              </button>
              <div className="w-px h-5 bg-slate-700" />
            </>
          )}
          {transferError && (
            <span className="text-xs text-red-400 whitespace-nowrap">{transferError}</span>
          )}
          <select
            value={bulkCategory}
            onChange={(e) => setBulkCategory(e.target.value)}
            className="text-sm bg-slate-800 border border-slate-600 rounded-lg px-3 py-1.5 text-white focus:outline-none focus:ring-2 focus:ring-white/20 min-w-[160px]"
          >
            <option value="">Set category…</option>
            <option value="__clear__">— Clear category —</option>
            <CategoryOptionsList categories={categories} />
          </select>
          <button
            onClick={applyBulk}
            disabled={!bulkCategory || isPending}
            className="px-4 py-1.5 bg-white text-slate-900 rounded-lg text-sm font-semibold hover:bg-slate-100 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
          >
            {isPending ? 'Applying…' : 'Apply'}
          </button>

          {properties.length > 0 && (
            <>
              <span className="w-px h-6 bg-slate-700" />
              <select
                value={bulkProperty}
                onChange={(e) => setBulkProperty(e.target.value)}
                className="text-sm bg-slate-800 border border-slate-600 rounded-lg px-3 py-1.5 text-white focus:outline-none focus:ring-2 focus:ring-white/20 min-w-[150px]"
              >
                <option value="">Tag to property…</option>
                <option value="__clear__">— Remove tag —</option>
                {properties.map((p) => (
                  <option key={p.id} value={p.id}>{p.nickname}</option>
                ))}
              </select>
              <button
                onClick={applyBulkProperty}
                disabled={!bulkProperty || isPending}
                className="px-4 py-1.5 bg-white text-slate-900 rounded-lg text-sm font-semibold hover:bg-slate-100 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
              >
                {isPending ? 'Tagging…' : 'Tag'}
              </button>
            </>
          )}
          <button
            onClick={() => setSelected(new Set())}
            className="p-1.5 text-slate-400 hover:text-white transition-colors rounded-lg hover:bg-slate-800"
            title="Clear selection"
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"><path d="M18 6 6 18M6 6l12 12"/></svg>
          </button>
        </div>
      )}

      {/* Bulk-apply undo toast */}
      {!someSelected && bulkUndo && (
        <div className="fixed bottom-6 left-1/2 -translate-x-1/2 z-50 flex items-center gap-3 bg-slate-900 text-white rounded-2xl shadow-2xl px-5 py-3.5 border border-slate-700">
          <span className="text-sm font-medium text-slate-300 whitespace-nowrap">
            Set {bulkUndo.category ?? 'uncategorized'} for {bulkUndo.count} transaction{bulkUndo.count !== 1 ? 's' : ''}
          </span>
          <button
            onClick={undoBulk}
            disabled={isPending}
            className="px-3 py-1.5 bg-white text-slate-900 rounded-lg text-sm font-semibold hover:bg-slate-100 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
          >
            {isPending ? '…' : 'Undo'}
          </button>
        </div>
      )}
    </div>
  );
}
