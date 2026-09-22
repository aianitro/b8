// Which credential this phone holds, and how to change it.
//
// EXISTS BECAUSE THE LINK FLOW WAS UNREACHABLE. `PasteToken` only renders when there is no token at
// all, so a phone already signed in with a pasted one had no way to reach "link with passkey" — the
// feature was built and invisible. Found by the owner asking where the screen was, which is the
// only way that class of gap gets found.

import { useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { clearToken, readKind } from './lib/config';
import { linkThisPhone } from './lib/link';

export default function DeviceCard() {
  const queryClient = useQueryClient();
  const { data: kind } = useQuery({ queryKey: ['credentialKind'], queryFn: readKind, staleTime: Infinity });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function link() {
    setBusy(true);
    setError(null);
    const result = await linkThisPhone();
    setBusy(false);
    if (result.state === 'linked') {
      // Both: the credential changed, and everything it authorises must be re-fetched rather than
      // served from a cache filled under the old one.
      await queryClient.invalidateQueries({ queryKey: ['credentialKind'] });
      await queryClient.invalidateQueries({ queryKey: ['token'] });
      await queryClient.invalidateQueries({ queryKey: ['overview'] });
    } else if (result.state === 'failed') {
      setError(result.why);
    }
  }

  async function signOut() {
    await clearToken();
    await queryClient.invalidateQueries({ queryKey: ['token'] });
    await queryClient.invalidateQueries({ queryKey: ['credentialKind'] });
  }

  const onPasskey = kind === 'passkey';

  return (
    <View style={styles.box}>
      <Text style={styles.title}>This phone</Text>
      <Text style={styles.body}>
        {onPasskey
          ? 'Signed in with your passkey — a 30-day session that slides on use and is revocable on the server.'
          : kind === 'pasted'
            ? 'Signed in with a token pasted by hand. A passkey session is better: it slides on use, traces back to the ceremony that authorised it, and does not need SSH to replace.'
            : 'Signed in.'}
      </Text>

      {error && <Text style={styles.warn}>{error}</Text>}

      {!onPasskey && (
        <Pressable style={[styles.button, busy && styles.disabled]} onPress={link} disabled={busy}>
          {busy
            ? <ActivityIndicator color="#fff" />
            : <Text style={styles.buttonText}>Link with passkey</Text>}
        </Pressable>
      )}

      <Pressable style={styles.signOut} onPress={signOut} disabled={busy}>
        <Text style={styles.signOutText}>Sign this phone out</Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  box: { marginTop: 16, padding: 16, backgroundColor: '#f9fafb', borderRadius: 10 },
  title: { fontSize: 15, fontWeight: '700', color: '#111827', marginBottom: 6 },
  body: { fontSize: 13, color: '#6b7280', lineHeight: 19 },
  warn: { fontSize: 13, color: '#d97706', marginTop: 10, lineHeight: 19 },
  button: { marginTop: 14, backgroundColor: '#2563eb', borderRadius: 8, paddingVertical: 12, alignItems: 'center' },
  buttonText: { color: '#fff', fontSize: 15, fontWeight: '600' },
  disabled: { opacity: 0.6 },
  signOut: { marginTop: 14, alignSelf: 'flex-start' },
  signOutText: { fontSize: 14, color: '#dc2626' },
});
