// The three things the dashboard's alert bell holds: the job, the feed, and ledger drift.
//
// FLAT, NOT BEHIND A BELL. A bell icon on a phone is a tap to discover whether anything is wrong, and
// the web's own note says the count is "how many things there are to read". At this width there is
// room to just read them — and the reason the web hides them is a wide header, which a phone has not
// got.
//
// ORDER IS THE WEB'S AND IT IS ARGUED THERE: the job first, because the feed and the drift each say a
// figure may be wrong, while a dead job says every figure may be old and the backups are missing too.

import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { C } from './tokens';

export interface JobHealth { status: string; daysSince: number | null; message: string }
export interface FeedFinding { institution: string; accountCount: number; state: string; hoursStale: number | null }
export interface DriftFinding { name: string; drift: string }

function Strip({ tone, text }: { tone: 'warn' | 'over'; text: string }) {
  const colour = tone === 'over' ? C.over : C.warn;
  return (
    <View style={[styles.strip, { borderLeftColor: colour }]}>
      <Text style={[styles.text, { color: colour }]}>{text}</Text>
    </View>
  );
}

export default function Alerts({ jobHealth, feedHealth, driftFindings }: {
  jobHealth: JobHealth;
  feedHealth: FeedFinding[];
  driftFindings: DriftFinding[];
}) {
  const strips: React.ReactNode[] = [];

  if (jobHealth.status !== 'fresh') {
    strips.push(<Strip key="job" tone="over" text={jobHealth.message} />);
  }
  if (feedHealth.length > 0) {
    // ONE MESSAGE ABOUT THE FEED, not one per institution — the web counts by card for the same
    // reason: two institutions behind is one thing to read.
    const names = feedHealth.map((f) => f.institution).join(', ');
    strips.push(
      <Strip
        key="feed"
        tone="warn"
        text={`${names} ${feedHealth.length === 1 ? 'is' : 'are'} behind. Figures may be older than they look.`}
      />
    );
  }
  if (driftFindings.length > 0) {
    strips.push(
      <Strip
        key="drift"
        tone="warn"
        text={`${driftFindings.length} account${driftFindings.length === 1 ? '' : 's'} drifting from the ledger.`}
      />
    );
  }

  if (strips.length === 0) return null;
  return <View style={styles.wrap}>{strips}</View>;
}

const styles = StyleSheet.create({
  wrap: { marginBottom: 18 },
  strip: { borderLeftWidth: 3, paddingLeft: 11, paddingVertical: 7, marginBottom: 8 },
  text: { fontSize: 13, lineHeight: 19 },
});
