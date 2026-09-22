// Money in, money out, and where the year nets out — the dashboard's ProfitLossChart, natively.
//
// ONE AXIS. The web version's own comment says bars and line share one scale rather than being split
// across a left and a right, and the dataviz skill calls a dual axis the single most common chart
// mistake. Preserved exactly: the bars and the cumulative line are drawn against the same domain.
//
// POSITION IS THE IDENTITY, NOT COLOUR. `scripts/validate_palette.js` rates money-in green against
// money-out orange at ΔE 6.2 for deuteranopia — inside the 6–8 floor band, legal only with secondary
// encoding. Money in is drawn ABOVE the zero line and money out BELOW it, so the two series are
// distinguishable with no colour vision at all. The validator also warns both are under 3:1 against
// the surface, which obligates labels or a table view; `PlFigures` below is that relief and is part
// of the widget rather than an option.

import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import Svg, { Line, Path, Rect } from 'react-native-svg';
import { C, money } from './tokens';

export interface PlPoint {
  month: string;
  /** Money out, positive. */
  operational: string;
  /** Money in, positive. */
  received: string;
}

const H = 150;
const PAD_TOP = 10;
const PAD_BOTTOM = 18;

export default function PlChart({ points, width }: { points: PlPoint[]; width: number }) {
  // Months with nothing in them are dropped rather than drawn as gaps. The payload is positional —
  // twelve entries, January first — so the tail of a part-finished year is all zeros, and plotting
  // it would spend half the width on months that have not happened.
  const live = points.filter((p) => Number(p.operational) !== 0 || Number(p.received) !== 0);
  if (live.length === 0) {
    return <Text style={styles.empty}>Nothing to plot yet this year.</Text>;
  }

  const inAmounts = live.map((p) => Number(p.received));
  const outAmounts = live.map((p) => Number(p.operational));

  // The cumulative net, month by month: what the line traces.
  let running = 0;
  const cumulative = live.map((p) => (running += Number(p.received) - Number(p.operational)));

  // ONE DOMAIN for bars and line together, symmetric about zero so the zero line sits where the eye
  // expects it and a loss is not silently compressed against the floor.
  const extent = Math.max(...inAmounts, ...outAmounts, ...cumulative.map(Math.abs), 1);
  const plotH = H - PAD_TOP - PAD_BOTTOM;
  const zeroY = PAD_TOP + plotH / 2;
  const scale = (v: number) => (v / extent) * (plotH / 2);

  const step = width / live.length;
  const barW = Math.max(4, Math.min(11, step * 0.3));
  const centre = (i: number) => i * step + step / 2;

  const linePath = cumulative
    .map((v, i) => `${i === 0 ? 'M' : 'L'}${centre(i).toFixed(1)},${(zeroY - scale(v)).toFixed(1)}`)
    .join(' ');

  return (
    <View>
      <Svg width={width} height={H}>
        {/* The zero line, recessive. It is the reference the whole chart reads against, so it is
            present and quiet rather than absent or loud. */}
        <Line x1={0} y1={zeroY} x2={width} y2={zeroY} stroke={C.line} strokeWidth={1} />

        {live.map((p, i) => {
          const inH = scale(Number(p.received));
          const outH = scale(Number(p.operational));
          const x = centre(i) - barW / 2;
          return (
            <React.Fragment key={p.month}>
              {/* Above the line: money in. Rounded data-end anchored to the baseline, per the mark
                  specs — the radius is on the end away from zero, not on both. */}
              <Rect x={x} y={zeroY - inH} width={barW} height={Math.max(inH, 0.5)} rx={2} fill={C.moneyIn} />
              {/* Below the line: money out. */}
              <Rect x={x} y={zeroY} width={barW} height={Math.max(outH, 0.5)} rx={2} fill={C.moneyOut} />
            </React.Fragment>
          );
        })}

        {/* The cumulative net, over the bars. 2px per the mark specs, and ink rather than a third
            hue: a line that shares the bars' palette would read as a third series. */}
        <Path d={linePath} stroke={C.ink} strokeWidth={2} fill="none" />
      </Svg>

      <View style={[styles.axis, { width }]}>
        {live.map((p, i) => (
          // Every third month labelled. Nine labels in 360px collide; three are legible and the
          // figures list below carries the rest.
          <Text key={p.month} style={[styles.axisLabel, { width: step }]}>
            {i % 3 === 0 ? p.month : ''}
          </Text>
        ))}
      </View>

      <Text style={styles.caption}>
        Bars: money in above the line, out below · Line: cumulative net
      </Text>
    </View>
  );
}

/**
 * The figures, as rows.
 *
 * NOT OPTIONAL DECORATION. The palette validator warns both series sit below 3:1 against the
 * surface and says the relief is "visible labels or a table view". This is the table view, and it is
 * also the only place the exact numbers appear — a phone chart cannot carry a label per bar.
 */
export function PlFigures({ points }: { points: PlPoint[] }) {
  const live = points.filter((p) => Number(p.operational) !== 0 || Number(p.received) !== 0);
  let running = 0;
  return (
    <View style={styles.table}>
      {live.map((p) => {
        running += Number(p.received) - Number(p.operational);
        return (
          <View key={p.month} style={styles.tableRow}>
            <Text style={styles.month}>{p.month}</Text>
            <Text style={[styles.figure, { color: C.moneyIn }]}>{money(p.received)}</Text>
            <Text style={[styles.figure, { color: C.moneyOut }]}>{money(p.operational)}</Text>
            <Text style={[styles.net, running < 0 && { color: C.over }]}>
              {running < 0 ? '−' : ''}{money(Math.abs(running))}
            </Text>
          </View>
        );
      })}
      <View style={styles.tableHead}>
        <Text style={styles.headCell}>in · out · net so far</Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  axis: { flexDirection: 'row' },
  axisLabel: { fontSize: 10, color: C.faint, textAlign: 'center' },
  caption: { fontSize: 11, color: C.faint, marginTop: 8, lineHeight: 16 },
  empty: { fontSize: 13, color: C.faint },
  table: { marginTop: 14 },
  tableRow: { flexDirection: 'row', alignItems: 'baseline', paddingVertical: 5 },
  month: { flex: 1, fontSize: 12, color: C.muted },
  figure: { width: 72, textAlign: 'right', fontSize: 12, fontVariant: ['tabular-nums'] },
  net: { width: 82, textAlign: 'right', fontSize: 12, color: C.ink, fontWeight: '600', fontVariant: ['tabular-nums'] },
  tableHead: { marginTop: 4 },
  headCell: { fontSize: 10, color: C.faint, textAlign: 'right' },
});
