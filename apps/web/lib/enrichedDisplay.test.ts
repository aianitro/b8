// P6-40d — the pure half of the enriched row: which logo URL may become an image source, what
// the detail line says, and the placeholder's letter. One test per row of SPEC.md's case table,
// which is the floor; the extra cases below it are marked as such. Every input is fabricated.

import { describe, expect, it } from 'vitest';
import { MAX_LOGO_URL_LENGTH, detailLine, enrichmentDetail, placeholderInitial, safeLogoUrl } from './enrichedDisplay';

describe('safeLogoUrl — only an absolute https URL with a host reaches src', () => {
  it('passes a plain https logo URL through', () => {
    expect(safeLogoUrl('https://example.com/logo.png')).toBe('https://example.com/logo.png');
  });
  it('keeps a subdomain, a path and a query string', () => {
    expect(safeLogoUrl('https://cdn.example.com/a/b.png?x=1')).toBe('https://cdn.example.com/a/b.png?x=1');
  });
  it('trims surrounding whitespace', () => {
    expect(safeLogoUrl('  https://example.com/l.png  ')).toBe('https://example.com/l.png');
  });
  it.each([
    ['null', null],
    ['undefined', undefined],
    ['empty', ''],
    ['whitespace only', '   '],
  ])('refuses %s', (_label, input) => {
    expect(safeLogoUrl(input)).toBeNull();
  });
  it('refuses javascript:', () => {
    expect(safeLogoUrl('javascript:alert(1)')).toBeNull();
  });
  it('refuses a padded, mixed-case JavaScript:', () => {
    expect(safeLogoUrl('  JavaScript:alert(1)')).toBeNull();
  });
  it('refuses a tab-split java\\tscript: (which the URL parser would otherwise repair)', () => {
    expect(safeLogoUrl('java\tscript:alert(1)')).toBeNull();
  });
  it('refuses a data: png', () => {
    expect(safeLogoUrl('data:image/png;base64,AAAA')).toBeNull();
  });
  it('refuses a data: svg carrying a script', () => {
    expect(safeLogoUrl('data:image/svg+xml,<svg onload=alert(1)>')).toBeNull();
  });
  it('refuses blob:', () => {
    expect(safeLogoUrl('blob:https://example.com/0000')).toBeNull();
  });
  it('refuses http: (mixed content, and not what Plaid sends)', () => {
    expect(safeLogoUrl('http://example.com/l.png')).toBeNull();
  });
  it('refuses ftp:', () => {
    expect(safeLogoUrl('ftp://example.com/l.png')).toBeNull();
  });
  it('refuses file:', () => {
    expect(safeLogoUrl('file:///etc/passwd')).toBeNull();
  });
  it('refuses a protocol-relative URL', () => {
    expect(safeLogoUrl('//example.com/l.png')).toBeNull();
  });
  it('refuses a relative path', () => {
    expect(safeLogoUrl('/relative/l.png')).toBeNull();
  });
  it('refuses a bare host with no scheme', () => {
    expect(safeLogoUrl('example.com/l.png')).toBeNull();
  });
  it('refuses embedded credentials', () => {
    expect(safeLogoUrl('https://user:pw@example.com/l.png')).toBeNull();
  });
  it('refuses https: with no host', () => {
    expect(safeLogoUrl('https://')).toBeNull();
  });
  it('refuses text that is not a URL', () => {
    expect(safeLogoUrl('not a url')).toBeNull();
  });
  it('refuses an https URL longer than the bound', () => {
    expect(safeLogoUrl(`https://example.com/${'a'.repeat(2100)}`)).toBeNull();
  });
  it('returns null for a non-string, and does not throw', () => {
    expect(() => safeLogoUrl(42 as unknown as string)).not.toThrow();
    expect(safeLogoUrl(42 as unknown as string)).toBeNull();
  });

  // Beyond the floor.
  it('accepts an https URL exactly at the bound, and refuses one character over', () => {
    const base = 'https://example.com/';
    const atBound = base + 'a'.repeat(MAX_LOGO_URL_LENGTH - base.length);
    expect(safeLogoUrl(atBound)).toBe(atBound);
    expect(safeLogoUrl(atBound + 'a')).toBeNull();
  });
  it('refuses a username without a password', () => {
    expect(safeLogoUrl('https://user@example.com/l.png')).toBeNull();
  });
  it('refuses https: written without the slashes', () => {
    expect(safeLogoUrl('https:example.com/l.png')).toBeNull();
  });
  it('refuses a newline smuggled inside an otherwise https URL', () => {
    expect(safeLogoUrl('https://exa\nmple.com/l.png')).toBeNull();
  });
  it('normalizes an uppercase scheme and host rather than echoing the raw input', () => {
    expect(safeLogoUrl('HTTPS://EXAMPLE.COM/l.png')).toBe('https://example.com/l.png');
  });
});

describe('enrichmentDetail — what the secondary line says', () => {
  const posted = '2026-03-04';
  const row = (over: Partial<Parameters<typeof enrichmentDetail>[0]>) => ({
    date: posted, authorized_date: null, location_city: null, location_region: null, ...over,
  });

  // The case table, kept as data so the last assertion can run across every row of it.
  const cases: { name: string; input: Parameters<typeof enrichmentDetail>[0]; expected: Partial<ReturnType<typeof enrichmentDetail>> }[] = [
    { name: 'a distinct authorized date with city and region', input: row({ authorized_date: '2026-03-03', location_city: 'Portland', location_region: 'OR' }), expected: { authorized: '2026-03-03', location: 'Portland, OR' } },
    { name: 'an authorized date equal to the posted date, no location', input: row({ authorized_date: '2026-03-04' }), expected: { authorized: null, location: null } },
    { name: 'an authorized date later than the posted date', input: row({ authorized_date: '2026-03-06' }), expected: { authorized: '2026-03-06' } },
    { name: 'everything null', input: row({}), expected: { authorized: null, location: null } },
    { name: 'a city with no region', input: row({ location_city: 'Portland' }), expected: { location: 'Portland' } },
    { name: 'a region with no city', input: row({ location_region: 'OR' }), expected: { location: 'OR' } },
    { name: 'a whitespace city and an empty region', input: row({ location_city: '  ', location_region: '' }), expected: { location: null } },
    { name: 'a padded city and region', input: row({ location_city: ' Portland ', location_region: ' OR ' }), expected: { location: 'Portland, OR' } },
    { name: 'a stringified Date instead of ISO', input: row({ authorized_date: 'Wed Mar 04 2026' }), expected: { authorized: null } },
    { name: 'an impossible date', input: row({ authorized_date: '2026-02-30' }), expected: { authorized: null } },
    { name: 'an empty authorized date', input: row({ authorized_date: '' }), expected: { authorized: null } },
  ];

  for (const c of cases) {
    it(c.name, () => {
      expect(enrichmentDetail(c.input)).toMatchObject(c.expected);
    });
  }

  it('never yields the text null, undefined or Invalid, across every row above', () => {
    for (const c of cases) {
      const out = enrichmentDetail(c.input);
      for (const text of [out.authorized, out.location, detailLine(out, (iso) => iso)]) {
        if (text === null) continue;
        expect(text).not.toMatch(/null|undefined|Invalid/);
      }
    }
  });

  // Beyond the floor.
  it('accepts the 29th of February in a leap year and refuses it otherwise', () => {
    expect(enrichmentDetail(row({ date: '2028-03-01', authorized_date: '2028-02-29' })).authorized).toBe('2028-02-29');
    expect(enrichmentDetail(row({ date: '2027-03-01', authorized_date: '2027-02-29' })).authorized).toBeNull();
  });
  it('refuses a timestamp where a date belongs', () => {
    expect(enrichmentDetail(row({ authorized_date: '2026-03-03T00:00:00.000Z' })).authorized).toBeNull();
  });
  it('treats an undefined field as absent', () => {
    expect(enrichmentDetail({ date: posted, authorized_date: undefined, location_city: undefined, location_region: undefined }))
      .toEqual({ authorized: null, location: null });
  });
});

describe('detailLine — the parts as one line, or no line', () => {
  const iso = (d: string) => d;
  it('joins both parts with one separator', () => {
    expect(detailLine({ authorized: '2026-03-03', location: 'Portland, OR' }, iso)).toBe('Authorized 2026-03-03 · Portland, OR');
  });
  it('shows the authorized date alone with no dangling separator', () => {
    expect(detailLine({ authorized: '2026-03-03', location: null }, iso)).toBe('Authorized 2026-03-03');
  });
  it('shows the location alone with no dangling separator', () => {
    expect(detailLine({ authorized: null, location: 'Portland' }, iso)).toBe('Portland');
  });
  it('is null, not an empty string, when there is nothing to say', () => {
    expect(detailLine({ authorized: null, location: null }, iso)).toBeNull();
  });
  it('formats the date with the caller\'s own style', () => {
    expect(detailLine({ authorized: '2026-03-03', location: null }, (d) => `day ${d.slice(8)}`)).toBe('Authorized day 03');
  });
});

describe('placeholderInitial — the letter on the neutral tile', () => {
  it('takes the first letter of a title', () => {
    expect(placeholderInitial('Blue Bottle')).toBe('B');
  });
  it('uppercases it', () => {
    expect(placeholderInitial('amazon')).toBe('A');
  });
  it('skips leading space and accepts a digit', () => {
    expect(placeholderInitial('  7-Eleven')).toBe('7');
  });
  it('uppercases an accented letter as one code point', () => {
    expect(placeholderInitial('élan')).toBe('É');
  });
  it.each([
    ['a lone dash', '—'],
    ['empty', ''],
    ['whitespace only', '  '],
    ['null', null],
    ['undefined', undefined],
  ])('is null for %s', (_label, input) => {
    expect(placeholderInitial(input)).toBeNull();
  });

  // Beyond the floor.
  it('skips leading punctuation to the first letter', () => {
    expect(placeholderInitial('#1 Deli')).toBe('1');
    expect(placeholderInitial('(Pending) Shop')).toBe('P');
  });
  it('stays one code point when uppercasing would lengthen it', () => {
    expect(placeholderInitial('ßar')).toBe('S');
  });
});
