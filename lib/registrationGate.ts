// The rule this whole step exists to enforce, as a pure function.
//
// REGISTRATION IS OPEN ONLY WHILE ZERO CREDENTIALS EXIST, AND REQUIRES A VALID SESSION AFTER THAT.
// A relying party that leaves registration open lets the first unauthenticated visitor after deploy
// enrol their own passkey and own the app permanently — SPEC.md calls it the centerpiece defect,
// and it is the one a WebAuthn quick-start gets wrong most often, because the quick-start has no
// opinion about who is allowed to register.
//
// IT IS A FUNCTION, AND IT TAKES TWO FACTS, for three reasons worth stating:
//
//   1. Both ceremony endpoints must apply the same rule. `register/options` leaks the list of
//      enrolled credentials if it does not, and `register/verify` enrols a stranger if it does not.
//      One function is what stops them being two nearly-identical `if`s that drift.
//   2. The output includes `enrolledVia`, so the provenance written to the database comes from the
//      SAME decision that permitted the enrolment. This is the half the schema cannot check: the
//      partial unique index makes at most one `'bootstrap'` row possible whatever the interleaving,
//      but Postgres cannot see whether a request carried a session, so a handler tagging a
//      session-less enrolment `'authenticated'` satisfies every constraint and still enrols a
//      stranger. Deriving the tag here rather than at the INSERT is what keeps those two from being
//      different decisions.
//   3. It is testable with no database and no HTTP, so the rule can be stated over all four
//      combinations of its two inputs rather than over the two an integration fixture happens to
//      reach.
//
// WHAT IT IS NOT: the whole gate. A count read before an INSERT has a window in it. The window is
// closed by `webauthn_credentials_one_bootstrap`, and `lib/authSession.ts` turns that constraint's
// violation into the same refusal this function produces. Both halves are needed and neither is
// the other.

export type RegistrationDecision =
  | { allowed: true; enrolledVia: 'bootstrap' | 'authenticated' }
  | { allowed: false };

export function registrationDecision(facts: {
  hasValidSession: boolean;
  credentialCount: number;
}): RegistrationDecision {
  // A session is sufficient on its own, and it is what makes the gate "needs a session" rather than
  // "permanently closed" — a second device must be able to enrol. The provenance is the session's,
  // not the count's: an authenticated request enrols an `'authenticated'` credential even when the
  // store happens to be empty, because what admitted it really was the session.
  if (facts.hasValidSession) return { allowed: true, enrolledVia: 'authenticated' };

  // No session. The only remaining door is the bootstrap window, and it is open only while the
  // store is empty. `> 0` rather than `>= 1` is the same test written the way the sentence reads;
  // a negative count is not reachable from `COUNT(*)`.
  if (facts.credentialCount > 0) return { allowed: false };

  return { allowed: true, enrolledVia: 'bootstrap' };
}
