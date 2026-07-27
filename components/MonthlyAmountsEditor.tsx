'use client';

import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';

const MONTH_LABELS = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];

const fmt = (n: number) =>
  new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 }).format(n);

// Compact summary of a monthly_amounts schedule: null -> flat; equal nonzero amounts in a
// subset of months (e.g. property tax twice a year) -> "Apr, Oct"; varies every month
// (e.g. a salary with raises) -> "$min–$max".
export function scheduleLabel(monthlyAmounts: number[] | null): string {
  if (!monthlyAmounts) return 'Every month';
  const nonZero = monthlyAmounts.filter((n) => n > 0);
  if (nonZero.length === 0) return 'Every month';
  const min = Math.min(...nonZero);
  const max = Math.max(...nonZero);
  if (min === max) {
    const activeMonths = monthlyAmounts.map((n, i) => (n > 0 ? MONTH_LABELS[i] : null)).filter(Boolean);
    return activeMonths.length < 12 ? activeMonths.join(', ') : `${fmt(min)}/mo`;
  }
  return `${fmt(min)}–${fmt(max)}`;
}

function initialAmountValues(annualBudget: number, monthlyAmounts: number[] | null): string[] {
  const base = monthlyAmounts && monthlyAmounts.length === 12 ? monthlyAmounts : new Array(12).fill(annualBudget / 12);
  return base.map((n) => (n ? String(Math.round(n * 100) / 100) : ''));
}

const AMOUNTS_PICKER_WIDTH = 264;
const AMOUNTS_PICKER_HEIGHT = 300; // approx rendered height incl. padding, used for flip-up logic

// Editor for an explicit expected-amount-per-month schedule. Prefills from the existing
// schedule, or an even annual/12 split as a starting point when none is set yet. Renders via
// a portal at a computed fixed position (flipping above the trigger when there's no room
// below) so it isn't clipped by ancestor `overflow-hidden` containers — e.g. a rounded-corner
// table wrapper cutting off an absolutely-positioned dropdown on the last row.
export default function MonthlyAmountsEditor({ annualBudget, monthlyAmounts, onSave }: {
  annualBudget: number;
  monthlyAmounts: number[] | null;
  onSave: (amounts: number[] | null) => Promise<void>;
}) {
  const [coords, setCoords] = useState<{ top: number; left: number } | null>(null);
  const [values, setValues] = useState<string[]>(() => initialAmountValues(annualBudget, monthlyAmounts));
  const [saving, setSaving] = useState(false);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const open = coords !== null;

  useEffect(() => {
    if (!open) return;
    function close() { setCoords(null); }
    function handlePointerDown(e: MouseEvent) {
      const target = e.target as Node;
      if (triggerRef.current?.contains(target) || panelRef.current?.contains(target)) return;
      close();
    }
    function handleKey(e: KeyboardEvent) {
      if (e.key === 'Escape') close();
    }
    document.addEventListener('mousedown', handlePointerDown);
    document.addEventListener('keydown', handleKey);
    window.addEventListener('scroll', close, true);
    window.addEventListener('resize', close);
    return () => {
      document.removeEventListener('mousedown', handlePointerDown);
      document.removeEventListener('keydown', handleKey);
      window.removeEventListener('scroll', close, true);
      window.removeEventListener('resize', close);
    };
  }, [open]);

  function toggleOpen() {
    if (open) { setCoords(null); return; }
    setValues(initialAmountValues(annualBudget, monthlyAmounts));
    const rect = triggerRef.current?.getBoundingClientRect();
    if (!rect) return;
    const openUp = window.innerHeight - rect.bottom < AMOUNTS_PICKER_HEIGHT + 8 && rect.top > AMOUNTS_PICKER_HEIGHT + 8;
    const top = openUp ? rect.top - AMOUNTS_PICKER_HEIGHT - 4 : rect.bottom + 4;
    const left = Math.max(8, Math.min(rect.right - AMOUNTS_PICKER_WIDTH, window.innerWidth - AMOUNTS_PICKER_WIDTH - 8));
    setCoords({ top, left });
  }

  async function handleSave() {
    setSaving(true);
    await onSave(values.map((v) => parseFloat(v) || 0));
    setSaving(false);
    setCoords(null);
  }

  async function handleResetFlat() {
    setSaving(true);
    await onSave(null);
    setSaving(false);
    setCoords(null);
  }

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        onClick={toggleOpen}
        className="text-xs px-2 py-1 rounded-lg border border-slate-200 bg-white text-slate-600 hover:border-slate-300 whitespace-nowrap"
      >
        {scheduleLabel(monthlyAmounts)}
      </button>
      {open && createPortal(
        <div
          ref={panelRef}
          style={{ position: 'fixed', top: coords.top, left: coords.left, width: AMOUNTS_PICKER_WIDTH }}
          className="z-50 bg-white border border-slate-200 rounded-xl shadow-lg p-3"
        >
          <p className="text-[10px] text-slate-400 mb-2">Expected amount per month</p>
          <div className="grid grid-cols-2 gap-x-3 gap-y-1.5 mb-3">
            {MONTH_LABELS.map((m, i) => (
              <label key={m} className="flex items-center gap-1.5 text-xs text-slate-500">
                <span className="w-8 shrink-0">{m}</span>
                <input
                  type="number"
                  min="0"
                  value={values[i]}
                  onChange={(e) => setValues((prev) => prev.map((v, idx) => (idx === i ? e.target.value : v)))}
                  className="w-full border border-slate-200 rounded-md px-1.5 py-1 text-xs font-mono focus:outline-none focus:ring-1 focus:ring-slate-400"
                />
              </label>
            ))}
          </div>
          <div className="flex items-center justify-between">
            <button
              type="button"
              onClick={handleResetFlat}
              disabled={saving || !monthlyAmounts}
              className="text-xs text-slate-400 hover:text-slate-600 font-medium disabled:opacity-40 disabled:cursor-default"
            >
              Reset to flat
            </button>
            <button
              type="button"
              onClick={handleSave}
              disabled={saving}
              className="text-xs px-3 py-1 rounded-lg bg-slate-900 text-white font-medium hover:bg-slate-800 disabled:opacity-50"
            >
              {saving ? 'Saving…' : 'Save'}
            </button>
          </div>
        </div>,
        document.body
      )}
    </>
  );
}
