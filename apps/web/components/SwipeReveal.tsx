'use client';

import { useEffect, useRef, useState, type HTMLAttributes, type ReactNode } from 'react';
import { Trash2 } from 'lucide-react';

/** How far the row slides to uncover its action. */
const ACTION_PX = 88;
/** Movement before the gesture commits to an axis — under this it is still a tap. */
const SLOP_PX = 8;
/** Only one row is open at a time, across every list on the page; opening one closes the rest. */
const OPEN_EVENT = 'swipe-reveal:open';

/**
 * A row that slides left on a phone to uncover one red action — the gesture, and nothing else.
 *
 * Shared by the statement's transaction rows and the accounts list, so the two swipe alike. It
 * NEVER ACTS ON ITS OWN: the swipe uncovers a button, the button calls `onAction`, and the caller
 * opens its own confirmation. A swipe is easy to make by accident while scrolling a long list,
 * which is exactly why it must be a reveal and never the act.
 *
 * TOUCH EVENTS, NOT POINTER EVENTS, and `touch-action: pan-y`. The browser keeps vertical
 * scrolling, which is most of what a thumb does, and hands over horizontal movement. The axis is
 * decided once per gesture, after SLOP_PX — a scroll that drifts sideways must not start sliding
 * the row it happens to be over. Phone only: from `sm` up a touch does nothing here, and the
 * caller provides a button instead.
 *
 * The outer element is not transformed, so a `fixed` dialog the caller renders through `after`
 * still covers the screen; only the inner row moves.
 */
export default function SwipeReveal({
  rowKey, as: Outer = 'div', actionLabel, onAction, className, rowProps, after, children,
}: {
  /** Unique among rows on the page; used to close the others when this one opens. */
  rowKey: string;
  as?: 'div' | 'li';
  /** The uncovered button's word, e.g. "Delete" or "Remove". */
  actionLabel: string;
  onAction: () => void;
  /** The moving row's own classes — its grid, padding, borders. */
  className: string;
  /** Anything else the moving row needs, such as drag-and-drop handlers. */
  rowProps?: HTMLAttributes<HTMLDivElement> & { draggable?: boolean };
  /** Rendered outside the moving row — the caller's confirmation dialog. */
  after?: ReactNode;
  children: ReactNode;
}) {
  const [offset, setOffset] = useState(0);
  const [dragging, setDragging] = useState(false);
  const gesture = useRef<{ x: number; y: number; base: number; axis: 'x' | 'y' | null } | null>(null);
  const open = offset !== 0 && !dragging;

  useEffect(() => {
    function onOtherOpen(e: Event) {
      if ((e as CustomEvent<string>).detail !== rowKey) setOffset(0);
    }
    window.addEventListener(OPEN_EVENT, onOtherOpen);
    return () => window.removeEventListener(OPEN_EVENT, onOtherOpen);
  }, [rowKey]);

  function onTouchStart(e: React.TouchEvent) {
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
    const next = offset < -ACTION_PX / 2 ? -ACTION_PX : 0;
    setOffset(next);
    if (next !== 0) window.dispatchEvent(new CustomEvent(OPEN_EVENT, { detail: rowKey }));
  }

  return (
    <Outer className="relative overflow-hidden">
      {/* The action behind the row, rendered only while the row is moved: left in place under
          every row, its red showed as a hairline down the card's edge. */}
      {offset !== 0 && (
        <button
          type="button"
          onClick={() => { onAction(); setOffset(0); }}
          tabIndex={open ? 0 : -1}
          aria-hidden={!open}
          className="sm:hidden absolute inset-y-0 right-0 flex flex-col items-center justify-center gap-1 bg-red-500 text-white text-xs font-medium"
          style={{ width: ACTION_PX }}
        >
          <Trash2 size={18} />
          {actionLabel}
        </button>
      )}

      <div
        {...rowProps}
        onTouchStart={onTouchStart}
        onTouchMove={onTouchMove}
        onTouchEnd={onTouchEnd}
        onTouchCancel={onTouchEnd}
        onClickCapture={(e) => { if (open) { e.preventDefault(); e.stopPropagation(); setOffset(0); } }}
        className={`relative bg-white touch-pan-y ${dragging ? '' : 'transition-transform duration-200'} ${className}`}
        style={{ transform: offset ? `translateX(${offset}px)` : undefined }}
      >
        {children}
      </div>

      {after}
    </Outer>
  );
}
