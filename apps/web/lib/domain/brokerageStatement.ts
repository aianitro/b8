/**
 * The account's value and its date, read from a brokerage statement's text.
 *
 * Written against E*TRADE's client statement (Morgan Stanley's layout since the merger), whose
 * first page states it in one line: "Ending Total Value (as of 9/30/26) $…". That figure is the
 * account's market value with accrued interest, and it EXCLUDES unvested stock-plan grants — the
 * statement's stock plan section says those "do not represent assets held in your account", which
 * is the same line this app draws: a valuation is what the account holds.
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
  /** `YYYY-MM-DD`, the date the value is as of — not the day the PDF was uploaded. */
  asOf: string;
  /** The ending total value, in dollars, as printed. */
  value: number;
  /** The last digits of the account number as printed, for the owner to check; null if absent. */
  accountEnding: string | null;
}

export type StatementParse =
  | { ok: true; reading: StatementReading }
  | { ok: false; reason: string };

const ENDING_VALUE =
  /Ending\s+Total\s+Value\s*\(\s*as\s+of\s+(\d{1,2})\/(\d{1,2})\/(\d{2}|\d{4})\s*\)\s*\$\s*([\d,]+\.\d{2})/gi;

/** The account number as the statement prints it, `123-456789-012`. */
const ACCOUNT_NUMBER = /\b\d{3}-\d{6}-(\d{3})\b/;

/** A real calendar date as `YYYY-MM-DD`, or null — `2/30/26` is not one. */
function isoDate(month: number, day: number, year: number): string | null {
  const full = year < 100 ? 2000 + year : year;
  const t = new Date(Date.UTC(full, month - 1, day));
  if (t.getUTCFullYear() !== full || t.getUTCMonth() !== month - 1 || t.getUTCDate() !== day) return null;
  return t.toISOString().slice(0, 10);
}

export function parseBrokerageStatement(text: string): StatementParse {
  const matches = [...text.matchAll(ENDING_VALUE)];
  if (matches.length === 0) {
    return { ok: false, reason: 'No "Ending Total Value" line was found — this does not look like an E*TRADE client statement.' };
  }

  const readings = matches.map((m) => ({
    asOf: isoDate(Number(m[1]), Number(m[2]), Number(m[3])),
    value: Number(m[4].replace(/,/g, '')),
  }));
  const [first] = readings;
  if (readings.some((r) => r.asOf !== first.asOf || r.value !== first.value)) {
    return { ok: false, reason: 'The statement states more than one ending value, so it is not clear which to record.' };
  }
  if (first.asOf === null || !Number.isFinite(first.value)) {
    return { ok: false, reason: 'The ending value line could not be read as a date and an amount.' };
  }

  return {
    ok: true,
    reading: { asOf: first.asOf, value: first.value, accountEnding: text.match(ACCOUNT_NUMBER)?.[1] ?? null },
  };
}
