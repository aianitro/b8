'use client';

import { useEffect, useRef, useState } from 'react';
import { placeholderInitial, safeLogoUrl } from '@/lib/enrichedDisplay';

/** The mark's box, in px. The tile is always exactly this, and the logo is laid over it. */
const SIZE = 28;

/**
 * Logo URLs that have fired a real `error` event in this tab. Module-level so a row that unmounts
 * and comes back — "Show fewer" then "Show more" — does not ask a dead host again.
 *
 * ONLY THE `error` EVENT ADDS TO IT. An earlier version also guessed at mount, treating a finished
 * request with no pixels as dead; a deferred `loading="lazy"` image can look like that before it
 * has even been requested, and a guess written here would hide that logo for the rest of the tab.
 * A zero `naturalWidth` is never read as failure.
 */
const failedLogos = new Set<string>();

/**
 * The square at the start of a statement or Transactions row: the merchant's logo when one is
 * stored and loads, otherwise a neutral slate tile with the title's initial. Shared by both
 * surfaces so the choice of placeholder is made once.
 *
 * THE TILE IS ALWAYS RENDERED, AND THE LOGO IS INVISIBLE UNTIL IT HAS LOADED. The tile is the box;
 * the `img` sits on top of it at `opacity-0` and only becomes visible on `load`. A failure is
 * therefore never painted, whenever it happens — before hydration, after it, or long after a lazy
 * image scrolls into view. The first version showed the `img` while it loaded and swapped it out on
 * `error`, and at 390px the browser's broken-image icon was seen for a moment on a dead host before
 * the swap (G4 finding F1). Hiding until loaded removes that window by construction rather than
 * racing it.
 *
 * A PLAIN `img`, NOT `next/image`. The optimizer would have this app's server fetch whatever URL
 * Plaid stored; a plain `img` keeps that fetch in the browser, and `next.config.ts` keeps no
 * `images` entry at all. The third-party host still learns the viewer's IP when a logo loads —
 * the accepted cost of showing logos — but it is not told which page asked: `no-referrer`.
 *
 * The source is `safeLogoUrl`'s output and never the column itself (an AST test pins this).
 * No `crossOrigin`, so the request carries no credentials. Not draggable, so a thumb that lands
 * on the logo still swipes the row rather than lifting the image.
 *
 * A CLIENT COMPONENT because of the load and error handlers; a server-rendered `img` has nobody to
 * tell, and would stay invisible.
 */
export default function MerchantMark({ logoUrl, title }: { logoUrl: string | null; title: string | null }) {
  const src = safeLogoUrl(logoUrl);
  const initial = placeholderInitial(title);
  const [loadedSrc, setLoadedSrc] = useState<string | null>(null);
  const [failedSrc, setFailedSrc] = useState<string | null>(null);
  const imgRef = useRef<HTMLImageElement>(null);
  // A URL that failed is not rendered again, on re-render (state) or on remount (the set).
  const tryImage = src !== null && src !== failedSrc && !failedLogos.has(src);
  const loaded = tryImage && loadedSrc === src;

  // An image that LOADED before hydration fired its `load` while React was not listening, and
  // would otherwise stay invisible over its tile. So once mounted, look: a finished request WITH
  // pixels is a loaded image. The opposite case is deliberately not inferred — see failedLogos.
  useEffect(() => {
    const img = imgRef.current;
    if (src !== null && img && img.complete && img.naturalWidth > 0) setLoadedSrc(src);
  }, [src]);

  return (
    <span
      aria-hidden="true"
      className="relative flex shrink-0 size-7 items-center justify-center rounded-md bg-slate-100 text-xs font-semibold text-slate-500 select-none"
    >
      {initial}
      {tryImage && (
        // eslint-disable-next-line @next/next/no-img-element -- next/image would fetch it from the server; see above
        <img
          ref={imgRef}
          src={src}
          alt=""
          width={SIZE}
          height={SIZE}
          loading="lazy"
          decoding="async"
          referrerPolicy="no-referrer"
          draggable={false}
          onLoad={() => setLoadedSrc(src)}
          // Unmounted on error, and remembered before the re-render, so the same URL cannot be
          // rendered again and loop. It was never visible, so nothing is seen to change.
          onError={() => { failedLogos.add(src); setFailedSrc(src); }}
          className={`absolute inset-0 size-7 rounded-md bg-white object-contain ring-1 ring-slate-100 transition-opacity duration-150 ${loaded ? 'opacity-100' : 'opacity-0'}`}
        />
      )}
    </span>
  );
}
