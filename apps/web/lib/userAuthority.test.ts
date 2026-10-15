// Who may invite or remove a user (P7-41a) — every combination of kind, scope and owner flag.
//
// The integration fixtures (S4, S16) prove the rule through the real endpoints for the callers a
// deployment actually produces. These blocks state it over the combinations no deployment reaches
// today — a read-scope browser session, the retired phone app's device session — so the predicate
// is pinned on all three of its properties rather than on whichever one happened to refuse.

import { describe, expect, it } from 'vitest';
import { sessionMayAdminister } from './userAuthority';
import type { EnrolCandidate } from './registrationGate';

const KINDS = ['browser', 'device', 'personal'] as const;
const SCOPES = ['full', 'read'] as const;

describe('sessionMayAdminister', () => {
  it('admits exactly one combination: the owner, in a browser, at full scope', () => {
    const admitted: string[] = [];
    for (const kind of KINDS) {
      for (const scope of SCOPES) {
        for (const isOwner of [true, false]) {
          if (sessionMayAdminister({ kind, scope }, isOwner)) admitted.push(`${kind}/${scope}/${isOwner}`);
        }
      }
    }
    expect(admitted).toEqual(['browser/full/true']);
  });

  it('refuses the second user even in a full-scope browser session', () => {
    // The owner's decision at G0: the second user is a peer over the ledger, not over who signs in.
    expect(sessionMayAdminister({ kind: 'browser', scope: 'full' }, false)).toBe(false);
  });

  it("refuses the owner's own personal token, even at full scope", () => {
    // A script that could mint invitations could create a permanent principal that outlives the
    // token's revocation.
    const ownersScript: EnrolCandidate = { kind: 'personal', scope: 'full' };
    expect(sessionMayAdminister(ownersScript, true)).toBe(false);
  });

  it('refuses no session at all, whatever the owner flag says', () => {
    expect(sessionMayAdminister(null, true)).toBe(false);
    expect(sessionMayAdminister(null, false)).toBe(false);
  });
});
