import { STATUS_HEX } from '../chartColors';
import { bubbleState, type BubbleState, type BubbleStatusInput } from '@b8/contracts/bubbleStatus';

/**
 * The web's paint for a category's month. The RULE is in `@b8/contracts/bubbleStatus`.
 *
 * ─── Why this file is now a lookup table ──────────────────────────────────────────────────────
 *
 * It used to hold the thresholds AND return a hex, which was fine while both callers were web —
 * the dashboard's bubbles and the digest's PNG. The phone's heatmap is the third caller and paints
 * from the mobile design tokens, so a rule that returns web hex would have forced it to restate
 * the thresholds. They moved to the shared package; what is left here is which red.
 *
 * Every value below is the one this file returned before the split, so nothing on the dashboard or
 * in the digest changes colour.
 */

/** Slate-300. Not a status — the absence of one, for a month with nothing to judge on yet. */
export const NEUTRAL_HEX = '#cbd5e1';

const HEX: Record<BubbleState, string> = {
  over: STATUS_HEX.over,
  'heading-over': STATUS_HEX.watch,
  inside: STATUS_HEX.good,
  'too-early': NEUTRAL_HEX,
};

export function bubbleColor(c: BubbleStatusInput): string {
  return HEX[bubbleState(c)];
}

export { bubbleState };
export type { BubbleState, BubbleStatusInput };
