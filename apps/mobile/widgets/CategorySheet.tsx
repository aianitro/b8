// What one tile is, in full: the figure that made you tap, and the charges that add up to it.
//
// ─── The SECOND tap opens this ────────────────────────────────────────────────────────────────
//
// On the web these are two gestures: a bubble shows its figures on HOVER and opens /transactions
// on CLICK. A phone has no hover, so the first version put both in here and opened it on one tap.
// That was wrong, and the owner said so: a treemap exists for COMPARISON, and a sheet on every tap
// makes comparing two categories cost six gestures — tap, read, close, tap, read, close — to answer
// the question the map was supposed to answer without leaving it.
//
// So the cheap answer stays on the map as one line, and this opens on a deliberate second tap. It
// carries what a line cannot: the projection, and every charge behind the figure. The summary is
// repeated at the top rather than assumed, because a sheet that covers the map must not require the
// reader to remember what was underneath it.
//
// ─── The rows are the audit of the figure above them ──────────────────────────────────────────
//
// `GET /api/v1/transactions` filters exactly as the tile's own figure does — tracked accounts,
// not hidden, exact category, bounded at today — so the rows add up to the total. Verified against
// this ledger: for all sixteen categories a tile can lead to, the two agree to the cent. The three
// that differ are income, and income never becomes a tile.
//
// The total shown here is the ENDPOINT's, computed over the whole set by the database, not a sum
// taken over the rows on screen. They are the same today because nothing is limited; the day a
// limit arrives they stop being, and a total a reader can add up and find wrong is worse than no
// total at all.

import { ActivityIndicator, Modal, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useQuery } from '@tanstack/react-query';
import type { OverviewData } from '@b8/contracts/overview';
import { bubbleState } from '@b8/contracts/bubbleStatus';
import { fetchCategoryTransactions } from '../lib/api';
import { categoryIcon } from './categoryIcon';
import { C, money } from './tokens';

type MonthCategory = OverviewData['monthCategories'][number];

const MONTHS = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];

/** Cents. These are specific charges being checked against a statement, not a chart. */
const exact = (v: string | number) => {
  const n = Number(v);
  return `${n < 0 ? '−' : ''}$${Math.abs(n).toLocaleString('en-US', {
    minimumFractionDigits: 2, maximumFractionDigits: 2,
  })}`;
};

/** "Sep 14" — the year is in the header and repeating it on every row is noise. */
const shortDate = (iso: string) => {
  const [, m, d] = iso.split('-').map(Number);
  return `${MONTHS[m - 1].slice(0, 3)} ${d}`;
};

export default function CategorySheet({ category, month, onClose }: {
  /** The tile's own figures, already on screen — shown immediately, before any request. */
  category: MonthCategory;
  /** 1–12. The month the map is showing. */
  month: number;
  onClose: () => void;
}) {
  const { data, error, isLoading } = useQuery({
    queryKey: ['categoryTransactions', category.category, month],
    queryFn: () => fetchCategoryTransactions(category.category, month),
  });

  const budgeted = Number(category.budgeted);
  const actual = Number(category.actual);
  const over = actual - budgeted;
  const state = bubbleState({
    budgeted, actual,
    projectedRatio: category.projectedRatio,
    tooEarly: category.tooEarly,
  });

  return (
    <Modal visible animationType="slide" transparent onRequestClose={onClose}>
      {/* THE BACKDROP IS A SIBLING BEHIND THE SHEET, NOT A PARENT OF IT.

          Wrapping the sheet in a Pressable — the obvious way to get "tap outside to close" while
          swallowing taps inside — froze the list. A Pressable is a touch responder, and a drag that
          begins inside one lets it claim the gesture before the ScrollView can, so the list simply
          refused to move. Absolutely positioning the dimmed area behind the sheet gets the same two
          behaviours with no ancestor competing for the scroll. */}
      <View style={styles.wrap}>
        <Pressable
          style={styles.backdrop}
          onPress={onClose}
          accessibilityRole="button"
          accessibilityLabel="Close"
        />
        <View style={styles.sheet}>
          <View style={styles.grabber} />

          <View style={styles.header}>
            <Text style={styles.icon}>{categoryIcon(category.category)}</Text>
            <View style={styles.headerText}>
              {/* The NAME, spelled out. The map labels this category with a glyph alone, so this
                  is where a reader confirms which one they actually hit. */}
              <Text style={styles.title} numberOfLines={2}>{category.category}</Text>
              <Text style={styles.subtitle}>{MONTHS[month - 1]} so far</Text>
            </View>
            <Pressable onPress={onClose} hitSlop={12} accessibilityRole="button" accessibilityLabel="Close">
              <Text style={styles.close}>✕</Text>
            </Pressable>
          </View>

          <View style={styles.summary}>
            <Text style={[styles.spent, state === 'over' && { color: C.over }]}>
              {money(actual)}
              <Text style={styles.ofBudget}> of {money(budgeted)}</Text>
            </Text>
            {/* Over means spent PAST the line, not projected to pass it — the same split the tile
                colour makes. Only one of these is money that has actually left. */}
            {over > 0 && <Text style={styles.over}>{money(over)} over already</Text>}
            {category.tooEarly && <Text style={styles.note}>Too early in the month to project.</Text>}
            {!category.tooEarly && category.projectedRatio !== null && (
              <Text style={[styles.note, state === 'heading-over' && { color: C.warn }]}>
                Projects to close at {Math.round(category.projectedRatio * 100)}% of budget.
              </Text>
            )}
          </View>

          <ScrollView style={styles.list} contentContainerStyle={styles.listContent}>
            {isLoading && <ActivityIndicator style={styles.spinner} />}
            {error && (
              <Text style={styles.error}>
                {error instanceof Error ? error.message : 'Could not load these transactions.'}
              </Text>
            )}
            {data && data.rows.length === 0 && (
              <Text style={styles.empty}>Nothing has posted to this category yet this month.</Text>
            )}
            {data?.rows.map((row) => {
              // Money in keeps its sign and goes green. A refund rendered as a bare figure in a
              // list of charges reads as another charge to anyone moving quickly.
              const inbound = Number(row.amount) < 0;
              return (
                <View key={row.id} style={styles.row}>
                  <View style={styles.rowTop}>
                    <Text style={styles.label} numberOfLines={1}>{row.label}</Text>
                    <Text style={[styles.amount, inbound && { color: C.moneyIn }]}>
                      {inbound ? '+' : ''}{exact(Math.abs(Number(row.amount)))}
                    </Text>
                  </View>
                  <View style={styles.rowBottom}>
                    <Text style={styles.account} numberOfLines={1}>{row.account}</Text>
                    <Text style={styles.date}>{shortDate(row.date)}</Text>
                  </View>
                </View>
              );
            })}
            {data && data.rows.length > 0 && (
              <View style={styles.totalRow}>
                <Text style={styles.totalLabel}>
                  {data.count} {data.count === 1 ? 'transaction' : 'transactions'}
                </Text>
                <Text style={styles.totalAmount}>{exact(data.spent)}</Text>
              </View>
            )}
          </ScrollView>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  wrap: { flex: 1, justifyContent: 'flex-end' },
  backdrop: { position: 'absolute', left: 0, top: 0, right: 0, bottom: 0, backgroundColor: 'rgba(17,24,39,0.45)' },
  // Capped rather than full-height: the map stays visible above it, so the tap that opened this
  // still has a visible origin and closing does not feel like navigating back from somewhere.
  sheet: { backgroundColor: '#fff', borderTopLeftRadius: 18, borderTopRightRadius: 18, maxHeight: '85%', paddingBottom: 28 },
  grabber: { alignSelf: 'center', width: 36, height: 4, borderRadius: 2, backgroundColor: C.line, marginTop: 8, marginBottom: 6 },
  header: { flexDirection: 'row', alignItems: 'flex-start', gap: 10, paddingHorizontal: 20, paddingTop: 6 },
  icon: { fontSize: 26, marginTop: 1 },
  headerText: { flex: 1 },
  title: { fontSize: 19, fontWeight: '700', color: C.ink },
  subtitle: { fontSize: 12, color: C.faint, marginTop: 1 },
  close: { fontSize: 17, color: C.faint, paddingHorizontal: 2 },
  summary: { paddingHorizontal: 20, paddingTop: 12, paddingBottom: 14, borderBottomWidth: 1, borderBottomColor: C.hair },
  spent: { fontSize: 24, fontWeight: '700', color: C.ink, fontVariant: ['tabular-nums'] },
  ofBudget: { fontSize: 14, fontWeight: '400', color: C.faint },
  over: { fontSize: 13, color: C.over, fontWeight: '600', marginTop: 3 },
  note: { fontSize: 13, color: C.muted, marginTop: 3 },
  // `flexShrink: 1` is what makes this SCROLL rather than clip. The sheet is capped at 85% of the
  // screen, and a ScrollView with no shrink lays itself out at full content height inside that cap:
  // the rows past the fold are rendered, clipped and unreachable, which looks exactly like a frozen
  // list. Shrinking bounds it to the space left after the header and summary, and the overflow
  // becomes scroll.
  list: { flexShrink: 1, paddingHorizontal: 20 },
  listContent: { paddingTop: 4, paddingBottom: 8 },
  row: { paddingVertical: 9, borderBottomWidth: 1, borderBottomColor: C.hair },
  rowTop: { flexDirection: 'row', alignItems: 'baseline', justifyContent: 'space-between', gap: 10 },
  rowBottom: { flexDirection: 'row', alignItems: 'baseline', justifyContent: 'space-between', gap: 10, marginTop: 2 },
  label: { flex: 1, fontSize: 15, color: C.ink },
  amount: { fontSize: 15, color: C.inkSoft, fontVariant: ['tabular-nums'] },
  account: { flex: 1, fontSize: 12, color: C.faint },
  date: { fontSize: 12, color: C.faint },
  totalRow: { flexDirection: 'row', justifyContent: 'space-between', paddingTop: 11, marginTop: 2 },
  totalLabel: { fontSize: 12, color: C.faint },
  totalAmount: { fontSize: 15, fontWeight: '700', color: C.ink, fontVariant: ['tabular-nums'] },
  spinner: { marginTop: 28 },
  error: { fontSize: 14, color: C.over, lineHeight: 20, marginTop: 16 },
  empty: { fontSize: 13, color: C.faint, marginTop: 16 },
});
