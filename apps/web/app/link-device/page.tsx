'use client';

// `/link-device` — the browser half of getting a real credential onto the phone.
//
// THE FLOW AND WHY IT HAS THIS SHAPE. `mayIssueDeviceToken` refuses to hand a device token to
// anything carrying `Sec-Fetch-*` headers, so a browser cannot receive one; and iOS passkeys are
// domain-bound with Apple's CDN validating the association, which it cannot do for a tailnet-only
// host — so the app cannot run the ceremony either. This page is the bridge: Safari does the passkey
// (which works, and has since 2026-09-17), mints a one-minute single-use code, and redirects into the
// app, which exchanges the code from outside a browser where it is allowed to.
//
// The code travels in a redirect URL, which is acceptable only because it is single-use and dead in
// sixty seconds — a bearer token there would not be. `lib/domain/deviceHandoff.ts` allowlists the
// redirect SCHEME, because an open redirect carrying a secret is the OAuth vulnerability.

import { useState } from 'react';
import { startAuthentication } from '@simplewebauthn/browser';

async function signIn(): Promise<void> {
  const optionsResponse = await fetch('/api/v1/auth/login/options', { method: 'POST' });
  const optionsBody = await optionsResponse.json();
  if (!optionsBody.success) throw new Error(optionsBody.error.message);

  const ceremony = await startAuthentication({ optionsJSON: optionsBody.data });

  const verifyResponse = await fetch('/api/v1/auth/login/verify', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(ceremony),
  });
  const verifyBody = await verifyResponse.json();
  if (!verifyBody.success) throw new Error(verifyBody.error.message);
}

async function mintCode(): Promise<string> {
  const response = await fetch('/api/v1/auth/device-handoff', { method: 'POST' });
  const body = await response.json();
  if (!body.success) throw new Error(body.error.message);
  return body.data.code as string;
}

export default function LinkDevicePage() {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  async function link() {
    setBusy(true);
    setError(null);
    try {
      // The redirect target comes from the app and is validated SERVER-SIDE on the way in; read here
      // only to navigate. Reading it from the query rather than hardcoding `b8://` is what lets Expo
      // Go work, where the scheme is `exp://` and carries the dev server's address.
      const target = new URLSearchParams(window.location.search).get('redirect');
      if (!target) throw new Error('Open this page from the app, not directly.');

      // Sign in if this browser is not already signed in. A ceremony on an already-signed-in browser
      // is harmless — it opens a second session — but asking for Face ID when it is not needed trains
      // people to approve prompts without reading them.
      const probe = await fetch('/api/v1/auth/device-handoff', { method: 'POST' });
      const code = probe.ok
        ? ((await probe.json()).data.code as string)
        : await signIn().then(mintCode);

      setDone(true);
      window.location.href = `${target}${target.includes('?') ? '&' : '?'}code=${encodeURIComponent(code)}`;
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'That did not work. Try again.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="flex min-h-full items-center justify-center p-8">
      <div className="w-full max-w-sm rounded-xl border border-slate-200 bg-white p-6 shadow-sm">
        <h1 className="text-lg font-semibold text-slate-900">Link this phone</h1>
        <p className="mt-2 text-sm leading-relaxed text-slate-600">
          Sign in with your passkey and the app gets a 30-day session of its own. Nothing is typed or
          pasted, and losing the phone is one revocation on the server.
        </p>

        {error && <p className="mt-4 text-sm text-red-600">{error}</p>}
        {done && <p className="mt-4 text-sm text-green-600">Linked. Returning to the app…</p>}

        <button
          type="button"
          onClick={link}
          disabled={busy || done}
          className="mt-5 w-full rounded bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50"
        >
          {busy ? 'Waiting for your passkey…' : 'Link with passkey'}
        </button>
      </div>
    </main>
  );
}
