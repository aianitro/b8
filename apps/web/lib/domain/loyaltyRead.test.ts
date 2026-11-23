// P8-42c2 — the pure reading rules over the pinned fixtures (scenarios U2 to U4): the clean pass, the
// decision order with the suffix and jump rules, and what is prepared for the model.
//
// THE FIXTURES ARE PINNED. `lib/fixtures/loyalty-read/` (six `.eml` files and `cases.json`) is
// fabricated, carries the canary ZQ42C2, and is pinned by a SHA-256 in the spec's command 16. Every
// expected value below is read from it, never written here, and every group walked is collected into
// `seen` and compared with the group's own ids, so no case is silently skipped.
//
// THE DATE TOKENS. `{{DAY:n}}` means CURRENT_DATE plus n in Postgres. These tests have no database,
// so "today" is one fixed calendar day and the offsets are added to it in UTC day arithmetic. Every
// rule here compares dates only with each other and with "today plus one", so the choice of day
// cannot change an outcome, and the time zone the suite runs in (command 7 runs two) is never read.

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { LOYALTY_READ_MAX_CHARS, type LoyaltyUnit } from '@b8/contracts/loyalty';
import { textForReader } from './loyaltyInbox';
import {
  cleanReading,
  decideReading,
  jumpVerdict,
  keepSuffix,
  matchSuffix,
  type StoredReading,
  type SuffixCandidate,
} from './loyaltyRead';

const DIR = fileURLToPath(new URL('../fixtures/loyalty-read/', import.meta.url));
type Baseline = { balance: string; unit: LoyaltyUnit; asOfOffset: number } | null;
interface Fixture {
  canaries: Record<string, string> & { addresses: string[] };
  programs: { id: string; name: string; defaultUnit: LoyaltyUnit; aliases?: string[] }[];
  memberships: { id: string; program: string; member: string; memberNumber: string | null; baseline: Baseline }[];
  notMine: { program: string; suffix: string }[];
  decisions: {
    id: string; program: string; reader: Record<string, unknown>;
    expect: { state: string; reason: string | null; membership: string | null; observation: boolean; balanceAfter: string | null };
  }[];
  clean: { id: string; input: unknown; expect: unknown }[];
  suffix: { id: string; printed: string | null; kept: string | null }[];
  jump: { id: string; unit: LoyaltyUnit; baseline: string | null; candidate: string; verdict: string }[];
}
const C = JSON.parse(readFileSync(join(DIR, 'cases.json'), 'utf8')) as Fixture;
const eml = (id: string) => readFileSync(join(DIR, `${id}.eml`));

/** The fixed "today" these pure tests stand in for CURRENT_DATE, and day arithmetic on it in UTC. */
const TODAY_UTC = Date.UTC(2026, 5, 15);
const DAY_MS = 86_400_000;
const day = (n: number) => new Date(TODAY_UTC + n * DAY_MS).toISOString().slice(0, 10);
/** Replaces every `{{DAY:n}}` token in a fixture value, at any depth. */
const resolve = <T,>(v: T): T => JSON.parse(JSON.stringify(v).replace(/\{\{DAY:(-?\d+)\}\}/g, (_, n) => day(Number(n))));

// Numeric ids stand in for the database's, in fixture order.
const programId = new Map(C.programs.map((p, i) => [p.id, i + 1]));
const membershipId = new Map(C.memberships.map((m, i) => [m.id, i + 101]));
const membershipName = new Map([...membershipId].map(([k, v]) => [v, k]));
const candidates: SuffixCandidate[] = C.memberships.map((m) => ({
  id: membershipId.get(m.id) as number, programId: programId.get(m.program) as number, number: m.memberNumber,
}));
const baselineOf = (id: string) => C.memberships.find((m) => m.id === id)?.baseline ?? null;
const current = new Map<number, StoredReading>();
for (const m of C.memberships) {
  if (m.baseline) current.set(membershipId.get(m.id) as number, { balance: m.baseline.balance, unit: m.baseline.unit, asOf: day(m.baseline.asOfOffset) });
}

function decide(program: string, reader: unknown, notMine?: string[]) {
  const p = C.programs.find((x) => x.id === program);
  if (!p) throw new Error(`no program ${program}`);
  return decideReading({
    reading: cleanReading(resolve(reader)),
    programId: programId.get(program) as number,
    programNames: [p.name, ...(p.aliases ?? [])],
    defaultUnit: p.defaultUnit,
    memberships: candidates,
    notMine: notMine ?? C.notMine.filter((n) => n.program === program).map((n) => n.suffix),
    current,
    latestAsOf: day(1),
  });
}

describe('the loyalty inbox reading rules, pure (P8-42c2)', () => {
  it('T42c2-U2: the clean pass keeps only well-formed fields, exactly, and drops everything else', () => {
    const seen: string[] = [];
    for (const c of C.clean) {
      expect(cleanReading(c.input), c.id).toEqual(c.expect);
      seen.push(c.id);
    }
    expect(seen).toEqual(C.clean.map((c) => c.id));

    // No string the model wrote survives as free text: every kept string is an enum, a date, decimal
    // text or the kept suffix, whatever the input carried.
    const keptStrings = (v: unknown): string[] =>
      typeof v === 'string' ? [v] : Array.isArray(v) ? v.flatMap(keptStrings) : v && typeof v === 'object' ? Object.values(v).flatMap(keptStrings) : [];
    for (const c of C.clean) {
      const out = cleanReading(c.input);
      for (const s of keptStrings({ ...out, programName: null })) {
        expect(s, c.id).toMatch(/^(?:[a-z_]+|\d{4}-\d{2}-\d{2}|\d+(?:\.\d{2})?|[A-Z0-9]{3,4})$/);
        expect(s, c.id).not.toContain('ZQ42C2');
      }
      // The check-only program form is lower-case alphanumerics, never markup.
      if (out.programName !== null) expect(out.programName, c.id).toMatch(/^[a-z0-9]{1,60}$/);
    }
    // Anything that is not an object is wholly empty, and the empty result is never shared.
    for (const v of [null, undefined, 'text', 7, []]) expect(cleanReading(v)).toEqual(C.clean.find((c) => c.id === 'not-an-object')?.expect);
  });

  it('T42c2-U3: the decision order, the suffix rule and the jump rule decide every fixture case', () => {
    const seen: string[] = [];
    for (const d of C.decisions) {
      const got = decide(d.program, d.reader);
      expect({ state: got.state, reason: got.reason, membership: got.membershipId === null ? null : membershipName.get(got.membershipId) }, d.id)
        .toEqual({ state: d.expect.state, reason: d.expect.reason, membership: d.expect.membership });
      // Only an applied reading appends, and what is current afterwards follows from that alone.
      expect(got.state === 'applied', d.id).toBe(d.expect.observation);
      const reading = cleanReading(resolve(d.reader));
      const after = d.expect.membership === null ? null : got.state === 'applied' ? reading.balance : baselineOf(d.expect.membership)?.balance ?? null;
      expect(after, d.id).toBe(d.expect.balanceAfter);
      // A reading without a balance, a stale one and a known not-mine one are never queued.
      if (['no_balance', 'stale', 'not_mine_known'].includes(got.state)) expect(got.reason, d.id).toBeNull();
      seen.push(d.id);
    }
    expect(seen).toEqual(C.decisions.map((d) => d.id));

    const seenSuffix: string[] = [];
    for (const s of C.suffix) { expect(keepSuffix(s.printed), s.id).toBe(s.kept); seenSuffix.push(s.id); }
    expect(seenSuffix).toEqual(C.suffix.map((s) => s.id));

    const seenJump: string[] = [];
    for (const j of C.jump) { expect(jumpVerdict(j.baseline, j.candidate, j.unit), j.id).toBe(j.verdict); seenJump.push(j.id); }
    expect(seenJump).toEqual(C.jump.map((j) => j.id));

    // An ambiguous suffix is never a match, and a membership of another program never matches.
    const amb = C.decisions.find((d) => d.id === 'suffix-ambiguous');
    const ambSuffix = keepSuffix(amb?.reader.memberNumberSuffix) as string;
    expect(matchSuffix(ambSuffix, programId.get('air') as number, candidates)).toEqual({ kind: 'ambiguous' });
    const other = C.decisions.find((d) => d.id === 'suffix-other-program-only');
    expect(matchSuffix(keepSuffix(other?.reader.memberNumberSuffix) as string, programId.get('air') as number, candidates)).toEqual({ kind: 'unmatched' });
    // A suffix must END the number: the same digits inside it are not a match.
    const inner = (C.memberships.find((m) => m.id === 'a-apply')?.memberNumber as string).slice(-6, -2);
    expect(matchSuffix(inner, programId.get('air') as number, candidates)).toEqual({ kind: 'unmatched' });
    // A not-mine record never outranks a real membership: listing the applying suffix changes nothing.
    const ok = C.decisions.find((d) => d.id === 'apply-ok');
    expect(decide('air', ok?.reader, [keepSuffix(ok?.reader.memberNumberSuffix) as string]).state).toBe('applied');
    // Zero is a reading, never "nothing": zero against zero applies, against a positive balance queues.
    expect(jumpVerdict('0', '0', 'miles')).toBe('pass');
    expect(jumpVerdict(C.jump.find((j) => j.id === 'zero-candidate')?.baseline ?? null, '0', 'miles')).toBe('implausible_jump');
  });

  it('T42c2-U4: what is prepared for the model is the subject and the text, without headers, links, attachments or markup', async () => {
    const k = C.canaries;
    const r01 = await textForReader(eml('R01'), LOYALTY_READ_MAX_CHARS);
    expect(Object.keys(r01).sort()).toEqual(['subject', 'text']);
    const r01All = `${r01.subject}\n${r01.text}`;
    expect(r01.subject).toContain(k.subject);
    expect(r01.text).toContain(k.body);
    for (const absent of [k.header, k.urlToken, 'zq42c2-r01@', 'Delivered-To', 'Received', ...k.addresses]) expect(r01All).not.toContain(absent);
    expect(r01.text).toContain('[link]');
    expect(r01.text).not.toMatch(/https?:\/\//);

    const r02 = await textForReader(eml('R02'), LOYALTY_READ_MAX_CHARS);
    expect(r02.text).toContain(k.htmlVisible);
    for (const absent of [k.script, k.urlTokenHtml, '<p>', '<a', 'href']) expect(r02.text).not.toContain(absent);

    const r03 = await textForReader(eml('R03'), LOYALTY_READ_MAX_CHARS);
    expect(r03.text).toBe('');
    expect(`${r03.subject}`).not.toContain(k.attachment);

    const r04 = await textForReader(eml('R04'), LOYALTY_READ_MAX_CHARS);
    expect(Array.from(r04.text).length).toBe(LOYALTY_READ_MAX_CHARS);
    expect(r04.text).toContain(k.head);
    expect(r04.text).not.toContain(k.tail);

    const r06 = await textForReader(eml('R06'), LOYALTY_READ_MAX_CHARS);
    expect(r06.text).toContain(k.textPart);
    expect(r06.text).not.toContain(k.htmlPart);
  });
});
