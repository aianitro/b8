// What a statement row and a Transactions row show of Plaid's enrichment (P6-40d): a merchant
// mark, and one secondary line carrying the authorized date and the location.
//
// PURE, AND SHARED BY BOTH SURFACES. The account page and the Transactions page render rows in
// two different components with two different date styles, and the decisions that must not
// diverge between them — which URL may become an image source, when an authorized date is worth
// saying, how a city and a region join — are made here once. Each component keeps only its own
// date formatting, which it passes in.
//
// Every input is a nullable column from P6-40b. NULL there means "Plaid did not say" or "nothing
// was captured"; either way it is unknown, and unknown renders as nothing — never as the word
// `null`, a zero, the app's "—", or a separator with nothing on one side of it.

/** Longest logo URL that may reach an `img`. Plaid's are a fraction of this; anything longer is not a logo. */
export const MAX_LOGO_URL_LENGTH = 2048;

/**
 * The logo URL as an image source, or `null` when it may not be one.
 *
 * THE RETURNED STRING IS THE ONLY THING THAT MAY REACH `src`. The column is third-party text, and
 * a browser will happily fetch — or for some schemes run — whatever an `img` is given. So this is
 * an allowlist, not a blocklist: absolute `https:` with a host, nothing else.
 *
 * - `http:` is refused too. Plaid's logos are https, and an http image on this https app is mixed
 *   content the browser would block or warn about anyway.
 * - Control characters and spaces INSIDE the trimmed string are refused before parsing. The URL
 *   parser silently deletes tabs and newlines, which is how `java<TAB>script:` becomes
 *   `javascript:` — refusing the input outright means the scheme check below is checking what
 *   was actually stored, not the parser's repair of it.
 * - The scheme is tested on the raw text as well as on the parsed URL, so a protocol-relative
 *   `//host/x.png` or a bare `host/x.png` never gets resolved against some base into an https URL.
 * - Credentials are refused: an `https://user:pw@host` logo is not a logo, and the browser would
 *   send them.
 * - It never throws. `new URL` throws on garbage, and one bad row must not blank the whole table,
 *   so the parse is caught and garbage is `null`. A non-string (a mistyped column) is `null` too.
 */
export function safeLogoUrl(value: string | null | undefined): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  if (trimmed === '' || trimmed.length > MAX_LOGO_URL_LENGTH) return null;
  if (/[\x00-\x20\x7f]/.test(trimmed)) return null; // controls, space, DEL
  if (!/^https:\/\//i.test(trimmed)) return null;
  let url: URL;
  try {
    url = new URL(trimmed);
  } catch {
    return null;
  }
  if (url.protocol !== 'https:' || url.hostname === '') return null;
  if (url.username !== '' || url.password !== '') return null;
  // The normalized form, re-checked: percent-encoding can lengthen it past the bound.
  return url.href.length > MAX_LOGO_URL_LENGTH ? null : url.href;
}

/** The two parts of a row's secondary line. Each is `null` when it has nothing to say. */
export interface EnrichmentDetail {
  /** `YYYY-MM-DD`, only when it is a real date and differs from the posted date. */
  authorized: string | null;
  /** `City, ST`, the city alone or the region alone. */
  location: string | null;
}

/** The trimmed text, or `null` for null, empty and whitespace-only alike. */
function present(value: string | null | undefined): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed === '' ? null : trimmed;
}

/**
 * Whether `value` is an ISO `YYYY-MM-DD` that names a real calendar day.
 *
 * BY HAND, NOT `new Date(value)`. That constructor accepts a stringified Date ("Wed Mar 04 2026")
 * and rolls an impossible day ("2026-02-30") over into March rather than refusing it — both of
 * which would then print as a plausible wrong date. Date.UTC is used only to ask how many days
 * the month has, in UTC, so no time zone can move the answer.
 */
function isIsoDate(value: string): boolean {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!m) return false;
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  if (mo < 1 || mo > 12 || d < 1) return false;
  return d <= new Date(Date.UTC(y, mo, 0)).getUTCDate();
}

/**
 * What a row's detail line says.
 *
 * THE AUTHORIZED DATE ONLY WHEN IT ADDS SOMETHING. On most card rows it is the posted date or a
 * day before; equal to the posted date it says nothing twice, so it is dropped. The comparison
 * is between two ISO strings — both pages select `date::text` and `authorized_date::text` — so
 * it is an equality of calendar days with no Date object and no zone in between. A later
 * authorized date (a pending-to-posted oddity) is still a fact and is kept.
 */
export function enrichmentDetail(row: {
  date: string;
  authorized_date: string | null | undefined;
  location_city: string | null | undefined;
  location_region: string | null | undefined;
}): EnrichmentDetail {
  const authorizedText = present(row.authorized_date);
  const authorized = authorizedText !== null && isIsoDate(authorizedText) && authorizedText !== row.date
    ? authorizedText
    : null;
  const city = present(row.location_city);
  const region = present(row.location_region);
  const location = city !== null && region !== null ? `${city}, ${region}` : city ?? region;
  return { authorized, location };
}

/**
 * The detail as one line of text, or `null` when there is no line to render.
 *
 * `formatDate` is the calling surface's own date style — "Mar 3" on the account page, ISO beside
 * the Transactions page's Date column — so the line reads like the row it sits in. The parts are
 * joined only when both exist, which is what keeps a lone `·` off a row with one of them.
 */
export function detailLine(detail: EnrichmentDetail, formatDate: (iso: string) => string): string | null {
  const parts: string[] = [];
  if (detail.authorized !== null) parts.push(`Authorized ${formatDate(detail.authorized)}`);
  if (detail.location !== null) parts.push(detail.location);
  return parts.length === 0 ? null : parts.join(' · ');
}

/**
 * The placeholder tile's letter: the title's first letter or digit, uppercased, or `null` when it
 * has none (the tile is then left empty rather than showing punctuation).
 *
 * One CODE POINT, not one UTF-16 unit, so a title opening with a character outside the BMP is not
 * cut in half. `\p{L}` and `\p{N}` rather than `[A-Za-z0-9]`, so "élan" gets "É" and not "L".
 * The first code point of the UPPERCASED letter, because uppercasing can lengthen one: "ß" is "SS".
 */
export function placeholderInitial(title: string | null | undefined): string | null {
  if (typeof title !== 'string') return null;
  const m = /[\p{L}\p{N}]/u.exec(title);
  return m ? [...m[0].toUpperCase()][0] : null;
}
