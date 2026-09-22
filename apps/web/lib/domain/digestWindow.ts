/**
 * How far back the digest's arrivals section reaches.
 *
 * ─── Why this is not "yesterday" ──────────────────────────────────────────────────────────────
 *
 * It was, and the section was near-empty for a structural reason rather than a quiet one. Measured
 * over 30 days of this repo's own ledger: NO transaction is ever written on the day it is dated —
 * every row lands one to five days later, because a card feed posts after the fact. So a section
 * asking for `t.date = yesterday`, run at 06:00, could only ever catch the minority that happened
 * to land in that morning's sync. 27% of rows appeared; the other 73% fell through permanently —
 * the D+1 email ran before they arrived, and by the time they did, "yesterday" had moved past
 * their date and no later email would ever ask for them again.
 *
 * The dashboard had this right and said so: `overviewRead.ts`'s arrivals query is keyed on
 * `created_at`, "because the question is what is new to the reader". `digestRead.ts` copied that
 * query's label expression, with a comment explaining it did so in order to read the same — and
 * left the keying behind. The label travelled; the definition did not.
 *
 * ─── Why since-the-last-email rather than a fixed 24 or 36 hours ──────────────────────────────
 *
 * A fixed window reintroduces the same bug in miniature. 24h drops everything that arrived while a
 * run was late or skipped, which is the exact failure just fixed; 36h overlaps, so a row is
 * reported twice and the reader starts discounting the section.
 *
 * Anchoring to the last DELIVERED digest has neither property: the windows abut exactly, a missed
 * day is covered by the next email rather than lost, and nothing is listed twice. `delivered`, not
 * merely attempted — a send that failed reported nothing to anybody, so its window is still owed.
 */

/**
 * The fallback reach when no digest has ever been delivered — a first run, or a restored database.
 *
 * Deliberately wider than a day. The alternative is a first email that silently begins mid-history
 * with no way for the reader to tell; three days of arrivals is a visibly full first email, and a
 * reader who sees more than they expected once asks no questions of the ones after it.
 */
export const FIRST_RUN_REACH_HOURS = 72;

/**
 * How far BEFORE the previous send the window reaches back.
 *
 * The previous email queried its rows, then rendered a chart through a native rasteriser, then
 * talked to an SMTP server, and only then wrote its `alert_sends` row. Anchoring the next window on
 * that final timestamp leaves the seconds in between belonging to neither email: the old one
 * queried before those rows existed, the new one starts after they were created.
 *
 * Seconds wide, and only reachable if a manual sync lands inside it — but a silent permanent loss
 * is the exact failure this module exists to remove, and it does not become acceptable for being
 * rare. THE TRADE IS DELIBERATE AND ONE-DIRECTIONAL: a margin can only ever cause a row to be
 * listed twice, which the reader can see and dismiss. The alternative loses it, which nobody can
 * see at all. Five minutes because the daily sync finishes well before the digest renders, so in
 * normal operation nothing arrives in the band and nothing repeats.
 */
export const WINDOW_OVERLAP_MINUTES = 5;

/**
 * Where the arrivals window starts.
 *
 * `lastDelivered` is null on a first run. A timestamp in the FUTURE — a clock stepping backwards,
 * a restored dump — is treated as absent rather than trusted, because a future anchor produces an
 * empty window and an email that reports nothing happened.
 */
export function arrivalsSince(lastDelivered: Date | null, now: Date): Date {
  const fallback = new Date(now.getTime() - FIRST_RUN_REACH_HOURS * 3600_000);
  if (lastDelivered === null || Number.isNaN(lastDelivered.getTime())) return fallback;
  if (lastDelivered.getTime() >= now.getTime()) return fallback;
  // No floor on how far back this may reach. A fortnight's outage should produce one email
  // covering the fortnight, not one covering the last three days of it with the rest dropped —
  // dropping them is the bug this whole module exists to remove.
  return new Date(lastDelivered.getTime() - WINDOW_OVERLAP_MINUTES * 60_000);
}

/**
 * Whether a digest has already gone out today, on the reader's calendar.
 *
 * ─── Why the fingerprint alone stopped being enough ───────────────────────────────────────────
 *
 * Suppression used to rest entirely on the message fingerprint: a second run on the same day
 * rendered identical content, hashed the same, and was dropped. That worked because the content
 * was a function of the DAY. It is not any more — the arrivals window now starts at the previous
 * delivered send, so a re-run minutes later renders a different (usually empty) section, hashes
 * differently, and would be sent as a second email.
 *
 * That matters because `runDailyJob` fires once on startup as well as on its timer, so every
 * server restart would post one. The fingerprint check stays — it is what stops a genuine
 * duplicate — and this is what stops a second DIFFERENT one on a day already served.
 *
 * Local days, not UTC: "already had today's email" is a claim about the reader's morning.
 */
export function alreadySentToday(lastDelivered: Date | null, now: Date): boolean {
  if (lastDelivered === null || Number.isNaN(lastDelivered.getTime())) return false;
  // A send stamped in the future is not evidence that today was served; treated as absent here for
  // the same reason `arrivalsSince` distrusts it, so a stepped clock cannot mute the digest.
  if (lastDelivered.getTime() > now.getTime()) return false;
  return lastDelivered.getFullYear() === now.getFullYear()
    && lastDelivered.getMonth() === now.getMonth()
    && lastDelivered.getDate() === now.getDate();
}
