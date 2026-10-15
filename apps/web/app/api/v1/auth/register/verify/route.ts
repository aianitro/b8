// `POST /api/v1/auth/register/verify` — enrol the passkey the browser just created.
//
// THIS HANDLER IS THE HALF OF THE BOOTSTRAP RULE THE DATABASE CANNOT ENFORCE, and it is worth
// naming precisely because the schema looks like it covers the whole thing. The partial unique
// index `webauthn_credentials_one_bootstrap` makes at most one `'bootstrap'` row possible however
// two concurrent registrations interleave — that closes the RACE. It cannot see whether a request
// carried a session, so a handler that tagged a session-less enrolment `'authenticated'` would
// satisfy every constraint in the schema and still hand the app to a stranger. That is the
// AUTHORIZATION hole, it is closed by the three lines below that derive `enrolledVia` from the
// session rather than from anything else, and SPEC.md's I2 is the fixture that holds it.
//
// P7-41a ADDS A THIRD DOOR AND RE-CHECKS IT HERE. An invitation code is checked on `options` and
// checked again on this endpoint, because options saying yes is not a promise: a header present on
// one and not re-checked on the other is the gap that enrols a stranger. The order is: the gate
// (session, code, count), a read-only liveness check of the code so a dead one is refused before the
// ceremony spends its challenge, the ceremony itself, and only then the enrolment transaction, which
// locks the invitation, re-checks it, creates the user and credential, consumes the code and opens
// the session as one outcome. A ceremony that does not verify reaches none of that, so it cannot
// burn the code.

import type { NextRequest } from 'next/server';
import { countCredentials, enrolCredential, type EnrolmentPath } from '@/lib/authSession';
import { INVITATION_HEADER, liveInvitationHash } from '@/lib/invitations';
import { createLogger } from '@/lib/logger';
import { registrationDecision } from '@/lib/registrationGate';
import { consumeChallenge } from '@/lib/webauthnChallenge';
import { verifyRegistrationCeremony } from '@/lib/webauthnVerify';
import { RegistrationCeremonyResponseSchema } from '@b8/contracts/auth';
import { authError, ceremonyCompleted, registrationClosed, sessionFrom, withEnvelope } from '../../shared';

const log = createLogger('auth');

export const POST = withEnvelope(async (request: NextRequest) => {
  const session = await sessionFrom(request);
  const presented = request.headers.get(INVITATION_HEADER);
  const decision = registrationDecision({
    session,
    credentialCount: await countCredentials(),
    invitationPresented: presented !== null,
  });
  if (!decision.allowed) return registrationClosed();

  // WHOSE CREDENTIAL THIS WILL BE, fixed here from the same decision that admitted the request, and
  // never from the ceremony payload. `authenticated` is the signed-in user — the session's, not the
  // owner's by default. `invitation` carries only the code's hash: the user it creates does not
  // exist yet, and is created inside the enrolment transaction.
  let path: EnrolmentPath;
  if (decision.enrolledVia === 'invitation') {
    const codeHash = await liveInvitationHash(presented);
    if (codeHash === null) return registrationClosed();
    path = { via: 'invitation', codeHash };
  } else if (decision.enrolledVia === 'authenticated' && session) {
    path = { via: 'authenticated', userId: session.userId };
  } else {
    path = { via: 'bootstrap' };
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return authError('INVALID_INPUT', 'The request body is not JSON.', 400);
  }

  const parsed = RegistrationCeremonyResponseSchema.safeParse(body);
  if (!parsed.success) {
    return authError('INVALID_INPUT', 'That is not a registration ceremony response.', 400);
  }

  // `parsed.data` is the LOOSE parse, so `response.transports` and every other key the browser sent
  // is still on it. It goes to the verifier untouched — rebuilding a narrowed object here is the
  // stripping bug written by hand, and its symptom is a second device offered the wrong affordance
  // months later.
  const verification = await verifyRegistrationCeremony({
    ceremonyResponse: parsed.data,
    // The predicate is the server's challenge store answering "did I issue this, and is it still
    // unspent?". It is not the payload's challenge being accepted as its own expectation: a store
    // holding nothing refuses everything.
    expectedChallenge: (challenge) => consumeChallenge('registration', challenge),
  });

  if (!verification.verified) {
    // ONE CODE FOR ALL FOUR AXES. Wrong origin, wrong challenge, wrong key and unknown credential
    // are `CEREMONY_FAILED` on the wire; the reason is logged for the owner and not returned,
    // because telling an unauthenticated caller which axis it got wrong is free reconnaissance.
    log.warn('registration ceremony refused', { reason: verification.reason });
    return authError('CEREMONY_FAILED', 'That registration could not be verified.', 400);
  }

  const enrolment = await enrolCredential({
    credential: verification.credential,
    // THE PATH COMES FROM THE SESSION OR THE CODE, through the same decision that permitted the
    // request. Not from the credential count, and not from a default.
    path,
  });

  if (!enrolment.enrolled) {
    if (enrolment.refusal === 'REGISTRATION_CLOSED') {
      // The concurrent case: another unauthenticated registration took the single bootstrap slot
      // between this request's count and its INSERT — or another redemption consumed this
      // invitation, or it expired, between the liveness read above and the locked re-check. Same
      // refusal as the gate produces, and no retry — this request lost a race it was right to lose.
      log.warn('registration refused at enrolment', { via: path.via });
      return registrationClosed();
    }
    return authError('CEREMONY_FAILED', 'That authenticator is already enrolled.', 409);
  }

  log.info('credential enrolled', { enrolledVia: decision.enrolledVia });

  return ceremonyCompleted(enrolment.sessionToken);
});
