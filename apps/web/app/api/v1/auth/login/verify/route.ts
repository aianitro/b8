// `POST /api/v1/auth/login/verify` — check an assertion and, if it holds, open a session.
//
// THE ORDER OF THE THREE CHECKS IS THE DESIGN. The credential is selected by the id the assertion
// names, over EVERY stored credential; the assertion is verified against THAT credential's stored
// public key, the server's fixed origin set and a challenge the server issued and has not spent;
// and only then does a session row exist. Nothing about the payload chooses what it is checked
// against.

import type { NextRequest } from 'next/server';
import { createDeviceSession, createSession, listCredentials, recordSignCount } from '@/lib/authSession';
import { mayIssueDeviceToken, wantsDeviceToken } from '@/lib/bearerAuth';
import { createLogger } from '@/lib/logger';
import { consumeChallenge } from '@/lib/webauthnChallenge';
import { selectCredential, verifyAuthenticationCeremony } from '@/lib/webauthnVerify';
import { AuthenticationCeremonyResponseSchema } from '@b8/contracts/auth';
import { authError, ceremonyCompleted, deviceSessionIssued, withEnvelope } from '../../shared';

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

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return authError('INVALID_INPUT', 'The request body is not JSON.', 400);
  }

  const parsed = AuthenticationCeremonyResponseSchema.safeParse(body);
  if (!parsed.success) {
    return authError('INVALID_INPUT', 'That is not an authentication ceremony response.', 400);
  }

  // Over all of them. `userHandle` is deliberately not consulted: it is a constant in this app, so
  // a lookup keyed on it would find every credential or none, and either way has answered the wrong
  // question.
  const credential = selectCredential(await listCredentials(), parsed.data.id);
  if (!credential) {
    // An unknown credential id is the same wire answer as a bad signature — one code for all four
    // failure axes.
    log.warn('login refused: unknown credential id');
    return authError('CEREMONY_FAILED', 'That sign-in could not be verified.', 400);
  }

  const verification = await verifyAuthenticationCeremony({
    ceremonyResponse: parsed.data,
    expectedChallenge: (challenge) => consumeChallenge('authentication', challenge),
    credential,
  });

  if (!verification.verified) {
    // This branch also carries the clone-detection refusal: `@simplewebauthn/server` throws when a
    // counter goes backwards, and the wrapper turns a throw into this. It is genuinely inert for an
    // authenticator that reports 0 forever — most platform authenticators — which is a property of
    // the hardware and not of this code, and is why the reason is logged rather than dropped.
    log.warn('login ceremony refused', { reason: verification.reason });
    return authError('CEREMONY_FAILED', 'That sign-in could not be verified.', 400);
  }

  // The high-water mark, recorded before the session exists, so an accepted assertion cannot be
  // replayed against a counter that was never advanced.
  await recordSignCount(credential.credentialId, verification.newSignCount);

  if (deviceMode) {
    const device = await createDeviceSession(credential.credentialId);
    log.info('device session opened');
    return deviceSessionIssued(device);
  }

  const sessionToken = await createSession(credential.credentialId);
  log.info('session opened');
  return ceremonyCompleted(sessionToken);
});
