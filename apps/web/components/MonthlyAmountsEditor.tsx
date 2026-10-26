'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { X } from 'lucide-react';

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

/** Tailwind's `sm`. Below it the editor is a sheet; at or above it, a popover anchored to the trigger. */
const ANCHORED_MIN_WIDTH = 640;

/** The twelve month fields. `inputMode` so a phone offers a decimal pad rather than a full keyboard. */
function AmountFields({ values, onChange, roomy }: {
  values: string[];
  onChange: (index: number, value: string) => void;
  roomy: boolean;
}) {
  return (
    <div className={`grid grid-cols-2 ${roomy ? 'gap-x-4 gap-y-2.5' : 'gap-x-3 gap-y-1.5'}`}>
      {MONTH_LABELS.map((m, i) => (
        <label key={m} className="flex items-center gap-1.5 text-xs text-slate-500">
          <span className="w-8 shrink-0">{m}</span>
          <input
            type="number"
            inputMode="decimal"
            min="0"
            value={values[i]}
            onChange={(e) => onChange(i, e.target.value)}
            className={`w-full border border-slate-200 rounded-md px-1.5 font-mono focus:outline-none focus:ring-1 focus:ring-slate-400
                        ${roomy ? 'py-2 text-sm' : 'py-1 text-xs'}`}
          />
        </label>
      ))}
    </div>
  );
}

function ActionRow({ saving, canReset, onReset, onSave, className = '' }: {
  saving: boolean;
  canReset: boolean;
  onReset: () => void;
  onSave: () => void;
  className?: string;
}) {
  return (
    <div className={`flex items-center justify-between ${className}`}>
      <button
        type="button"
        onClick={onReset}
        disabled={saving || !canReset}
        className="text-xs text-slate-400 hover:text-slate-600 font-medium disabled:opacity-40 disabled:cursor-default"
      >
        Reset to flat
      </button>
      <button
        type="button"
        onClick={onSave}
        disabled={saving}
        className="text-xs px-3 py-1 rounded-lg bg-slate-900 text-white font-medium hover:bg-slate-800 disabled:opacity-50"
      >
        {saving ? 'Saving…' : 'Save'}
      </button>
    </div>
  );
}

/**
 * Editor for an explicit expected-amount-per-month schedule. Prefills from the existing
 * schedule, or an even annual/12 split as a starting point when none is set yet.
 *
 * TWO PRESENTATIONS, BECAUSE AN ANCHORED POPOVER CANNOT SURVIVE AN ON-SCREEN KEYBOARD. From `sm`
 * up this is a portal at a computed fixed position (flipping above the trigger when there's no
 * room below), so it isn't clipped by ancestor `overflow-hidden` containers — e.g. a rounded-corner
 * table wrapper cutting off an absolutely-positioned dropdown on the last row. Those coordinates
 * are measured once, which is why scrolling or resizing has to dismiss it rather than leave it
 * floating away from its trigger.
 *
 * On a phone that dismissal made the editor unusable: raising the keyboard fires both `resize` and
 * `scroll`, so the panel closed on the very tap that was meant to start typing, and no month amount
 * could be edited in the installed app at all. Below `sm` there is therefore nothing to anchor to —
 * it's the same bottom sheet the transaction dialogs use, within reach of a thumb, dismissed by the
 * backdrop or Esc, and indifferent to scroll and resize.
 */
export default function MonthlyAmountsEditor({ annualBudget, monthlyAmounts, onSave }: {
  annualBudget: number;
  monthlyAmounts: number[] | null;
  onSave: (amounts: number[] | null) => Promise<void>;
}) {
  const [open, setOpen] = useState(false);
  const [coords, setCoords] = useState<{ top: number; left: number } | null>(null);
  const [values, setValues] = useState<string[]>(() => initialAmountValues(annualBudget, monthlyAmounts));
  const [saving, setSaving] = useState(false);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  /** Coordinates exist only in the popover presentation; the sheet needs none. */
  const anchored = coords !== null;

  const close = useCallback(() => {
    setOpen(false);
    setCoords(null);
  }, []);

  useEffect(() => {
    if (!open) return;
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
    // Only the anchored popover is tied to a position that scrolling and resizing invalidate.
    if (anchored) {
      window.addEventListener('scroll', close, true);
      window.addEventListener('resize', close);
    }
    return () => {
      document.removeEventListener('mousedown', handlePointerDown);
      document.removeEventListener('keydown', handleKey);
      window.removeEventListener('scroll', close, true);
      window.removeEventListener('resize', close);
    };
  }, [open, anchored, close]);

  // The page behind the sheet does not scroll under it — the same lock the detail sheet takes.
  useEffect(() => {
    if (!open || anchored) return;
    const previous = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => { document.body.style.overflow = previous; };
  }, [open, anchored]);

  function toggleOpen() {
    if (open) { close(); return; }
    setValues(initialAmountValues(annualBudget, monthlyAmounts));
    const rect = triggerRef.current?.getBoundingClientRect();
    if (rect && window.innerWidth >= ANCHORED_MIN_WIDTH) {
      const openUp = window.innerHeight - rect.bottom < AMOUNTS_PICKER_HEIGHT + 8 && rect.top > AMOUNTS_PICKER_HEIGHT + 8;
      const top = openUp ? rect.top - AMOUNTS_PICKER_HEIGHT - 4 : rect.bottom + 4;
      const left = Math.max(8, Math.min(rect.right - AMOUNTS_PICKER_WIDTH, window.innerWidth - AMOUNTS_PICKER_WIDTH - 8));
      setCoords({ top, left });
    }
    setOpen(true);
  }

  const changeValue = (index: number, value: string) =>
    setValues((prev) => prev.map((v, idx) => (idx === index ? value : v)));

  async function handleSave() {
    setSaving(true);
    await onSave(values.map((v) => parseFloat(v) || 0));
    setSaving(false);
    close();
  }

  async function handleResetFlat() {
    setSaving(true);
    await onSave(null);
    setSaving(false);
    close();
  }

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        onClick={toggleOpen}
        // A finger needs more than the text's own height; the desktop row keeps its compact size.
        className="text-xs px-2.5 py-2 sm:py-1 rounded-lg border border-slate-200 bg-white text-slate-600 hover:border-slate-300 whitespace-nowrap"
      >
        {scheduleLabel(monthlyAmounts)}
      </button>

      {open && anchored && createPortal(
        <div
          ref={panelRef}
          style={{ position: 'fixed', top: coords.top, left: coords.left, width: AMOUNTS_PICKER_WIDTH }}
          className="z-50 bg-white border border-slate-200 rounded-xl shadow-lg p-3"
        >
          <p className="text-[10px] text-slate-400 mb-2">Expected amount per month</p>
          <AmountFields values={values} onChange={changeValue} roomy={false} />
          <ActionRow saving={saving} canReset={Boolean(monthlyAmounts)} onReset={handleResetFlat} onSave={handleSave} className="mt-3" />
        </div>,
        document.body
      )}

      {open && !anchored && createPortal(
        <div
          className="fixed inset-0 z-50 flex items-end justify-center bg-black/30 backdrop-blur-sm"
          onClick={() => !saving && close()}
        >
          <div
            ref={panelRef}
            role="dialog"
            aria-modal="true"
            aria-label="Expected amount per month"
            onClick={(e) => e.stopPropagation()}
            className="bg-white w-full rounded-t-2xl shadow-xl border border-slate-100 p-5 max-h-[85dvh] overflow-y-auto
                       pb-[calc(1.25rem+env(safe-area-inset-bottom))]"
          >
            <div className="flex items-start justify-between gap-3 mb-4">
              <h3 className="text-sm font-semibold text-slate-900">Expected amount per month</h3>
              <button
                type="button"
                onClick={close}
                disabled={saving}
                aria-label="Close"
                className="shrink-0 p-1 -m-1 text-slate-300 hover:text-slate-600 disabled:opacity-40"
              >
                <X size={18} />
              </button>
            </div>
            {/* Bottom room equal to the action row, so the last pair of months can be scrolled
                clear of it rather than sitting half-hidden behind it. */}
            <div className="pb-12">
              <AmountFields values={values} onChange={changeValue} roomy />
            </div>
            {/* Stuck to the bottom of the card: with a keyboard up the grid scrolls under it, and
                Save stays where the thumb left it. */}
            <ActionRow
              saving={saving}
              canReset={Boolean(monthlyAmounts)}
              onReset={handleResetFlat}
              onSave={handleSave}
              className="sticky bottom-0 bg-white pt-4 -mb-1"
            />
          </div>
        </div>,
        document.body
      )}
    </>
  );
}
