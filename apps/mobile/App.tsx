// The app's shell, and screen 1: "can I spend this?"
//
// ROADMAP.md §5 Phase 3 step 24, rewritten 2026-09-21. Screen 1 is the question the app opens on —
// not net worth, not last month — and it is the reason the app exists. Screen 2 lives in
// `DidThatLandRight.tsx`. Screens 3 (chat) and 4 (quick entry) are not built.

import { useState } from 'react';
import { ActivityIndicator, Pressable, RefreshControl, ScrollView, StyleSheet, Text, View } from 'react-native';
import { StatusBar } from 'expo-status-bar';
import { QueryClient, QueryClientProvider, useQuery, useQueryClient } from '@tanstack/react-query';
import type { OverviewData } from '@b8/contracts/overview';
import { fetchOverview } from './lib/api';
import { clearToken, readToken } from './lib/config';
import PasteToken from './PasteToken';
import DidThatLandRight from './DidThatLandRight';
import PingSetup from './PingSetup';
import Chat from './Chat';
import QuickEntry from './QuickEntry';

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

type Row = OverviewData['monthOutlook']['sayingNo'][number];

/**
 * THE NUMBER A PERSON IN A SHOP NEEDS IS WHAT IS LEFT, not a percentage.
 *
 * `spentRatio` is deliberately not rendered. The contract's own note on `OutlookCategorySchema`
 * warns that it means three incomparable things across the six statuses, so a consumer binding one
 * column across all of them prints "250% of December" above "71% of April". Money subtracts the
 * same way in every status.
 */
function remaining(row: Row): number {
  return Number(row.budgeted) - Number(row.actual);
}

function Category({ row, over }: { row: Row; over: boolean }) {
  const left = remaining(row);
  return (
    <View style={styles.row}>
      <Text style={[styles.category, over && styles.categoryOver]}>{row.category}</Text>
      <View style={styles.right}>
        <Text style={[styles.headlineAmount, over ? styles.bad : styles.neutral]}>
          {over ? `${money(-left)} over` : `${money(left)} left`}
        </Text>
        <Text style={styles.sub}>
          {money(row.actual)} of {money(row.budgeted)}
        </Text>
      </View>
    </View>
  );
}

/**
 * Two sections, not one list.
 *
 * The first version merged `sayingNo` and `holding` into a single flat list styled identically, so
 * the verdict said "over on something" and the list left you to work out which. That fails the test
 * step 24 sets for this screen — it has to answer in two seconds — and it was the owner reading it
 * on a phone that made it obvious, not anything visible from a diff.
 */
function Categories({ overview }: { overview: OverviewData }) {
  const discretionary = (rows: Row[]) => rows.filter((c) => c.controlMode === 'discretionary');
  // Worst first within each section: the deepest overspend, then the tightest headroom.
  const over = discretionary(overview.monthOutlook.sayingNo).sort(
    (a, b) => remaining(a) - remaining(b)
  );
  const holding = discretionary(overview.monthOutlook.holding).sort(
    (a, b) => remaining(a) - remaining(b)
  );

  if (over.length === 0 && holding.length === 0) {
    return <Text style={styles.empty}>No discretionary category is scored this month.</Text>;
  }

  return (
    <View>
      {over.length > 0 && (
        <>
          <Text style={styles.sectionHeading}>Stop spending here</Text>
          {over.map((c) => <Category key={c.categoryId} row={c} over />)}
        </>
      )}
      {holding.length > 0 && (
        <>
          <Text style={[styles.sectionHeading, over.length > 0 && styles.sectionSpaced]}>
            Room left
          </Text>
          {holding.map((c) => <Category key={c.categoryId} row={c} over={false} />)}
        </>
      )}
    </View>
  );
}

function CanISpend() {
  const queryClient = useQueryClient();
  const { data, error, isFetching, refetch } = useQuery({
    queryKey: ['overview'],
    queryFn: fetchOverview,
  });

  // A token expires — 30 days, or revoked from the server — and when it does the only useful thing
  // this screen can offer is a way to replace it. Without this the app is bricked until someone
  // deletes and reinstalls it, which is a poor answer for a credential doing its job.
  async function forget() {
    await clearToken();
    await queryClient.invalidateQueries({ queryKey: ['token'] });
  }

  return (
    <View style={styles.screen}>
      <ScrollView
        contentContainerStyle={styles.content}
        refreshControl={<RefreshControl refreshing={isFetching} onRefresh={() => void refetch()} />}
      >
        <Text style={styles.heading}>Can I spend?</Text>
        {isFetching && !data && <ActivityIndicator style={styles.spinner} />}
        {error && (
          <>
            <Text style={styles.error}>
              {error instanceof Error ? error.message : 'Could not load.'}
            </Text>
            <Pressable onPress={forget} style={styles.link}>
              <Text style={styles.linkText}>Use a different token</Text>
            </Pressable>
          </>
        )}
        {data && (
          <>
            <Verdict overview={data} />
            <Categories overview={data} />
            <PingSetup />
          </>
        )}
      </ScrollView>
    </View>
  );
}

/**
 * The gate: is there a credential on this phone at all?
 *
 * Read through Query rather than an effect, for the same reason the overview is — an effect that
 * calls setState is what the React lint rule refuses, and this way `forget()` invalidating
 * `['token']` re-runs the check and returns to the paste screen with no extra state to keep in
 * sync.
 */
function Root() {
  const { data: token, isLoading } = useQuery({
    queryKey: ['token'],
    queryFn: readToken,
    staleTime: Infinity,
  });
  const queryClient = useQueryClient();

  if (isLoading) {
    return (
      <View style={[styles.screen, styles.centred]}>
        <ActivityIndicator />
      </View>
    );
  }

  if (!token) {
    return (
      <PasteToken
        onSaved={() => {
          // Both keys: the token changed, and the payload it authorises must be re-fetched rather
          // than served from a cache populated before there was a credential.
          void queryClient.invalidateQueries({ queryKey: ['token'] });
          void queryClient.invalidateQueries({ queryKey: ['overview'] });
        }}
      />
    );
  }

  return <Tabs />;
}

/**
 * Two tabs, hand-rolled.
 *
 * NOT react-navigation, deliberately. Two screens with no stack, no params and no deep links do not
 * need a navigator, its four peer dependencies and a gesture handler — and step 24's list is
 * "ruthlessly" four screens. When screens 3 and 4 arrive and one of them needs a stack, that is the
 * moment to add a real navigator, not now.
 */
type Tab = 'spend' | 'arrivals' | 'ask' | 'enter';

const TABS: Array<{ key: Tab; label: string }> = [
  { key: 'spend', label: 'Spend?' },
  { key: 'arrivals', label: 'Arrivals' },
  { key: 'ask', label: 'Ask' },
  { key: 'enter', label: 'Enter' },
];

/**
 * Four tabs, hand-rolled — step 24's list, "ruthlessly", complete.
 *
 * STILL NOT react-navigation. Four screens, no stack, no params, no deep links: a navigator would
 * add peer dependencies and a gesture handler to solve a problem this app does not have. The moment
 * that changes is a screen that needs to push another on top of itself, and none of these do.
 */
function Tabs() {
  const [tab, setTab] = useState<Tab>('spend');
  return (
    <View style={styles.screen}>
      <StatusBar style="dark" />
      <View style={styles.tabBody}>
        {tab === 'spend' && <CanISpend />}
        {tab === 'arrivals' && <DidThatLandRight />}
        {tab === 'ask' && <Chat />}
        {tab === 'enter' && <QuickEntry />}
      </View>
      <View style={styles.tabBar}>
        {TABS.map((t) => (
          <Pressable key={t.key} style={styles.tab} onPress={() => setTab(t.key)}>
            <Text style={[styles.tabText, tab === t.key && styles.tabTextActive]}>{t.label}</Text>
          </Pressable>
        ))}
      </View>
    </View>
  );
}

export default function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <Root />
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
  sectionHeading: { fontSize: 12, fontWeight: '700', letterSpacing: 0.6, color: '#6b7280', textTransform: 'uppercase', marginBottom: 6 },
  sectionSpaced: { marginTop: 28 },
  row: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingVertical: 13, borderBottomWidth: 1, borderBottomColor: '#f3f4f6' },
  category: { fontSize: 17, color: '#111827', flexShrink: 1, paddingRight: 12 },
  categoryOver: { fontWeight: '600' },
  right: { alignItems: 'flex-end' },
  headlineAmount: { fontSize: 17, fontWeight: '600', fontVariant: ['tabular-nums'] },
  neutral: { color: '#111827' },
  sub: { fontSize: 12, color: '#9ca3af', fontVariant: ['tabular-nums'], marginTop: 2 },
  empty: { fontSize: 14, color: '#9ca3af' },
  error: { fontSize: 14, color: '#dc2626', lineHeight: 20 },
  spinner: { marginTop: 40 },
  centred: { alignItems: 'center', justifyContent: 'center' },
  tabBody: { flex: 1 },
  tabBar: { flexDirection: 'row', borderTopWidth: 1, borderTopColor: '#e5e7eb', paddingBottom: 26, paddingTop: 10 },
  tab: { flex: 1, alignItems: 'center', paddingVertical: 6 },
  tabText: { fontSize: 13, color: '#9ca3af', fontWeight: '600' },
  tabTextActive: { color: '#111827' },
  link: { marginTop: 14, alignSelf: 'flex-start' },
  linkText: { fontSize: 15, color: '#2563eb', textDecorationLine: 'underline' },
});
