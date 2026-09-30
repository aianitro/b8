'use client';

import { useEffect, useState } from 'react';
import { Bell, BellOff } from 'lucide-react';

/**
 * Turning the daily ping on for an installed PWA — §5 step 26b.
 *
 * ─── iOS WILL ONLY DO THIS FROM THE HOME SCREEN ──────────────────────────────────────────────
 *
 * Safari supports Web Push only for a PWA that has been ADDED TO THE HOME SCREEN, and only from a
 * user gesture. In a normal Safari tab `Notification.requestPermission` either does not exist or
 * refuses, so this button says what to do about it rather than reporting a failure the reader
 * cannot act on — "not supported" is true and useless.
 *
 * `display-mode: standalone` is how an installed launch is told from a tab, and it is checked at
 * CLICK TIME rather than on render: a component that decides on mount is a component that gets the
 * answer wrong once and keeps it.
 */
export default function PushSetup({ vapidPublicKey }: { vapidPublicKey: string | null }) {
  /**
   * `checking` until the device has been asked, because the honest opening state is "I do not know
   * yet" rather than "off".
   *
   * ─── THIS USED TO START AT `idle` AND ONLY EVER LEARN FROM A CLICK ────────────────────────────
   *
   * So the button remembered nothing. Leave the dashboard, come back, and a device that was already
   * subscribed was offered "Turn on notifications" again — the state lived entirely in this
   * component's lifetime, and nothing ever asked the browser or the server what was actually true.
   * Pressing it again did work, which is why it looked cosmetic rather than like a component that
   * did not know its own subject.
   *
   * `repair` is the state that exists because two systems must agree: the browser holds a
   * subscription AND the server must be willing to push to it. A subscription can exist here while
   * the server never heard of it (the registering POST failed) or has revoked it (a send came back
   * `gone`). Reporting that as "on" would be a lie nothing arriving would explain.
   */
  const [state, setState] = useState<'checking' | 'idle' | 'working' | 'on' | 'repair' | 'error'>('checking');
  const [message, setMessage] = useState<string | null>(null);

  /**
   * Ask what is actually true, once, on mount.
   *
   * `useEffect` rather than `useSyncExternalStore` — which `AlertBell` uses for its DOM read — because
   * this answer is AWAITED: `getSubscription()` is a promise and a subscription's server status is a
   * round trip. There is nothing to read synchronously, so there is no snapshot to give.
   */
  useEffect(() => {
    if (!vapidPublicKey) return;
    let live = true;

    (async () => {
      try {
        if (!('serviceWorker' in navigator) || !('PushManager' in window)) {
          if (live) setState('idle');
          return;
        }
        const registration = await navigator.serviceWorker.ready;
        const subscription = await registration.pushManager.getSubscription();
        if (!live) return;
        if (!subscription) { setState('idle'); return; }

        const res = await fetch('/api/v1/push/web/status', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ endpoint: subscription.endpoint }),
        });
        const body = await res.json().catch(() => null);
        if (!live) return;
        setState(body?.success && body.data.registered ? 'on' : 'repair');
      } catch {
        // A failed check degrades to offering the button, never to claiming either state. Pressing
        // it when already subscribed is harmless — the registration upserts.
        if (live) setState('idle');
      }
    })();

    return () => { live = false; };
  }, [vapidPublicKey]);

  // The server has no VAPID pair, so there is nothing to subscribe to. Said plainly rather than
  // offering a button that cannot work.
  if (!vapidPublicKey) {
    return (
      <p className="text-xs text-slate-400">
        Notifications are not configured on the server.
      </p>
    );
  }

  async function enable() {
    setState('working');
    setMessage(null);
    try {
      if (!('serviceWorker' in navigator) || !('PushManager' in window)) {
        setState('error');
        setMessage(
          window.matchMedia('(display-mode: standalone)').matches
            ? 'This browser cannot do notifications.'
            : 'Add b8 to your Home Screen first — iOS only allows notifications from an installed app.'
        );
        return;
      }

      const permission = await Notification.requestPermission();
      if (permission !== 'granted') {
        setState('error');
        setMessage('Notifications are blocked. Turn them on for b8 in Settings.');
        return;
      }

      const registration = await navigator.serviceWorker.ready;
      const subscription = await registration.pushManager.subscribe({
        // Required, and required to be true: a push that does not show a notification is refused by
        // every browser. This app has no use for a silent one anyway.
        userVisibleOnly: true,
        applicationServerKey: vapidPublicKey,
      });

      const response = await fetch('/api/v1/push/web', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        // The endpoint ONLY. The subscription object also carries the payload-encryption keys and
        // they are deliberately not sent — the server has nowhere to put them and nothing to
        // encrypt. See the migration.
        body: JSON.stringify({ endpoint: subscription.endpoint, label: 'This device' }),
      });
      if (!response.ok) {
        const body = await response.json().catch(() => null);
        setState('error');
        setMessage(body?.error?.message ?? 'Could not register with the server.');
        return;
      }

      setState('on');
    } catch (err) {
      setState('error');
      setMessage(err instanceof Error ? err.message : 'Something went wrong.');
    }
  }

  // Nothing at all while the answer is unknown. A button that appears saying "off" and corrects
  // itself a moment later is worse than a short gap: the reader may press the wrong thing in the
  // window, and the flicker reads as the app changing its mind.
  if (state === 'checking') return null;

  if (state === 'on') {
    return (
      <p className="flex items-center gap-2 text-xs text-green-700">
        <Bell size={14} /> Notifications are on for this device.
      </p>
    );
  }

  return (
    <div>
      <button
        type="button"
        onClick={enable}
        disabled={state === 'working'}
        className="flex items-center gap-2 px-3 py-2 rounded-lg bg-slate-800 text-white text-sm hover:bg-slate-700 disabled:opacity-50"
      >
        <BellOff size={14} />
        {state === 'working' ? 'Asking…' : state === 'repair' ? 'Reconnect notifications' : 'Turn on notifications'}
      </button>
      {/* The repair case says what is wrong, because "turn on" would be misleading: this device IS
          subscribed, and what has gone is the server's side of the arrangement. */}
      {state === 'repair' && !message && (
        <p className="mt-2 text-xs text-amber-700 max-w-xs leading-relaxed">
          This device is set up, but the server is not sending to it. One tap re-registers it.
        </p>
      )}
      {message && <p className="mt-2 text-xs text-amber-700 max-w-xs leading-relaxed">{message}</p>}
      <p className="mt-2 text-xs text-slate-400 max-w-xs leading-relaxed">
        One a day at most, and it carries no figures — just that something needs you.
      </p>
    </div>
  );
}
