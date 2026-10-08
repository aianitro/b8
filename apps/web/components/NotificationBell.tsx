'use client';

import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { createPortal } from 'react-dom';
import { Bell, BellOff } from 'lucide-react';
import { PushControls, usePushSubscription } from './PushSetup';

/**
 * The installed app's notification switch, as a bell in the app bar beside the warning sign.
 *
 * INSTALLED APP ONLY (`standalone:`), and in the phone's app bar. iOS delivers Web Push only to a
 * home-screen app, so the installed app is where this setting means something; a browser tab keeps
 * the control at the foot of the dashboard, as before. Lands in the same `#alert-slot` the warning
 * sign uses, after it — the page renders this right after `AlertBell`.
 *
 * The glyph says the state at a glance: a bell when this device is getting the ping, a struck bell
 * when it is not, with an amber dot when the server has stopped sending to a subscribed device.
 * Tapping opens the same controls the footer has, so turning it on is still one deliberate tap on
 * a labelled button rather than a tap on an icon whose meaning has to be guessed.
 */
export default function NotificationBell({ vapidPublicKey }: { vapidPublicKey: string | null }) {
  const push = usePushSubscription(vapidPublicKey);
  const [open, setOpen] = useState(false);
  const wrapRef = useRef<HTMLDivElement>(null);

  // The app bar's slot, found after hydration — the same read `AlertBell` makes.
  const slot = useSyncExternalStore(
    () => () => {},
    () => document.getElementById('alert-slot'),
    () => null,
  );

  useEffect(() => {
    if (!open) return;
    function onPointerDown(e: MouseEvent) {
      if (!wrapRef.current?.contains(e.target as Node)) setOpen(false);
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') setOpen(false);
    }
    document.addEventListener('mousedown', onPointerDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onPointerDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  if (!slot) return null;

  const on = push.state === 'on';
  const label = on ? 'Notifications on' : 'Notifications off';

  return createPortal(
    <div ref={wrapRef} className="relative hidden standalone:block md:hidden">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        aria-label={label}
        className={`relative p-2 rounded-lg transition-colors ${open ? 'text-white bg-white/15' : 'text-cyan-100 hover:text-white'}`}
      >
        {on ? <Bell size={20} /> : <BellOff size={20} />}
        {/* Subscribed here, but the server is not sending: the one state worth flagging unasked. */}
        {push.state === 'repair' && (
          <span className="absolute top-1 right-1 size-2 rounded-full bg-amber-400 ring-2 ring-cyan-700" />
        )}
      </button>
      {open && (
        <div className="fixed inset-x-4 top-[calc(3.5rem+env(safe-area-inset-top)+0.5rem)] rounded-xl bg-white p-4 shadow-lg ring-1 ring-slate-900/5 z-30">
          <p className="text-xs font-semibold uppercase tracking-wider text-slate-400 mb-3">Notifications</p>
          {/* While the device is still being asked, the footer shows nothing; here that would be an
              empty popover, so it says so instead. */}
          {push.state === 'checking' && vapidPublicKey
            ? <p className="text-xs text-slate-400">Checking this device…</p>
            : <PushControls vapidPublicKey={vapidPublicKey} {...push} />}
        </div>
      )}
    </div>,
    slot
  );
}
