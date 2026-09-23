'use client';

import { useState } from 'react';
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
  const [state, setState] = useState<'idle' | 'working' | 'on' | 'error'>('idle');
  const [message, setMessage] = useState<string | null>(null);

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
        {state === 'working' ? 'Asking…' : 'Turn on notifications'}
      </button>
      {message && <p className="mt-2 text-xs text-amber-700 max-w-xs leading-relaxed">{message}</p>}
      <p className="mt-2 text-xs text-slate-400 max-w-xs leading-relaxed">
        One a day at most, and it carries no figures — just that something needs you.
      </p>
    </div>
  );
}
