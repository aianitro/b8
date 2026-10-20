// P5-34 — the finding vocabulary refuses what it says it refuses (scenarios C1–C6).
//
// These pin the CONTRACT, not the conversions: every fixture here is a hand-built Finding, and the
// question each scenario asks is "does the schema accept exactly this set of values". The
// conversions' own behaviour is `apps/web/lib/domain/findings.test.ts` (V1–V14, A1–A8).
//
// Written by the implementer rather than the contract-guardian, per the G0 process ruling recorded
// in `plan/tasks/P5-34-finding-vocabulary/GATES.md`: the guardian's role excludes tests, and the
// scope guard exempts test files under this package from the contract lease.
//
// FIXTURES ARE FABRICATED. Money values are built from small integers by `M()` so that no figure is
// written down as currency in a tracked file (AGENTS.md: this repository is public).

import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import {
  ConfidenceSchema,
  FindingKindSchema,
  FindingSchema,
  PeriodSchema,
  SeveritySchema,
  SubjectSchema,
  calendarMonth,
  type Finding,
  type FindingKind,
} from './findings';

/** A fabricated amount as the two-decimal string the vocabulary carries. */
const M = (n: number) => n.toFixed(2);

const asOf = { type: 'asOf', date: '2026-03-05' } as const;
const account = { type: 'account', id: 'acct_fixture_1', name: 'Fixture Checking' } as const;
const institution = { type: 'institution', name: 'Fabricated Credit Union' } as const;
const category = { type: 'category', id: 7, name: 'Fixture Category' } as const;

/**
 * One valid fixture per kind, each in the state that makes as many of its nullable fields null as
 * the member's never/null refinements allow. A second fixture per refined kind, in the other state,
 * covers the non-null side. Typed as `Finding` so a fixture that drifts from the contract's own
 * inferred type fails `tsc` before it fails a parse.
 */
const VALID: Record<FindingKind, Finding> = {
  'budget-breach': {
    kind: 'budget-breach', severity: 'warning', confidence: 'inferred', subject: category,
    period: { type: 'month', month: '2026-12' }, scored: true,
    budgeted: M(0), actual: M(3), variance: M(3), ratio: null,
  },
  'budget-underspend': {
    kind: 'budget-underspend', severity: 'notice', confidence: 'inferred', subject: category,
    period: { type: 'months', months: ['2026-03', '2026-06', '2026-07'] }, scored: false,
    budgeted: M(30), actual: M(3), variance: M(-27),
    monthly: ['2026-03', '2026-06', '2026-07'].map((month) => ({
      month, budgeted: M(10), actual: M(1), variance: M(-9), ratio: null,
    })),
  },
  'balance-drift': {
    kind: 'balance-drift', severity: 'warning', confidence: 'observed', subject: account, period: asOf,
    ledgerBalance: M(-5), expectedBalance: M(-8), drift: M(-3), suggestedBeginningBalance: M(-3),
    observedAt: null, safeToDerive: false,
  },
  'feed-degraded': {
    kind: 'feed-degraded', severity: 'warning', confidence: 'observed', subject: institution, period: asOf,
    accountCount: 2, state: 'failing', lastSuccessfulUpdate: null, hoursStale: null,
    institutionStatus: null, institutionStatusAt: null,
  },
  'sync-stale': {
    kind: 'sync-stale', severity: 'warning', confidence: 'observed', subject: institution, period: asOf,
    key: 'acct_fixture_1', accountCount: 1, daysStale: null, status: 'never',
  },
  'job-overdue': {
    kind: 'job-overdue', severity: 'warning', confidence: 'observed',
    subject: { type: 'system', name: 'daily-job' }, period: asOf,
    status: 'never', daysSince: null, message: 'A fabricated sentence about the job.',
  },
  'cash-uncounted': {
    kind: 'cash-uncounted', severity: 'warning', confidence: 'observed', subject: account, period: asOf,
    balance: M(-1), daysSinceCount: null, reason: 'never',
  },
  'valuation-stale': {
    kind: 'valuation-stale', severity: 'warning', confidence: 'observed', subject: account, period: asOf,
    reason: 'never', daysSince: null,
  },
  'overdraft-open': {
    kind: 'overdraft-open', severity: 'critical', confidence: 'observed', subject: account, period: asOf,
    bank: null, balance: M(-4), cushion: M(5),
    since: '2026-03-04 06:00:00+00', seenAt: '2026-03-05 06:00:00+00',
  },
  'overdraft-forecast': {
    kind: 'overdraft-forecast', severity: 'warning', confidence: 'projected', subject: account, period: asOf,
    bank: null, cushion: M(5), low: M(-2), lowOn: '2026-03-09', projectedAt: '2026-03-05 06:00:00+00',
  },
};

/** The same kinds in their other state, where every never/null-paired field carries a value. */
const VALUED: Partial<Record<FindingKind, Finding>> = {
  'budget-breach': { ...VALID['budget-breach'], ratio: 1.5 } as Finding,
  'balance-drift': { ...VALID['balance-drift'], observedAt: '2026-03-05T06:00:00.000Z' } as Finding,
  'feed-degraded': {
    ...VALID['feed-degraded'], state: 'stale', lastSuccessfulUpdate: '2026-03-01T00:00:00.000Z', hoursStale: 96,
    institutionStatus: 'HEALTHY', institutionStatusAt: '2026-02-01T00:00:00.000Z',
  } as Finding,
  'sync-stale': { ...VALID['sync-stale'], status: 'stale', daysStale: 3 } as Finding,
  'job-overdue': { ...VALID['job-overdue'], status: 'missed', daysSince: 4 } as Finding,
  'cash-uncounted': { ...VALID['cash-uncounted'], reason: 'stale', daysSinceCount: 40 } as Finding,
  'valuation-stale': { ...VALID['valuation-stale'], reason: 'stale', daysSince: 120 } as Finding,
  'overdraft-open': { ...VALID['overdraft-open'], bank: 'Fabricated Credit Union' } as Finding,
  'overdraft-forecast': { ...VALID['overdraft-forecast'], bank: 'Fabricated Credit Union' } as Finding,
};

const parses = (value: unknown) => FindingSchema.safeParse(value).success;
const omit = (o: object, key: string) => Object.fromEntries(Object.entries(o).filter(([k]) => k !== key));

/**
 * Every nullable top-level field of every member, written out by hand. C4 also derives the same
 * list from the schemas and requires the two to agree, so a nullable field added to the contract
 * without a scenario here fails rather than going unexercised.
 */
const NULLABLE: Record<FindingKind, readonly string[]> = {
  'budget-breach': ['ratio'],
  'budget-underspend': [],
  'balance-drift': ['observedAt'],
  'feed-degraded': ['lastSuccessfulUpdate', 'hoursStale', 'institutionStatus', 'institutionStatusAt'],
  'sync-stale': ['daysStale'],
  'job-overdue': ['daysSince'],
  'cash-uncounted': ['daysSinceCount'],
  'valuation-stale': ['daysSince'],
  'overdraft-open': ['bank'],
  'overdraft-forecast': ['bank'],
};

const MEMBERS = FindingSchema.options;
const memberFor = (kind: FindingKind) => {
  const m = MEMBERS.find((s) => s.shape.kind.value === kind);
  if (!m) throw new Error(`no member for ${kind}`);
  return m;
};

const TEN: readonly FindingKind[] = [
  'budget-breach',
  'budget-underspend',
  'balance-drift',
  'feed-degraded',
  'sync-stale',
  'job-overdue',
  'cash-uncounted',
  'valuation-stale',
  'overdraft-open',
  'overdraft-forecast',
];

describe('P5-34 finding contract', () => {
  it('T34-C1: the kind set is exactly the ten', () => {
    // Both the enum and the union's own discriminants, so neither can grow alone at runtime.
    expect([...FindingKindSchema.options].sort()).toEqual([...TEN].sort());
    expect(MEMBERS.map((m) => m.shape.kind.value).sort()).toEqual([...TEN].sort());
    expect(new Set(MEMBERS.map((m) => m.shape.kind.value)).size).toBe(10);
    for (const kind of TEN) expect(parses(VALID[kind])).toBe(true);
    expect(parses({ ...VALID['balance-drift'], kind: 'property-anomaly' })).toBe(false);
  });

  it('T34-C2: the severity, confidence, subject and period vocabularies are exact', () => {
    expect(SeveritySchema.options).toEqual(['critical', 'warning', 'notice']);
    expect([...ConfidenceSchema.options].sort()).toEqual(['inferred', 'observed', 'projected']);
    expect(SubjectSchema.options.map((s) => s.shape.type.value).sort())
      .toEqual(['account', 'category', 'institution', 'system']);
    expect(PeriodSchema.options.map((s) => s.shape.type.value).sort()).toEqual(['asOf', 'month', 'months']);
    // Outside the vocabularies, on a fixture that is otherwise valid.
    expect(parses({ ...VALID['balance-drift'], severity: 'high' })).toBe(false);
    expect(parses({ ...VALID['balance-drift'], severity: 'info' })).toBe(false);
    expect(parses({ ...VALID['balance-drift'], confidence: 0.9 })).toBe(false);
    expect(parses({ ...VALID['balance-drift'], confidence: 'certain' })).toBe(false);
    expect(SubjectSchema.safeParse({ type: 'property', id: 1, name: 'Fixture House' }).success).toBe(false);
    expect(PeriodSchema.safeParse({ type: 'range', from: '2026-01', to: '2026-03' }).success).toBe(false);
    // The subject type is narrowed per kind: a budget finding about an account is malformed.
    expect(parses({ ...VALID['budget-breach'], subject: account })).toBe(false);
    expect(parses({ ...VALID['balance-drift'], subject: category })).toBe(false);
  });

  it('T34-C3: every member is strict — a valid fixture parses and the same plus one unknown key fails', () => {
    for (const kind of TEN) {
      for (const fixture of [VALID[kind], VALUED[kind]].filter(Boolean)) {
        expect(parses(fixture), kind).toBe(true);
        expect(parses({ ...fixture, extra: 'unexpected' }), kind).toBe(false);
      }
    }
    // The leak the strictness exists to catch, by name: a forecast's charges.
    expect(parses({
      ...VALID['overdraft-forecast'],
      charges: [{ label: 'CANARY', amount: 1, on: '2026-03-07' }],
    })).toBe(false);
    // Nested objects are strict too.
    expect(parses({ ...VALID['balance-drift'], subject: { ...account, extra: 1 } })).toBe(false);
    expect(parses({ ...VALID['balance-drift'], period: { ...asOf, extra: 1 } })).toBe(false);
    const u = VALID['budget-underspend'] as Extract<Finding, { kind: 'budget-underspend' }>;
    expect(parses({ ...u, monthly: u.monthly.map((m) => ({ ...m, label: 'CANARY' })) })).toBe(false);
  });

  it('T34-C4: null is a value and absence is not — every nullable field parses null and fails omitted', () => {
    for (const kind of TEN) {
      // The hand list equals what the schema itself says is nullable.
      const shape = memberFor(kind).shape as Record<string, z.ZodType>;
      const derived = Object.keys(shape).filter((k) => shape[k] instanceof z.ZodNullable).sort();
      expect(derived, kind).toEqual([...NULLABLE[kind]].sort());

      const fixture = VALID[kind] as Record<string, unknown>;
      for (const field of NULLABLE[kind]) {
        expect(fixture[field], `${kind}.${field}`).toBeNull();
        expect(parses(fixture), `${kind}.${field} null`).toBe(true);
        expect(parses(omit(fixture, field)), `${kind}.${field} omitted`).toBe(false);
        expect(parses({ ...fixture, [field]: undefined }), `${kind}.${field} undefined`).toBe(false);
      }
      // No key at all is optional, nullable or not.
      for (const field of Object.keys(fixture)) {
        expect(parses(omit(fixture, field)), `${kind}.${field} omitted`).toBe(false);
      }
    }
    // A nested nullable: the underspend month's ratio.
    const u = VALID['budget-underspend'] as Extract<Finding, { kind: 'budget-underspend' }>;
    expect(parses(u)).toBe(true);
    expect(parses({ ...u, monthly: u.monthly.map((m) => omit(m, 'ratio')) })).toBe(false);

    // "Never" pairs with null, and only with null: zero is not a stand-in for "never counted".
    expect(parses({ ...VALID['cash-uncounted'], daysSinceCount: 0 })).toBe(false);
    expect(parses({ ...VALID['valuation-stale'], daysSince: 0 })).toBe(false);
    expect(parses({ ...VALID['sync-stale'], daysStale: 0 })).toBe(false);
    expect(parses({ ...VALID['job-overdue'], daysSince: 0 })).toBe(false);
    expect(parses({ ...VALUED['feed-degraded'], hoursStale: null })).toBe(false);
    expect(parses({ ...VALUED['valuation-stale'], daysSince: null })).toBe(false);
  });

  it('T34-C5: money fields are strict two-decimal strings', () => {
    const moneyFields: [FindingKind, string][] = [
      ['budget-breach', 'budgeted'], ['budget-breach', 'actual'], ['budget-breach', 'variance'],
      ['budget-underspend', 'budgeted'], ['budget-underspend', 'actual'], ['budget-underspend', 'variance'],
      ['balance-drift', 'ledgerBalance'], ['balance-drift', 'expectedBalance'], ['balance-drift', 'drift'],
      ['balance-drift', 'suggestedBeginningBalance'],
      ['cash-uncounted', 'balance'],
      ['overdraft-open', 'balance'], ['overdraft-open', 'cushion'],
      ['overdraft-forecast', 'cushion'], ['overdraft-forecast', 'low'],
    ];
    for (const [kind, field] of moneyFields) {
      const f = VALID[kind];
      for (const bad of ['12.5', 12.5, 3, 'abc', '', '1e3', '.50', '1,000.00']) {
        expect(parses({ ...f, [field]: bad }), `${kind}.${field} = ${JSON.stringify(bad)}`).toBe(false);
      }
      for (const good of [M(0), M(12), M(-7), M(1234)]) {
        expect(parses({ ...f, [field]: good }), `${kind}.${field} = ${good}`).toBe(true);
      }
    }
    const u = VALID['budget-underspend'] as Extract<Finding, { kind: 'budget-underspend' }>;
    expect(parses({ ...u, monthly: u.monthly.map((m) => ({ ...m, actual: '1.5' })) })).toBe(false);
  });

  it('T34-C6: calendar months and dates are strict text, and a months period is non-empty and ascending', () => {
    for (const bad of ['2026-13', '2026-00', '2026-1', '26-01', '2026-01-01', '']) {
      expect(calendarMonth.safeParse(bad).success, bad).toBe(false);
      expect(parses({ ...VALID['budget-breach'], period: { type: 'month', month: bad } }), bad).toBe(false);
    }
    for (const good of ['2026-01', '2026-12']) {
      expect(calendarMonth.safeParse(good).success, good).toBe(true);
      expect(parses({ ...VALID['budget-breach'], period: { type: 'month', month: good } }), good).toBe(true);
    }
    for (const bad of ['2026-1-5', '2026-02-30', '2026-13-01', '2026-03']) {
      expect(parses({ ...VALID['balance-drift'], period: { type: 'asOf', date: bad } }), bad).toBe(false);
    }
    expect(parses({ ...VALID['balance-drift'], period: { type: 'asOf', date: '2028-02-29' } })).toBe(true);

    const u = VALID['budget-underspend'] as Extract<Finding, { kind: 'budget-underspend' }>;
    expect(parses({ ...u, period: { type: 'months', months: [] }, monthly: [] })).toBe(false);
    expect(parses({
      ...u,
      period: { type: 'months', months: [...u.period.months].reverse() },
      monthly: [...u.monthly].reverse(),
    })).toBe(false);
    expect(parses({
      ...u,
      period: { type: 'months', months: ['2026-03', '2026-03', '2026-06'] },
      monthly: ['2026-03', '2026-03', '2026-06'].map((month) => ({ ...u.monthly[0], month })),
    })).toBe(false);
    // The per-month evidence and the period are one truth: a breakdown that disagrees is refused.
    expect(parses({ ...u, monthly: u.monthly.slice(1) })).toBe(false);
  });
});
