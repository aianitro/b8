---
name: uiux-promax
description: UI/UX design system for B8 Finance — tokens, component patterns, chart conventions, layout rules, and interaction standards. Invoke before building any new page, component, or chart.
---

# B8 Finance — UI/UX Design System

Read this fully before writing any UI code. All new components must conform to these standards.

---

## Color Tokens

| Concept            | Tailwind class           | Hex       |
|--------------------|--------------------------|-----------|
| Operational        | `bg-blue-500`            | `#3b82f6` |
| Capital            | `bg-violet-500`          | `#8b5cf6` |
| Income / money in  | `text-green-600`         | `#16a34a` |
| Expense / money out| `text-orange-500`        | `#f97316` |
| Over budget        | `text-red-600`           | `#dc2626` |
| On track           | `text-green-600`         | `#16a34a` |
| Warning / pace     | `text-amber-600`         | `#d97706` |
| Muted text         | `text-gray-400`          | `#9ca3af` |
| Border             | `border-gray-200`        | default   |

Chart fills (Recharts hex values):
- Operational bar/line: `#3b82f6`
- Capital bar/line: `#8b5cf6`
- Money in: `#22c55e`
- Money out: `#f97316`
- Over budget cell: `#ef4444`
- Under budget cell: `#3b82f6`
- Budget reference line: `#e5e7eb`

---

## Typography

| Use case              | Classes                                          |
|-----------------------|--------------------------------------------------|
| Page title            | `text-2xl font-semibold`                         |
| Section heading       | `text-lg font-semibold`                          |
| Widget title          | `text-sm font-semibold uppercase tracking-wide text-gray-400` |
| Table header          | `text-xs font-medium text-gray-400`              |
| Body / table cell     | `text-sm`                                        |
| Currency amounts      | `font-mono` + `Intl.NumberFormat` (USD, 0 decimals for large, 2 for exact) |
| Badges / labels       | `text-xs px-2 py-0.5 rounded-full font-medium`   |
| Muted / sub-labels    | `text-xs text-gray-400`                          |

Always format currency with:
```ts
new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 }).format(n)
```

---

## Layout

- **Max widths**: `max-w-3xl` (budget, categories, accounts), `max-w-5xl` (dashboard, transactions)
- **Page padding**: `p-8`
- **Section spacing**: `mb-8` between major sections, `mb-10` between landscape groups
- **Grid**: `grid grid-cols-2 gap-6` for side-by-side widgets; stack to single column on narrow viewports
- **Widget card shell**: `border rounded-xl p-6`
- **Stat card shell**: `border rounded-lg p-4`

---

## Component Patterns

### Stat cards (top of dashboard/budget)
```tsx
<div className="border rounded-lg p-4">
  <p className="text-xs text-gray-400 uppercase tracking-wide mb-1">{label}</p>
  <p className="text-xl font-semibold {color}">{value}</p>
  <p className="text-xs text-gray-400 mt-1">{sub}</p>  {/* optional */}
</div>
```
Stat card grid: `grid grid-cols-3 gap-4 mb-8`

### Callout / alert banners
```tsx
<div className="border border-amber-200 bg-amber-50 rounded-lg p-4">
  ...amber for warnings...
</div>
```
Use `amber` for warnings, `red` for over-budget, `green` for on-track confirmations.

### Tables
```tsx
<table className="w-full text-sm">
  <thead>
    <tr className="text-left text-gray-400 border-b">
      <th className="pb-2 font-medium">...</th>
    </tr>
  </thead>
  <tbody>
    <tr className="border-b last:border-0 hover:bg-gray-50">...</tr>
  </tbody>
</table>
```
- Right-align all numeric/currency columns
- Left-align text columns
- `hover:bg-gray-50` on tbody rows
- `last:border-0` on final row

### Progress bars
```tsx
<div className="w-full bg-gray-100 rounded-full h-1.5">
  <div className="h-1.5 rounded-full {color}" style={{ width: `${pct}%` }} />
</div>
```
Companion percentage label: `<span className="text-xs text-gray-400">{pct}%</span>`

### Landscape badges
```tsx
<span className="text-xs px-2 py-0.5 rounded-full font-medium bg-blue-50 text-blue-700">operational</span>
<span className="text-xs px-2 py-0.5 rounded-full font-medium bg-purple-50 text-purple-700">capital</span>
```

### Buttons
| Role      | Classes                                                                 |
|-----------|-------------------------------------------------------------------------|
| Primary   | `px-4 py-2 bg-blue-600 text-white rounded hover:bg-blue-700 text-sm`   |
| Secondary | `px-4 py-2 bg-gray-800 text-white rounded hover:bg-gray-700 text-sm`   |
| Danger    | `text-red-400 hover:text-red-600 text-xs`                               |
| Toggle    | active: `bg-gray-900 text-white`, inactive: `bg-gray-100 text-gray-600 hover:bg-gray-200` |

Always add `disabled:opacity-50` to interactive elements with loading state.

---

## Chart Conventions (Recharts)

Every chart must:
1. Be a `'use client'` component
2. Wrap in `<ResponsiveContainer width="100%" height={N}>`
3. Use `<CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />`
4. Format tooltip with `formatter={(v) => fmt(Number(v))}`
5. Use `tick={{ fontSize: 12 }}` on axes
6. Use `tickFormatter={(v) => \`$${(v/1000).toFixed(0)}k\`}` on Y axes for large values

Chart sizing:
- Full-width charts: `height={260}`
- Donut / side-by-side: `height={200}`
- Horizontal bar: `height={rows.length * 52 + 20}` (dynamic)

Data always flows server → client: server component fetches, passes as props. No client-side API fetching for chart data.

---

## Interaction & State

| State        | Pattern                                                              |
|--------------|----------------------------------------------------------------------|
| Saving       | `disabled={saving}` + `disabled:opacity-50` + label "Saving…"       |
| Empty        | Friendly text + underlined action link, e.g. "No data. Add some."   |
| Error        | `<p className="text-red-500 text-sm">{error}</p>` inline            |
| Success      | `router.refresh()` to re-fetch server data; no toast needed for MVP  |
| Loading page | Next.js streaming via Suspense where needed                          |

---

## File & Size Rules

- Components: max ~150 lines. Extract sub-components if longer.
- Chart data transforms: keep in the server page, not in the chart component.
- Chart component only receives typed, ready-to-render data — no raw DB rows.
- No inline styles except `width`/`height` for chart bars (Recharts requirement).

---

## Checklist Before Shipping a UI Change

- [ ] Color tokens match the table above (no ad-hoc hex values)
- [ ] Currency formatted via `Intl.NumberFormat`
- [ ] Empty state handled
- [ ] Disabled + loading state on all interactive elements
- [ ] `tsc --noEmit` passes
- [ ] All pages return 200 (spot-check with curl)
