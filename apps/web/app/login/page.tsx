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

import { useState } from 'react';
import { startAuthentication, startRegistration } from '@simplewebauthn/browser';

/** Where a successful ceremony lands. The dashboard is the app's home surface. */
const AFTER_SIGN_IN = '/dashboard';

type Ceremony = 'login' | 'register';

/**
 * One ceremony: ask for options, run it in the authenticator, post the response back.
 *
 * Throws with the server's message on any error branch. The envelope is the same
 * `{ success, data | error }` every handler in this app returns, so both steps are read the same
 * way — and a failed ceremony is always the ERROR branch, never a success envelope carrying a
 * negative result, which is what `CeremonyVerifiedResponseSchema` exists to make impossible.
 */
async function runCeremony(ceremony: Ceremony): Promise<void> {
  const optionsResponse = await fetch(`/api/v1/auth/${ceremony}/options`, { method: 'POST' });
  const optionsBody = await optionsResponse.json();
  if (!optionsBody.success) throw new Error(optionsBody.error.message);

  const ceremonyResponse =
    ceremony === 'register'
      ? await startRegistration({ optionsJSON: optionsBody.data })
      : await startAuthentication({ optionsJSON: optionsBody.data });

  const verifyResponse = await fetch(`/api/v1/auth/${ceremony}/verify`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(ceremonyResponse),
  });
  const verifyBody = await verifyResponse.json();
  if (!verifyBody.success) throw new Error(verifyBody.error.message);
}

export default function LoginPage() {
  const [busy, setBusy] = useState<Ceremony | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function attempt(ceremony: Ceremony) {
    setBusy(ceremony);
    setError(null);
    try {
      await runCeremony(ceremony);
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

  return (
    <main className="flex min-h-full items-center justify-center p-8">
      <div className="w-full max-w-sm rounded-xl border border-slate-200 bg-white p-6 shadow-sm">
        <h1 className="text-lg font-semibold text-slate-900">B8 Finance</h1>
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
      </div>
    </main>
  );
}
