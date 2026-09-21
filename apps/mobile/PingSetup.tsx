// Turning the ping on, deliberately.
//
// WHY THIS IS A BUTTON AND NOT AUTOMATIC: iOS asks for notification permission ONCE and remembers
// the answer forever. A denial cannot be re-asked from inside the app — only in Settings — so an app
// that prompts on first launch, before it has shown why, spends its one chance and loses the feature
// to whoever never finds the Settings screen.
//
// It also states what will arrive. The owner decided on a content-free ping
// (`plan/tasks/P3-25-push-ping/DECISION.md`) and the text below is the reason repeated back, so the
// screen and the decision cannot drift apart silently.

import { useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';
import { registerForPing, type PushStatus } from './lib/push';

export default function PingSetup() {
  const [status, setStatus] = useState<PushStatus | null>(null);
  const [busy, setBusy] = useState(false);

  async function turnOn() {
    setBusy(true);
    setStatus(await registerForPing('iphone'));
    setBusy(false);
  }

  if (status?.state === 'registered') {
    return (
      <View style={styles.box}>
        <Text style={styles.done}>Pings on. You will be nudged when something needs you.</Text>
      </View>
    );
  }

  return (
    <View style={styles.box}>
      <Text style={styles.title}>Get nudged</Text>
      <Text style={styles.body}>
        A notification that says only “Something needs you” — no amounts, no categories. Nothing about
        your money leaves the house; open the app and it loads over your own network.
      </Text>

      {status?.state === 'denied' && (
        <Text style={styles.warn}>
          Notifications are off for b8. iOS only asks once — turn them on in Settings › Notifications › Expo Go.
        </Text>
      )}
      {status?.state === 'unsupported' && <Text style={styles.warn}>{status.why}</Text>}
      {status?.state === 'failed' && <Text style={styles.warn}>{status.why}</Text>}

      <Pressable style={[styles.button, busy && styles.buttonBusy]} onPress={turnOn} disabled={busy}>
        {busy ? <ActivityIndicator color="#fff" /> : <Text style={styles.buttonText}>Turn on pings</Text>}
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  box: { marginTop: 32, padding: 16, backgroundColor: '#f9fafb', borderRadius: 10 },
  title: { fontSize: 15, fontWeight: '700', color: '#111827', marginBottom: 6 },
  body: { fontSize: 13, color: '#6b7280', lineHeight: 19 },
  warn: { fontSize: 13, color: '#d97706', marginTop: 10, lineHeight: 19 },
  done: { fontSize: 13, color: '#16a34a', lineHeight: 19 },
  button: { marginTop: 14, backgroundColor: '#2563eb', borderRadius: 8, paddingVertical: 12, alignItems: 'center' },
  buttonBusy: { opacity: 0.6 },
  buttonText: { color: '#fff', fontSize: 15, fontWeight: '600' },
});
