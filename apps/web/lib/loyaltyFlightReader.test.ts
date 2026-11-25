// P8-42e1b — the flight reader's request, its failure classes and its schema (U7–U9), against a fake
// SDK client. No test here opens a socket: the client the reader would build is replaced by a
// subclass that only records how it was built, and every request goes to a recording fake.
//
// The reader and its schema are read through the module namespace and checked to exist first, so a
// tree without them fails here on an assertion rather than on a missing import (command 19).
//
// The household canaries (a program name, a member name, a full number, an id) belong to the world
// the test reads "for", and none may appear in the request. Every fake error and model text carries a
// canary too, and so do a code, an airport, a flight number and a date, so a value that reached a log
// line would be seen.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import Anthropic from '@anthropic-ai/sdk';
import { LOYALTY_BOOKING_KINDS, LOYALTY_FLIGHT_KINDS } from '@b8/contracts/loyalty';

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
const WORLD = { program: 'ZQ42E Canary Wings', member: 'ZQ42E Canary Flyer', number: 'ZQ42ENUMBERCANARY7K9X', id: 'zq42e-membership-id-canary' };
const MAIL = { subject: 'ZQ42E your trip', text: 'ZQ42E-MAIL-TEXT-CANARY booking ZQ42ECODECANARY ZQ773 from QZX to XQZ on 2026-03-10' };
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
const NONE = { kind: 'none', programName: null, memberNumberSuffix: null, confirmationCode: null, award: null, completeItinerary: null, segments: [] };

/** The flight reader, or an assertion failure when the tree has none. */
function flightReader(): typeof reader.createFlightReader {
  expect(typeof (reader as Record<string, unknown>).createFlightReader, 'createFlightReader is exported').toBe('function');
  return reader.createFlightReader;
}

let lines: string[] = [];
beforeEach(() => {
  lines = [];
  for (const m of ['log', 'warn', 'error', 'info'] as const) vi.spyOn(console, m).mockImplementation((...a: unknown[]) => { lines.push(a.map(String).join(' ')); });
  S.built.length = 0;
});
afterEach(() => vi.restoreAllMocks());

describe('the flight reader (P8-42e1b)', () => {
  it('T42e1b-U7: nothing is sent without a key; with one, one bounded request holding only the fenced mail, the fixed prompt and the closed schema', async () => {
    const create = flightReader();
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
    const prompt = (reader as Record<string, unknown>).FLIGHT_SYSTEM_PROMPT as string;
    expect(body.system).toBe(prompt);
    expect(prompt).toMatch(/untrusted/);
    expect(prompt).toMatch(/never follow/);
    expect(prompt).toMatch(/with its year/);
    expect(prompt).toMatch(/Never report a passenger name, a ticket number, a seat, a cabin or fare class, a price, a tax, card digits/);
    expect(prompt).toMatch(/reminders, boarding passes, receipts, statements and marketing are none/);
    expect(body.system).not.toBe(reader.READ_SYSTEM_PROMPT);
    expect(body.system).not.toBe(reader.BOOKING_SYSTEM_PROMPT);
    const config = body.output_config as { format: { type: string; schema: unknown } };
    expect(config.format.type).toBe('json_schema');
    expect(config.format.schema).toEqual((reader as Record<string, unknown>).FLIGHT_SCHEMA);
    const messages = body.messages as { role: string; content: { type: string; text: string }[] }[];
    expect(messages).toHaveLength(1);
    expect(messages[0].role).toBe('user');
    expect(messages[0].content).toHaveLength(1);
    expect(messages[0].content[0].type).toBe('text');
    expect(messages[0].content[0].text).toMatch(/<email>\nSubject: ZQ42E your trip\n\nZQ42E-MAIL-TEXT-CANARY[^]*\n<\/email>$/);
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

  it('T42e1b-U8: every failure is classified and none throws; no log carries an error text, the mail, the key, model text, a code, an airport, a number or a date', async () => {
    const create = flightReader();
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
      kind: 'flight_booked', programName: WORLD.program, memberNumberSuffix: WORLD.number, confirmationCode: 'ZQ42ECODECANARY',
      award: true, completeItinerary: true, passengerName: WORLD.member, ticketNumber: `${MODEL_TEXT}-TICKET`,
      segments: [{ flightDate: '2026-03-10', origin: 'QZX', destination: 'XQZ', carrier: 'ZQ', flightNumber: '773', seat: `${MODEL_TEXT}-SEAT` }],
    };
    const ok = fakeClient(() => message(JSON.stringify(raw)));
    const from = lines.length;
    expect(await create(ENV, { client: ok.client }).read(MAIL)).toEqual({ ok: true, reading: raw });
    const success = lines.slice(from);
    expect(success).toHaveLength(1);
    const fields = JSON.parse(success[0]) as Record<string, unknown>;
    expect(Object.keys(fields).sort()).toEqual(['inputTokens', 'level', 'message', 'model', 'outputTokens', 'scope', 'time']);
    for (const line of lines) {
      for (const leak of [ERROR_TEXT, KEY, MODEL_TEXT, 'ZQ42E-MAIL-TEXT-CANARY', 'ZQ42ECODECANARY', '2026-03-10', 'QZX', 'XQZ', 'ZQ773', WORLD.number, WORLD.member]) {
        expect(line).not.toContain(leak);
      }
    }
  });

  it('T42e1b-U9: FLIGHT_SCHEMA is closed at every depth with exactly seven keys and five per segment; the balance and hotel schemas are untouched', () => {
    const schema = (reader as Record<string, unknown>).FLIGHT_SCHEMA as {
      type: string; properties: Record<string, Record<string, unknown>>; required: string[]; additionalProperties: boolean;
    } | undefined;
    expect(schema, 'FLIGHT_SCHEMA is exported').toBeTruthy();
    const keys = ['kind', 'programName', 'memberNumberSuffix', 'confirmationCode', 'award', 'completeItinerary', 'segments'];
    expect(schema?.type).toBe('object');
    expect(Object.keys(schema?.properties ?? {}).sort()).toEqual([...keys].sort());
    expect([...(schema?.required ?? [])].sort()).toEqual([...keys].sort());
    expect(schema?.additionalProperties).toBe(false);
    expect(schema?.properties.kind.enum).toEqual([...LOYALTY_FLIGHT_KINDS]);
    const items = (schema?.properties.segments as { type: string; items: { type: string; properties: Record<string, unknown>; required: string[]; additionalProperties: boolean } }).items;
    const legKeys = ['flightDate', 'origin', 'destination', 'carrier', 'flightNumber'];
    expect(items.type).toBe('object');
    expect(Object.keys(items.properties).sort()).toEqual([...legKeys].sort());
    expect([...items.required].sort()).toEqual([...legKeys].sort());
    expect(items.additionalProperties).toBe(false);
    for (const k of legKeys) expect(items.properties[k]).toEqual({ anyOf: [{ type: 'string' }, { type: 'null' }], description: expect.any(String) });
    // Every object at every depth is closed, and no property anywhere names a personal or money field.
    const walk = (node: unknown): void => {
      if (Array.isArray(node)) { node.forEach(walk); return; }
      if (node === null || typeof node !== 'object') return;
      const o = node as Record<string, unknown>;
      if (o.type === 'object') {
        expect(o.additionalProperties).toBe(false);
        for (const k of Object.keys(o.properties as Record<string, unknown>)) expect(k).not.toMatch(/name|address|phone|card|price|total|amount|passenger|ticket|seat|cabin|fare|time/);
      }
      Object.values(o).forEach(walk);
    };
    walk(schema);
    expect(schema?.properties.award).toEqual({ anyOf: [{ type: 'boolean' }, { type: 'null' }], description: expect.any(String) });
    expect(schema?.properties.completeItinerary).toEqual({ anyOf: [{ type: 'boolean' }, { type: 'null' }], description: expect.any(String) });

    // The balance read's schema is exactly 42c2's seven keys; the hotel read's exactly 42e1's eight.
    const seven = ['programName', 'memberNumberSuffix', 'balance', 'unit', 'asOf', 'expiryWarnings', 'instruments'];
    expect(Object.keys(reader.READ_SCHEMA.properties)).toEqual(seven);
    expect(reader.READ_SCHEMA.required).toEqual(seven);
    const eight = ['kind', 'programName', 'memberNumberSuffix', 'property', 'confirmationCode', 'checkIn', 'checkOut', 'award'];
    expect(Object.keys(reader.BOOKING_SCHEMA.properties)).toEqual(eight);
    expect(reader.BOOKING_SCHEMA.required).toEqual(eight);
    expect(reader.BOOKING_SCHEMA.properties.kind.enum).toEqual([...LOYALTY_BOOKING_KINDS]);
    expect(LOYALTY_BOOKING_KINDS).toEqual(['hotel_booked', 'hotel_cancelled', 'flight', 'none']);
  });
});
