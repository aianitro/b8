// Getting a real credential onto this phone, using the passkey that already works.
//
// WHY IT GOES THROUGH A BROWSER AND NOT A NATIVE CEREMONY. iOS passkeys are domain-bound: a native
// app must declare an associated domain, and Apple validates it by fetching
// `/.well-known/apple-app-site-association` through its own CDN — which cannot reach a tailnet-only
// host. Safari, already inside the tailnet, has no such problem, and has been completing this
// ceremony since 2026-09-17.
//
// The server's half refuses to hand a device token to a browser (`mayIssueDeviceToken` checks for
// absent `Sec-Fetch-*` headers), which is why this is a handoff rather than a redirect carrying a
// token: the browser earns a one-minute single-use code, and the app exchanges it from outside a
// browser, where it is allowed to.

import * as Linking from 'expo-linking';
import * as WebBrowser from 'expo-web-browser';
import { ApiError, claimDeviceSession } from './api';
import { BASE_URL, writeToken } from './config';

export type LinkResult =
  | { state: 'linked'; expiresAt: string }
  | { state: 'cancelled' }
  | { state: 'failed'; why: string };

/**
 * Open the browser, run the ceremony, come back with a session.
 *
 * `Linking.createURL` rather than a hardcoded `b8://`: in Expo Go the app has no custom scheme of its
 * own and is addressed as `exp://<dev server>/--/auth`, so hardcoding would work only in a standalone
 * build. The server allowlists both schemes and nothing else — an open redirect carrying a secret is
 * the OAuth vulnerability, and this code travels in a URL.
 */
export async function linkThisPhone(): Promise<LinkResult> {
  if (!BASE_URL) return { state: 'failed', why: 'EXPO_PUBLIC_B8_BASE_URL is not set.' };

  const redirect = Linking.createURL('auth');
  const url = `${BASE_URL}/link-device?redirect=${encodeURIComponent(redirect)}`;

  // `openAuthSessionAsync`, not `openBrowserAsync`: it knows to close itself when the page navigates
  // to the redirect URI, and hands that URI back. On iOS it also uses an ephemeral session, so the
  // ceremony does not leave a Safari cookie behind on a phone that may be shared.
  const result = await WebBrowser.openAuthSessionAsync(url, redirect);

  if (result.type !== 'success') {
    return result.type === 'cancel' || result.type === 'dismiss'
      ? { state: 'cancelled' }
      : { state: 'failed', why: 'The browser closed without linking.' };
  }

  const code = new URL(result.url).searchParams.get('code');
  if (!code) return { state: 'failed', why: 'The browser came back without a link code.' };

  try {
    const session = await claimDeviceSession(code);
    await writeToken(session.token, 'passkey');
    return { state: 'linked', expiresAt: session.expiresAt };
  } catch (e) {
    return {
      state: 'failed',
      why: e instanceof ApiError ? e.message : 'Could not exchange the link code.',
    };
  }
}
