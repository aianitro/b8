/**
 * How much AREA a figure earns in the month's picture — the dashboard's bubbles, the tiles below
 * `lg`, and the digest email's circles, all from this one function.
 *
 * ─── AREA IS NO LONGER PROPORTIONAL TO THE MONEY, AND THAT IS THE POINT ───────────────────────
 *
 * It was, and that is the textbook answer: twice the budget, twice the ink. On a ledger with a
 * property tax in it the picture that produces is one enormous mark and a border of slivers. The
 * biggest category outweighs the smallest by two orders of magnitude, and at the box sizes these
 * pictures get, the small end lands under the size at which a glyph fits, a figure fits, or a
 * finger can land. A map that cannot show most of its subjects is not being accurate about them;
 * it is leaving them out.
 *
 * So area follows the SQUARE ROOT of the money instead. The ladder that produces:
 *
 *   money ×2   → area ×1.4
 *   money ×5   → area ×2.2
 *   money ×10  → area ×3.2
 *   money ×100 → area ×10
 *
 * which is close to what was asked for — "five times the expense, about twice the bubble" — and
 * is a rule with a name rather than a constant tuned until one screenshot looked right. A reader
 * who learns "the sizes are square-rooted" can invert it; nobody can invert a 0.43.
 *
 * ─── WHAT IT KEEPS ───────────────────────────────────────────────────────────────────────────
 *
 * MONOTONIC. Bigger is still bigger, always, and equal is still equal. The compression changes how
 * far apart two marks look and never which of them is larger, so the ranking the picture shows is
 * the ranking in the ledger — every pairwise comparison a reader makes off it is sound.
 *
 * THE FIGURES ARE NEVER READ OFF THE SIZE. Both pictures print the money on any mark with room for
 * it and name the exact amounts on hover or tap, which is where the comparison that has to be
 * precise happens. The size is there to rank and to draw the eye; it was never the number.
 *
 * ─── WHAT WAS REJECTED ───────────────────────────────────────────────────────────────────────
 *
 * A MINIMUM SIZE, with everything above it left proportional. It keeps the big end honest and
 * flattens the small end into a row of identical marks — the categories this exists to rescue
 * would be visible and no longer comparable to each other. A cliff also moves: a category that
 * crosses the floor jumps in size for a few pence of change.
 *
 * A LOGARITHM. It compresses far harder at the small end than anything here needs, has no value
 * at zero, and its shape depends on a base that is pure choice. Square root needs no base and
 * passes through the origin.
 *
 * ─── WHERE IT IS APPLIED ─────────────────────────────────────────────────────────────────────
 *
 * At the INPUT to the layouts, never inside them. `packCircles` and `layoutTreemap` keep their
 * contract — the weight they are handed is the area they draw — because that is what makes them
 * reusable geometry rather than two copies of one product decision. This module is the decision.
 */

/**
 * The exponent applied to money before it becomes area. 1 is the old proportional picture, 0 is
 * every category the same size; 0.5 is the square root.
 *
 * A knob rather than a literal `Math.sqrt`, because the right amount of compression is a judgement
 * about a particular ledger's spread, and the next person to revisit it should find one number
 * with the reasoning beside it.
 */
export const AREA_EXPONENT = 0.5;

/**
 * The area weight for an amount of money. Zero for anything that cannot be drawn — a zero budget,
 * a negative, a NaN — which is what both layouts already drop.
 */
export function pictureArea(money: number): number {
  if (!Number.isFinite(money) || money <= 0) return 0;
  return Math.pow(money, AREA_EXPONENT);
}
