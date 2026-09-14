// `POST /api/v1/auth/login/options` — the request options a browser needs to assert a passkey.
//
// UNGATED BY DESIGN, and it is the one pre-auth endpoint where that deserves a sentence.
// `allowCredentials` lists the enrolled credential ids, which is the same list `register/options`
// refuses to publish — but a login ceremony cannot proceed without it, and this endpoint has no
// rule it could apply instead: refusing an unauthenticated caller here would refuse every login.
// The ids are not secrets (a credential id is a public handle; possession of the private key is the
// secret), so what is published is "this deployment has at least one passkey", which anybody able
// to reach the boundary at all can infer from being refused by it.

import { NextResponse } from 'next/server';
import { generateAuthenticationOptions } from '@simplewebauthn/server';
import { listCredentials } from '@/lib/authSession';
import { rememberChallenge } from '@/lib/webauthnChallenge';
import { PRIMARY_RP_ID } from '@/lib/webauthnOrigins';
import { AuthenticationCeremonyOptionsSchema } from '@/shared/contracts/auth';
import type { ApiResponse } from '@/shared/types';
import { withEnvelope } from '../../shared';

export const POST = withEnvelope(async () => {
  const enrolled = await listCredentials();

  const options = await generateAuthenticationOptions({
    // The server's fixed relying-party id, exactly as on the registration side.
    rpID: PRIMARY_RP_ID,
    // EVERY enrolled credential, not the newest. A list truncated to one row is how a second device
    // registers successfully and can then never sign in — invisible on a single-device setup, which
    // is every setup on day one.
    allowCredentials: enrolled.map((credential) => ({
      id: credential.credentialId,
      transports: credential.transports ?? undefined,
    })),
    userVerification: 'required',
  });

  rememberChallenge('authentication', options.challenge);

  const data = AuthenticationCeremonyOptionsSchema.parse(options);
  return NextResponse.json({ success: true, data } satisfies ApiResponse<typeof data>);
});
