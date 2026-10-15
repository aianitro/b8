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
//
// P7-41a: WHOSE CEREMONY THIS IS decides the handle, the shown name and the exclusion list. The
// owner keeps the constant handle their passkeys were enrolled under; a second user (signed in, or
// an invitee presenting a code) gets their own stable handle from `webauthnIdentityFor`. And
// `excludeCredentials` lists only the SIGNED-IN user's own credentials — never the other user's,
// and nothing at all to an invitee, who is not yet anybody and has no business learning which
// credential ids exist.

import type { NextRequest } from 'next/server';
import { NextResponse } from 'next/server';
import { generateRegistrationOptions } from '@simplewebauthn/server';
import { countCredentials, listCredentials } from '@/lib/authSession';
import { INVITATION_HEADER, liveInvitationHash } from '@/lib/invitations';
import { registrationDecision } from '@/lib/registrationGate';
import { webauthnIdentityFor, type WebauthnIdentity } from '@/lib/users';
import { rememberChallenge } from '@/lib/webauthnChallenge';
import { relyingPartyIdFor, RELYING_PARTY_NAME } from '@/lib/webauthnOrigins';
import type { StoredCredential } from '@/lib/webauthnVerify';
import { RegistrationCeremonyOptionsSchema } from '@b8/contracts/auth';
import type { ApiResponse } from '@b8/contracts/types';
import { registrationClosed, sessionFrom, withEnvelope } from '../../shared';

export const POST = withEnvelope(async (request: NextRequest) => {
  const session = await sessionFrom(request);
  const presented = request.headers.get(INVITATION_HEADER);
  const decision = registrationDecision({
    session,
    credentialCount: await countCredentials(),
    invitationPresented: presented !== null,
  });
  if (!decision.allowed) return registrationClosed();

  let identity: WebauthnIdentity | null;
  let enrolled: StoredCredential[];
  if (decision.enrolledVia === 'invitation') {
    // CHECKED HERE, and checked again on `verify`, and a third time under the row lock at
    // enrolment. This read decides only whether to hand out creation options; it consumes nothing.
    const codeHash = await liveInvitationHash(presented);
    if (codeHash === null) return registrationClosed();
    identity = await webauthnIdentityFor({ codeHash });
    enrolled = [];
  } else if (decision.enrolledVia === 'authenticated' && session) {
    identity = await webauthnIdentityFor({ userId: session.userId });
    enrolled = await listCredentials({ userId: session.userId });
  } else {
    // The bootstrap window: zero credentials exist, so the list is empty by definition and the
    // person enrolling is about to become the owner.
    identity = await webauthnIdentityFor({ bootstrap: true });
    enrolled = await listCredentials();
  }
  // Nobody to name — an invitation that vanished between the two reads above, or a user the app
  // cannot place. Refused, never answered with the owner's handle for want of a better one.
  if (identity === null) return registrationClosed();

  const options = await generateRegistrationOptions({
    rpName: RELYING_PARTY_NAME,
    // FROM THE SERVER'S FIXED CONFIGURATION, never from `request.headers.get('host')`. The schema
    // below requires the field, so an omission fails here rather than becoming a silently different
    // relying party — but only this line can ensure the value did not come from the request.
    rpID: relyingPartyIdFor(request.headers.get('host')),
    userName: identity.name,
    // The stable handle of the person enrolling. Regenerating it per ceremony would make every
    // registration look like a new user to the authenticator, so a platform authenticator would
    // quietly create a second passkey instead of recognising the first.
    userID: new TextEncoder().encode(identity.handle),
    // EVERY credential of the person enrolling, so an authenticator that already holds one is told
    // not to enrol it again. A truncated list here is how the same device ends up with two passkeys.
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
