// The dashboard's KPI cards, at phone width.
//
// TWO PER ROW, NOT THREE. The web puts three across a wide grid; at 400px three columns leave ~110px
// each, which truncates a five-figure amount and turns it into a guess. Two columns is the same
// information at a size that can be read.

import { Pressable, StyleSheet, Text, View } from 'react-native';
import { C } from './tokens';

export function Kpi({ label, value, sub, tone, onPress, expanded }: {
  label: string;
  value: string;
  sub?: string;
  tone?: 'over' | 'ok' | 'warn';
  /** Makes the card a button. Omitted, it stays a plain card — see the note on the caret. */
  onPress?: () => void;
  /** Only read when `onPress` is set: which way the caret points. */
  expanded?: boolean;
}) {
  const valueColor =
    tone === 'over' ? C.over : tone === 'ok' ? C.onTrack : tone === 'warn' ? C.warn : C.ink;

  const body = (
    <>
      <View style={styles.labelRow}>
        <Text style={styles.label}>{label}</Text>
        {/* THE CARET IS THE ONLY THING THAT SAYS THIS CARD IS DIFFERENT. Three of the four cards
            beside it do nothing when tapped, so a tappable one with no mark on it is a control
            nobody finds — and on a phone there is no hover to discover it with. A caret costs one
            glyph and no dependency; the app has no icon set and does not need one to draw this. */}
        {onPress && <Text style={styles.caret}>{expanded ? '\u25be' : '\u25b8'}</Text>}
      </View>
      <Text style={[styles.value, { color: valueColor }]} numberOfLines={1} adjustsFontSizeToFit>
        {value}
      </Text>
      {sub ? <Text style={styles.sub}>{sub}</Text> : null}
    </>
  );

  if (!onPress) return <View style={styles.card}>{body}</View>;

  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityState={{ expanded: expanded ?? false }}
      accessibilityLabel={`${label}, ${value}${sub ? `, ${sub}` : ''}`}
      style={({ pressed }) => [styles.card, styles.cardPressable, pressed && styles.cardPressed]}
    >
      {body}
    </Pressable>
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
  cardPressable: { borderColor: C.faint },
  cardPressed: { backgroundColor: C.hair },
  labelRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  label: { fontSize: 11, fontWeight: '600', letterSpacing: 0.5, color: C.faint, textTransform: 'uppercase' },
  caret: { fontSize: 11, color: C.muted, marginLeft: 6 },
  value: { fontSize: 22, fontWeight: '700', marginTop: 5, fontVariant: ['tabular-nums'] },
  sub: { fontSize: 12, color: C.faint, marginTop: 3 },
});
