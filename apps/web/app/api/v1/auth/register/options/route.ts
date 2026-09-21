// `POST /api/v1/auth/register/options` — the creation options a browser needs to enrol a passkey.
//
// ALLOWLISTED AT THE BOUNDARY, GATED HERE. `proxy.ts` lets this path through without a session
// because the very first registration cannot have one; the bootstrap rule is applied in this
// handler because the boundary cannot count credentials without a database round trip on every
// request regardless of path.
//
// THE GATE IS APPLIED ON THIS ENDPOINT TOO, not only on `verify`, and the reason is not symmetry:
// the options carry `excludeCredentials`, which is the list of credential ids already enrolled. An
// ungated options endpoint hands that list to anybody who asks. It is not a secret worth much, but
// publishing it is a decision nobody would make on purpose.

import type { NextRequest } from 'next/server';
import { NextResponse } from 'next/server';
import { generateRegistrationOptions } from '@simplewebauthn/server';
import { countCredentials, listCredentials } from '@/lib/authSession';
import { registrationDecision } from '@/lib/registrationGate';
import { rememberChallenge } from '@/lib/webauthnChallenge';
import {
  OWNER_USER_HANDLE,
  OWNER_USER_NAME,
  relyingPartyIdFor,
  RELYING_PARTY_NAME,
} from '@/lib/webauthnOrigins';
import { RegistrationCeremonyOptionsSchema } from '@b8/contracts/auth';
import type { ApiResponse } from '@b8/contracts/types';
import { authError, sessionFrom, withEnvelope } from '../../shared';

export const POST = withEnvelope(async (request: NextRequest) => {
  const session = await sessionFrom(request);
  const decision = registrationDecision({
    session,
    credentialCount: await countCredentials(),
  });
  if (!decision.allowed) {
    return authError(
      'REGISTRATION_CLOSED',
      'This app already has an enrolled passkey. Sign in first to add another device.',
      403
    );
  }

  const enrolled = await listCredentials();
  const options = await generateRegistrationOptions({
    rpName: RELYING_PARTY_NAME,
    // FROM THE SERVER'S FIXED CONFIGURATION, never from `request.headers.get('host')`. The schema
    // below requires the field, so an omission fails here rather than becoming a silently different
    // relying party — but only this line can ensure the value did not come from the request.
    rpID: relyingPartyIdFor(request.headers.get('host')),
    userName: OWNER_USER_NAME,
    // The stable owner handle. Regenerating it per ceremony would make every registration look like
    // a new user to the authenticator, so a platform authenticator would quietly create a second
    // passkey instead of recognising the first.
    userID: new TextEncoder().encode(OWNER_USER_HANDLE),
    // EVERY enrolled credential, so an authenticator that already holds one is told not to enrol it
    // again. A truncated list here is how the same device ends up with two passkeys.
    excludeCredentials: enrolled.map((credential) => ({
      id: credential.credentialId,
      transports: credential.transports ?? undefined,
    })),
    authenticatorSelection: {
      residentKey: 'preferred',
      // `verifyRegistrationResponse` requires user verification by default and this app does not
      // relax it, so the options must ask for it. Asking for less than the verifier demands is a
      // registration that completes in the browser and is refused by the server.
      userVerification: 'required',
    },
  });

  // The challenge is the library's — one generator, not two — and the server remembers it so the
  // matching `verify` can spend it. See `lib/webauthnChallenge.ts` for why this is not a cookie.
  rememberChallenge('registration', options.challenge);

  // PARSE TO REFUSE, NOT TO RESHAPE. The schema is loose, so this keeps every key the library
  // emitted; what it buys is that a future library version dropping `rp.id` fails here, loudly,
  // instead of letting the browser infer the relying party from the page it happens to be on.
  const data = RegistrationCeremonyOptionsSchema.parse(options);
  return NextResponse.json({ success: true, data } satisfies ApiResponse<typeof data>);
});
