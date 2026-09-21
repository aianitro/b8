import { STATUS_HEX } from '../chartColors';

/**
 * What a budget category is, as one colour — shared by the dashboard's bubbles and the digest's.
 *
 * ─── Why this is its own module rather than a function inside the component ───────────────────
 *
 * It lived in `components/CategoryBubbles.tsx`, which is a `'use client'` file. The email renderer
 * cannot import that, so shipping bubbles in the digest meant either importing a client component
 * into a mail path or writing the rule a second time. The second copy is the one that goes wrong:
 * this repo's standing defect is a definition that drifts between two places, and a colour rule is
 * exactly the kind that drifts silently — nothing fails, the two surfaces just start disagreeing
 * about whether a category is in trouble.
 *
 * So the rule moved here, unchanged, and both callers import it.
 */

/** Slate-300. Not a status — the absence of one, for a month with nothing to judge on yet. */
export const NEUTRAL_HEX = '#cbd5e1';

/** The colour inputs, which is a strict subset of what either surface renders. */
export interface BubbleStatusInput {
  budgeted: number;
  actual: number;
  /** Where the month is heading as a fraction of budget; null when there is no basis yet. */
  projectedRatio: number | null;
  /** True while the month is too young to project from — drawn, never coloured as a verdict. */
  tooEarly: boolean;
}

/**
 * Red is a FACT, amber is a FORECAST. The split matters more than the thresholds do: money already
 * spent past the line cannot be un-spent and is worth interrupting for, while a projection is a
 * claim about days that have not happened and can still be wrong — or acted on.
 *
 * Red is tested first and outranks everything, `tooEarly` included. Being over is observed, not
 * inferred, so a category with too little month to project from is still over if it has already
 * spent past its budget; deferring to "too early" there would grey out the one state that needs no
 * estimate at all.
 *
 * There is no 110% severity band. It graded a forecast by degree, which reads as precision the
 * projection does not have on day 11 — a category at 109% and one at 111% differ by a rounding
 * error in a run rate, not by anything the reader should treat differently.
 */
export function bubbleColor(c: BubbleStatusInput): string {
  if (c.actual > c.budgeted) return STATUS_HEX.over;
  if (c.tooEarly || c.projectedRatio === null) return NEUTRAL_HEX;
  if (c.projectedRatio > 1.0) return STATUS_HEX.watch;
  return STATUS_HEX.good;
}
