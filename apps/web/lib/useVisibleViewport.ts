'use client';

import { useCallback, useSyncExternalStore } from 'react';

/**
 * The part of the window that is actually on screen, as a rectangle in layout-viewport
 * coordinates — i.e. the window minus whatever an on-screen keyboard is covering.
 *
 * ─── WHY A `fixed` OVERLAY CANNOT JUST USE `inset-0` ──────────────────────────────────────────
 *
 * On Android and on a desktop, raising a keyboard (or a pane) SHRINKS the layout viewport: `100dvh`
 * gets smaller, `position: fixed` re-anchors, and a sheet aligned to the bottom edge lands above
 * the keyboard with no help from anyone.
 *
 * iOS does not. The layout viewport keeps its full height and the keyboard is drawn over it, so
 * `fixed inset-0` still spans the whole screen, `bottom: 0` is still the bottom of the screen, and
 * a sheet anchored there sits behind the keys. Nothing in CSS reports the covered strip.
 *
 * `window.visualViewport` does, on every current engine, which is what this reads:
 *
 *   - `height`/`width` — the uncovered region, so the keyboard's height is the difference.
 *   - `offsetTop`/`offsetLeft` — where that region sits inside the layout viewport, which is not
 *     zero on iOS: focusing a field near the bottom makes Safari shift the page up, and a `fixed`
 *     element has to move by the same amount to stay where it was on screen.
 *
 * An overlay given this rectangle is exactly the visible area, which makes `items-end` mean "above
 * the keyboard" and a `max-height` mean "as tall as what I can see" on all three platforms, with no
 * per-platform branch in the component.
 *
 * ─── WHY `useSyncExternalStore` AND NOT AN EFFECT ────────────────────────────────────────────
 *
 * The viewport is the textbook external store: it changes without React, mid-gesture, several times
 * a second while a keyboard animates. Reading it in an effect and calling `setState` renders one
 * frame behind every one of those changes — and `react-hooks/set-state-in-effect` fails the build
 * over it, correctly. Here React reads the live measurement during render instead; the subscription
 * only says "it moved".
 *
 * ─── HOW TO USE IT ───────────────────────────────────────────────────────────────────────────
 *
 * Pass whether the overlay is open; it only listens, and only measures, while it is. `null` comes
 * back when it is closed, on the server, and on anything without `visualViewport`, and means
 * "measure nothing, change nothing" — the caller keeps its CSS fallback (`inset-0`, a `dvh` cap)
 * and is merely back to the behaviour it had before this existed, rather than unpositioned.
 */
export interface VisibleViewport {
  /** Distance from the top of the LAYOUT viewport to the top of the visible region. */
  top: number;
  left: number;
  width: number;
  height: number;
}

/**
 * The last rectangle handed out, kept because `useSyncExternalStore` compares snapshots by
 * identity: a fresh object every render is a render loop. One cache for the window is right —
 * there is one visual viewport, and every caller is asking about the same one.
 */
let cached: VisibleViewport | null = null;
let cachedKey = '';

function measure(): VisibleViewport | null {
  const vv = typeof window === 'undefined' ? undefined : window.visualViewport;
  if (!vv) return null;
  const key = `${vv.offsetTop}|${vv.offsetLeft}|${vv.width}|${vv.height}`;
  if (key !== cachedKey) {
    cachedKey = key;
    cached = { top: vv.offsetTop, left: vv.offsetLeft, width: vv.width, height: vv.height };
  }
  return cached;
}

const NOTHING = () => null;

export function useVisibleViewport(active: boolean): VisibleViewport | null {
  const subscribe = useCallback(
    (onChange: () => void) => {
      const vv = typeof window === 'undefined' ? undefined : window.visualViewport;
      if (!active || !vv) return () => {};
      // BOTH events, because the keyboard fires them separately and each alone is a wrong answer:
      // `resize` when the covered height changes, `scroll` when iOS shifts the page to reveal the
      // focused field. Missing the second leaves the overlay offset by that shift.
      vv.addEventListener('resize', onChange);
      vv.addEventListener('scroll', onChange);
      return () => {
        vv.removeEventListener('resize', onChange);
        vv.removeEventListener('scroll', onChange);
      };
    },
    [active]
  );

  return useSyncExternalStore(subscribe, active ? measure : NOTHING, NOTHING);
}
