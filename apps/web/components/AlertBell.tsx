'use client';

import { useEffect, useRef, useState, useSyncExternalStore, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { AlertTriangle } from 'lucide-react';

/**
 * One control with a count, opening the full warnings on click.
 *
 * These alerts persist for days by design — a degraded bank feed clears on Plaid's schedule, a
 * drift needs a missing transaction found — so anything permanently on screen is permanently
 * spending space to repeat what the owner already knows. A count says the same thing in one glyph
 * and gives the page back.
 *
 * It renders NOTHING at zero rather than a reassuring empty state. A tray that is always present
 * is another thing to scan; its absence is the healthy signal, and it costs no pixels to send.
 *
 * ─── TWO PLACES, ONE STATE — and why the phone's copy is a portal ─────────────────────────────
 *
 * On a desktop it sits in the page's own header, where it always has. On a phone the owner asked
 * for it in the app bar beside the menu button, which is a different React tree: that bar belongs
 * to `Sidebar`, rendered by the layout, and this is rendered by whichever page HAS warnings.
 *
 * Moving the data up to the layout was the alternative and is worse. The findings come from three
 * reads, and the layout wraps every route — the login screen included — so a shell that owned them
 * would run those queries for a reader who is not signed in. A portal leaves the query where the
 * query belongs and moves only the pixels.
 *
 * Both copies render, and CSS shows exactly one: the in-place copy is `hidden md:block`, the
 * portalled copy `md:hidden`. That is what keeps the desktop free of any hydration flash — its
 * copy is in the server HTML and correct from the first byte. The phone's copy can only appear
 * once `document` exists, so it arrives a frame late; it is a badge in a bar, not layout, and
 * nothing moves when it lands.
 *
 * Sharing `open` between them costs nothing and is the honest model: there is one popover, and it
 * cannot be in two states because only one trigger is ever on screen.
 */
export default function AlertBell({ count, children }: { count: number; children: ReactNode }) {
  const [open, setOpen] = useState(false);
  const wrapRef = useRef<HTMLDivElement>(null);
  const headerRef = useRef<HTMLDivElement>(null);

  /**
   * The app bar's landing site, or `null` on a server and on any page whose shell has none.
   *
   * `useSyncExternalStore` rather than `useEffect` + `setState`, which is what this was and which
   * the cascading-render lint rule refused — correctly, and for the second time in this codebase:
   * the sidebar's drawer effect was caught by the same rule. Looking up a DOM node is a READ of an
   * external system, and this hook is the shape React asks for when reading one, including the
   * server snapshot that hydration needs.
   *
   * `subscribe` is a no-op because the answer cannot change: the slot is server-rendered by the
   * layout and outlives every page. `getSnapshot` returns the same node identity on every call, so
   * there is nothing here for React to loop on.
   */
  const slot = useSyncExternalStore(
    () => () => {},
    () => document.getElementById('alert-slot'),
    () => null,
  );

  useEffect(() => {
    if (!open) return;
    // BOTH copies count as "inside". A click on the header trigger is outside `wrapRef` — without
    // the second test, opening the popover on a phone would close it in the same gesture.
    function onPointerDown(e: MouseEvent) {
      const target = e.target as Node;
      if (!wrapRef.current?.contains(target) && !headerRef.current?.contains(target)) setOpen(false);
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

  const label = `${count} ${count === 1 ? 'warning' : 'warnings'}`;

  // An OPAQUE surface, not just a positioned stack. Both cards are translucent amber, which reads
  // against the page's white ground and turns muddy over anything darker — the drift card came out
  // grey. White underneath and a shadow around makes it lifted rather than dissolved.
  const surface = 'rounded-xl bg-white p-2 shadow-lg ring-1 ring-slate-900/5 space-y-2 z-30';

  // ─── TWO ANCHORINGS, because the two triggers sit in different places ────────────────────────
  //
  // In the page it hangs off its button: `absolute right-0 top-full`, so it travels with the
  // header instead of floating over whatever the reader has scrolled to. `z-30` clears the sticky
  // table headers further down the page, which sit at 20.
  //
  // In the APP BAR it cannot. The panel is nearly viewport-wide and its trigger sits about 44px
  // from the right edge, so anchoring to the button would put the panel's left edge some 24px off
  // the left of the screen — which is a horizontal scrollbar on a page that has just had two of
  // them removed. `fixed inset-x-4` pins it to the viewport instead, and the top is the bar's own
  // height plus the same safe-area inset the bar itself is padded by; the two must stay in step,
  // which is why the value is spelled out rather than approximated.
  const pagePopover = <div className={`absolute right-0 top-full mt-2 w-[calc(100vw-2rem)] max-w-[26rem] sm:w-[26rem] ${surface}`}>{children}</div>;
  const barPopover = <div className={`fixed inset-x-4 top-[calc(3.5rem+env(safe-area-inset-top)+0.5rem)] ${surface}`}>{children}</div>;

  return (
    <>
      {/* IN THE PAGE, FOR A DESKTOP. An amber pill on a white page: it reads as a warning because
          amber against white is what a warning looks like here. */}
      <div ref={wrapRef} className="relative shrink-0 hidden md:block">
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          aria-expanded={open}
          aria-label={label}
          className={`relative flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg border text-xs font-medium transition-colors ${
            open
              ? 'bg-amber-100 border-amber-300 text-amber-900'
              : 'bg-amber-50 border-amber-200 text-amber-800 hover:bg-amber-100'
          }`}
        >
          <AlertTriangle size={14} className="text-amber-500" />
          {count}
        </button>
        {open && pagePopover}
      </div>

      {/* IN THE APP BAR, FOR A PHONE — a notification rather than a pill.
          
          The desktop pill does not survive the move: a pale amber chip on cyan-700 is a light
          rectangle stuck on a dark bar, and it competes with the menu button beside it rather than
          reading as a mark ON the bar. So it becomes the shape the platform already teaches — a
          glyph in the bar's own ink with a count riding its corner — and the amber is spent on the
          badge alone, which is the part that has to be noticed. */}
      {slot && createPortal(
        <div ref={headerRef} className="relative md:hidden">
          <button
            type="button"
            onClick={() => setOpen((v) => !v)}
            aria-expanded={open}
            aria-label={label}
            className={`relative p-2 rounded-lg transition-colors ${open ? 'text-white bg-white/15' : 'text-cyan-100 hover:text-white'}`}
          >
            <AlertTriangle size={20} />
            {/* `ring-cyan-700` matches the bar, so the badge is cut out of it rather than floating
                on it — the trick that keeps a count legible where it overlaps the glyph beneath. */}
            <span className="absolute -top-0.5 -right-0.5 min-w-[16px] h-4 px-1 rounded-full
                             bg-amber-400 text-amber-950 text-[10px] font-bold leading-4 text-center
                             ring-2 ring-cyan-700">
              {count}
            </span>
          </button>
          {open && barPopover}
        </div>,
        slot
      )}
    </>
  );
}
