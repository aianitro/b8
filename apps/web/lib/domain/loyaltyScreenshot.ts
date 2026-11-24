// Loyalty, reading a screenshot (P8-42d) — the two pure rules the screenshot form and its read route
// need: whether a confirmed reading will become the membership's current balance, and what the
// reading disagrees with. No database, no SDK, no `next`, no clock.
//
// ─── REUSED, NOT RESTATED ─────────────────────────────────────────────────────────────────────
//
// The program check is 42c2's `programCheck`, called as it is, so the mail path and the screenshot
// path can never drift on what "the same program" means. The suffix rule is 42c2's normalisation
// (every character that is not an ASCII letter or digit removed, upper-cased, then an ENDS-WITH test),
// applied to the one membership the read was started from rather than searched across a program:
// the person chose the membership, so the question is only "does the screenshot contradict it".
//
// ─── WARNINGS, NEVER BLOCKS ───────────────────────────────────────────────────────────────────
//
// A `mismatch` here changes a sentence and a button label in the form and nothing else (SPEC.md D2).
// `not_stated` is "could not compare": the screenshot printed nothing, or there is nothing stored to
// compare it with. It is neither a match nor a warning, because a screenshot of an app that shows no
// number is normal and a membership with no stored number cannot contradict anything.

import type { LoyaltyReadProgramCheck, LoyaltyUnit } from '@b8/contracts/loyalty';
import { programCheck, type CleanReading } from './loyaltyRead';

/** Whether a confirmed screenshot reading becomes the current balance, or is recorded behind it. */
export type ScreenshotStanding = 'current' | 'recorded_only';

/**
 * THE STANDING RULE (SPEC.md D8). The shared reducer picks the greatest as-of, then the latest
 * recorded time: so a new row whose as-of is greater than OR EQUAL TO the current one's wins (an equal
 * date loses nothing, because the new row is recorded later), and only a strictly older as-of is
 * recorded without becoming current. With no current balance anything wins.
 *
 * `YYYY-MM-DD` text compared by exact string order, which is calendar order for that shape; no Date
 * is built, so no time zone can move the answer. This restates what the reducer will do, so the form
 * can say it BEFORE the tap; the server enforces nothing extra.
 */
export function screenshotStanding(currentAsOf: string | null, asOf: string): ScreenshotStanding {
  if (currentAsOf === null) return 'current';
  return asOf < currentAsOf ? 'recorded_only' : 'current';
}

/** What the comparison needs about the membership the read was started from. */
export interface ScreenshotCompareInput {
  /** The model's answer after 42c2's clean pass. */
  reading: CleanReading;
  /** The membership's stored member number, or null. Compared here and never returned. */
  memberNumber: string | null;
  /** The membership's program name and its aliases, as stored. */
  programNames: readonly string[];
  /** The unit of the membership's current reading, or null when it has none. */
  currentUnit: LoyaltyUnit | null;
  /** The program's default unit: what a membership with no reading is compared against. */
  defaultUnit: LoyaltyUnit;
}

export interface ScreenshotComparison {
  programCheck: LoyaltyReadProgramCheck;
  suffixCheck: LoyaltyReadProgramCheck;
  unitCheck: LoyaltyReadProgramCheck;
}

/** The stored number in the suffix rule's comparison form: ASCII letters and digits, upper-cased. */
const numberKey = (n: string) => n.replace(/[^A-Za-z0-9]/g, '').toUpperCase();

/**
 * THE THREE COMPARISONS (SPEC.md D9).
 *
 *   programCheck — 42c2's rule over the program's name and aliases.
 *   suffixCheck  — `not_stated` with no kept suffix, or with no stored number (or one that normalises
 *                  to nothing); otherwise `match` exactly when the normalised stored number ends with
 *                  the kept suffix.
 *   unitCheck    — `not_stated` with no balance read (the clean pass keeps a unit only beside a
 *                  balance); otherwise compared with the current reading's unit, or the program's
 *                  default unit when the membership has no reading.
 */
export function compareScreenshot(input: ScreenshotCompareInput): ScreenshotComparison {
  const { reading } = input;
  const stored = input.memberNumber === null ? '' : numberKey(input.memberNumber);
  const suffixCheck: LoyaltyReadProgramCheck =
    reading.suffix === null || stored === '' ? 'not_stated' : stored.endsWith(reading.suffix) ? 'match' : 'mismatch';
  const against = input.currentUnit ?? input.defaultUnit;
  const unitCheck: LoyaltyReadProgramCheck =
    reading.unit === null ? 'not_stated' : reading.unit === against ? 'match' : 'mismatch';
  return { programCheck: programCheck(reading.programName, input.programNames), suffixCheck, unitCheck };
}
