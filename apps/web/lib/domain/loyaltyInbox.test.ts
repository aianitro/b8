// P8-42c1 — the pure inbox decisions over the pinned fixtures (scenarios U2 to U5): which domains may
// be allowlisted and which senders match them, which header is the sender, how a forwarded original
// is recovered (and from whom it is believed), and who a message was for.
//
// THE FIXTURES ARE PINNED. `lib/fixtures/loyalty-inbox/` (27 `.eml` files and `cases.json`) is
// fabricated, carries the canary ZQ42C, and is pinned by a SHA-256 in the spec's command 16, so a
// case cannot be reshaped to fit this parser. Every case group used here is walked into `seen` and
// compared with the group's own ids, so no case is silently skipped.
//
// THE DATE TOKENS. Each `.eml` carries `{{DAY:-n}}` tokens. The integration suite replaces them with
// dates Postgres computes; these pure tests have no database, and nothing they assert depends on a
// date (sender, origin, recipients and attribution are read from addresses alone), so the tokens are
// replaced by one fixed RFC 2822 text. No clock is read.

import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  analyseMessage,
  attributeMessage,
  matchSenderDomain,
  outerFromAddress,
  senderDomainOf,
  storedForwardingAddress,
  storedSenderDomain,
} from './loyaltyInbox';

const DIR = fileURLToPath(new URL('../fixtures/loyalty-inbox/', import.meta.url));
interface Case { id: string; file: string; expect: { outcome: string; domain?: string; program?: string; origin?: string; attribution?: string; member?: string } }
const C = JSON.parse(readFileSync(join(DIR, 'cases.json'), 'utf8')) as {
  people: { A: string; B: string; stranger: string; inbox: string };
  programs: { brand: { domain: string }; air: { domain: string } };
  messages: Case[];
  domainAccept: { input: string; stored: string }[];
  domainRefuse: string[];
};
const FIXED_DATE = 'Mon, 02 Mar 2026 12:00:00 +0000';
const eml = (id: string) => {
  const file = readdirSync(DIR).find((f) => f.startsWith(`${id}-`)) as string;
  return Buffer.from(readFileSync(join(DIR, file), 'utf8').replace(/\{\{DAY:-[0-9]+\}\}/g, FIXED_DATE), 'utf8');
};
const caseOf = (id: string) => C.messages.find((m) => m.id === id) as Case;

const A_ID = 1;
const B_ID = 2;
const memberOf = new Map([[C.people.A, A_ID], [C.people.B, B_ID]]);
const registered = new Set(memberOf.keys());
const memberIdOf = (m: string | undefined) => (m === 'A' ? A_ID : m === 'B' ? B_ID : null);

describe('the loyalty inbox, pure (P8-42c1)', () => {
  it('T42c1-U2: sender domains are validated by the contract rules and matched by equality or a dot-suffix, longest first', () => {
    const seen: string[] = [];
    for (const { input, stored } of C.domainAccept) { expect(storedSenderDomain(input), input).toBe(stored); seen.push(input); }
    for (const input of C.domainRefuse) { expect(storedSenderDomain(input), input).toBeNull(); seen.push(input); }
    expect(seen).toEqual([...C.domainAccept.map((d) => d.input), ...C.domainRefuse]);

    const brand = C.programs.brand.domain;
    const stored = [{ domain: brand, programId: 7 }];
    for (const d of [brand, `mail.${brand}`, `a.b.${brand}`, brand.toUpperCase()]) expect(matchSenderDomain(d, stored), d).toEqual(stored[0]);
    const lookalikes = [`${brand}.attacker.test`, `not${brand}`, `x${brand}`, `${brand}.`, brand.slice(0, -1), 'attacker.test',
      `${brand}@attacker.test`, '', 'zq42c-brànd.test', 'xn--zq42c-brnd-xya.test'];
    for (const d of lookalikes) expect(matchSenderDomain(d, stored), d).toBeNull();
    expect(matchSenderDomain(null, stored)).toBeNull();

    // Longest stored domain wins, in either stored order.
    const nested = [{ domain: brand, programId: 7 }, { domain: `mail.${brand}`, programId: 8 }];
    expect(matchSenderDomain(`x.mail.${brand}`, nested)?.programId).toBe(8);
    expect(matchSenderDomain(`x.mail.${brand}`, [...nested].reverse())?.programId).toBe(8);
    expect(matchSenderDomain(`x.${brand}`, nested)?.programId).toBe(7);

    // An address's domain is what follows the last @; its local part never decides.
    expect(senderDomainOf(`${brand}@attacker.test`)).toBe('attacker.test');
    expect(senderDomainOf('a@<b>zq42c</b>.test')).toBeNull();
    expect(storedForwardingAddress('  ZQ42C-Anna@Example.COM  ')).toBe(C.people.A);
    expect(storedForwardingAddress('"ZQ42C Anna" <zq42c-anna@example.com>')).toBeNull();
  });

  it('T42c1-U3: only the address of the From header is the sender, and an unreadable sender is classified', async () => {
    const seen: string[] = [];
    for (const id of ['F01', 'F02', 'F03', 'F04', 'F05', 'F06', 'F07', 'F18', 'F19', 'F24', 'F25']) {
      const c = caseOf(id);
      const a = await analyseMessage(eml(id), registered);
      expect(a.origin, id).toBe('direct');
      const want = c.expect.outcome === 'unknown'
        ? (c.expect.domain === '(unreadable)' ? null : c.expect.domain)
        : (c.expect.program === 'brand' ? (id === 'F02' ? `mail.${C.programs.brand.domain}` : C.programs.brand.domain) : C.programs.air.domain);
      expect(a.senderDomain, id).toBe(want);
      seen.push(id);
    }
    expect(seen).toEqual(['F01', 'F02', 'F03', 'F04', 'F05', 'F06', 'F07', 'F18', 'F19', 'F24', 'F25']);
    // The display-name and other-header spoofs name the brand and are still attacker.test.
    expect((await analyseMessage(eml('F05'), registered)).senderDomain).toBe('attacker.test');
    expect((await analyseMessage(eml('F07'), registered)).senderDomain).toBe('attacker.test');
    // The envelope view agrees: two mailboxes and no From are both null.
    expect(await outerFromAddress(eml('F18'))).toBeNull();
    expect(await outerFromAddress(eml('F24'))).toBeNull();
    expect(await outerFromAddress(eml('F25'))).toBe('statements@zq42c-brand.test');
    // A fabricated From whose domain holds markup is unreadable.
    const markup = Buffer.from(`Message-ID: <zq42c-markup@zq42c-brand.test>\nFrom: a@<b>zq42c</b>.test\nSubject: ZQ42C-SUBJECT-CANARY M\n\nZQ42C-BODY-CANARY M\n`);
    expect((await analyseMessage(markup, registered)).senderDomain).toBeNull();
  });

  it('T42c1-U4: a forwarded original is recovered from an attachment or an inline block, and only from a registered member', async () => {
    const brand = C.programs.brand.domain;
    const want: Record<string, { origin: string; domain: string }> = {
      F08: { origin: 'attachment', domain: brand },
      F09: { origin: 'inline', domain: brand },
      F10: { origin: 'direct', domain: 'example.org' },
      F14: { origin: 'attachment', domain: brand },
      F26: { origin: 'inline', domain: brand },
      F27: { origin: 'attachment', domain: 'attacker.test' },
    };
    const seen: string[] = [];
    for (const [id, w] of Object.entries(want)) {
      const a = await analyseMessage(eml(id), registered);
      expect({ origin: a.origin, domain: a.senderDomain }, id).toEqual(w);
      if (caseOf(id).expect.origin) expect(a.origin, id).toBe(caseOf(id).expect.origin);
      seen.push(id);
    }
    expect(seen).toEqual(['F08', 'F09', 'F10', 'F14', 'F26', 'F27']);
    // The same F08 with nobody registered is the forwarder's own mail.
    expect(await analyseMessage(eml('F08'), new Set())).toMatchObject({ origin: 'direct', senderDomain: 'example.com' });
    // A marker with no From: within twelve lines falls through to direct.
    const far = Buffer.from(
      `Message-ID: <zq42c-far@example.com>\nFrom: ${C.people.A}\nSubject: ZQ42C-SUBJECT-CANARY far\n\nZQ42C-BODY-CANARY far\n\n` +
      `---------- Forwarded message ---------\n${Array.from({ length: 12 }, (_, i) => `line ${i}`).join('\n')}\nFrom: ZQ42C Stays <statements@${brand}>\n`
    );
    expect(await analyseMessage(far, registered)).toMatchObject({ origin: 'direct', senderDomain: 'example.com' });
    const near = Buffer.from(far.toString().replace(/line 11\n/, '').replace(/line 0\n/, ''));
    expect(await analyseMessage(near, registered)).toMatchObject({ origin: 'inline', senderDomain: brand });
  });

  it('T42c1-U5: the recipient walk follows the tiers in order, never guesses, and lets a non-member address pass', async () => {
    const ids = ['F01', 'F08', 'F09', 'F11', 'F12', 'F13', 'F14', 'F15', 'F16', 'F25', 'F26'];
    const seen: string[] = [];
    for (const id of ids) {
      const c = caseOf(id);
      const a = await analyseMessage(eml(id), registered);
      const who = attributeMessage(a.tiers, memberOf);
      expect({ attribution: who.attribution, memberId: who.memberId }, id).toEqual({
        attribution: c.expect.attribution, memberId: memberIdOf(c.expect.member),
      });
      seen.push(id);
    }
    expect(seen).toEqual(ids);
    // F14: the outer headers all name A; the attached original's Delivered-To names B (tier 1).
    const f14 = await analyseMessage(eml('F14'), registered);
    expect(f14.tiers[1]).toContain(C.people.A);
    expect(attributeMessage(f14.tiers, memberOf)).toMatchObject({ memberId: B_ID, addresses: [C.people.B] });
    // F15: B comes from the oldest Received clause; the mailbox's own address does not stop the walk.
    expect((await analyseMessage(eml('F15'), registered)).tiers[2]).toEqual([C.people.B, C.people.inbox]);
    // F11 becomes matched once the mailbox's own address is a member's (a fabricated set).
    const f11 = await analyseMessage(eml('F11'), registered);
    expect(attributeMessage(f11.tiers, new Map([...memberOf, [C.people.inbox, B_ID]]))).toMatchObject({ attribution: 'matched', memberId: B_ID });
    // Two members in different tiers: the first tier wins; in one tier: ambiguous.
    expect(attributeMessage([[], [C.people.A], [C.people.B]], memberOf)).toMatchObject({ attribution: 'matched', memberId: A_ID });
    expect(attributeMessage([[], [C.people.A, C.people.B]], memberOf)).toMatchObject({ attribution: 'ambiguous', memberId: null });
    expect(attributeMessage([[], [], [], [], []], memberOf).attribution).toBe('none_found');
  });
});
