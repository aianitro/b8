import type { MetadataRoute } from 'next';

/**
 * What makes this installable to an iPhone Home Screen — §5 step 26b.
 *
 * ─── Why a manifest at all, when iOS reads the meta tags instead ──────────────────────────────
 *
 * Safari has never implemented `display: standalone`; on iOS the equivalent is
 * `apple-mobile-web-app-capable`, which `layout.tsx` sets. This file is still worth having: it is
 * what every other browser reads, it supplies the install name and icons in one place rather than
 * four meta tags, and it is the half of the contract that does not depend on Apple.
 *
 * `start_url` is the dashboard rather than `/`, because a launcher icon should open the thing the
 * app is for. `/` redirects there anyway, and skipping the redirect saves a navigation on a cold
 * launch over a tailnet.
 *
 * NO `scope` BEYOND THE DEFAULT and no absolute URLs anywhere. The app is reached by whatever host
 * Tailscale Serve is answering on, and a hard-coded origin here would break the install the first
 * time that name changed — which is exactly the sort of thing that changes when a machine is
 * replaced.
 */
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: 'B8 Finance',
    short_name: 'B8',
    description: 'Personal finance dashboard',
    start_url: '/dashboard',
    display: 'standalone',
    background_color: '#ffffff',
    // Slate-50, matching the body the app actually paints, so the launch splash does not flash a
    // different colour than the page it becomes.
    theme_color: '#f8fafc',
    orientation: 'portrait',
    icons: [
      { src: '/icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
      { src: '/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
      // `maskable` is a SEPARATE entry rather than a second purpose on the ones above: a maskable
      // icon carries padding for the platform to crop into a circle or squircle, and the same file
      // used for both is either cropped badly or padded where it should not be.
      { src: '/icon-maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
    ],
  };
}
