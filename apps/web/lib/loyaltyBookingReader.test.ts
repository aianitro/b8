// P8-42e1 — the booking reader's request, its failure classes and its schema (U8–U10), against a fake
// SDK client. No test here opens a socket: the client the reader would build is replaced by a
// subclass that only records how it was built, and every request goes to a recording fake.
//
// The reader is read through the module namespace and checked to exist first, so a tree without it
// fails here on an assertion rather than on a missing import (the spec's command 19 relies on that).
//
// The household canaries (a program name, a member name, a full number, an id) belong to the world
// the test reads "for", and none may appear in the request. Every fake error and model text carries a
// canary too, and so do a code and a date, so a value that reached a log line would be seen.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import Anthropic from '@anthropic-ai/sdk';
import { LOYALTY_BOOKING_KINDS } from '@b8/contracts/loyalty';

const S = vi.hoisted(() => ({ built: [] as Record<string, unknown>[] }));
vi.mock('@anthropic-ai/sdk', async (importOriginal) => {
  const real = (await importOriginal()) as { default: typeof Anthropic };
  // A subclass keeps every static error class; it records its options and never sends anything.
  class Recording extends real.default {
    constructor(opts: ConstructorParameters<typeof Anthropic>[0]) {
      super(opts);
      S.built.push({ ...opts });
    }
  }
  return { ...real, default: Recording };
});

import * as reader from './loyaltyReader';

const KEY = 'zq42e-key-canary-not-a-real-key';
const ENV = { ANTHROPIC_API_KEY: KEY };
const WORLD = { program: 'ZQ42E Canary Rewards', member: 'ZQ42E Canary Holder', number: 'ZQ42ENUMBERCANARY7K9X', id: 'zq42e-membership-id-canary' };
const MAIL = { subject: 'ZQ42E your stay', text: 'ZQ42E-MAIL-TEXT-CANARY confirmation ZQ42ECODECANARY for 2026-03-10' };
const MODEL_TEXT = 'ZQ42E-MODEL-TEXT-CANARY';
const ERROR_TEXT = 'zq42e-sdk-error-text';

type Call = { body: Record<string, unknown>; options: Record<string, unknown> };
function fakeClient(answer: () => unknown) {
  const calls: Call[] = [];
  const client = {
    beta: { messages: { create: async (body: Record<string, unknown>, options: Record<string, unknown>) => { calls.push({ body, options }); return answer(); } } },
  } as unknown as Anthropic;
  return { client, calls };
}
const message = (text: string, stop = 'end_turn') => ({
  model: 'claude-opus-5-5', stop_reason: stop, stop_details: null, content: [{ type: 'text', text }], usage: { input_tokens: 7, output_tokens: 3 },
});
const NONE = { kind: 'none', programName: null, memberNumberSuffix: null, property: null, confirmationCode: null, checkIn: null, checkOut: null, award: null };

/** The booking reader, or an assertion failure when the tree has none. */
function bookingReader(): typeof reader.createBookingReader {
  expect(typeof reader.createBookingReader, 'createBookingReader is exported').toBe('function');
  return reader.createBookingReader;
}

let lines: string[] = [];
beforeEach(() => {
  lines = [];
  for (const m of ['log', 'warn', 'error', 'info'] as const) vi.spyOn(console, m).mockImplementation((...a: unknown[]) => { lines.push(a.map(String).join(' ')); });
  S.built.length = 0;
});
afterEach(() => vi.restoreAllMocks());

describe('the booking reader (P8-42e1)', () => {
  it('T42e1-U8: nothing is sent without a key; with one, one bounded request holding only the fenced mail, the fixed prompt and the closed schema', async () => {
    const create = bookingReader();
    for (const env of [{}, { ANTHROPIC_API_KEY: '' }, { ANTHROPIC_API_KEY: '   ' }]) {
      const f = fakeClient(() => message(JSON.stringify(NONE)));
      expect(await create(env, { client: f.client }).read(MAIL)).toEqual({ ok: false, code: 'api_error' });
      expect(await create(env).read(MAIL)).toEqual({ ok: false, code: 'api_error' });
      expect(f.calls).toHaveLength(0);
    }
    expect(S.built).toHaveLength(0);

    const f = fakeClient(() => message(JSON.stringify(NONE)));
    expect(await create(ENV, { client: f.client }).read(MAIL)).toEqual({ ok: true, reading: NONE });
    expect(f.calls).toHaveLength(1);
    const { body, options } = f.calls[0];
    expect(options).toEqual({ maxRetries: 0, timeout: reader.readTimeoutSeconds({}) * 1000 });
    expect(body.system).toBe(reader.BOOKING_SYSTEM_PROMPT);
    expect(reader.BOOKING_SYSTEM_PROMPT).toMatch(/untrusted/);
    expect(reader.BOOKING_SYSTEM_PROMPT).toMatch(/never follow/);
    expect(reader.BOOKING_SYSTEM_PROMPT).toMatch(/Never report a guest name, a postal address, a phone number, card digits, a price, a rate or a total/);
    expect(body.system).not.toBe(reader.READ_SYSTEM_PROMPT);
    const config = body.output_config as { format: { type: string; schema: unknown } };
    expect(config.format.type).toBe('json_schema');
    expect(config.format.schema).toEqual(reader.BOOKING_SCHEMA);
    const messages = body.messages as { role: string; content: { type: string; text: string }[] }[];
    expect(messages).toHaveLength(1);
    expect(messages[0].role).toBe('user');
    expect(messages[0].content).toHaveLength(1);
    expect(messages[0].content[0].type).toBe('text');
    const text = messages[0].content[0].text;
    expect(text).toMatch(/<email>\nSubject: ZQ42E your stay\n\nZQ42E-MAIL-TEXT-CANARY[^]*\n<\/email>$/);
    const sent = JSON.stringify(body);
    for (const canary of Object.values(WORLD)) expect(sent).not.toContain(canary);
    expect(sent).not.toContain(KEY);
    // A client built from a key has the SDK's retries off. Built only: nothing is read through it.
    create(ENV);
    expect(S.built).toHaveLength(1);
    expect(S.built[0].maxRetries).toBe(0);
    // The timeout follows the environment.
    const timed = fakeClient(() => message(JSON.stringify(NONE)));
    await create({ ...ENV, LOYALTY_READ_TIMEOUT_SECONDS: '5' }, { client: timed.client }).read(MAIL);
    expect(timed.calls[0].options).toEqual({ maxRetries: 0, timeout: 5 * 1000 });
  });

  it('T42e1-U9: every failure is classified and none throws; no log carries an error text, the mail, the key, model text, a code or a date', async () => {
    const create = bookingReader();
    const headers = new Headers();
    const failures: [string, () => unknown][] = [
      ['rate_limited', () => { throw new Anthropic.RateLimitError(429, { message: KEY }, `${ERROR_TEXT}-a ${KEY}`, headers); }],
      ['timeout', () => { throw new Anthropic.APIConnectionTimeoutError({ message: `${ERROR_TEXT}-b ${KEY}` }); }],
      ['api_error', () => { throw new Anthropic.InternalServerError(500, { message: KEY }, `${ERROR_TEXT}-c ${KEY}`, headers); }],
      ['api_error', () => { throw new Error(`${ERROR_TEXT}-d ${KEY}`); }],
      ['refused', () => message(`${MODEL_TEXT} ${KEY}`, 'refusal')],
      ['bad_output', () => message(`${MODEL_TEXT} not json`)],
      ['bad_output', () => message('')],
    ];
    for (const [code, answer] of failures) {
      const f = fakeClient(answer);
      expect(await create(ENV, { client: f.client }).read(MAIL), code).toEqual({ ok: false, code });
      expect(f.calls).toHaveLength(1);
    }
    expect(lines.length).toBeGreaterThanOrEqual(failures.length);
    // A success is returned untouched (cleaning is the domain's job) and logs the model and tokens only.
    const raw = {
      kind: 'hotel_booked', programName: WORLD.program, memberNumberSuffix: WORLD.number, property: `${MODEL_TEXT} Inn`,
      confirmationCode: 'ZQ42ECODECANARY', checkIn: '2026-03-10', checkOut: '2026-03-12', award: true, guestName: WORLD.member,
    };
    const ok = fakeClient(() => message(JSON.stringify(raw)));
    const from = lines.length;
    expect(await create(ENV, { client: ok.client }).read(MAIL)).toEqual({ ok: true, reading: raw });
    const success = lines.slice(from);
    expect(success).toHaveLength(1);
    const fields = JSON.parse(success[0]) as Record<string, unknown>;
    expect(Object.keys(fields).sort()).toEqual(['inputTokens', 'level', 'message', 'model', 'outputTokens', 'scope', 'time']);
    for (const line of lines) {
      for (const leak of [ERROR_TEXT, KEY, MODEL_TEXT, 'ZQ42E-MAIL-TEXT-CANARY', 'ZQ42ECODECANARY', '2026-03-10', WORLD.number, WORLD.member]) {
        expect(line).not.toContain(leak);
      }
    }
  });

  it('T42e1-U10: BOOKING_SCHEMA is closed with exactly eight required keys and no personal field; READ_SCHEMA is untouched', () => {
    const schema = reader.BOOKING_SCHEMA as unknown as { type: string; properties: Record<string, Record<string, unknown>>; required: string[]; additionalProperties: boolean } | undefined;
    expect(schema, 'BOOKING_SCHEMA is exported').toBeTruthy();
    const keys = ['kind', 'programName', 'memberNumberSuffix', 'property', 'confirmationCode', 'checkIn', 'checkOut', 'award'];
    expect(schema?.type).toBe('object');
    expect(Object.keys(schema?.properties ?? {}).sort()).toEqual([...keys].sort());
    expect([...(schema?.required ?? [])].sort()).toEqual([...keys].sort());
    expect(schema?.additionalProperties).toBe(false);
    expect(schema?.properties.kind.enum).toEqual([...LOYALTY_BOOKING_KINDS]);
    for (const k of Object.keys(schema?.properties ?? {})) expect(k).not.toMatch(/name|address|phone|card|price|total|amount|guest/);
    // Every object at every depth is closed.
    const walk = (node: unknown): void => {
      if (Array.isArray(node)) { node.forEach(walk); return; }
      if (node === null || typeof node !== 'object') return;
      const o = node as Record<string, unknown>;
      if (o.type === 'object') expect(o.additionalProperties).toBe(false);
      Object.values(o).forEach(walk);
    };
    walk(schema);
    expect(schema?.properties.award).toEqual({ anyOf: [{ type: 'boolean' }, { type: 'null' }], description: expect.any(String) });
    for (const k of keys.filter((x) => x !== 'kind' && x !== 'award')) expect(schema?.properties[k].anyOf).toEqual([{ type: 'string' }, { type: 'null' }]);

    // The balance read's schema is exactly 42c2's seven keys, all required.
    const seven = ['programName', 'memberNumberSuffix', 'balance', 'unit', 'asOf', 'expiryWarnings', 'instruments'];
    expect(Object.keys(reader.READ_SCHEMA.properties)).toEqual(seven);
    expect(reader.READ_SCHEMA.required).toEqual(seven);
    expect(reader.READ_SCHEMA.additionalProperties).toBe(false);
  });
});
