'use client';

// `/login` — the one page an unauthenticated visitor may reach, and the smallest thing that can run
// a WebAuthn ceremony.
//
// MINIMAL IS THE SPEC, not an apology: SPEC.md's non-goals rule out any UI adoption beyond this
// page, and a login screen that grew a layout of its own would be the start of one. It follows the
// palette of the shell it renders inside — `app/layout.tsx` is `bg-slate-50 text-slate-900`, and
// the accounts UI is `slate-*` — so the page reads as part of the app rather than as a bolted-on
// door. The sidebar renders beside it, because the root layout is outside this task's declared
// surface and editing it to hide the nav on one route would be a diff the spec did not ask for.
//
// TWO ACTIONS, BOTH OFFERED, because there is no endpoint that says which one is available.
// SPEC.md's allowlist is exactly five surfaces and negative control #12 asserts it is neither empty
// nor total, so a sixth "is registration open?" endpoint would contradict a frozen spec — and it
// would publish "this deployment has no owner yet" to anyone who asks. The page tries, and renders
// `REGISTRATION_CLOSED` when the server says so.
//
// THE CEREMONY IS `@simplewebauthn/browser`'s, not hand-rolled. SPEC.md's failure list names
// "base64url versus base64, padded versus unpadded, in credential-id round-tripping" as a classic
// bug a hand-rolled encoding step reintroduces easily — and a browser ceremony is exactly a pile of
// `ArrayBuffer`-to-base64url conversions. Using the companion package to the server library this
// task already depends on removes that step rather than reimplementing it carefully.

// THE INVITATION MODE (P7-41a2). A link the owner minted, `/login#invite=<code>`, opens this page
// with the code in the FRAGMENT — see `lib/invitationLink.ts` for why it is never the query. The
// page reads it after hydration, rewrites the address bar without it straight away, and keeps
// it only in component state; a reload therefore loses it, and the stated trade-off is that the
// owner mints another rather than the page writing a bearer secret anywhere that outlives the tab.
// No endpoint tells this page whether a code is live or whose it is, by design, so the page shows no
// name and decides nothing about expiry: it runs the ordinary registration ceremony with the code
// presented on both requests, and shows the server's answer.

import { useEffect, useState } from 'react';
import { startAuthentication, startRegistration } from '@simplewebauthn/browser';
import { readInvitationFragment, type InvitationFragment } from '@/lib/invitationFragment';
import { withoutFragment } from '@/lib/invitationLink';
import { runCeremony, type Ceremony, type CeremonyCollaborators } from '@/lib/passkeyCeremony';

/** Where a successful ceremony lands. The dashboard is the app's home surface. */
const AFTER_SIGN_IN = '/dashboard';

/**
 * The real collaborators. `fetch` is wrapped rather than passed bare so it is always invoked as the
 * global function, never as a method of this object.
 */
const BROWSER: CeremonyCollaborators = {
  fetch: (input, init) => fetch(input, init),
  startRegistration,
  startAuthentication,
};

/** The refusal for a link whose fragment holds no readable code. Sends nothing, so it is the page's own. */
const UNREADABLE_LINK = 'This invitation link cannot be read. Ask for a new one.';

export default function LoginPage() {
  const [busy, setBusy] = useState<Ceremony | null>(null);
  const [error, setError] = useState<string | null>(null);
  // `none` until the fragment has been read, which is also what an ordinary `/login` stays.
  const [invitation, setInvitation] = useState<InvitationFragment>({ kind: 'none' });

  // READ AFTER HYDRATION, NOT DURING RENDER. The server renders this page with no `window` and never
  // sees a fragment, so a render-time read would either crash there or make the first client render
  // disagree with the server's HTML. An effect runs once the page is live in the browser.
  //
  // `hashchange` as well as the first read, because a fragment can also arrive without a load: a
  // link pasted into a tab that is already on `/login` is a same-document navigation, and a read
  // done once at module load or mount would miss it and leave the code in the address bar.
  //
  // THE SCRUB IS `replaceState`, NOT `pushState` OR AN ASSIGNMENT, so the entry holding the code is
  // overwritten rather than left one Back press away. Next's router integrates with the native call
  // (its linking guide passes `null` as the state, and so does this). Only a fragment that carried an
  // `invite` key is scrubbed: an ordinary `/login` is left exactly as it was.
  useEffect(() => {
    function take() {
      const found = readInvitationFragment(window.location.hash);
      if (found.kind === 'none') return;
      window.history.replaceState(null, '', withoutFragment(window.location.pathname + window.location.search));
      setInvitation(found);
      setError(null);
    }
    take();
    window.addEventListener('hashchange', take);
    return () => window.removeEventListener('hashchange', take);
  }, []);

  const code = invitation.kind === 'invitation' ? invitation.code : null;

  async function attempt(ceremony: Ceremony) {
    setBusy(ceremony);
    setError(null);
    try {
      // The code goes only to a REGISTRATION, and `runCeremony` enforces that as well; an unreadable
      // link never reaches here, because its mode renders no button that could start one.
      await runCeremony(ceremony, BROWSER, ceremony === 'register' ? code : null);
      // A FULL NAVIGATION, and this time actually one.
      //
      // This was `router.push()` followed by `router.refresh()`, under a comment claiming it was a
      // full navigation. It is not: Next's own reference says `push` performs a CLIENT-SIDE
      // navigation, and that is what made signing in fail on the first try for days.
      //
      // The sequence: opening the app requests /dashboard, the boundary answers 307 to /login, and
      // the client router caches that result for the route. The passkey ceremony then succeeds —
      // the server logged "session opened" every single time, three to five times per burst — and
      // `push` serves the CACHED redirect straight back to /login. The session was valid the whole
      // time and the browser never asked for the page with it. Retrying worked only once the cache
      // entry went stale, which is why the bursts in the log span about thirty seconds.
      //
      // `location.assign` is the fix and not a workaround: it discards every client cache and makes
      // a fresh HTTP request carrying the cookie that was just set. A sign-in is the one navigation
      // that must not be served from anything remembered from before it.
      window.location.assign(AFTER_SIGN_IN);
      // Deliberately no `router.refresh()`. The line above ends this document; anything after it is
      // a race against the browser tearing the page down.
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'That did not work. Try again.');
    } finally {
      setBusy(null);
    }
  }

  // ORDINARY `/login` IS THE UNCHANGED BRANCH: the same two buttons, the same text, the same
  // classes. The invitation modes replace the card's contents rather than adding to them, so nothing
  // about the ordinary page moved to make room.
  return (
    <main className="flex min-h-full items-center justify-center p-8">
      <div className="w-full max-w-sm rounded-xl border border-slate-200 bg-white p-6 shadow-sm">
        <h1 className="text-lg font-semibold text-slate-900">B8 Finance</h1>

        {invitation.kind === 'invalid' && (
          <>
            <p className="mt-4 rounded-lg bg-rose-50 px-3 py-2 text-sm text-rose-700" role="alert">
              {UNREADABLE_LINK}
            </p>
            {/* A plain link, so the ordinary page loads fresh rather than inheriting this state. */}
            <a href="/login" className="mt-4 block text-sm font-medium text-slate-700 underline">
              Go to sign in
            </a>
          </>
        )}

        {invitation.kind === 'invitation' && (
          <>
            <p className="mt-1 text-sm text-slate-500">
              You have been invited to this app. Register a passkey on this device to join.
            </p>

            <button
              type="button"
              onClick={() => attempt('register')}
              disabled={busy !== null}
              data-invitation-register
              className="mt-6 w-full rounded-lg bg-slate-900 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-slate-700 disabled:opacity-50"
            >
              {busy === 'register' ? 'Waiting for your passkey…' : 'Join with a passkey on this device'}
            </button>

            {error && (
              <p className="mt-4 rounded-lg bg-rose-50 px-3 py-2 text-sm text-rose-700" role="alert">
                {error}
              </p>
            )}

            <p className="mt-4 text-xs text-slate-400">
              An invitation works once, and only on a device that is not already signed in. If this
              one has been used or has expired, ask for a new link.
            </p>
          </>
        )}

        {invitation.kind === 'none' && (
          <>
            <p className="mt-1 text-sm text-slate-500">
              This app is reachable only with a passkey on this device.
            </p>

            <button
              type="button"
              onClick={() => attempt('login')}
              disabled={busy !== null}
              className="mt-6 w-full rounded-lg bg-slate-900 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-slate-700 disabled:opacity-50"
            >
              {busy === 'login' ? 'Waiting for your passkey…' : 'Sign in with a passkey'}
            </button>

            <button
              type="button"
              onClick={() => attempt('register')}
              disabled={busy !== null}
              className="mt-3 w-full rounded-lg border border-slate-300 px-4 py-2 text-sm font-medium text-slate-700 transition-colors hover:bg-slate-50 disabled:opacity-50"
            >
              {busy === 'register' ? 'Waiting for your passkey…' : 'Register this device'}
            </button>

            {error && (
              <p className="mt-4 rounded-lg bg-rose-50 px-3 py-2 text-sm text-rose-700" role="alert">
                {error}
              </p>
            )}

            <p className="mt-4 text-xs text-slate-400">
              Registering a device only works before the first passkey is enrolled, or while you are
              already signed in on another one.
            </p>
          </>
        )}
      </div>
    </main>
  );
}
