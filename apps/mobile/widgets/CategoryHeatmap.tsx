// Where the month sits — the web dashboard's CategoryBubbles, as a market heatmap.
//
// ─── Same data, same rule, different shape, at the owner's request ────────────────────────────
//
// The web packs every budgeted category as a circle. Asked for this on the phone, the owner asked
// for squares instead: "green/orange/red as on stock market, size proportional to category budget".
// That is the right call at 360px and not only a preference — circle packing spends about a third
// of the box on the gaps between circles, which is affordable at 1000px and is not here, and the
// smallest categories fall below the radius at which a circle can hold anything at all.
//
// WHAT DID NOT CHANGE IS THE GRADING. Colour comes from `@b8/contracts/bubbleStatus`, the same
// function the web bubbles and the daily digest call. The phone may paint a different red; it must
// never disagree about which categories are in trouble. The rule moved into the shared package for
// this widget — see that file.
//
// ─── Two channels, and the third one the validator deleted ────────────────────────────────────
//
// AREA is the month's budget. COLOUR is where the category is heading. The pairing is the whole
// point of the picture: a list sorted by overspend puts a small education line closing at 300%
// above a large grocery line closing at 101%, and the reader has to hold both budgets in their head
// to know which is actually the problem. Here the small red tile and the large amber one are
// visibly different amounts of money in trouble, with no number read.
//
// The first version had a THIRD channel, ported from the web's inner disc: a pale tile with a solid
// band rising from the bottom for spend-so-far. `scripts/validate_palette.js` killed it. Flattened
// to a tint at any alpha, red and green land at ΔE 0.6–1.6 for deuteranopia and 4.9–12.9 for NORMAL
// colour vision — the pale tiles are not merely hard to tell apart, they are the same colour to
// most readers, and a tile is mostly tint for most of the month. Measured at 0.16, 0.28 and 0.40;
// raising the alpha moves it from hopeless to still-failing.
//
// So the tiles are solid, which is what a market heatmap is, and spend-so-far became TEXT — a
// channel with no colour-vision cost at all. Budget is not printed beside it: the area already
// says the budget, and a number restating the size is the one label that adds nothing.

import { useMemo, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import type { OverviewData } from '@b8/contracts/overview';
import { bubbleState, type BubbleState } from '@b8/contracts/bubbleStatus';
import { layoutTreemap } from './treemap';
import { C, money } from './tokens';

type MonthCategory = OverviewData['monthCategories'][number];

/**
 * The status palette. Reserved: the dataviz skill forbids reusing these as series colours, and
 * nothing else on this screen does.
 *
 * ─── Two of these four are one ramp step off the design tokens, and the validator moved them ──
 *
 * `uiux-promax` gives over `#dc2626`, warning `#d97706`, on-track `#16a34a`. As TEXT colours they
 * are fine. As FILLS covering a third of the screen they failed three checks at once: green against
 * red at ΔE 5.0 deutan (below the 6 floor — a red/green reader cannot tell an over-budget tile from
 * an on-plan one, which is the entire reading this widget exists for), and amber against red at
 * ΔE 14.4 for normal vision, below the 15 floor.
 *
 * Deuteranopia separates red from green almost entirely by LIGHTNESS, and those two sit at nearly
 * the same L. Dropping on-track one ramp step to green-700 and lifting warning to amber-500 —
 * `STATUS_HEX.watch`'s own value on the web, so this is an in-system number — takes the worst pair
 * to ΔE 8.6 deutan and 20.8 normal. All hard checks pass.
 *
 * Amber remains below 3:1 against the white surface, which the skill says is not dismissable and
 * obligates visible labels or a table view. Both are here: tiles carry their names, and every tile
 * — labelled or not — opens the line above the map on tap. Chasing 3:1 was tried and is a worse
 * trade: amber-700 clears the contrast check and collapses into red at ΔE 2.8 deutan.
 */
const FILL: Record<BubbleState, string> = {
  over: '#dc2626',          // red-600 — the design token, unchanged
  'heading-over': '#f59e0b',// amber-500 — was amber-600; raised for normal-vision separation
  inside: '#15803d',        // green-700 — was green-600; darkened for deuteran separation
  'too-early': '#94a3b8',   // slate-400
};

/**
 * Ink per tile, chosen by WCAG contrast against that fill rather than by eye: white on red 5.9:1,
 * on green 5.0:1; amber and slate are light fills and take dark ink at 4.3:1 and 6.5:1. White on
 * amber would be 1.9:1, which is the obvious choice and unreadable.
 */
const INK: Record<BubbleState, string> = {
  over: '#ffffff',
  'heading-over': '#78350f',  // amber-900
  inside: '#ffffff',
  'too-early': '#1f2937',     // gray-800
};

/**
 * Slate-400 fails the validator's chroma floor, deliberately and as the only dismissed check.
 * That floor exists so a categorical series does not read as grey; this slot is not a series, it
 * is the ABSENCE of a verdict for a month too young to judge, and reading as grey is the job.
 */
const LEGEND: ReadonlyArray<[BubbleState, string]> = [
  ['over', 'already over'],
  ['heading-over', 'heading over'],
  ['inside', 'inside budget'],
  ['too-early', 'too early to call'],
];

/** 2px of surface between fills, per the dataviz skill — half of it either side of every seam. */
const GAP = 2;
const PAD = 4;
const NAME_SIZE = 11;
const AMOUNT_SIZE = 10;

/**
 * Below these a label is a smear rather than a name. The web ellipsises to a minimum character
 * count for the same reason; React Native measures text itself via `numberOfLines`, so all that is
 * needed here is the floor under which no label is attempted at all.
 *
 * An unlabelled tile is not unreachable — it is still tappable, and the line above the map names
 * whatever was tapped. That is the same bargain the web makes with hover, and it is what keeps the
 * small tiles honest: the tail of the budget is exactly where an overspend hides, which is why
 * `layoutTreemap` refuses to bucket it into an "Other".
 */
const MIN_W_NAME = 46;
const MIN_H_NAME = 24;
const MIN_W_AMOUNT = 60;
const MIN_H_AMOUNT = 42;

export default function CategoryHeatmap({ categories, width }: {
  categories: MonthCategory[];
  width: number;
}) {
  const [picked, setPicked] = useState<string | null>(null);

  // Taller than wide would waste the phone's scroll; much shorter and twelve categories become
  // twelve bands. 0.78 puts a typical month's largest tile at roughly square.
  const height = Math.round(Math.min(320, Math.max(220, width * 0.78)));

  const tiles = useMemo(
    () => layoutTreemap(
      categories.map((c) => ({ key: c.category, weight: Number(c.budgeted) })),
      width, height
    ),
    [categories, width, height]
  );
  const byKey = useMemo(() => new Map(categories.map((c) => [c.category, c])), [categories]);

  if (tiles.length === 0) {
    return <Text style={styles.empty}>No budgeted categories to plot this month.</Text>;
  }

  const active = picked ? byKey.get(picked) ?? null : null;

  return (
    <View>
      <Text style={styles.caption}>
        size = this month&apos;s budget · label = spent so far · colour = spent or heading over
      </Text>

      {/* Fixed height whether or not anything is selected, so tapping never shifts the map. */}
      <View style={styles.detail}>
        {active ? <Detail cat={active} /> : <Text style={styles.detailIdle}>Tap a category.</Text>}
      </View>

      <View style={[styles.map, { width, height }]}>
        {tiles.map((t) => {
          const cat = byKey.get(t.key)!;
          const state = bubbleState({
            budgeted: Number(cat.budgeted),
            actual: Number(cat.actual),
            projectedRatio: cat.projectedRatio,
            tooEarly: cat.tooEarly,
          });

          const w = t.w - GAP;
          const h = t.h - GAP;
          const showName = w >= MIN_W_NAME && h >= MIN_H_NAME;
          const showAmount = showName && w >= MIN_W_AMOUNT && h >= MIN_H_AMOUNT;

          // Over means spent PAST the line, not projected to pass it, so the overage is only ever
          // printed on a tile that has actually breached. The colour carries the forecast.
          const over = Number(cat.actual) - Number(cat.budgeted);
          const second = over > 0 ? `+${money(over)}` : money(cat.actual);

          return (
            <Pressable
              key={t.key}
              accessibilityRole="button"
              accessibilityLabel={`${cat.category}, ${money(cat.actual)} of ${money(cat.budgeted)}, ${LABEL[state]}`}
              onPress={() => setPicked(picked === t.key ? null : t.key)}
              style={[
                styles.tile,
                { left: t.x + GAP / 2, top: t.y + GAP / 2, width: w, height: h, backgroundColor: FILL[state] },
              ]}
            >
              {/* The selection ring is drawn INSIDE the tile rather than as a border, because a
                  border would resize it — and a tile whose size changes on tap is a tile whose
                  size stopped meaning the budget. */}
              {picked === t.key && <View style={[styles.ring, { borderColor: INK[state] }]} />}
              {showName && (
                <Text style={[styles.name, { color: INK[state] }]} numberOfLines={1}>
                  {cat.category}
                </Text>
              )}
              {showAmount && (
                <Text style={[styles.amount, { color: INK[state] }]} numberOfLines={1}>
                  {second}
                </Text>
              )}
            </Pressable>
          );
        })}
      </View>

      <View style={styles.legend}>
        {LEGEND.map(([state, label]) => (
          <View key={state} style={styles.legendItem}>
            <View style={[styles.swatch, { backgroundColor: FILL[state] }]} />
            <Text style={styles.legendText}>{label}</Text>
          </View>
        ))}
      </View>
    </View>
  );
}

/** What a screen reader hears, and what the legend says, from one place. */
const LABEL: Record<BubbleState, string> = {
  over: 'already over budget',
  'heading-over': 'heading over budget',
  inside: 'inside budget',
  'too-early': 'too early to call',
};

/**
 * What the web puts in its hover line, on tap.
 *
 * OVER means spent past the line, not projected to pass it. Those are different claims and only
 * one of them is money that has left: a category at 110 of 150 is heading over and is not over, and
 * printing an overage on it reports a forecast as a fact. So the overage and the projection are
 * separate clauses here, and the projection is labelled as one.
 */
function Detail({ cat }: { cat: MonthCategory }) {
  const over = Number(cat.actual) - Number(cat.budgeted);
  return (
    <Text style={styles.detailText} numberOfLines={2}>
      <Text style={styles.detailName}>{cat.category}</Text>
      {` · ${money(cat.actual)} of ${money(cat.budgeted)}`}
      {over > 0 && <Text style={styles.detailOver}>{` · ${money(over)} over already`}</Text>}
      {cat.tooEarly && ' · too early to project'}
      {!cat.tooEarly && cat.projectedRatio !== null
        && ` · projects to close at ${Math.round(cat.projectedRatio * 100)}%`}
    </Text>
  );
}

const styles = StyleSheet.create({
  caption: { fontSize: 11, color: C.faint, marginBottom: 8 },
  detail: { height: 32, justifyContent: 'center' },
  detailText: { fontSize: 12, color: C.muted, lineHeight: 15 },
  detailName: { fontWeight: '600', color: C.ink },
  detailOver: { color: C.over, fontWeight: '600' },
  detailIdle: { fontSize: 12, color: C.faint },
  map: { position: 'relative', marginTop: 4 },
  tile: { position: 'absolute', borderRadius: 3, overflow: 'hidden', padding: PAD },
  ring: { position: 'absolute', left: 0, top: 0, right: 0, bottom: 0, borderWidth: 2, borderRadius: 3 },
  name: { fontSize: NAME_SIZE, lineHeight: 13, fontWeight: '600' },
  amount: { fontSize: AMOUNT_SIZE, lineHeight: 12, opacity: 0.9 },
  legend: { flexDirection: 'row', flexWrap: 'wrap', marginTop: 10 },
  legendItem: { flexDirection: 'row', alignItems: 'center', marginRight: 14, marginTop: 4 },
  swatch: { width: 9, height: 9, borderRadius: 2, marginRight: 5 },
  legendText: { fontSize: 10, color: C.faint },
  empty: { fontSize: 13, color: C.faint },
});
