// The phone's palette for a budget cell — the web's classes, as colours.
//
// THE THRESHOLDS ARE NOT HERE. They live in `apps/web/lib/domain/budgetCellState.ts`, which both
// clients call; this file only answers "what colour is that state". That split exists because
// Tailwind class names do not survive into React Native, and duplicating "over budget" so the phone
// could paint it would have been a second definition of the one thing this grid is about.
//
// Values are the Tailwind steps the web uses, resolved to hex: red-100, amber-50, emerald-50,
// green-50, emerald-100, slate-50. Matching the web exactly is the point — the owner asked for the
// same grid, and a phone that grades identically but paints differently is a different grid.

import type { CellState } from '@b8/contracts/budgetGrid';

export const CELL_BG: Record<CellState, string> = {
  future: '#f8fafc',        // slate-50
  empty: '#ffffff',
  over: '#fee2e2',          // red-100
  watch: '#fffbeb',         // amber-50
  'on-plan': '#ecfdf5',     // emerald-50
  'well-under': '#f0fdf4',  // green-50
  'off-cycle': '#fee2e2',   // red-100 — off-cycle reaches the expense grading as `over`
  'income-met': '#d1fae5',  // emerald-100
  'income-part': '#ecfdf5', // emerald-50
  'income-short': '#fffbeb',// amber-50
  inverted: '#fee2e2',      // red-100
};

export const CELL_TEXT: Record<CellState, string> = {
  future: '#cbd5e1',        // slate-300
  empty: '#cbd5e1',
  over: '#b91c1c',          // red-700
  watch: '#b45309',         // amber-700
  'on-plan': '#334155',     // slate-700
  'well-under': '#334155',
  'off-cycle': '#b91c1c',
  'income-met': '#047857',  // emerald-700
  'income-part': '#047857',
  'income-short': '#047857',
  inverted: '#b91c1c',
};

/** Bold where the web bolds: the states that are findings rather than readings. */
export const CELL_BOLD: ReadonlySet<CellState> = new Set<CellState>([
  'over', 'off-cycle', 'inverted',
]);
