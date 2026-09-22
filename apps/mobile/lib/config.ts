// Where the app is, and how it proves who it is.
//
// The base URL is the tailnet HTTPS name, and it must be HTTPS even on a private network: passkeys
// require a secure context, so `http://100.x.y.z:3000` cannot complete a WebAuthn ceremony. That is
// the same constraint `apps/web/lib/webauthnOrigins.ts` enforces server-side, arrived at the hard
// way in Phase 2 — see docs/DEPLOY.md.
import * as SecureStore from 'expo-secure-store';

const TOKEN_KEY = 'b8.device.token';

/**
 * How the credential was obtained, stored beside it.
 *
 * The token itself does not say, and the server has no "whoami" endpoint — so rather than add one
 * for a cosmetic label, the app records what it did when it wrote the token. It is only ever used to
 * tell the owner which kind they are on, and to nudge from the weaker one to the better one.
 */
const KIND_KEY = 'b8.device.kind';

export type CredentialKind = 'passkey' | 'pasted';

export const BASE_URL = process.env.EXPO_PUBLIC_B8_BASE_URL ?? '';

/**
 * The device session token, kept in the OS keychain rather than AsyncStorage.
 *
 * `P1-12a` issues this as a DEVICE session: 30 days, sliding from last use, so an app in daily use
 * never signs out, and revocable server-side with one UPDATE if the phone is lost.
 */
export async function readToken(): Promise<string | null> {
  return SecureStore.getItemAsync(TOKEN_KEY);
}

export async function writeToken(token: string, kind: CredentialKind): Promise<void> {
  await SecureStore.setItemAsync(TOKEN_KEY, token);
  await SecureStore.setItemAsync(KIND_KEY, kind);
}

export async function readKind(): Promise<CredentialKind | null> {
  const value = await SecureStore.getItemAsync(KIND_KEY);
  return value === 'passkey' || value === 'pasted' ? value : null;
}

export async function clearToken(): Promise<void> {
  await SecureStore.deleteItemAsync(TOKEN_KEY);
  await SecureStore.deleteItemAsync(KIND_KEY);
}
