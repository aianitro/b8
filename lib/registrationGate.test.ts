// The bootstrap rule, over all four combinations of its two inputs.
//
// SPEC.md's I2 and I3 test this rule end to end against a real database, which is where it has to
// be proved. These blocks are the cheap half: they state the rule over inputs an integration
// fixture cannot easily reach — in particular the session-with-no-credentials case, which exists in
// no real deployment and is exactly where a "count only" implementation and a "session only" one
// give different answers.

import { describe, expect, it } from 'vitest';
import { registrationDecision, sessionMayEnrol, type EnrolCandidate } from './registrationGate';

const BROWSER: EnrolCandidate = { kind: 'browser', scope: 'full' };
const PHONE: EnrolCandidate = { kind: 'device', scope: 'full' };
const SCRIPT: EnrolCandidate = { kind: 'personal', scope: 'full' };
const READ_ONLY: EnrolCandidate = { kind: 'personal', scope: 'read' };

describe('registrationDecision', () => {
  it('opens the bootstrap window only while zero credentials exist', () => {
    expect(registrationDecision({ session: null, credentialCount: 0 }))
      .toEqual({ allowed: true, enrolledVia: 'bootstrap' });
  });

  it('refuses an unauthenticated registration once any credential exists', () => {
    // The centerpiece defect, refused. One credential is enough — there is no "a few more owners"
    // state between zero and closed.
    expect(registrationDecision({ session: null, credentialCount: 1 })).toEqual({ allowed: false });
    expect(registrationDecision({ session: null, credentialCount: 7 })).toEqual({ allowed: false });
  });

  it('admits a second device when the request carries a valid session', () => {
    // "Needs a session", not "permanently closed" — SPEC.md's negative control #2.
    expect(registrationDecision({ session: BROWSER, credentialCount: 1 }))
      .toEqual({ allowed: true, enrolledVia: 'authenticated' });
    expect(registrationDecision({ session: PHONE, credentialCount: 1 }))
      .toEqual({ allowed: true, enrolledVia: 'authenticated' });
  });

  it('tags provenance from the session rather than from the count', () => {
    // The combination that separates the two implementations: a valid session with an empty store.
    // A gate that derived `enrolledVia` from the count would write `'bootstrap'` here, spending the
    // single bootstrap slot on a request that did not need it — and, read the other way, a handler
    // that wrote `'authenticated'` for a session-less request would satisfy the database and defeat
    // the rule. The tag follows the session, both ways.
    expect(registrationDecision({ session: BROWSER, credentialCount: 0 }))
      .toEqual({ allowed: true, enrolledVia: 'authenticated' });
  });

  it('refuses a token session once a credential exists, whatever its scope', () => {
    // P1-12a's security finding, as a rule rather than as a route. A read-only token that could
    // enrol would not be read-only: the credential it enrols opens full sessions forever, and
    // outlives the token being revoked. A full personal token is refused for the second half of
    // that sentence alone.
    expect(registrationDecision({ session: READ_ONLY, credentialCount: 1 })).toEqual({ allowed: false });
    expect(registrationDecision({ session: SCRIPT, credentialCount: 1 })).toEqual({ allowed: false });
  });

  it('gives a token session the bootstrap window and no more', () => {
    // Refusing it here would be refusing an ANONYMOUS caller too, since the window is open to
    // anyone while the store is empty. The point of the rule above is that a token buys nothing
    // extra — not that carrying one is worse than carrying nothing.
    expect(registrationDecision({ session: READ_ONLY, credentialCount: 0 }))
      .toEqual({ allowed: true, enrolledVia: 'bootstrap' });
  });
});

describe('sessionMayEnrol', () => {
  it('accepts a signed-in browser and a phone app', () => {
    expect(sessionMayEnrol(BROWSER)).toBe(true);
    expect(sessionMayEnrol(PHONE)).toBe(true);
  });

  it('refuses no session, a personal token, and anything read-only', () => {
    expect(sessionMayEnrol(null)).toBe(false);
    expect(sessionMayEnrol(SCRIPT)).toBe(false);
    expect(sessionMayEnrol(READ_ONLY)).toBe(false);
    // Not reachable today — the schema allows `read` only on personal tokens — but the predicate
    // must not be reading the kind alone, or it would start passing if that constraint ever moved.
    expect(sessionMayEnrol({ kind: 'device', scope: 'read' })).toBe(false);
    expect(sessionMayEnrol({ kind: 'browser', scope: 'read' })).toBe(false);
  });
});
