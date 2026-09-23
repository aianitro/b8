// The dashboard's KPI cards, at phone width.
//
// TWO PER ROW FOR MONEY, THREE FOR COUNTS. The web puts three across a wide grid; at 400px three
// columns leave ~110px each, which truncates a five-figure amount and turns it into a guess. That
// is an argument about FIGURES, not about columns — and it does not apply to a card whose value is
// "12". The `compact` variant below puts three counts on one line, which is what they are for: the
// three counts of things waiting on the owner are read together, and splitting them across rows
// made two of them look like they belonged with the money above.

import { Pressable, StyleSheet, Text, View } from 'react-native';
import { C } from './tokens';

export function Kpi({ label, value, sub, tone, onPress, expanded, compact }: {
  label: string;
  value: string;
  sub?: string;
  tone?: 'over' | 'ok' | 'warn';
  /** Makes the card a button. Omitted, it stays a plain card — see the note on the caret. */
  onPress?: () => void;
  /** Only read when `onPress` is set: which way the caret points. */
  expanded?: boolean;
  /** One of three on a row rather than one of two. For counts; see the note at the top. */
  compact?: boolean;
}) {
  const valueColor =
    tone === 'over' ? C.over : tone === 'ok' ? C.onTrack : tone === 'warn' ? C.warn : C.ink;

  const body = (
    <>
      <View style={styles.labelRow}>
        {/* Shrink-to-fit on the compact variant only. At a third of a phone a card has about 86px
            of content width, and "UNCATEGORIZED" needs more than that at 11px — so the one label
            that overflows loses a little size rather than the row losing a column or the name
            being abbreviated into something the owner does not recognise. */}
        <Text
          style={styles.label}
          numberOfLines={compact ? 1 : undefined}
          adjustsFontSizeToFit={compact}
          minimumFontScale={0.75}
        >
          {label}
        </Text>
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

  const shape = [styles.card, compact && styles.cardCompact];

  if (!onPress) return <View style={shape}>{body}</View>;

  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityState={{ expanded: expanded ?? false }}
      accessibilityLabel={`${label}, ${value}${sub ? `, ${sub}` : ''}`}
      style={({ pressed }) => [...shape, styles.cardPressable, pressed && styles.cardPressed]}
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
  // `flexBasis: 0` with an equal grow, rather than a percentage: three cards at 30% plus two gaps
  // overflow the row and wrap, which is the bug this variant exists to avoid. Zero basis lets flex
  // divide what is left after the gaps, so three columns always fit exactly. `minWidth: 0` is what
  // stops a long label from forcing the card wider than its share.
  cardCompact: { flexBasis: 0, flexGrow: 1, flexShrink: 1, minWidth: 0, padding: 11 },
  cardPressable: { borderColor: C.faint },
  cardPressed: { backgroundColor: C.hair },
  labelRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  label: { fontSize: 11, fontWeight: '600', letterSpacing: 0.5, color: C.faint, textTransform: 'uppercase' },
  caret: { fontSize: 11, color: C.muted, marginLeft: 6 },
  value: { fontSize: 22, fontWeight: '700', marginTop: 5, fontVariant: ['tabular-nums'] },
  sub: { fontSize: 12, color: C.faint, marginTop: 3 },
});
