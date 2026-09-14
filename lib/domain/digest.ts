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

/** One month of the year-end track. Twelve of these are a chart. */
export interface YearEndPoint {
  /** 1–12. */
  month: number;
  /** Running profit/loss from January through this month. December's value is the year's P/L. */
  cumulative: number;
  /** True once the month is wholly or partly forecast rather than settled. */
  projected: boolean;
}

export interface DigestData {
  /** The day this digest is about, as three integers. Converted once, by the caller. */
  asOf: { year: number; month: number; day: number };

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

  yesterday: {
    /** ISO date of the day being reported. Yesterday relative to the caller's clock, not this one. */
    date: string;
    rows: DigestTxn[];
    totalOut: number;
    totalIn: number;
  };

  yearEnd: {
    /** Where the year closes if the rest of it goes to plan. */
    profitLoss: number;
    /** Income less spend so far. Fact, not forecast. */
    netToDate: number;
    /** Twelve points, January first. */
    points: YearEndPoint[];
    /** Unfiled money excluded from every figure above, disclosed so the exclusion is visible. */
    uncategorizedNet: number;
  };
}

export interface DigestMessage {
  subject: string;
  html: string;
  text: string;
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

const FONT = "-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif";
const MONO = "ui-monospace,SFMono-Regular,Menlo,Consolas,monospace";

const MONTH_LABELS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/**
 * Total drawing height for the chart, split between the two sides of the zero line.
 *
 * Split in PROPORTION rather than evenly. An even split fixes the zero line at the middle, and the
 * owner's operational year runs from +$10.5k to −$32.7k — so half the chart would be a band of
 * empty white above a line sitting two thirds of the way up, and the bars that carry the
 * information would get a third of the space. Both sides still share ONE scale, which is the
 * property that matters: a dollar is the same number of pixels above the line as below it.
 */
const CHART_HEIGHT = 128;

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
 * Twelve cumulative-P/L columns around a zero line, built from table cells.
 *
 * Two rows, not one: the positive half sits in a row whose cells are bottom-aligned, the negative
 * half in a row whose cells are top-aligned, and the zero line is the border between them. A single
 * row cannot do this — a bar for −$4,000 and a bar for +$4,000 would both grow from the same edge
 * and read as the same value. The app's operational year is tuned near break-even, so the track
 * crosses zero routinely and the sign is most of the information.
 *
 * Scaled to the largest ABSOLUTE cumulative value, so both halves share one scale. Scaling each
 * half independently would make a −$500 dip as tall as a +$9,000 peak.
 *
 * Settled months are solid, forecast months are the soft tint of the same hue. That distinction is
 * carried again in the text fallback, because colour alone is not a channel every reader has.
 */
function chart(points: YearEndPoint[]): string {
  const peaks = points.map((p) => p.cumulative);
  const up = Math.max(0, ...peaks);
  const down = Math.abs(Math.min(0, ...peaks));
  const span = Math.max(up + down, 1);

  // One scale, two row heights. `pixels` is the shared conversion; the halves differ only in how
  // much of the shared budget each side's own peak claims.
  const pixels = (value: number) => Math.round((Math.abs(value) / span) * CHART_HEIGHT);
  const upBand = Math.max(up > 0 ? 4 : 0, pixels(up));
  const downBand = Math.max(down > 0 ? 4 : 0, pixels(down));

  const fill = (p: YearEndPoint) =>
    p.cumulative < 0 ? (p.projected ? RED_SOFT : RED) : p.projected ? GREEN_SOFT : GREEN;

  const bar = (p: YearEndPoint, side: 'up' | 'down'): string => {
    const drawn = side === 'up' ? p.cumulative >= 0 : p.cumulative < 0;
    if (!drawn) return `<td style="width:8.33%;padding:0 2px;font-size:0;line-height:0">&nbsp;</td>`;
    // Floor of 2px: a month that lands within a rounding error of break-even still gets a mark,
    // because "no bar" and "a bar of zero height" are the same picture and they are not the same
    // fact. December sits at $1 on the owner's current plan and must not vanish.
    const height = Math.max(2, pixels(p.cumulative));
    return (
      `<td valign="${side === 'up' ? 'bottom' : 'top'}" style="width:8.33%;padding:0 2px;font-size:0;line-height:0">` +
      `<div style="height:${height}px;background-color:${fill(p)};` +
      `border-radius:${side === 'up' ? '2px 2px 0 0' : '0 0 2px 2px'};font-size:0;line-height:0">&nbsp;</div>` +
      `</td>`
    );
  };

  const label = (p: YearEndPoint): string => {
    // The as-of month is the FIRST projected one; it gets the ink so the reader can see where
    // "today" sits without a legend entry explaining a marker.
    const isCurrent = p.projected && (p.month === 1 || !points[p.month - 2]?.projected);
    return (
      `<td align="center" style="width:8.33%;padding:5px 0 0;font-family:${FONT};font-size:10px;` +
      `color:${isCurrent ? INK : FAINT};font-weight:${isCurrent ? 600 : 400}">${MONTH_LABELS[p.month - 1]}</td>`
    );
  };

  return (
    `<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="table-layout:fixed">` +
    `<tr style="height:${upBand}px">${points.map((p) => bar(p, 'up')).join('')}</tr>` +
    `<tr><td colspan="12" style="height:1px;background-color:${INK};font-size:0;line-height:0">&nbsp;</td></tr>` +
    `<tr style="height:${downBand}px">${points.map((p) => bar(p, 'down')).join('')}</tr>` +
    `<tr>${points.map(label).join('')}</tr>` +
    `</table>`
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
function widget(title: string, rightRail: string, body: string): string {
  return (
    `<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" ` +
    `style="background-color:${PAPER};border:1px solid ${RULE};border-radius:10px;margin:0 0 16px">` +
    `<tr><td style="padding:18px 20px 20px">` +
    `<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%">` +
    `<tr>` +
    `<td style="font-family:${FONT};font-size:11px;font-weight:600;letter-spacing:.07em;` +
    `text-transform:uppercase;color:${FAINT}">${title}</td>` +
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
    return widget('Needs a category', '', emptyState('Nothing outstanding — every record this month is filed.'));
  }

  const shown = d.rows.length;
  const rail = shown < d.totalCount ? `${shown} of ${d.totalCount} shown` : `${d.totalCount} record${d.totalCount === 1 ? '' : 's'}`;

  // The totals line exists because the listed rows are a sample: the widget shows the largest few,
  // and a reader who adds up what is on screen would otherwise get a number that is not the number
  // any other figure in this email was computed from.
  const totals =
    `<div style="font-family:${FONT};font-size:12px;color:${AMBER_INK};background-color:${AMBER_BG};` +
    `border:1px solid ${AMBER_RULE};border-radius:6px;padding:9px 11px;margin:12px 0 0">` +
    `<strong>${d.totalCount} record${d.totalCount === 1 ? '' : 's'}</strong> uncategorized this month ${MDASH} ` +
    `${exact(d.totalOut)} out, ${exact(d.totalIn)} in. ` +
    `None of it is counted in the year-end figure below.` +
    `</div>`;

  return widget('Needs a category', rail, txnTable(d.rows, false) + totals);
}

/** Widget 2 — yesterday, in full. Short enough to list completely, so it is listed completely. */
function yesterdayWidget(d: DigestData['yesterday']): string {
  const day = esc(shortDate(d.date));
  if (d.rows.length === 0) {
    return widget('Yesterday', day, emptyState('No transactions posted.'));
  }

  const net = d.totalOut - d.totalIn;
  const rail =
    `${day} ${MIDDOT} ${d.rows.length} record${d.rows.length === 1 ? '' : 's'} ${MIDDOT} ` +
    `<span style="color:${net > 0 ? INK : GREEN};font-weight:600">${net > 0 ? '' : '+'}${exact(net)}</span> net`;

  return widget('Yesterday', rail, txnTable(d.rows, true, false));
}

/**
 * Widget 3 — where the year closes, and the track it is on.
 *
 * The headline is the projected year-end P/L; the chart is the cumulative track that produces it,
 * so the reader can see whether the number comes from a steady climb or from one good month. Green
 * above the line, red below, forecast months tinted.
 *
 * `netToDate` is printed beside it, labelled as fact, because the projection is the figure people
 * argue with and the settled number is the one that anchors it.
 */
function yearEndWidget(d: DigestData['yearEnd']): string {
  const positive = d.profitLoss >= 0;

  const headline =
    `<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%">` +
    `<tr>` +
    `<td>` +
    `<div style="font-family:${FONT};font-size:28px;font-weight:600;color:${positive ? GREEN : RED};line-height:1.15">` +
    `${roundHtml(d.profitLoss)}</div>` +
    `<div style="font-family:${FONT};font-size:12px;color:${MUTED};padding:3px 0 0">` +
    `projected at year end, if the rest of the year goes to plan</div>` +
    `</td>` +
    `<td align="right" valign="top">` +
    `<div style="font-family:${FONT};font-size:15px;font-weight:600;color:${INK}">${roundHtml(d.netToDate)}</div>` +
    `<div style="font-family:${FONT};font-size:11px;color:${FAINT};padding:2px 0 0">so far &middot; settled</div>` +
    `</td>` +
    `</tr></table>`;

  // Disclosed rather than folded in. `lib/yearEndRead.ts` excludes unfiled money from every figure
  // because calling it income or spend is a guess — and on 2026-09-11 that guess was wrong by
  // $2,175 in the flattering direction. Saying so here is what keeps the headline honest.
  const caveat =
    Math.abs(d.uncategorizedNet) >= 1
      ? `<div style="font-family:${FONT};font-size:11px;color:${MUTED};padding:12px 0 0;border-top:1px solid ${RULE};margin:14px 0 0">` +
        `${roundHtml(Math.abs(d.uncategorizedNet))} of uncategorized money is excluded from both figures. ` +
        `Filing it will move them.</div>`
      : '';

  const legend =
    `<div style="font-family:${FONT};font-size:11px;color:${FAINT};padding:10px 0 0">` +
    `Cumulative profit and loss, January to December. Solid is settled, pale is forecast.</div>`;

  return widget(
    'Year end',
    '',
    headline + `<div style="height:18px;font-size:0;line-height:0">&nbsp;</div>` + chart(d.points) + legend + caveat
  );
}

// ─── The message ──────────────────────────────────────────────────────────────────────────────

/**
 * Subject lines are read in a list, often on a lock screen, and truncated around 40 characters on
 * a phone. So the actionable count goes first and the date last — the reverse of how the body is
 * ordered, and deliberately: "b8 — 13 to file" survives truncation, "b8 daily digest for Sep 14"
 * does not survive it in any useful form.
 */
function subjectFor(data: DigestData): string {
  const date = shortDate(`${data.asOf.year}-${String(data.asOf.month).padStart(2, '0')}-${String(data.asOf.day).padStart(2, '0')}`);
  const { totalCount } = data.uncategorized;
  if (totalCount > 0) return `b8 — ${totalCount} to file · ${round(data.yearEnd.profitLoss)} year end · ${date}`;
  return `b8 — all filed · ${round(data.yearEnd.profitLoss)} year end · ${date}`;
}

/**
 * Data in, one message out.
 *
 * Both parts are always produced and both say the same things. The text part is not a courtesy: a
 * mail client that shows it is a client the HTML failed in, and the failure mode of sending HTML
 * alone is a blank message rather than a plain one.
 */
export function renderDigest(data: DigestData): DigestMessage {
  if (data.yearEnd.points.length !== 12) {
    throw new RangeError(`digest: the year-end track needs 12 points, got ${data.yearEnd.points.length}`);
  }

  const header =
    `<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="margin:0 0 16px">` +
    `<tr><td style="font-family:${FONT};font-size:13px;font-weight:600;color:${INK}">b8</td>` +
    `<td align="right" style="font-family:${FONT};font-size:12px;color:${FAINT}">` +
    `${esc(shortDate(`${data.asOf.year}-${String(data.asOf.month).padStart(2, '0')}-${String(data.asOf.day).padStart(2, '0')}`))}, ${data.asOf.year}` +
    `</td></tr></table>`;

  const html =
    // `background-color` on the body table rather than on <body>: several clients drop or rewrite a
    // <body> style, and the one that survives everywhere is a full-width table cell.
    `<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" ` +
    `style="background-color:${SHELL};margin:0;padding:0">` +
    `<tr><td align="center" style="padding:24px 12px">` +
    `<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="max-width:560px">` +
    `<tr><td>` +
    header +
    uncategorizedWidget(data.uncategorized) +
    yesterdayWidget(data.yesterday) +
    yearEndWidget(data.yearEnd) +
    `<div style="font-family:${FONT};font-size:11px;color:${FAINT};padding:2px 0 0;text-align:center">` +
    `Sent by b8 on this machine. Figures exclude uncategorized money.</div>` +
    `</td></tr></table></td></tr></table>`;

  const u = data.uncategorized;
  const y = data.yesterday;
  const ye = data.yearEnd;

  const text = [
    `NEEDS A CATEGORY`,
    u.totalCount === 0
      ? '  Nothing outstanding — every record this month is filed.'
      : [
          ...txnTableText(u.rows, false),
          '',
          `  ${u.totalCount} record${u.totalCount === 1 ? '' : 's'} uncategorized this month — ` +
            `${exact(u.totalOut)} out, ${exact(u.totalIn)} in. None of it is counted in the year-end figure below.`,
        ].join('\n'),
    '',
    `YESTERDAY — ${shortDate(y.date)}`,
    y.rows.length === 0 ? '  No transactions posted.' : txnTableText(y.rows, true, false).join('\n'),
    '',
    `YEAR END`,
    `  ${round(ye.profitLoss)} projected, if the rest of the year goes to plan.`,
    `  ${round(ye.netToDate)} so far, settled.`,
    '',
    ...chartText(ye.points),
    '',
    ...(Math.abs(ye.uncategorizedNet) >= 1
      ? [`  ${round(Math.abs(ye.uncategorizedNet))} of uncategorized money is excluded from both figures. Filing it will move them.`, '']
      : []),
    `Sent by b8 on this machine. Figures exclude uncategorized money.`,
  ].join('\n');

  return { subject: subjectFor(data), html, text };
}
