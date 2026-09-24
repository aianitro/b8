// One question, two pictures, chosen by how much room the answer has.
//
// ─── THE SWITCH IS WIDTH, NOT DISPLAY MODE, AND THAT WAS A DECISION ───────────────────────────
//
// The owner asked for bubbles back on the laptop and tiles in the PWA. The literal reading is
// `display-mode: standalone`, which this app already detects in `PushSetup.tsx` and which would
// have been easy. It is the wrong switch, and it fails in both directions:
//
//   - Chrome and Edge install this app on a DESKTOP. That window opens near 1400px and would get
//     the narrow-screen treatment on the widest screen in the house.
//   - Opening the dashboard in a phone browser tab without installing it would get bubbles at
//     390px — the exact complaint that started this.
//
// It is also client-only. No request header carries display-mode, so the server cannot branch on
// it: the page would render one shape, hydrate, and swap the largest widget on the dashboard after
// load. Width is what actually decides whether circle packing works — circles spend roughly a
// third of their box on the gaps BETWEEN circles, which is affordable at 1000px and is not at 390
// — and width is legible to CSS during SSR, on every device, whatever launched it.
//
// ─── BOTH ARE RENDERED AND CSS PICKS ONE, rather than a hook picking one ──────────────────────
//
// A `matchMedia` hook would render only the chosen shape and is the tempting version. Its server
// snapshot has to be a guess — there is no viewport on a server — so the phone would be served
// bubbles and swap to tiles on hydration, which is the flash this file exists to avoid. Two hidden
// divs cost two pure layouts over sixteen items and nothing else; the wrong shape is never painted
// at any point, at either width.
//
// `lg` (1024px) rather than `sm`: the bubbles' geometry is tuned for a box about 1000 units wide,
// and below that the SVG scales every label down with it. The breakpoint is where the picture still
// renders near its design size, not where it merely fits.

import CategoryBubbles from './CategoryBubbles';
import CategoryHeatmap from './CategoryHeatmap';

/** What both pictures need, and all they need. Numbers, not the wire's money strings. */
export interface MonthCategoryView {
  category: string;
  /** This month's allocation. Drives the AREA of the circle or the tile. */
  budgeted: number;
  /** Spent so far this month. */
  actual: number;
  /** Where the month is heading, as a fraction of budget. Null when there is no basis yet. */
  projectedRatio: number | null;
  /** True while the month is too young to project from — drawn, but never graded as a verdict. */
  tooEarly: boolean;
}

/**
 * @param month 0-based, as every month index in this app is. Both pictures link out with it rather
 *              than reading a clock of their own — the figures come from the page's as-of, and a
 *              second clock read could name a different month than the one they were computed for.
 */
export default function WhereTheMonthSits({ categories, month }: {
  categories: MonthCategoryView[];
  month: number;
}) {
  return (
    <>
      <div className="hidden lg:block">
        <CategoryBubbles categories={categories} month={month} />
      </div>
      <div className="lg:hidden">
        <CategoryHeatmap categories={categories} month={month} />
      </div>
    </>
  );
}
