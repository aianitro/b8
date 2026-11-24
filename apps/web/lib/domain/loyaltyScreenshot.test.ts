// P8-42d — the screenshot form's two pure rules (the U1 and U2 scenarios): whether a confirmed reading becomes the
// current balance (D8), and the three comparisons with the membership the read was started from (D9).
//
// No database, no clock: every date is a `YYYY-MM-DD` literal and every comparison is the rule's own.
// The data is fabricated (`ZQ42D …` names, letter-bearing member numbers), and every balance is a
// small whole number written in the test.

import { describe, expect, it } from 'vitest';
import { compareScreenshot, screenshotStanding } from './loyaltyScreenshot';
import { EMPTY_CLEAN_READING, programCheck, programNameForm, type CleanReading } from './loyaltyRead';
import type { LoyaltyUnit } from '@b8/contracts/loyalty';

const UNITS: LoyaltyUnit[] = ['points', 'miles', 'nights', 'usd'];
const NAMES = ['ZQ42D Sky Club', 'ZQ42D SkyClub Rewards', 'zq42d-sky'];

/** A cleaned reading with only the named fields set. */
const reading = (over: Partial<CleanReading> = {}): CleanReading => ({ ...EMPTY_CLEAN_READING, expiryWarnings: [], instruments: [], ...over });

/** The comparison for a membership of the ZQ42D Sky Club program, with the named fields overridden. */
const compare = (over: Partial<Parameters<typeof compareScreenshot>[0]> = {}) =>
  compareScreenshot({ reading: reading(), memberNumber: 'ZQ-42D-7K9X', programNames: NAMES, currentUnit: 'miles', defaultUnit: 'points', ...over });

describe('the standing of a confirmed screenshot (P8-42d, D8)', () => {
  it('T42d-U1.1: with no current balance the reading becomes current, whatever its date', () => {
    for (const asOf of ['2020-01-01', '2026-06-15', '2030-12-31']) expect(screenshotStanding(null, asOf)).toBe('current');
    // The contrast: the same early date against a dated current balance is recorded only, so it is
    // the absence of a balance, not the date, that made it current above.
    expect(screenshotStanding('2026-06-15', '2020-01-01')).toBe('recorded_only');
  });

  it('T42d-U1.2: an as-of later than the current one becomes current', () => {
    expect(screenshotStanding('2026-06-15', '2026-06-16')).toBe('current');
    expect(screenshotStanding('2026-06-15', '2027-01-01')).toBe('current');
    expect(screenshotStanding('2025-12-31', '2026-01-01')).toBe('current');
  });

  it('T42d-U1.3: an as-of equal to the current one becomes current (the tie goes to the new row)', () => {
    for (const d of ['2026-06-15', '2026-01-01', '2024-02-29']) expect(screenshotStanding(d, d)).toBe('current');
  });

  it('T42d-U1.4: an as-of earlier than the current one is recorded but does not become current', () => {
    expect(screenshotStanding('2026-06-15', '2026-06-14')).toBe('recorded_only');
    expect(screenshotStanding('2026-01-01', '2025-12-31')).toBe('recorded_only');
    expect(screenshotStanding('2026-06-15', '2020-06-15')).toBe('recorded_only');
  });
});

describe('the program check (P8-42d, D9)', () => {
  it('T42d-U2.1: a stated name equal to, containing or contained by the program name or an alias is a match', () => {
    for (const stated of ['ZQ42D Sky Club', 'zq42d sky-club', 'ZQ42D SKY CLUB REWARDS PLUS', 'Sky', 'ZQ42D-SKY', 'zq42dskyclub']) {
      expect(compare({ reading: reading({ programName: programNameForm(stated) }) }).programCheck, stated).toBe('match');
    }
  });

  it('T42d-U2.2: a different program is a mismatch', () => {
    for (const stated of ['ZQ42D Harbour Stays', 'ZQ42E Ground Miles', 'Other Air']) {
      expect(compare({ reading: reading({ programName: programNameForm(stated) }) }).programCheck, stated).toBe('mismatch');
    }
  });

  it('T42d-U2.3: no stated program name is not_stated', () => {
    expect(compare().programCheck).toBe('not_stated');
    expect(compare({ reading: reading({ programName: programNameForm('<b>') }) }).programCheck).toBe('not_stated');
  });
});

describe('the suffix check (P8-42d, D9)', () => {
  it('T42d-U2.4: a stored number that, normalised, ends with the read suffix is a match', () => {
    expect(compare({ reading: reading({ suffix: '7K9X' }) }).suffixCheck).toBe('match');
    expect(compare({ reading: reading({ suffix: 'K9X' }) }).suffixCheck).toBe('match');
    expect(compare({ memberNumber: 'zq 42d 7k 9x', reading: reading({ suffix: '7K9X' }) }).suffixCheck).toBe('match');
  });

  it('T42d-U2.5: a stored number that does not end with the read suffix is a mismatch', () => {
    expect(compare({ reading: reading({ suffix: 'ZZ1A' }) }).suffixCheck).toBe('mismatch');
    expect(compare({ reading: reading({ suffix: '9XA' }) }).suffixCheck).toBe('mismatch');
  });

  it('T42d-U2.6: a membership with no stored number and a read suffix is not_stated', () => {
    expect(compare({ memberNumber: null, reading: reading({ suffix: '7K9X' }) }).suffixCheck).toBe('not_stated');
    expect(compare({ memberNumber: ' -- ', reading: reading({ suffix: 'K9X' }) }).suffixCheck).toBe('not_stated');
  });

  it('T42d-U2.7: no read suffix is not_stated', () => {
    expect(compare().suffixCheck).toBe('not_stated');
    expect(compare({ memberNumber: null }).suffixCheck).toBe('not_stated');
  });
});

describe('the unit check (P8-42d, D9)', () => {
  it('T42d-U2.8: a read unit different from the current reading\'s unit is a mismatch', () => {
    for (const current of UNITS) {
      for (const read of UNITS.filter((u) => u !== current)) {
        expect(compare({ currentUnit: current, defaultUnit: read, reading: reading({ balance: '12', unit: read }) }).unitCheck, `${read} on ${current}`).toBe('mismatch');
      }
      expect(compare({ currentUnit: current, reading: reading({ balance: '12', unit: current }) }).unitCheck).toBe('match');
    }
  });

  it('T42d-U2.9: with no reading on file the program\'s default unit is the comparison', () => {
    for (const def of UNITS) {
      expect(compare({ currentUnit: null, defaultUnit: def, reading: reading({ balance: '12', unit: def }) }).unitCheck).toBe('match');
      const other = UNITS.find((u) => u !== def) as LoyaltyUnit;
      expect(compare({ currentUnit: null, defaultUnit: def, reading: reading({ balance: '12', unit: other }) }).unitCheck).toBe('mismatch');
    }
  });

  it('T42d-U2.10: no balance and unit read is not_stated, whatever the membership holds', () => {
    for (const current of [...UNITS, null]) expect(compare({ currentUnit: current }).unitCheck).toBe('not_stated');
  });
});

describe('parity with the mail path (P8-42d, D9)', () => {
  it('T42d-U2.11: the screenshot program check answers exactly as 42c2\'s programCheck', () => {
    const programs: string[][] = [NAMES, ['ZQ42D Harbour Stays'], ['ZQ42D A', 'ZQ42D Alpha Beta Gamma Delta Epsilon Zeta Eta Theta'], ['', '***'], []];
    const stated = [null, 'ZQ42D Sky Club', 'zq42d', 'Harbour', 'ZQ42D Alpha Beta Gamma Delta Epsilon Zeta Eta Theta Iota', 'nothing alike', '***', 'a'];
    let cases = 0;
    for (const names of programs) {
      for (const s of stated) {
        const form = programNameForm(s);
        expect(compare({ programNames: names, reading: reading({ programName: form }) }).programCheck, `${s} on ${names.join('|')}`).toBe(programCheck(form, names));
        cases++;
      }
    }
    expect(cases).toBe(programs.length * stated.length);
  });
});
