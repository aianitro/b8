// The web dashboard, at phone width. The tab is called Dashboard too, as of 2026-09-22 — it was
// "Month", which named the time range rather than the thing, and the web page it mirrors has
// always been the dashboard.
//
// ROADMAP.md §5 Phase 3 step 24 named four screens "ruthlessly", and this is a fifth — added
// 2026-09-21 at the owner's request, because the dashboard and the monthly budget are where the web
// app's visibility actually lives and a phone that omits them is a phone you still walk to the
// laptop for. It is a deliberate amendment to that line, not a drift past it.
//
// WHAT IT DOES NOT DO IS TAKE SCREEN 1'S JOB. Screen 1 answers "can I spend this?" in two seconds
// and everything on it earns that. This screen is for reading, and it is a separate tab so that
// putting a chart on the guardrail never becomes tempting.
//
// EVERY WIDGET HERE IS FED BY `/api/v1/overview` — no new endpoint, which is exactly what that
// payload was built for.

import { useState } from 'react';
import { ActivityIndicator, RefreshControl, ScrollView, StyleSheet, Text, useWindowDimensions, View } from 'react-native';
import { useQuery } from '@tanstack/react-query';
import { watchlistIsStale } from '@b8/contracts/overview';
import { fetchOverview } from './lib/api';
import { C, money, signed } from './widgets/tokens';
import { Kpi, KpiRow } from './widgets/Kpi';
import Alerts from './widgets/Alerts';
import PlChart, { PlFigures } from './widgets/PlChart';
import BudgetTracks from './widgets/BudgetTracks';
import CategoryHeatmap from './widgets/CategoryHeatmap';
import Watchlist, { age } from './widgets/Watchlist';

const MONTHS = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <View style={styles.section}>
      <Text style={styles.sectionTitle}>{title}</Text>
      {children}
    </View>
  );
}

export default function Dashboard() {
  const { width } = useWindowDimensions();
  // Collapsed by default. The count is what earns permanent space; the rows are what you open when
  // the count is surprising.
  const [showWatchlist, setShowWatchlist] = useState(false);
  const { data, error, isFetching, refetch } = useQuery({
    queryKey: ['overview'],
    queryFn: fetchOverview,
  });

  // 40 = the screen's horizontal padding. Passed in rather than measured: the chart needs a width to
  // scale against, and a layout pass to discover it would draw once at zero first.
  const chartWidth = Math.max(240, width - 40);

  return (
    <View style={styles.screen}>
      <ScrollView
        contentContainerStyle={styles.content}
        refreshControl={<RefreshControl refreshing={isFetching} onRefresh={() => void refetch()} />}
      >
        {isFetching && !data && <ActivityIndicator style={styles.spinner} />}
        {error && (
          <Text style={styles.error}>
            {error instanceof Error ? error.message : 'Could not load.'}
          </Text>
        )}

        {data && (
          <>
            <Text style={styles.heading}>
              {MONTHS[data.asOf.month]} {data.asOf.year}
            </Text>
            <Text style={styles.subheading}>day {data.asOf.day}</Text>

            <Alerts
              jobHealth={data.jobHealth}
              feedHealth={data.feedHealth}
              driftFindings={data.driftFindings}
            />

            <KpiRow>
              {/* Projected P/L leads, as it does on the web, because it is the only one of these
                  that is a TARGET rather than a count. */}
              <Kpi
                label="Projected P/L"
                value={signed(data.yearEnd.profitLoss)}
                sub={`${signed(data.yearEnd.netToDate)} so far`}
                tone={Number(data.yearEnd.profitLoss) < 0 ? 'over' : 'ok'}
              />
              <Kpi
                label="Budget remaining"
                value={money(data.stats.remaining)}
                sub={`${money(data.stats.spent)} of ${money(data.stats.budget)}`}
                tone={Number(data.stats.remaining) < 0 ? 'over' : undefined}
              />
              {/* NO "Today" and NO "This week" — removed from the phone on 2026-09-22 at the owner's
                  request, and still on the web, which is the point rather than an inconsistency.
                  Both are short-horizon spending questions, and the phone already answers those on
                  screen 1, in two seconds, as a verdict. Repeating them here as figures made this
                  tab answer the guardrail's question worse than the guardrail does.

                  `today` and `week` stay in the overview contract: the web dashboard still renders
                  them, and a payload field with one client fewer is not a field to delete. */}
              {/* Uncategorized is a COUNT, and it is last because it is the only actionable-by-you
                  item here — everything above is a figure to read. */}
              <Kpi
                label="Uncategorized"
                value={data.stats.uncategorized.toLocaleString()}
                sub={data.stats.uncategorized > 0 ? 'fix these on Arrivals' : 'all categorised'}
                tone={data.stats.uncategorized > 0 ? 'warn' : 'ok'}
              />
              {/* Beside Uncategorized on purpose, and it is the second of the two: both are counts
                  of things waiting on the owner rather than figures to read, and this is the one
                  the owner put there themselves.

                  The only tappable card on the screen. Nothing here can be fixed from the phone, so
                  the tap opens the rows rather than pretending to a "Manage" the web has and this
                  does not — and it opens nothing at all when the count is zero, because a control
                  that responds with an empty list is worse than one that does not respond. */}
              <Kpi
                label="Keep an eye"
                value={data.watchlist.length.toLocaleString()}
                sub={
                  data.watchlist.length === 0
                    ? 'nothing flagged'
                    // The read orders oldest first, so [0] is the age that matters — and it is the
                    // figure that moves, which is the whole reason this is not wallpaper.
                    : `oldest ${age(data.watchlist[0].daysOpen)}`
                }
                tone={
                  data.watchlist.length === 0
                    ? 'ok'
                    : watchlistIsStale(data.watchlist[0].daysOpen) ? 'warn' : undefined
                }
                onPress={data.watchlist.length > 0 ? () => setShowWatchlist((v) => !v) : undefined}
                expanded={showWatchlist}
              />
            </KpiRow>

            {showWatchlist && <Watchlist items={data.watchlist} />}

            {/* The month's map. On the web this LEADS the dashboard, above the stat cards; here it
                sits under them, because a 300px picture at the top of a phone pushes Projected P/L
                and Budget remaining below the fold — and those are the figures the owner opens this
                tab for. The map is what you look at second, once a number has made you curious.

                It is also placed above the year chart on purpose: both are pictures, and this one
                is about the month in progress, which is the only part of the year still actionable. */}
            <Section title="Where the month sits">
              <CategoryHeatmap
                categories={data.monthCategories}
                width={chartWidth}
                // `asOf.month` is 0-based, as the payload's own schema documents; the drill-down
                // endpoint takes 1-12 like the URL it is fetched with.
                month={data.asOf.month + 1}
              />
            </Section>

            <Section title="The year, month by month">
              {/* `yearEnd.monthly`, not `monthlySpending`: twelve positional points carrying
                  `cumulative` and `projected`, so the rest of the year is drawn as a forecast
                  rather than left off — and so this picture arrives at the Projected P/L printed
                  in the KPI row above, which comes from the same reader. */}
              <PlChart points={data.yearEnd.monthly} width={chartWidth} />
              <PlFigures points={data.yearEnd.monthly} />
            </Section>

            {data.monthOutlook.offCycleElsewhere.length > 0 && (
              <Section title="Off-cycle earlier this year">
                {data.monthOutlook.offCycleElsewhere.map((c) => (
                  <View key={`${c.categoryId}-${c.month}`} style={styles.offCycle}>
                    <Text style={styles.offCycleName}>{c.category}</Text>
                    <Text style={styles.offCycleNote}>
                      {MONTHS[c.month]} drew outside its schedule · {money(c.actual)}
                    </Text>
                  </View>
                ))}
              </Section>
            )}

            <Section title="The year by category">
              <BudgetTracks
                rows={data.budgetVsActual}
                // The elapsed fraction counts the CURRENT MONTH AS PARTIAL. The web deleted a
                // year-pace bar that treated it as whole — 33% of the year on 1 April against a true
                // 25% — which inflated expected spend and flattered the pace. Same arithmetic here.
                yearElapsed={(data.asOf.month + data.asOf.day / 31) / 12}
              />
            </Section>
          </>
        )}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: '#fff' },
  content: { padding: 20, paddingBottom: 48 },
  heading: { fontSize: 24, fontWeight: '700', color: C.ink },
  subheading: { fontSize: 13, color: C.faint, marginTop: 2, marginBottom: 20 },
  section: { marginTop: 30 },
  sectionTitle: { fontSize: 12, fontWeight: '700', letterSpacing: 0.6, color: C.muted, textTransform: 'uppercase', marginBottom: 12 },
  offCycle: { paddingVertical: 9, borderBottomWidth: 1, borderBottomColor: C.hair },
  offCycleName: { fontSize: 15, color: C.ink },
  offCycleNote: { fontSize: 12, color: C.faint, marginTop: 2 },
  error: { fontSize: 14, color: C.over, lineHeight: 20 },
  spinner: { marginTop: 40 },
});
