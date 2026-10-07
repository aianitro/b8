'use client';

import { useEffect, useRef, useState } from 'react';
import { placeholderInitial, safeLogoUrl } from '@/lib/enrichedDisplay';

/** The mark's box, in px. The logo and the placeholder are both exactly this, so rows align. */
const SIZE = 28;

/**
 * Logo URLs that have already failed in this tab. Module-level so a row that unmounts and comes
 * back — "Show fewer" then "Show more" — does not ask a dead host again, and does not flash the
 * browser's broken-image icon a second time on the way to the placeholder.
 */
const deadLogos = new Set<string>();

/**
 * The square at the start of a statement or Transactions row: the merchant's logo when one is
 * stored and loads, otherwise a neutral slate tile with the title's initial. Shared by both
 * surfaces so the choice of placeholder is made once.
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
 * A CLIENT COMPONENT because of the error handler: a dead URL must become the placeholder, and a
 * server-rendered `img` has nobody to tell.
 */
export default function MerchantMark({ logoUrl, title }: { logoUrl: string | null; title: string | null }) {
  const src = safeLogoUrl(logoUrl);
  const [failedSrc, setFailedSrc] = useState<string | null>(null);
  const imgRef = useRef<HTMLImageElement>(null);
  const failed = src !== null && (src === failedSrc || deadLogos.has(src));

  // An image that fails BEFORE hydration fires its error event while React is not listening yet,
  // and would keep the broken-image icon for good. So once mounted, look: a request that has
  // finished (`complete`) with no pixels (`naturalWidth` 0) is broken. A lazy image not yet
  // requested is not `complete`, and is left to its own `onError`.
  useEffect(() => {
    const img = imgRef.current;
    if (src !== null && img && img.complete && img.naturalWidth === 0) {
      deadLogos.add(src);
      setFailedSrc(src);
    }
  }, [src]);

  if (src !== null && !failed) {
    return (
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
        // The same URL is never tried twice: it is remembered before the re-render, so the
        // placeholder that replaces it cannot render it again and loop.
        onError={() => { deadLogos.add(src); setFailedSrc(src); }}
        className="block shrink-0 size-7 rounded-md bg-white object-contain ring-1 ring-slate-100 select-none"
      />
    );
  }

  const initial = placeholderInitial(title);
  return (
    <span
      aria-hidden="true"
      className="flex shrink-0 size-7 items-center justify-center rounded-md bg-slate-100 text-xs font-semibold text-slate-500 select-none"
    >
      {initial}
    </span>
  );
}
