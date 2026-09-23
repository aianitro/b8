import type { Metadata } from 'next';

export const metadata: Metadata = { title: 'Offline · B8' };

/**
 * What the installed app shows when the tailnet is not reachable — §5 step 26b.
 *
 * STATIC AND EMPTY OF DATA, necessarily: it is precached by the service worker, so anything it
 * rendered would be frozen at the moment of that install. It says what happened and nothing else.
 *
 * The wording avoids blaming the network. The usual cause here is not a dead connection but a
 * device that has dropped off Tailscale — a phone on a hotel's captive wi-fi has internet and no
 * route to this server — and "check your connection" sends the reader to look at the wrong thing.
 */
export default function Offline() {
  return (
    <div className="min-h-dvh flex items-center justify-center p-8">
      <div className="max-w-sm text-center">
        <div className="mx-auto w-14 h-14 rounded-2xl bg-slate-900 flex items-center justify-center">
          <span className="text-white font-bold text-lg">b8</span>
        </div>
        <h1 className="mt-6 text-lg font-semibold text-slate-900">Can&apos;t reach the server</h1>
        <p className="mt-2 text-sm text-slate-500 leading-relaxed">
          Your figures live on the home server and this device cannot see it right now. That is
          usually Tailscale rather than the internet — check it is connected, then try again.
        </p>
        <p className="mt-6 text-xs text-slate-400">
          Nothing is cached on this device, so there is nothing to show until it reconnects.
        </p>
      </div>
    </div>
  );
}
