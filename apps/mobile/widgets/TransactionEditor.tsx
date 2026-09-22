// The two things the phone can change about a transaction: its category, and the note on it.
//
// ─── One editor, two screens ──────────────────────────────────────────────────────────────────
//
// A category picker already existed inside `DidThatLandRight.tsx`. When the heatmap's drill-down
// needed the same thing, the choice was to copy it or to lift it, and this repo has spent the week
// paying for copies — of a grading rule, of a smoothing function, of a window definition. Lifted.
// Arrivals gains the note field it never had, which is the right outcome rather than a side effect:
// the two screens show the same rows and should offer the same verbs.
//
// ─── A NOTE IS A WATCHLIST ENTRY. This is not a shortcut, it is the schema ────────────────────
//
// There is no free-floating comment column on a transaction. `watch_note` exists only alongside
// `watched_at`, enforced by `transactions_watch_note_needs_flag`, so writing a note IS putting the
// row on the watchlist — where it appears under "Keep an eye" and in the daily email — and clearing
// the flag discards the note. That is worth saying on screen rather than surprising someone with,
// which is what the line under the field does.

import { useState } from 'react';
import {
  ActivityIndicator, Modal, Pressable, ScrollView, StyleSheet, Text, TextInput, View,
} from 'react-native';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { MAX_WATCH_NOTE } from '@b8/contracts/overview';
import { fetchCategoryNames, setCategory, setWatchNote } from '../lib/api';
import { C, money } from './tokens';

export interface EditableTransaction {
  id: number;
  label: string;
  date: string;
  amount: string | number;
  category: string | null;
  watched: boolean;
  note: string | null;
}

export default function TransactionEditor({ row, onClose }: {
  row: EditableTransaction;
  onClose: () => void;
}) {
  const queryClient = useQueryClient();
  const [note, setNote] = useState(row.note ?? '');

  const { data: names, isLoading } = useQuery({
    queryKey: ['categoryNames'],
    queryFn: fetchCategoryNames,
    staleTime: 10 * 60_000,
  });

  /**
   * Both mutations invalidate the SAME two queries rather than patching either cache.
   *
   * `overview` carries the figures this moves — the heatmap's tiles, the KPI row, "Keep an eye" —
   * and `categoryTransactions` is the list the reader is looking at. Patching them by hand would be
   * a second definition of what the month says, which is the failure this app keeps finding; a
   * refetch has one.
   */
  async function refresh() {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ['overview'] }),
      queryClient.invalidateQueries({ queryKey: ['categoryTransactions'] }),
    ]);
  }

  const categoryMutation = useMutation({
    mutationFn: (category: string | null) => setCategory(row.id, category),
    onSuccess: async () => { await refresh(); onClose(); },
  });

  const noteMutation = useMutation({
    // An EMPTY note means "take it off the list", which is the only reading that makes the obvious
    // gesture — clearing the box and saving — mean the obvious thing. The server discards the note
    // when the flag comes off, so nothing is left dangling.
    mutationFn: () => {
      const trimmed = note.trim();
      return setWatchNote(row.id, trimmed !== '', trimmed === '' ? null : trimmed);
    },
    onSuccess: refresh,
  });

  const busy = categoryMutation.isPending || noteMutation.isPending;
  const trimmed = note.trim();
  // Nothing to save when the text is what is already stored — and, for an unflagged row, when the
  // box is empty, because "flag it with no reason" is not what an untouched field is asking for.
  const unchanged = trimmed === (row.note ?? '') && (row.watched || trimmed !== '');
  const tooLong = trimmed.length > MAX_WATCH_NOTE;

  return (
    <Modal visible animationType="slide" onRequestClose={onClose}>
      <View style={styles.modal}>
        <Text style={styles.label}>{row.label}</Text>
        <Text style={styles.sub}>
          {row.date} · {money(row.amount)} · currently {row.category ?? 'uncategorized'}
        </Text>

        {(categoryMutation.isError || noteMutation.isError) && (
          <Text style={styles.error}>
            {(categoryMutation.error ?? noteMutation.error) instanceof Error
              ? (categoryMutation.error ?? noteMutation.error as Error).message
              : 'Could not save that.'}
          </Text>
        )}

        <Text style={styles.section}>
          Note{row.watched ? ' · on Keep an eye' : ''}
        </Text>
        <TextInput
          style={[styles.input, tooLong && styles.inputBad]}
          value={note}
          onChangeText={setNote}
          placeholder="Why you are keeping an eye on this"
          placeholderTextColor={C.faint}
          multiline
          editable={!busy}
          // Not `maxLength`: a hard stop swallows keystrokes with no explanation and leaves the
          // owner wondering whether the keyboard broke. The counter turns red instead, and the
          // save is refused with a reason.
          accessibilityLabel="Note on this transaction"
        />
        <View style={styles.noteFoot}>
          {/* Phrased against what is actually true NOW. A row can be flagged with no note, so
              "saving an empty note removes it" is only a warning when there is something to
              remove; said on an unflagged row it describes an action with no effect. */}
          <Text style={styles.hint}>
            {trimmed !== ''
              ? (row.watched ? 'Stays on Keep an eye.' : 'Saving puts this on Keep an eye.')
              : (row.watched ? 'Saving empty takes this off Keep an eye.' : 'Not on Keep an eye.')}
          </Text>
          <Text style={[styles.count, tooLong && { color: C.over }]}>
            {trimmed.length}/{MAX_WATCH_NOTE}
          </Text>
        </View>
        <Pressable
          style={[styles.save, (busy || unchanged || tooLong) && styles.saveOff]}
          disabled={busy || unchanged || tooLong}
          onPress={() => noteMutation.mutate()}
        >
          <Text style={styles.saveText}>
            {noteMutation.isPending ? 'Saving…' : noteMutation.isSuccess && unchanged ? 'Saved' : 'Save note'}
          </Text>
        </Pressable>

        <Text style={styles.section}>Category</Text>
        <ScrollView style={styles.pickerList}>
          {isLoading && <ActivityIndicator style={styles.spinner} />}
          {names?.map((name) => {
            const current = name === row.category;
            return (
              <Pressable
                key={name}
                style={[styles.pickerRow, current && styles.pickerRowCurrent]}
                disabled={busy}
                onPress={() => categoryMutation.mutate(name)}
              >
                <Text style={[styles.pickerText, current && styles.pickerTextCurrent]}>{name}</Text>
                {current && <Text style={styles.pickerTick}>current</Text>}
              </Pressable>
            );
          })}
          <Pressable style={styles.pickerRow} disabled={busy} onPress={() => categoryMutation.mutate(null)}>
            <Text style={styles.pickerClear}>Clear the category</Text>
          </Pressable>
        </ScrollView>

        <Pressable style={styles.cancel} onPress={onClose} disabled={busy}>
          <Text style={styles.cancelText}>{busy ? 'Saving…' : 'Done'}</Text>
        </Pressable>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  modal: { flex: 1, backgroundColor: '#fff', padding: 20, paddingTop: 60 },
  label: { fontSize: 18, fontWeight: '700', color: C.ink },
  sub: { fontSize: 12, color: C.faint, marginTop: 3 },
  section: { fontSize: 11, fontWeight: '700', letterSpacing: 0.6, color: C.muted, textTransform: 'uppercase', marginTop: 22, marginBottom: 8 },
  input: { borderWidth: 1, borderColor: C.line, borderRadius: 10, padding: 11, fontSize: 15, color: C.ink, minHeight: 66, textAlignVertical: 'top' },
  inputBad: { borderColor: C.over },
  noteFoot: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginTop: 6, gap: 10 },
  hint: { flex: 1, fontSize: 11, color: C.faint },
  count: { fontSize: 11, color: C.faint, fontVariant: ['tabular-nums'] },
  save: { marginTop: 10, alignSelf: 'flex-start', backgroundColor: C.accent, borderRadius: 8, paddingHorizontal: 14, paddingVertical: 9 },
  saveOff: { opacity: 0.45 },
  saveText: { color: '#fff', fontSize: 14, fontWeight: '600' },
  pickerList: { flex: 1 },
  pickerRow: { paddingVertical: 12, borderBottomWidth: 1, borderBottomColor: C.hair, flexDirection: 'row', justifyContent: 'space-between' },
  pickerRowCurrent: { opacity: 0.55 },
  pickerText: { fontSize: 16, color: C.ink },
  pickerTextCurrent: { fontWeight: '600' },
  pickerTick: { fontSize: 12, color: C.faint },
  pickerClear: { fontSize: 16, color: C.over },
  cancel: { paddingVertical: 16, alignItems: 'center' },
  cancelText: { fontSize: 16, color: C.accent },
  error: { fontSize: 14, color: C.over, marginTop: 12, lineHeight: 20 },
  spinner: { marginTop: 20 },
});
