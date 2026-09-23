// What has landed since yesterday, as an expandable list under the KPI row.
//
// ─── Why a count with a list under it, rather than a section of its own ───────────────────────
//
// It sits beside Uncategorized and Keep an eye because it is the same kind of thing: a count of
// rows waiting on the owner rather than a figure to read. All three are glanced at together and
// only one of them is usually interesting, which is exactly the shape a KPI answers well and a
// permanent section answers badly — the dashboard is already a long scroll.
//
// ─── The count is not the list's length ───────────────────────────────────────────────────────
//
// `recentArrivals` is capped at twelve by its reader; `recentArrivalsTotal` is counted over the
// same predicate before that limit. A card counting the array would read "12" whether twelve
// arrived or forty did, which is wrong in the flattering direction. When the two differ the list
// says so rather than quietly showing a page of a larger set.
//
// ─── An arrival can also be WATCHED ───────────────────────────────────────────────────────────
//
// This list has no watched bound and the watchlist has no date bound, so a row flagged today that
// also landed today is in both. The payload carries the flag and the note for exactly that reason,
// and the editor opens from them rather than from an assumption.

import { useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import type { OverviewData } from '@b8/contracts/overview';
import TransactionEditor, { type EditableTransaction } from './TransactionEditor';
import { C } from './tokens';

type Arrival = OverviewData['recentArrivals'][number];

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** Cents: these are specific charges being checked, not a chart. */
const exact = (v: string | number) => {
  const n = Number(v);
  return `$${Math.abs(n).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
};

const shortDate = (iso: string) => {
  const [, m, d] = iso.split('-').map(Number);
  return `${MONTHS[m - 1]} ${d}`;
};

export default function Arrivals({ items, total }: { items: Arrival[]; total: number }) {
  const [editing, setEditing] = useState<EditableTransaction | null>(null);

  // Not an early return when the list empties — unflagging or recategorising from the editor
  // invalidates `overview`, and returning null would unmount the modal the owner is standing in.
  if (items.length === 0 && editing === null) return null;

  return (
    <View style={styles.list}>
      {items.length > 0 && (
        <Text style={styles.hint}>
          {total > items.length
            ? `Showing the ${items.length} largest of ${total}. Tap to edit.`
            : 'Tap an arrival to edit it.'}
        </Text>
      )}

      {items.map((item) => {
        // Money in keeps its sign and goes green. A refund in the window is a negative arrival and
        // reads as another charge to anyone moving quickly.
        const amount = Number(item.amount);
        const inbound = amount < 0;
        return (
          <Pressable
            key={item.id}
            onPress={() => setEditing({
              id: item.id, label: item.label, date: item.date, amount: item.amount,
              category: item.category, watched: item.watched, note: item.note,
            })}
            accessibilityRole="button"
            accessibilityHint="Edit its category, note, or flag"
            style={({ pressed }) => [styles.row, pressed && styles.rowPressed]}
          >
            <View style={styles.top}>
              <Text style={styles.label} numberOfLines={1}>{item.label}</Text>
              <Text style={[styles.amount, inbound && { color: C.moneyIn }]}>
                {inbound ? '+' : ''}{exact(amount)}
              </Text>
            </View>
            <View style={styles.bottom}>
              {/* Uncategorised is the actionable state on this list, so it is named rather than
                  left blank — a gap reads as a rendering fault, not as work to do. */}
              <Text style={[styles.meta, !item.category && styles.needsCategory]} numberOfLines={1}>
                {item.category ?? 'needs a category'}
                {item.watched ? ' · on Keep an eye' : ''}
              </Text>
              <Text style={styles.meta}>{shortDate(item.date)}</Text>
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
  hint: { fontSize: 11, color: C.faint, marginBottom: 2 },
  row: { paddingVertical: 9, borderBottomWidth: 1, borderBottomColor: C.hair },
  rowPressed: { opacity: 0.5 },
  top: { flexDirection: 'row', alignItems: 'baseline', justifyContent: 'space-between', gap: 10 },
  bottom: { flexDirection: 'row', alignItems: 'baseline', justifyContent: 'space-between', gap: 10, marginTop: 2 },
  label: { flex: 1, fontSize: 15, color: C.ink },
  amount: { fontSize: 15, color: C.inkSoft, fontVariant: ['tabular-nums'] },
  meta: { fontSize: 12, color: C.faint },
  needsCategory: { color: C.warn },
});
