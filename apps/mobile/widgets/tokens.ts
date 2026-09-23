// The phone's share of the design system in `.claude/skills/uiux-promax`.
//
// Values are that skill's, not invented here: money in `#22c55e`, money out `#f97316`, over budget
// `#dc2626`, on track `#16a34a`, warning `#d97706`, muted `#9ca3af`. One file so a colour is never
// typed twice and never guessed.
//
// THE TWO SERIES COLOURS CARRY A MEASURED CAVEAT. `scripts/validate_palette.js` from the dataviz
// skill rates the money-in/money-out pair at ΔE 6.2 for deuteranopia — inside the 6–8 floor band,
// which is legal ONLY with secondary encoding — and both below 3:1 against the surface, which
// obligates visible labels or a table view. Both reliefs are built into the chart that uses them:
// money in sits ABOVE the zero line and money out BELOW it, so position carries the identity, and
// the figures are listed beneath the plot. Changing either removes a relief the palette depends on.

import Constants from 'expo-constants';

/**
 * How far the notch or Dynamic Island reaches, measured on the device rather than guessed.
 *
 * ─── Why this is here and not four literals ───────────────────────────────────────────────────
 *
 * It was four literals: 72 on the token screen, 64 on the budget modal, 60 on the transaction
 * editor, and nothing at all on the dashboard, arrivals, chat and quick-entry screens — which is
 * why the island overlapped some screens and not others. The number is not a taste decision, it is
 * a property of the handset, so it is read from `expo-constants` once and applied in two places:
 * the app shell, which covers every screen, and each MODAL, which React Native renders in its own
 * root view where an ancestor's padding cannot reach.
 *
 * `expo-constants` rather than `react-native-safe-area-context`: the app already depends on the
 * former and does not need rotation, per-edge insets or Android display cutouts to clear the top of
 * a portrait screen. The bottom is already handled — the tab bar carries its own home-indicator
 * padding.
 */
export const TOP_INSET = Constants.statusBarHeight;

/** Clearance for a full-screen Modal, which sits outside the shell and must inset itself. */
export const MODAL_TOP = TOP_INSET + 16;

export const C = {
  ink: '#111827',
  inkSoft: '#374151',
  muted: '#6b7280',
  faint: '#9ca3af',
  hair: '#f3f4f6',
  line: '#e5e7eb',
  surface: '#f9fafb',
  moneyIn: '#22c55e',
  moneyOut: '#f97316',
  over: '#dc2626',
  onTrack: '#16a34a',
  warn: '#d97706',
  accent: '#2563eb',
} as const;

/** Whole dollars. Screen 4 uses cents where a typed figure must round-trip; a chart never does. */
export const money = (v: string | number): string =>
  `$${Math.round(Number(v)).toLocaleString('en-US')}`;

export const signed = (v: string | number): string => {
  const n = Number(v);
  return `${n < 0 ? '−' : '+'}${money(Math.abs(n))}`;
};
