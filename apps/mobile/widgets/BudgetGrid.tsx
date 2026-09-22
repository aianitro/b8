// The monthly budget grid, as a grid.
//
// A HORIZONTAL SCROLL WITH A FROZEN CATEGORY COLUMN, which is the shape a spreadsheet takes on a
// phone and the one the owner asked for. An earlier version of this screen showed one category at a
// time with its months down the page — defensible, and not what was wanted: the grid's whole value
// is reading ACROSS a row and DOWN a column, and a single-category view destroys the second.
//
// The cells are graded by `@b8/contracts/budgetCellState`, the same functions the web calls. This
// file only paints; the thresholds are shared so the two clients cannot disagree about what "over
// budget" means.

import { ScrollView, StyleSheet, Text, View } from 'react-native';
import type { BudgetGridRow } from '@b8/contracts/budgetGrid';
import { expenseCellState, incomeCellState } from '@b8/contracts/budgetCellState';
import { CELL_BG, CELL_BOLD, CELL_TEXT } from './cellColors';
import { C } from './tokens';

const MONTHS = ['J', 'F', 'M', 'A', 'M', 'J', 'J', 'A', 'S', 'O', 'N', 'D'];
const FULL = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

const NAME_W = 104;
const CELL_W = 58;
const ROW_H = 44;

/** Compact money for a 58px cell: `$1.2k` rather than `$1,240`, which does not fit. */
function cellMoney(v: number): string {
  const n = Math.round(Math.abs(v));
  if (n === 0) return '0';
  if (n >= 10000) return `${Math.round(n / 1000)}k`;
  if (n >= 1000) return `${(n / 1000).toFixed(1)}k`;
  return String(n);
}

function Cell({ row, i, currentMonth }: { row: BudgetGridRow; i: number; currentMonth: number }) {
  const isFuture = i > currentMonth;
  const actual = row.actual[i];
  const plan = row.plan[i];
  // Off-cycle is a finding ONLY for a scheduled category: a zero plan with no schedule means "no
  // budget configured", which is neutral. Without `hasSchedule` every unbudgeted category would
  // paint as a breach — which is why the contract carries the flag rather than inferring it.
  const offCycle = row.hasSchedule && plan === 0 && actual !== 0;

  // An income category that nets an expense — or the reverse — is always notable, and is not graded
  // by magnitude the way an over-budget expense is.
  const inverted = !isFuture && actual < 0;

  const state = inverted
    ? 'inverted'
    : row.isIncome
      ? incomeCellState(actual, plan, isFuture, offCycle)
      : expenseCellState(actual, plan, isFuture, offCycle);

  const upcoming = row.upcoming[i];

  return (
    <View style={[styles.cell, { backgroundColor: CELL_BG[state] }]}>
      <Text
        style={[
          styles.cellTop,
          { color: CELL_TEXT[state] },
          CELL_BOLD.has(state) && styles.bold,
        ]}
        numberOfLines={1}
      >
        {/* A future month has no actual, so the top line is a spacer rather than an omission — it
            holds the row open so projections land on the same baseline as actuals either side. */}
        {isFuture ? ' ' : `${inverted ? '−' : ''}${cellMoney(actual)}`}
      </Text>
      <Text style={styles.cellBottom} numberOfLines={1}>
        {isFuture
          ? (upcoming !== 0 ? cellMoney(upcoming) : '')
          : offCycle
            ? 'off-plan'
            : plan > 0 && (actual !== 0 || i === currentMonth)
              ? cellMoney(plan)
              : ''}
      </Text>
    </View>
  );
}

export default function BudgetGrid({ rows, currentMonth }: {
  rows: BudgetGridRow[];
  currentMonth: number;
}) {
  if (rows.length === 0) return null;

  return (
    <View style={styles.wrap}>
      {/* The category column sits OUTSIDE the horizontal scroll, so a row keeps its name however
          far across the year you are. A grid whose labels scroll away is twelve columns of
          anonymous numbers. */}
      <View style={styles.names}>
        <View style={[styles.nameCell, styles.headCell]}>
          <Text style={styles.headText}>category</Text>
        </View>
        {rows.map((r) => (
          <View key={r.id} style={styles.nameCell}>
            <Text style={styles.nameText} numberOfLines={2}>{r.category}</Text>
          </View>
        ))}
      </View>

      <ScrollView horizontal showsHorizontalScrollIndicator contentContainerStyle={styles.scrollInner}>
        <View>
          <View style={styles.headRow}>
            {MONTHS.map((m, i) => (
              <View key={i} style={[styles.cell, styles.headCell, i === currentMonth && styles.headCurrent]}>
                <Text style={[styles.headText, i === currentMonth && styles.headTextCurrent]}>
                  {FULL[i].slice(0, 3)}
                </Text>
              </View>
            ))}
          </View>
          {rows.map((r) => (
            <View key={r.id} style={styles.dataRow}>
              {MONTHS.map((_, i) => (
                <Cell key={i} row={r} i={i} currentMonth={currentMonth} />
              ))}
            </View>
          ))}
        </View>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { flexDirection: 'row' },
  scrollInner: { paddingRight: 4 },
  names: { borderRightWidth: 1, borderRightColor: C.line },
  nameCell: { width: NAME_W, height: ROW_H, justifyContent: 'center', paddingRight: 8, borderBottomWidth: 1, borderBottomColor: C.hair },
  nameText: { fontSize: 12, color: C.ink, lineHeight: 15 },
  headRow: { flexDirection: 'row' },
  dataRow: { flexDirection: 'row' },
  cell: { width: CELL_W, height: ROW_H, alignItems: 'center', justifyContent: 'center', borderBottomWidth: 1, borderBottomColor: C.hair, borderRightWidth: 1, borderRightColor: C.hair },
  headCell: { height: 26, backgroundColor: '#fff' },
  headCurrent: { backgroundColor: C.hair },
  headText: { fontSize: 10, color: C.faint, textTransform: 'uppercase', letterSpacing: 0.4 },
  headTextCurrent: { color: C.ink, fontWeight: '700' },
  cellTop: { fontSize: 12, fontVariant: ['tabular-nums'] },
  bold: { fontWeight: '700' },
  cellBottom: { fontSize: 9, color: C.faint, marginTop: 1, fontVariant: ['tabular-nums'] },
});
