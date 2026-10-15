// The rule this whole step exists to enforce, as a pure function.
//
// REGISTRATION IS OPEN ONLY WHILE ZERO CREDENTIALS EXIST, AND REQUIRES A VALID SESSION — OR, SINCE
// P7-41a, AN INVITATION THE OWNER MINTED — AFTER THAT.
// A relying party that leaves registration open lets the first unauthenticated visitor after deploy
// enrol their own passkey and own the app permanently — SPEC.md calls it the centerpiece defect,
// and it is the one a WebAuthn quick-start gets wrong most often, because the quick-start has no
// opinion about who is allowed to register.
//
// IT IS A FUNCTION, AND IT TAKES THREE FACTS, for three reasons worth stating:
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
//   3. It is testable with no database and no HTTP, so the rule can be stated over every
//      combination of its inputs rather than over the few an integration fixture happens to reach.
//
// THE THIRD FACT, AND WHAT THIS FUNCTION CANNOT KNOW ABOUT IT. Whether the request carried an
// `X-Invitation-Code` header is an input; whether that code names a LIVE invitation is not, because
// only Postgres can say (by hash, against `NOW()`, under a row lock at redemption). So an
// `'invitation'` decision means "this request may proceed to redeem", never "this request is
// admitted" — the handlers check the code on `register/options` and again on `register/verify`, and
// the enrolment transaction checks it a third time under the lock. A header that is present but
// malformed is still PRESENT here: it must not fall through to the bootstrap window, or a garbage
// header on an empty store would be a bootstrap with extra steps, and on a non-empty store it must
// produce the same refusal as no header at all.
//
// WHAT IT IS NOT: the whole gate. A count read before an INSERT has a window in it. The window is
// closed by `webauthn_credentials_one_bootstrap`, and `lib/authSession.ts` turns that constraint's
// violation into the same refusal this function produces. Both halves are needed and neither is
// the other.

import type { SessionKind, SessionScope } from './bearerAuth';

export type RegistrationDecision =
  | { allowed: true; enrolledVia: 'bootstrap' | 'authenticated' | 'invitation' }
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
 *   script has no passkey to enrol and no reason to; the one client that does is the browser.
 */
export function sessionMayEnrol(session: EnrolCandidate | null): boolean {
  if (!session) return false;
  return session.scope === 'full' && session.kind === 'browser';
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
  /**
   * Whether the request carried an invitation code at all — present, not valid; see the header.
   * Optional so that a caller which has no notion of invitations reads as "none presented".
   */
  invitationPresented?: boolean;
}): RegistrationDecision {
  // A SESSION AND A CODE TOGETHER ARE REFUSED, whatever either is worth. The two doors lead to
  // different people: a session adds a device to the signed-in user, a code creates a new user. A
  // request carrying both is asking for one of two contradictory outcomes, and every way of picking
  // one is a guess — honouring the code would let the owner's browser enrol a passkey as a stranger,
  // honouring the session would spend nothing and silently ignore what the caller sent. Refusing is
  // the only answer that cannot be wrong.
  if (facts.invitationPresented && facts.session) return { allowed: false };

  // A qualifying session is sufficient on its own, and it is what makes the gate "needs a session"
  // rather than "permanently closed" — a second device must be able to enrol. The provenance is the
  // session's, not the count's: an authenticated request enrols an `'authenticated'` credential even
  // when the store happens to be empty, because what admitted it really was the session.
  if (sessionMayEnrol(facts.session)) return { allowed: true, enrolledVia: 'authenticated' };

  // A code with no session: the invitation door, and only that door. Not the bootstrap window even
  // on an empty store — the caller said it was redeeming, so a code that turns out dead is refused
  // rather than quietly reinterpreted as "no code".
  if (facts.invitationPresented) return { allowed: true, enrolledVia: 'invitation' };

  // No session that may enrol — either none at all, or one this rule does not accept. The only
  // remaining door is the bootstrap window, and it is open only while the store is empty, which is
  // the same door an anonymous caller gets and no wider. `> 0` rather than `>= 1` is the same test
  // written the way the sentence reads; a negative count is not reachable from `COUNT(*)`.
  if (facts.credentialCount > 0) return { allowed: false };

  return { allowed: true, enrolledVia: 'bootstrap' };
}
