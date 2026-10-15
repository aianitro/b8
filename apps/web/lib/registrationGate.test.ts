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
// The retired phone app's session kind. Rows of it may survive in `auth_sessions`; none may enrol.
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
      .toEqual({ allowed: false });
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
  it('accepts a signed-in browser — and no longer the retired phone app', () => {
    expect(sessionMayEnrol(BROWSER)).toBe(true);
    expect(sessionMayEnrol(PHONE)).toBe(false);
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

// P7-41a: the third input. Whether a request carried an invitation code is a fact this rule reads;
// whether the code is LIVE is not — only Postgres can say, by hash, against NOW(). So an
// `'invitation'` decision is "proceed to redeem", and these fixtures pin the doors around it.
describe('registrationDecision with an invitation code (P7-41a)', () => {
  it('sends a code with no session to the invitation door, whatever the count', () => {
    // Not the bootstrap window, even on an empty store: the caller said it was redeeming, and a
    // dead code must be refused rather than reinterpreted as "no code".
    for (const credentialCount of [0, 1, 7]) {
      expect(registrationDecision({ session: null, credentialCount, invitationPresented: true }))
        .toEqual({ allowed: true, enrolledVia: 'invitation' });
    }
  });

  it('refuses a session and a code together, for every kind of session and every count', () => {
    // Two doors to two different people. Honouring either would be a guess.
    for (const session of [BROWSER, PHONE, SCRIPT, READ_ONLY]) {
      for (const credentialCount of [0, 1]) {
        expect(registrationDecision({ session, credentialCount, invitationPresented: true }))
          .toEqual({ allowed: false });
      }
    }
  });

  it('leaves the no-code cases exactly as they were', () => {
    // An absent flag and an explicit `false` are the same input, and both reproduce the original
    // four-way table — the bootstrap window, the closed gate, and the signed-in device.
    for (const invitationPresented of [undefined, false]) {
      expect(registrationDecision({ session: null, credentialCount: 0, invitationPresented }))
        .toEqual({ allowed: true, enrolledVia: 'bootstrap' });
      expect(registrationDecision({ session: null, credentialCount: 1, invitationPresented }))
        .toEqual({ allowed: false });
      expect(registrationDecision({ session: BROWSER, credentialCount: 1, invitationPresented }))
        .toEqual({ allowed: true, enrolledVia: 'authenticated' });
      expect(registrationDecision({ session: SCRIPT, credentialCount: 1, invitationPresented }))
        .toEqual({ allowed: false });
    }
  });

  it('never yields a bootstrap once a code is presented', () => {
    // The invited enrolment must never take the bootstrap tag: that would trip the at-most-one
    // bootstrap index for the second user, or — if the index were dropped to make room — reopen
    // the race it closes.
    const sessions: Array<EnrolCandidate | null> = [null, BROWSER, PHONE, SCRIPT, READ_ONLY];
    for (const session of sessions) {
      for (const credentialCount of [0, 1, 3]) {
        const decision = registrationDecision({ session, credentialCount, invitationPresented: true });
        expect(decision.allowed && decision.enrolledVia === 'bootstrap').toBe(false);
      }
    }
  });
});
