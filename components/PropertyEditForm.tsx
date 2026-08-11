'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import type { Property, PropertyType } from '@/shared/types';

interface Props {
  property: Property;
  /** Called after a successful save — lets the modal close itself. */
  onSaved?: () => void;
}

// Explicit Save rather than the save-on-blur used by the inline editors this replaces. With
// this many fields, cross-field validation (cost basis vs. purchase price) only makes sense
// against a complete set, and a dirty-state guard is worth having before navigating away.
export default function PropertyEditForm({ property, onSaved }: Props) {
  const router = useRouter();
  const [, startTransition] = useTransition();

  const [nickname, setNickname] = useState(property.nickname);
  const [address, setAddress] = useState(property.address ?? '');
  const [type, setType] = useState<PropertyType>(property.type);
  const [purchasePrice, setPurchasePrice] = useState(property.purchase_price?.toString() ?? '');
  const [purchaseDate, setPurchaseDate] = useState(property.purchase_date?.slice(0, 10) ?? '');
  const [costBasis, setCostBasis] = useState(property.cost_basis?.toString() ?? '');

  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  const num = (s: string): number | null => {
    const n = Number(s.replace(/[$,\s]/g, ''));
    return s.trim() === '' || !Number.isFinite(n) ? null : n;
  };

  const dirty =
    nickname !== property.nickname ||
    address !== (property.address ?? '') ||
    type !== property.type ||
    purchasePrice !== (property.purchase_price?.toString() ?? '') ||
    purchaseDate !== (property.purchase_date?.slice(0, 10) ?? '') ||
    costBasis !== (property.cost_basis?.toString() ?? '');

  async function save(e: React.FormEvent) {
    e.preventDefault();
    if (!nickname.trim()) { setError('Nickname is required'); return; }

    const price = num(purchasePrice);
    const basis = num(costBasis);
    if (purchasePrice.trim() !== '' && price === null) { setError('Purchase price must be a number'); return; }
    if (costBasis.trim() !== '' && basis === null) { setError('Cost basis must be a number'); return; }
    if (price !== null && price < 0) { setError('Purchase price cannot be negative'); return; }
    if (basis !== null && basis < 0) { setError('Cost basis cannot be negative'); return; }
    // Cost basis is purchase price plus capital improvements, so it can exceed the price but
    // never fall below it — catching this here beats a silently wrong capital-gains figure later.
    if (price !== null && basis !== null && basis < price) {
      setError('Cost basis is purchase price plus improvements — it cannot be less than the purchase price');
      return;
    }

    setSaving(true); setError(null); setSaved(false);

    const res = await fetch(`/api/properties/${property.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        nickname, address: address || null, type,
        purchase_price: price, purchase_date: purchaseDate || null, cost_basis: basis,
      }),
    });

    if (!res.ok) {
      const body = await res.json().catch(() => null);
      setError(body?.error?.message ?? 'Could not save');
      setSaving(false);
      return;
    }


    setSaving(false);
    setSaved(true);
    startTransition(async () => { await router.refresh(); });
    onSaved?.();
  }

  const field = 'w-full text-sm border border-slate-200 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-slate-900/10';
  const label = 'block text-xs font-medium text-slate-500 mb-1';

  return (
    <form onSubmit={save} className="space-y-4">

      <div className="grid grid-cols-2 gap-4">
        <div>
          <label className={label}>Nickname *</label>
          <input value={nickname} onChange={(e) => { setNickname(e.target.value); setSaved(false); }} className={field} />
        </div>
        <div>
          <label className={label}>Type *</label>
          <select value={type} onChange={(e) => { setType(e.target.value as PropertyType); setSaved(false); }} className={`${field} bg-white`}>
            <option value="primary">Primary residence</option>
            <option value="rental">Rental</option>
          </select>
        </div>
      </div>

      <div>
        <label className={label}>Address</label>
        <input value={address} onChange={(e) => { setAddress(e.target.value); setSaved(false); }} placeholder="Optional" className={field} />
      </div>

      <div className="grid grid-cols-3 gap-4">
        <div>
          <label className={label}>Purchase price</label>
          <input value={purchasePrice} onChange={(e) => { setPurchasePrice(e.target.value); setSaved(false); }} inputMode="decimal" placeholder="—" className={`${field} font-mono`} />
        </div>
        <div>
          <label className={label}>Purchase date</label>
          <input type="date" value={purchaseDate} onChange={(e) => { setPurchaseDate(e.target.value); setSaved(false); }} className={field} />
        </div>
        <div>
          <label className={label}>Cost basis</label>
          <input value={costBasis} onChange={(e) => { setCostBasis(e.target.value); setSaved(false); }} inputMode="decimal" placeholder="—" className={`${field} font-mono`} />
          <p className="text-[10px] text-slate-400 mt-1">Purchase price + improvements</p>
        </div>
      </div>


      {error && <p className="text-xs text-red-600">{error}</p>}

      <div className="flex items-center justify-end gap-3 pt-1">
        {saved && !dirty && <span className="text-xs text-emerald-600">Saved</span>}
        {dirty && !saving && <span className="text-xs text-slate-400">Unsaved changes</span>}
        <button
          type="submit"
          disabled={saving || !dirty}
          className="px-4 py-2 bg-slate-900 hover:bg-slate-700 text-white rounded-lg text-sm font-medium disabled:opacity-40 transition-colors"
        >
          {saving ? 'Saving…' : 'Save changes'}
        </button>
      </div>
    </form>
  );
}
