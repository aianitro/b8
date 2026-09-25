import { createTransport } from 'nodemailer';
import db from './db';
import { createLogger } from './logger';
import { loadDigest } from './digestRead';
import { TAILNET_HOSTNAME } from './hostGuard';
import { renderDigest, type DigestData, type DigestMessage } from './domain/digest';
import { alreadySentToday } from './domain/digestWindow';
import { BUBBLES_CID, CHART_CID, renderBubblesPng, renderChartPng } from './digestImage';
import { alertsEnabled, describeSmtp, smtpSettings, type SmtpSettings } from './mailConfig';
import type { AlertKind } from './domain/pushPing';

const log = createLogger('dailyDigest');

/**
 * The daily job's mail pass. Resolves, always.
 *
 * ─── This file is deliberately incapable of deciding anything ─────────────────────────────────
 *
 * The same shape as `lib/breachAlert.ts`, which it replaces in the scheduler, and for the same
 * reason: this is the one piece of the feature no test can exercise. A test of the delivery path
 * opens a socket to a mail provider and sends the owner's real figures to a real address, which
 * BUILD.md §5.4 forbids outright. So every branch that depends on a financial fact lives in
 * `lib/domain/digest.ts`, where fixtures pin it, and every query lives in `lib/digestRead.ts`.
 * What is left here is four I/O calls in a fixed order and an error path.
 *
 * If you are tempted to add a condition here — "only on weekdays", "skip if nothing changed",
 * "retry twice" — it belongs in the pure module. A rule that lives here is a rule with no test.
 *
 * ─── Why this replaced the breach alert rather than joining it ────────────────────────────────
 *
 * Two emails a day from one app is one email a day that gets filtered. The guardrail alert's
 * modules are still in the tree and still tested; nothing schedules them any more. They are not
 * dead by accident, and the choice between folding pacing into the digest as a fourth widget and
 * deleting them is a decision for whoever makes it, not a thing to leave implied by an unused
 * export. Stated here because a reader of `lib/scheduler.ts` will wonder.
 *
 * ─── Nothing sends unless the owner has said so, in one exact word ────────────────────────────
 *
 * `alertsEnabled` is checked FIRST, before a query runs and long before a transport exists, and it
 * demands the literal string `true`. A checked-out repo cannot send.
 */
/**
 * RETURNS WHAT IT DELIVERED, so step 25's ping can inherit this function's suppression instead of
 * inventing a second notion of what counts as news. An empty array means nothing went out — alerts
 * disabled, suppressed as "not news twice", or a failed send — and `shouldPing` reads it directly.
 *
 * Still resolves rather than rejects. The return value is additive; every existing `return` below
 * becomes `return []`, which is the honest answer in each of those branches.
 */
export async function runDailyDigest(): Promise<AlertKind[]> {
  try {
    if (!alertsEnabled(process.env)) {
      log.info('alerts disabled, nothing attempted');
      return [];
    }

    // The one clock read, converted once and passed down — `loadDigest` derives "this month" and
    // the arrivals window from this single Date, and `alreadySentToday` below answers against the
    // same instant. A second `new Date()` downstream is a second calendar, and the two disagree for
    // the hours around midnight, which is exactly when this job runs.
    const now = new Date();
    const data = await loadDigest(now);

    // ONE EMAIL A DAY, checked before anything is rendered. The fingerprint test below used to
    // carry this on its own: a second run rendered identical content and hashed the same. That
    // stopped being true when the arrivals window moved to "since the last delivered send" — a
    // re-run now renders a different, usually empty, section and would be sent as a second email.
    // `runDailyJob` fires once on startup as well as on its timer, so without this every server
    // restart would post one. The decision itself is pure and tested; this reads the clock.
    if (alreadySentToday(data.lastDeliveredAt ? new Date(data.lastDeliveredAt) : null, now)) {
      log.info('a digest has already gone out today, suppressed');
      return [];
    }

    // Rendered BEFORE the suppression check is answered? No — after. The chart is the one expensive
    // step in this job (an SVG rasterised through a native library), and a suppressed run should
    // not pay for a picture nobody receives.
    // The tailnet name the app already answers to — `lib/hostGuard.ts` owns it, derived from one
    // environment variable. An email has no origin to resolve a relative path against, so the
    // links inside it have to be absolute, and a second literal spelling of where this app lives
    // is the kind of copy that survives a machine move by pointing at nothing.
    const message = renderDigest(
      data, `cid:${CHART_CID}`, `cid:${BUBBLES_CID}`, `https://${TAILNET_HOSTNAME}`,
    );

    // Every row for this fingerprint, unfiltered, handed to the pure predicate. The `delivered`
    // test is deliberately NOT in this WHERE clause: written as `AND delivered LIMIT 1` the SQL
    // would be making the suppression decision, in the one file no test reaches, and the rule
    // below would become dead code that still looked correct. The rule that matters is that a
    // FAILED send never silences the retry.
    const priors = await db.query<{ fingerprint: string; delivered: boolean }>(
      'SELECT fingerprint, delivered FROM alert_sends WHERE fingerprint = $1',
      [message.fingerprint]
    );

    if (priors.rows.some((row) => row.delivered)) {
      log.info('today\'s digest already delivered, suppressed');
      return [];
    }

    // `['digest']` only when it actually went out. `runDailyJob` hands this to `sendPingIfDelivered`,
    // so the ping inherits this function's suppression rather than deciding newsworthiness twice.
    return (await attempt(message, data)) ? ['digest'] : [];
  } catch (err) {
    // Anything that escaped the classified paths below — a database that would not answer, a bug.
    // Logged and dropped, because the alternative is an unhandled rejection inside the daily job
    // that also runs the Plaid sync and writes the net worth snapshot.
    log.error('daily digest failed', { error: err instanceof Error ? err.message : String(err) });
  }
  return [];
}

/**
 * One attempt, and one row recording how it went — including when it went badly.
 *
 * A row is written for a FAILED attempt too, which is why `alert_sends` is a table rather than a
 * log line. Without it, "no digest for three weeks" and "the provider was unreachable for three
 * weeks" are the same empty set, and they are different problems with different fixes.
 *
 * `failure_reason` is one of three literals or `NULL`, never the provider's error text: a rejection
 * routinely quotes the message back, subject line included, and the subject now carries a count and
 * a dollar figure. The detail goes to the log, which is where an operator looks and is not the row
 * that gets pasted into a report.
 */
/** Returns whether the mail was actually delivered — the input to step 25's ping decision. */
async function attempt(message: DigestMessage, data: DigestData): Promise<boolean> {
  let settings: SmtpSettings;
  try {
    settings = smtpSettings(process.env);
  } catch (err) {
    // Configured wrongly, or not configured. No connection was attempted, so this is not a
    // transport failure and must not be classified as one — they have different fixes.
    log.error('mail configuration rejected', { error: err instanceof Error ? err.message : String(err) });
    await record(message, false, 'config');
    return false;
  }

  try {
    const transport = createTransport({
      host: settings.host,
      port: settings.port,
      secure: settings.secure,
      requireTLS: settings.requireTLS,
      auth: settings.auth,
    });

    // BOTH PARTS, ALWAYS. The text part is not a courtesy: a client that shows it is a client the
    // HTML failed in, and sending HTML alone fails to a blank message rather than a plain one.
    // The renderer emits no URL of any kind — `digest.test.ts` asserts that against the output —
    // so this HTML opens no second outbound surface and reports nothing back when it is read.
    await transport.sendMail({
      from: settings.from,
      to: settings.to,
      subject: message.subject,
      text: message.text,
      html: message.html,
      // The chart travels INSIDE the message. `cid` makes it a referenced part rather than an
      // attachment the client lists at the bottom, and nothing is fetched to display it.
      // Two parts, two ids. Rendered only once a send is actually going to happen: rasterising
      // through a native library is the expensive step in this job and a suppressed run should not
      // pay for pictures nobody receives.
      attachments: [
        { cid: CHART_CID, filename: 'profit-and-loss.png', content: await renderChartPng(data.yearEnd.points) },
        ...(data.bubbles.length > 0
          ? [{ cid: BUBBLES_CID, filename: 'this-month.png', content: await renderBubblesPng(data.bubbles) }]
          : []),
      ],
      // What a Gmail filter matches on, so the label lives in the mailbox instead of in the
      // subject line the owner reads every morning. A custom header is invisible to a reader and
      // survives every forward and reply.
      headers: { 'X-B8-Digest': 'daily' },
    });

    log.info('digest delivered', { smtp: describeSmtp(settings) });
    await record(message, true, null);
    return true;
  } catch (err) {
    // `responseCode` is present when the provider answered and declined; its absence means the
    // conversation never got that far. Those are the two failure shapes worth telling apart.
    const answered = typeof err === 'object' && err !== null && 'responseCode' in err;
    log.error('digest not delivered', {
      smtp: describeSmtp(settings),
      error: err instanceof Error ? err.message : String(err),
    });
    await record(message, false, answered ? 'rejected' : 'transport');
    return false;
  }
}

/** One row per attempt. Never an upsert — duplicate fingerprints are the history, deliberately. */
async function record(message: DigestMessage, delivered: boolean, reason: 'config' | 'transport' | 'rejected' | null): Promise<void> {
  await db.query(
    'INSERT INTO alert_sends (kind, fingerprint, delivered, failure_reason) VALUES ($1, $2, $3, $4)',
    ['digest', message.fingerprint, delivered, reason]
  );
}
