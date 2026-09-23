// What the owner said they were not finished with — the web's WatchlistCard, at phone width.
//
// ─── Why this opens from a KPI instead of sitting on the screen ───────────────────────────────
//
// On the web this is a permanent card under the bubbles, which is right for a page that can afford
// one. A phone cannot: the dashboard is already a long scroll, and a list that is usually two rows
// and occasionally ten would push the pictures below it by an amount that changes day to day. So
// the COUNT lives in the KPI row, where it is read in the same glance as Uncategorized, and the
// rows themselves open underneath on tap.
//
// The count is the part that earns permanent space. A watchlist's job is to stop something being
// forgotten, and for that a number the eye passes over every morning is enough — the rows only
// matter once the number is surprising.
//
// ─── The age is the column that changes ───────────────────────────────────────────────────────
//
// Carried over from the web, because it is the reason this widget is not wallpaper. A list that
// says only WHAT is on it reads the same every morning until the eye stops seeing it. The number
// that moves is the age, and it is the one that should eventually feel wrong: a return pending
// three days is a process, one pending thirty is a refund nobody is going to chase.
//
// AMBER PAST TWO WEEKS, NEVER RED, and the threshold is `@b8/contracts/overview`'s rather than a
// second 14 typed here. Nothing on a watchlist is an error.

import { useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { type OverviewData, watchlistIsStale } from '@b8/contracts/overview';
import TransactionEditor, { type EditableTransaction } from './TransactionEditor';
import { C } from './tokens';

type Watched = OverviewData['watchlist'][number];

/** Whole days since the flag, as a phrase. Matches the web's wording exactly. */
export const age = (days: number) => (days === 0 ? 'today' : days === 1 ? '1 day' : `${days} days`);

/** Cents, not whole dollars: these are specific transactions being chased, not a chart. */
const exact = (n: number) =>
  `$${Math.abs(n).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

export default function Watchlist({ items }: { items: Watched[] }) {
  // Held here rather than lifted to the dashboard: this widget owns the rows, and a screen that
  // does not render the list has no business knowing which of its rows is being edited.
  const [editing, setEditing] = useState<EditableTransaction | null>(null);

  // NOT AN EARLY RETURN WHEN THE LIST EMPTIES. Unflagging the last entry from the editor
  // invalidates `overview`, the list refetches to nothing — and returning null here would unmount
  // the modal the owner is still standing in, mid-edit, before they had finished changing its
  // category. The rows go; the editor stays until it is dismissed.
  if (items.length === 0 && editing === null) return null;

  return (
    <View style={styles.list}>
      {items.length > 0 && <Text style={styles.hint}>Tap an entry to edit it.</Text>}
      {items.map((item) => {
        const stale = watchlistIsStale(item.daysOpen);
        // Money in keeps its sign and goes green. A refund rendered as a bare figure in a list of
        // charges reads as another charge to anyone moving quickly — and on this list a refund
        // landing is very often the exact thing being waited for.
        const amount = Number(item.amount);
        const inbound = amount < 0;
        return (
          // THE LIST YOU ACT ON IS THE LIST YOU EDIT. Until now a row here could only be changed
          // by finding it again on Arrivals or under its category tile — and a watchlist whose
          // entries cannot be resolved where they are read is a list that grows.
          <Pressable
            key={item.id}
            onPress={() => setEditing({
              id: item.id, label: item.label, date: item.date, amount: item.amount,
              category: item.category,
              // Every row on this list is flagged by definition — that is what the list is.
              watched: true,
              note: item.note,
            })}
            accessibilityRole="button"
            accessibilityHint="Edit its category, note, or flag"
            style={({ pressed }) => [styles.row, pressed && styles.rowPressed]}
          >
            {/* Two lines rather than the web's five columns. At 360px the label, the note, the
                amount and the age cannot share a row without every one of them truncating; the
                web has the width and this does not. Identity and money on top, reason and age
                underneath, which keeps the two things a reader compares — what it is and how
                long it has sat — on the same side of the card. */}
            <View style={styles.top}>
              <Text style={styles.label} numberOfLines={1}>{item.label}</Text>
              <Text style={[styles.amount, inbound && { color: C.moneyIn }]}>
                {inbound ? '+' : ''}{exact(amount)}
              </Text>
            </View>
            <View style={styles.bottom}>
              <Text style={[styles.note, !item.note && styles.noteEmpty]} numberOfLines={1}>
                {item.note ?? 'no reason given'}
              </Text>
              <Text style={[styles.age, stale && styles.ageStale]}>{age(item.daysOpen)}</Text>
            </View>
          </Pressable>
        );
      })}

      {editing && <TransactionEditor row={editing} onClose={() => setEditing(null)} />}
    </View>
  );
}

const styles = StyleSheet.create({
  list: { marginTop: 12 },
  row: { paddingVertical: 9, borderBottomWidth: 1, borderBottomColor: C.hair },
  rowPressed: { opacity: 0.5 },
  hint: { fontSize: 11, color: C.faint, marginBottom: 2 },
  top: { flexDirection: 'row', alignItems: 'baseline', justifyContent: 'space-between', gap: 10 },
  bottom: { flexDirection: 'row', alignItems: 'baseline', justifyContent: 'space-between', gap: 10, marginTop: 2 },
  label: { flex: 1, fontSize: 15, color: C.ink },
  amount: { fontSize: 15, color: C.inkSoft, fontVariant: ['tabular-nums'] },
  note: { flex: 1, fontSize: 12, color: C.faint },
  noteEmpty: { fontStyle: 'italic', color: C.line },
  age: { fontSize: 12, color: C.faint },
  ageStale: { color: C.warn, fontWeight: '600' },
});
