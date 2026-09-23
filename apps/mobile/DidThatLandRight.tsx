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
import { useQuery } from '@tanstack/react-query';
import type { OverviewData } from '@b8/contracts/overview';
import { fetchOverview } from './lib/api';
import TransactionEditor, { type EditableTransaction } from './widgets/TransactionEditor';

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
  const [editing, setEditing] = useState<EditableTransaction | null>(null);
  const { data, error, isFetching, refetch } = useQuery({
    queryKey: ['overview'],
    queryFn: fetchOverview,
  });

  // NOT mapped through `asRow` here. `Row` is the shape this screen DISPLAYS — the fields the two
  // lists agree on — and converting up front threw away `watched` and `note`, which is what the
  // editor needs to open from the truth rather than from a default. Converted per row at render.
  const arrivals = data?.recentArrivals ?? [];
  const watched = data?.watchlist ?? [];

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
              <TransactionRow key={`w${t.id}`} row={asRow(t)}
                onPress={() => setEditing({
                  id: t.id, label: t.label, date: t.date, amount: t.amount,
                  category: t.category, note: t.note,
                  // Every row in this section is flagged — that is what the section is.
                  watched: true,
                })} />
            ))}
          </>
        )}

        {arrivals.length > 0 && (
          <>
            <Text style={[styles.sectionHeading, watched.length > 0 && styles.sectionSpaced]}>
              Just arrived
            </Text>
            {arrivals.map((t) => (
              <TransactionRow key={`a${t.id}`} row={asRow(t)}
                // THE FLAG AND THE NOTE COME FROM THE ROW, not from an assumption. This said
                // `watched: false, note: null` for a day, on the reasoning that an arrival cannot
                // also be on the watchlist — but this read has no watched bound and the watchlist
                // read has no date bound, so a row flagged today that also landed today is in
                // both. On such a row the note field opened blank and the first save replaced what
                // was there. The payload carries both fields now.
                onPress={() => setEditing({
                  id: t.id, label: t.label, date: t.date, amount: t.amount,
                  category: t.category, watched: t.watched, note: t.note,
                })} />
            ))}
          </>
        )}

        {data && arrivals.length === 0 && watched.length === 0 && (
          <Text style={styles.empty}>Nothing new since you last looked.</Text>
        )}
      </ScrollView>

      {editing && <TransactionEditor row={editing} onClose={() => setEditing(null)} />}
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
});
