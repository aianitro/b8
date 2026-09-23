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
// ─── A NOTE IS A NOTE; WATCHING IS A FLAG; NEITHER IMPLIES THE OTHER ─────────────────────────
//
// This screen shipped with them fused, because the schema fused them: `watch_note` could not exist
// without `watched_at`. Writing a comment therefore put the row on the watchlist, and once watched
// rows began to be excused from the budget grading, an innocent note silently removed its charge
// from overspend measurement. The owner found it within the hour — an Airbnb charge annotated and
// then spotted on a list it had no business being on.
//
// The column is now `note` and the CHECK is gone, so this offers two separate controls: a note, and
// a toggle. Neither writes the other's column — `updateTransactionNote` sends only the keys it was
// given, and the server leaves an unnamed column alone.

import { useState } from 'react';
import {
  ActivityIndicator, Modal, Pressable, ScrollView, StyleSheet, Text, TextInput, View,
} from 'react-native';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { MAX_WATCH_NOTE } from '@b8/contracts/overview';
import { fetchCategoryNames, setCategory, updateTransactionNote } from '../lib/api';
import { C, MODAL_TOP, money } from './tokens';

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

  // NOTE AND FLAG ARE TWO MUTATIONS, not one with a derived flag. Saving a note says nothing about
  // the watchlist, and toggling the watchlist says nothing about the note.
  const noteMutation = useMutation({
    mutationFn: () => {
      const trimmed = note.trim();
      return updateTransactionNote(row.id, { note: trimmed === '' ? null : trimmed });
    },
    onSuccess: refresh,
  });

  const watchMutation = useMutation({
    mutationFn: (next: boolean) => updateTransactionNote(row.id, { watched: next }),
    onSuccess: refresh,
  });

  const busy = categoryMutation.isPending || noteMutation.isPending || watchMutation.isPending;
  // The flag the server last confirmed, which is what the toggle must reflect after a change.
  const watched = watchMutation.isSuccess ? watchMutation.variables : row.watched;
  const trimmed = note.trim();
  // Nothing to save when the text is what is already stored.
  const unchanged = trimmed === (row.note ?? '');
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

        <Text style={styles.section}>Note</Text>
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
          {/* Says what a note IS now, because the previous version of this screen taught the
              opposite and the correction is worth stating once rather than leaving implied. */}
          <Text style={styles.hint}>Just a note. It does not flag this transaction.</Text>
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

        <Text style={styles.section}>Keep an eye</Text>
        <Pressable
          style={styles.toggle}
          disabled={busy}
          onPress={() => watchMutation.mutate(!watched)}
          accessibilityRole="switch"
          accessibilityState={{ checked: watched }}
        >
          <View style={[styles.box, watched && styles.boxOn]}>
            {watched && <Text style={styles.tick}>✓</Text>}
          </View>
          <Text style={styles.toggleText}>
            {watched ? 'On the list' : 'Not on the list'}
            {/* THE CONSEQUENCE, ON SCREEN. A flagged charge is left out of its category's
                overspend measurement — that is the whole reason the flag matters now, and it is
                not something to discover from a tile that went quiet. */}
            <Text style={styles.toggleSub}>
              {watched
                ? ' · this charge is left out of its budget grading'
                : ' · counted toward its budget as normal'}
            </Text>
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
  // Outside the shell, like every full-screen Modal, so it carries its own island clearance.
  modal: { flex: 1, backgroundColor: '#fff', padding: 20, paddingTop: MODAL_TOP },
  label: { fontSize: 18, fontWeight: '700', color: C.ink },
  sub: { fontSize: 12, color: C.faint, marginTop: 3 },
  section: { fontSize: 11, fontWeight: '700', letterSpacing: 0.6, color: C.muted, textTransform: 'uppercase', marginTop: 22, marginBottom: 8 },
  input: { borderWidth: 1, borderColor: C.line, borderRadius: 10, padding: 11, fontSize: 15, color: C.ink, minHeight: 66, textAlignVertical: 'top' },
  inputBad: { borderColor: C.over },
  noteFoot: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginTop: 6, gap: 10 },
  hint: { flex: 1, fontSize: 11, color: C.faint },
  count: { fontSize: 11, color: C.faint, fontVariant: ['tabular-nums'] },
  toggle: { flexDirection: 'row', alignItems: 'flex-start', gap: 10, paddingVertical: 4 },
  box: { width: 22, height: 22, borderRadius: 6, borderWidth: 1.5, borderColor: C.line, alignItems: 'center', justifyContent: 'center' },
  boxOn: { backgroundColor: C.warn, borderColor: C.warn },
  tick: { color: '#fff', fontSize: 13, fontWeight: '700' },
  toggleText: { flex: 1, fontSize: 14, color: C.ink, lineHeight: 19 },
  toggleSub: { color: C.faint, fontSize: 12 },
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
