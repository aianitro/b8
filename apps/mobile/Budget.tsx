// The budget page, at phone width — the coloured grid, as a grid.
//
// A DESIGN CALL WAS MADE HERE AND IT WAS WRONG, so the reasoning is kept rather than quietly
// replaced. The first version showed ONE CATEGORY AT A TIME with its twelve months down the page,
// arguing that twelve columns at 400px give 30px each and that horizontal scrolling hides eleven
// twelfths of a page behind a gesture. Both facts are true. The conclusion was not: the grid's value
// is reading ACROSS a row and DOWN a column, and a single-category view destroys the second
// entirely — you cannot see that three categories all went red in June.
//
// The owner asked for the web's grid and got a reinterpretation of it. The answer at this width is
// the one spreadsheets have always used: a frozen category column and the months scrolling under it,
// with COLOUR carrying the grading so a 58px cell does not have to spell out a ratio.
//
// Below the grid, the detail view survives as a second section — it was not wasted, and "how is
// Dining Out doing" is still a question worth answering without arithmetic.

import { useState } from 'react';
import {
  ActivityIndicator, Modal, Pressable, RefreshControl, ScrollView, StyleSheet, Text, View,
} from 'react-native';
import { useQuery } from '@tanstack/react-query';
import type { BudgetGridRow } from '@b8/contracts/budgetGrid';
import { fetchBudgetGrid } from './lib/api';
import { C, money, signed } from './widgets/tokens';
import { Kpi, KpiRow } from './widgets/Kpi';
import BudgetGrid from './widgets/BudgetGrid';

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** One month of one category: what was planned, what happened, and the gap. */
function MonthRow({ month, plan, actual, isCurrent, isFuture, isIncome }: {
  month: string; plan: number; actual: number;
  isCurrent: boolean; isFuture: boolean; isIncome: boolean;
}) {
  // A FUTURE MONTH HAS NO VARIANCE, and printing one would invent a finding. The web's grid client
  // makes the same distinction: in a future month the figure shown is the plan, not a shortfall.
  const variance = isFuture ? null : actual - plan;
  // For an expense, over plan is bad; for income, UNDER plan is bad. Same figure, opposite meaning —
  // collapsing them into one colour rule is how an income row ends up painted red for earning.
  const bad = variance === null ? false : isIncome ? variance < 0 : variance > 0;

  return (
    <View style={[styles.monthRow, isCurrent && styles.currentRow]}>
      <Text style={[styles.month, isCurrent && styles.currentText]}>{month}</Text>
      <Text style={styles.plan}>{plan === 0 ? '—' : money(plan)}</Text>
      <Text style={[styles.actual, isFuture && styles.future]}>
        {isFuture ? '' : money(actual)}
      </Text>
      <Text style={[styles.variance, bad ? { color: C.over } : { color: C.faint }]}>
        {variance === null || Math.round(variance) === 0 ? '' : signed(variance)}
      </Text>
    </View>
  );
}

function CategoryPicker({ rows, selectedId, onPick, onClose }: {
  rows: BudgetGridRow[]; selectedId: number; onPick: (id: number) => void; onClose: () => void;
}) {
  return (
    <Modal visible animationType="slide" onRequestClose={onClose}>
      <View style={styles.modal}>
        <Text style={styles.modalTitle}>Category</Text>
        <ScrollView>
          {rows.map((r) => (
            <Pressable
              key={r.id}
              style={[styles.pickRow, r.id === selectedId && styles.pickCurrent]}
              onPress={() => { onPick(r.id); onClose(); }}
            >
              <Text style={styles.pickName}>{r.category}</Text>
              <Text style={styles.pickYtd}>
                {money(r.ytd)}<Text style={styles.pickOf}> of {money(r.annualBudget)}</Text>
              </Text>
            </Pressable>
          ))}
        </ScrollView>
        <Pressable style={styles.cancel} onPress={onClose}>
          <Text style={styles.cancelText}>Close</Text>
        </Pressable>
      </View>
    </Modal>
  );
}

export default function Budget() {
  const [landscape, setLandscape] = useState<'operational' | 'capital'>('operational');
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [picking, setPicking] = useState(false);

  const { data, error, isFetching, refetch } = useQuery({
    queryKey: ['budgetGrid', landscape],
    queryFn: () => fetchBudgetGrid(landscape),
  });

  // Default to the first expense row rather than the first row outright: income leads the ordering,
  // and opening on "Salary" answers a question nobody came to this screen with.
  const rows = data?.rows ?? [];
  const selected =
    rows.find((r) => r.id === selectedId) ?? rows.find((r) => !r.isIncome) ?? rows[0];

  return (
    <View style={styles.screen}>
      <ScrollView
        contentContainerStyle={styles.content}
        refreshControl={<RefreshControl refreshing={isFetching} onRefresh={() => void refetch()} />}
      >
        <Text style={styles.heading}>Budget {data?.year ?? ''}</Text>

        <View style={styles.toggle}>
          {(['operational', 'capital'] as const).map((l) => (
            <Pressable
              key={l}
              style={[styles.toggleItem, landscape === l && styles.toggleActive]}
              onPress={() => { setLandscape(l); setSelectedId(null); }}
            >
              <Text style={[styles.toggleText, landscape === l && styles.toggleTextActive]}>
                {l}
              </Text>
            </Pressable>
          ))}
        </View>

        {isFetching && !data && <ActivityIndicator style={styles.spinner} />}
        {error && (
          <Text style={styles.error}>
            {error instanceof Error ? error.message : 'Could not load.'}
          </Text>
        )}

        {data && (
          <>
            <KpiRow>
              <Kpi label="Annual budget" value={money(data.totals.budget)} />
              <Kpi
                label="YTD spent"
                value={money(data.totals.spent)}
                sub={`${Math.round((data.totals.spent / Math.max(data.totals.budget, 1)) * 100)}% of budget`}
              />
              <Kpi
                label="Remaining"
                value={money(data.totals.remaining)}
                tone={data.totals.remaining < 0 ? 'over' : undefined}
              />
              <Kpi
                label="Projected P/L"
                value={signed(data.totals.projectedProfitLoss)}
                sub="if the plan holds"
                tone={data.totals.projectedProfitLoss < 0 ? 'over' : 'ok'}
              />
            </KpiRow>

            <View style={styles.gridBlock}>
              <Text style={styles.sectionTitle}>The year, by category</Text>
              <Text style={styles.gridHint}>
                top figure is actual, below it the plan · scroll sideways for the rest of the year
              </Text>
              <BudgetGrid rows={data.rows} currentMonth={data.currentMonth} />
            </View>

            {selected && (
              <View style={styles.categoryBlock}>
                <Text style={styles.sectionTitle}>One category, in full</Text>
                <Pressable style={styles.categoryHeader} onPress={() => setPicking(true)}>
                  <View style={styles.categoryLeft}>
                    <Text style={styles.categoryName}>{selected.category}</Text>
                    <Text style={styles.categorySub}>
                      {money(selected.ytd)} of {money(selected.annualBudget)} · tap to change
                    </Text>
                  </View>
                  <Text style={styles.chevron}>›</Text>
                </Pressable>

                <View style={styles.tableHead}>
                  <Text style={styles.headMonth} />
                  <Text style={styles.headCell}>plan</Text>
                  <Text style={styles.headCell}>actual</Text>
                  <Text style={styles.headCell}>vs plan</Text>
                </View>

                {MONTHS.map((m, i) => (
                  <MonthRow
                    key={m}
                    month={m}
                    plan={selected.plan[i]}
                    actual={selected.actual[i]}
                    isCurrent={i === data.currentMonth}
                    isFuture={i > data.currentMonth}
                    isIncome={selected.isIncome}
                  />
                ))}
              </View>
            )}

            {data.beginningBalance !== 0 && (
              <Text style={styles.footnote}>
                Beginning balance {money(data.beginningBalance)} — the figure the year nets against.
              </Text>
            )}
          </>
        )}
      </ScrollView>

      {picking && selected && (
        <CategoryPicker
          rows={rows}
          selectedId={selected.id}
          onPick={setSelectedId}
          onClose={() => setPicking(false)}
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: '#fff' },
  content: { padding: 20, paddingBottom: 48 },
  heading: { fontSize: 24, fontWeight: '700', color: C.ink },
  toggle: { flexDirection: 'row', gap: 8, marginTop: 14, marginBottom: 20 },
  toggleItem: { paddingHorizontal: 14, paddingVertical: 7, borderRadius: 16, backgroundColor: C.hair },
  toggleActive: { backgroundColor: C.ink },
  toggleText: { fontSize: 13, color: C.muted, fontWeight: '600', textTransform: 'capitalize' },
  toggleTextActive: { color: '#fff' },
  gridBlock: { marginTop: 28 },
  gridHint: { fontSize: 11, color: C.faint, marginBottom: 12, lineHeight: 16 },
  sectionTitle: { fontSize: 12, fontWeight: '700', letterSpacing: 0.6, color: C.muted, textTransform: 'uppercase', marginBottom: 8 },
  categoryBlock: { marginTop: 34 },
  categoryHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', borderWidth: 1, borderColor: C.line, borderRadius: 10, padding: 14 },
  categoryLeft: { flexShrink: 1 },
  categoryName: { fontSize: 18, fontWeight: '700', color: C.ink },
  categorySub: { fontSize: 12, color: C.faint, marginTop: 3 },
  chevron: { fontSize: 24, color: C.faint },
  tableHead: { flexDirection: 'row', marginTop: 18, paddingBottom: 6, borderBottomWidth: 1, borderBottomColor: C.line },
  headMonth: { width: 38 },
  headCell: { flex: 1, textAlign: 'right', fontSize: 10, color: C.faint, textTransform: 'uppercase', letterSpacing: 0.4 },
  monthRow: { flexDirection: 'row', alignItems: 'baseline', paddingVertical: 9, borderBottomWidth: 1, borderBottomColor: C.hair },
  currentRow: { backgroundColor: C.surface },
  month: { width: 38, fontSize: 13, color: C.muted },
  currentText: { color: C.ink, fontWeight: '700' },
  plan: { flex: 1, textAlign: 'right', fontSize: 13, color: C.faint, fontVariant: ['tabular-nums'] },
  actual: { flex: 1, textAlign: 'right', fontSize: 13, color: C.ink, fontVariant: ['tabular-nums'] },
  future: { color: C.faint },
  variance: { flex: 1, textAlign: 'right', fontSize: 13, fontVariant: ['tabular-nums'] },
  footnote: { fontSize: 12, color: C.faint, marginTop: 26, lineHeight: 18 },
  error: { fontSize: 14, color: C.over, lineHeight: 20 },
  spinner: { marginTop: 40 },
  modal: { flex: 1, backgroundColor: '#fff', paddingTop: 64, paddingHorizontal: 20 },
  modalTitle: { fontSize: 20, fontWeight: '700', color: C.ink, marginBottom: 16 },
  pickRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'baseline', paddingVertical: 14, borderBottomWidth: 1, borderBottomColor: C.hair },
  pickCurrent: { backgroundColor: C.surface },
  pickName: { fontSize: 16, color: C.ink, flexShrink: 1, paddingRight: 10 },
  pickYtd: { fontSize: 13, color: C.inkSoft, fontVariant: ['tabular-nums'] },
  pickOf: { color: C.faint },
  cancel: { paddingVertical: 18, alignItems: 'center' },
  cancelText: { fontSize: 16, color: C.muted },
});
