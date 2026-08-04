// Shared color vocabulary for the dashboard's charts and KPI cards. Before this, landscape
// colors and status colors were hardcoded independently in MonthlySpendingChart.tsx,
// CashFlowChart.tsx, CategoryDonutChart.tsx, BudgetVsActualChart.tsx, and dashboard/page.tsx's
// KpiCard — consistent only by coincidence (e.g. the blue/violet landscape colors happened to
// match across two files), with "over budget" red a different literal hex value in each place
// that needed it. One file now owns the mapping; everything else imports from here.
//
// Two export shapes because of a real technical split, not a style choice: Recharts consumes
// raw hex strings (`fill`/`stroke` props on SVG elements), while DOM-rendered elements (KPI
// card text) consume Tailwind class names — same semantic colors, different representations.

export const LANDSCAPE_HEX = {
  operational: '#3b82f6', // blue-500
  capital: '#8b5cf6',     // violet-500
} as const;

// Lighter tint of the same landscape color — used for reference/budget lines drawn alongside
// the solid landscape-colored bars, so the pair reads as "actual vs. its own faint reference"
// rather than two unrelated hues.
export const LANDSCAPE_HEX_LIGHT = {
  operational: '#93c5fd', // blue-300
  capital: '#c4b5fd',     // violet-300
} as const;

// Matches lib/budgetColors.ts's red/amber/green tiers (there expressed as Tailwind bg-*/text-*
// classes for the budget grid's month cells) — same semantic thresholds, hex form for charts.
export const STATUS_HEX = {
  over: '#ef4444',  // red-500 — over budget / bad
  watch: '#f59e0b', // amber-500 — approaching the line
  good: '#10b981',  // emerald-500 — on plan
  under: '#3b82f6', // blue-500 — "the other side" of a two-tone over/under chart, not a status
                     // judgment on its own (BudgetVsActualChart's "not over" bar color)
} as const;

export const CASHFLOW_HEX = {
  in: '#22c55e',   // green-500 — money in
  out: '#f97316',  // orange-500 — money out
  net: '#1e293b',  // slate-800 — the net line
} as const;

// Neutral "misc/other" bucket color — deliberately outside the status vocabulary above, since
// grouping a long tail into "Other" isn't a good/bad judgment.
export const NEUTRAL_HEX = '#94a3b8'; // slate-400

export const STATUS_CLASS = {
  red: 'text-red-500',
  amber: 'text-amber-500',
  green: 'text-emerald-500',
  blue: 'text-blue-500',
} as const;

export type StatusColor = keyof typeof STATUS_CLASS;
