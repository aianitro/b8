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

import type { NextRequest } from 'next/server';
import { countCredentials, createDeviceSession, enrolCredential, revokeSession } from '@/lib/authSession';
import { mayIssueDeviceToken, wantsDeviceToken } from '@/lib/bearerAuth';
import { hashSessionToken } from '@/lib/sessionToken';
import { createLogger } from '@/lib/logger';
import { registrationDecision } from '@/lib/registrationGate';
import { consumeChallenge } from '@/lib/webauthnChallenge';
import { verifyRegistrationCeremony } from '@/lib/webauthnVerify';
import { RegistrationCeremonyResponseSchema } from '@/shared/contracts/auth';
import { authError, ceremonyCompleted, deviceSessionIssued, sessionFrom, withEnvelope } from '../../shared';

const log = createLogger('auth');

export const POST = withEnvelope(async (request: NextRequest) => {
  // P1-12a: a native client may ask for a device token instead of a cookie. Decided BEFORE the
  // ceremony, so a refused request never spends the user's passkey approval. A browser can never be
  // given one — see mayIssueDeviceToken for why that is the property that matters.
  const deviceMode = wantsDeviceToken(request.headers);
  if (deviceMode && !mayIssueDeviceToken(request.headers)) {
    log.warn('device token refused: the caller is a browser');
    return authError('DEVICE_TOKEN_REFUSED', 'Device tokens are issued only to native apps.', 403);
  }

  const session = await sessionFrom(request);
  const decision = registrationDecision({
    hasValidSession: session !== null,
    credentialCount: await countCredentials(),
  });
  if (!decision.allowed) {
    return authError(
      'REGISTRATION_CLOSED',
      'This app already has an enrolled passkey. Sign in first to add another device.',
      403
    );
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
    // THE TAG COMES FROM THE SESSION, through the same decision that permitted the request. Not
    // from the credential count, and not from a default.
    enrolledVia: decision.enrolledVia,
  });

  if (!enrolment.enrolled) {
    if (enrolment.refusal === 'REGISTRATION_CLOSED') {
      // The concurrent case: another unauthenticated registration took the single bootstrap slot
      // between this request's count and its INSERT. Same refusal as the count check produces, and
      // no retry — this request lost a race it was right to lose.
      log.warn('registration refused by the bootstrap constraint');
      return authError(
        'REGISTRATION_CLOSED',
        'This app already has an enrolled passkey. Sign in first to add another device.',
        403
      );
    }
    return authError('CEREMONY_FAILED', 'That authenticator is already enrolled.', 409);
  }

  log.info('credential enrolled', { enrolledVia: decision.enrolledVia });

  if (deviceMode) {
    // Enrolment opens a browser session inside its own transaction, so the credential and its
    // first session commit together. A native client never receives that cookie, so the session
    // is revoked on the spot rather than left live and unheld, and a device session replaces it.
    await revokeSession(hashSessionToken(enrolment.sessionToken));
    const device = await createDeviceSession(verification.credential.credentialId);
    log.info('device session opened');
    return deviceSessionIssued(device);
  }

  return ceremonyCompleted(enrolment.sessionToken);
});
