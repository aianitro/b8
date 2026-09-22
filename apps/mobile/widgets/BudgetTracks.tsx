// The year by category — the dashboard's BudgetTracks.
//
// NO SVG, deliberately. The web version is not a chart library either: it is divs with widths, and a
// track sized by budget and filled by spend ports to two nested Views exactly. Reaching for a chart
// library here would add a dependency to draw a rectangle.
//
// THE SCALE IS THE LARGEST BUDGET, NOT THE LARGEST SPEND, which is the web version's own choice and
// worth preserving: the track IS the allocation, so scaling to spend would make an overspent
// category redefine what every other row's width means.

import { StyleSheet, Text, View } from 'react-native';
import { C, money } from './tokens';

export interface TrackRow {
  category: string;
  budget: string;
  spent: string;
}

export default function BudgetTracks({ rows, yearElapsed }: {
  rows: TrackRow[];
  /** 0–1. The tick showing how much of the year has gone. */
  yearElapsed: number;
}) {
  const usable = rows.filter((r) => Number(r.budget) > 0 || Number(r.spent) > 0);
  if (usable.length === 0) return null;

  const maxBudget = Math.max(...usable.map((r) => Math.max(Number(r.budget), Number(r.spent))), 1);
  const pacePct = Math.round(yearElapsed * 100);

  return (
    <View>
      <Text style={styles.caption}>
        track = annual budget · fill = spent · tick = {pacePct}% of the year gone
      </Text>
      {usable.map((r) => {
        const budget = Number(r.budget);
        const spent = Number(r.spent);
        const trackPct = (Math.max(budget, spent) / maxBudget) * 100;
        const fillPct = Math.max(budget, spent) === 0 ? 0 : (spent / Math.max(budget, spent)) * 100;
        const over = budget > 0 && spent > budget;
        // The pace tick sits at the elapsed fraction OF THIS ROW'S BUDGET, not of the widest track,
        // so it answers "is this category ahead of the year" rather than a question about the chart.
        const tickPct = budget > 0 ? (budget / Math.max(budget, spent)) * 100 * yearElapsed : 0;

        return (
          <View key={r.category} style={styles.row}>
            <View style={styles.header}>
              <Text style={styles.category} numberOfLines={1}>{r.category}</Text>
              <Text style={[styles.amount, over && { color: C.over }]}>
                {money(spent)}<Text style={styles.ofBudget}> of {money(budget)}</Text>
              </Text>
            </View>
            <View style={[styles.track, { width: `${trackPct}%` }]}>
              <View
                style={[
                  styles.fill,
                  { width: `${fillPct}%`, backgroundColor: over ? C.over : C.accent },
                ]}
              />
              {tickPct > 0 && tickPct < 100 && (
                <View style={[styles.tick, { left: `${tickPct}%` }]} />
              )}
            </View>
          </View>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  caption: { fontSize: 11, color: C.faint, marginBottom: 12, lineHeight: 16 },
  row: { marginBottom: 13 },
  header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 5 },
  category: { fontSize: 14, color: C.ink, flexShrink: 1, paddingRight: 10 },
  amount: { fontSize: 12, color: C.inkSoft, fontVariant: ['tabular-nums'] },
  ofBudget: { color: C.faint },
  // The track is the allocation; `overflow: hidden` keeps the fill's rounded end inside it.
  track: { height: 12, borderRadius: 3, backgroundColor: C.hair, minWidth: 8, position: 'relative', overflow: 'hidden' },
  fill: { height: 12, borderRadius: 3 },
  tick: { position: 'absolute', top: -2, width: 1.5, height: 16, backgroundColor: C.muted },
});
