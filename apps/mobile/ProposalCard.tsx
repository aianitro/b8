// The confirmation gate, on the phone.
//
// ROADMAP.md §5 Phase 4 step 27 argues a native card beats the web's, and this is why: on a phone
// the decision is one thumb-reach from the sentence that prompted it, and the amount is legible
// without leaning in. The gate itself is step 16's — the agent proposes, only a full-scope session
// can apply, and the model has no tool for the decide endpoint.
//
// IT SHOWS THE FROM AND THE TO. A card that says only "categorize as Groceries?" asks for agreement
// to a change whose effect the reader cannot see, and `lib/domain/proposal.ts` rests its whole
// security argument on this card being legible. The web version shipped with the same rule.

import { useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';
import { useQueryClient } from '@tanstack/react-query';
import { decideProposal, type ChatProposal } from './lib/api';

const money = (v: number) =>
  `$${v.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

const label = (c: string | null) => c ?? 'uncategorized';

export default function ProposalCard({ proposal }: { proposal: ChatProposal }) {
  const queryClient = useQueryClient();
  const [busy, setBusy] = useState<null | 'confirmed' | 'rejected'>(null);
  const [done, setDone] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function decide(decision: 'confirmed' | 'rejected') {
    setBusy(decision);
    setError(null);
    try {
      const result = await decideProposal(proposal.id, decision);
      setDone(result.message);
      // The overview carries the figures this change moves, screen 1's verdict included.
      if (result.applied) await queryClient.invalidateQueries({ queryKey: ['overview'] });
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not apply that.');
    } finally {
      setBusy(null);
    }
  }

  if (done) {
    return (
      <View style={styles.settled}>
        <Text style={styles.settledText}>{done}</Text>
      </View>
    );
  }

  return (
    <View style={styles.card}>
      <Text style={styles.heading}>Suggested change — nothing has changed yet</Text>

      {proposal.subject && (
        <Text style={styles.subject}>
          {proposal.subject.merchant ?? 'Transaction'}
          <Text style={styles.subjectMeta}>
            {'  '}{proposal.subject.date} · {money(proposal.subject.amount)}
          </Text>
        </Text>
      )}

      <Text style={styles.change}>
        <Text style={styles.from}>{label(proposal.observed.category)}</Text>
        <Text style={styles.arrow}>{'  →  '}</Text>
        <Text style={styles.to}>{label(proposal.proposed.category)}</Text>
      </Text>

      {proposal.rationale ? <Text style={styles.rationale}>{proposal.rationale}</Text> : null}
      {error ? <Text style={styles.error}>{error}</Text> : null}

      <View style={styles.buttons}>
        <Pressable
          style={[styles.confirm, busy !== null && styles.busy]}
          onPress={() => decide('confirmed')}
          disabled={busy !== null}
        >
          {busy === 'confirmed'
            ? <ActivityIndicator color="#fff" />
            : <Text style={styles.confirmText}>Confirm</Text>}
        </Pressable>
        <Pressable
          style={[styles.dismiss, busy !== null && styles.busy]}
          onPress={() => decide('rejected')}
          disabled={busy !== null}
        >
          <Text style={styles.dismissText}>{busy === 'rejected' ? 'Dismissing…' : 'Dismiss'}</Text>
        </Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  card: { backgroundColor: '#fffbeb', borderColor: '#fde68a', borderWidth: 1, borderRadius: 12, padding: 14, marginTop: 10 },
  heading: { fontSize: 11, fontWeight: '700', letterSpacing: 0.4, color: '#b45309', textTransform: 'uppercase', marginBottom: 10 },
  subject: { fontSize: 15, fontWeight: '600', color: '#111827' },
  subjectMeta: { fontSize: 13, fontWeight: '400', color: '#9ca3af' },
  change: { fontSize: 16, marginTop: 8 },
  from: { color: '#9ca3af', textDecorationLine: 'line-through' },
  arrow: { color: '#9ca3af' },
  to: { color: '#111827', fontWeight: '700' },
  rationale: { fontSize: 13, color: '#6b7280', marginTop: 8, lineHeight: 19 },
  error: { fontSize: 13, color: '#dc2626', marginTop: 8 },
  buttons: { flexDirection: 'row', gap: 10, marginTop: 14 },
  confirm: { flex: 1, backgroundColor: '#2563eb', borderRadius: 8, paddingVertical: 12, alignItems: 'center' },
  confirmText: { color: '#fff', fontSize: 15, fontWeight: '600' },
  dismiss: { flex: 1, backgroundColor: '#e5e7eb', borderRadius: 8, paddingVertical: 12, alignItems: 'center' },
  dismissText: { color: '#374151', fontSize: 15, fontWeight: '600' },
  busy: { opacity: 0.6 },
  settled: { borderColor: '#e5e7eb', borderWidth: 1, borderRadius: 12, padding: 12, marginTop: 10 },
  settledText: { fontSize: 13, color: '#16a34a' },
});
