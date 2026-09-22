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
//
// ─── Twelve months, not the months that have happened ─────────────────────────────────────────
//
// This used to plot `monthlySpending` and drop the empty tail, so the chart stopped at the current
// month and the year's shape had to be imagined. It now takes `yearEnd.monthly`, the same twelve
// positional points the daily email draws, which carry `cumulative` and `projected` — so the rest
// of the year is on the chart as a forecast rather than missing.
//
// It also makes the picture agree with the number above it. "Projected P/L" in the KPI row comes
// from `yearEnd`; a chart built from a different series could show a line that never arrives at the
// figure printed inches away, and there would be nothing on screen to say why.
//
// ─── The line is smoothed, and that is a claim about data ─────────────────────────────────────
//
// Monotone cubic, from `@b8/contracts/monotone`, which is what the email and the web dashboard both
// draw. Shared rather than reimplemented: two smoothing functions do not fail loudly when they
// drift, they draw two subtly different pictures of one year. Monotone specifically, because
// Catmull-Rom overshoots and would bow the curve past the worst month in the series — inventing a
// loss the year never had.

import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import Svg, { Line, Path, Rect } from 'react-native-svg';
import type { OverviewData } from '@b8/contracts/overview';
import { lastSettledIndex, monotonePath, monotoneTangents } from '@b8/contracts/monotone';
import { C, money } from './tokens';

export type PlPoint = OverviewData['yearEnd']['monthly'][number];

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

const H = 158;
const PAD_TOP = 10;
const PAD_BOTTOM = 18;

/** Forecast bars, faded. Enough to read as the same series, weak enough to read as not yet real. */
const PROJECTED_OPACITY = 0.34;

export default function PlChart({ points, width }: { points: PlPoint[]; width: number }) {
  // Positional and always twelve — the contract pins the length for exactly this reason: the chart
  // reads index `i` as month `i`, and a short array does not draw eleven months, it shifts every
  // month it does draw. Nothing is filtered out here any more; a month with no plan and no actual
  // is a real part of the year's shape.
  if (points.length !== 12) {
    return <Text style={styles.empty}>Nothing to plot yet this year.</Text>;
  }

  const income = points.map((p) => Number(p.income));
  const expense = points.map((p) => Number(p.expense));
  const cumulative = points.map((p) => Number(p.cumulative));
  const settledEnd = lastSettledIndex(points.map((p) => p.projected));

  // ONE DOMAIN for bars and line together, symmetric about zero so the zero line sits where the eye
  // expects it and a loss is not silently compressed against the floor.
  const extent = Math.max(...income, ...expense, ...cumulative.map(Math.abs), 1);
  const plotH = H - PAD_TOP - PAD_BOTTOM;
  const zeroY = PAD_TOP + plotH / 2;
  const scale = (v: number) => (v / extent) * (plotH / 2);
  const y = (v: number) => zeroY - scale(v);

  const step = width / 12;
  const barW = Math.max(3, Math.min(9, step * 0.28));
  const cx = (i: number) => i * step + step / 2;

  // Fitted ONCE over all twelve, then cut. Fitting the settled and forecast pieces separately would
  // give the joining month two different tangents and kink the line at exactly the boundary between
  // what happened and what is expected — the one place a reader is looking.
  const slope = monotoneTangents(cumulative);
  const settledPath = settledEnd > 0 ? monotonePath(cumulative, slope, 0, settledEnd, cx, y) : null;
  // The forecast STARTS at the last settled point, so the two share it and the line is continuous
  // rather than gapped at the join.
  const forecastPath = settledEnd < 11 ? monotonePath(cumulative, slope, settledEnd, 11, cx, y) : null;

  return (
    <View>
      <Svg width={width} height={H}>
        {/* The zero line, recessive. It is the reference the whole chart reads against, so it is
            present and quiet rather than absent or loud. */}
        <Line x1={0} y1={zeroY} x2={width} y2={zeroY} stroke={C.line} strokeWidth={1} />

        {points.map((p, i) => {
          const inH = scale(income[i]);
          const outH = scale(expense[i]);
          const x = cx(i) - barW / 2;
          const o = p.projected ? PROJECTED_OPACITY : 1;
          return (
            <React.Fragment key={i}>
              {/* Above the line: money in. Rounded data-end anchored to the baseline, per the mark
                  specs — the radius is on the end away from zero, not on both. */}
              <Rect x={x} y={zeroY - inH} width={barW} height={Math.max(inH, 0.5)} rx={2}
                    fill={C.moneyIn} fillOpacity={o} />
              {/* Below the line: money out. */}
              <Rect x={x} y={zeroY} width={barW} height={Math.max(outH, 0.5)} rx={2}
                    fill={C.moneyOut} fillOpacity={o} />
            </React.Fragment>
          );
        })}

        {/* The cumulative net, over the bars. Ink rather than a third hue: a line sharing the bars'
            palette would read as a third series. Dashed past the last closed month — the dash is
            what separates a record from a forecast, and it is the same distinction the email makes
            with the same boundary. */}
        {settledPath && <Path d={settledPath} stroke={C.ink} strokeWidth={2} fill="none" strokeLinecap="round" />}
        {forecastPath && (
          <Path d={forecastPath} stroke={C.ink} strokeWidth={2} fill="none"
                strokeLinecap="round" strokeDasharray="5 4" strokeOpacity={0.55} />
        )}
      </Svg>

      <View style={[styles.axis, { width }]}>
        {MONTHS.map((m, i) => (
          // Every third month labelled. Twelve labels in 360px collide; four are legible and the
          // figures list below carries the rest.
          <Text key={m} style={[styles.axisLabel, { width: step }]}>
            {i % 3 === 0 ? m : ''}
          </Text>
        ))}
      </View>

      <Text style={styles.caption}>
        Bars: money in above the line, out below · Line: cumulative net · Faded and dashed from{' '}
        {MONTHS[Math.min(settledEnd + 1, 11)]}: projected
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
 *
 * It reads the SAME twelve points as the chart. Feeding the two from different series is how a
 * table comes to disagree with the picture above it, and the projected rows are marked rather than
 * dropped: a forecast the reader can see is a forecast is useful, and one they cannot is a lie.
 */
export function PlFigures({ points }: { points: PlPoint[] }) {
  if (points.length !== 12) return null;
  return (
    <View style={styles.table}>
      {points.map((p, i) => {
        const net = Number(p.cumulative);
        return (
          <View key={i} style={styles.tableRow}>
            <Text style={[styles.month, p.projected && styles.faded]}>
              {MONTHS[i]}{p.projected ? ' ·' : ''}
            </Text>
            <Text style={[styles.figure, { color: C.moneyIn }, p.projected && styles.faded]}>
              {money(p.income)}
            </Text>
            <Text style={[styles.figure, { color: C.moneyOut }, p.projected && styles.faded]}>
              {money(p.expense)}
            </Text>
            <Text style={[styles.net, net < 0 && { color: C.over }, p.projected && styles.faded]}>
              {net < 0 ? '−' : ''}{money(Math.abs(net))}
            </Text>
          </View>
        );
      })}
      <View style={styles.tableHead}>
        <Text style={styles.headCell}>in · out · net so far    (· = projected)</Text>
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
  // Projected rows stay legible but visibly provisional — the same distinction the dashed line
  // makes on the chart, so the two halves of the widget say it the same way.
  faded: { opacity: 0.5 },
  tableHead: { marginTop: 4 },
  headCell: { fontSize: 10, color: C.faint, textAlign: 'right' },
});
