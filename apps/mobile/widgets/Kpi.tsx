// The dashboard's KPI cards, at phone width.
//
// TWO PER ROW, NOT THREE. The web puts three across a wide grid; at 400px three columns leave ~110px
// each, which truncates "$12,480" and turns a figure into a guess. Two columns is the same
// information at a size that can be read.

import { StyleSheet, Text, View } from 'react-native';
import { C } from './tokens';

export function Kpi({ label, value, sub, tone }: {
  label: string;
  value: string;
  sub?: string;
  tone?: 'over' | 'ok' | 'warn';
}) {
  const valueColor =
    tone === 'over' ? C.over : tone === 'ok' ? C.onTrack : tone === 'warn' ? C.warn : C.ink;
  return (
    <View style={styles.card}>
      <Text style={styles.label}>{label}</Text>
      <Text style={[styles.value, { color: valueColor }]} numberOfLines={1} adjustsFontSizeToFit>
        {value}
      </Text>
      {sub ? <Text style={styles.sub}>{sub}</Text> : null}
    </View>
  );
}

export function KpiRow({ children }: { children: React.ReactNode }) {
  return <View style={styles.row}>{children}</View>;
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
  // `minWidth` with `flexGrow` rather than a fixed 48% width: a single card in a row then fills it
  // instead of leaving a gap where its pair would have been.
  card: { flexGrow: 1, flexBasis: '46%', minWidth: 150, borderWidth: 1, borderColor: C.line, borderRadius: 10, padding: 13 },
  label: { fontSize: 11, fontWeight: '600', letterSpacing: 0.5, color: C.faint, textTransform: 'uppercase' },
  value: { fontSize: 22, fontWeight: '700', marginTop: 5, fontVariant: ['tabular-nums'] },
  sub: { fontSize: 12, color: C.faint, marginTop: 3 },
});
