import { describe, expect, it } from 'vitest';
import { backupFilename, compareCounts, selectForDeletion, stampOf } from './backupPlan';

/** The two files that were already in the backup directory when this routine was written. */
const HAND_MADE = ['b8_finance_pre-P0-09a_20260831T174605Z.dump', 'budget_categories_backup_20260910.sql'];

const mine = (...stamps: string[]) => stamps.map((s) => `b8_finance_${s}.dump`);

describe('naming', () => {
  it('is UTC and sorts as text in the order the dumps were taken', () => {
    const earlier = backupFilename(new Date('2026-09-16T22:45:00Z'));
    const later = backupFilename(new Date('2026-09-17T01:00:00Z'));
    expect(earlier).toBe('b8_finance_20260916T224500Z.dump');
    expect([later, earlier].sort()).toEqual([earlier, later]);
  });

  it('does not reorder itself when the clocks go back', () => {
    // The one night this matters: two dumps an hour apart across a daylight boundary. In local
    // time the second would sort before the first and the pruner would keep the wrong one.
    const before = backupFilename(new Date('2026-11-01T08:30:00Z'));
    const after = backupFilename(new Date('2026-11-01T09:30:00Z'));
    expect([after, before].sort()).toEqual([before, after]);
  });
});

describe('retention', () => {
  it('keeps the newest N and deletes the rest', () => {
    const files = mine('20260901T060000Z', '20260902T060000Z', '20260903T060000Z', '20260904T060000Z');
    expect(selectForDeletion(files, 2)).toEqual(mine('20260901T060000Z', '20260902T060000Z'));
  });

  it('deletes nothing while there are fewer than N', () => {
    expect(selectForDeletion(mine('20260901T060000Z'), 30)).toEqual([]);
    expect(selectForDeletion([], 30)).toEqual([]);
  });

  it('WILL NOT TOUCH A FILE IT DID NOT WRITE', () => {
    // The directory holds dumps taken by hand before a risky migration — the only copies of what
    // they contain. A retention rule that reasons about "the oldest files" rather than "the oldest
    // files I made" is one bad glob away from deleting exactly those.
    const files = [...HAND_MADE, ...mine('20260901T060000Z', '20260902T060000Z', '20260903T060000Z')];
    const doomed = selectForDeletion(files, 1);
    expect(doomed).toEqual(mine('20260901T060000Z', '20260902T060000Z'));
    for (const kept of HAND_MADE) expect(doomed).not.toContain(kept);
  });

  it('ignores near-misses rather than guessing at them', () => {
    // A different prefix, a different extension, a truncated stamp: all of them are somebody else's
    // file until proven otherwise.
    const nearly = [
      'b8_finance_20260901T060000Z.dump.tmp',
      'b8_finance_20260901.dump',
      'b8_demo_20260901T060000Z.dump',
      'B8_FINANCE_20260901T060000Z.DUMP',
    ];
    expect(selectForDeletion([...nearly, ...mine('20260902T060000Z')], 1)).toEqual([]);
  });

  it('sorts by the stamp in the name, not by anything the filesystem says', () => {
    // A file copied in from another machine gets a fresh mtime and would sort as new; the name is
    // what says when the DATA is from.
    const files = mine('20260903T060000Z', '20260901T060000Z', '20260902T060000Z');
    expect(selectForDeletion(files, 1)).toEqual(mine('20260901T060000Z', '20260902T060000Z'));
  });

  it('refuses to be told to keep nothing', () => {
    // `keep: 0` would delete every backup on a schedule, which is not a retention policy.
    expect(() => selectForDeletion(mine('20260901T060000Z'), 0)).toThrow(RangeError);
  });
});

describe('recognising its own files', () => {
  it('reads the stamp back out of a name it wrote', () => {
    expect(stampOf(backupFilename(new Date('2026-09-16T22:45:00Z')))).toBe('20260916T224500Z');
  });

  it('returns null for anything else', () => {
    for (const other of HAND_MADE) expect(stampOf(other)).toBeNull();
  });
});

describe('the restore rehearsal decides whether a dump is kept', () => {
  const source = { transactions: 1645, accounts: 26, budget_categories: 36 };

  it('passes a restore that came back whole', () => {
    expect(compareCounts(source, { ...source })).toEqual([]);
  });

  it('catches a dump that restored short', () => {
    // The failure this exists for: a dump truncated because a disk filled. The file is there, it
    // has a plausible size, and it is missing rows.
    const mismatches = compareCounts(source, { ...source, transactions: 1200 });
    expect(mismatches).toEqual([{ table: 'transactions', source: 1645, restored: 1200 }]);
  });

  it('treats a table that did not come back at all as a mismatch, not a skip', () => {
    // The worst possible dump restores none of the schema. Read as "absent, nothing to compare",
    // that one would pass every check in the routine.
    const { transactions: _omitted, ...missingATable } = source;
    void _omitted;
    expect(compareCounts(source, missingATable)).toEqual([
      { table: 'transactions', source: 1645, restored: -1 },
    ]);
  });

  it('reports every table that differs, not just the first', () => {
    const mismatches = compareCounts(source, { transactions: 0, accounts: 0, budget_categories: 36 });
    expect(mismatches.map((m) => m.table)).toEqual(['transactions', 'accounts']);
  });

  it('ignores extra tables in the restore that the source never counted', () => {
    // pg_restore brings the whole schema back; the comparison is over what was asked for.
    expect(compareCounts(source, { ...source, pgmigrations: 14 })).toEqual([]);
  });
});

describe('selectForDeletion with encrypted dumps', () => {
  const plain = (s: string) => `b8_finance_${s}.dump`;
  const sealed = (s: string) => `b8_finance_${s}.dump.age`;

  // THE BUG THIS PREVENTS: the pattern matched only `.dump`, so the day encryption was switched on
  // the pruner would have stopped recognising its own output and retained every backup forever.
  it('prunes encrypted dumps too', () => {
    const files = ['20260901T060000Z', '20260902T060000Z', '20260903T060000Z'].map(sealed);
    expect(selectForDeletion(files, 1)).toEqual([sealed('20260901T060000Z'), sealed('20260902T060000Z')]);
  });

  // A directory mid-changeover holds both kinds. They must order by DATE, not by whether a file
  // happens to be encrypted, or the changeover deletes the wrong ones.
  it('orders a mixed directory by date rather than by extension', () => {
    const files = [sealed('20260903T060000Z'), plain('20260901T060000Z'), sealed('20260902T060000Z')];
    expect(selectForDeletion(files, 1)).toEqual([plain('20260901T060000Z'), sealed('20260902T060000Z')]);
  });

  it('still ignores anything it did not write', () => {
    const files = [sealed('20260901T060000Z'), 'b8_finance_pre-P0-09a_20260831T174605Z.dump', 'notes.age'];
    expect(selectForDeletion(files, 1)).toEqual([]);
  });
});
