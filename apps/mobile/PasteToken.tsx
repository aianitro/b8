// Getting a credential onto this phone.
//
// TWO WAYS, AND THE FIRST IS THE REAL ONE. "Link with passkey" opens Safari inside the tailnet, runs
// the passkey ceremony that has worked since 2026-09-17, and comes back with a 30-day sliding DEVICE
// session — nothing typed, nothing pasted, and a lost phone is one revocation on the server.
//
// Pasting a personal token minted over SSH is kept as a fallback, not deleted: it is what works when
// the passkey is unavailable — a new phone, a browser that will not cooperate — and it costs one
// collapsed section. It is second because it is the worse credential: minted by hand, revoked by
// hand, and 30 days of standing access with no ceremony behind it.

import { useState } from 'react';
import {
  ActivityIndicator, KeyboardAvoidingView, Platform, Pressable,
  ScrollView, StyleSheet, Text, TextInput, View,
} from 'react-native';
import { verifyToken } from './lib/api';
import { writeToken } from './lib/config';
import { linkThisPhone } from './lib/link';

export default function PasteToken({ onSaved }: { onSaved: () => void }) {
  const [value, setValue] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [checking, setChecking] = useState(false);
  const [linking, setLinking] = useState(false);
  const [showPaste, setShowPaste] = useState(false);

  async function linkWithPasskey() {
    setLinking(true);
    setError(null);
    const result = await linkThisPhone();
    setLinking(false);
    if (result.state === 'linked') { onSaved(); return; }
    // A cancel is not an error — the owner closed the sheet. Saying "failed" to a deliberate
    // dismissal is how an app teaches people to distrust its messages.
    if (result.state === 'failed') setError(result.why);
  }

  async function save() {
    const token = value.trim();
    if (!token) return;
    setChecking(true);
    setError(null);
    try {
      // VERIFIED BEFORE IT IS STORED. A token written to the keychain unchecked turns a typo into
      // an empty screen later, and the keychain is the last place anyone thinks to look.
      await verifyToken(token);
      await writeToken(token, 'pasted');
      onSaved();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not verify that token.');
    } finally {
      setChecking(false);
    }
  }

  return (
    <KeyboardAvoidingView
      style={styles.screen}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
        <Text style={styles.heading}>Connect this phone</Text>
        <Text style={styles.body}>
          Sign in with your passkey and this phone gets a 30-day session of its own. Nothing is typed
          or pasted, and losing the phone is one revocation on the server.
        </Text>

        <Pressable
          style={[styles.button, linking && styles.buttonDisabled]}
          onPress={linkWithPasskey}
          disabled={linking || checking}
        >
          {linking
            ? <ActivityIndicator color="#fff" />
            : <Text style={styles.buttonText}>Link with passkey</Text>}
        </Pressable>

        {error && <Text style={styles.error}>{error}</Text>}

        <Pressable style={styles.toggle} onPress={() => setShowPaste((v) => !v)}>
          <Text style={styles.toggleText}>
            {showPaste ? 'Hide the token option' : 'Paste a token instead'}
          </Text>
        </Pressable>

        {showPaste && (
        <>
        <Text style={styles.fallbackNote}>
          For when the passkey is unavailable. Mint one on the server over SSH:
        </Text>
        <Text style={styles.code}>npm run tokens -- create &quot;iphone&quot; --days 30</Text>
        <TextInput
          style={styles.input}
          value={value}
          onChangeText={setValue}
          placeholder="Paste the token"
          placeholderTextColor="#9ca3af"
          autoCapitalize="none"
          autoCorrect={false}
          spellCheck={false}
          multiline
          editable={!checking}
        />

        <Pressable
          style={[styles.secondary, (!value.trim() || checking) && styles.buttonDisabled]}
          onPress={save}
          disabled={!value.trim() || checking}
        >
          {checking
            ? <ActivityIndicator color="#374151" />
            : <Text style={styles.secondaryText}>Check and save</Text>}
        </Pressable>
        </>
        )}

        <Text style={styles.footnote}>
          A passkey session is revocable, slides on use, and traces back to the ceremony that
          authorised it. A pasted token does none of those things.
        </Text>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: '#fff' },
  content: { padding: 20, paddingTop: 72 },
  heading: { fontSize: 24, fontWeight: '700', color: '#111827', marginBottom: 10 },
  body: { fontSize: 15, color: '#4b5563', lineHeight: 22, marginBottom: 14 },
  code: {
    fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace',
    fontSize: 12, color: '#374151', backgroundColor: '#f3f4f6',
    padding: 12, borderRadius: 8, marginBottom: 24, overflow: 'hidden',
  },
  input: {
    borderWidth: 1, borderColor: '#d1d5db', borderRadius: 8, padding: 14,
    fontSize: 14, minHeight: 92, color: '#111827', textAlignVertical: 'top',
    fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace',
  },
  error: { color: '#dc2626', fontSize: 14, marginTop: 12, lineHeight: 20 },
  button: {
    marginTop: 18, backgroundColor: '#2563eb', borderRadius: 8,
    paddingVertical: 15, alignItems: 'center',
  },
  buttonDisabled: { opacity: 0.45 },
  buttonText: { color: '#fff', fontSize: 16, fontWeight: '600' },
  footnote: { fontSize: 12, color: '#9ca3af', marginTop: 28, lineHeight: 18 },
  toggle: { marginTop: 22, alignSelf: 'flex-start' },
  toggleText: { fontSize: 14, color: '#2563eb' },
  fallbackNote: { fontSize: 13, color: '#6b7280', marginTop: 14, marginBottom: 8, lineHeight: 19 },
  secondary: { marginTop: 12, backgroundColor: '#e5e7eb', borderRadius: 8, paddingVertical: 13, alignItems: 'center' },
  secondaryText: { color: '#374151', fontSize: 15, fontWeight: '600' },
});
