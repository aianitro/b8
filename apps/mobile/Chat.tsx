// Screen 3 of four: ask it something.
//
// ROADMAP.md §5 Phase 3 step 24 sizes this as (S) "because the seam is done", and that held: the
// endpoint is stable, rate-limited and ceiling-capped, a device session already authenticates it,
// and step 16's propose/confirm gate already exists on both sides. This screen is the two of them
// put together.

import { useRef, useState } from 'react';
import {
  ActivityIndicator, KeyboardAvoidingView, Platform, Pressable,
  ScrollView, StyleSheet, Text, TextInput, View,
} from 'react-native';
import { askChat, RateLimited, type ChatProposal } from './lib/api';
import ProposalCard from './ProposalCard';

interface Turn {
  role: 'user' | 'assistant';
  content: string;
  proposals?: ChatProposal[];
  /** True when the loop hit MAX_TURNS: the reply is boilerplate, not an answer. */
  gaveUp?: boolean;
}

const SUGGESTIONS = [
  'Am I over on anything this month?',
  'What did I spend on groceries in June?',
  'Show me my largest charges this month',
];

export default function Chat() {
  const [turns, setTurns] = useState<Turn[]>([]);
  const [input, setInput] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const scroll = useRef<ScrollView>(null);

  async function send(text: string) {
    const question = text.trim();
    if (!question || busy) return;

    // The user turn goes in immediately; the request carries the whole history because the endpoint
    // is stateless and holds no thread of its own.
    const next: Turn[] = [...turns, { role: 'user', content: question }];
    setTurns(next);
    setInput('');
    setBusy(true);
    setError(null);

    try {
      const answer = await askChat(next.map((t) => ({ role: t.role, content: t.content })));
      setTurns([...next, {
        role: 'assistant',
        content: answer.reply,
        proposals: answer.proposals,
        gaveUp: answer.stoppedAtMaxTurns,
      }]);
    } catch (e) {
      // THE QUESTION IS KEPT ON SCREEN. Dropping it on failure means retyping, and the most likely
      // failure is a rate limit that clears in seconds.
      setError(
        e instanceof RateLimited
          ? e.message
          : e instanceof Error ? e.message : 'The agent could not answer.'
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <KeyboardAvoidingView
      style={styles.screen}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      keyboardVerticalOffset={Platform.OS === 'ios' ? 88 : 0}
    >
      <ScrollView
        ref={scroll}
        contentContainerStyle={styles.content}
        onContentSizeChange={() => scroll.current?.scrollToEnd({ animated: true })}
        keyboardShouldPersistTaps="handled"
      >
        <Text style={styles.heading}>Ask</Text>

        {turns.length === 0 && (
          <View>
            <Text style={styles.empty}>
              It reads your real data and can suggest a category change — which you confirm, never it.
            </Text>
            {SUGGESTIONS.map((s) => (
              <Pressable key={s} style={styles.suggestion} onPress={() => void send(s)}>
                <Text style={styles.suggestionText}>{s}</Text>
              </Pressable>
            ))}
          </View>
        )}

        {turns.map((turn, i) => (
          <View key={i}>
            <View style={[styles.bubble, turn.role === 'user' ? styles.user : styles.assistant]}>
              <Text style={turn.role === 'user' ? styles.userText : styles.assistantText}>
                {turn.content}
              </Text>
            </View>
            {turn.gaveUp && (
              <Text style={styles.gaveUp}>
                It ran out of reasoning steps. A narrower question usually works.
              </Text>
            )}
            {/* Cards sit OUTSIDE the bubble, deliberately: everything inside one is the model
                talking, and a control that changes the ledger should not look like part of a
                sentence the model wrote. */}
            {(turn.proposals ?? []).map((p) => <ProposalCard key={p.id} proposal={p} />)}
          </View>
        ))}

        {busy && <ActivityIndicator style={styles.spinner} />}
        {error && <Text style={styles.error}>{error}</Text>}
      </ScrollView>

      <View style={styles.composer}>
        <TextInput
          style={styles.input}
          value={input}
          onChangeText={setInput}
          placeholder="Ask about your spending"
          placeholderTextColor="#9ca3af"
          editable={!busy}
          multiline
          onSubmitEditing={() => void send(input)}
        />
        <Pressable
          style={[styles.sendButton, (!input.trim() || busy) && styles.sendDisabled]}
          onPress={() => void send(input)}
          disabled={!input.trim() || busy}
        >
          <Text style={styles.sendText}>Ask</Text>
        </Pressable>
      </View>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: '#fff' },
  content: { padding: 20, paddingBottom: 20 },
  heading: { fontSize: 13, fontWeight: '600', letterSpacing: 0.8, color: '#9ca3af', textTransform: 'uppercase', marginBottom: 16 },
  empty: { fontSize: 14, color: '#6b7280', lineHeight: 21, marginBottom: 18 },
  suggestion: { borderWidth: 1, borderColor: '#e5e7eb', borderRadius: 10, padding: 13, marginBottom: 9 },
  suggestionText: { fontSize: 15, color: '#374151' },
  bubble: { borderRadius: 14, paddingHorizontal: 14, paddingVertical: 11, marginTop: 10, maxWidth: '88%' },
  user: { backgroundColor: '#111827', alignSelf: 'flex-end' },
  assistant: { backgroundColor: '#f3f4f6', alignSelf: 'flex-start' },
  userText: { color: '#fff', fontSize: 15, lineHeight: 21 },
  assistantText: { color: '#111827', fontSize: 15, lineHeight: 21 },
  gaveUp: { fontSize: 12, color: '#d97706', marginTop: 6 },
  spinner: { marginTop: 18 },
  error: { fontSize: 14, color: '#dc2626', marginTop: 14, lineHeight: 20 },
  composer: { flexDirection: 'row', gap: 10, paddingHorizontal: 16, paddingTop: 10, paddingBottom: 8, borderTopWidth: 1, borderTopColor: '#e5e7eb', alignItems: 'flex-end' },
  input: { flex: 1, borderWidth: 1, borderColor: '#d1d5db', borderRadius: 20, paddingHorizontal: 15, paddingVertical: 10, fontSize: 15, maxHeight: 120, color: '#111827' },
  sendButton: { backgroundColor: '#2563eb', borderRadius: 20, paddingHorizontal: 18, paddingVertical: 11 },
  sendDisabled: { opacity: 0.4 },
  sendText: { color: '#fff', fontSize: 15, fontWeight: '600' },
});
