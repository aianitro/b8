// P8-42a — the pure half of the loyalty import (U6, U10): reading the sheet as the owner keeps it,
// reading a balance cell, normalising labels, and planning rows against fabricated state. No
// database: `scripts/import-loyalty.test.ts` runs the same rules through the script against Postgres.
//
// Every label, member, program, bonus and account below is fabricated and carries `ZQ42A`; the
// figures are fabricated too and are nobody's balance.

import { describe, expect, it } from 'vitest';
import { normalizeLabel } from './domain/loyalty';
import {
  parseImportBalance,
  parseImportCsv,
  planImport,
  planLines,
  type ImportRow,
  type ImportState,
} from './domain/loyaltyImport';


/** A row with defaults for the cells a case does not care about. */
const row = (rowNumber: number, label: string, cells: Partial<Omit<ImportRow, 'rowNumber' | 'label'>> = {}): ImportRow => ({
  rowNumber, label, balance: '', bonus: '', availability: '', account: '', ...cells,
});

// The fixture's household and catalog, as `scripts/fixtures/loyalty-import.seed.sql` seeds them.
const ANNA = 1, BOB = 2, CARL = 3;
const SKY = 11, STAY = 12, CARD = 13, TRIP = 14, CAR = 15, WING = 16;
const STATE: ImportState = {
  members: [{ id: ANNA, displayName: 'ZQ42AAnna' }, { id: BOB, displayName: 'ZQ42ABob' }, { id: CARL, displayName: 'ZQ42ACarl' }],
  programs: [
    { id: SKY, defaultUnit: 'miles' }, { id: STAY, defaultUnit: 'points' }, { id: CARD, defaultUnit: 'points' },
    { id: TRIP, defaultUnit: 'usd' }, { id: CAR, defaultUnit: 'points' }, { id: WING, defaultUnit: 'miles' },
  ],
  aliases: [
    [SKY, 'zq42a skybrand'], [SKY, 'zq42a skybrand airlines'], [SKY, 'zq42a skybrand air'],
    [STAY, 'zq42a stayco'], [STAY, 'zq42a stayco hotels'], [STAY, 'zq42a stayco rewards'],
    [CARD, 'zq42a cardpay points'], [CARD, 'zq42a cardpay'],
    [TRIP, 'zq42a tripcash'],
    [CAR, 'zq42a carbrand rewards'], [CAR, 'zq42a carbrand'],
    [WING, 'zq42a wingline'], [WING, 'zq42a wingline airways'],
  ].map(([programId, alias]) => ({ programId: programId as number, alias: alias as string })),
  memberships: [],
  importObservations: [],
  importInstrumentMemberships: [],
};

/** The good fixture's twelve rows, as the CSV holds them (the fee column is not part of a row). */
const GOOD: ImportRow[] = [
  row(1, '✈ ZQ42A Skybrand airlines ZQ42AAnna', { balance: '16,488', bonus: '-', availability: '-', account: 'ZQ42A-A-0001' }),
  row(2, 'ZQ42A Skybrand zq42abob', { balance: '31207', account: 'ZQ42A-B-0002' }),
  row(3, '✈ ZQ42A Wingline Airways (ZQ42A Wingline, zq42a.example) ZQ42ACARL', { bonus: '-', availability: '-', account: 'ZQ42A-C-0003' }),
  row(4, 'ZQ42A Stayco Hotels ZQ42AAnna', { balance: '55012', bonus: 'ZQ42A 1 night', availability: 'yes', account: 'ZQ42A-A-0004' }),
  row(5, '🏨 ZQ42A Stayco ZQ42Abob', { bonus: 'ZQ42A 1 night', availability: 'no', account: 'ZQ42A-B-0005' }),
  row(6, 'ZQ42A Cardpay Points', { balance: '90210', bonus: 'ZQ42A 5000 points', availability: 'Yes', account: 'ZQ42A-A-0006' }),
  row(7, 'ZQ42A Cardpay ZQ42Acarl', { bonus: 'ZQ42A 5000 points', account: 'ZQ42A-C-0007' }),
  row(8, 'ZQ42A Tripcash ZQ42AAnna', { balance: '$48.17', bonus: '-', availability: '-' }),
  row(9, 'ZQ42A Tripcash ZQ42Abob', { balance: '$2,031.50', bonus: '-', availability: '-', account: 'ZQ42A-B-0009' }),
  row(10, '🚗 ZQ42A Carbrand Rewards ZQ42AAnna', { balance: '7733', bonus: '-', availability: '-' }),
  row(11, 'ZQ42A Carbrand ZQ42Abob', { bonus: 'ZQ42A 1 companion ticket', availability: 'yes', account: 'ZQ42A-B-0011' }),
  row(12, 'ZQ42A Wingline ZQ42AAnna', { balance: '-', bonus: '-', availability: '-', account: 'ZQ42A-A-0012' }),
];
const AS_OF_TEST = '2026-01-15';
const OPTIONS = { asOf: AS_OF_TEST, defaultMember: 'zq42aanna' };

describe('the sheet and its cells', () => {
  it('T42a-U6: headers are matched loosely and checked strictly; a balance cell is read by the import rule; the fee is never read; availability maps a bonus; blank rows keep their numbers', () => {
    // A byte-order mark, CRLF, a quoted comma and an escaped quote, loose headers, an unknown
    // column, a different column order.
    const csv = '﻿,  Annual   Bonus ,Notes,BALANCE,Account #,annual bonus availability, Annual Fee\r\n'
      + '"ZQ42A Stayco, ""the"" ZQ42AAnna",ZQ42A 1 night,ZQ42A ignored,"16,488",ZQ42A-1,YES,$abc\r\n'
      + '\r\n'
      + ',,,,,,\r\n'
      + 'ZQ42A Tripcash ZQ42ABob,-,,$48.17,-,-,-\r\n';
    const parsed = parseImportCsv(csv);
    expect(parsed).toEqual({
      ok: true,
      rows: [
        { rowNumber: 1, label: 'ZQ42A Stayco, "the" ZQ42AAnna', balance: '16,488', bonus: 'ZQ42A 1 night', availability: 'YES', account: 'ZQ42A-1' },
        // Rows 2 and 3 are blank: skipped, not counted, and row 4 keeps its number.
        { rowNumber: 4, label: 'ZQ42A Tripcash ZQ42ABob', balance: '$48.17', bonus: '-', availability: '-', account: '-' },
      ],
    });
    // The fee cell is not in a row at all.
    expect(JSON.stringify(parsed)).not.toContain('$abc');
    // An optional header absent: its cells read as empty.
    const noBonus = parseImportCsv(',Balance\nZQ42A Tripcash ZQ42ABob,5\n');
    expect(noBonus).toEqual({ ok: true, rows: [{ rowNumber: 1, label: 'ZQ42A Tripcash ZQ42ABob', balance: '5', bonus: '', availability: '', account: '' }] });
    // File-level refusals.
    expect(parseImportCsv(',Annual Bonus\nZQ42A x,y\n')).toEqual({ ok: false, reason: 'missing-balance' });
    expect(parseImportCsv(',Balance, balance \nZQ42A x,1,2\n')).toEqual({ ok: false, reason: 'duplicate-header' });
    expect(parseImportCsv('Program,Balance\nZQ42A x,1\n')).toEqual({ ok: false, reason: 'label-header' });
    expect(parseImportCsv(',Balance\n"ZQ42A x,1\n')).toEqual({ ok: false, reason: 'malformed' });

    // Balance cells.
    expect(parseImportBalance('', 'points')).toEqual({ kind: 'empty' });
    expect(parseImportBalance('  -  ', 'points')).toEqual({ kind: 'empty' });
    expect(parseImportBalance('$48.17', 'points')).toEqual({ kind: 'value', unit: 'usd', balance: '48.17' });
    expect(parseImportBalance('16,488', 'miles')).toEqual({ kind: 'value', unit: 'miles', balance: '16488' });
    expect(parseImportBalance('$2,031.50', 'points')).toEqual({ kind: 'value', unit: 'usd', balance: '2031.50' });
    expect(parseImportBalance('$2,031.5', 'points')).toEqual({ kind: 'value', unit: 'usd', balance: '2031.50' });
    expect(parseImportBalance('1,234,567', 'points')).toEqual({ kind: 'value', unit: 'points', balance: '1234567' });
    expect(parseImportBalance('0', 'points')).toEqual({ kind: 'value', unit: 'points', balance: '0' });
    for (const bad of ['1,23', ',500', '1,5000', '12,34,567', '$', '-5', '31207.5', '$48.175', '1.0', 'abc', '$-1', '1e3']) {
      expect(parseImportBalance(bad, 'points'), bad).toEqual({ kind: 'invalid' });
    }
    // A plain cell takes the default unit; a dollar cell on a miles program is still usd.
    expect(parseImportBalance('7733', 'points')).toEqual({ kind: 'value', unit: 'points', balance: '7733' });
    expect(parseImportBalance('$12', 'miles')).toEqual({ kind: 'value', unit: 'usd', balance: '12.00' });
    expect(parseImportBalance('12', 'usd')).toEqual({ kind: 'value', unit: 'usd', balance: '12.00' });

    // Availability and bonus, through the plan: one program per row so nothing is a duplicate.
    const labels = ['ZQ42A Skybrand', 'ZQ42A Stayco', 'ZQ42A Cardpay', 'ZQ42A Tripcash', 'ZQ42A Carbrand', 'ZQ42A Wingline'];
    const members = ['ZQ42AAnna', 'ZQ42ABob', 'ZQ42ACarl'];
    const pairs = members.flatMap((m) => labels.map((l) => `${l} ${m}`));
    const placed = ['yes', 'Yes', ' YES ', 'available', 'issued', 'unused'];
    const unplaced = ['no', '-', '', 'used', 'expired', 'maybe'];
    const bonusRows = [
      ...placed.map((a, i) => row(i + 1, pairs[i], { bonus: 'ZQ42A bonus', availability: a })),
      ...unplaced.map((a, i) => row(i + 7, pairs[i + 6], { bonus: 'ZQ42A bonus', availability: a })),
      row(13, pairs[12], { bonus: '-', availability: 'yes' }),
      row(14, pairs[13], { bonus: '', availability: 'yes' }),
      // A malformed fee is not even a cell of the row, so it can refuse nothing.
      row(15, pairs[14], { balance: '5' }),
    ];
    const plan = planImport(bonusRows, STATE, OPTIONS);
    expect(plan.counts).toMatchObject({ rows: 15, instruments_created: 6, bonus_unplaced: 6, refused_value: 0, refused_program: 0 });
    expect(plan.writes.filter((w) => w.instrument).map((w) => w.rowNumber)).toEqual([1, 2, 3, 4, 5, 6]);
    expect(plan.writes.find((w) => w.rowNumber === 1)?.instrument).toEqual({ description: 'ZQ42A bonus' });
    // A 201-character bonus that would become an instrument refuses its row as a value.
    const long = planImport([row(1, pairs[0], { bonus: `ZQ42A${'x'.repeat(196)}`, availability: 'yes' })], STATE, OPTIONS);
    expect(long.refusedRows.value).toEqual([1]);
    const exact = planImport([row(1, pairs[0], { bonus: `ZQ42A${'x'.repeat(195)}`, availability: 'yes' })], STATE, OPTIONS);
    expect(exact.counts.instruments_created).toBe(1);

    // Account numbers: trimmed; empty and a dash are no number.
    const accounts = planImport([
      row(1, pairs[0], { account: '  ZQ42A-A-1  ' }), row(2, pairs[1], { account: '-' }), row(3, pairs[2], { account: '  ' }),
    ], STATE, OPTIONS);
    expect(accounts.writes.map((w) => w.memberNumber)).toEqual(['ZQ42A-A-1', null, null]);
  });
});

describe('labels and their resolution', () => {
  it('T42a-U10: normalisation is ordered and idempotent; members resolve by whole-word suffix, programs by exact alias; defaults, ambiguity, duplicates and refusals are exact', () => {
    // Normalisation.
    expect(normalizeLabel('✈️ ZQ42A Skybrand')).toBe('zq42a skybrand');
    expect(normalizeLabel('🏨 ZQ42A Stayco')).toBe('zq42a stayco');
    expect(normalizeLabel('🚗ZQ42A Carbrand')).toBe('zq42a carbrand');
    expect(normalizeLabel('* ZQ42A Skybrand')).toBe('zq42a skybrand');
    expect(normalizeLabel('- ZQ42A Skybrand')).toBe('zq42a skybrand');
    expect(normalizeLabel('ZQ42A Brand (ZQ42A Brand, zq42a.example)')).toBe('zq42a brand');
    expect(normalizeLabel('ZQ42A Brand (unclosed')).toBe('zq42a brand (unclosed');
    expect(normalizeLabel(' ZQ42A\tBRAND  Air  ')).toBe('zq42a brand air');
    expect(normalizeLabel('')).toBeNull();
    expect(normalizeLabel(' \u2708 - * ')).toBeNull();
    // The leading-symbol rule runs first, so a label that STARTS with a group loses only its opening
    // parenthesis, not the group: the rule's order, applied as stated.
    expect(normalizeLabel('(ZQ42A) x')).toBe('zq42a) x');
    for (const s of ['✈ ZQ42A Wingline Airways (ZQ42A Wingline, zq42a.example) ZQ42ACARL', 'ZQ42A x) (y', '  -*ZQ42A  A (b) c ', 'zq42a skybrand']) {
      const once = normalizeLabel(s) as string;
      expect(normalizeLabel(once)).toBe(once);
    }

    // The good table resolves to the fixture's members and programs.
    const good = planImport(GOOD, STATE, OPTIONS);
    expect(good.writes.map((w) => [w.rowNumber, w.memberId, w.programId])).toEqual([
      [1, ANNA, SKY], [2, BOB, SKY], [3, CARL, WING], [4, ANNA, STAY], [5, BOB, STAY], [6, ANNA, CARD],
      [7, CARL, CARD], [8, ANNA, TRIP], [9, BOB, TRIP], [10, ANNA, CAR], [11, BOB, CAR], [12, ANNA, WING],
    ]);
    expect(good.counts).toEqual({
      rows: 12, memberships_created: 12, memberships_existing: 0, observations_created: 7, observations_existing: 0,
      observations_skipped_empty: 5, instruments_created: 3, instruments_existing: 0, bonus_unplaced: 2,
      refused_program: 0, refused_member: 0, refused_value: 0, refused_duplicate: 0, conflicts: 0,
    });
    expect(good.writes.filter((w) => w.observation).map((w) => [w.rowNumber, w.observation?.unit, w.observation?.balance])).toEqual([
      [1, 'miles', '16488'], [2, 'miles', '31207'], [4, 'points', '55012'], [6, 'points', '90210'],
      [8, 'usd', '48.17'], [9, 'usd', '2031.50'], [10, 'points', '7733'],
    ]);
    const lines = planLines(good, false);
    expect(lines).toHaveLength(20);
    for (const l of lines) expect(l).toMatch(/^[a-z_]+=([0-9]+(,[0-9]+)*|dry-run|apply)?$/);

    // A member suffix in any case.
    for (const suffix of ['zq42aanna', 'ZQ42AANNA', 'ZQ42AAnna']) {
      expect(planImport([row(1, `ZQ42A Skybrand ${suffix}`)], STATE, { asOf: AS_OF_TEST }).writes[0]?.memberId).toBe(ANNA);
    }
    // No suffix: the default member, and only when it names someone; then exactly that row refuses.
    expect(planImport([row(1, 'ZQ42A Cardpay Points')], STATE, { asOf: '2026-01-15', defaultMember: '  ZQ42AANNA ' }).writes[0]?.memberId).toBe(ANNA);
    for (const dm of [undefined, 'ZQ42Anobody', 'ZQ42AAnn', '']) {
      const p = planImport(GOOD, STATE, { asOf: '2026-01-15', defaultMember: dm });
      expect(p.refusedRows).toEqual({ program: [], member: [6], value: [], duplicate: [], conflict: [] });
      expect(p.counts).toMatchObject({ refused_member: 1, memberships_created: 0, observations_created: 0, instruments_created: 0 });
      expect(p.writes).toEqual([]);
    }
    // A label that is only a member's name: a program refusal.
    expect(planImport([row(1, 'ZQ42AAnna')], STATE, OPTIONS).refusedRows.program).toEqual([1]);
    // Two members whose names are both whole-word suffixes: ambiguous, a member refusal. (With
    // `ZQ42AAnna` and `Anna`, the label `… ZQ42AAnna` names only the first: a suffix is whole words.)
    const twoAnnas: ImportState = { ...STATE, members: [...STATE.members, { id: 7, displayName: 'Anna' }, { id: 8, displayName: 'ZQ42AX Anna' }] };
    expect(planImport([row(1, 'ZQ42A Stayco ZQ42AAnna')], twoAnnas, OPTIONS).writes[0]?.memberId).toBe(ANNA);
    expect(planImport([row(1, 'ZQ42A Stayco ZQ42AX Anna')], twoAnnas, OPTIONS).refusedRows.member).toEqual([1]);
    // No prefix, substring or near match.
    for (const label of ['ZQ42A Skybrandz zq42abob', 'ZQ42A Skybrand airways ZQ42Abob', 'ZQ42A Skybran ZQ42ABob', 'ZQ42A Skybrand Air Lines ZQ42ABob']) {
      expect(planImport([row(1, label)], STATE, OPTIONS).refusedRows.program, label).toEqual([1]);
    }
    // A label ending in a member's name whose remainder names no alias is refused, not retried
    // whole: here the whole label would be an alias if the suffix were ignored.
    const greedy: ImportState = { ...STATE, aliases: [...STATE.aliases, { programId: SKY, alias: 'zq42a skyway zq42abob' }] };
    expect(planImport([row(1, 'ZQ42A Skyway ZQ42ABob')], greedy, OPTIONS).refusedRows.program).toEqual([1]);
    // Duplicates: the second and later occurrences, never the first.
    const dup = planImport([
      row(1, 'ZQ42A Skybrand ZQ42AAnna'), row(2, 'ZQ42A Stayco ZQ42AAnna'),
      row(3, 'zq42a skybrand airlines zq42aanna'), row(4, '✈ ZQ42A Skybrand Air ZQ42AANNA'),
    ], STATE, OPTIONS);
    expect(dup.refusedRows.duplicate).toEqual([3, 4]);
    expect(dup.counts.refused_duplicate).toBe(2);
    // One of each refusal in one file: every one reported, and nothing would be created.
    const mixed = planImport([
      row(1, 'ZQ42A Skybrand ZQ42AAnna', { balance: '10' }),
      row(2, 'ZQ42A Nowhere ZQ42AAnna'),
      row(3, 'ZQ42A Stayco'),
      row(4, 'ZQ42A Tripcash ZQ42ABob', { balance: '$1.005' }),
      row(5, 'ZQ42A Skybrand Air ZQ42AAnna'),
      row(7, 'ZQ42A Carbrand ZQ42ACarl', { balance: '11' }),
    ], { ...STATE, memberships: [{ id: 70, memberId: CARL, programId: CAR }], importObservations: [{ membershipId: 70, asOf: '2026-01-15', balance: '12', unit: 'points' }] }, { asOf: '2026-01-15' });
    expect(mixed.refusedRows).toEqual({ program: [2], member: [3], value: [4], duplicate: [5], conflict: [7] });
    expect(mixed.counts).toMatchObject({
      rows: 6, refused_program: 1, refused_member: 1, refused_value: 1, refused_duplicate: 1, conflicts: 1,
      memberships_created: 0, observations_created: 0, instruments_created: 0,
    });
    expect(mixed.writes).toEqual([]);
    expect(planLines(mixed, true).slice(-5)).toEqual([
      'refused_rows_program=2', 'refused_rows_member=3', 'refused_rows_value=4', 'refused_rows_duplicate=5', 'refused_rows_conflict=7',
    ]);
    // After an alias replacement the old spelling no longer resolves and the new one does.
    const renamed: ImportState = { ...STATE, aliases: STATE.aliases.filter((a) => a.programId !== SKY).concat({ programId: SKY, alias: 'zq42a newsky' }) };
    expect(planImport([row(1, 'ZQ42A Skybrand ZQ42AAnna')], renamed, OPTIONS).refusedRows.program).toEqual([1]);
    expect(planImport([row(1, 'ZQ42A NewSky ZQ42AAnna')], renamed, OPTIONS).writes[0]?.programId).toBe(SKY);
  });
});
