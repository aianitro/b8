// P8-42c3 ORACLE — written by the orchestrator at G0 (extended by amendments A2 and A3) and pinned by digest (SPEC.md command 13). The implementer
// does not edit this file. Every expected value is read from cases.json; nothing here is a literal expectation.
// No clock, no database, no network: textForReader is pure over the bytes it is handed.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { LOYALTY_READ_MAX_CHARS } from '@b8/contracts/loyalty';
import { textForReader } from '../../domain/loyaltyInbox';

type Origin = 'direct' | 'inline' | 'attachment';
interface Expected { subject: string | null; text: string }
interface Shape {
  id: string; eml: string; origin: Origin | 'omitted';
  expect?: Expected; expectSubject?: string | null;
  contains?: string[]; absent?: string[]; linkCount?: number; addressCount?: number;
}
interface Cases {
  envelope: string;
  shapes: Shape[];
  scrub: { id: string; body: string; expect: string }[];
  inlineBlocks: { id: string; lines: string[]; expectLines: string[] }[];
  cap: { id: string; fillerUnit: string; fillerLength: number; address: string; tail: string; forbiddenFragment: string }[];
  longRun: { id: string; unit: string; length: number; where: 'body' | 'subject'; expect: string | null }[];
  edge: { id: string; body: [string, number][]; expect: [string, number][]; forbiddenFragment?: string }[];
}

const DIR = __dirname;
const cases = JSON.parse(readFileSync(join(DIR, 'cases.json'), 'utf8')) as Cases;
const wrap = (body: string) => Buffer.from(cases.envelope.replace('{{BODY}}', body));
const count = (text: string, token: string) => text.split(token).length - 1;
const read = (raw: Buffer, origin: Shape['origin']) =>
  origin === 'omitted' ? textForReader(raw, LOYALTY_READ_MAX_CHARS) : textForReader(raw, LOYALTY_READ_MAX_CHARS, origin);

describe('what the model receives of a stored loyalty message (P8-42c3)', () => {
  it('T42c3-U1: the scrub replaces exactly what the patterns name and leaves every collision shape byte-identical', async () => {
    const seen: string[] = [];
    for (const s of cases.scrub) {
      const r = await textForReader(wrap(s.body), LOYALTY_READ_MAX_CHARS);
      expect(r.text, s.id).toBe(s.expect);
      seen.push(s.id);
    }
    expect(seen).toEqual(cases.scrub.map((s) => s.id));
    const capSeen: string[] = [];
    for (const c of cases.cap) {
      const filler = c.fillerUnit.repeat(Math.ceil(c.fillerLength / c.fillerUnit.length)).slice(0, c.fillerLength);
      const r = await textForReader(wrap(`${filler} ${c.address}${c.tail}`), LOYALTY_READ_MAX_CHARS);
      expect(Array.from(r.text).length, c.id).toBeLessThanOrEqual(LOYALTY_READ_MAX_CHARS);
      expect(r.text.startsWith(filler), c.id).toBe(true);
      expect(r.text.includes(c.forbiddenFragment), c.id).toBe(false);
      capSeen.push(c.id);
    }
    expect(capSeen).toEqual(cases.cap.map((c) => c.id));
    // A2/A3: a run far longer than maxChars with no whitespace is cut by the bound before the scrub, inside the run,
    // so the whole run is dropped; and the call returns within this test's timeout.
    const runSeen: string[] = [];
    for (const l of cases.longRun) {
      const run = l.unit.repeat(Math.ceil(l.length / l.unit.length)).slice(0, l.length);
      const raw = l.where === 'body'
        ? wrap(run)
        : Buffer.from(cases.envelope.replace('Subject: ZQ42C3 envelope', `Subject: ${run}`).replace('{{BODY}}', 'ZQ42C3 body'));
      const r = await textForReader(raw, LOYALTY_READ_MAX_CHARS);
      if (l.where === 'body') expect(r.text, l.id).toBe(l.expect);
      else expect(r.subject, l.id).toBe(l.expect);
      runSeen.push(l.id);
    }
    expect(runSeen).toEqual(cases.longRun.map((l) => l.id));
    // A3: the bound never leaves a partial token for the scrub to miss, even when the scrub then shortens the text.
    const build = (parts: [string, number][]) => parts.map(([t, n]) => t.repeat(n)).join('');
    const edgeSeen: string[] = [];
    for (const e of cases.edge) {
      const r = await textForReader(wrap(build(e.body)), LOYALTY_READ_MAX_CHARS);
      expect(r.text, e.id).toBe(build(e.expect));
      if (e.forbiddenFragment) expect(r.text.includes(e.forbiddenFragment), e.id).toBe(false);
      edgeSeen.push(e.id);
    }
    expect(edgeSeen).toEqual(cases.edge.map((e) => e.id));
  }, 30_000);

  it('T42c3-U2: each message shape gives the model exactly the subject and text of the chosen message', async () => {
    const seen: string[] = [];
    for (const s of cases.shapes) {
      const r = await read(readFileSync(join(DIR, `${s.eml}.eml`)), s.origin);
      expect(Object.keys(r).sort(), s.id).toEqual(['subject', 'text']);
      if (s.expect) {
        expect(r.subject, s.id).toBe(s.expect.subject);
        expect(r.text, s.id).toBe(s.expect.text);
      } else {
        expect(r.subject, s.id).toBe(s.expectSubject);
        for (const x of s.contains ?? []) expect(r.text.includes(x), `${s.id} contains ${x}`).toBe(true);
        expect(count(r.text, '[link]'), `${s.id} links`).toBe(s.linkCount);
        expect(count(r.text, '[address]'), `${s.id} addresses`).toBe(s.addressCount);
      }
      for (const x of s.absent ?? []) {
        expect(r.text.includes(x), `${s.id} text holds ${x}`).toBe(false);
        expect((r.subject ?? '').includes(x), `${s.id} subject holds ${x}`).toBe(false);
      }
      seen.push(s.id);
    }
    expect(seen).toEqual(cases.shapes.map((s) => s.id));
  });

  it('T42c3-U3: the inline-forward header block is removed exactly as defined', async () => {
    const seen: string[] = [];
    for (const b of cases.inlineBlocks) {
      const r = await textForReader(wrap(b.lines.join('\n')), LOYALTY_READ_MAX_CHARS);
      expect(r.text, b.id).toBe(b.expectLines.join('\n'));
      seen.push(b.id);
    }
    expect(seen).toEqual(cases.inlineBlocks.map((b) => b.id));
  });
});
