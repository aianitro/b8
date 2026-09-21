import { describe, expect, it } from 'vitest';
import {
  decideApply,
  expiryFrom,
  isNoop,
  PROPOSAL_TTL_MS,
  type ApplyFacts,
  type StoredProposal,
} from './proposal';

const NOW = new Date('2026-09-21T12:00:00Z');

function proposal(over: Partial<StoredProposal> = {}): StoredProposal {
  return {
    id: 'p_abcdefghijklmnopqrstuv',
    kind: 'categorize_transaction',
    subjectId: 42,
    proposed: { category: 'Groceries' },
    observed: { category: 'Dining Out' },
    rationale: 'Supermarket merchant.',
    expiresAt: new Date(NOW.getTime() + 60_000),
    decidedAt: null,
    ...over,
  };
}

function facts(over: Partial<ApplyFacts> = {}): ApplyFacts {
  return {
    proposal: proposal(),
    now: NOW,
    currentCategory: 'Dining Out',
    subjectExists: true,
    categoryIsKnown: true,
    ...over,
  };
}

describe('the happy path', () => {
  it('applies when the world still matches what was proposed', () => {
    expect(decideApply(facts())).toEqual({ ok: true, setCategory: 'Groceries' });
  });

  it('can clear a category, which is a real outcome and not a missing value', () => {
    const p = proposal({ proposed: { category: null } });
    expect(decideApply(facts({ proposal: p }))).toEqual({ ok: true, setCategory: null });
  });
});

describe('single use', () => {
  it('refuses a proposal that was already decided', () => {
    const p = proposal({ decidedAt: new Date(NOW.getTime() - 1000) });
    const v = decideApply(facts({ proposal: p }));
    expect(v.ok).toBe(false);
    expect(v).toMatchObject({ code: 'ALREADY_DECIDED' });
  });

  it('reports the replay rather than the expiry when a spent proposal is resent later', () => {
    // Both conditions hold. The order matters: these have different causes and only one is
    // an attack, so the message must not blame the clock for a replay.
    const p = proposal({
      decidedAt: new Date(NOW.getTime() - 60_000),
      expiresAt: new Date(NOW.getTime() - 30_000),
    });
    expect(decideApply(facts({ proposal: p }))).toMatchObject({ code: 'ALREADY_DECIDED' });
  });
});

describe('expiry', () => {
  it('is dead exactly at the expiry instant, not a millisecond later', () => {
    const p = proposal({ expiresAt: NOW });
    expect(decideApply(facts({ proposal: p }))).toMatchObject({ code: 'EXPIRED' });
  });

  it('is alive one millisecond before', () => {
    const p = proposal({ expiresAt: new Date(NOW.getTime() + 1) });
    expect(decideApply(facts({ proposal: p })).ok).toBe(true);
  });

  it('derives expiry from the clock it is given', () => {
    expect(expiryFrom(NOW).getTime()).toBe(NOW.getTime() + PROPOSAL_TTL_MS);
  });
});

describe('the concurrency check — the reason this is a gate and not a delay', () => {
  it('refuses when the owner changed the category in between', () => {
    const v = decideApply(facts({ currentCategory: 'Travel' }));
    expect(v.ok).toBe(false);
    expect(v).toMatchObject({ code: 'SUBJECT_CHANGED' });
  });

  it('names both the old and the new value, so the refusal is actionable', () => {
    const v = decideApply(facts({ currentCategory: 'Travel' }));
    expect(v.ok).toBe(false);
    if (v.ok) return;
    expect(v.message).toContain('Dining Out');
    expect(v.message).toContain('Travel');
  });

  it('refuses when the transaction became uncategorized in between', () => {
    expect(decideApply(facts({ currentCategory: null }))).toMatchObject({ code: 'SUBJECT_CHANGED' });
  });

  it('treats case and surrounding whitespace as the same category', () => {
    // A budget line differing only in case is the same line to everyone but a string comparison.
    expect(decideApply(facts({ currentCategory: '  dining out ' })).ok).toBe(true);
  });

  it('treats null and empty string as the same absence', () => {
    const p = proposal({ observed: { category: null }, proposed: { category: 'Groceries' } });
    expect(decideApply(facts({ proposal: p, currentCategory: '' })).ok).toBe(true);
  });
});

describe('the subject and the category are re-checked at apply time', () => {
  it('refuses when the transaction is gone', () => {
    expect(decideApply(facts({ subjectExists: false }))).toMatchObject({ code: 'SUBJECT_GONE' });
  });

  it('refuses a category that no longer exists', () => {
    // Renamed or deleted between propose and confirm. Writing it would not error -- the row would
    // just quietly stop counting toward any budget line, which is the worst kind of wrong.
    expect(decideApply(facts({ categoryIsKnown: false }))).toMatchObject({ code: 'UNKNOWN_CATEGORY' });
  });

  it('does not require a known category when clearing', () => {
    const p = proposal({ proposed: { category: null } });
    expect(decideApply(facts({ proposal: p, categoryIsKnown: false })).ok).toBe(true);
  });
});

describe('an unknown proposal', () => {
  it('is refused rather than treated as permission', () => {
    expect(decideApply(facts({ proposal: null }))).toMatchObject({ code: 'NOT_FOUND' });
  });
});

describe('no-op suppression', () => {
  it('recognises a proposal that would change nothing', () => {
    expect(isNoop({ category: 'Groceries' }, { category: 'groceries' })).toBe(true);
    expect(isNoop({ category: null }, { category: '' })).toBe(true);
  });

  it('does not suppress a real change', () => {
    expect(isNoop({ category: 'Groceries' }, { category: 'Dining Out' })).toBe(false);
    expect(isNoop({ category: null }, { category: 'Groceries' })).toBe(false);
  });
});
