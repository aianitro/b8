'use client';

import { useEffect, useRef, useState } from 'react';
import { Trash2 } from 'lucide-react';
import ConfirmDeleteTransaction from './ConfirmDeleteTransaction';

/** How far the row slides to uncover the Delete action. */
const ACTION_PX = 88;
/** Movement before the gesture commits to an axis — under this it is still a tap. */
const SLOP_PX = 8;
/** Only one row is open at a time; opening one tells the rest to close. */
const OPEN_EVENT = 'swipe-delete-row:open';

/**
 * A statement row that deletes: swipe left on a phone, a trash button from `sm` up.
 *
 * NEITHER DELETES ON ITS OWN. The swipe only uncovers a Delete button and the trash button only
 * opens the dialog; both end at the same "Delete transaction?" confirmation the Transactions table
 * uses. A swipe is easy to make by accident while scrolling a long list, which is exactly why it
 * must be a reveal and never the act.
 *
 * TOUCH EVENTS, NOT POINTER EVENTS, and `touch-action: pan-y`. The browser keeps vertical
 * scrolling, which is most of what a thumb does on this page, and hands over horizontal movement.
 * The axis is decided once per gesture, after SLOP_PX — a scroll that drifts sideways must not
 * start sliding the row it happens to be over.
 */
export default function SwipeDeleteRow({ transactionId, description, className, children }: {
  transactionId: number;
  description: string;
  /** The row's own grid classes; the desktop delete button is appended as its last cell. */
  className: string;
  children: React.ReactNode;
}) {
  const [offset, setOffset] = useState(0);
  const [dragging, setDragging] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const gesture = useRef<{ x: number; y: number; base: number; axis: 'x' | 'y' | null } | null>(null);
  const open = offset !== 0 && !dragging;

  useEffect(() => {
    function onOtherOpen(e: Event) {
      if ((e as CustomEvent<number>).detail !== transactionId) setOffset(0);
    }
    window.addEventListener(OPEN_EVENT, onOtherOpen);
    return () => window.removeEventListener(OPEN_EVENT, onOtherOpen);
  }, [transactionId]);

  function onTouchStart(e: React.TouchEvent) {
    // From `sm` up the row has a trash button and no action behind it, so a swipe on a touch
    // laptop or a tablet would only uncover blank space. Matches Tailwind's `sm` breakpoint.
    if (window.matchMedia('(min-width: 640px)').matches) return;
    const t = e.touches[0];
    gesture.current = { x: t.clientX, y: t.clientY, base: offset, axis: null };
  }

  function onTouchMove(e: React.TouchEvent) {
    const g = gesture.current;
    if (!g) return;
    const t = e.touches[0];
    const dx = t.clientX - g.x;
    const dy = t.clientY - g.y;
    if (g.axis === null) {
      if (Math.abs(dx) < SLOP_PX && Math.abs(dy) < SLOP_PX) return;
      g.axis = Math.abs(dx) > Math.abs(dy) ? 'x' : 'y';
      if (g.axis === 'x') setDragging(true);
    }
    if (g.axis === 'x') setOffset(Math.max(-ACTION_PX, Math.min(0, g.base + dx)));
  }

  function onTouchEnd() {
    const g = gesture.current;
    gesture.current = null;
    if (g?.axis !== 'x') return;
    setDragging(false);
    // Past halfway it snaps open, short of it snaps back — the row never rests half-revealed.
    const next = offset < -ACTION_PX / 2 ? -ACTION_PX : 0;
    setOffset(next);
    if (next !== 0) window.dispatchEvent(new CustomEvent(OPEN_EVENT, { detail: transactionId }));
  }

  return (
    <li className="relative overflow-hidden">
      {/* The action behind the row. Phone only: from `sm` up the trash button is the way in.
          Rendered only while the row is moved: left in place under every row, its red showed as a
          hairline down the card's right edge, where the row above it does not quite cover it. */}
      {offset !== 0 && (
      <button
        type="button"
        onClick={() => setConfirming(true)}
        tabIndex={open ? 0 : -1}
        aria-hidden={!open}
        className="sm:hidden absolute inset-y-0 right-0 flex flex-col items-center justify-center gap-1 bg-red-500 text-white text-xs font-medium"
        style={{ width: ACTION_PX }}
      >
        <Trash2 size={18} />
        Delete
      </button>
      )}

      <div
        onTouchStart={onTouchStart}
        onTouchMove={onTouchMove}
        onTouchEnd={onTouchEnd}
        onTouchCancel={onTouchEnd}
        // A tap on an open row closes it rather than reaching the category picker underneath.
        onClickCapture={(e) => { if (open) { e.preventDefault(); e.stopPropagation(); setOffset(0); } }}
        className={`relative bg-white touch-pan-y ${dragging ? '' : 'transition-transform duration-200'} ${className}`}
        style={{ transform: offset ? `translateX(${offset}px)` : undefined }}
      >
        {children}
        <button
          type="button"
          onClick={() => setConfirming(true)}
          title="Delete transaction"
          aria-label={`Delete ${description}`}
          className="hidden sm:flex items-center justify-center w-8 h-8 rounded-lg text-slate-300 hover:text-red-500 hover:bg-red-50 transition-colors"
        >
          <Trash2 size={15} />
        </button>
      </div>

      {confirming && (
        <ConfirmDeleteTransaction
          transactionId={transactionId}
          description={description}
          onClose={() => { setConfirming(false); setOffset(0); }}
        />
      )}
    </li>
  );
}
