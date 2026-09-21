// Getting a credential onto the phone, until passkey enrolment exists.
//
// DELIBERATELY TEMPORARY, and it should be deleted rather than grown. Step 23 asks for native
// passkeys; this is the thing that makes the app usable this evening instead of after that work.
// It is also honest about what it is — a token pasted by hand is a worse credential story than a
// passkey, and the screen says so rather than pretending to be a sign-in.

import { useState } from 'react';
import {
  ActivityIndicator, KeyboardAvoidingView, Platform, Pressable,
  ScrollView, StyleSheet, Text, TextInput, View,
} from 'react-native';
import { verifyToken } from './lib/api';
import { writeToken } from './lib/config';

export default function PasteToken({ onSaved }: { onSaved: () => void }) {
  const [value, setValue] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [checking, setChecking] = useState(false);

  async function save() {
    const token = value.trim();
    if (!token) return;
    setChecking(true);
    setError(null);
    try {
      // VERIFIED BEFORE IT IS STORED. A token written to the keychain unchecked turns a typo into
      // an empty screen later, and the keychain is the last place anyone thinks to look.
      await verifyToken(token);
      await writeToken(token);
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
          Mint a token on the server and paste it here. It is stored in this phone&apos;s keychain and
          never leaves it.
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

        {error && <Text style={styles.error}>{error}</Text>}

        <Pressable
          style={[styles.button, (!value.trim() || checking) && styles.buttonDisabled]}
          onPress={save}
          disabled={!value.trim() || checking}
        >
          {checking
            ? <ActivityIndicator color="#fff" />
            : <Text style={styles.buttonText}>Check and save</Text>}
        </Pressable>

        <Text style={styles.footnote}>
          Temporary. Step 23 replaces this with a passkey, which is a better credential than anything
          you can paste — this exists so the app is useful before that lands.
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
});
