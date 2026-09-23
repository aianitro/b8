/* eslint-disable no-restricted-globals */
//
// b8's service worker — §5 step 26b.
//
// ─── WHAT THIS DOES NOT CACHE, WHICH IS THE POINT ─────────────────────────────────────────────
//
// No `/api/v1/*` response and no authenticated page is ever written to the cache. Only the build's
// immutable static assets and one offline page are.
//
// The reason is the auth model rather than storage: this app fails closed — no session, no figures.
// A cached response outlives the session that authorised it, so a cache-first shell would show a
// balance to someone who can no longer authenticate, from the device, with no request to the server
// that could refuse. "Cached last-synced data" is on the step's own description and is deliberately
// NOT here; what it would need first is an explicit expiry tied to session validity and an on-screen
// marker saying which moment the figures are from. Stale money with no date on it is the failure
// this repository keeps finding.
//
// ─── Why hand-written and not a plugin ────────────────────────────────────────────────────────
//
// Workbox and next-pwa both generate roughly this file plus a precache manifest. The manifest is
// the part that matters and Next already hashes its own assets, so what a plugin adds here is a
// build step and a dependency in exchange for about fifty lines. If the caching rules ever become
// interesting enough to be worth someone else's abstractions, that is the moment to reconsider.

const VERSION = 'b8-shell-v1';

// The offline page and the icons: small, static, and the only things worth having before a request.
// NOT the dashboard — see the note above.
const SHELL = ['/offline', '/icon-192.png'];

self.addEventListener('install', (event) => {
  // `skipWaiting` so a deployed change takes effect on the next launch rather than waiting for every
  // tab to close. On a single-user app there is no coordination problem to protect against, and the
  // alternative is an installed app running last week's shell with no way for the owner to know.
  event.waitUntil(caches.open(VERSION).then((cache) => cache.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== VERSION).map((k) => caches.delete(k))))
      // `clients.claim` so the first load after an install is controlled too, rather than the one
      // after that. Without it the offline fallback does not work until the app is opened twice.
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const { request } = event;

  // GET ONLY, SAME ORIGIN ONLY. A POST is a write and must never be replayed from a cache; another
  // origin is not ours to serve. Both fall through to the network untouched.
  if (request.method !== 'GET') return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  // NETWORK-ONLY FOR DATA, stated as a rule rather than left as an omission: every API path goes to
  // the server or fails. There is no cache entry to go stale and none to leak.
  if (url.pathname.startsWith('/api/')) return;

  // A NAVIGATION IS TRIED ON THE NETWORK FIRST AND ITS RESPONSE IS NEVER STORED. The page is behind
  // auth and may be a redirect to /login; caching either would pin the app to a stale screen. The
  // only thing a failure produces is the offline page.
  if (request.mode === 'navigate') {
    event.respondWith(fetch(request).catch(() => caches.match('/offline')));
    return;
  }

  // The build's own assets are content-hashed, so a cached entry can never be the wrong version of
  // itself — the filename changes when the bytes do. Cache-first is safe here and nowhere else.
  if (url.pathname.startsWith('/_next/static/') || SHELL.includes(url.pathname)) {
    event.respondWith(
      caches.match(request).then((hit) => hit ?? fetch(request).then((response) => {
        // Only a clean 200 is worth keeping. An opaque or errored response cached here would be
        // served forever in place of the asset it failed to be.
        if (response.ok && response.status === 200) {
          const copy = response.clone();
          caches.open(VERSION).then((cache) => cache.put(request, copy));
        }
        return response;
      }))
    );
  }

  // Everything else: untouched, straight to the network.
});

// ─── The daily ping (§5 step 25, delivered over Web Push for §5 step 26b) ─────────────────────
//
// THE TEXT IS A CONSTANT HERE, AND THAT IS THE DESIGN. `lib/domain/pushPing.ts` holds the same two
// strings on the server and explains why they are a constant rather than a template: a function
// taking the category or the amount would be one edit away from putting a figure on a lock screen.
// Because the text lives in the worker, the push itself carries NO PAYLOAD — so there is nothing to
// encrypt, nothing to leak in transit, and no `p256dh`/`auth` stored anywhere.
//
// Duplicated between the worker and the server ON PURPOSE, which is the one place this repo accepts
// a second copy of a string: a service worker cannot import from the app, and the alternative —
// sending the text — is the thing the owner's DECISION forbids.
const PING = { title: 'b8', body: 'Something needs you. Open to see.' };

self.addEventListener('push', (event) => {
  // `waitUntil` because the worker may be terminated the moment this handler returns, and a
  // notification that has not been shown yet dies with it.
  event.waitUntil(self.registration.showNotification(PING.title, {
    body: PING.body,
    icon: '/icon-192.png',
    badge: '/icon-192.png',
    // One notification, replaced rather than stacked. Two mornings without opening the app should
    // leave one ping saying something needs you, not a pile saying it twice.
    tag: 'b8-daily',
    renotify: true,
  }));
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  // Focus an open window if there is one rather than opening a second copy of the app — an
  // installed PWA tapped from a notification should return to where the reader was.
  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((windows) => {
      for (const client of windows) {
        if ('focus' in client) return client.focus();
      }
      return self.clients.openWindow('/dashboard');
    })
  );
});
