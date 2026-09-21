// Where the app is, and how it proves who it is.
//
// The base URL is the tailnet HTTPS name, and it must be HTTPS even on a private network: passkeys
// require a secure context, so `http://100.x.y.z:3000` cannot complete a WebAuthn ceremony. That is
// the same constraint `apps/web/lib/webauthnOrigins.ts` enforces server-side, arrived at the hard
// way in Phase 2 — see docs/DEPLOY.md.
import * as SecureStore from 'expo-secure-store';

const TOKEN_KEY = 'b8.device.token';

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

export async function writeToken(token: string): Promise<void> {
  await SecureStore.setItemAsync(TOKEN_KEY, token);
}

export async function clearToken(): Promise<void> {
  await SecureStore.deleteItemAsync(TOKEN_KEY);
}
