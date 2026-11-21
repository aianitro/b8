'use client';

// Loyalty (P8-42b2) — the earn rates of a membership on /travel: one base rate and an ordered list of
// bonus rules, each matching spend by b8 category or by merchant text, each with its own rate. The
// first matching rule wins, so the list's order is the match order; moving a rule up or down and
// saving re-submits the whole list, which the server stores in that order.
//
// THE WHOLE DESCRIPTION IS SENT, every time. The membership PATCH replaces the base rate and every
// rule in one transaction or changes nothing, so a half-edited list can never be stored: a refusal
// (a rate with five decimals, a merchant text with a `%`, two identical rules) is shown inline and
// the stored rates stay as they were.
//
// RATES ARE TEXT, from the input to the request. A rate is "units per one currency unit of spend"
// and may carry four decimals; turned into a JS number it would already have been through binary
// floating point before the server saw it. The server's contract decides what a valid rate is, and
// its message — which names the rule, never the value — is what the person sees.
//
// CLEAR IS ONE TAP, with no confirmation, like "Unlink card": it deletes configuration only — the
// rates — and nothing in the ledger or the readings, and setting them again is one form. Its handler
// is the only place on the page that sends a null earn description.
//
// Tap targets are not smaller than the page's existing `min-h-8` controls.

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import type { LoyaltyEarnMatchKind, LoyaltyMembership } from '@b8/contracts/loyalty';
import { send } from './LoyaltyRequest';

const CONTROL = 'min-h-8 px-2 rounded text-xs';
const FIELD = 'border border-gray-200 rounded px-2 py-1.5 text-base sm:text-sm bg-white';

type Draft = { kind: LoyaltyEarnMatchKind; match: string; rate: string };

/** A stored rate, which always carries four decimals, shown as a person would type it: trailing zeros (and a bare point) dropped, by string work. */
const trimRate = (rate: string) => rate.replace(/\.?0+$/, '') || '0';

export default function LoyaltyEarnEditor({ m }: { m: LoyaltyMembership }) {
  const router = useRouter();
  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [baseRate, setBaseRate] = useState(m.earn === null ? '' : trimRate(m.earn.baseRate));
  const [rules, setRules] = useState<Draft[]>(m.earn?.rules.map((r) => ({ ...r, rate: trimRate(r.rate) })) ?? []);

  /** One PATCH of this membership; true when it was accepted and the page is re-reading. */
  async function patch(body: Record<string, unknown>): Promise<boolean> {
    setSaving(true);
    const result = await send('PATCH', `/api/v1/loyalty/memberships/${m.id}`, body);
    setSaving(false);
    if (!result.ok) { setError(result.message); return false; }
    setError(null);
    router.refresh();
    return true;
  }

  async function saveRates() {
    if (await patch({ earn: { baseRate, rules } })) setEditing(false);
  }

  /** The one sender of a null earn description: deletes the rates and nothing else. */
  async function clearRates() {
    if (await patch({ earn: null })) { setEditing(false); setBaseRate(''); setRules([]); }
  }

  const update = (i: number, change: Partial<Draft>) => setRules(rules.map((r, j) => (j === i ? { ...r, ...change } : r)));
  const move = (i: number, by: -1 | 1) => {
    const next = [...rules];
    [next[i], next[i + by]] = [next[i + by], next[i]];
    setRules(next);
  };

  return (
    <>
      <button type="button" onClick={() => setEditing(!editing)} className={`${CONTROL} text-gray-500 hover:bg-gray-100`}>
        {editing ? 'Cancel' : 'Set earn rates'}
      </button>
      {m.earn !== null && (
        <button type="button" onClick={clearRates} disabled={saving} className={`${CONTROL} text-red-400 hover:text-red-600 hover:bg-gray-100 disabled:opacity-50`}>
          Clear earn rates
        </button>
      )}
      {editing && (
        <div className="basis-full mt-1 grid gap-2 bg-gray-50 rounded-lg p-3">
          <p className="text-gray-500">
            Rates are units earned per one dollar of card spend. Rules are tried in order; the first that matches wins, and the base rate covers the rest.
          </p>
          <label className="flex flex-wrap items-center gap-2 text-gray-500">
            Base rate
            <input aria-label="Base earn rate" inputMode="decimal" value={baseRate} onChange={(e) => setBaseRate(e.target.value)} placeholder="1" className={`${FIELD} w-24`} />
          </label>
          {rules.map((r, i) => (
            <div key={i} className="flex flex-wrap items-center gap-2">
              <select aria-label="Rule matches" value={r.kind} onChange={(e) => update(i, { kind: e.target.value as LoyaltyEarnMatchKind })} className={FIELD}>
                <option value="category">Category is</option>
                <option value="merchant">Merchant has</option>
              </select>
              <input aria-label="Rule text" value={r.match} onChange={(e) => update(i, { match: e.target.value })} placeholder={r.kind === 'category' ? 'Category name' : 'Merchant words'} className={`${FIELD} min-w-0 flex-1`} />
              <input aria-label="Rule rate" inputMode="decimal" value={r.rate} onChange={(e) => update(i, { rate: e.target.value })} placeholder="3" className={`${FIELD} w-20`} />
              <button type="button" onClick={() => move(i, -1)} disabled={i === 0} aria-label="Move rule up" className={`${CONTROL} text-gray-500 hover:bg-gray-100 disabled:opacity-30`}>↑</button>
              <button type="button" onClick={() => move(i, 1)} disabled={i === rules.length - 1} aria-label="Move rule down" className={`${CONTROL} text-gray-500 hover:bg-gray-100 disabled:opacity-30`}>↓</button>
              <button type="button" onClick={() => setRules(rules.filter((_, j) => j !== i))} aria-label="Remove rule" className={`${CONTROL} text-red-400 hover:text-red-600 hover:bg-gray-100`}>Remove</button>
            </div>
          ))}
          <div className="flex flex-wrap gap-2">
            <button type="button" onClick={() => setRules([...rules, { kind: 'category', match: '', rate: '' }])} className={`${CONTROL} text-gray-500 hover:bg-gray-100`}>
              Add rule
            </button>
            <button type="button" onClick={saveRates} disabled={saving} className={`${CONTROL} font-medium text-white bg-gray-800 hover:bg-gray-700 disabled:opacity-50`}>
              {saving ? 'Saving…' : 'Save earn rates'}
            </button>
          </div>
        </div>
      )}
      {error && <p className="basis-full text-red-500 text-sm">{error}</p>}
    </>
  );
}
