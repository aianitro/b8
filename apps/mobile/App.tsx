// The app's shell and its tab bar.
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
import Chat from './Chat';
import QuickEntry from './QuickEntry';
import Dashboard from './Dashboard';
import Budget from './Budget';

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
type Tab = 'dashboard' | 'budget' | 'arrivals' | 'ask' | 'enter';

const TABS: Array<{ key: Tab; label: string }> = [
  { key: 'dashboard', label: 'Dashboard' },
  { key: 'budget', label: 'Budget' },
  { key: 'arrivals', label: 'Arrivals' },
  { key: 'ask', label: 'Ask' },
  { key: 'enter', label: 'Enter' },
];

/**
 * STILL NOT react-navigation. Five screens, no stack, no params, no deep links: a navigator would
 * add peer dependencies and a gesture handler to solve a problem this app does not have. The moment
 * that changes is a screen that needs to push another on top of itself, and none of these do.
 *
 * BACK TO FIVE. "Spend?" was removed on 2026-09-22 at the owner's request. It was step 24's screen
 * 1 and the tab the app opened on, so three things had to MOVE rather than go: `PingSetup`, which
 * is the only way to turn notifications on; `DeviceCard`; and the "use a different token" recovery,
 * without which an expired credential bricks the app until it is reinstalled. All three now sit at
 * the foot of Dashboard, which is what the app opens on instead.
 *
 * WHAT WENT WITH IT, WRITTEN DOWN SO IT IS NOT REDISCOVERED AS A BUG: the phone no longer answers a
 * short-horizon spending question anywhere. "Today" and "This week" came off the dashboard on the
 * same day precisely because this screen answered them better as a verdict, and that reasoning is
 * now void. Nothing on screen is wrong; the app is simply missing the question, and putting those
 * two cards back is the smallest way to have it again.
 *
 * "Dashboard" is still the longest label and still proves the bar's width ceiling: nine characters
 * at 12px semibold is ~63px, which fits a 393pt screen with about a point either side and does NOT
 * fit a 375pt one at six tabs. `adjustsFontSizeToFit` below shrinks the one label that overflows on
 * the one screen size where it does, rather than making all of them smaller everywhere, and
 * `numberOfLines` stops a long label wrapping to a second line and changing the bar's height. At
 * five there is room again; the guard stays, because the ceiling is a property of the bar rather
 * than of today's tab count.
 */
function Tabs() {
  const [tab, setTab] = useState<Tab>('dashboard');
  return (
    <View style={styles.screen}>
      <StatusBar style="dark" />
      <View style={styles.tabBody}>
        {tab === 'dashboard' && <Dashboard />}
        {tab === 'budget' && <Budget />}
        {tab === 'arrivals' && <DidThatLandRight />}
        {tab === 'ask' && <Chat />}
        {tab === 'enter' && <QuickEntry />}
      </View>
      <View style={styles.tabBar}>
        {TABS.map((t) => (
          <Pressable key={t.key} style={styles.tab} onPress={() => setTab(t.key)}>
            <Text
              style={[styles.tabText, tab === t.key && styles.tabTextActive]}
              numberOfLines={1}
              adjustsFontSizeToFit
              minimumFontScale={0.85}
            >
              {t.label}
            </Text>
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
  centred: { alignItems: 'center', justifyContent: 'center' },
  tabBody: { flex: 1 },
  tabBar: { flexDirection: 'row', borderTopWidth: 1, borderTopColor: '#e5e7eb', paddingBottom: 26, paddingTop: 10 },
  tab: { flex: 1, alignItems: 'center', paddingVertical: 6 },
  tabText: { fontSize: 12, color: '#9ca3af', fontWeight: '600' },
  tabTextActive: { color: '#111827' },
});
