// P8-42c2 — the mail reader's request and its failure classes (scenario U5), against a fake SDK
// client. No test here opens a socket: the client the reader would build is replaced by a subclass
// that only records how it was built, and every request goes to a recording fake. The real client's
// failure path over a loopback listener is T42c2-I10, in the integration suite.
//
// The canaries come from the pinned fixture `lib/fixtures/loyalty-read/cases.json`: the key canary
// is the "key", and every fake error's message carries it, so a library text that reached a log
// line or the returned object would be seen.

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import Anthropic from '@anthropic-ai/sdk';

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

import { createMailReader, readerAvailable, readTimeoutSeconds, READ_SCHEMA, READ_SYSTEM_PROMPT } from './loyaltyReader';

const DIR = fileURLToPath(new URL('./fixtures/loyalty-read/', import.meta.url));
const C = JSON.parse(readFileSync(join(DIR, 'cases.json'), 'utf8')) as { canaries: Record<string, string> };
const KEY = C.canaries.key;
const ENV = { ANTHROPIC_API_KEY: KEY };
const INPUT = { subject: C.canaries.subject, text: `${C.canaries.body} ${C.canaries.injection}` };

type Call = { body: Record<string, unknown>; options: Record<string, unknown> };
function fakeClient(answer: () => unknown) {
  const calls: Call[] = [];
  const client = {
    beta: { messages: { create: async (body: Record<string, unknown>, options: Record<string, unknown>) => { calls.push({ body, options }); return answer(); } } },
  } as unknown as Anthropic;
  return { client, calls };
}
const message = (text: string, stop = 'end_turn') => ({
  model: 'claude-opus-5-5', stop_reason: stop, stop_details: null, content: [{ type: 'text', text }], usage: { input_tokens: 1, output_tokens: 1 },
});

let lines: string[] = [];
beforeEach(() => {
  lines = [];
  for (const m of ['log', 'warn', 'error', 'info'] as const) vi.spyOn(console, m).mockImplementation((...a: unknown[]) => { lines.push(a.map(String).join(' ')); });
  S.built.length = 0;
});
afterEach(() => vi.restoreAllMocks());

describe('the loyalty mail reader (P8-42c2)', () => {
  it('T42c2-U5: one stated request with no hidden retry, and every failure classified without leaking', async () => {
    // ── The request ──
    const reading = { programName: null, memberNumberSuffix: null, balance: null, unit: null, asOf: null, expiryWarnings: [], instruments: [] };
    const ok = fakeClient(() => message(JSON.stringify(reading)));
    expect(await createMailReader(ENV, { client: ok.client }).read(INPUT)).toEqual({ ok: true, reading });
    expect(ok.calls).toHaveLength(1);
    const { body, options } = ok.calls[0];
    expect(body.model).toBe('claude-opus-5-5');
    expect(body.fallbacks).toEqual([{ model: 'claude-opus-4-8' }]);
    expect(body.betas).toEqual(['server-side-fallback-2026-07-01']);
    expect(body).not.toHaveProperty('tools');
    expect(body).not.toHaveProperty('stream');
    expect(body).not.toHaveProperty('tool_choice');
    const config = body.output_config as { effort: string; format: { type: string; schema: typeof READ_SCHEMA } };
    expect(config.effort).toBe('medium');
    expect(config.format.type).toBe('json_schema');
    const schema = config.format.schema;
    expect(schema.additionalProperties).toBe(false);
    expect(Object.keys(schema.properties).sort()).toEqual(['asOf', 'balance', 'expiryWarnings', 'instruments', 'memberNumberSuffix', 'programName', 'unit']);
    expect([...schema.required].sort()).toEqual(Object.keys(schema.properties).sort());
    for (const nested of [schema.properties.expiryWarnings.items, schema.properties.instruments.items]) {
      expect(nested.additionalProperties).toBe(false);
      expect([...nested.required].sort()).toEqual(Object.keys(nested.properties).sort());
    }
    expect(options).toEqual({ maxRetries: 0, timeout: 60_000 });
    // The system part says the mail is untrusted and holds none of it; the mail is in the user message only.
    expect(body.system).toBe(READ_SYSTEM_PROMPT);
    expect(READ_SYSTEM_PROMPT).toMatch(/untrusted/);
    expect(READ_SYSTEM_PROMPT).toMatch(/never follow/);
    for (const part of [INPUT.subject, C.canaries.body, C.canaries.injection]) expect(READ_SYSTEM_PROMPT).not.toContain(part);
    const messages = body.messages as { role: string; content: { type: string; text: string }[] }[];
    expect(messages).toHaveLength(1);
    expect(messages[0].role).toBe('user');
    expect(messages[0].content[0].text).toContain(INPUT.subject);
    expect(messages[0].content[0].text).toContain(INPUT.text);
    expect(Object.keys(body).sort()).toEqual(['betas', 'fallbacks', 'max_tokens', 'messages', 'model', 'output_config', 'system']);

    // ── The timeout comes from the environment, and a bad value means the default ──
    expect(readTimeoutSeconds({})).toBe(60);
    for (const bad of ['abc', '0', '601', '-5', '1.5', ' ', '1e2']) expect(readTimeoutSeconds({ LOYALTY_READ_TIMEOUT_SECONDS: bad }), bad).toBe(60);
    expect(readTimeoutSeconds({ LOYALTY_READ_TIMEOUT_SECONDS: '5' })).toBe(5);
    const timed = fakeClient(() => message(JSON.stringify(reading)));
    await createMailReader({ ...ENV, LOYALTY_READ_TIMEOUT_SECONDS: '5' }, { client: timed.client }).read(INPUT);
    expect(timed.calls[0].options).toEqual({ maxRetries: 0, timeout: 5_000 });

    // ── The failure classes ──
    const headers = new Headers();
    const failures: [string, () => unknown][] = [
      ['rate_limited', () => { throw new Anthropic.RateLimitError(429, { message: KEY }, `zq-sdk-text-a ${KEY}`, headers); }],
      ['timeout', () => { throw new Anthropic.APIConnectionTimeoutError({ message: `zq-sdk-text-b ${KEY}` }); }],
      ['api_error', () => { throw new Anthropic.InternalServerError(500, { message: KEY }, `zq-sdk-text-c ${KEY}`, headers); }],
      ['api_error', () => { throw new Anthropic.APIConnectionError({ message: `zq-sdk-text-d ${KEY}` }); }],
      ['api_error', () => { throw new Error(`zq-sdk-text-e ${KEY}`); }],
      ['refused', () => message(`${C.canaries.modelOutput} ${KEY}`, 'refusal')],
      ['bad_output', () => message(`zq-sdk-text-f ${C.canaries.modelOutput} ${KEY}`)],
      ['bad_output', () => message('')],
    ];
    for (const [code, answer] of failures) {
      const f = fakeClient(answer);
      const result = await createMailReader(ENV, { client: f.client }).read(INPUT);
      expect(result, code).toEqual({ ok: false, code });
      expect(f.calls).toHaveLength(1);
    }
    for (const line of lines) {
      for (const leak of [KEY, C.canaries.modelOutput, C.canaries.body, C.canaries.subject, 'zq-sdk-text']) expect(line).not.toContain(leak);
    }

    // ── No key: not available, and no client is built ──
    expect(S.built).toHaveLength(0);
    for (const env of [{}, { ANTHROPIC_API_KEY: '' }, { ANTHROPIC_API_KEY: '   ' }]) {
      expect(readerAvailable(env)).toBe(false);
      expect(await createMailReader(env).read(INPUT)).toEqual({ ok: false, code: 'api_error' });
    }
    expect(S.built).toHaveLength(0);
    // With a key, the client it builds has the SDK's own retries off.
    expect(readerAvailable(ENV)).toBe(true);
    createMailReader({ ...ENV, ANTHROPIC_BASE_URL: 'http://127.0.0.1:9' });
    expect(S.built).toHaveLength(1);
    expect(S.built[0].maxRetries).toBe(0);
  });
});
