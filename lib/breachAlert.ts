import { createTransport } from 'nodemailer';
import db from './db';
import { createLogger } from './logger';
import { asOfFromDate } from './domain/monthOutlook';
import { loadMonthOutlook } from './monthOutlookRead';
import { planAlert, shouldSend, type AlertMessage } from './domain/breachAlert';
import { alertsEnabled, describeSmtp, smtpSettings, type SmtpSettings } from './mailConfig';

const log = createLogger('breachAlert');

/**
 * The app's first outbound surface, and the only file in this repo that constructs a transport.
 *
 * ─── This file is deliberately incapable of deciding anything ─────────────────────────────────
 *
 * It is the one piece of this feature that no test can exercise. A test of the delivery path is a
 * test that opens a socket to a mail provider and sends the owner's real figures to a real address,
 * which is the single thing `BUILD.md` §5.4 and `DECISION.md` both forbid outright — there is no
 * "just once, to check" available here. A fake-transport test would only test the fake.
 *
 * The response to an untestable boundary is to shrink it until what it can get wrong is almost
 * nothing. So every branch that depends on a financial fact has been pushed out of this file into
 * `lib/domain/breachAlert.ts`, where it is fixture-pinned, and SPEC.md acceptance #38 makes that
 * claim checkable rather than asserted: this file may not so much as MENTION the fields the decision
 * turns on. What is left below is four I/O calls in a fixed order and an error path.
 *
 * If you are tempted to add a condition here — "only send on weekdays", "skip if the figure is
 * small", "retry twice" — it belongs in the pure module. A rule that lives here is a rule with no
 * test and no way to acquire one.
 *
 * ─── Nothing sends unless the owner has said so, in one exact word ────────────────────────────
 *
 * `alertsEnabled` is checked FIRST, before a query runs and long before a transport exists, and it
 * demands the literal string `true`. A checked-out repo cannot send. `.env.local.example` ships the
 * key empty. This ordering is the structural half of "no agent sends a message during development":
 * the grep-level half is that no test file in this repo names a transport at all.
 *
 * ─── What is NOT proven, stated here so it cannot be quietly assumed ──────────────────────────
 *
 * That the provider accepts these settings. That a message arrives. That TLS is actually negotiated
 * on the wire. None of those can be observed from this repo without sending, and none of them is
 * tested. `lib/mailConfig.ts` proves that a configuration is *rejected* when it would be unsafe,
 * which is a different and weaker claim, and it is the strongest one available here.
 */

/**
 * The daily job's alert pass. Resolves, always.
 *
 * Exported as a plain async function with no timer inside it, so Phase 2 step 20's OS cron can call
 * it directly and step 20's work is to point cron here and delete the in-process timer — one line,
 * in a file step 20 is already rewriting. That is why there is no second scheduler in this step:
 * two timers would mean two ideas of "daily" and two places that decide when the guardrail runs, and
 * this repo has already shipped one duplicated definition whose symptom was a wrong figure. A
 * duplicated cadence is the same failure in the dimension where the symptom is silence.
 *
 * IT NEVER REJECTS. A mail outage must not cost the daily Plaid sync or the net worth snapshot —
 * those are much larger failures than the one this function was trying to report. The try/catch
 * lives here, in the shell, and deliberately nowhere in the pure module, where swallowing an error
 * would mean printing a plausible figure instead of refusing to render one.
 *
 * ─── The limitation this step does not fix ────────────────────────────────────────────────────
 *
 * The in-process timer only fires while the Next server is up. Phase 0 step 7 already recorded this
 * happening for real: there is no `net_worth_snapshots` row for 2026-08-12 because the laptop was
 * closed. The guardrail will miss days the same way, silently. That is a known limitation, not a
 * defect, and it is one of the two reasons Phase 5 step 39's heartbeat exists. The other is that
 * nothing here shouts: if this never runs for a month, `alert_sends` is simply empty and no one is
 * told.
 */
export async function runBreachAlert(): Promise<void> {
  try {
    if (!alertsEnabled(process.env)) {
      log.info('alerts disabled, nothing attempted');
      return;
    }

    // The one clock read, converted to three integers once and passed down — the same discipline
    // the dashboard follows, for the reason `asOfFromDate`'s docblock gives: a second conversion is
    // a second calendar, and the two disagree for the hours around midnight.
    const outlook = (await loadMonthOutlook(asOfFromDate(new Date()))).outlook;

    const message = planAlert(outlook);
    if (message === null) {
      log.info('nothing worth saying today');
      return;
    }

    // Every row for this fingerprint, unfiltered, handed to the pure function to judge. The
    // `delivered` predicate is deliberately NOT in this WHERE clause: written as
    // `AND delivered LIMIT 1` the SQL would be making the suppression decision, in the one file
    // no test reaches, and `shouldSend`'s rule would become dead code that still looked correct.
    // Fetching the rows and asking keeps the decision where SPEC.md F19 can hold it — and F19 is
    // the assertion that a *failed* send never silences tomorrow's retry, which is the difference
    // between a guardrail that self-heals after a network blip and one that dies on it quietly.
    const priors = await db.query<{ fingerprint: string; delivered: boolean }>(
      'SELECT fingerprint, delivered FROM alert_sends WHERE fingerprint = $1',
      [message.fingerprint]
    );

    if (!shouldSend(message, priors.rows)) {
      log.info('already delivered, suppressed', { kind: message.kind });
      return;
    }

    await attempt(message);
  } catch (err) {
    // Anything that escaped the classified paths below — a database that would not answer, a bug.
    // It is logged and dropped, because the alternative is an unhandled rejection inside the daily
    // job that also writes net worth.
    log.error('breach alert failed', { error: err instanceof Error ? err.message : String(err) });
  }
}

/**
 * One attempt, and one row recording how it went — including when it went badly.
 *
 * A row is written for a FAILED attempt too, which is the whole reason `alert_sends` is a table
 * rather than a log line. Without it, "nothing sent for three weeks" and "sent nothing because the
 * provider was unreachable for three weeks" are the same empty set, and they are different problems
 * with different fixes. With it, the gap between rows is itself the diagnostic.
 *
 * `failure_reason` is one of three literals or `NULL`, never the provider's error text: a rejection
 * routinely quotes the message back, subject line included, and the subject is the thing this table
 * exists to never hold. The detail is not lost — it goes to the log, like every other scheduler
 * failure, which is where an operator looks anyway and is not the row that gets pasted into a
 * report.
 */
async function attempt(message: AlertMessage): Promise<void> {
  let settings: SmtpSettings;
  try {
    settings = smtpSettings(process.env);
  } catch (err) {
    // Configured wrongly, or not configured. No connection was attempted, so this is not a
    // transport failure and must not be classified as one — they have different fixes.
    log.error('mail configuration rejected', { error: err instanceof Error ? err.message : String(err) });
    await record(message, false, 'config');
    return;
  }

  try {
    // The only transport in the repo. A second one is a second destination, and a second
    // destination re-triggers the BUILD.md §5.1 human escalation rather than being added here.
    const transport = createTransport({
      host: settings.host,
      port: settings.port,
      secure: settings.secure,
      requireTLS: settings.requireTLS,
      auth: settings.auth,
    });

    await transport.sendMail({
      from: settings.from,
      to: settings.to,
      subject: message.subject,
      // Plain text only. An HTML body invites a remote image, and a remote image is a second
      // outbound surface with a different destination and no decision behind it.
      text: message.body,
    });

    log.info('alert delivered', { kind: message.kind, smtp: describeSmtp(settings) });
    await record(message, true, null);
  } catch (err) {
    // `responseCode` is present when the provider answered and declined; its absence means the
    // conversation never got that far. Those are the two failure shapes worth telling apart, and
    // this is the only place the distinction is observable.
    const answered = typeof err === 'object' && err !== null && 'responseCode' in err;
    log.error('alert not delivered', {
      kind: message.kind,
      smtp: describeSmtp(settings),
      error: err instanceof Error ? err.message : String(err),
    });
    await record(message, false, answered ? 'rejected' : 'transport');
  }
}

/**
 * One row per attempt. Never an upsert.
 *
 * `alert_sends` has no unique constraint on `fingerprint` on purpose, so `ON CONFLICT` will not run
 * against it at all — the mutable "last sent" row this repo's conventions forbid is not merely
 * discouraged here, it is unwritable. Duplicate fingerprints are the history: a failed attempt and
 * the next day's success are two rows about one fingerprint, deliberately.
 *
 * `delivered` is stated explicitly because the column has no default. That is also deliberate: a
 * default could only ever assert an outcome nobody observed, and `DEFAULT TRUE` would silence every
 * future retry.
 */
async function record(message: AlertMessage, delivered: boolean, reason: 'config' | 'transport' | 'rejected' | null): Promise<void> {
  await db.query(
    'INSERT INTO alert_sends (kind, fingerprint, delivered, failure_reason) VALUES ($1, $2, $3, $4)',
    [message.kind, message.fingerprint, delivered, reason]
  );
}
