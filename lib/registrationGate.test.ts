// The bootstrap rule, over all four combinations of its two inputs.
//
// SPEC.md's I2 and I3 test this rule end to end against a real database, which is where it has to
// be proved. These blocks are the cheap half: they state the rule over inputs an integration
// fixture cannot easily reach — in particular the session-with-no-credentials case, which exists in
// no real deployment and is exactly where a "count only" implementation and a "session only" one
// give different answers.

import { describe, expect, it } from 'vitest';
import { registrationDecision } from './registrationGate';

describe('registrationDecision', () => {
  it('opens the bootstrap window only while zero credentials exist', () => {
    expect(registrationDecision({ hasValidSession: false, credentialCount: 0 }))
      .toEqual({ allowed: true, enrolledVia: 'bootstrap' });
  });

  it('refuses an unauthenticated registration once any credential exists', () => {
    // The centerpiece defect, refused. One credential is enough — there is no "a few more owners"
    // state between zero and closed.
    expect(registrationDecision({ hasValidSession: false, credentialCount: 1 })).toEqual({ allowed: false });
    expect(registrationDecision({ hasValidSession: false, credentialCount: 7 })).toEqual({ allowed: false });
  });

  it('admits a second device when the request carries a valid session', () => {
    // "Needs a session", not "permanently closed" — SPEC.md's negative control #2.
    expect(registrationDecision({ hasValidSession: true, credentialCount: 1 }))
      .toEqual({ allowed: true, enrolledVia: 'authenticated' });
  });

  it('tags provenance from the session rather than from the count', () => {
    // The combination that separates the two implementations: a valid session with an empty store.
    // A gate that derived `enrolledVia` from the count would write `'bootstrap'` here, spending the
    // single bootstrap slot on a request that did not need it — and, read the other way, a handler
    // that wrote `'authenticated'` for a session-less request would satisfy the database and defeat
    // the rule. The tag follows the session, both ways.
    expect(registrationDecision({ hasValidSession: true, credentialCount: 0 }))
      .toEqual({ allowed: true, enrolledVia: 'authenticated' });
  });
});
