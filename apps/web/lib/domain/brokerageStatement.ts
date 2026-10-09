/**
 * The account's value and its date, read from a brokerage statement's text.
 *
 * TWO LAYOUTS, tried in turn, each recognised by its own ending-value line:
 *
 *   E*TRADE (Morgan Stanley's client statement since the merger): "Ending Total Value (as of
 *   9/30/26) $…" on page one. The account's market value with accrued interest, EXCLUDING unvested
 *   stock-plan grants — the statement says those "do not represent assets held in your account",
 *   which is the same line this app draws: a valuation is what the account holds. Its Security
 *   Transfers table also gives the period's shares received; see `transfersIn`.
 *
 *   Wealthfront's monthly statement: "September 30, 2026 Ending Balance $…" on page one. No
 *   shares-received rows — money arrives as cash deposits, which are the owner's own transfers.
 *
 * REFUSES RATHER THAN GUESSES. A statement whose layout has changed is told so, and the owner types
 * the figure instead; a parser that fell back to "the largest dollar amount on page one" would be
 * right until the day it recorded a year-to-date deposit total as the account's value. The same
 * goes for two different ending values in one document — that is not a statement this was written
 * for, and picking one would be a coin toss.
 *
 * Pure: text in, reading out. Extracting the text from a PDF is the route's job.
 */

export interface StatementReading {
  /** Which layout was recognised, shown to the owner beside the figure. */
  institution: 'E*TRADE' | 'Wealthfront';
  /** `YYYY-MM-DD`, the date the value is as of — not the day the PDF was uploaded. */
  asOf: string;
  /** The ending total value, in dollars, as printed. */
  value: number;
  /** The last digits of the account number as printed, for the owner to check; null if absent. */
  accountEnding: string | null;
  /**
   * The portfolio the statement is for, when the layout names one — Wealthfront prints it in every
   * page header. An owner with several accounts at one firm uploads each statement on its own
   * account's page; the name is how they see they picked the right one. Null when not printed.
   */
  portfolio: string | null;
  /** Shares that arrived in the account this period — vests and plan purchases. */
  transfersIn: SharesReceived[];
}

/**
 * One "Transfer into Account" row: shares delivered into the account, valued as printed.
 *
 * This is how a stock-plan vest or an ESPP purchase lands in the brokerage account — the statement
 * does not say which of the two it was, so the owner names it when recording. Transfers OUT and
 * trades are not read: a sale turns shares into cash inside the same account, and cash leaving by
 * transfer is money moving between the owner's own accounts, which the receiving bank's feed sees.
 */
export interface SharesReceived {
  /** `YYYY-MM-DD`. */
  date: string;
  /** As printed, e.g. "ZSCALER, INC". */
  security: string;
  quantity: number;
  /** Value of the shares on arrival, in dollars. */
  amount: number;
}

/** What the upload endpoint replies: the reading, each shares-received row marked as already in the ledger or not. */
export type StatementPreview = Omit<StatementReading, 'transfersIn'> & {
  transfersIn: (SharesReceived & { recorded: boolean })[];
};

export type StatementParse =
  | { ok: true; reading: StatementReading }
  | { ok: false; reason: string };

const ENDING_VALUE =
  /Ending\s+Total\s+Value\s*\(\s*as\s+of\s+(\d{1,2})\/(\d{1,2})\/(\d{2}|\d{4})\s*\)\s*\$\s*([\d,]+\.\d{2})/gi;

/** The account number as the statement prints it, `123-456789-012`. */
const ACCOUNT_NUMBER = /\b\d{3}-\d{6}-(\d{3})\b/;

const MONTH_NAMES = ['january', 'february', 'march', 'april', 'may', 'june', 'july', 'august',
  'september', 'october', 'november', 'december'];

/** Wealthfront: `September 30, 2026 Ending Balance $12,345.67`. */
const WEALTHFRONT_ENDING =
  /\b(January|February|March|April|May|June|July|August|September|October|November|December)\s+(\d{1,2}),\s+(\d{4})\s+Ending\s+Balance\s+\$?\s*([\d,]+\.\d{2})/gi;

/** Wealthfront's page header, `Owner Name | Nasdaq-100 Direct portfolio | September 1 - 30, 2026`. */
const WEALTHFRONT_PORTFOLIO = /\|\s*([^|\n]{1,60}?\bportfolio)\s*\|/i;

/** Wealthfront's account number, `Wealthfront: 8ABC123D`; the last four are shown. */
const WEALTHFRONT_ACCOUNT = /Wealthfront:\s*[A-Z0-9]*([A-Z0-9]{4})\b/;

/**
 * `9/17 Transfer into Account ZSCALER, INC 123.000 $4,567.89` — one row of the Security Transfers
 * table as the extractor lays it out. The year is not printed; see `transfersIn`.
 */
const TRANSFER_IN =
  /^\s*(\d{1,2})\/(\d{1,2})\s+Transfer into Account\s+(.+?)\s+([\d,]+(?:\.\d+)?)\s+\$?([\d,]+\.\d{2})\s*$/gim;

/** A real calendar date as `YYYY-MM-DD`, or null — `2/30/26` is not one. */
function isoDate(month: number, day: number, year: number): string | null {
  const full = year < 100 ? 2000 + year : year;
  const t = new Date(Date.UTC(full, month - 1, day));
  if (t.getUTCFullYear() !== full || t.getUTCMonth() !== month - 1 || t.getUTCDate() !== day) return null;
  return t.toISOString().slice(0, 10);
}

export function parseBrokerageStatement(text: string): StatementParse {
  const etrade = [...text.matchAll(ENDING_VALUE)].map((m) => ({
    asOf: isoDate(Number(m[1]), Number(m[2]), Number(m[3])),
    value: Number(m[4].replace(/,/g, '')),
  }));
  const wealthfront = [...text.matchAll(WEALTHFRONT_ENDING)].map((m) => ({
    asOf: isoDate(MONTH_NAMES.indexOf(m[1].toLowerCase()) + 1, Number(m[2]), Number(m[3])),
    value: Number(m[4].replace(/,/g, '')),
  }));

  // One layout or neither. A document matching both is not a statement either was written for.
  if (etrade.length > 0 && wealthfront.length > 0) {
    return { ok: false, reason: 'The statement matches more than one layout, so it is not clear which value to record.' };
  }
  const readings = etrade.length > 0 ? etrade : wealthfront;
  if (readings.length === 0) {
    return { ok: false, reason: 'No ending value line was found — b8 reads E*TRADE and Wealthfront statements.' };
  }
  const institution = etrade.length > 0 ? 'E*TRADE' as const : 'Wealthfront' as const;

  const [first] = readings;
  if (readings.some((r) => r.asOf !== first.asOf || r.value !== first.value)) {
    return { ok: false, reason: 'The statement states more than one ending value, so it is not clear which to record.' };
  }
  if (first.asOf === null || !Number.isFinite(first.value)) {
    return { ok: false, reason: 'The ending value line could not be read as a date and an amount.' };
  }

  return {
    ok: true,
    reading: {
      institution,
      asOf: first.asOf,
      value: first.value,
      accountEnding: (institution === 'E*TRADE' ? text.match(ACCOUNT_NUMBER) : text.match(WEALTHFRONT_ACCOUNT))?.[1] ?? null,
      portfolio: institution === 'Wealthfront' ? text.match(WEALTHFRONT_PORTFOLIO)?.[1].trim() ?? null : null,
      transfersIn: institution === 'E*TRADE' ? transfersIn(text, first.asOf) : [],
    },
  };
}

/**
 * The period's "Transfer into Account" rows. Rows print `month/day` only, so the year is the
 * statement's — or the year before, for a row whose month falls after the statement's own (a
 * December row on a statement ending in January). A row that is not a real date is dropped.
 */
export function transfersIn(text: string, asOf: string): SharesReceived[] {
  const asOfYear = Number(asOf.slice(0, 4));
  const asOfMonth = Number(asOf.slice(5, 7));
  const rows: SharesReceived[] = [];
  for (const m of text.matchAll(TRANSFER_IN)) {
    const month = Number(m[1]);
    const date = isoDate(month, Number(m[2]), month > asOfMonth ? asOfYear - 1 : asOfYear);
    if (date === null) continue;
    rows.push({
      date,
      security: m[3].trim(),
      quantity: Number(m[4].replace(/,/g, '')),
      amount: Number(m[5].replace(/,/g, '')),
    });
  }
  return rows;
}

/** "ZSCALER, INC" → "Zscaler". The suffix is legal form, not the name anyone uses. */
export function companyName(security: string): string {
  const base = security.replace(/,?\s*(INC|CORP|CORPORATION|CO|LTD|PLC|LLC|HOLDINGS)\.?$/i, '').trim();
  return base.toLowerCase().replace(/\b[a-z]/g, (c) => c.toUpperCase());
}
