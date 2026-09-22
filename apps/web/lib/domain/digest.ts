/**
 * The daily digest, rendered. Pure: data in, one message out, no I/O and no clock read.
 *
 * Same split as `lib/domain/breachAlert.ts` and for the same reason — the file that opens a socket
 * to a mail provider is the one file no test can exercise, so every decision that depends on a
 * financial fact is pushed in here where a fixture can pin it. Nothing in this module queries,
 * formats a date from `new Date()`, or knows what SMTP is.
 *
 * ─── Why this is HTML, when the alert it replaces was deliberately text-only ───────────────────
 *
 * `lib/breachAlert.ts` carried a standing comment: "Plain text only. An HTML body invites a remote
 * image, and a remote image is a second outbound surface with a different destination and no
 * decision behind it." That reasoning is still exactly right, and the rule it protects is kept by
 * a stronger means than avoiding HTML: THIS MODULE EMITS NO URL OF ANY KIND. No <img>, no <a>, no
 * <link>, no url() in a style, no webfont. `digest.test.ts` asserts that against the rendered
 * output rather than trusting this paragraph, so the property is checkable and stays true.
 *
 * The chart is therefore built out of table cells with background colours — no image, remote or
 * inlined. That is not a compromise forced by the no-URL rule; it is what survives Gmail, which
 * strips <svg> and <style> blocks and blocks remote images by default anyway. Every rule below is
 * an email-client constraint, not a preference: inline styles only, tables for layout, no flexbox,
 * no grid, no CSS custom properties, fixed pixel widths.
 *
 * ─── What may appear in this output ───────────────────────────────────────────────────────────
 *
 * Transaction-level detail, INCLUDING merchant names, which `P0.5-33 DECISION.md` originally
 * excluded in as many words. The owner widened that allowlist on 2026-09-14 after being shown what
 * it puts in a third party's hands; the amendment is recorded in that file. Do not widen it further
 * from here. Account identifiers and balances are still outside it, and `digest.test.ts` pins that
 * the renderer is never even handed them.
 */

import { createHash } from 'node:crypto';
import { CHART_DISPLAY_HEIGHT, CHART_DISPLAY_WIDTH } from './digestChart';
import { BUBBLES_DISPLAY_HEIGHT, BUBBLES_DISPLAY_WIDTH, type DigestBubble } from './digestBubbles';

/** One transaction, in the only shape this module will render. Note what is absent: no account. */
export interface DigestTxn {
  /** ISO `YYYY-MM-DD`, already resolved by the caller — this module does not touch a clock. */
  date: string;
  /** Merchant, falling back to the raw feed name. Already coalesced; never null, never empty. */
  label: string;
  /** Signed, on the app's convention throughout: POSITIVE is money out. */
  amount: number;
  /** `null` is the whole point of the first widget, so it is a first-class value, not an absence. */
  category: string | null;
}

/**
 * One month of the year-end track. Twelve of these are a chart.
 *
 * Carries the month's own FLOWS as well as the running total, because the chart draws both — the
 * same pair the dashboard's own P/L widget draws. `cumulative` is not derivable from one point's
 * flows and the flows are not derivable from the cumulative, so both have to travel.
 */
export interface YearEndPoint {
  /** 1–12. */
  month: number;
  /** Money in this month — actual where settled, plan where forecast. Positive. */
  income: number;
  /** Money out this month, as a positive magnitude, on the same rule. */
  expense: number;
  /** Running profit/loss from January through this month. December's value is the year's P/L. */
  cumulative: number;
  /** True once the month is wholly or partly forecast rather than settled. */
  projected: boolean;
}

/** One entry on the watchlist, as the email renders it. */
export interface WatchedItem {
  /** ISO `YYYY-MM-DD` of the transaction itself, not of when it was flagged. */
  date: string;
  label: string;
  amount: number;
  /** The owner's reason, or null if they flagged it without writing one. */
  note: string | null;
  /** Whole days since it was flagged. 0 means today. Computed by the caller, from one clock. */
  daysOpen: number;
}

export interface DigestData {
  /** The day this digest is about, as three integers. Converted once, by the caller. */
  asOf: { year: number; month: number; day: number };

  /**
   * Whether the daily job has been running. Rendered ONLY when it has not.
   *
   * A line saying "the job ran today" in a message the job just sent is a tautology taking up
   * space. A line saying it has not run for five days, in the first message to arrive after that
   * gap, is the only place the owner would ever find out — and it tells them the sync and the
   * backups were missed too, which "no email yesterday" does not imply.
   */
  jobGap: string | null;

  uncategorized: {
    /** The rows actually shown, largest first. May be shorter than `totalCount`. */
    rows: DigestTxn[];
    /** Every uncategorized record in the current month, including ones not listed. */
    totalCount: number;
    /** Money out across ALL of them, not just the listed ones. */
    totalOut: number;
    /** Money in across all of them, as a positive magnitude. */
    totalIn: number;
  };

  /**
   * When the previous digest was DELIVERED, ISO, or null if none ever was. Carried so the sender
   * can apply `alreadySentToday` without a second query for a timestamp already read here.
   */
  lastDeliveredAt: string | null;

  /**
   * What LANDED since the last email, not what is dated yesterday. The distinction is the whole
   * point — see `digestWindow.ts` for the measurement that forced it.
   */
  arrivals: {
    /** ISO timestamp the window opens at: when the previous digest was delivered. */
    since: string;
    /** The same instant as a local `YYYY-MM-DD`, for captioning. */
    sinceDate: string;
    rows: DigestTxn[];
    totalOut: number;
    totalIn: number;
  };

  /**
   * What the owner asked to be reminded of. Oldest first — see `watchlistWidget`.
   *
   * Not scoped to the month, unlike everything else in this digest. A return that has been pending
   * since June is the entry that most needs chasing, and a month-scoped list would drop it on the
   * first of July, exactly when it stopped being fresh enough to remember unaided.
   */
  watchlist: WatchedItem[];

  /**
   * This month's budget categories, for the bubbles. Every category with an allocation, NOT just
   * the scored ones — see `bubblesWidget` for why that distinction matters here.
   */
  bubbles: DigestBubble[];

  yearEnd: {
    /** Where the year closes if the rest of it goes to plan. */
    profitLoss: number;
    /** Income less spend so far. Fact, not forecast. */
    netToDate: number;
    /** Twelve points, January first. */
    points: YearEndPoint[];
  };
}

export interface DigestMessage {
  subject: string;
  html: string;
  text: string;
  /** The opaque key answering "have I already sent today's?" — see `digestFingerprint`. */
  fingerprint: string;
}

/**
 * The opaque key that makes this a DAILY digest rather than a message that can go twice.
 *
 * `(kind, year, month, day)` and NOTHING ELSE — deliberately not the content. A fingerprint over
 * the figures would send a second digest the moment a transaction landed or a category was filed,
 * which on the owner's own Monday means several: the whole point of filing the backlog is that the
 * numbers move. Over the date, the answer to "has today's gone?" is yes exactly once.
 *
 * The cost, stated because it is real: a digest delivered at 06:49 and a change at noon produce no
 * second message, and the owner will not hear about today's news until tomorrow. That is the right
 * trade for a daily report and it would be the wrong one for an alert — which is most of why the
 * guardrail alert fingerprints its content instead, and why the two remain different messages
 * rather than one with a flag.
 *
 * Hex, and at least sixteen of it, because `alert_sends.fingerprint` CHECKs that shape. The CHECK
 * is what makes "opaque" enforceable: a readable fingerprint would put the send date into a column
 * that table goes out of its way to keep meaningless.
 */
export function digestFingerprint(asOf: DigestData['asOf']): string {
  const material = ['digest', String(asOf.year), String(asOf.month), String(asOf.day)].join('\u0001');
  return createHash('sha256').update(material, 'utf8').digest('hex');
}

// ─── Palette ──────────────────────────────────────────────────────────────────────────────────
//
// Lifted from the app's own design tokens so the email and the dashboard do not develop two ideas
// of what "over budget" is coloured. Hard-coded hex rather than imported from `lib/chartColors.ts`
// because these must survive being inlined into a style attribute, and because an email that
// changes colour when a Tailwind config changes is a surprise nobody asked for.
const INK = '#111827';
const MUTED = '#6b7280';
const FAINT = '#9ca3af';
const RULE = '#e5e7eb';
const PAPER = '#ffffff';
const SHELL = '#f3f4f6';
const GREEN = '#16a34a';
const GREEN_SOFT = '#86efac';
const RED = '#dc2626';
const RED_SOFT = '#fca5a5';
const AMBER_INK = '#92400e';
const AMBER_BG = '#fffbeb';
const AMBER_RULE = '#fde68a';

/** Heading accents. Amber where there is work, slate where there is a record, blue for the map. */
const AMBER_MARK = '#f59e0b';
const SLATE_MARK = '#cbd5e1';
const BLUE_MARK = '#3b82f6';

const FONT = "-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif";
const MONO = "ui-monospace,SFMono-Regular,Menlo,Consolas,monospace";

const MONTH_LABELS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];


// ─── Formatting ───────────────────────────────────────────────────────────────────────────────

const EXACT = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: 2, maximumFractionDigits: 2 });
const ROUND = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 });

/** A transaction figure. Two decimals, because the reader is going to match it against a statement. */
function exact(n: number): string {
  return EXACT.format(Math.abs(n));
}

/** A headline figure. No cents: they are noise at this magnitude and they wrap on a phone. */
function round(n: number): string {
  return `${n < 0 ? '\u2212' : ''}${ROUND.format(Math.abs(n))}`;
}

/**
 * The same figure, with every non-ASCII character written as an entity.
 *
 * Belt and braces against a charset the renderer does not control. Nodemailer labels the HTML part
 * `charset=utf-8` and a correct client honours it — but the preview of this very message rendered
 * the minus sign as `â^'` the moment one server declined to declare a charset, and a mail client
 * that gets it wrong is not a hypothetical. An entity survives being read as Latin-1; a raw U+2212
 * does not. Merchant names still ride on the declared charset, because there is no finite set of
 * characters to encode there.
 */
function roundHtml(n: number): string {
  return round(n).replace(/\u2212/g, '&minus;');
}

/** An em dash and a middle dot, for the same reason, written once so they are not retyped raw. */
const MDASH = '&mdash;';
const MIDDOT = '&middot;';

/**
 * `2026-09-13` → `Sep 13`. String surgery, deliberately, with no `Date` anywhere near it.
 *
 * `new Date('2026-09-13')` parses as UTC midnight and then prints in local time, which west of
 * Greenwich is the 12th. That is a real off-by-one that would mislabel every row in the digest,
 * and it is invisible in any test run in UTC. The input is already the string the database
 * produced for a `date` column, so there is nothing to convert and nothing to get wrong.
 */
export function shortDate(iso: string): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  if (!match) throw new Error(`digest: not an ISO date: ${iso}`);
  const monthIndex = Number(match[2]) - 1;
  if (monthIndex < 0 || monthIndex > 11) throw new Error(`digest: month out of range: ${iso}`);
  return `${MONTH_LABELS[monthIndex]} ${Number(match[3])}`;
}

/**
 * Every value that reaches the HTML goes through here, without exception.
 *
 * `label` and `category` are the two strings in this module that come from outside it: one is a
 * merchant name straight off a bank feed, the other a category the owner typed. Neither is trusted
 * input in the security sense and neither needs to be — a merchant called `AT&T` renders as `AT&amp;T`
 * or it renders wrong, and that is reason enough. The quote forms are escaped too because these
 * values are close to attribute context and a partial escaper is the kind that gets moved.
 */
export function esc(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

// ─── Chart ────────────────────────────────────────────────────────────────────────────────────

/**
 * The chart, as a reference to a part attached to this very message.
 *
 * `src` is supplied by the caller — `cid:b8-digest-chart` when sending, a relative filename when
 * previewing in a browser — so this module never decides how the bytes travel and the preview path
 * exercises the same markup the mail does.
 *
 * `width` and `height` are set as ATTRIBUTES and again in the style. Outlook ignores CSS dimensions
 * on an image and will render the raster at its natural size, which here is twice what is wanted;
 * the attributes are what it reads. `max-width:100%` is what keeps it inside a phone.
 */
function chart(src: string): string {
  return (
    `<img src="${src}" width="${CHART_DISPLAY_WIDTH}" height="${CHART_DISPLAY_HEIGHT}" ` +
    `alt="Cumulative profit and loss for the year, with money in and money out by month." ` +
    `style="display:block;width:100%;max-width:${CHART_DISPLAY_WIDTH}px;height:auto;border:0"/>`
  );
}

/**
 * The bubbles as text: the same categories, largest budget first, with what each has spent.
 *
 * A circle-packing has no character equivalent, so this does not attempt one. What it preserves is
 * the ORDERING the picture encodes — biggest allocation first — and the verdict, spelled out in
 * words because the plain part has no colour to carry it.
 */
function bubblesText(bubbles: DigestBubble[]): string[] {
  const verdict = (b: DigestBubble): string => {
    if (b.actual > b.budgeted) return 'already over';
    if (b.tooEarly || b.projectedRatio === null) return 'too early to call';
    if (b.projectedRatio > 1) return 'heading over';
    return 'on plan';
  };
  const widest = Math.max(0, ...bubbles.map((b) => b.category.length));
  return [...bubbles]
    .sort((a, b) => b.budgeted - a.budgeted)
    .map((b) =>
      `  ${b.category.padEnd(Math.min(widest, 24))}  ${exact(b.actual).padStart(10)} of ${exact(b.budgeted).padStart(10)}  ${verdict(b)}`
    );
}

/** The chart again, as characters, for the text part and for any client that refuses HTML. */
function chartText(points: YearEndPoint[]): string[] {
  const peak = Math.max(...points.map((p) => Math.abs(p.cumulative)), 1);
  return points.map((p) => {
    const width = Math.max(1, Math.round((Math.abs(p.cumulative) / peak) * 24));
    // Hollow blocks for forecast, solid for settled — the same settled/forecast split the colours
    // carry, in the one channel a plain-text reader has.
    const bar = (p.projected ? '░' : '█').repeat(width);
    return `  ${MONTH_LABELS[p.month - 1]}  ${bar} ${round(p.cumulative)}${p.projected ? '  (forecast)' : ''}`;
  });
}

// ─── Widget shell ─────────────────────────────────────────────────────────────────────────────

/** One card: a heading, an optional right-aligned figure, and a body. */
/**
 * One card: an accent, a heading, an optional right-aligned figure, and a body.
 *
 * ─── The accent is navigation, not decoration ─────────────────────────────────────────────────
 *
 * Five cards of identical weight is a wall. A 3px colour chip before each heading gives the eye
 * something to count down and ties the card to what it is about — amber where there is work,
 * slate where there is only a record, the chart's own green where the year is. Scrolling back to
 * "the amber one" is a different motion from re-reading five headings.
 *
 * A chip rather than a left border on the card: a coloured border down the whole card reads as a
 * severity banner, and four of these five are not severe. Rendered as a table cell with a width,
 * because an inline-block with a background is the first thing Outlook drops.
 */
function widget(title: string, rightRail: string, body: string, accent: string = FAINT): string {
  return (
    `<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" ` +
    `style="background-color:${PAPER};border:1px solid ${RULE};border-radius:10px;margin:0 0 16px">` +
    `<tr><td style="padding:18px 20px 20px">` +
    `<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%">` +
    `<tr>` +
    `<td width="14" valign="middle" style="padding:0 8px 0 0;font-size:0;line-height:0">` +
    `<div style="width:6px;height:6px;background-color:${accent};border-radius:2px;font-size:0;line-height:0">&nbsp;</div>` +
    `</td>` +
    `<td style="font-family:${FONT};font-size:11px;font-weight:600;letter-spacing:.07em;` +
    `text-transform:uppercase;color:${MUTED}">${title}</td>` +
    `<td align="right" style="font-family:${FONT};font-size:11px;color:${FAINT}">${rightRail}</td>` +
    `</tr></table>` +
    `<div style="height:12px;font-size:0;line-height:0">&nbsp;</div>` +
    body +
    `</td></tr></table>`
  );
}

/**
 * A transaction table. `showCategory` is what separates the two lists.
 *
 * The uncategorized widget omits the category column because every value in it would be the same
 * em dash — a column of nothing, taking width from the merchant name, which is the column the
 * reader is actually scanning. Yesterday's list keeps it, because there the value varies and a
 * blank is itself the signal that a row needs filing.
 */
function txnTable(rows: DigestTxn[], showCategory: boolean, showDate = true): string {
  const cell = `font-family:${FONT};font-size:13px;color:${INK};padding:7px 0;border-bottom:1px solid ${RULE}`;

  const line = (t: DigestTxn, last: boolean): string => {
    const edge = last ? `${cell};border-bottom:none` : cell;
    // Money IN is green and signed, money out is plain ink. An unsigned green figure next to an
    // unsigned black one is two colours and one meaning; the sign carries it for anyone who cannot
    // tell them apart.
    const inbound = t.amount < 0;
    return (
      `<tr>` +
      (showDate
        ? `<td style="${edge};color:${FAINT};font-size:12px;white-space:nowrap;width:52px">${esc(shortDate(t.date))}</td>`
        : '') +
      `<td style="${edge}">${esc(t.label)}</td>` +
      (showCategory
        ? `<td style="${edge};color:${MUTED};font-size:12px">${t.category === null ? `<span style="color:${AMBER_INK}">needs a category</span>` : esc(t.category)}</td>`
        : '') +
      `<td align="right" style="${edge};font-family:${MONO};font-size:13px;white-space:nowrap;` +
      `color:${inbound ? GREEN : INK}">${inbound ? '+' : ''}${exact(t.amount)}</td>` +
      `</tr>`
    );
  };

  return (
    `<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%">` +
    rows.map((t, i) => line(t, i === rows.length - 1)).join('') +
    `</table>`
  );
}

/** The same rows as monospace text, column-aligned by padding rather than by a table. */
function txnTableText(rows: DigestTxn[], showCategory: boolean, showDate = true): string[] {
  const widest = Math.max(0, ...rows.map((t) => t.label.length));
  return rows.map((t) => {
    const amount = `${t.amount < 0 ? '+' : ' '}${exact(t.amount)}`;
    const category = showCategory ? `  ${(t.category ?? 'needs a category').padEnd(18)}` : '';
    const date = showDate ? `${shortDate(t.date).padEnd(7)}  ` : '';
    return `  ${date}${t.label.padEnd(Math.min(widest, 34))}${category}  ${amount}`;
  });
}

/** An empty widget still says something. Which nothing it is matters, so each caller supplies it. */
function emptyState(message: string): string {
  return `<div style="font-family:${FONT};font-size:13px;color:${MUTED};padding:4px 0 2px">${message}</div>`;
}

/**
 * The two numbers the whole email is about, before any of the detail that explains them.
 *
 * Counts, not dollars. "14 to file" is a to-do list with a length and "$4,083 unfiled" is a
 * statistic — and this email already has a history here: its first version led on "3% of spend
 * categorized" and the owner's verdict was that it was not actionable. A count answers how much
 * work; a share answers nothing a person can act on.
 *
 * Side by side in one table row rather than stacked, so both are above the fold on a phone. Two
 * 50% cells is the one two-column layout that survives every mail client without a media query —
 * Gmail's mobile app ignores those, so a layout that depends on one is a layout that breaks
 * exactly where this email is read.
 */
function counters(data: DigestData): string {
  const unfiled = data.uncategorized.totalCount;
  const posted = data.arrivals.rows.length;

  const card = (value: number, caption: string, alarming: boolean): string =>
    `<td width="50%" valign="top" style="padding:0">` +
    `<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" ` +
    `style="background-color:${PAPER};border:1px solid ${alarming ? AMBER_RULE : RULE};border-radius:10px">` +
    `<tr><td style="padding:16px 18px">` +
    `<div style="font-family:${FONT};font-size:32px;font-weight:600;line-height:1;` +
    `color:${alarming ? AMBER_INK : INK}">${value}</div>` +
    `<div style="font-family:${FONT};font-size:12px;color:${MUTED};padding:6px 0 0">${caption}</div>` +
    `</td></tr></table></td>`;

  return (
    `<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="margin:0 0 16px">` +
    `<tr>` +
    // Amber only when there is something to do. A zero in a warning colour trains the reader to
    // ignore the colour, which costs the one day it actually means something.
    card(unfiled, unfiled === 1 ? 'needs a category' : 'need a category', unfiled > 0) +
    `<td width="12" style="font-size:0;line-height:0">&nbsp;</td>` +
    // Not "new transactions yesterday": the extra word wrapped the caption onto a second line
    // at phone width, which is where this is read.
    card(posted, posted === 1 ? 'new transaction' : 'new transactions', false) +
    `</tr></table>`
  );
}

// ─── The three widgets ────────────────────────────────────────────────────────────────────────

/**
 * Widget 1 — what needs filing.
 *
 * It leads, and it leads on a COUNT rather than on a dollar share. "13 records" is a to-do list
 * with a length; "13% of spend accounted for" is a statistic about the app. The previous version
 * of this email led on the statistic and the owner's verdict on it was "not actionable", which is
 * the correct reading: a percentage tells you something is wrong and nothing about what to do.
 *
 * Largest first, because filing the biggest row moves every other figure in this email the most.
 */
function uncategorizedWidget(d: DigestData['uncategorized']): string {
  if (d.totalCount === 0) {
    return widget('Needs a category', '', emptyState(`Nothing outstanding ${MDASH} every record this month is filed.`), GREEN);
  }

  const shown = d.rows.length;
  const rail = shown < d.totalCount ? `${shown} of ${d.totalCount} shown` : `${d.totalCount} record${d.totalCount === 1 ? '' : 's'}`;

  // NO TOTALS BOX. It used to sit under the rows restating the count and summing the money in and
  // out, and the owner's reading was that it duplicates what is already on screen — which it does
  // whenever the list is short enough to show in full, and that is most days. What it was
  // protecting against is a reader summing a TRUNCATED list and getting a figure nothing else was
  // computed from; the rail above still says "8 of 14 shown", which states the truncation without
  // restating the arithmetic.
  return widget('Needs a category', rail, txnTable(d.rows, false), AMBER_MARK);
}

/**
 * Widget 2 — what the owner asked to be reminded of.
 *
 * ─── Why the age is the most prominent thing on each row ──────────────────────────────────────
 *
 * A watchlist that only says WHAT is on it becomes wallpaper: the same four rows every morning,
 * unchanged, until the eye stops reading them. The number that changes is the age, and the age is
 * the thing that should eventually feel wrong — a return pending for three days is a process, one
 * pending for thirty is a refund nobody is going to chase unless something says so.
 *
 * So the age is rendered in ink at the end of the row rather than as a grey aside, and it goes
 * AMBER past two weeks. Not red: nothing here is an error, and a colour that shouts on day fifteen
 * has nothing left to say on day sixty.
 *
 * Oldest first, from the read layer's own ORDER BY. The newest entry needs no reminding; the owner
 * flagged it yesterday and remembers why.
 */
function watchlistWidget(items: WatchedItem[]): string {
  if (items.length === 0) return '';

  const cell = `font-family:${FONT};font-size:13px;color:${INK};padding:7px 0;border-bottom:1px solid ${RULE}`;

  const row = (item: WatchedItem, last: boolean): string => {
    const edge = last ? `${cell};border-bottom:none` : cell;
    const stale = item.daysOpen >= 14;
    const age = item.daysOpen === 0 ? 'today' : item.daysOpen === 1 ? '1 day' : `${item.daysOpen} days`;
    return (
      `<tr>` +
      `<td style="${edge}">${esc(item.label)}</td>` +
      // A flag with no reason still earns its row: the owner marked it, and the absence of a note
      // is itself worth showing rather than hiding behind an empty cell.
      `<td style="${edge};color:${MUTED};font-size:12px">${item.note === null ? `<span style="color:${FAINT}">no reason given</span>` : esc(item.note)}</td>` +
      `<td align="right" style="${edge};font-family:${MONO};font-size:13px;white-space:nowrap">${item.amount < 0 ? '+' : ''}${exact(item.amount)}</td>` +
      `<td align="right" style="${edge};font-size:12px;white-space:nowrap;padding-left:12px;` +
      `color:${stale ? AMBER_INK : MUTED};font-weight:${stale ? 600 : 400}">${age}</td>` +
      `</tr>`
    );
  };

  const oldest = items[0].daysOpen; // ORDER BY watched_at ASC — the first row is the oldest.
  const rail = `${items.length} open${oldest >= 14 ? ` ${MIDDOT} oldest ${oldest} days` : ''}`;

  return widget(
    'Keeping an eye',
    rail,
    `<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%">` +
      items.map((item, i) => row(item, i === items.length - 1)).join('') +
      `</table>`,
    // Amber only when something has gone stale. A permanently amber card is a card the eye stops
    // reading, and the whole point of this one is the day it changes.
    oldest >= 14 ? AMBER_MARK : SLATE_MARK
  );
}

/** The same rows as text. The age stays last, so the column the eye should land on is aligned. */
function watchlistText(items: WatchedItem[]): string[] {
  const widest = Math.max(0, ...items.map((i) => i.label.length));
  return items.map((item) => {
    const age = item.daysOpen === 0 ? 'today' : item.daysOpen === 1 ? '1 day' : `${item.daysOpen} days`;
    const note = item.note ?? 'no reason given';
    return `  ${item.label.padEnd(Math.min(widest, 26))}  ${note.padEnd(28)}  ${exact(item.amount).padStart(10)}  ${age}`;
  });
}

/**
 * Widget 3 — what has arrived since the last email, in full.
 *
 * Titled "Just arrived" rather than "Yesterday" because that is now what it contains, and the two
 * differ by more than wording: a row dated five days ago that landed this morning belongs here and
 * did not belong under the old title. Captioning arrivals as a day was the shape of the bug.
 *
 * The rail says WHEN the window opens, so the reader can see the section is cumulative rather than
 * daily — and so a longer-than-usual list after a missed send explains itself instead of looking
 * like a surge in spending.
 *
 * Listed completely, unlike the dashboard's twelve: a screen has a fold and an email does not, and
 * a truncated list is one that cannot be reconciled against a statement.
 */
function arrivalsWidget(d: DigestData['arrivals']): string {
  const since = esc(shortDate(d.sinceDate));
  if (d.rows.length === 0) {
    return widget('Just arrived', `since ${since}`, emptyState('Nothing new has posted.'), SLATE_MARK);
  }

  const net = d.totalOut - d.totalIn;
  const rail =
    `since ${since} ${MIDDOT} ${d.rows.length} record${d.rows.length === 1 ? '' : 's'} ${MIDDOT} ` +
    `<span style="color:${net > 0 ? INK : GREEN};font-weight:600">${net > 0 ? '' : '+'}${exact(net)}</span> net`;

  return widget('Just arrived', rail, txnTable(d.rows, true, false), SLATE_MARK);
}

/**
 * Widget 4 — where this month's money is, and which parts of it are going wrong.
 *
 * Area is the budget and colour is the verdict, which is the pairing the dashboard's own bubbles
 * exist for: a list sorted by overspend puts a $75 education line closing at 300% above a $1,900
 * grocery line closing at 102%. True, and useless — the grocery line is where the money is.
 *
 * EVERY category with an allocation, not only the scored ones. The dashboard learned this the
 * expensive way: drawn off the scored partition, the picture showed a household spending about
 * $1,150 when the real figure was several times that, because groceries, fuel, property tax and
 * utilities are most of a month by value and none of them is a monthly decision. The bubbles are a
 * map, not a judgement, and a map that omits the largest territory is the wrong shape.
 *
 * The legend travels with the image. On a screen a reader can hover a bubble; in an email the
 * colour is the only thing that says what it means.
 */
function bubblesWidget(bubbles: DigestBubble[], src: string): string {
  if (bubbles.length === 0) return '';
  return widget(
    'This month',
    `${bubbles.length} categories`,
    `<img src="${src}" width="${BUBBLES_DISPLAY_WIDTH}" height="${BUBBLES_DISPLAY_HEIGHT}" ` +
      `alt="Every budget category this month as a circle: area is the amount budgeted, colour is whether it is on plan." ` +
      `style="display:block;width:100%;max-width:${BUBBLES_DISPLAY_WIDTH}px;height:auto;border:0"/>` +
      `<div style="font-family:${FONT};font-size:11px;color:${FAINT};padding:8px 0 0">` +
      `Circle area is what the category was given this month.</div>`,
    BLUE_MARK
  );
}

/**
 * Widget 5 — where the year closes, and the track it is on.
 *
 * The headline is the projected year-end P/L; the chart is the cumulative track that produces it,
 * so the reader can see whether the number comes from a steady climb or from one good month. Green
 * above the line, red below, forecast months tinted.
 *
 * `netToDate` is printed beside it, labelled as fact, because the projection is the figure people
 * argue with and the settled number is the one that anchors it.
 */
function yearEndWidget(d: DigestData['yearEnd'], chartSrc: string): string {
  const positive = d.profitLoss >= 0;

  const headline =
    `<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%">` +
    `<tr>` +
    `<td>` +
    `<div style="font-family:${FONT};font-size:28px;font-weight:600;color:${positive ? GREEN : RED};line-height:1.15">` +
    `${roundHtml(d.profitLoss)}</div>` +
    `<div style="font-family:${FONT};font-size:12px;color:${MUTED};padding:3px 0 0">` +
    `projected at year end</div>` +
    `</td>` +
    `<td align="right" valign="top">` +
    `<div style="font-family:${FONT};font-size:15px;font-weight:600;color:${INK}">${roundHtml(d.netToDate)}</div>` +
    `<div style="font-family:${FONT};font-size:11px;color:${FAINT};padding:2px 0 0">so far &middot; settled</div>` +
    `</td>` +
    `</tr></table>`;

  // NO PER-WIDGET EXCLUSION CAVEAT. It named the unfiled total and said filing it would move both
  // figures. Removed at the owner's request; the fact itself is NOT lost, because the message
  // footer still reads "Figures exclude uncategorized money" on every send, and the count of what
  // is unfiled leads the whole email. One statement of it rather than three.
  const legend =
    `<div style="font-family:${FONT};font-size:11px;color:${FAINT};padding:10px 0 0">` +
    `Bars: money in above the line, money out below. Line: cumulative profit and loss, dashed once forecast.</div>`;

  return widget(
    // The dashboard's widget is titled "Profit & Loss"; the mail now says the same thing, so the
    // two surfaces do not name one number two ways. `&amp;` rather than a bare ampersand because
    // `widget` interpolates its title raw — titles are module constants, so escaping inside
    // `widget` would double-escape the entities the rails deliberately contain.
    'Profit &amp; Loss',
    '',
    headline + `<div style="height:18px;font-size:0;line-height:0">&nbsp;</div>` + chart(chartSrc) + legend,
    // The verdict's own colour, matching the headline figure directly beneath it.
    positive ? GREEN : RED
  );
}

// ─── The message ──────────────────────────────────────────────────────────────────────────────

/**
 * `B8 daily · 15 Sep · Target P/L: −$1,655`
 *
 * Identity, day, and the one figure the whole message is steering by — chosen by the owner, and a
 * different division of labour from what was here before.
 *
 * WHAT LEFT: the count of records to file used to lead this line, on the reasoning that a subject
 * is read in a list and truncated around forty characters on a phone, so the actionable number
 * should survive the cut. That reasoning was right about subjects and wrong about this inbox, now
 * that the message writes its own preheader: the line immediately after the subject already says
 * "14 to file, 2 being watched". The subject says which mail this is and where the year is going;
 * the preheader says what is waiting. Two lines, two jobs, no repetition.
 *
 * Day first, matching the masthead and unlike the transaction rows below, which are scanned as a
 * column where the month is the part that repeats.
 *
 * The minus is the same U+2212 the body uses rather than a hyphen. Subjects are plain text, so
 * nothing needs escaping here, and one message spelling a negative two ways is the kind of detail
 * that reads as carelessness.
 */
function subjectFor(data: DigestData): string {
  const day = `${data.asOf.day} ${MONTH_LABELS[data.asOf.month - 1]}`;
  return `B8 daily ${'\u00b7'} ${day} ${'\u00b7'} Target P/L: ${round(data.yearEnd.profitLoss)}`;
}

/**
 * Data in, one message out.
 *
 * Both parts are always produced and both say the same things. The text part is not a courtesy: a
 * mail client that shows it is a client the HTML failed in, and the failure mode of sending HTML
 * alone is a blank message rather than a plain one.
 */
export function renderDigest(data: DigestData, chartSrc: string, bubblesSrc: string): DigestMessage {
  if (data.yearEnd.points.length !== 12) {
    throw new RangeError(`digest: the year-end track needs 12 points, got ${data.yearEnd.points.length}`);
  }

  const u = data.uncategorized;
  const a = data.arrivals;
  const ye = data.yearEnd;

  const dateLine = `${esc(shortDate(`${data.asOf.year}-${String(data.asOf.month).padStart(2, '0')}-${String(data.asOf.day).padStart(2, '0')}`))}, ${data.asOf.year}`;

  /**
   * THE PREHEADER — the line the inbox shows after the subject, and until now nobody wrote it.
   *
   * Every mail client takes the first text in the body when no preheader is supplied. This message
   * begins with its own wordmark, so the inbox has been reading: "b8 1 record needs a category 4
   * new transactions". That is the markup leaking into the one line of the message a reader
   * sees before deciding whether to open it.
   *
   * Hidden by the combination that actually works: zero font size AND zero line height AND
   * `display:none` AND white-on-white. No single one of them is honoured everywhere — Gmail
   * respects display:none, some clients do not, and the colour is what saves those. The trailing
   * run of zero-width non-joiners is the standard trick to stop the client back-filling the rest
   * of the preview with whatever text comes next.
   */
  const preheaderText =
    u.totalCount > 0
      ? `${u.totalCount} to file${data.watchlist.length > 0 ? `, ${data.watchlist.length} being watched` : ''}. ` +
        `${roundHtml(ye.profitLoss)} projected at year end.`
      : `Everything filed. ${roundHtml(ye.profitLoss)} projected at year end.`;

  const preheader =
    `<div style="display:none;font-size:0;line-height:0;max-height:0;max-width:0;opacity:0;overflow:hidden;` +
    `mso-hide:all;color:${SHELL}">${preheaderText}` +
    '&#8204;&#8204;&#8204;&#8204;&#8204;&#8204;&#8204;&#8204;&#8204;&#8204;&#8204;&#8204;&#8204;&#8204;&#8204;&#8204;' +
    `</div>`;

  /**
   * The masthead: a drawn mark, the wordmark, and the date.
   *
   * The mark is a rounded square with the letter in it, built from a table cell with a background
   * colour — not an image. An image would have to be a second `cid:` part on every send for a
   * 28-pixel square, and it would be blocked by default in the clients that block images, which is
   * exactly where a masthead most needs to survive.
   *
   * A hairline under the whole row, so the header reads as a header rather than as the first item
   * in the list.
   */
  const header =
    `<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="margin:0 0 18px">` +
    `<tr>` +
    `<td width="28" valign="middle" style="padding:0 10px 0 0">` +
    `<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="28" style="width:28px">` +
    `<tr><td align="center" valign="middle" height="28" style="height:28px;background-color:${INK};` +
    `border-radius:7px;font-family:${FONT};font-size:13px;font-weight:700;color:#ffffff;` +
    `line-height:28px">b8</td></tr></table>` +
    `</td>` +
    `<td valign="middle" style="font-family:${FONT};font-size:14px;font-weight:600;color:${INK};line-height:1.2">` +
    `Daily digest` +
    `<div style="font-family:${FONT};font-size:11px;font-weight:400;color:${FAINT};padding:2px 0 0">` +
    `${dateLine}</div>` +
    `</td>` +
    `</tr>` +
    `<tr><td colspan="2" style="padding:14px 0 0;font-size:0;line-height:0">` +
    `<div style="height:1px;background-color:${RULE};font-size:0;line-height:0">&nbsp;</div></td></tr>` +
    `</table>`;

  const html =
    // `background-color` on the body table rather than on <body>: several clients drop or rewrite a
    // <body> style, and the one that survives everywhere is a full-width table cell.
    `<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" ` +
    `style="background-color:${SHELL};margin:0;padding:0">` +
    `<tr><td align="center" style="padding:24px 12px">` +
    preheader +
    `<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="max-width:560px">` +
    `<tr><td>` +
    header +
    (data.jobGap
      ? `<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" ` +
        `style="background-color:${AMBER_BG};border:1px solid ${AMBER_RULE};border-radius:10px;margin:0 0 16px">` +
        `<tr><td style="padding:14px 18px;font-family:${FONT};font-size:13px;color:${AMBER_INK};line-height:1.5">` +
        `${esc(data.jobGap)}</td></tr></table>`
      : '') +
    counters(data) +
    uncategorizedWidget(data.uncategorized) +
    watchlistWidget(data.watchlist) +
    arrivalsWidget(data.arrivals) +
    bubblesWidget(data.bubbles, bubblesSrc) +
    yearEndWidget(data.yearEnd, chartSrc) +
    `<div style="font-family:${FONT};font-size:11px;color:${FAINT};padding:2px 0 0;text-align:center">` +
    `Sent by b8 on this machine. Figures exclude uncategorized money.</div>` +
    `</td></tr></table></td></tr></table>`;

  const text = [
    `b8`,
    '',
    ...(data.jobGap ? [`  ${data.jobGap}`, ''] : []),
    `  ${u.totalCount} ${u.totalCount === 1 ? 'record needs' : 'records need'} a category`,
    `  ${a.rows.length} new transaction${a.rows.length === 1 ? '' : 's'}`,
    '',
    `NEEDS A CATEGORY`,
    u.totalCount === 0
      ? '  Nothing outstanding — every record this month is filed.'
      : [
          ...txnTableText(u.rows, false),
          // The same removal as the HTML: the totals restated what the rows already show. What is
          // kept is the truncation notice, and ONLY when the list is actually truncated — the HTML
          // carries this in the widget rail, which the plain part has no equivalent of.
          ...(u.rows.length < u.totalCount ? [`  …and ${u.totalCount - u.rows.length} more.`] : []),
        ].join('\n'),
    '',
    ...(data.watchlist.length > 0
      ? [`KEEPING AN EYE — ${data.watchlist.length} open`, ...watchlistText(data.watchlist), '']
      : []),
    `JUST ARRIVED — since ${shortDate(a.sinceDate)}`,
    a.rows.length === 0 ? '  Nothing new has posted.' : txnTableText(a.rows, true, false).join('\n'),
    '',
    ...(data.bubbles.length > 0
      ? [
          `THIS MONTH`,
          ...bubblesText(data.bubbles),
          '',
        ]
      : []),
    `PROFIT & LOSS`,
    `  ${round(ye.profitLoss)} projected at year end.`,
    `  ${round(ye.netToDate)} so far, settled.`,
    '',
    ...chartText(ye.points),
    '',
    `Sent by b8 on this machine. Figures exclude uncategorized money.`,
  ].join('\n');

  return { subject: subjectFor(data), html, text, fingerprint: digestFingerprint(data.asOf) };
}
