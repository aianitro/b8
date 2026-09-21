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

import type { SessionKind, SessionScope } from './bearerAuth';

export type RegistrationDecision =
  | { allowed: true; enrolledVia: 'bootstrap' | 'authenticated' }
  | { allowed: false };

/** As much of a session as this rule reads. */
export type EnrolCandidate = { kind: SessionKind; scope: SessionScope };

/**
 * WHICH SESSIONS MAY ENROL A PASSKEY: a signed-in browser, or a phone app. Not a personal token.
 *
 * Enrolling a credential is not one more write — it mints an authenticator that can open new
 * sessions forever, and that outlives the credential which asked for it. So the two properties a
 * caller needs here are more than "authenticated":
 *
 *   FULL SCOPE, because a read-only token that can enrol is not read-only. This is the hole
 *   P1-12a's security review found: the two `register/*` paths are allowlisted at the boundary, so
 *   the scope check the rest of the API gets from `proxy.ts` never ran on them.
 *
 *   NOT A PERSONAL TOKEN, even a full one. A personal token is minted over SSH for a script and is
 *   revocable by `scripts/tokens.ts` — a credential enrolled through one would survive that
 *   revocation, which makes revoking the token stop meaning what the owner thinks it means. A
 *   script has no passkey to enrol and no reason to; the two clients that do are the browser and
 *   the phone.
 */
export function sessionMayEnrol(session: EnrolCandidate | null): boolean {
  if (!session) return false;
  return session.scope === 'full' && (session.kind === 'browser' || session.kind === 'device');
}

export function registrationDecision(facts: {
  /**
   * THE SESSION ITSELF, not a boolean the caller derived. Both ceremony endpoints used to pass
   * `session !== null`, which is the shape that let a read-only token through: the authority test
   * lived at two call sites and neither one asked about scope. It lives here now, so a route
   * cannot hold a different opinion about what a session is allowed to do.
   */
  session: EnrolCandidate | null;
  credentialCount: number;
}): RegistrationDecision {
  // A qualifying session is sufficient on its own, and it is what makes the gate "needs a session"
  // rather than "permanently closed" — a second device must be able to enrol. The provenance is the
  // session's, not the count's: an authenticated request enrols an `'authenticated'` credential even
  // when the store happens to be empty, because what admitted it really was the session.
  if (sessionMayEnrol(facts.session)) return { allowed: true, enrolledVia: 'authenticated' };

  // No session that may enrol — either none at all, or one this rule does not accept. The only
  // remaining door is the bootstrap window, and it is open only while the store is empty, which is
  // the same door an anonymous caller gets and no wider. `> 0` rather than `>= 1` is the same test
  // written the way the sentence reads; a negative count is not reachable from `COUNT(*)`.
  if (facts.credentialCount > 0) return { allowed: false };

  return { allowed: true, enrolledVia: 'bootstrap' };
}
