// Screen 1 of four: "can I spend this?"
//
// ROADMAP.md §5 Phase 3 step 24, rewritten 2026-09-21. This is the question the app opens on —
// not net worth, not last month. The other three screens (did that land right / chat / quick
// entry) are not built yet; this one is the reason the app exists.

import { ActivityIndicator, RefreshControl, ScrollView, StyleSheet, Text, View } from 'react-native';
import { StatusBar } from 'expo-status-bar';
import { QueryClient, QueryClientProvider, useQuery } from '@tanstack/react-query';
import type { OverviewData } from '@b8/contracts/overview';
import { fetchOverview } from './lib/api';

/**
 * TanStack Query rather than a hand-rolled `useEffect` + `useState`, and step 23 names it for a
 * reason that showed up immediately: the first version of this screen called `setState` inside an
 * effect and the React lint rule refused it as a cascading render. Query also gives the two things
 * a guardrail needs and a hand-rolled fetch does not — a cached answer on reopen, so the screen is
 * useful before the network responds, and one place to decide staleness.
 *
 * `staleTime` is deliberately short. This screen exists to be trusted in a shop; a minute-old
 * figure is fine, a ten-minute-old one is the failure mode the freshness caveat exists for.
 */
const queryClient = new QueryClient({
  defaultOptions: { queries: { staleTime: 60_000, retry: 1 } },
});

const money = (v: string | number) =>
  `$${Number(v).toLocaleString('en-US', { maximumFractionDigits: 0 })}`;

/**
 * THE VERDICT AND ITS QUALIFIER, TOGETHER OR NOT AT ALL.
 *
 * `monthOutlook.state` has seven values and `nothing-to-score` is NOT `on-track` — §29a called a
 * green verdict over an empty scored set the worst thing the payload could assert. On a phone it is
 * worse: a guardrail that says "you have room" over transactions that stopped importing three weeks
 * ago has turned missing data into permission to spend. So `authoritative` and the staleness are
 * rendered beside the answer, never under a tap.
 */
function Verdict({ overview }: { overview: OverviewData }) {
  const { monthOutlook, feedHealth, jobHealth } = overview;
  // `jobHealth.status`, not a boolean. The first version of this line guessed `.healthy` and the
  // shared schema rejected it at typecheck — which is the argument for `packages/contracts` making
  // itself, on the first screen that used it.
  const stale = feedHealth.length > 0 || jobHealth.status !== 'fresh';

  const tone =
    monthOutlook.state === 'breach' || monthOutlook.state === 'projected-breach'
      ? styles.bad
      : monthOutlook.state === 'nothing-to-score'
        ? styles.unknown
        : styles.good;

  return (
    <View style={styles.verdict}>
      <Text style={[styles.verdictText, tone]}>{label(monthOutlook.state)}</Text>
      {!monthOutlook.authoritative && (
        <Text style={styles.caveat}>
          Confidence withdrawn — only {monthOutlook.coveragePercent}% of this month is categorised.
        </Text>
      )}
      {stale && (
        <Text style={styles.caveat}>
          {jobHealth.status === 'fresh'
            ? 'Some accounts are behind. This answer may be better than the truth.'
            : `The nightly job is ${jobHealth.status}. This answer may be better than the truth.`}
        </Text>
      )}
    </View>
  );
}

function label(state: OverviewData['monthOutlook']['state']): string {
  switch (state) {
    case 'breach': return 'Over on something';
    case 'projected-breach': return 'Heading over';
    case 'on-track': return 'Holding';
    case 'nothing-to-score': return 'Nothing scored yet';
    default: return state;
  }
}

/** The discretionary categories, worst first. Fixed and variable-necessary are never scored here. */
function SayingNo({ overview }: { overview: OverviewData }) {
  const rows = [...overview.monthOutlook.sayingNo, ...overview.monthOutlook.holding].filter(
    (c) => c.controlMode === 'discretionary'
  );
  if (rows.length === 0) return <Text style={styles.empty}>No discretionary category is scored this month.</Text>;

  return (
    <View>
      {rows.map((c) => (
        <View key={c.categoryId} style={styles.row}>
          <Text style={styles.category}>{c.category}</Text>
          <Text style={styles.amounts}>
            {money(c.actual)} <Text style={styles.of}>of {money(c.budgeted)}</Text>
          </Text>
        </View>
      ))}
    </View>
  );
}

function CanISpend() {
  const { data, error, isFetching, refetch } = useQuery({
    queryKey: ['overview'],
    queryFn: fetchOverview,
  });

  return (
    <View style={styles.screen}>
      <StatusBar style="dark" />
      <ScrollView
        contentContainerStyle={styles.content}
        refreshControl={<RefreshControl refreshing={isFetching} onRefresh={() => void refetch()} />}
      >
        <Text style={styles.heading}>Can I spend?</Text>
        {isFetching && !data && <ActivityIndicator style={styles.spinner} />}
        {error && (
          <Text style={styles.error}>
            {error instanceof Error ? error.message : 'Could not load.'}
          </Text>
        )}
        {data && (
          <>
            <Verdict overview={data} />
            <SayingNo overview={data} />
          </>
        )}
      </ScrollView>
    </View>
  );
}

export default function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <CanISpend />
    </QueryClientProvider>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: '#fff' },
  content: { padding: 20, paddingTop: 64 },
  heading: { fontSize: 13, fontWeight: '600', letterSpacing: 0.8, color: '#9ca3af', textTransform: 'uppercase', marginBottom: 16 },
  verdict: { marginBottom: 28 },
  verdictText: { fontSize: 32, fontWeight: '700' },
  good: { color: '#16a34a' },
  bad: { color: '#dc2626' },
  unknown: { color: '#d97706' },
  caveat: { fontSize: 13, color: '#d97706', marginTop: 8, lineHeight: 18 },
  row: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'baseline', paddingVertical: 12, borderBottomWidth: 1, borderBottomColor: '#f3f4f6' },
  category: { fontSize: 16, color: '#111827' },
  amounts: { fontSize: 16, fontVariant: ['tabular-nums'], color: '#111827' },
  of: { color: '#9ca3af' },
  empty: { fontSize: 14, color: '#9ca3af' },
  error: { fontSize: 14, color: '#dc2626', lineHeight: 20 },
  spinner: { marginTop: 40 },
});
