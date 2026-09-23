'use client';

import { useEffect } from 'react';

/**
 * Registers the service worker — §5 step 26b.
 *
 * A separate client component rather than a script in `layout.tsx`, so the root layout stays a
 * server component and this is the only thing that ships to the browser for it.
 *
 * `useEffect` IS the right tool here, unlike the two places it was wrong earlier today: this
 * synchronises React with an external system (the service worker registry) and sets no state. That
 * is the case the rule exists to permit.
 *
 * FAILURE IS SWALLOWED ON PURPOSE. Registration fails on an insecure origin — plain http, which is
 * how this app is reached if Tailscale Serve is bypassed — and there is nothing a reader could do
 * about it and nothing broken if it does: every page works without a service worker. An unhandled
 * rejection in the console on every load would be noise that trains someone to ignore the console.
 */
export default function ServiceWorkerRegistrar() {
  useEffect(() => {
    if (!('serviceWorker' in navigator)) return;
    navigator.serviceWorker.register('/sw.js').catch(() => {});
  }, []);

  return null;
}
