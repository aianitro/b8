import { describe, expect, it } from 'vitest';
import { renderDigest, digestFingerprint, esc, shortDate, type DigestData, type DigestTxn } from './digest';

/** What the sender passes. The fixtures use it so they assert the markup that actually ships. */
const CHART_SRC = 'cid:b8-digest-chart';
const BUBBLES_SRC = 'cid:b8-digest-bubbles';

/** A complete, unremarkable digest. Each fixture below changes one thing about it. */
function data(overrides: Partial<DigestData> = {}): DigestData {
  return {
    asOf: { year: 2026, month: 9, day: 14 },
    uncategorized: {
      rows: [
        { date: '2026-09-09', label: 'Manual CR-Bkrg', amount: -16238.17, category: null },
        { date: '2026-09-13', label: 'Lemonade Insurance', amount: 1525.42, category: null },
      ],
      totalCount: 14,
      totalOut: 4083.84,
      totalIn: 16238.17,
    },
    yesterday: {
      date: '2026-09-13',
      rows: [
        { date: '2026-09-13', label: 'Total Wine & More', amount: 104.63, category: 'Grocery' },
        { date: '2026-09-13', label: 'Charles Tyrwhitt', amount: 376.92, category: null },
      ],
      totalOut: 481.55,
      totalIn: 0,
    },
    // OLDEST FIRST, which is the order lib/digestRead.ts produces (ORDER BY watched_at ASC) and
    // the order the widget depends on for its "oldest N days" rail. A fixture in the other order
    // would pass every assertion that does not look at position and hide the one that does.
    // A month with one of each verdict, so the picture and its text fallback both have something
    // to say about every colour.
    bubbles: [
      { category: 'Grocery', budgeted: 1900, actual: 1420, projectedRatio: 1.02, tooEarly: false },
      { category: 'Education', budgeted: 75, actual: 96, projectedRatio: 3.0, tooEarly: false },
      { category: 'Travel', budgeted: 400, actual: 40, projectedRatio: 0.4, tooEarly: false },
      { category: 'Pets', budgeted: 120, actual: 0, projectedRatio: null, tooEarly: true },
    ],

    watchlist: [
      { date: '2026-08-14', label: 'Charles Tyrwhitt', amount: 376.92, note: null, daysOpen: 31 },
      { date: '2026-09-11', label: 'Zara', amount: 120.17, note: 'returning to Zara', daysOpen: 3 },
    ],
    yearEnd: {
      profitLoss: 1.08,
      netToDate: -27090.98,
      points: track(),
    },
    ...overrides,
  };
}

/**
 * Twelve points that cross zero, because the owner's real operational year does.
 *
 * Copied from that real year rather than invented: the flows below are the ones the chart has to
 * survive, including April's month where spending triples and June's trough, which is where a
 * curve fitted without care draws a loss the year never had.
 */
function track(): DigestData['yearEnd']['points'] {
  const rows: Array<[number, number, number]> = [
    [7618, 3300, 4319], [7704, 6081, 5942], [13879, 9278, 10543], [7315, 22739, -4880],
    [7090, 24424, -22215], [15206, 25735, -32744], [13160, 5156, -24740], [11103, 11808, -25445],
    [20000, 6078, -10091], [12000, 6793, -4884], [12000, 13593, -6477], [11500, 5022, 1],
  ];
  return rows.map(([income, expense, cumulative], i) => ({
    month: i + 1, income, expense, cumulative, projected: i >= 8,
  }));
}

describe('the digest carries what the owner asked for', () => {
  it('lists uncategorized transactions by merchant name and amount', () => {
    const { html, text } = renderDigest(data(), CHART_SRC, BUBBLES_SRC);
    for (const surface of [html, text]) {
      expect(surface).toContain('Lemonade Insurance');
      expect(surface).toContain('$1,525.42');
    }
  });

  it('says when the list is only a sample, so a reader does not sum it and believe the answer', () => {
    // The totals box under the rows is gone at the owner's request — it restated the count and the
    // arithmetic, which duplicates what is on screen whenever the list is short enough to show in
    // full. What must survive is the statement that the list is TRUNCATED, which the rail carries.
    const { html, text } = renderDigest(data(), CHART_SRC, BUBBLES_SRC);
    expect(html).toContain('2 of 14 shown');
    expect(text).toContain('…and 12 more.');
    for (const surface of [html, text]) expect(surface).not.toContain('uncategorized this month');
  });

  it("lists yesterday's transactions with their categories, and flags the ones that have none", () => {
    const { html, text } = renderDigest(data(), CHART_SRC, BUBBLES_SRC);
    for (const surface of [html, text]) {
      expect(surface).toContain('Grocery');
      expect(surface).toContain('needs a category');
    }
  });

  it('states the projected year-end profit and loss, and the settled figure beside it', () => {
    const { html, text } = renderDigest(data(), CHART_SRC, BUBBLES_SRC);
    for (const surface of [html, text]) {
      expect(surface).toContain('$1');
      expect(surface).toMatch(/\$27,091/);
    }
  });

  it('draws twelve months in the plain part, and marks which of them are forecast', () => {
    // The HTML chart is now a picture, so its months are asserted in `digestChart.test.ts` against
    // the SVG. What this file still owns is the TEXT part — which is not a courtesy: it is what a
    // reader sees in a client that refuses images, which most clients do by default.
    const { text } = renderDigest(data(), CHART_SRC, BUBBLES_SRC);
    for (const month of ['Jan', 'Jun', 'Sep', 'Dec']) expect(text).toContain(month);
    // Settled and forecast must be distinguishable there too: colour is not a channel every reader
    // has, and the plain part has no colour at all.
    expect(text).toContain('(forecast)');
    expect(text).toMatch(/Aug.*█/);
    expect(text).toMatch(/Sep.*░/);
  });

  it('leads the subject with the actionable count, where truncation cannot reach it', () => {
    expect(renderDigest(data(), CHART_SRC, BUBBLES_SRC).subject).toMatch(/^14 to file/);
  });

  it('counts both headline numbers before any of the detail that explains them', () => {
    const { html, text } = renderDigest(data(), CHART_SRC, BUBBLES_SRC);
    for (const surface of [html, text]) {
      expect(surface).toContain('14');
      expect(surface).toMatch(/need a category|records need a category/);
      expect(surface).toMatch(/transactions? yesterday/);
    }
    // Both counters must sit above the lists. An email read on a phone is read from the top, and
    // the whole reason these exist is to be the part that does not need scrolling to.
    const { html: h } = renderDigest(data(), CHART_SRC, BUBBLES_SRC);
    expect(h.indexOf('need a category')).toBeLessThan(h.indexOf('Lemonade Insurance'));
  });

  it('agrees with itself about how many records need a category', () => {
    // The counter, the widget rail, the amber totals line and the subject all state this number.
    // Four copies of one fact is four chances to state it differently.
    const d = data();
    d.uncategorized.totalCount = 7;
    const { html, text, subject } = renderDigest(d, CHART_SRC, BUBBLES_SRC);
    expect(subject).toContain('7 to file');
    expect(html).toContain('2 of 7 shown');
    expect(text).toContain('7 records need a category');
    // The counter card states it as a bare number in its own element, which a substring search for
    // "7" cannot distinguish from a pixel height or a date. Matched on the element instead.
    expect(html).toMatch(/font-size:32px;font-weight:600;line-height:1;color:#92400e">7<\/div>/);
  });

  it('says nothing about its own Gmail label, because a label is the mailbox\'s word not the message\'s', () => {
    // `🤖-b8` used to lead the subject and head the body. It lives in Gmail now, applied by a
    // filter matching the `X-B8-Digest` header the sender sets — invisible to a reader, and not a
    // prefix to read past every morning before reaching the count.
    const { html, text, subject } = renderDigest(data(), CHART_SRC, BUBBLES_SRC);
    for (const surface of [html, text, subject]) expect(surface).not.toContain('🤖');
  });

  it('warns in amber only when there is something to do', () => {
    // A zero in a warning colour trains the reader to ignore the colour, which costs the one day
    // it actually means something.
    // Asserted on the amber BORDER, not the amber ink: the ink is also how an unfiled row is
    // flagged inside yesterday's list, which is a different statement and legitimately survives a
    // clear month. The border belongs only to the counter card and the totals box.
    const busy = renderDigest(data(), CHART_SRC, BUBBLES_SRC).html;
    const clear = renderDigest({ ...data(), uncategorized: { rows: [], totalCount: 0, totalOut: 0, totalIn: 0 } }, CHART_SRC, BUBBLES_SRC).html;
    expect(busy).toContain('#fde68a');
    expect(clear).not.toContain('#fde68a');
  });
});

describe('the figures stay honest', () => {
  it('still states once that the figures exclude unfiled money', () => {
    // The per-widget caveat naming the unfiled total was removed at the owner's request. The FACT
    // must not vanish with the sentence: the footer carries it on every send, and the count of what
    // is unfiled leads the whole message. One statement of it rather than three.
    const { html, text } = renderDigest(data(), CHART_SRC, BUBBLES_SRC);
    for (const surface of [html, text]) {
      expect(surface).toContain('Figures exclude uncategorized money');
      expect(surface).not.toContain('is excluded from both figures');
    }
  });

  it('renders a negative year-end projection as negative rather than as a bare magnitude', () => {
    const d = data();
    d.yearEnd.profitLoss = -8400;
    const { html, text } = renderDigest(d, CHART_SRC, BUBBLES_SRC);
    expect(text).toContain('−$8,400');
    expect(html).toContain('&minus;$8,400');
  });

  it('marks money in with a sign, not with colour alone', () => {
    // The brokerage credit is the row this rule exists for: rendered as a bare "$16,238.17" in
    // green it reads as the largest EXPENSE in the list to anyone who cannot see the colour.
    const { html, text } = renderDigest(data(), CHART_SRC, BUBBLES_SRC);
    for (const surface of [html, text]) expect(surface).toContain('+$16,238.17');
  });

  it('formats a date without going near a Date object', () => {
    // `new Date('2026-09-13')` is UTC midnight and prints as the 12th anywhere west of Greenwich,
    // which would misdate every row in the digest and look entirely plausible doing it.
    expect(shortDate('2026-09-13')).toBe('Sep 13');
    expect(shortDate('2026-01-01')).toBe('Jan 1');
    expect(shortDate('2026-12-31')).toBe('Dec 31');
    expect(() => shortDate('13/09/2026')).toThrow();
    expect(() => shortDate('2026-13-01')).toThrow();
  });

  it('refuses a year-end track that is not twelve months', () => {
    const d = data();
    d.yearEnd.points = track().slice(0, 11);
    expect(() => renderDigest(d, CHART_SRC, BUBBLES_SRC)).toThrow(RangeError);
  });
});

describe('what may never appear in the rendered message', () => {
  it('fetches nothing: the only reference it emits is to a part of this same message', () => {
    // The rule the alert this replaces enforced by being text-only — "a remote image is a second
    // outbound surface with a different destination and no decision behind it" — is unchanged.
    // What changed is that it is now enforced by SCHEME rather than by having no images: a remote
    // image reaches a host nobody chose and the request itself reports that the message was opened,
    // at what time, from what address. A `cid:` part is bytes already inside the envelope. Nothing
    // is fetched, and the message renders identically with the network unplugged.
    const { html, text } = renderDigest(data(), CHART_SRC, BUBBLES_SRC);

    expect(html).toContain('src="cid:b8-digest-chart"');
    expect(html).toContain('src="cid:b8-digest-bubbles"');

    // Two images, two references, and EVERY reference is a cid. Asserted as "every src matches"
    // rather than as a count, so adding a third picture later cannot quietly introduce the one
    // that reaches the network.
    const sources = [...html.matchAll(/src="([^"]*)"/g)].map((m) => m[1]);
    expect(sources).toHaveLength(2);
    for (const src of sources) expect(src).toMatch(/^cid:/);
    expect(html.match(/<img/gi)).toHaveLength(2);

    for (const surface of [html, text]) {
      expect(surface).not.toMatch(/https?:/i);
      expect(surface).not.toMatch(/data:/i);
      expect(surface).not.toMatch(/<a\s/i);
      expect(surface).not.toMatch(/<link/i);
      expect(surface).not.toMatch(/url\(/i);
      expect(surface).not.toMatch(/@import/i);
      expect(surface).not.toMatch(/<script/i);
    }
    // The plain part must reference nothing at all — it cannot render an image, so a `cid:` there
    // would be a bare token a reader sees as noise.
    expect(text).not.toContain('cid:');
  });

  it('gives the chart a text alternative, since many clients refuse images by default', () => {
    const html = renderDigest(data(), CHART_SRC, BUBBLES_SRC).html;
    expect(html).toMatch(/alt="[^"]{30,}"/);
  });

  it('sizes the image with attributes as well as CSS, for the clients that ignore CSS', () => {
    // Outlook renders a raster at its natural size when dimensions are given only in a style, and
    // this PNG is drawn at twice its display size to stay sharp on a phone.
    const html = renderDigest(data(), CHART_SRC, BUBBLES_SRC).html;
    expect(html).toMatch(/<img[^>]*width="560"[^>]*height="235"/);
  });

  it('escapes merchant names rather than letting a bank feed write markup', () => {
    const d = data();
    d.yesterday.rows = [{ date: '2026-09-13', label: '<b>AT&T</b> "Store"', amount: 40, category: null }];
    const { html } = renderDigest(d, CHART_SRC, BUBBLES_SRC);
    expect(html).toContain('&lt;b&gt;AT&amp;T&lt;/b&gt;');
    expect(html).not.toContain('<b>AT&T</b>');
  });

  it('escapes category names too, which the owner types by hand', () => {
    const d = data();
    d.yesterday.rows = [{ date: '2026-09-13', label: 'Safeway', amount: 30, category: 'Food & <Drink>' }];
    expect(renderDigest(d, CHART_SRC, BUBBLES_SRC).html).toContain('Food &amp; &lt;Drink&gt;');
  });

  it('escapes the five characters that matter and leaves the rest alone', () => {
    expect(esc(`<>&"'`)).toBe('&lt;&gt;&amp;&quot;&#39;');
    expect(esc('Total Wine')).toBe('Total Wine');
  });

  it('is never handed an account identifier or a balance to render', () => {
    // A structural check, not a wording one. `DigestTxn` has four fields and none of them is an
    // account, so no future edit to the renderer can leak one by accident — it would have to widen
    // the type first, which is a visible change to the outbound surface rather than a quiet one.
    const row: DigestTxn = { date: '2026-09-13', label: 'Safeway', amount: 30, category: 'Grocery' };
    expect(Object.keys(row).sort()).toEqual(['amount', 'category', 'date', 'label']);
  });
});

describe('the empty cases still say something', () => {
  it('says the month is clear when nothing needs filing', () => {
    const d = data();
    d.uncategorized = { rows: [], totalCount: 0, totalOut: 0, totalIn: 0 };
    const { html, text, subject } = renderDigest(d, CHART_SRC, BUBBLES_SRC);
    for (const surface of [html, text]) expect(surface).toContain('every record this month is filed');
    expect(subject).toContain('All filed');
  });

  it('says nothing about truncation when the whole list is on screen', () => {
    // The notice exists to stop a reader summing a partial list. On a short list there is nothing
    // to warn about, and a permanent "…and 0 more" is furniture.
    const d = data();
    d.uncategorized.totalCount = d.uncategorized.rows.length;
    expect(renderDigest(d, CHART_SRC, BUBBLES_SRC).text).not.toContain('more.');
    expect(renderDigest(d, CHART_SRC, BUBBLES_SRC).html).toContain('2 records');
  });

  it('says a quiet day was quiet rather than rendering an empty table', () => {
    const d = data();
    d.yesterday = { date: '2026-09-13', rows: [], totalOut: 0, totalIn: 0 };
    const { html, text } = renderDigest(d, CHART_SRC, BUBBLES_SRC);
    for (const surface of [html, text]) expect(surface).toContain('No transactions posted');
  });

  it('survives a year that has not started, where every bar would be zero', () => {
    const d = data();
    d.yearEnd.points = Array.from({ length: 12 }, (_, i) => ({
      month: i + 1, income: 0, expense: 0, cumulative: 0, projected: true,
    }));
    d.yearEnd.profitLoss = 0;
    expect(() => renderDigest(d, CHART_SRC, BUBBLES_SRC)).not.toThrow();
    expect(renderDigest(d, CHART_SRC, BUBBLES_SRC).text).toContain('Dec');
  });
});

describe('the fingerprint is what makes this a daily digest', () => {
  it('is the same for two renders of the same day, however much the figures moved', () => {
    // The point of filing the backlog is that the numbers move. A fingerprint over the CONTENT
    // would send a second digest on every filed transaction, which on a Monday is several.
    const morning = renderDigest(data(), CHART_SRC, BUBBLES_SRC);
    const afternoon = renderDigest({
      ...data(),
      uncategorized: { rows: [], totalCount: 0, totalOut: 0, totalIn: 0 },
      yearEnd: { ...data().yearEnd, profitLoss: -9999 },
    }, CHART_SRC, BUBBLES_SRC);
    expect(afternoon.fingerprint).toBe(morning.fingerprint);
    expect(afternoon.text).not.toBe(morning.text);
  });

  it('differs the next day, so tomorrow is never suppressed by today', () => {
    const today = digestFingerprint({ year: 2026, month: 9, day: 14 });
    const tomorrow = digestFingerprint({ year: 2026, month: 9, day: 15 });
    const nextMonth = digestFingerprint({ year: 2026, month: 10, day: 14 });
    const nextYear = digestFingerprint({ year: 2027, month: 9, day: 14 });
    expect(new Set([today, tomorrow, nextMonth, nextYear]).size).toBe(4);
  });

  it('satisfies the shape alert_sends CHECKs on insert', () => {
    // `^[0-9a-f]{16,}$` — the CHECK is what makes "opaque" enforceable rather than intended. A
    // readable fingerprint would put the send date in a column that table keeps meaningless.
    expect(renderDigest(data(), CHART_SRC, BUBBLES_SRC).fingerprint).toMatch(/^[0-9a-f]{16,}$/);
  });

  it('is a whole sha256, which is what "opaque" means here', () => {
    // Asserted as a length, NOT as "does not contain 2026" — a two- or four-character decimal
    // string turns up in a 64-character hex digest by chance often enough that such a test passes
    // for no reason and fails for no reason. What actually makes the value opaque is that it is
    // the full digest of material this module never puts in the row.
    expect(renderDigest(data(), CHART_SRC, BUBBLES_SRC).fingerprint).toHaveLength(64);
  });
});

describe('the watchlist widget', () => {
  it('lists what is being watched, with the reason and the amount', () => {
    const { html, text } = renderDigest(data(), CHART_SRC, BUBBLES_SRC);
    // The plain part uses uppercase headings throughout, matching NEEDS A CATEGORY and YEAR END;
    // the HTML title is uppercased by CSS instead. Asserted per surface rather than by lowercasing
    // both, so a heading that quietly changed case in one of them would still be caught.
    expect(html).toContain('Keeping an eye');
    expect(text).toContain('KEEPING AN EYE');
    for (const surface of [html, text]) {
      expect(surface).toContain('Zara');
      expect(surface).toContain('returning to Zara');
      expect(surface).toContain('$120.17');
    }
  });

  it('shows how long each entry has been open, because that is the number that changes', () => {
    // A watchlist that only says WHAT is on it becomes wallpaper: the same rows every morning until
    // the eye stops reading them. The age is the thing that should eventually feel wrong.
    const { html, text } = renderDigest(data(), CHART_SRC, BUBBLES_SRC);
    for (const surface of [html, text]) {
      expect(surface).toContain('31 days');
      expect(surface).toContain('3 days');
    }
  });

  it('reports the OLDEST entry in the rail, reading it from the first row', () => {
    // The read layer orders by watched_at ascending, so the oldest is first. Taking the last row
    // instead would report the newest and always look reassuring.
    expect(renderDigest(data(), CHART_SRC, BUBBLES_SRC).html).toContain('oldest 31 days');
  });

  it('marks an entry stale past two weeks, and leaves a fresh one alone', () => {
    const d = data();
    d.watchlist = [{ date: '2026-09-11', label: 'Zara', amount: 120.17, note: 'returning', daysOpen: 3 }];
    // Amber ink is the stale treatment. Nothing here is an error, so it is never red — and a colour
    // that shouts on day fifteen has nothing left to say on day sixty.
    expect(renderDigest(d, CHART_SRC, BUBBLES_SRC).html).not.toContain('oldest');
    d.watchlist = [{ date: '2026-08-14', label: 'Zara', amount: 120.17, note: 'returning', daysOpen: 14 }];
    expect(renderDigest(d, CHART_SRC, BUBBLES_SRC).html).toContain('oldest 14 days');
  });

  it('says a flag has no reason rather than rendering an empty cell', () => {
    const { html, text } = renderDigest(data(), CHART_SRC, BUBBLES_SRC);
    for (const surface of [html, text]) expect(surface).toContain('no reason given');
  });

  it('singularises one day, and says today for one flagged this morning', () => {
    const d = data();
    d.watchlist = [{ date: '2026-09-13', label: 'Zara', amount: 12, note: null, daysOpen: 1 }];
    expect(renderDigest(d, CHART_SRC, BUBBLES_SRC).text).toContain('1 day');
    expect(renderDigest(d, CHART_SRC, BUBBLES_SRC).text).not.toContain('1 days');
    d.watchlist = [{ date: '2026-09-14', label: 'Zara', amount: 12, note: null, daysOpen: 0 }];
    expect(renderDigest(d, CHART_SRC, BUBBLES_SRC).text).toContain('today');
  });

  it('disappears entirely when nothing is being watched', () => {
    // An empty widget saying "nothing to watch" every morning is three lines of furniture. Unlike
    // the uncategorized widget, whose empty state is news, this one has nothing to report.
    const d = data();
    d.watchlist = [];
    const { html, text } = renderDigest(d, CHART_SRC, BUBBLES_SRC);
    expect(html).not.toContain('Keeping an eye');
    expect(text).not.toContain('KEEPING AN EYE');
  });

  it('escapes a note, which is free text the owner typed', () => {
    const d = data();
    d.watchlist = [{ date: '2026-09-11', label: 'Zara', amount: 12, note: '<b>call</b> & ask', daysOpen: 1 }];
    const { html } = renderDigest(d, CHART_SRC, BUBBLES_SRC);
    expect(html).toContain('&lt;b&gt;call&lt;/b&gt; &amp; ask');
    expect(html).not.toContain('<b>call</b>');
  });
});

describe('the bubbles widget', () => {
  it('renders the picture, and the plain part says the same thing in words', () => {
    const { html, text } = renderDigest(data(), CHART_SRC, BUBBLES_SRC);
    expect(html).toContain('This month');
    expect(html).toContain('src="cid:b8-digest-bubbles"');

    // A circle-packing has no character equivalent, so the text part does not attempt one. What it
    // must preserve is the verdict, which the picture carries in colour and the plain part cannot.
    expect(text).toContain('THIS MONTH');
    expect(text).toContain('already over');
    expect(text).toContain('heading over');
    expect(text).toContain('on plan');
    expect(text).toContain('too early to call');
  });

  it('orders the text fallback by budget, which is what area encodes in the picture', () => {
    // Grocery is the largest allocation and the smallest overspend; Education is the reverse. A
    // list ordered by trouble would inverate them and lose the thing the bubbles exist to show.
    const text = renderDigest(data(), CHART_SRC, BUBBLES_SRC).text;
    expect(text.indexOf('Grocery')).toBeLessThan(text.indexOf('Education'));
  });

  it('gives the image a text alternative, since many clients refuse images by default', () => {
    const html = renderDigest(data(), CHART_SRC, BUBBLES_SRC).html;
    expect(html).toMatch(/alt="Every budget category[^"]{20,}"/);
  });

  it('disappears when no category has an allocation this month', () => {
    const d = data();
    d.bubbles = [];
    const { html, text } = renderDigest(d, CHART_SRC, BUBBLES_SRC);
    expect(html).not.toContain('cid:b8-digest-bubbles');
    expect(text).not.toContain('THIS MONTH');
    // And the remaining image is still the chart, so the widget going away takes its picture with
    // it rather than leaving a broken reference behind.
    expect([...html.matchAll(/src="([^"]*)"/g)].map((m) => m[1])).toEqual(['cid:b8-digest-chart']);
  });

  it('sits above the profit-and-loss widget, where the owner asked for it', () => {
    const html = renderDigest(data(), CHART_SRC, BUBBLES_SRC).html;
    expect(html.indexOf('This month')).toBeLessThan(html.indexOf('Profit &amp; Loss'));
  });
});
