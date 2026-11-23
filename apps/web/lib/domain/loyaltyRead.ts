// Loyalty inbox, reading (P8-42c2) — the pure rules that turn what Claude proposed about one stored
// message into a decision: the clean pass, the kept suffix, the program check, the suffix match,
// the jump rule, the decision order and the wording of each reason. No database, no SDK, no
// `mailparser`, no `next`, no clock: the pipeline (`lib/loyaltyInboxRead.ts`) reads rows, asks these
// functions, and performs what they decided.
//
// ─── THE MODEL ONLY PROPOSES ──────────────────────────────────────────────────────────────────
//
// Mail is attacker-controlled (anyone can mail the inbox and spoof an allowlisted From), and a
// model that read it may have obeyed it. So nothing the reader returns is trusted for its shape or
// its sense: `cleanReading` keeps a field only when it is exactly one of a closed set of forms (an
// enum, a calendar date, canonical decimal text, a 3 or 4 character suffix) and nulls or drops
// everything else, and `decideReading` is the ONLY path from a reading to a balance. No string the
// model wrote survives the clean pass as free text: the program name is reduced to a lower-case
// alphanumeric form that is only ever compared, never stored or shown.
//
// ─── FIGURES ARE TEXT AND EXACT INTEGERS ──────────────────────────────────────────────────────
//
// A balance is normalised by the one shared parser (`parseBalance`, the typed path's), which
// refuses rather than rounds. The jump rule compares in the unit's minor units as BigInt, by
// cross-multiplication with no division, so a boundary sitting exactly on the percentage cannot be
// moved by a binary fraction. Dates are `YYYY-MM-DD` text compared by exact string order, and the
// calendar check below never builds a JS Date.

import {
  LOYALTY_INSTRUMENT_KINDS,
  LOYALTY_READ_EXPIRY_KINDS,
  LOYALTY_READ_EXPIRY_MAX,
  LOYALTY_READ_INSTRUMENT_MAX,
  LOYALTY_READ_JUMP_PERCENT,
  LOYALTY_READ_SUFFIX_MAX,
  LOYALTY_READ_SUFFIX_MIN,
  LOYALTY_UNITS,
  type LoyaltyInstrumentKind,
  type LoyaltyReadExpiryKind,
  type LoyaltyReadProgramCheck,
  type LoyaltyReadReason,
  type LoyaltyUnit,
} from '@b8/contracts/loyalty';
import { parseBalance } from './loyalty';

// ─── The cleaned reading ───────────────────────────────────────────────────────────────────────

export interface CleanExpiryWarning {
  what: LoyaltyReadExpiryKind;
  expiresOn: string;
  /** Canonical decimal text in the scale of `what`, or null (none stated, unparseable, or a kind with no scale). */
  amount: string | null;
}

export interface CleanInstrument {
  kind: LoyaltyInstrumentKind;
  /** Null = the mail stated no expiry, or stated one that is not a calendar date. */
  expiresOn: string | null;
}

/**
 * One reading after the clean pass. `programName` is the CHECK-ONLY form (lower-cased, every
 * non-alphanumeric removed); it decides `program_check` and is then thrown away. `balance` and
 * `unit` are both null or both set.
 */
export interface CleanReading {
  programName: string | null;
  suffix: string | null;
  balance: string | null;
  unit: LoyaltyUnit | null;
  asOf: string | null;
  expiryWarnings: CleanExpiryWarning[];
  instruments: CleanInstrument[];
}

export const EMPTY_CLEAN_READING: CleanReading = {
  programName: null, suffix: null, balance: null, unit: null, asOf: null, expiryWarnings: [], instruments: [],
};

/** The longest program-check form kept; a longer "name" is not a program name. */
const PROGRAM_NAME_MAX = 60;

const isPlainObject = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v);

const isOneOf = <T extends string>(list: readonly T[], v: unknown): v is T =>
  typeof v === 'string' && (list as readonly string[]).includes(v);

/**
 * Whether `text` is a real calendar date written `YYYY-MM-DD`: the shape, a month from 1 to 12 and a
 * day that month has, leap years included (divisible by 4, except centuries not divisible by 400).
 * Small integer arithmetic on the parts; no JS Date is built, so no time zone can move it.
 */
export function isCalendarDate(text: unknown): text is string {
  if (typeof text !== 'string') return false;
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(text);
  if (!m) return false;
  const year = Number(m[1]);
  const month = Number(m[2]);
  const day = Number(m[3]);
  if (year < 1 || month < 1 || month > 12 || day < 1) return false;
  const leap = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
  const days = [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][month - 1];
  return day <= days;
}

/**
 * The kept suffix of a printed member number: every character that is not an ASCII letter or digit
 * dropped first (mask bullets, stars, spaces, dashes), then upper-cased, then at most the LAST four
 * characters. Fewer than three left is "no suffix" (null): two characters match too much to mean
 * anything. A printed full number therefore keeps only its tail, and a long number is never stored.
 */
export function keepSuffix(printed: unknown): string | null {
  if (typeof printed !== 'string') return null;
  const chars = printed.replace(/[^A-Za-z0-9]/g, '').toUpperCase();
  const kept = chars.slice(Math.max(0, chars.length - LOYALTY_READ_SUFFIX_MAX));
  return kept.length >= LOYALTY_READ_SUFFIX_MIN ? kept : null;
}

/**
 * The comparison form of a program name: lower-cased with every non-alphanumeric removed. Null when
 * there is no name, when it holds markup (`<` or `>`, which no program name needs and every
 * injected tag has), or when nothing or too much is left.
 */
export function programNameForm(name: unknown): string | null {
  if (typeof name !== 'string' || /[<>]/.test(name)) return null;
  const form = name.toLowerCase().replace(/[^a-z0-9]/g, '');
  return form === '' || form.length > PROGRAM_NAME_MAX ? null : form;
}

/** A thousands-grouped figure: one to three digits, then groups of exactly three after commas. */
const GROUPED = /^\d{1,3}(?:,\d{3})+(?:\.\d+)?$/;

/**
 * A proposed figure for `unit`, in the one canonical spelling the database stores, or null. Grouping
 * commas are removed only when every group is exactly three digits (so `120,50`, a European decimal,
 * is refused rather than read as twelve thousand); then the shared parser decides, which refuses a
 * sign, an exponent, a fraction on a whole unit, a third decimal on cash and more than 12 digits.
 * Nothing is rounded: a figure that does not fit is no figure.
 */
export function cleanBalance(text: unknown, unit: unknown): string | null {
  if (typeof text !== 'string') return null;
  const plain = GROUPED.test(text) ? text.replace(/,/g, '') : text;
  const parsed = parseBalance(unit, plain);
  return parsed.ok ? parsed.balance : null;
}

/** The expiry kinds that are units, whose amount has a scale. `status` and `other` never carry one. */
const isUnit = (v: unknown): v is LoyaltyUnit => isOneOf(LOYALTY_UNITS, v);

function cleanExpiryWarnings(raw: unknown): CleanExpiryWarning[] {
  if (!Array.isArray(raw)) return [];
  const kept: CleanExpiryWarning[] = [];
  for (const w of raw) {
    if (!isPlainObject(w) || !isOneOf(LOYALTY_READ_EXPIRY_KINDS, w.what) || !isCalendarDate(w.expiresOn)) continue;
    const amount = isUnit(w.what) ? cleanBalance(w.amount, w.what) : null;
    kept.push({ what: w.what, expiresOn: w.expiresOn, amount });
  }
  return kept.slice(0, LOYALTY_READ_EXPIRY_MAX);
}

function cleanInstruments(raw: unknown): CleanInstrument[] {
  if (!Array.isArray(raw)) return [];
  const kept: CleanInstrument[] = [];
  for (const i of raw) {
    if (!isPlainObject(i) || !isOneOf(LOYALTY_INSTRUMENT_KINDS, i.kind)) continue;
    kept.push({ kind: i.kind, expiresOn: isCalendarDate(i.expiresOn) ? i.expiresOn : null });
  }
  return kept.slice(0, LOYALTY_READ_INSTRUMENT_MAX);
}

/**
 * THE CLEAN PASS. Reads only the seven named keys of a plain object, so any key the model added
 * (a name, an address, a full number, a note) is never even looked at; anything that is not a plain
 * object is wholly empty. A balance with no recognised unit, or a unit with no usable balance, leaves
 * both null: the unit belongs to the balance (P8-42a), and a guessed unit can turn miles into points.
 */
export function cleanReading(raw: unknown): CleanReading {
  if (!isPlainObject(raw)) return { ...EMPTY_CLEAN_READING, expiryWarnings: [], instruments: [] };
  const balance = isUnit(raw.unit) ? cleanBalance(raw.balance, raw.unit) : null;
  return {
    programName: programNameForm(raw.programName),
    suffix: keepSuffix(raw.memberNumberSuffix),
    balance,
    unit: balance === null ? null : (raw.unit as LoyaltyUnit),
    asOf: isCalendarDate(raw.asOf) ? raw.asOf : null,
    expiryWarnings: cleanExpiryWarnings(raw.expiryWarnings),
    instruments: cleanInstruments(raw.instruments),
  };
}

// ─── The program check and the suffix match ────────────────────────────────────────────────────

/**
 * The stated program name against the message's program `P` (its name and aliases, as stored):
 * `not_stated` with no usable name; `match` when the stated form equals, contains or is contained by
 * the form of any of P's names; otherwise `mismatch`. The program of a message is ALWAYS its
 * allowlisted sender's; this only decides whether the mail contradicts it.
 */
export function programCheck(statedForm: string | null, programNames: readonly string[]): LoyaltyReadProgramCheck {
  if (statedForm === null) return 'not_stated';
  for (const name of programNames) {
    const form = name.toLowerCase().replace(/[^a-z0-9]/g, '');
    if (form === '') continue;
    if (statedForm === form || statedForm.includes(form) || form.includes(statedForm)) return 'match';
  }
  return 'mismatch';
}

/** A membership as the suffix rule sees it. `number` is the stored member number, never emitted. */
export interface SuffixCandidate {
  id: number;
  programId: number;
  number: string | null;
}

export type SuffixMatch = { kind: 'unique'; membershipId: number } | { kind: 'unmatched' } | { kind: 'ambiguous' };

/**
 * THE SUFFIX RULE. A membership of `programId` matches when its stored number, with every character
 * that is not an ASCII letter or digit removed and upper-cased, ENDS WITH the kept suffix. A
 * membership with no number never matches, and neither does one of another program. Exactly one
 * match is the match; two or more is ambiguous and the first of them is never chosen. The overview's
 * `candidateMembershipIds` applies the same normalisation and the same ending test in SQL
 * (`lib/loyaltyInboxRead.ts`), so the queue offers exactly the memberships this rule counted.
 */
export function matchSuffix(suffix: string, programId: number, memberships: readonly SuffixCandidate[]): SuffixMatch {
  const hits = memberships.filter(
    (m) => m.programId === programId && m.number !== null && m.number.replace(/[^A-Za-z0-9]/g, '').toUpperCase().endsWith(suffix)
  );
  if (hits.length === 1) return { kind: 'unique', membershipId: hits[0].id };
  return hits.length === 0 ? { kind: 'unmatched' } : { kind: 'ambiguous' };
}

// ─── The jump rule ─────────────────────────────────────────────────────────────────────────────

/** A canonical balance in its unit's minor units: whole units as they are, `usd` in cents. */
function minorUnits(balance: string, unit: LoyaltyUnit): bigint {
  if (unit !== 'usd') return BigInt(balance);
  const [whole, fraction = ''] = balance.split('.');
  return BigInt(whole) * BigInt(100) + BigInt(fraction.padEnd(2, '0'));
}

export type JumpVerdict = 'pass' | 'no_baseline' | 'implausible_jump';

/**
 * Whether a candidate may replace the stored balance without a person looking. No stored balance, or
 * a stored zero with a non-zero candidate, is `no_baseline` (a first reading has nothing to compare
 * with, and no percentage of zero exists). Otherwise the absolute difference times 100 STRICTLY
 * greater than the percentage times the stored balance is `implausible_jump`: exactly the percentage
 * passes, one minor unit beyond it does not, in either direction, and a zero against a positive
 * balance is therefore queued. Cross-multiplied in BigInt: no division, no float.
 */
export function jumpVerdict(baseline: string | null, candidate: string, unit: LoyaltyUnit): JumpVerdict {
  if (baseline === null) return 'no_baseline';
  const b = minorUnits(baseline, unit);
  const c = minorUnits(candidate, unit);
  if (b === BigInt(0)) return c === BigInt(0) ? 'pass' : 'no_baseline';
  const diff = c > b ? c - b : b - c;
  return diff * BigInt(100) > BigInt(LOYALTY_READ_JUMP_PERCENT) * b ? 'implausible_jump' : 'pass';
}

// ─── The decision order ────────────────────────────────────────────────────────────────────────

/** A membership's current reading, by the shared newest-wins reduction. */
export interface StoredReading {
  balance: string;
  unit: LoyaltyUnit;
  asOf: string;
}

export interface DecisionInput {
  reading: CleanReading;
  /** The message's program: its allowlisted sender domain's (42c1). */
  programId: number;
  /** That program's name and aliases, as stored. */
  programNames: readonly string[];
  /** That program's default unit: the unit a membership with no reading is compared against. */
  defaultUnit: LoyaltyUnit;
  /** Memberships the suffix rule may look at; another program's never match. */
  memberships: readonly SuffixCandidate[];
  /** Suffixes the household has said are not theirs, for this program. */
  notMine: readonly string[];
  /** The current reading of each membership that has one. */
  current: ReadonlyMap<number, StoredReading>;
  /** `(CURRENT_DATE + 1)::text` from Postgres: the latest as-of accepted, the typed path's slack. */
  latestAsOf: string;
}

export type DecidedState = 'no_balance' | 'pending' | 'not_mine_known' | 'stale' | 'applied';

export interface Decision {
  state: DecidedState;
  /** Set exactly when `state` is `pending`. */
  reason: LoyaltyReadReason | null;
  programCheck: LoyaltyReadProgramCheck;
  /** The single membership the reading belongs to, or null (see the rules below). */
  membershipId: number | null;
}

/**
 * THE DECISION ORDER (SPEC.md Conventions, exact; the first rule that fires decides):
 *
 *   1. no balance            → `no_balance`, never queued; the unique match kept unless a mismatch.
 *   2. program mismatch      → queue `program_mismatch`.
 *   3. no suffix             → queue `no_suffix`; unmatched → `not_mine_known` when listed, else
 *                              queue `unmatched_suffix`; ambiguous → queue `ambiguous_suffix`.
 *   4. unit ≠ the stored reading's (or the program default's with none) → queue `unit_mismatch`.
 *   5. no as-of → queue `no_as_of`; as-of after CURRENT_DATE + 1 → queue `as_of_future`.
 *   6. a stored reading and an as-of NOT STRICTLY NEWER than it → `stale`, never queued.
 *   7. no baseline (none, or a stored zero against a non-zero candidate) → queue `no_baseline`.
 *   8. a jump strictly beyond the percentage → queue `implausible_jump`.
 *   9. otherwise → `applied`.
 *
 * A queued item keeps the membership when exactly one matched (rules 2 and 4 to 8) and null
 * otherwise. A not-mine record is consulted only when NO membership matched, so a membership added
 * later always outranks it.
 */
export function decideReading(input: DecisionInput): Decision {
  const { reading } = input;
  const check = programCheck(reading.programName, input.programNames);
  const match = reading.suffix === null ? null : matchSuffix(reading.suffix, input.programId, input.memberships);
  const unique = match !== null && match.kind === 'unique' ? match.membershipId : null;
  const queue = (reason: LoyaltyReadReason, membershipId: number | null): Decision =>
    ({ state: 'pending', reason, programCheck: check, membershipId });

  // 1.
  if (reading.balance === null || reading.unit === null) {
    return { state: 'no_balance', reason: null, programCheck: check, membershipId: check === 'mismatch' ? null : unique };
  }
  // 2.
  if (check === 'mismatch') return queue('program_mismatch', unique);
  // 3.
  if (reading.suffix === null || match === null) return queue('no_suffix', null);
  if (match.kind === 'ambiguous') return queue('ambiguous_suffix', null);
  if (match.kind === 'unmatched') {
    return input.notMine.includes(reading.suffix)
      ? { state: 'not_mine_known', reason: null, programCheck: check, membershipId: null }
      : queue('unmatched_suffix', null);
  }
  const membershipId = match.membershipId;
  const stored = input.current.get(membershipId) ?? null;
  // 4.
  if (reading.unit !== (stored === null ? input.defaultUnit : stored.unit)) return queue('unit_mismatch', membershipId);
  // 5.
  if (reading.asOf === null) return queue('no_as_of', membershipId);
  if (reading.asOf > input.latestAsOf) return queue('as_of_future', membershipId);
  // 6.
  if (stored !== null && reading.asOf <= stored.asOf) {
    return { state: 'stale', reason: null, programCheck: check, membershipId };
  }
  // 7. and 8.
  const verdict = jumpVerdict(stored === null ? null : stored.balance, reading.balance, reading.unit);
  if (verdict !== 'pass') return queue(verdict, membershipId);
  // 9.
  return { state: 'applied', reason: null, programCheck: check, membershipId };
}
