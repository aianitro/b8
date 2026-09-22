// What a budget category's month IS, as one word. Shared by every surface that draws it.
//
// ─── Why the rule moved here, and why it stopped returning a colour ───────────────────────────
//
// It lived in `apps/web/lib/domain/bubbleStatus.ts` and returned a hex string, which was right
// while both callers were web: the dashboard's bubbles and the digest's PNG both paint with hex.
// The phone's heatmap is the third caller and the first that cannot use those values — its palette
// is the mobile design tokens, not the web's chart colours — so a rule that returns paint forces
// the phone either to import the web's palette or to restate the thresholds.
//
// Same split as `budgetCellState.ts`, for the same reason and after the same near-miss: the rule
// is shared, the paint is not. Two clients may legitimately disagree about which red; they must
// never disagree about whether a category is in trouble.

/** The four things a category's month can be. There is no fifth, and no severity band — see below. */
export type BubbleState =
  /** Spent past the line already. A FACT. */
  | 'over'
  /** Inside the line today, projected to finish outside it. A FORECAST. */
  | 'heading-over'
  /** Projected to finish inside its budget. */
  | 'inside'
  /** Not enough month to project from. The absence of a verdict, not a verdict of "fine". */
  | 'too-early';

/** The rule's inputs — a strict subset of what any of the three surfaces renders. */
export interface BubbleStatusInput {
  budgeted: number;
  actual: number;
  /** Where the month is heading as a fraction of budget; null when there is no basis yet. */
  projectedRatio: number | null;
  /** True while the month is too young to project from — drawn, never graded as a verdict. */
  tooEarly: boolean;
}

/**
 * `over` is a FACT, `heading-over` is a FORECAST. The split matters more than the thresholds do:
 * money already spent past the line cannot be un-spent and is worth interrupting for, while a
 * projection is a claim about days that have not happened and can still be wrong — or acted on.
 *
 * `over` is tested first and outranks everything, `tooEarly` included. Being over is observed, not
 * inferred, so a category with too little month to project from is still over if it has already
 * spent past its budget; deferring to "too early" there would grey out the one state that needs no
 * estimate at all.
 *
 * There is no 110% severity band. It graded a forecast by degree, which reads as precision the
 * projection does not have on day 11 — a category at 109% and one at 111% differ by a rounding
 * error in a run rate, not by anything the reader should treat differently.
 */
export function bubbleState(c: BubbleStatusInput): BubbleState {
  if (c.actual > c.budgeted) return 'over';
  if (c.tooEarly || c.projectedRatio === null) return 'too-early';
  if (c.projectedRatio > 1.0) return 'heading-over';
  return 'inside';
}
