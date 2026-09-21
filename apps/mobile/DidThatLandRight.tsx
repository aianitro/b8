// Screen 2 of four: "did that land right?"
//
// ROADMAP.md §5 Phase 3 step 24. What arrived since you last looked, and is it categorised
// correctly. The second thing a phone is genuinely better at than a laptop: a charge you half
// remember, corrected in two taps while you still remember it.

import { useState } from 'react';
import {
  ActivityIndicator, Modal, Pressable, RefreshControl,
  ScrollView, StyleSheet, Text, View,
} from 'react-native';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { OverviewData } from '@b8/contracts/overview';
import { fetchCategoryNames, fetchOverview, setCategory } from './lib/api';

const money = (v: string | number) =>
  `$${Number(v).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

type Arrival = OverviewData['recentArrivals'][number];
type Watched = OverviewData['watchlist'][number];

/** A row either list can render: the two shapes agree on everything this screen shows. */
interface Row {
  id: number;
  date: string;
  label: string;
  amount: string;
  category: string | null;
  note?: string | null;
  daysOpen?: number;
}

function asRow(t: Arrival | Watched): Row {
  return t as Row;
}

function CategoryPicker({
  row, onClose,
}: { row: Row; onClose: () => void }) {
  const queryClient = useQueryClient();
  const { data: names, isLoading } = useQuery({
    queryKey: ['categoryNames'],
    queryFn: fetchCategoryNames,
    staleTime: 10 * 60_000,
  });

  const mutation = useMutation({
    mutationFn: (category: string | null) => setCategory(row.id, category),
    onSuccess: async () => {
      // The overview carries the figures this change moves — the verdict on screen 1 included.
      // Invalidating rather than patching the cache keeps one definition of what the month says.
      await queryClient.invalidateQueries({ queryKey: ['overview'] });
      onClose();
    },
  });

  return (
    <Modal visible animationType="slide" onRequestClose={onClose}>
      <View style={styles.modal}>
        <Text style={styles.modalLabel}>{row.label}</Text>
        <Text style={styles.modalSub}>
          {row.date} · {money(row.amount)} · currently {row.category ?? 'uncategorized'}
        </Text>

        {mutation.isError && (
          <Text style={styles.error}>
            {mutation.error instanceof Error ? mutation.error.message : 'Could not change it.'}
          </Text>
        )}

        <ScrollView style={styles.pickerList}>
          {isLoading && <ActivityIndicator style={styles.spinner} />}
          {names?.map((name) => {
            const current = name === row.category;
            return (
              <Pressable
                key={name}
                style={[styles.pickerRow, current && styles.pickerRowCurrent]}
                disabled={mutation.isPending}
                onPress={() => mutation.mutate(name)}
              >
                <Text style={[styles.pickerText, current && styles.pickerTextCurrent]}>{name}</Text>
                {current && <Text style={styles.pickerTick}>current</Text>}
              </Pressable>
            );
          })}
          <Pressable
            style={styles.pickerRow}
            disabled={mutation.isPending}
            onPress={() => mutation.mutate(null)}
          >
            <Text style={styles.pickerClear}>Clear the category</Text>
          </Pressable>
        </ScrollView>

        <Pressable style={styles.cancel} onPress={onClose} disabled={mutation.isPending}>
          <Text style={styles.cancelText}>{mutation.isPending ? 'Saving…' : 'Cancel'}</Text>
        </Pressable>
      </View>
    </Modal>
  );
}

function TransactionRow({ row, onPress }: { row: Row; onPress: () => void }) {
  return (
    <Pressable style={styles.row} onPress={onPress}>
      <View style={styles.rowLeft}>
        <Text style={styles.label} numberOfLines={1}>{row.label}</Text>
        <Text style={styles.meta}>
          {row.date}
          {row.category ? ` · ${row.category}` : ''}
          {row.daysOpen !== undefined ? ` · open ${row.daysOpen}d` : ''}
        </Text>
        {row.note ? <Text style={styles.note}>{row.note}</Text> : null}
      </View>
      <View style={styles.rowRight}>
        <Text style={styles.amount}>{money(row.amount)}</Text>
        {/* UNCATEGORIZED IS THE ACTIONABLE STATE, so it is the one that gets a colour. A charge with
            no category counts toward no budget line, which is the silent version of being wrong. */}
        {!row.category && <Text style={styles.needsCategory}>needs a category</Text>}
      </View>
    </Pressable>
  );
}

export default function DidThatLandRight() {
  const [editing, setEditing] = useState<Row | null>(null);
  const { data, error, isFetching, refetch } = useQuery({
    queryKey: ['overview'],
    queryFn: fetchOverview,
  });

  const arrivals = (data?.recentArrivals ?? []).map(asRow);
  const watched = (data?.watchlist ?? []).map(asRow);

  return (
    <View style={styles.screen}>
      <ScrollView
        contentContainerStyle={styles.content}
        refreshControl={<RefreshControl refreshing={isFetching} onRefresh={() => void refetch()} />}
      >
        <Text style={styles.heading}>Did that land right?</Text>

        {isFetching && !data && <ActivityIndicator style={styles.spinner} />}
        {error && (
          <Text style={styles.error}>
            {error instanceof Error ? error.message : 'Could not load.'}
          </Text>
        )}

        {watched.length > 0 && (
          <>
            <Text style={styles.sectionHeading}>Watching</Text>
            {watched.map((t) => (
              <TransactionRow key={`w${t.id}`} row={t} onPress={() => setEditing(t)} />
            ))}
          </>
        )}

        {arrivals.length > 0 && (
          <>
            <Text style={[styles.sectionHeading, watched.length > 0 && styles.sectionSpaced]}>
              Just arrived
            </Text>
            {arrivals.map((t) => (
              <TransactionRow key={`a${t.id}`} row={t} onPress={() => setEditing(t)} />
            ))}
          </>
        )}

        {data && arrivals.length === 0 && watched.length === 0 && (
          <Text style={styles.empty}>Nothing new since you last looked.</Text>
        )}
      </ScrollView>

      {editing && <CategoryPicker row={editing} onClose={() => setEditing(null)} />}
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: '#fff' },
  content: { padding: 20, paddingBottom: 48 },
  heading: { fontSize: 13, fontWeight: '600', letterSpacing: 0.8, color: '#9ca3af', textTransform: 'uppercase', marginBottom: 18 },
  sectionHeading: { fontSize: 12, fontWeight: '700', letterSpacing: 0.6, color: '#6b7280', textTransform: 'uppercase', marginBottom: 6 },
  sectionSpaced: { marginTop: 28 },
  row: { flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 13, borderBottomWidth: 1, borderBottomColor: '#f3f4f6' },
  rowLeft: { flexShrink: 1, paddingRight: 12 },
  rowRight: { alignItems: 'flex-end' },
  label: { fontSize: 16, color: '#111827' },
  meta: { fontSize: 12, color: '#9ca3af', marginTop: 3 },
  note: { fontSize: 12, color: '#6b7280', marginTop: 3, fontStyle: 'italic' },
  amount: { fontSize: 16, fontVariant: ['tabular-nums'], color: '#111827' },
  needsCategory: { fontSize: 11, color: '#d97706', marginTop: 3 },
  empty: { fontSize: 14, color: '#9ca3af' },
  error: { fontSize: 14, color: '#dc2626', lineHeight: 20, marginBottom: 10 },
  spinner: { marginTop: 40 },
  modal: { flex: 1, backgroundColor: '#fff', paddingTop: 64, paddingHorizontal: 20 },
  modalLabel: { fontSize: 20, fontWeight: '700', color: '#111827' },
  modalSub: { fontSize: 13, color: '#6b7280', marginTop: 6, marginBottom: 18 },
  pickerList: { flex: 1 },
  pickerRow: { paddingVertical: 15, borderBottomWidth: 1, borderBottomColor: '#f3f4f6', flexDirection: 'row', justifyContent: 'space-between' },
  pickerRowCurrent: { backgroundColor: '#f9fafb' },
  pickerText: { fontSize: 17, color: '#111827' },
  pickerTextCurrent: { fontWeight: '600' },
  pickerTick: { fontSize: 12, color: '#9ca3af', alignSelf: 'center' },
  pickerClear: { fontSize: 17, color: '#dc2626' },
  cancel: { paddingVertical: 18, alignItems: 'center' },
  cancelText: { fontSize: 16, color: '#6b7280' },
});
