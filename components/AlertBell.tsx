'use client';

import { useEffect, useRef, useState, type ReactNode } from 'react';
import { AlertTriangle } from 'lucide-react';

/**
 * One icon in the corner, with a count, opening the full warnings on click.
 *
 * These alerts persist for days by design — a degraded bank feed clears on Plaid's schedule, a
 * drift needs a missing transaction found — so anything permanently on screen is permanently
 * spending space to repeat what the owner already knows. A count says the same thing in one glyph
 * and gives the page back.
 *
 * It renders NOTHING at zero rather than a reassuring empty state. A tray that is always present
 * is another thing to scan; its absence is the healthy signal, and it costs no pixels to send.
 */
export default function AlertBell({ count, children }: { count: number; children: ReactNode }) {
  const [open, setOpen] = useState(false);
  const wrapRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    function onPointerDown(e: MouseEvent) {
      if (!wrapRef.current?.contains(e.target as Node)) setOpen(false);
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') setOpen(false);
    }
    document.addEventListener('mousedown', onPointerDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onPointerDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  if (count === 0) return null;

  return (
    <div ref={wrapRef} className="relative shrink-0">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        aria-label={`${count} ${count === 1 ? 'warning' : 'warnings'}`}
        className={`relative flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg border text-xs font-medium transition-colors ${
          open
            ? 'bg-amber-100 border-amber-300 text-amber-900'
            : 'bg-amber-50 border-amber-200 text-amber-800 hover:bg-amber-100'
        }`}
      >
        <AlertTriangle size={14} className="text-amber-500" />
        {count}
      </button>

      {open && (
        // Anchored to the button rather than the viewport, so it travels with the header instead
        // of hanging over whatever the reader has scrolled to. `z-30` clears the sticky table
        // headers further down the page, which sit at 20.
        // An OPAQUE surface, not just a positioned stack. Both cards are translucent amber, which
        // is right against the page's white ground and muddy over the dark hero the popover now
        // floats above — the drift card in particular came out grey. The panel puts white
        // underneath them and a shadow around, so it reads as lifted off the page rather than
        // dissolved into whatever is behind it.
        <div className="absolute right-0 top-full mt-2 w-[26rem] z-30 rounded-xl bg-white p-2
                        shadow-lg ring-1 ring-slate-900/5 space-y-2">
          {children}
        </div>
      )}
    </div>
  );
}
