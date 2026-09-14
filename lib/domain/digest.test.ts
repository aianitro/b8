import { describe, expect, it } from 'vitest';
import { renderDigest, esc, shortDate, type DigestData, type DigestTxn } from './digest';

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
    yearEnd: {
      profitLoss: 1.08,
      netToDate: -27090.98,
      points: track(),
      uncategorizedNet: 2504,
    },
    ...overrides,
  };
}

/** Twelve points that cross zero, because the owner's real operational year does. */
function track(): DigestData['yearEnd']['points'] {
  const cumulative = [4319, 5942, 10543, -4880, -22215, -32744, -24740, -25445, -10091, -4884, -6477, 1];
  return cumulative.map((c, i) => ({ month: i + 1, cumulative: c, projected: i >= 8 }));
}

describe('the digest carries what the owner asked for', () => {
  it('lists uncategorized transactions by merchant name and amount', () => {
    const { html, text } = renderDigest(data());
    for (const surface of [html, text]) {
      expect(surface).toContain('Lemonade Insurance');
      expect(surface).toContain('$1,525.42');
    }
  });

  it("reports the month's whole uncategorized population, not just the rows it lists", () => {
    // The listed rows are a sample of the largest. A reader who summed only what is on screen
    // would get a figure no other number in this email was computed from, so the totals are stated.
    const { html, text } = renderDigest(data());
    for (const surface of [html, text]) {
      expect(surface).toContain('14 record');
      expect(surface).toContain('$4,083.84');
      expect(surface).toContain('$16,238.17');
    }
  });

  it("lists yesterday's transactions with their categories, and flags the ones that have none", () => {
    const { html, text } = renderDigest(data());
    for (const surface of [html, text]) {
      expect(surface).toContain('Grocery');
      expect(surface).toContain('needs a category');
    }
  });

  it('states the projected year-end profit and loss, and the settled figure beside it', () => {
    const { html, text } = renderDigest(data());
    for (const surface of [html, text]) {
      expect(surface).toContain('$1');
      expect(surface).toMatch(/\$27,091/);
    }
  });

  it('draws twelve months and marks which of them are forecast rather than settled', () => {
    const { html, text } = renderDigest(data());
    for (const month of ['Jan', 'Jun', 'Sep', 'Dec']) expect(html).toContain(month);
    // Settled and forecast must be distinguishable in the text part too: colour is not a channel
    // every reader has, and the plain part has no colour at all.
    expect(text).toContain('(forecast)');
    expect(text).toMatch(/Aug.*█/);
    expect(text).toMatch(/Sep.*░/);
  });

  it('puts the actionable count first in the subject, where truncation cannot reach it', () => {
    expect(renderDigest(data()).subject).toMatch(/^b8 — 14 to file/);
  });
});

describe('the figures stay honest', () => {
  it('discloses the uncategorized money that every headline figure excludes', () => {
    const { html, text } = renderDigest(data());
    for (const surface of [html, text]) {
      expect(surface).toMatch(/\$2,504 of uncategorized money is excluded/);
    }
  });

  it('says nothing about excluded money when there is none to exclude', () => {
    const d = data();
    d.yearEnd.uncategorizedNet = 0;
    const { html, text } = renderDigest(d);
    for (const surface of [html, text]) expect(surface).not.toContain('is excluded from both figures');
  });

  it('renders a negative year-end projection as negative rather than as a bare magnitude', () => {
    const d = data();
    d.yearEnd.profitLoss = -8400;
    const { html, text } = renderDigest(d);
    expect(text).toContain('−$8,400');
    expect(html).toContain('&minus;$8,400');
  });

  it('marks money in with a sign, not with colour alone', () => {
    // The brokerage credit is the row this rule exists for: rendered as a bare "$16,238.17" in
    // green it reads as the largest EXPENSE in the list to anyone who cannot see the colour.
    const { html, text } = renderDigest(data());
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
    expect(() => renderDigest(d)).toThrow(RangeError);
  });
});

describe('what may never appear in the rendered message', () => {
  it('emits no URL of any kind, in any form', () => {
    // This replaces the plain-text-only rule the alert it supersedes relied on. That rule existed
    // because "an HTML body invites a remote image, and a remote image is a second outbound surface
    // with a different destination and no decision behind it" — still true, and enforced here
    // against the output rather than by avoiding HTML. A remote image would also report to its host
    // that the message was opened, which is a disclosure nobody authorised.
    const { html, text } = renderDigest(data());
    for (const surface of [html, text]) {
      expect(surface).not.toMatch(/https?:/i);
      expect(surface).not.toMatch(/<img/i);
      expect(surface).not.toMatch(/<a\s/i);
      expect(surface).not.toMatch(/<link/i);
      expect(surface).not.toMatch(/url\(/i);
      expect(surface).not.toMatch(/@import/i);
      expect(surface).not.toMatch(/<script/i);
    }
  });

  it('escapes merchant names rather than letting a bank feed write markup', () => {
    const d = data();
    d.yesterday.rows = [{ date: '2026-09-13', label: '<b>AT&T</b> "Store"', amount: 40, category: null }];
    const { html } = renderDigest(d);
    expect(html).toContain('&lt;b&gt;AT&amp;T&lt;/b&gt;');
    expect(html).not.toContain('<b>AT&T</b>');
  });

  it('escapes category names too, which the owner types by hand', () => {
    const d = data();
    d.yesterday.rows = [{ date: '2026-09-13', label: 'Safeway', amount: 30, category: 'Food & <Drink>' }];
    expect(renderDigest(d).html).toContain('Food &amp; &lt;Drink&gt;');
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
    const { html, text, subject } = renderDigest(d);
    for (const surface of [html, text]) expect(surface).toContain('every record this month is filed');
    expect(subject).toContain('all filed');
  });

  it('says a quiet day was quiet rather than rendering an empty table', () => {
    const d = data();
    d.yesterday = { date: '2026-09-13', rows: [], totalOut: 0, totalIn: 0 };
    const { html, text } = renderDigest(d);
    for (const surface of [html, text]) expect(surface).toContain('No transactions posted');
  });

  it('survives a year that has not started, where every bar would be zero', () => {
    const d = data();
    d.yearEnd.points = Array.from({ length: 12 }, (_, i) => ({ month: i + 1, cumulative: 0, projected: true }));
    d.yearEnd.profitLoss = 0;
    expect(() => renderDigest(d)).not.toThrow();
    expect(renderDigest(d).html).toContain('Dec');
  });
});
