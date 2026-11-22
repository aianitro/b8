// P8-42c1 — the loyalty mailbox's configuration from the environment (scenario U7): every row of the
// pinned `envMatrix` in `lib/fixtures/loyalty-inbox/cases.json`, and the password-free view the
// overview, the routes and the logs see. Every value is fabricated (the canaries of `cases.json`);
// no real host, user or password exists anywhere in this suite, and nothing here opens a socket.

import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { describeInboxConfig, readInboxConfig } from './loyaltyInboxSource';

const C = JSON.parse(readFileSync(new URL('./fixtures/loyalty-inbox/cases.json', import.meta.url), 'utf8')) as {
  canaries: { password: string; user: string };
  envMatrix: { name: string; env: Record<string, string>; expect: { configured: boolean; problem: string | null; missing: string[]; mailbox?: string; timeoutSeconds?: number } }[];
};

describe('the loyalty inbox configuration (P8-42c1)', () => {
  it('T42c1-U7: the environment parse is exact, and the password-free view holds no secret', () => {
    const seen: string[] = [];
    for (const row of C.envMatrix) {
      const view = describeInboxConfig(row.env);
      expect({ configured: view.configured, problem: view.problem, missing: view.missing }, row.name).toEqual({
        configured: row.expect.configured, problem: row.expect.problem, missing: row.expect.missing,
      });
      const config = readInboxConfig(row.env);
      expect(config.ok, row.name).toBe(row.expect.configured);
      if (config.ok) {
        expect(config.mailbox, row.name).toBe(row.expect.mailbox);
        expect(config.timeoutSeconds, row.name).toBe(row.expect.timeoutSeconds);
      }
      // The described view never carries a host, user, password or mailbox value, whatever the row
      // set. (TLS and port values are words like `true` that the view's own JSON spells anyway.)
      const text = JSON.stringify(view);
      for (const k of ['LOYALTY_IMAP_HOST', 'LOYALTY_IMAP_USER', 'LOYALTY_IMAP_PASSWORD', 'LOYALTY_IMAP_MAILBOX']) {
        const v = row.env[k]?.trim();
        if (v) expect(text.includes(v), `${row.name}: ${k}'s value in the view`).toBe(false);
      }
      seen.push(row.name);
    }
    expect(seen).toEqual(C.envMatrix.map((r) => r.name));

    // A ready environment holding the canaries: none of the password, user or host reaches the view.
    const ready = C.envMatrix.find((r) => r.expect.configured && r.expect.mailbox === 'INBOX')?.env as Record<string, string>;
    const view = JSON.stringify(describeInboxConfig(ready));
    for (const secret of [C.canaries.password, C.canaries.user, ready.LOYALTY_IMAP_HOST]) expect(view.includes(secret)).toBe(false);
    expect(view).toBe(JSON.stringify({ configured: true, problem: null, missing: [] }));

    // Edges the matrix does not spell out: values are trimmed; a whitespace-only TLS is unset;
    // STARTTLS is case-sensitive; the timeout bounds are inclusive.
    const ok = { ...ready, LOYALTY_IMAP_PORT: ' 993 ' };
    expect(readInboxConfig(ok)).toMatchObject({ ok: true, port: 993, tls: 'true' });
    expect(describeInboxConfig({ ...ready, LOYALTY_IMAP_TLS: '  ' })).toEqual({ configured: false, problem: 'incomplete', missing: ['LOYALTY_IMAP_TLS'] });
    expect(describeInboxConfig({ ...ready, LOYALTY_IMAP_TLS: 'STARTTLS' }).problem).toBe('invalid_tls');
    expect(describeInboxConfig({ ...ready, LOYALTY_IMAP_PORT: '1.5' }).problem).toBe('invalid_port');
    expect(readInboxConfig({ ...ready, LOYALTY_IMAP_TIMEOUT_SECONDS: '600' })).toMatchObject({ ok: true, timeoutSeconds: 600 });
    expect(describeInboxConfig({ ...ready, LOYALTY_IMAP_TIMEOUT_SECONDS: '601' }).problem).toBe('invalid_timeout');
    expect(describeInboxConfig({ ...ready, LOYALTY_IMAP_TIMEOUT_SECONDS: '1e2' }).problem).toBe('invalid_timeout');
  });
});
