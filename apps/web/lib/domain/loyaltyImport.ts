// Loyalty import (P8-42a) — the pure half of the one-time spreadsheet import: reading the CSV as the
// owner exports it, reading a balance cell, and planning every row against what the database
// already holds. No database access, no file access, no clock: `scripts/import-loyalty.ts` reads
// the file and the state, calls these, prints the counts and performs the writes they decided.
//
// ─── THE SHEET IS READ AS IT IS ───────────────────────────────────────────────────────────────
//
// The owner will not reshape the sheet (SPEC.md Non-goals). It has an unnamed first column holding
// a row label — a program name, optionally followed by a household member's first name — and
// columns named loosely (`Balance`, ` annual fee `, `annual  bonus availability`). So headers are
// matched after trimming, case-folding and collapsing whitespace, a byte-order mark is ignored, and
// the label is resolved by data (members' names, programs' aliases), never by guessing.
//
// ─── EXACT OR REFUSED ─────────────────────────────────────────────────────────────────────────
//
// A label resolves by exact string equality after `normalizeLabel`, or the row is refused. No
// prefix, substring, edit-distance or "closest" match, and no retry of a label with its member
// suffix taken off: a near match is a silent mis-attribution of someone's balance, while a refusal
// is a row number the owner fixes by adding an alias. Every row is classified independently, so one
// run reports every refused row rather than only the first.
//
// ─── NOTHING PRINTABLE LEAVES THE PLAN EXCEPT COUNTS AND ROW NUMBERS ──────────────────────────
//
// The plan carries counts, row numbers and the values to write. The script prints only the first
// two. The annual-fee column is recognised so it can never be mistaken for another column, and its
// cells are never read: `parseImportCsv` does not even copy them into a row.

import type { LoyaltyUnit } from '@b8/contracts/loyalty';
import { normalizeLabel, parseBalance } from './loyalty';

// ─── The CSV ───────────────────────────────────────────────────────────────────────────────────

/** One non-blank data row, with the cells the import reads. The fee cell is deliberately absent. */
export interface ImportRow {
  /** 1-based position after the header, counting blank rows, so it matches the sheet's numbering. */
  rowNumber: number;
  label: string;
  balance: string;
  bonus: string;
  availability: string;
  account: string;
}

export type CsvParse =
  | { ok: true; rows: ImportRow[] }
  | { ok: false; reason: 'malformed' | 'label-header' | 'missing-balance' | 'duplicate-header' };

/** The recognised headers, in their normalised form. `annual fee` is recognised and never read. */
const HEADERS = {
  balance: 'balance',
  fee: 'annual fee',
  bonus: 'annual bonus',
  availability: 'annual bonus availability',
  account: 'account #',
} as const;

const normalizeHeader = (cell: string) => cell.trim().toLowerCase().replace(/\s+/gu, ' ');

/**
 * RFC 4180 records: quoted cells may hold commas, line breaks and doubled quotes; CRLF and LF both
 * end a record. Returns null for an unterminated quote, which is a malformed file rather than a cell
 * that silently swallows the rest of the sheet.
 */
function parseRecords(text: string): string[][] | null {
  const records: string[][] = [];
  let record: string[] = [];
  let cell = '';
  let quoted = false;
  let started = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (quoted) {
      if (ch === '"') {
        if (text[i + 1] === '"') { cell += '"'; i++; } else quoted = false;
      } else cell += ch;
      continue;
    }
    started = true;
    if (ch === '"') quoted = true;
    else if (ch === ',') { record.push(cell); cell = ''; }
    else if (ch === '\r' && text[i + 1] === '\n') { /* the \n ends the record */ }
    else if (ch === '\n' || ch === '\r') { record.push(cell); records.push(record); record = []; cell = ''; started = false; }
    else cell += ch;
  }
  if (quoted) return null;
  if (started || cell !== '' || record.length > 0) { record.push(cell); records.push(record); }
  return records;
}

/**
 * The sheet's rows, by its header. File-level refusals — a first column with a non-empty header, no
 * `balance` column, a recognised header twice, an unterminated quote — refuse the whole file, and
 * the reason carries no cell text. Other columns are ignored; an absent optional column reads as
 * empty on every row. A fully blank row is skipped and not returned, but still takes its row number.
 */
export function parseImportCsv(text: string): CsvParse {
  const records = parseRecords(text.replace(/^﻿/, ''));
  if (records === null || records.length === 0) return { ok: false, reason: 'malformed' };
  const header = records[0].map(normalizeHeader);
  if (header[0] !== '') return { ok: false, reason: 'label-header' };
  const column: Partial<Record<keyof typeof HEADERS, number>> = {};
  for (const [key, name] of Object.entries(HEADERS) as [keyof typeof HEADERS, string][]) {
    const at = header.flatMap((h, i) => (h === name ? [i] : []));
    if (at.length > 1) return { ok: false, reason: 'duplicate-header' };
    if (at.length === 1) column[key] = at[0];
  }
  if (column.balance === undefined) return { ok: false, reason: 'missing-balance' };
  const cell = (record: string[], at: number | undefined) => (at === undefined ? '' : record[at] ?? '');

  const rows: ImportRow[] = [];
  records.slice(1).forEach((record, index) => {
    if (record.every((c) => c.trim() === '')) return;
    rows.push({
      rowNumber: index + 1,
      label: cell(record, 0),
      balance: cell(record, column.balance),
      bonus: cell(record, column.bonus),
      availability: cell(record, column.availability),
      account: cell(record, column.account),
    });
  });
  return { ok: true, rows };
}

// ─── A balance cell ────────────────────────────────────────────────────────────────────────────

export type ImportBalance =
  | { kind: 'empty' }
  | { kind: 'value'; unit: LoyaltyUnit; balance: string }
  | { kind: 'invalid' };

/**
 * The import's balance rule, which is the API's rule plus two allowances and nothing else:
 *
 *   * an empty or `-` cell is NO observation — never a zero one;
 *   * a leading `$` makes the unit `usd` whatever the program's default unit, and is removed;
 *   * thousands separators are removed only when every group before the decimal point is three
 *     digits after a first group of one to three; a group of two, a leading comma, a group of four
 *     and Indian-style grouping are all refused.
 *
 * What remains must pass the API rule for the unit unchanged, so a fraction on a whole unit and a
 * third decimal on cash are refused rather than rounded.
 */
export function parseImportBalance(cell: string, defaultUnit: LoyaltyUnit): ImportBalance {
  const trimmed = cell.trim();
  if (trimmed === '' || trimmed === '-') return { kind: 'empty' };
  const usd = trimmed.startsWith('$');
  let text = usd ? trimmed.slice(1) : trimmed;
  if (text.includes(',')) {
    const grouped = /^(\d{1,3}(?:,\d{3})+)(\.\d*)?$/.exec(text);
    if (!grouped) return { kind: 'invalid' };
    text = grouped[1].replace(/,/g, '') + (grouped[2] ?? '');
  }
  const parsed = parseBalance(usd ? 'usd' : defaultUnit, text);
  return parsed.ok ? { kind: 'value', unit: parsed.unit, balance: parsed.balance } : { kind: 'invalid' };
}

// ─── The plan ──────────────────────────────────────────────────────────────────────────────────

/** Availability values that mean "issued and not yet used" (the owner's rule, SPEC.md Q3). */
const AVAILABLE = new Set(['yes', 'available', 'issued', 'unused']);

/** An instrument description is at most this many characters (the column's CHECK). */
const DESCRIPTION_MAX = 200;
/** A member number is at most this many characters (the column's CHECK). */
const MEMBER_NUMBER_MAX = 64;

/** What the database holds that the plan needs. Read by the script; fabricated by the tests. */
export interface ImportState {
  members: { id: number; displayName: string }[];
  programs: { id: number; defaultUnit: LoyaltyUnit }[];
  aliases: { programId: number; alias: string }[];
  memberships: { id: number; memberId: number; programId: number }[];
  /** Observations with source `import` only: the idempotence and conflict checks are about them. */
  importObservations: { membershipId: number; asOf: string; balance: string; unit: LoyaltyUnit }[];
  /** Membership ids that already hold an instrument with source `import`. */
  importInstrumentMemberships: number[];
}

export interface ImportOptions {
  /** `YYYY-MM-DD`, from the required `--as-of`. The plan never reads a clock. */
  asOf: string;
  /** The raw `--default-member` value, or undefined when it was not given. */
  defaultMember?: string;
}

export interface ImportCounts {
  rows: number;
  memberships_created: number;
  memberships_existing: number;
  observations_created: number;
  observations_existing: number;
  observations_skipped_empty: number;
  instruments_created: number;
  instruments_existing: number;
  bonus_unplaced: number;
  refused_program: number;
  refused_member: number;
  refused_value: number;
  refused_duplicate: number;
  conflicts: number;
}

export type RefusalKind = 'program' | 'member' | 'value' | 'duplicate' | 'conflict';

/** One row's writes. `membershipId` null means the membership is created first. */
export interface PlannedWrite {
  rowNumber: number;
  memberId: number;
  programId: number;
  membershipId: number | null;
  memberNumber: string | null;
  observation: { balance: string; unit: LoyaltyUnit } | null;
  instrument: { description: string } | null;
}

export interface ImportPlan {
  counts: ImportCounts;
  refusedRows: Record<RefusalKind, number[]>;
  /** Empty whenever anything is refused: the import is all-or-nothing. */
  writes: PlannedWrite[];
}

/** The printed order of the count lines, after `mode`. */
export const COUNT_KEYS: (keyof ImportCounts)[] = [
  'rows', 'memberships_created', 'memberships_existing', 'observations_created', 'observations_existing',
  'observations_skipped_empty', 'instruments_created', 'instruments_existing', 'bonus_unplaced',
  'refused_program', 'refused_member', 'refused_value', 'refused_duplicate', 'conflicts',
];
/** The printed order of the row-number lines, after the counts. */
export const REFUSAL_KINDS: RefusalKind[] = ['program', 'member', 'value', 'duplicate', 'conflict'];

/** Whether `name` is the normalised label's final word or words, as a whole-word suffix. */
const endsWithWords = (label: string, name: string) => label === name || label.endsWith(` ${name}`);

/**
 * Resolves every row and decides what an `--apply` would write, refusing what it cannot resolve
 * exactly. Per row, in this order, and each row lands in at most one refusal:
 *
 *   1. member — the label's whole-word suffix equal to exactly one member's normalised name; two or
 *      more is ambiguous and refused; none falls back to `--default-member`, which must name a
 *      member by its whole display name (trimmed, case-insensitive) or the row is refused;
 *   2. program — the rest of the label equal to exactly one program's alias. An empty rest (the
 *      label was only a member's name) is refused, and so is more than one program;
 *   3. duplicate — a (member, program) pair an EARLIER row already resolved to; the first
 *      occurrence stands and every later one is refused;
 *   4. value — a balance the import rule refuses, a member number over the column's bound, a bonus
 *      that would become an instrument but is over the description's bound;
 *   5. conflict — an imported reading already stored for that membership and day with a different
 *      balance. The same balance is "existing", which is what makes a second run a no-op.
 *
 * Existing memberships are counted, never updated: their tier and number stay as they are.
 */
export function planImport(rows: readonly ImportRow[], state: ImportState, options: ImportOptions): ImportPlan {
  const counts: ImportCounts = {
    rows: rows.length, memberships_created: 0, memberships_existing: 0, observations_created: 0,
    observations_existing: 0, observations_skipped_empty: 0, instruments_created: 0, instruments_existing: 0,
    bonus_unplaced: 0, refused_program: 0, refused_member: 0, refused_value: 0, refused_duplicate: 0, conflicts: 0,
  };
  const refusedRows: Record<RefusalKind, number[]> = { program: [], member: [], value: [], duplicate: [], conflict: [] };
  const writes: PlannedWrite[] = [];

  const memberNames = state.members.flatMap((m) => {
    const name = normalizeLabel(m.displayName);
    return name === null ? [] : [{ id: m.id, name }];
  });
  const wanted = options.defaultMember?.trim().toLowerCase();
  const defaults = wanted === undefined || wanted === ''
    ? []
    : state.members.filter((m) => m.displayName.trim().toLowerCase() === wanted);
  const defaultMember = defaults.length === 1 ? defaults[0].id : null;
  const unitOf = new Map(state.programs.map((p) => [p.id, p.defaultUnit]));
  const membershipOf = new Map(state.memberships.map((m) => [`${m.memberId}:${m.programId}`, m.id]));
  const importedOn = new Map(
    state.importObservations.filter((o) => o.asOf === options.asOf).map((o) => [o.membershipId, o])
  );
  const holdsInstrument = new Set(state.importInstrumentMemberships);
  const seen = new Set<string>();

  const refuse = (kind: RefusalKind, row: ImportRow) => {
    refusedRows[kind].push(row.rowNumber);
    if (kind === 'conflict') counts.conflicts++;
    else counts[`refused_${kind}` as const]++;
  };

  for (const row of rows) {
    const label = normalizeLabel(row.label);
    if (label === null) { refuse('program', row); continue; }

    // 1. Member.
    const suffixes = memberNames.filter((m) => endsWithWords(label, m.name));
    let memberId: number;
    let programLabel: string;
    if (suffixes.length > 1) { refuse('member', row); continue; }
    if (suffixes.length === 1) {
      memberId = suffixes[0].id;
      programLabel = label.slice(0, label.length - suffixes[0].name.length).trim();
    } else {
      if (defaultMember === null) { refuse('member', row); continue; }
      memberId = defaultMember;
      programLabel = label;
    }

    // 2. Program, by exact alias equality only.
    const programs = new Set(state.aliases.filter((a) => a.alias === programLabel).map((a) => a.programId));
    if (programLabel === '' || programs.size !== 1) { refuse('program', row); continue; }
    const programId = [...programs][0];
    const defaultUnit = unitOf.get(programId);
    if (defaultUnit === undefined) { refuse('program', row); continue; }

    // 3. Duplicate pair within the file.
    const pair = `${memberId}:${programId}`;
    if (seen.has(pair)) { refuse('duplicate', row); continue; }
    seen.add(pair);

    // 4. Values.
    const balance = parseImportBalance(row.balance, defaultUnit);
    const account = row.account.trim();
    const memberNumber = account === '' || account === '-' ? null : account;
    const bonus = row.bonus.trim();
    const hasBonus = bonus !== '' && bonus !== '-';
    const available = hasBonus && AVAILABLE.has(row.availability.trim().toLowerCase());
    if (
      balance.kind === 'invalid'
      || (memberNumber !== null && Array.from(memberNumber).length > MEMBER_NUMBER_MAX)
      || (available && Array.from(bonus).length > DESCRIPTION_MAX)
    ) { refuse('value', row); continue; }

    // 5. Against what is stored.
    const membershipId = membershipOf.get(pair) ?? null;
    const prior = membershipId === null ? undefined : importedOn.get(membershipId);
    if (balance.kind === 'value' && prior !== undefined && (prior.balance !== balance.balance || prior.unit !== balance.unit)) {
      refuse('conflict', row);
      continue;
    }

    if (membershipId === null) counts.memberships_created++; else counts.memberships_existing++;
    let observation: PlannedWrite['observation'] = null;
    if (balance.kind === 'empty') counts.observations_skipped_empty++;
    else if (prior !== undefined) counts.observations_existing++;
    else { counts.observations_created++; observation = { balance: balance.balance, unit: balance.unit }; }
    let instrument: PlannedWrite['instrument'] = null;
    if (available) {
      if (membershipId !== null && holdsInstrument.has(membershipId)) counts.instruments_existing++;
      else { counts.instruments_created++; instrument = { description: bonus }; }
    } else if (hasBonus) counts.bonus_unplaced++;

    writes.push({ rowNumber: row.rowNumber, memberId, programId, membershipId, memberNumber, observation, instrument });
  }

  const refused = REFUSAL_KINDS.some((k) => refusedRows[k].length > 0);
  if (refused) {
    // All-or-nothing: a refused row means nothing is written, so nothing "would be created".
    counts.memberships_created = 0;
    counts.observations_created = 0;
    counts.instruments_created = 0;
  }
  return { counts, refusedRows, writes: refused ? [] : writes };
}

/**
 * The 20 output lines: the mode, the 14 counts, the 5 row-number lists. Digits, commas and fixed
 * words only — every line matches `^[a-z_]+=([0-9]+(,[0-9]+)*|dry-run|apply)?$`.
 */
export function planLines(plan: ImportPlan, apply: boolean): string[] {
  return [
    `mode=${apply ? 'apply' : 'dry-run'}`,
    ...COUNT_KEYS.map((k) => `${k}=${plan.counts[k]}`),
    ...REFUSAL_KINDS.map((k) => `refused_rows_${k}=${plan.refusedRows[k].join(',')}`),
  ];
}
