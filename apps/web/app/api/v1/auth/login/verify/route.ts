// `POST /api/v1/auth/login/verify` — check an assertion and, if it holds, open a session.
//
// THE ORDER OF THE THREE CHECKS IS THE DESIGN. The credential is selected by the id the assertion
// names, over EVERY stored credential; the assertion is verified against THAT credential's stored
// public key, the server's fixed origin set and a challenge the server issued and has not spent;
// and only then does a session row exist. Nothing about the payload chooses what it is checked
// against.

import type { NextRequest } from 'next/server';
import { createSession, listCredentials, recordSignCount } from '@/lib/authSession';
import { createLogger } from '@/lib/logger';
import { consumeChallenge } from '@/lib/webauthnChallenge';
import { selectCredential, verifyAuthenticationCeremony } from '@/lib/webauthnVerify';
import { AuthenticationCeremonyResponseSchema } from '@b8/contracts/auth';
import { authError, ceremonyCompleted, withEnvelope } from '../../shared';

const log = createLogger('auth');

export const POST = withEnvelope(async (request: NextRequest) => {
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

  // Over all of them, both users' included: the login is pre-auth and does not yet know who is
  // asking. `userHandle` is deliberately not consulted — it is browser-supplied input inside the
  // thing being verified, and resolving a user from it would let a payload name its own principal.
  // WHO this is comes from the credential row the assertion names (`webauthn_credentials.user_id`),
  // which is what the session opened below resolves through. A removed user's credentials no longer
  // exist, so their assertion fails here as an unknown credential.
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

  const sessionToken = await createSession(credential.credentialId);
  log.info('session opened');
  return ceremonyCompleted(sessionToken);
});
