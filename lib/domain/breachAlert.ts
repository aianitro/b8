import { createHash } from 'node:crypto';
import type { MonthOutlook, OutlookCategory, SayingNoReason } from './monthOutlook';

/**
 * What the app would say if it said something, and whether it has already said it.
 *
 * This module is the whole of the decision. It is pure and total: it reads no clock, no
 * environment, no database and no transport, and it returns either a message or `null`. The
 * shell that actually hands a message to a mail provider (`lib/breachAlert.ts`) is deliberately
 * incapable of deciding anything — SPEC.md acceptance #38 forbids it from so much as naming a
 * financial field — because that shell is the one piece of this feature no test can exercise
 * without sending a real message to a real address, which is the thing that must never happen.
 * Everything that could be got wrong is therefore forced in here, where it is fixture-pinned.
 *
 * ─── The allowlist is the point of this file ──────────────────────────────────────────────────
 *
 * SPEC.md's "The allowlist and the redaction boundary" is a closed list in BOTH directions, and
 * what makes it enforceable is a rendering discipline rather than a promise: every value printed
 * below is read out of a NAMED field, one at a time. No object is ever interpolated whole. That is
 * why no whole-object serialiser appears anywhere below, and why acceptance #10 greps this file for
 * the absence of the obvious one by name — a renderer
 * that dumps a record ships every field the row happens to carry, forever, and a field added to
 * `OutlookCategory` two steps from now would join the outbound message with nobody deciding that
 * it should.
 *
 * The fields that may leave: the category name, `budgeted`, `actual`, `projected`, `spentRatio`,
 * `projectedRatio`, `elapsedDays`, `daysInMonth`, the as-of year and month, `coveragePercent`,
 * `sayingNo.length`, `scoredCategoryCount`, and the reason word. Nothing else — and the one field
 * of `OutlookCategory` deliberately left off that list is `projectedVariance`, because it is the
 * one SIGNED figure in scope and `./pacing` says out loud what happens when its subtraction is
 * reversed: thrift reads as overspending, plausibly, with no symptom. It carries nothing that
 * `projected` against `budgeted` does not already carry, so it is excluded rather than trusted.
 */

/**
 * Which message this is.
 *
 * A closed pair, matching the `alert_sends.kind` CHECK exactly. It is one of the inputs the
 * fingerprint is computed over, which is the whole reason a coverage message and a breach message
 * for the same month can never collide in duplicate suppression.
 */
export type AlertKind = 'projected-breach' | 'coverage';

/** A message that would be sent, and the opaque key that says whether it already was. */
export interface AlertMessage {
  kind: AlertKind;
  /** Read on a lock screen. Carries a count and a month; never a name and never a figure. */
  subject: string;
  /** Plain text. No HTML body: HTML mail invites a remote image, and a remote image is a second
   *  outbound surface with a different destination and no decision behind it. */
  body: string;
  /** Lowercase hex, at least 16 characters — the shape `alert_sends` CHECK-constrains. */
  fingerprint: string;
}

/**
 * One prior attempt, as `alert_sends` recorded it.
 *
 * `delivered` is a separate fact from existence, and the two come apart on the first network blip.
 * See `shouldSend`.
 */
export interface PriorSend {
  fingerprint: string;
  delivered: boolean;
}

/**
 * The page's currency helper, with the locale pinned explicitly.
 *
 * `'en-US'` rather than the host default because this runs inside a scheduled job whose process
 * locale is nobody's browser. `$1,065.00`, not `$1065.00` and not `1.065,00 $`.
 *
 * The duplication with `app/dashboard/page.tsx` is accepted knowingly (SPEC.md Q7) and pinned by
 * fixture rather than by promise: the email and the page must agree to the cent, and a THIRD copy
 * would change that answer and make the shared formatter a real requirement.
 */
const money = (n: number) =>
  new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: 2 }).format(n);

/**
 * A fraction of budget as a percentage, by the same rule the dashboard uses.
 *
 * Rounded, deliberately, and NOT floored the way step 32 floors `coveragePercent`. The two
 * disagree on a half-cent boundary — `4.875` is `488` rounded and `487` floored — and the failure
 * that matters here is two surfaces printing different numbers for the same category, which is
 * this repo's signature defect in miniature. Step 32's floor exists because a rounded coverage
 * share can round UP THROUGH ITS OWN THRESHOLD and turn the bound into a decoration; a category
 * ratio has no threshold to clear, so the reason for that rule does not transfer here.
 *
 * This is the module's only rounding, and it is on a ratio. Money is never rounded — it is copied
 * off the record and formatted once, at this boundary. Acceptance #47 caps the occurrences at one
 * so that a second rounding — on a dollar figure, say — cannot arrive quietly.
 */
const pct = (fraction: number) => `${Math.round(fraction * 100)}%`;

/**
 * The as-of month on the wire, ONE-BASED.
 *
 * The domain counts months from 0 everywhere — `AsOf.month`, `MonthSpend.month`, the
 * `monthly_amounts` index — and this is the single place that convention is converted for a human
 * reader. September is `2026-09`. The failure this guards is entirely plausible and entirely
 * silent: `2026-08` in a September alert is the wrong month in the one field that dates the whole
 * message, and nothing about it looks wrong.
 *
 * No month-name table. A second copy of the page's `MONTHS` beside it would be a drifting
 * definition for no benefit, and `2026-09` is unambiguous in a subject line in every locale.
 */
function yearMonth(year: number, month: number): string {
  return `${year}-${String(month + 1).padStart(2, '0')}`;
}

/**
 * A money or ratio field that reaches the renderer must be a finite number, or nothing is sent.
 *
 * `db.query<T>()` is an unchecked cast, so a `NUMERIC` column nobody converted arrives as a STRING
 * with the type claiming otherwise, and a division by zero somewhere upstream arrives as `Infinity`
 * with no complaint at all. Printed, those become `NaN%` and `$Infinity` in a message the owner is
 * meant to act on. A message is one of the few surfaces in this app with no "—" to fall back to, so
 * the honest failure is to refuse to render at all.
 *
 * WHAT THAT REFUSAL COSTS, STATED ACCURATELY ([[N61]]). This throw does NOT produce an `alert_sends`
 * row. `planAlert` runs *above* the send attempt in `lib/breachAlert.ts`, so the `RangeError`
 * unwinds to that function's outer catch and is logged — with this category name in it — and
 * nothing is written to the table. So for this one cause, and only this one, the table cannot tell
 * "the job refused to render" from "the job never ran". The log can; the table cannot.
 *
 * That is a real gap in Q5's diagnostic and it is not fixable by moving the call, which is why the
 * shape is left alone rather than rearranged. `alert_sends.fingerprint` is `NOT NULL`, and a message
 * that could not be rendered has no fingerprint — there is nothing to key the row on. It is exactly
 * the case CONTRACT.md's implementer note 4 already anticipated for a configuration failure, and its
 * ruling applies unchanged here: what the schema refuses is a placeholder fingerprint invented to
 * make the row insertable. Recording this outcome would need a nullable fingerprint, which is a
 * contract change and not this step's to make.
 *
 * The category is named in the error because a rejection that does not say WHICH line was
 * unrenderable sends an operator to read the whole outlook by hand — and because the log line is now
 * the only place this failure is recorded at all.
 *
 * There is no try/catch anywhere in this module (acceptance #53) precisely so that nothing here can
 * swallow this and print a plausible figure instead.
 */
function finite(value: number, field: string, category: string): number {
  if (!Number.isFinite(value)) {
    throw new RangeError(`breachAlert: ${category} has a non-finite ${field}; refusing to render a message`);
  }
  return value;
}

/**
 * How a category came to be saying no, in words, from the closed three-word vocabulary.
 *
 * The reason itself is allowlisted — it carries no figure — but it is rendered through a lookup
 * rather than interpolated, so the message can never print a value this table has not been taught.
 */
const REASON_PHRASE: Record<SayingNoReason, string> = {
  'off-cycle': 'spending in a month it budgets nothing for',
  breach: 'already over its budget',
  'projected-breach': 'on course to close over its budget',
};

/**
 * One category's lines in the body, built field by field.
 *
 * The OFF-CYCLE SHAPE is the one worth reading twice. `off-cycle` is the highest-precedence reason,
 * so it is the FIRST thing a real breach message will contain, and it is the one record whose
 * `projected`, `projectedRatio` and `spentRatio` are all `null` — there is no budget this month to
 * project against. An implementer who tested only `projected-breach` ships a message whose opening
 * line reads `null`. So the comparison is OMITTED rather than rendered empty: the line names the
 * category and what it spent, and stops. It never prints `$0.00` against a zero budget either,
 * because "spent $150.00 of $0.00 (Infinity%)" is a sentence about arithmetic, not about money.
 */
function categoryLines(c: OutlookCategory): string[] {
  const name = c.category;
  const spent = money(finite(c.actual, 'actual', name));
  const reason: SayingNoReason | null = c.reason;
  const phrase = reason === null ? 'saying no' : REASON_PHRASE[reason];
  const head = `${name} — ${phrase}`;

  // All three or none: a record with a projection has a budget to have projected against and a
  // share of it spent so far. Partial nulls are not a shape `monthOutlook` produces, and treating
  // them as the off-cycle shape is the conservative reading — it withholds a comparison rather
  // than assembling one out of a missing half.
  if (c.projected === null || c.projectedRatio === null || c.spentRatio === null) {
    return [head, `  spent ${spent}`];
  }

  const budget = money(finite(c.budgeted, 'budgeted', name));
  const projected = money(finite(c.projected, 'projected', name));
  const spentShare = pct(finite(c.spentRatio, 'spentRatio', name));
  const projectedShare = pct(finite(c.projectedRatio, 'projectedRatio', name));

  return [
    head,
    `  spent ${spent} of ${budget} (${spentShare})`,
    `  projecting ${projected} (${projectedShare})`,
  ];
}

/**
 * The full message: names, figures and ratios, under authoritative coverage only.
 *
 * `day 8 of 30` is read off the records rather than recomputed from a calendar, because
 * `elapsedDays` and `daysInMonth` are the fields `./pacing` built to carry exactly this qualifier
 * one level up. A projection printed without the day it was projected from is the sentence with
 * its caveat removed.
 *
 * The coverage line ships in this message too. §5 step 32's exit is that the headline always
 * arrives with the share of spend it actually saw, and that property does not stop applying because
 * the surface changed. `coveragePercent` is printed VERBATIM — already floored, one level down —
 * and is never recomputed from the share here (acceptance #54); one division, in one place, read
 * twice, is the same rule `monthOutlook` states about its own top-level copies.
 */
function breachMessage(outlook: MonthOutlook, coveragePercent: number): AlertMessage {
  const count = outlook.sayingNo.length;
  const month = yearMonth(outlook.asOf.year, outlook.asOf.month);
  const first = outlook.sayingNo[0];
  const noun = count === 1 ? 'budget line is' : 'budget lines are';

  const lines: string[] = [
    `${count} ${noun} saying no in ${month}, on day ${first.elapsedDays} of ${first.daysInMonth}.`,
    '',
  ];
  for (const c of outlook.sayingNo) {
    lines.push(...categoryLines(c), '');
  }
  lines.push(
    `Computed over ${coveragePercent}% of the spend recorded so far in the month, across ${outlook.scoredCategoryCount} scored categories.`,
    '',
    'To see the detail, open the app.'
  );

  return {
    kind: 'projected-breach',
    // A subject is what a lock screen shows, to whoever is holding the phone. It carries the count
    // and the month and nothing else: no name, no dollar sign, no ratio. The body is behind at
    // least one deliberate action; the subject is not behind any.
    subject: `Budget guardrail — ${count} saying no in ${month}`,
    body: lines.join('\n'),
    fingerprint: computeFingerprint('projected-breach', outlook),
  };
}

/**
 * The message that ships when the dashboard has just refused to call the figures a verdict.
 *
 * NOTHING ABOUT A CATEGORY LEAVES HERE. Not a name, not an amount, not a ratio. This is narrower
 * than what DECISION.md permits, deliberately and on the record: the owner's grant is a ceiling,
 * and narrowing under a ceiling is always available.
 *
 * The argument, because it is the sharpest interaction in the step. Step 32 built the coverage
 * threshold precisely so that a figure computed over a tenth of the month stops being presented as
 * a verdict. Emailing "Dining Out is projecting 266% of budget" at 7.7% coverage asserts, in the
 * strongest medium available, exactly what the dashboard has just declined to assert. The dashboard
 * can get away with DEMOTING rather than withholding, because its refusal banner sits inside the
 * hero, beside the lists, with the caveat under it. An email is read on a lock screen, at a glance,
 * possibly weeks later, with no page around it — a named category and a number in that setting read
 * as a verdict no matter what sentence surrounds them. So the demotion that works on a page becomes
 * a withholding in a message.
 *
 * What survives is the one figure nothing refuses: the coverage share itself is exactly as
 * authoritative at 7% as at 96%, which is what makes it the right and only payload here. A COUNT
 * survives with it, at parity with the dashboard, which renders its lists in both modes: "three
 * lines are flagged and I cannot stand behind the figures" is enough to make the message worth
 * opening and carries no per-category claim.
 *
 * Sending nothing at all was rejected, and the reason is the failure shape it manufactures: on the
 * owner's real August the guardrail would never once have fired, and its silence would have been
 * indistinguishable from a good month.
 */
function coverageMessage(outlook: MonthOutlook, coveragePercent: number): AlertMessage {
  const count = outlook.sayingNo.length;
  const month = yearMonth(outlook.asOf.year, outlook.asOf.month);
  const noun = count === 1 ? 'budget line is' : 'budget lines are';

  const body = [
    `Only ${coveragePercent}% of the spend recorded so far in ${month} has been categorized, so no figure about any single budget line can be stated as a verdict yet.`,
    '',
    `${count} ${noun} currently flagged. The figures are withheld here on purpose: the dashboard will not present them as a judgement at this coverage, and neither will this message.`,
    '',
    'To categorize what is left, open the app.',
  ].join('\n');

  return {
    kind: 'coverage',
    subject: `Budget guardrail — ${month} is not categorized enough to judge`,
    body,
    fingerprint: computeFingerprint('coverage', outlook),
  };
}

/**
 * The opaque key that answers "have I already said this?".
 *
 * `(kind, as-of year, as-of month, the SET of category-and-reason pairs)` — and the composition is
 * the whole of the cadence rule. Every edge it produces was chosen, not inherited:
 *
 *   - same categories, same reasons, tomorrow — suppressed. Not news twice.
 *   - same categories, same reasons, MORE SPEND — suppressed. Amounts are deliberately not inputs
 *     here. A fingerprint over amounts moves every day as spend accrues, so the guardrail re-fires
 *     daily, so the owner filters it, so it is a deleted guardrail. This is the single most
 *     important exclusion in the function and it is the one a well-meaning implementer adds back.
 *   - a new category joins the set — sent. A line crossing its limit is news.
 *   - a category escalating from projecting-over to already-over — sent. The reason is in the key.
 *   - the month rolls over — sent. A breach persisting into October is a new month's problem.
 *   - a coverage message and a breach message in one month — both possible. `kind` is in the key.
 *
 * There is no tunable constant anywhere in it, which is why it was preferred to a cool-down of N
 * days: a cool-down gets escalations wrong in both directions, suppressing a genuine second breach
 * on day 3 and re-sending an unchanged one on day 8, and it has a magic number to argue about.
 *
 * SORTED, so the key does not depend on the order the rows arrived in — the ordering of `sayingNo`
 * is a presentation decision one module up and must not be able to re-fire an alert by changing.
 *
 * DIGESTED, so it carries no name. The obvious cheap key — joining the names with a separator —
 * would satisfy every functional requirement above and would write the owner's private reading of
 * their own spending into the one table most likely to be pasted into a report, cropped into a
 * screenshot, or read out of `psql` while somebody debugs a delivery. `alert_sends` CHECK-rejects
 * that shape on insert, so the mistake is not available even to a caller who never read this note.
 *
 * The separators are control characters rather than a printable delimiter so that a category
 * literally named `Travel|Dining` cannot collide with two categories named `Travel` and `Dining`.
 */
function computeFingerprint(kind: AlertKind, outlook: MonthOutlook): string {
  const pairs = outlook.sayingNo.map((c) => `${c.category}\u0000${c.reason ?? ''}`).sort();
  const material = [kind, String(outlook.asOf.year), String(outlook.asOf.month), ...pairs].join('\u0001');
  return createHash('sha256').update(material, 'utf8').digest('hex');
}

/**
 * What would be sent, given the month's outlook — or `null`, which is most days.
 *
 * A TOTAL function over a ladder closed at five rungs, evaluated top down. The order is the
 * substance:
 *
 *   1. `nothing-to-score` → nothing. Nothing is configured to guard, and this rung sits ABOVE the
 *      coverage rung on purpose: a coverage message here would name the wrong cause entirely. The
 *      problem is that no category is scored, not that the month is uncategorized, and those have
 *      different fixes.
 *   2. an empty population → nothing. `coverageShare` is `null` when there is no spend at all to
 *      compute a share over. This app renders "—" rather than a wrong zero, and a message has no
 *      "—", so the honest output is no message. Never `0%`, never `100%`, never `null%`.
 *   3. below the coverage threshold → the coverage message. See `coverageMessage`.
 *   4. anything saying no → the breach message, under the full allowlist.
 *   5. otherwise → nothing. A quiet month.
 *
 * Rung 5's cost is stated rather than hidden: silence here is indistinguishable from a server that
 * never ran. Nothing in this step fixes that — a liveness signal is a second outbound surface with
 * its own cadence and its own escalation, and Phase 5 step 39 owns it. What this step does instead
 * is make the RECORD unambiguous, one layer out, by writing a row for every attempt including the
 * failed ones.
 */
export function planAlert(outlook: MonthOutlook): AlertMessage | null {
  if (outlook.state === 'nothing-to-score') return null;

  // Both halves, because the compiler cannot know they move together and because a message reading
  // `null%` is precisely the failure this rung exists to prevent.
  if (outlook.coverageShare === null || outlook.coveragePercent === null) return null;

  if (!outlook.authoritative) return coverageMessage(outlook, outlook.coveragePercent);

  if (outlook.sayingNo.length > 0) return breachMessage(outlook, outlook.coveragePercent);

  return null;
}

/**
 * Whether a message that WOULD be sent has not already been.
 *
 * The predicate is `delivered && matching fingerprint`, and the `delivered` half is the whole
 * reason `alert_sends` is a table rather than a log line. Keyed on ATTEMPTED instead, the first
 * network blip silences the guardrail permanently, starting on a day nobody was watching, and the
 * symptom is silence — which is indistinguishable from a good month. A recorded failure must leave
 * tomorrow's retry free to run.
 *
 * It takes the prior rows rather than a boolean so that this rule lives here, in the tested module,
 * rather than in a `WHERE` clause in the untestable shell. The shell fetches every row for the
 * fingerprint and asks; it does not filter and then infer.
 */
export function shouldSend(message: AlertMessage, priors: PriorSend[]): boolean {
  return !priors.some((p) => p.delivered && p.fingerprint === message.fingerprint);
}
