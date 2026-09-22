// Screen 4 of four: enter a number you are holding.
//
// ROADMAP.md §5 Phase 3 step 24, and DEMOTED there on 2026-09-21. This was once the whole
// justification for building a phone app — "quarterly property valuation quick-entry", four data
// entries a year — and the rewrite replaced that with the guardrail screen. It is still
// genuinely better on a phone than a laptop: you are at the property, or looking at a statement,
// and the laptop is elsewhere.
//
// APPEND, NEVER OVERWRITE. Saving posts a new valuation row rather than editing a balance, so what
// was believed and when survives — that history is what the net-worth trend reads, and it makes a
// typo correctable by entering the right number instead of editing the past.

import { useState } from 'react';
import {
  ActivityIndicator, KeyboardAvoidingView, Platform, Pressable, RefreshControl,
  ScrollView, StyleSheet, Text, TextInput, View,
} from 'react-native';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { fetchQuickEntry, postValuation } from './lib/api';

const money = (v: number) =>
  `$${v.toLocaleString('en-US', { maximumFractionDigits: 0 })}`;

type Target =
  | { kind: 'account'; id: string; label: string; latest: number | null; isLiability: boolean }
  | { kind: 'property'; id: number; label: string; latest: number | null; isLiability: false };

function Row({ target, onPick }: { target: Target; onPick: () => void }) {
  return (
    <Pressable style={styles.row} onPress={onPick}>
      <View style={styles.rowLeft}>
        <Text style={styles.label}>{target.label}</Text>
        {target.isLiability && <Text style={styles.owed}>owed</Text>}
      </View>
      <Text style={target.latest === null ? styles.never : styles.value}>
        {target.latest === null ? 'never valued' : money(target.latest)}
      </Text>
    </Pressable>
  );
}

function Editor({ target, onDone }: { target: Target; onDone: () => void }) {
  const queryClient = useQueryClient();
  const [text, setText] = useState('');

  const save = useMutation({
    mutationFn: async () => {
      // Strip everything but digits, minus and the decimal point, so a pasted "$1,234.00" works.
      // Commas are the likeliest paste and the likeliest silent NaN.
      const value = Number(text.replace(/[^0-9.-]/g, ''));
      if (!Number.isFinite(value)) throw new Error('That is not a number.');
      await postValuation(
        target.kind === 'account' ? { kind: 'account', id: target.id } : { kind: 'property', id: target.id },
        value
      );
    },
    onSuccess: async () => {
      // Both: this screen's own lists, and the overview, because a valuation moves net worth.
      await queryClient.invalidateQueries({ queryKey: ['quickEntry'] });
      await queryClient.invalidateQueries({ queryKey: ['overview'] });
      onDone();
    },
  });

  return (
    <View style={styles.editor}>
      <Text style={styles.editorLabel}>{target.label}</Text>
      <Text style={styles.editorHint}>
        {target.latest === null
          ? 'No valuation recorded yet.'
          : `Currently ${money(target.latest)}${target.isLiability ? ' owed' : ''}.`}
        {target.isLiability ? ' Enter the amount outstanding, as a positive number.' : ''}
      </Text>
      <TextInput
        style={styles.input}
        value={text}
        onChangeText={setText}
        placeholder="New value"
        placeholderTextColor="#9ca3af"
        keyboardType="decimal-pad"
        autoFocus
        editable={!save.isPending}
      />
      {save.isError && (
        <Text style={styles.error}>
          {save.error instanceof Error ? save.error.message : 'Could not save that.'}
        </Text>
      )}
      <View style={styles.editorButtons}>
        <Pressable
          style={[styles.save, (!text.trim() || save.isPending) && styles.disabled]}
          onPress={() => save.mutate()}
          disabled={!text.trim() || save.isPending}
        >
          {save.isPending
            ? <ActivityIndicator color="#fff" />
            : <Text style={styles.saveText}>Save</Text>}
        </Pressable>
        <Pressable style={styles.cancel} onPress={onDone} disabled={save.isPending}>
          <Text style={styles.cancelText}>Cancel</Text>
        </Pressable>
      </View>
    </View>
  );
}

export default function QuickEntry() {
  const [target, setTarget] = useState<Target | null>(null);
  const { data, error, isFetching, refetch } = useQuery({
    queryKey: ['quickEntry'],
    queryFn: fetchQuickEntry,
    staleTime: 5 * 60_000,
  });

  const properties: Target[] = (data?.properties ?? []).map((p) => ({
    kind: 'property', id: p.id, label: p.nickname, latest: p.latestValue, isLiability: false,
  }));
  const accounts: Target[] = (data?.accounts ?? []).map((a) => ({
    kind: 'account', id: a.id, label: a.name, latest: a.latestValue, isLiability: a.isLiability,
  }));

  return (
    <KeyboardAvoidingView style={styles.screen} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <ScrollView
        contentContainerStyle={styles.content}
        refreshControl={<RefreshControl refreshing={isFetching} onRefresh={() => void refetch()} />}
        keyboardShouldPersistTaps="handled"
      >
        <Text style={styles.heading}>Quick entry</Text>

        {isFetching && !data && <ActivityIndicator style={styles.spinner} />}
        {error && (
          <Text style={styles.error}>
            {error instanceof Error ? error.message : 'Could not load.'}
          </Text>
        )}

        {target && <Editor target={target} onDone={() => setTarget(null)} />}

        {!target && properties.length > 0 && (
          <>
            <Text style={styles.section}>Properties</Text>
            {properties.map((t) => (
              <Row key={`p${t.id}`} target={t} onPick={() => setTarget(t)} />
            ))}
          </>
        )}

        {!target && accounts.length > 0 && (
          <>
            <Text style={[styles.section, properties.length > 0 && styles.sectionSpaced]}>
              Valued accounts
            </Text>
            {accounts.map((t) => (
              <Row key={`a${t.id}`} target={t} onPick={() => setTarget(t)} />
            ))}
          </>
        )}

        {data && properties.length === 0 && accounts.length === 0 && (
          <Text style={styles.empty}>
            Nothing here needs a hand-entered value. Ledger accounts take their balance from
            transactions.
          </Text>
        )}
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: '#fff' },
  content: { padding: 20, paddingBottom: 40 },
  heading: { fontSize: 13, fontWeight: '600', letterSpacing: 0.8, color: '#9ca3af', textTransform: 'uppercase', marginBottom: 16 },
  section: { fontSize: 12, fontWeight: '700', letterSpacing: 0.6, color: '#6b7280', textTransform: 'uppercase', marginBottom: 6 },
  sectionSpaced: { marginTop: 28 },
  row: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingVertical: 14, borderBottomWidth: 1, borderBottomColor: '#f3f4f6' },
  rowLeft: { flexDirection: 'row', alignItems: 'baseline', gap: 7, flexShrink: 1 },
  label: { fontSize: 16, color: '#111827' },
  owed: { fontSize: 11, color: '#dc2626' },
  value: { fontSize: 16, color: '#111827', fontVariant: ['tabular-nums'] },
  never: { fontSize: 13, color: '#d97706' },
  empty: { fontSize: 14, color: '#9ca3af', lineHeight: 21 },
  error: { fontSize: 14, color: '#dc2626', marginTop: 10, lineHeight: 20 },
  spinner: { marginTop: 40 },
  editor: { borderWidth: 1, borderColor: '#e5e7eb', borderRadius: 12, padding: 16 },
  editorLabel: { fontSize: 18, fontWeight: '700', color: '#111827' },
  editorHint: { fontSize: 13, color: '#6b7280', marginTop: 6, lineHeight: 19 },
  input: { borderWidth: 1, borderColor: '#d1d5db', borderRadius: 8, padding: 14, fontSize: 20, marginTop: 14, color: '#111827', fontVariant: ['tabular-nums'] },
  editorButtons: { flexDirection: 'row', gap: 10, marginTop: 14 },
  save: { flex: 1, backgroundColor: '#2563eb', borderRadius: 8, paddingVertical: 13, alignItems: 'center' },
  saveText: { color: '#fff', fontSize: 16, fontWeight: '600' },
  cancel: { flex: 1, backgroundColor: '#e5e7eb', borderRadius: 8, paddingVertical: 13, alignItems: 'center' },
  cancelText: { color: '#374151', fontSize: 16, fontWeight: '600' },
  disabled: { opacity: 0.45 },
});
