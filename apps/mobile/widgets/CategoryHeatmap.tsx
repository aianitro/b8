// Where the month sits — every budgeted category as a market heatmap.
//
// ─── Where this shape came from, and where it went ────────────────────────────────────────────
//
// The web dashboard packed these as circles. Asked for the same picture on the phone, the owner
// asked for squares instead: "green/orange/red as on stock market, size proportional to category
// budget". That was the right call at 360px and not only a preference — circle packing spends about
// a third of the box on the gaps between circles, which is affordable at 1000px and is not here,
// and the smallest categories fall below the radius at which a circle can hold anything at all.
//
// The web then took the tiles back. Its dashboard is mostly read in the PWA, at this width, so the
// argument above applies there too; `apps/web/components/CategoryHeatmap.tsx` is the same map in
// DOM. Everything that is not rendering — the layout, the glyphs, the grading and the four fills —
// moved into `@b8/contracts` and is imported by both. Circles survive in the daily digest email,
// which has no pointer and needs the room beneath a circle to print a name.
//
// WHAT NEVER CHANGED IS THE GRADING. Colour comes from `@b8/contracts/bubbleStatus`, the same
// function the digest calls. Two surfaces may legitimately paint a different red; they must never
// disagree about which categories are in trouble.
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
import { layoutTreemap } from '@b8/contracts/treemap';
import { categoryIcon } from '@b8/contracts/categoryIcon';
// Fills, inks and wording live in the contracts package because the web dashboard's map paints
// from the same four values — see the note at the top of that file for why THIS paint is shared
// when `cellColors.ts`'s deliberately is not.
import {
  HEATMAP_FILL as FILL,
  HEATMAP_INK as INK,
  HEATMAP_LABEL as LABEL,
  HEATMAP_LEGEND as LEGEND,
} from '@b8/contracts/heatmapPalette';
import CategorySheet from './CategorySheet';
import { C, money } from './tokens';

type MonthCategory = OverviewData['monthCategories'][number];


/** 2px of surface between fills, per the dataviz skill — half of it either side of every seam. */
const GAP = 2;
const AMOUNT_SIZE = 10;
const AMOUNT_LINE = 12;

/** Below these the spent figure is dropped and the tile carries its glyph alone. */
const MIN_W_AMOUNT = 60;
const MIN_H_AMOUNT = 42;

/**
 * NO CATEGORY NAME ON ANY TILE — every one is named by its glyph. See `categoryIcon.ts`.
 *
 * It began as a fallback for tiles too small for a word, then replaced the words outright at the
 * owner's request, and the second change is the better one for a reason the first exposed: a map
 * whose labels change KIND with tile size is read twice — names here, glyphs there, nothing in the
 * corner — while one alphabet is scanned once. The tail of a budget is genuinely small and this
 * widget refuses to bucket it away, so the small tiles are not an edge case to be styled around;
 * they are most of the map by count, and they set the vocabulary the rest should share.
 *
 * WHAT IT COSTS, STATED PLAINLY: recognition now rests entirely on the glyph, so a category with no
 * keyword in that table shows a bare letter and is weaker than the truncated word it replaced. All
 * twenty-one of this ledger's categories match today, and a test asserts it — that test is what
 * keeps the cost at zero, and it will fail on the first category added without a keyword.
 *
 * The name has not gone anywhere the reader cannot reach: tapping any tile names it in the line
 * above the map, and a screen reader announces the name rather than the glyph.
 *
 * The tier is chosen from the tile's measured size BEFORE it renders — `layoutTreemap` returns
 * every rectangle up front, so nothing here is a guess or a second layout pass.
 *
 * The floor is what an 11px glyph actually occupies -- about 13px square -- plus a little air,
 * measured against this ledger's own budget rather than guessed. At a 20px floor two real
 * categories still came out blank: a tall narrow sliver and a wide 16px-high band, both with ample
 * room for a glyph and neither with room for a word. BOTH dimensions are tested, because a 4x100
 * sliver has the height for a glyph and nowhere to put it.
 *
 * Under this a tile stays empty rather than carrying a smudge, and it is still tappable; the line
 * above the map names whatever was tapped.
 */
const MIN_W_ICON = 15;
const MIN_H_ICON = 13;

export default function CategoryHeatmap({ categories, width, month }: {
  categories: MonthCategory[];
  width: number;
  /** 1–12, the month the map is showing. Passed in rather than read from a clock here: the map's
   *  figures come from the payload's as-of, and a second clock read could name a different month
   *  than the one the tiles were computed for. */
  month: number;
}) {
  /**
   * TWO TAPS, AND THE SECOND ONE IS OPTIONAL — the owner's flow, and the right one for a treemap.
   *
   * A map like this exists for COMPARISON: the question is never "what is Grocery", it is "which of
   * these is the problem". Opening a sheet on every tap makes comparing two categories cost six
   * gestures — tap, read, close, tap, read, close — to answer the question the map was supposed to
   * answer without leaving it. First tap now writes one line above the map, so comparing is tap,
   * read, tap, read.
   *
   * It also makes a MIS-TAP CHEAP, which matters more here than it would elsewhere: nine of fifteen
   * tiles carry no text and several are under 40px, so taps land on the wrong tile often. Under the
   * old flow that cost a full-screen modal to dismiss. Now it costs one line changing.
   *
   * `selected` is the tile whose figures are on the line; `drilling` is the one whose sheet is
   * open. Two pieces of state rather than one enum, because closing the sheet must return to the
   * selected state rather than to nothing — the reader is still looking at that tile.
   */
  const [selected, setSelected] = useState<string | null>(null);
  const [drilling, setDrilling] = useState<string | null>(null);

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

  const active = selected ? byKey.get(selected) ?? null : null;
  // The tile's own figures are already on screen, so the sheet opens with them filled in and only
  // the transaction list waits on the network.
  const drillCat = drilling ? byKey.get(drilling) ?? null : null;

  return (
    <View>
      <Text style={styles.caption}>
        size = budget · icon = category · figure = spent · colour = spent or heading over
      </Text>

      {/* Reserved whether or not anything is selected, so the first tap never shifts the map under
          the finger that made it. */}
      <View style={styles.detail}>
        {active ? (
          <Pressable
            onPress={() => setDrilling(active.category)}
            accessibilityRole="button"
            accessibilityLabel={`${active.category}, ${money(active.actual)} of ${money(active.budgeted)}. Open its charges.`}
            style={({ pressed }) => [styles.detailRow, pressed && styles.detailPressed]}
          >
            {/* THE LINE IS THE SECOND TARGET, and this is the part that makes the flow work. A
                second tap on the tile is a hidden action on an unlabelled 30px square — nothing
                announces it, so nobody finds it. Putting the same action on a line that visibly
                invites it gives the gesture somewhere to be discovered; the tile's second tap
                survives as a shortcut for those who do find it, and a screen reader gets a real
                button rather than a control that silently changes meaning between taps. */}
            <Text style={styles.detailIcon}>{categoryIcon(active.category)}</Text>
            <Text style={styles.detailText} numberOfLines={1}>
              <Text style={styles.detailName}>{active.category}</Text>
              {` · ${money(active.actual)} of ${money(active.budgeted)}`}
              {Number(active.actual) > Number(active.budgeted) && (
                <Text style={styles.detailOver}>
                  {` · ${money(Number(active.actual) - Number(active.budgeted))} over`}
                </Text>
              )}
            </Text>
            <Text style={styles.detailChevron}>›</Text>
          </Pressable>
        ) : (
          <Text style={styles.detailIdle}>Tap a tile for its figures, again for its charges.</Text>
        )}
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
          // EVERY tile is named by its glyph, not only the ones too small for a word. The name text
          // is gone entirely — see the note on the icon tiers above.
          const showIcon = w >= MIN_W_ICON && h >= MIN_H_ICON;
          const showAmount = w >= MIN_W_AMOUNT && h >= MIN_H_AMOUNT;
          // The glyph is sized against the space LEFT AFTER the amount, not against the whole
          // tile, or on a tile just over the amount threshold the two would be laid out for more
          // room than they have and the pair would overflow.
          const iconBox = Math.min(w, showAmount ? h - AMOUNT_LINE - 2 : h);
          // Scaled rather than fixed, so a small tile and a large one each get a glyph proportioned
          // to their space instead of one looking cramped and the other lost. The floor of 10 is a
          // legible glyph inside the 13px minimum height above; the two are a pair and moving one
          // without the other clips.
          const iconSize = Math.round(Math.min(30, Math.max(10, iconBox * 0.55)));

          // Over means spent PAST the line, not projected to pass it, so the overage is only ever
          // printed on a tile that has actually breached. The colour carries the forecast.
          const over = Number(cat.actual) - Number(cat.budgeted);
          const second = over > 0 ? `+${money(over)}` : money(cat.actual);

          return (
            <Pressable
              key={t.key}
              // `accessible` GROUPS the tile, so the label below is what is announced. Without it a
              // screen reader reaches the glyph and reads its emoji name -- "graduation cap" for
              // Education -- which is the one reading worse than saying nothing.
              accessible
              accessibilityRole="button"
              accessibilityLabel={`${cat.category}, ${money(cat.actual)} of ${money(cat.budgeted)}, ${LABEL[state]}`}
              // First tap selects; a second on the SAME tile opens it. Tapping a DIFFERENT tile
              // always selects rather than opening — otherwise a stray tap next to an already
              // selected tile would open a sheet for a category the reader never chose.
              onPress={() => (selected === t.key ? setDrilling(t.key) : setSelected(t.key))}
              accessibilityHint={selected === t.key ? 'Opens its charges' : 'Shows its figures'}
              style={[
                styles.tile,
                { left: t.x + GAP / 2, top: t.y + GAP / 2, width: w, height: h, backgroundColor: FILL[state] },
              ]}
            >
              {/* The ring is drawn INSIDE the tile rather than as a border, because a border would
                  resize it — and a tile whose size changes on tap is a tile whose size stopped
                  meaning the budget. It is what ties the line above the map to a square on it. */}
              {selected === t.key && <View style={[styles.ring, { borderColor: INK[state] }]} />}
              {/* Glyph and figure are centred as one stack filling the tile, rather than flowing
                  from the top-left corner. A word had to start at a known edge to be read; a glyph
                  does not, and centring is what stops a 20px square looking like a mistake. */}
              <View style={styles.contents} pointerEvents="none">
                {showIcon && (
                  <Text style={[styles.icon, { fontSize: iconSize, color: INK[state] }]}>
                    {categoryIcon(cat.category)}
                  </Text>
                )}
                {showAmount && (
                  <Text style={[styles.amount, { color: INK[state] }]} numberOfLines={1}>
                    {second}
                  </Text>
                )}
              </View>
            </Pressable>
          );
        })}
      </View>

      {drillCat && (
        // Closing returns to the SELECTED state, not to nothing: the reader is still looking at
        // that tile, and clearing the line would make the map forget where they were.
        <CategorySheet category={drillCat} month={month} onClose={() => setDrilling(null)} />
      )}

      <View style={styles.legend}>
        {LEGEND.map(([state, label]) => (
          <View key={state} style={styles.legendItem}>
            <View style={[styles.swatch, { backgroundColor: FILL[state] }]} />
            {/* Shrink-to-fit rather than wrap. Shortening the labels buys room on the phones
                measured, but "fits on mine" is not a layout rule — a larger accessibility text
                size, or a narrower device, would wrap the row again and the reader would be left
                with a ragged second line under the map. This cannot wrap: the row has no
                `flexWrap`, each item may shrink, and the one label that runs out of room loses a
                little size instead of taking the whole legend to two lines. */}
            <Text
              style={styles.legendText}
              numberOfLines={1}
              adjustsFontSizeToFit
              minimumFontScale={0.75}
            >
              {label}
            </Text>
          </View>
        ))}
      </View>
    </View>
  );
}


const styles = StyleSheet.create({
  caption: { fontSize: 11, color: C.faint, marginBottom: 8 },
  // Fixed height so selecting, deselecting and switching tiles never move the map.
  detail: { height: 34, justifyContent: 'center' },
  detailRow: { flexDirection: 'row', alignItems: 'center', gap: 7, paddingVertical: 4, paddingRight: 2 },
  detailPressed: { opacity: 0.55 },
  detailIcon: { fontSize: 15 },
  detailText: { flex: 1, fontSize: 12.5, color: C.muted },
  detailName: { fontWeight: '600', color: C.ink },
  detailOver: { color: C.over, fontWeight: '600' },
  detailChevron: { fontSize: 18, color: C.faint, marginTop: -2 },
  detailIdle: { fontSize: 12, color: C.faint },
  ring: { position: 'absolute', left: 0, top: 0, right: 0, bottom: 0, borderWidth: 2, borderRadius: 3 },
  map: { position: 'relative', marginTop: 4 },
  tile: { position: 'absolute', borderRadius: 3, overflow: 'hidden' },
  contents: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 2 },
  icon: { textAlign: 'center' },
  amount: { fontSize: AMOUNT_SIZE, lineHeight: AMOUNT_LINE, opacity: 0.9 },
  // No `flexWrap`: the row is one line by construction. `gap` rather than a margin on every item,
  // so there is no trailing space fighting the last label for the width it needs.
  legend: { flexDirection: 'row', alignItems: 'center', gap: 10, marginTop: 10 },
  legendItem: { flexDirection: 'row', alignItems: 'center', flexShrink: 1 },
  swatch: { width: 9, height: 9, borderRadius: 2, marginRight: 5 },
  legendText: { flexShrink: 1, fontSize: 10, color: C.faint },
  empty: { fontSize: 13, color: C.faint },
});
