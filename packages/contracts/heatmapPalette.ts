// The heatmap's paint: four fills, four inks, and the words that name them.
//
// ─── Why paint is here at all, when `cellColors.ts` says paint is not shared ───────────────────
//
// `bubbleStatus.ts` and `budgetCellState.ts` both make the same split and give the same reason: the
// RULE is shared, the PAINT is not, because two clients may legitimately disagree about which red.
// The phone's budget grid keeps its own `cellColors.ts` on exactly that argument, and it is right —
// those values are the phone's rendering of the web's Tailwind steps, which do not survive into
// React Native, and either surface could restyle without the other being wrong.
//
// These four are not that. They are not a house style either surface chose; they are the OUTPUT OF
// A COLOUR-VISION VALIDATION of this specific encoding — solid fills covering a third of the
// viewport — and the reasoning below records which checks each value was moved to pass. A client
// that paints its tiles differently has not expressed a preference, it has skipped the validator.
// So the split here falls in a different place: the rule lives in `bubbleStatus.ts`, the paint
// lives here, and both are shared. Hex rather than Tailwind classes is what makes that possible —
// these strings are legal in a CSS `background` and in a React Native style alike.
//
// Re-running `scripts/validate_palette.js` is what changes this file. Nothing else should.

import type { BubbleState } from './bubbleStatus';

/**
 * The status palette. Reserved: the dataviz skill forbids reusing these as series colours, and
 * neither surface does.
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
 * obligates visible labels or a table view. Both are here on both surfaces: every tile carries its
 * glyph, and every tile — labelled or not — names itself in the line above the map when picked.
 * Chasing 3:1 was tried and is a worse trade: amber-700 clears the contrast check and collapses
 * into red at ΔE 2.8 deutan.
 */
export const HEATMAP_FILL: Record<BubbleState, string> = {
  over: '#dc2626',          // red-600 — the design token, unchanged
  'heading-over': '#f59e0b',// amber-500 — was amber-600; raised for normal-vision separation
  inside: '#15803d',        // green-700 — was green-600; darkened for deuteran separation
  'too-early': '#94a3b8',   // slate-400
};

/**
 * Ink per tile, chosen by WCAG contrast against that fill rather than by eye: white on red 5.9:1,
 * on green 5.0:1; amber and slate are light fills and take dark ink at 4.3:1 and 6.5:1. White on
 * amber would be 1.9:1, which is the obvious choice and unreadable.
 *
 * Slate-400 fails the validator's chroma floor, deliberately and as the only dismissed check. That
 * floor exists so a categorical series does not read as grey; this slot is not a series, it is the
 * ABSENCE of a verdict for a month too young to judge, and reading as grey is the job.
 */
export const HEATMAP_INK: Record<BubbleState, string> = {
  over: '#ffffff',
  'heading-over': '#78350f',  // amber-900
  inside: '#ffffff',
  'too-early': '#1f2937',     // gray-800
};

/**
 * Four swatches on one line, which is the constraint that shapes the wording.
 *
 * "already over" and "heading over" keep their length: the pair IS the distinction the colours
 * encode — one is money that has left, the other is a forecast — and shortening either to "over"
 * collapses a fact and a guess into the same word. "too early to call" shortens to "too early"
 * because the dropped words add nothing the two remaining ones do not carry.
 *
 * The web has room for the longer labels its bubbles used and takes these anyway. Its own map is
 * read at phone width too — that is what a PWA is — so the wording that survives there is the
 * wording, and two surfaces captioning one picture differently is a difference with no reader.
 */
export const HEATMAP_LEGEND: ReadonlyArray<readonly [BubbleState, string]> = [
  ['over', 'already over'],
  ['heading-over', 'heading over'],
  ['inside', 'in budget'],
  ['too-early', 'too early'],
];

/**
 * What a screen reader hears.
 *
 * Not shortened the way `HEATMAP_LEGEND` is: it has no width to fit into, and "too early to call"
 * is the better sentence when it is read aloud rather than scanned.
 */
export const HEATMAP_LABEL: Record<BubbleState, string> = {
  over: 'already over budget',
  'heading-over': 'heading over budget',
  inside: 'in budget',
  'too-early': 'too early to call',
};
