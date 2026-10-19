// P7-41a2: the invitation link and the small decisions made around it — scenarios U1 to U7 of
// plan/tasks/P7-41a2-browser-onboarding/SPEC.md.
//
// Every code here is FABRICATED: strings of the right alphabet and length built in this file, never
// one minted by a server. Origins are under `example.invalid` or the dev origin.

import { describe, expect, it } from 'vitest';
import { invitationCode } from '@b8/contracts/auth';
import { readInvitationFragment } from './invitationFragment';
import { INVITATION_HEADER, invitationHeaders, invitationLink, mayInvite, withoutFragment } from './invitationLink';

/** Fabricated codes: 22 and 43 base64url characters, each including `-` and `_`. */
const CODE_22 = 'Ab-_cdEFgh12ijKL34mn-_';
const CODE_43 = 'Zy-_xwVUts98rqPO76nmLK-_jiHG54fedCBA32zyx_-';
const CODES = [CODE_22, CODE_43];
const ORIGINS = [
  { given: 'https://app.example.invalid', origin: 'https://app.example.invalid' },
  { given: 'https://app.example.invalid/', origin: 'https://app.example.invalid' },
  { given: 'http://localhost:3000', origin: 'http://localhost:3000' },
];

describe('P7-41a2: the invitation link', () => {
  it('T41a2-U1: the link keeps the code out of everything a server sees', () => {
    expect(CODE_22).toHaveLength(22);
    expect(CODE_43).toHaveLength(43);
    for (const code of CODES) {
      for (const { given, origin } of ORIGINS) {
        const link = invitationLink(given, code);
        const url = new URL(link);
        expect(url.pathname).toBe('/login');
        expect(url.search).toBe('');
        expect(url.origin).toBe(origin);
        expect(link.split('#')).toHaveLength(2);
        expect(url.hash).toContain(code);
        // The part a browser sends: request line and Referer alike.
        expect(link.slice(0, link.indexOf('#'))).not.toContain(code);
        expect(link).toBe(`${origin}/login#invite=${code}`);
      }
    }
  });

  it('T41a2-U2: what the owner copies is what the page reads, byte for byte', () => {
    for (const code of CODES) {
      for (const { given } of ORIGINS) {
        expect(readInvitationFragment(new URL(invitationLink(given, code)).hash)).toEqual({ kind: 'invitation', code });
      }
    }
  });

  it('T41a2-U3: no invite key is ordinary mode, not an invalid invitation', () => {
    for (const hash of ['', '#', '#other=1', '#invitee', '#section', 'invitee=' + CODE_22]) {
      expect(readInvitationFragment(hash), hash).toEqual({ kind: 'none' });
    }
  });

  it('T41a2-U4: a present but unreadable invitation is refused, and the verdict equals the contract', () => {
    const CODE_21 = CODE_22.slice(0, 21);
    const refused = [
      '#invite=',
      '#invite',
      `#invite=${CODE_21}`,
      `#invite=${CODE_22.slice(0, 10)}+${CODE_22.slice(11)}`,
      `#invite=${CODE_22.slice(0, 10)}/${CODE_22.slice(11)}`,
      `#invite=${CODE_22}=`,
      `#invite=${CODE_22.slice(0, 10)} ${CODE_22.slice(11)}`,
      `#invite=${CODE_22.slice(0, 10)}%20${CODE_22.slice(11)}`,
      `#invite=${CODE_22}&invite=${CODE_43}`,
      `#invite=${CODE_22}&invite=${CODE_22}`,
      `#invite=${CODE_21}&x=1`,
      '#invite=short',
    ];
    for (const hash of refused) {
      expect(readInvitationFragment(hash), hash).toEqual({ kind: 'invalid' });
    }

    // The contract as the single source: for every single-key fragment, accept exactly what
    // `invitationCode` accepts. Valid rows included, so a reader that refused everything fails too.
    const candidates = [
      '', CODE_21, CODE_22, CODE_43, `${CODE_22}=`, `${CODE_22}+`, `${CODE_22}/`, `${CODE_22} `,
      `${CODE_22}%20`, 'short', `${CODE_43}${CODE_22}`, `${CODE_21}.`, `${CODE_21}A`,
    ];
    let accepted = 0;
    for (const candidate of candidates) {
      for (const hash of [`#invite=${candidate}`, `#invite=${candidate}&x=1`, `#x=1&invite=${candidate}`]) {
        const verdict = readInvitationFragment(hash).kind === 'invitation';
        expect(verdict, hash).toBe(invitationCode.safeParse(candidate).success);
        expect(readInvitationFragment(hash).kind, hash).not.toBe('none');
        if (verdict) accepted += 1;
      }
    }
    // CODE_22, CODE_43, the concatenation and CODE_21 + 'A', each in three positions.
    expect(accepted).toBe(12);
  });

  it('T41a2-U5: the header builder sends the code, or no header at all', () => {
    for (const code of CODES) {
      const headers = new Headers(invitationHeaders(code));
      expect(headers.get('x-invitation-code')).toBe(code);
      expect([...headers.keys()]).toEqual([INVITATION_HEADER]);
    }
    for (const none of [null, undefined, '']) {
      const result = invitationHeaders(none);
      expect(result).toEqual({});
      // ABSENT, NOT EMPTY: the server reads a present-but-empty header as a dead invitation.
      expect(new Headers(result).has('x-invitation-code')).toBe(false);
    }
  });

  it('T41a2-U6: the invite control is offered only for isOwner strictly true and a real name', () => {
    expect(mayInvite({ userId: 1, displayName: 'Owner', isOwner: true })).toBe(true);
    const refused: unknown[] = [
      { userId: 2, displayName: 'Test User Two', isOwner: false },
      null,
      undefined,
      {},
      { userId: 1, displayName: 'Owner', isOwner: 'true' },
      { userId: 1, displayName: 'Owner', isOwner: 1 },
      { userId: 1, isOwner: true },
      { userId: 1, displayName: '', isOwner: true },
      { userId: 1, displayName: 7, isOwner: true },
      'owner',
      true,
    ];
    for (const me of refused) expect(mayInvite(me), JSON.stringify(me)).toBe(false);
  });

  it('T41a2-U7: the address-bar scrub drops the fragment and keeps the query', () => {
    for (const code of CODES) {
      const cases: Array<[string, string]> = [
        [`/login#invite=${code}`, '/login'],
        [`/login?x=1#invite=${code}`, '/login?x=1'],
        ['/login', '/login'],
        ['/login?x=1', '/login?x=1'],
        [`/login#x=1&invite=${code}`, '/login'],
      ];
      for (const [given, expected] of cases) {
        const scrubbed = withoutFragment(given);
        expect(scrubbed).toBe(expected);
        expect(scrubbed).not.toContain('#');
        expect(scrubbed).not.toContain(code);
      }
    }
  });
});
