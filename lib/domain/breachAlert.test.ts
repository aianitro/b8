import { describe, it, expect } from 'vitest';
import { planAlert, shouldSend, type AlertMessage } from './breachAlert';
import type { CategorizationCoverage, MonthOutlook, OutlookCategory } from './monthOutlook';

// Every figure below was verified by execution before it was written down, per the spec's own
// arithmetic table:
//
//   284 / 400        = 0.71          284 × 30/8 = 1065     1065 − 400 = 665    1065 / 400 = 2.6625
//   260 / 200        = 1.3           260 × 30/8 = 975       975 − 200 = 775     975 / 200 = 4.875
//   Math.round(2.6625 × 100) = 266   Math.round(4.875 × 100) = 488  — NOT 487, which is the floor
//
// The data is fabricated. No figure here comes from the owner's database, and nothing in this file
// opens a socket, constructs a transport, reads an environment or touches a credential: the whole
// of the send decision is a pure function of the outlook and the send history, which is what makes
// it testable at all. The delivery itself is deliberately ungated — see SPEC.md Q1 — because a test
// that sends is a test that leaks.

const COVERAGE: CategorizationCoverage = {
  scoredSpend: 4800,
  scoredCount: 40,
  unattributedSpend: 200,
  unattributedCount: 2,
  orphanedSpend: 0,
  orphanedCount: 0,
  coverageShare: 0.96,
  coveragePercent: 96,
  authoritative: true,
};

const DINING: OutlookCategory = {
  categoryId: 1,
  category: 'Dining Out',
  controlMode: 'discretionary',
  status: 'projected',
  month: 8,
  elapsedDays: 8,
  daysInMonth: 30,
  budgeted: 400,
  actual: 284,
  spentRatio: 0.71,
  projected: 1065,
  projectedVariance: 665,
  projectedRatio: 2.6625,
  reason: 'projected-breach',
  withheldReason: null,
};

const TRAVEL: OutlookCategory = {
  categoryId: 2,
  category: 'Travel',
  controlMode: 'discretionary',
  status: 'projected',
  month: 8,
  elapsedDays: 8,
  daysInMonth: 30,
  budgeted: 200,
  actual: 260,
  spentRatio: 1.3,
  projected: 975,
  projectedVariance: 775,
  projectedRatio: 4.875,
  reason: 'breach',
  withheldReason: null,
};

/** The base outlook `O`: September (0-based month 8), day 8, two categories saying no, 96% seen. */
const O: MonthOutlook = {
  asOf: { year: 2026, month: 8, day: 8 },
  state: 'projected-breach',
  scoredCategoryCount: 9,
  sayingNo: [DINING, TRAVEL],
  holding: [],
  withheld: [],
  offCycleElsewhere: [],
  headline: null,
  findings: [],
  coverage: COVERAGE,
  coverageShare: 0.96,
  coveragePercent: 96,
  authoritative: true,
};

/** A variant of `O`, built by overlay so every fixture differs from the base in stated ways only. */
function outlook(patch: Partial<MonthOutlook>): MonthOutlook {
  return { ...O, ...patch };
}

/** A variant of a category record, same discipline. */
function category(base: OutlookCategory, patch: Partial<OutlookCategory>): OutlookCategory {
  return { ...base, ...patch };
}

/** `planAlert` where the fixture is built to produce a message; fails loudly rather than at `!`. */
function message(o: MonthOutlook): AlertMessage {
  const m = planAlert(o);
  if (m === null) throw new Error('fixture produced no message, which is not what it was built for');
  return m;
}

describe('planAlert — the message, its allowlist, and the coverage refusal', () => {
  it('two categories saying no under authoritative coverage produce one message naming both, their spend against their budgets and their projected share of the month', () => {
    const m = message(O);

    expect(m.kind).toBe('projected-breach');

    for (const expected of [
      'Dining Out', '$284.00', '$400.00', '$1,065.00', '71%', '266%',
      'day 8 of 30',
      'Travel', '$260.00', '$200.00', '$975.00', '130%', '488%',
      '96%', 'open the app',
    ]) {
      expect(m.body).toContain(expected);
    }

    // `projectedVariance` is the one SIGNED field in scope and it is off the allowlist entirely.
    // `./pacing` states the failure out loud: reversing the subtraction still yields a plausible
    // dollar figure, and the only symptom is that thrift reads as overspending. Removing the field
    // is cheaper than trusting the sign.
    expect(m.body).not.toContain('$665.00');
    expect(m.body).not.toContain('$775.00');

    // The ratio follows the page's rounding, not step 32's floor. 487 is what the floor prints.
    expect(m.body).not.toContain('487%');

    // A message has no "—" to fall back to, so none of these may ever reach it.
    expect(m.body).not.toContain('NaN');
    expect(m.body).not.toContain('null');
    expect(m.body).not.toContain('undefined');
    expect(m.body).not.toContain('Infinity');

    // Step 32's [[N52]] noun, deliberately not repeated on a new surface.
    expect(m.body).not.toContain("of this month's spend");
  });

  it('the subject line carries the count and the month and never a dollar amount, because a subject is what a lock screen shows', () => {
    const m = message(O);

    expect(m.subject).toContain('2026-09');
    expect(m.subject).toContain('2');

    // The line above is VACUOUS ON ITS OWN and is kept only because the spec words the expectation
    // that way: the rendered month is `2026-09`, which already contains a '2', so it passes whether
    // or not the subject carries a count at all. [[N60]]. These are the assertions that actually
    // read the count — they name a phrase the month cannot supply, and they check it MOVES.
    expect(m.subject).toContain('2 saying no');

    const three = message(outlook({
      sayingNo: [DINING, TRAVEL, category(DINING, { categoryId: 3, category: 'Groceries' })],
    }));
    expect(three.subject).toContain('3 saying no');
    expect(three.subject).not.toContain('2 saying no');

    const one = message(outlook({ sayingNo: [DINING] }));
    expect(one.subject).toContain('1 saying no');

    expect(m.subject).not.toContain('$');
    expect(m.subject).not.toContain('266');
    expect(m.subject).not.toContain('284');
    expect(m.subject).not.toContain('Dining Out');
    expect(m.subject).not.toContain('Travel');
  });

  it('the message renders only the allowlisted fields, so a category record carrying a merchant, an account id and a balance leaks none of the three', () => {
    // Structurally assignable — the extra keys are exactly the shape a wider row would arrive in,
    // and the renderer must ignore them by construction rather than by having been told to. A
    // whole-object serialiser in the body fails all five assertions below at once, which is the
    // point of the fixture: it is the live control on the allowlist, not a hypothetical.
    const leaky = (c: OutlookCategory): OutlookCategory =>
      ({
        ...c,
        merchantName: 'CHIPOTLE 0421',
        accountId: 'acct_9f3a2b',
        balance: 250000,
        transactionId: 'txn_77',
      }) as OutlookCategory;

    const m = message(outlook({ sayingNo: [leaky(DINING), leaky(TRAVEL)] }));

    expect(m.body).toContain('Dining Out');
    expect(m.body).toContain('$284.00');

    for (const forbidden of ['CHIPOTLE', '0421', 'acct_9f3a2b', '250000', 'txn_77']) {
      expect(m.body).not.toContain(forbidden);
      expect(m.subject).not.toContain(forbidden);
    }
  });

  it('coverage below the threshold withdraws the figures as well as the confidence: the message names no category, no amount and no ratio', () => {
    const m = message(outlook({
      coverage: { ...COVERAGE, coverageShare: 0.077, coveragePercent: 7, authoritative: false },
      coverageShare: 0.077,
      coveragePercent: 7,
      authoritative: false,
    }));

    expect(m.kind).toBe('coverage');
    expect(m.body).toContain('7%');
    expect(m.body).toContain('2');
    expect(m.body).toContain('open the app');

    // Same [[N60]] hole, and it matters more here: `2026-09` supplies the '2' above, so that line
    // passes with the count paragraph deleted outright — and this is the ONLY message that will
    // send on the owner's real data today (EVIDENCE §5 measured authoritative: false). The count is
    // the whole of what the coverage message says beyond a percentage, so it gets an assertion the
    // month cannot satisfy, plus the singular, so the clause is read rather than merely present.
    expect(m.body).toContain('2 budget lines are currently flagged');

    const singular = message(outlook({
      coverage: { ...COVERAGE, coverageShare: 0.077, coveragePercent: 7, authoritative: false },
      coverageShare: 0.077,
      coveragePercent: 7,
      authoritative: false,
      sayingNo: [DINING],
    }));
    expect(singular.body).toContain('1 budget line is currently flagged');
    expect(singular.body).not.toContain('budget lines are');

    // The discriminator between a real withholding and a caveat sentence written above the same
    // figures. A refusal implemented as prose reads as compliant and asserts exactly what the
    // dashboard has just declined to assert.
    for (const surface of [m.body, m.subject]) {
      expect(surface).not.toContain('Dining Out');
      expect(surface).not.toContain('Travel');
      expect(surface).not.toContain('$284.00');
      expect(surface).not.toContain('$400.00');
      expect(surface).not.toContain('266');
      expect(surface).not.toContain('488');
      expect(surface).not.toContain('$');
    }
  });

  it('a month with nothing scored produces no message at all, because there is no guardrail to report the state of', () => {
    // Rung 1 sits ABOVE rung 3 deliberately: at 7% coverage with nothing scored, a coverage message
    // would name the wrong cause. The problem is that no category is scored, which is a different
    // fix from a month that has not been categorized.
    const o = outlook({
      state: 'nothing-to-score',
      scoredCategoryCount: 0,
      sayingNo: [],
      coverage: { ...COVERAGE, coverageShare: 0.077, coveragePercent: 7, authoritative: false },
      coverageShare: 0.077,
      coveragePercent: 7,
      authoritative: false,
    });

    expect(planAlert(o)).toBeNull();
    expect(planAlert(o)?.kind).not.toBe('coverage');
  });

  it("a month where every scored category is holding produces no message, and that silence is what step 39's heartbeat exists to break", () => {
    const o = outlook({
      state: 'on-track',
      sayingNo: [],
      coverage: { ...COVERAGE, coverageShare: 0.99, coveragePercent: 99 },
      coverageShare: 0.99,
      coveragePercent: 99,
      authoritative: true,
    });

    expect(planAlert(o)).toBeNull();
  });

  it('a month with no spend at all produces no message rather than one reporting zero percent or a hundred', () => {
    // An empty population. `0/0` is `NaN` and "100% of nothing" is the most confident possible
    // statement about the least possible evidence, so the domain returns `null` for the share and
    // this rung refuses to turn that into a figure.
    const o = outlook({
      coverage: { ...COVERAGE, scoredSpend: 0, unattributedSpend: 0, coverageShare: null, coveragePercent: null, authoritative: false },
      coverageShare: null,
      coveragePercent: null,
      authoritative: false,
      sayingNo: [],
    });

    expect(planAlert(o)).toBeNull();
  });

  it('an empty population beats a non-empty saying-no list, because there is no share to caveat the figures with', () => {
    const o = outlook({
      coverage: { ...COVERAGE, scoredSpend: 0, unattributedSpend: 0, coverageShare: null, coveragePercent: null, authoritative: false },
      coverageShare: null,
      coveragePercent: null,
      authoritative: false,
      sayingNo: [DINING, TRAVEL],
    });

    expect(planAlert(o)).toBeNull();
  });

  it("the as-of month is rendered one-based against the domain's zero-based index, so September is 2026-09 and never 2026-08", () => {
    const m = message(O);

    expect(m.subject).toContain('2026-09');
    expect(m.body).toContain('2026-09');
    expect(m.subject).not.toContain('2026-08');
    expect(m.body).not.toContain('2026-08');
  });

  it("a category's share of budget is rendered by the same rule the dashboard uses, so the email and the page cannot disagree by a percentage point", () => {
    const m = message(O);

    expect(m.body).toContain('266%');
    expect(m.body).toContain('488%');
    expect(m.body).not.toContain('487%');
    expect(m.body).not.toContain('266.25');
  });

  it('money is formatted once at the message boundary and never re-derived from the budget and the actual', () => {
    const m = message(O);

    expect(m.body).toContain('$1,065.00');
    expect(m.body).toContain('$975.00');

    // The ungrouped form, which a hand-rolled formatter produces.
    expect(m.body).not.toContain('$1065.00');
    // 350 × 30/8 = 1312.5 — the figure a re-projection off a different `actual` would produce.
    expect(m.body).not.toContain('$1,312.50');
  });

  it('an off-cycle category has no projection to report, so its line names the spend and omits the comparison rather than printing null', () => {
    // The highest-precedence reason, and therefore the FIRST thing a real breach message contains —
    // and the one record whose projection fields are all null. Testing only `projected-breach`
    // ships a message whose opening line reads `null`.
    const gym = category(DINING, {
      categoryId: 3,
      category: 'Gym',
      status: 'off-cycle',
      budgeted: 0,
      actual: 150,
      spentRatio: null,
      projected: null,
      projectedVariance: null,
      projectedRatio: null,
      reason: 'off-cycle',
    });

    const m = message(outlook({ sayingNo: [gym, DINING, TRAVEL] }));

    expect(m.body).toContain('Gym');
    expect(m.body).toContain('$150.00');

    expect(m.body).not.toContain('null');
    expect(m.body).not.toContain('NaN');
    expect(m.body).not.toContain('$0.00');
    expect(m.body).not.toContain('undefined');
  });

  it('a non-finite figure reaching the renderer is rejected rather than printed as NaN', () => {
    const o = outlook({
      sayingNo: [category(DINING, { actual: Number.POSITIVE_INFINITY }), TRAVEL],
    });

    expect(() => planAlert(o)).toThrow(RangeError);
    expect(() => planAlert(o)).toThrow(/Dining Out/);
  });

  it('every figure the message prints is guarded and not merely the first one, so a non-finite budget, projection or ratio is refused too', () => {
    // Added after a mutation sweep found the other four call sites unpinned: removing the guard
    // from `budgeted`, `projected` or either ratio left the suite entirely green, because the
    // fixture above only ever corrupts `actual`. A guard that no test reaches is a guard that gets
    // deleted in a refactor by somebody who checked that the suite stayed green.
    for (const field of ['budgeted', 'projected', 'spentRatio', 'projectedRatio'] as const) {
      const o = outlook({
        sayingNo: [category(DINING, { [field]: Number.POSITIVE_INFINITY }), TRAVEL],
      });

      expect(() => planAlert(o)).toThrow(RangeError);
      expect(() => planAlert(o)).toThrow(/Dining Out/);
    }

    // And NaN, which is the shape `0/0` arrives in rather than the shape a division by a positive
    // number does — it compares false against everything, so an unguarded path prints it silently.
    const nan = outlook({ sayingNo: [category(DINING, { actual: Number.NaN }), TRAVEL] });
    expect(() => planAlert(nan)).toThrow(RangeError);
  });
});

describe('the fingerprint, and duplicate suppression', () => {
  it('the fingerprint is an opaque digest carrying no category name', () => {
    const fp = message(O).fingerprint;

    expect(fp).toMatch(/^[0-9a-f]{16,}$/);
    expect(fp).not.toContain('Dining');
    expect(fp).not.toContain('Travel');
    // A `names.join('|')` key fails all three of these, and `alert_sends` rejects it on insert.
    expect(fp).not.toContain('|');
  });

  it("the fingerprint does not move when the month's spend does, because the same categories for the same reasons are not news twice", () => {
    // 350 × 30/8 = 1312.5; 1312.5 / 400 = 3.28125. Every amount on the record moves; the key does
    // not. A fingerprint over amounts re-fires daily as spend accrues, which is the noise that
    // gets a guardrail filtered, which is a deleted guardrail.
    const moved = outlook({
      sayingNo: [
        category(DINING, { actual: 350, projected: 1312.5, projectedVariance: 912.5, projectedRatio: 3.28125 }),
        TRAVEL,
      ],
    });

    expect(message(moved).fingerprint).toBe(message(O).fingerprint);
  });

  it('the fingerprint does not depend on the order the categories arrive in', () => {
    expect(message(outlook({ sayingNo: [TRAVEL, DINING] })).fingerprint).toBe(message(O).fingerprint);
  });

  it('a category joining the set changes the fingerprint, and a category escalating from projecting over to already over changes it too', () => {
    const joined = outlook({
      sayingNo: [DINING, TRAVEL, category(DINING, { categoryId: 3, category: 'Groceries', reason: 'breach' })],
    });
    const escalated = outlook({
      sayingNo: [category(DINING, { reason: 'breach' }), TRAVEL],
    });

    expect(message(joined).fingerprint).not.toBe(message(O).fingerprint);
    expect(message(escalated).fingerprint).not.toBe(message(O).fingerprint);
  });

  it('the fingerprint changes when the month does, so a breach persisting into the next month is reported again', () => {
    const nextMonth = outlook({ asOf: { year: 2026, month: 9, day: 8 } });

    expect(message(nextMonth).fingerprint).not.toBe(message(O).fingerprint);
  });

  it('the coverage message and the breach message never share a fingerprint for the same month', () => {
    const lowCoverage = outlook({
      coverage: { ...COVERAGE, coverageShare: 0.077, coveragePercent: 7, authoritative: false },
      coverageShare: 0.077,
      coveragePercent: 7,
      authoritative: false,
    });

    expect(message(lowCoverage).fingerprint).not.toBe(message(O).fingerprint);
  });

  it('a message whose fingerprint was already delivered is suppressed', () => {
    const m = message(O);

    expect(shouldSend(m, [{ fingerprint: m.fingerprint, delivered: true }])).toBe(false);
  });

  it('a message whose fingerprint was recorded as undelivered is sent again, because a failed send must never silence the retry', () => {
    // The whole reason `alert_sends.delivered` is a column rather than an implied fact. Keyed on
    // attempted, the first network blip silences the guardrail permanently, starting on a day
    // nobody was watching, with silence as the only symptom.
    const m = message(O);

    expect(shouldSend(m, [{ fingerprint: m.fingerprint, delivered: false }])).toBe(true);
  });

  it('a message whose fingerprint has never been recorded is sent', () => {
    const m = message(O);

    expect(shouldSend(m, [])).toBe(true);
    expect(shouldSend(m, [{ fingerprint: 'deadbeefdeadbeef', delivered: true }])).toBe(true);
  });
});
