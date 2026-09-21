// The two verification calls, with the server's expected origin and relying-party id already
// bound, and the result narrowed to what this app stores.
//
// THE POINT OF THIS FILE IS ITS SIGNATURES. Neither function takes an incoming request, a header
// bag, or anything an attacker can influence beyond the ceremony payload itself — there is nowhere
// to pass one. `expectedOrigin` and `expectedRPID` come from `lib/webauthnOrigins.ts`, which
// derives them from the Host allowlist at module load. SPEC.md's failure list names
// `expectedOrigin` computed from `request.headers.get('origin')` "for convenience" as the mistake
// that silently defeats F8, F13 and I5 while every other fixture still passes, and the reason it
// survives review is that the line reads like plumbing. It cannot be written here: there is no
// argument to write it from. F3 asserts that structurally, over this file's AST.
//
// WHAT VERIFICATION IS, RESTATED, because the schemas in `shared/contracts/auth.ts` are the thing
// most likely to be mistaken for it: a payload that parses is still entirely attacker-controlled.
// `clientDataJSON` is JSON the caller supplies inside the object being checked. The only facts
// that constrain it are the signature over the authenticator data, the challenge the SERVER issued
// and has not yet consumed, and the origin and RP id the SERVER was configured with.
//
// THE LIBRARY IS THE AUTHORITY, and this module deliberately re-implements none of it.
// `@simplewebauthn/server` owns the CBOR parsing, the COSE key handling, the flag checks and the
// signature check — and, relevant to SPEC.md's "clone detection wired to a no-op", the sign-counter
// comparison: it throws when `(counter > 0 || stored > 0) && counter <= stored`. That condition is
// exactly right for the reason the migration's `sign_count` comment gives at length — most platform
// authenticators report 0 forever, so 0-against-0 must NOT be read as a clone — and re-deriving it
// here would be a second definition of it.
//
// PARSE TO REFUSE, NEVER TO RESHAPE. The ceremony schemas are `z.looseObject`, so a parsed payload
// keeps every key the browser sent, including `response.transports` and `clientExtensionResults`.
// This module passes that value STRAIGHT THROUGH to the verifier. It does not rebuild a narrowed
// object from the fields it happens to know about, which is the stripping bug written by hand.

import {
  verifyAuthenticationResponse,
  verifyRegistrationResponse,
  type AuthenticationResponseJSON,
  type RegistrationResponseJSON,
} from '@simplewebauthn/server';
import type {
  AuthenticationCeremonyResponse,
  RegistrationCeremonyResponse,
} from '@b8/contracts/auth';
import { EXPECTED_ORIGINS, EXPECTED_RP_IDS } from './webauthnOrigins';

/**
 * A challenge the server issued, or a predicate over the challenges it issued.
 *
 * The callback form is the library's, and it is what lets the handler ask its own store "did I
 * issue this, and is it still unspent?" rather than comparing against one remembered string. It is
 * NOT a loophole for accepting the payload's challenge: the predicate is the server's, the store
 * is the server's, and a store holding nothing refuses everything. The fixtures use the string
 * form, because a fixture wants to state the expected value literally.
 */
type ExpectedChallenge = string | ((challenge: string) => boolean | Promise<boolean>);

/**
 * A credential as this app stores it — the three columns verification needs, named as the
 * application names them rather than as the library does.
 *
 * `publicKey` is bytes (the `BYTEA` column), never an encoded string: it is handed to a verifier
 * that wants bytes and is never compared, so there is no encoding to get wrong. `credentialId` is
 * the base64url TEXT column, because it exists to be compared against what the browser sends.
 *
 * Declared HERE, in the pure module, rather than in `lib/authSession.ts`. The DB module imports
 * this type; if the dependency ran the other way, the pure fixtures would drag `lib/db.ts` — and
 * therefore a `pg.Pool` and a mandatory `DATABASE_URL` — into a suite that must run with no
 * database at all.
 */
export interface StoredCredential {
  credentialId: string;
  publicKey: Uint8Array;
  signCount: number;
  transports: string[] | null;
}

/**
 * What a registration verification produced, or the fact that it did not.
 *
 * A DISCRIMINATED UNION, so a caller cannot read the credential off a failed verification: on the
 * failure branch there is no `credential` key to read. `{ verified: false }` carrying an otherwise
 * populated object is how a failed ceremony becomes a login one `if` at a time.
 *
 * `reason` is for the server's log only. `shared/contracts/auth.ts` gives all four failure axes one
 * wire code (`CEREMONY_FAILED`) deliberately: telling an unauthenticated caller which axis it got
 * wrong is free reconnaissance.
 */
export type RegistrationVerification =
  | { verified: true; credential: StoredCredential }
  | { verified: false; reason: string };

export type AuthenticationVerification =
  | { verified: true; newSignCount: number }
  | { verified: false; reason: string };

/**
 * The stored credential an assertion names, or `null` when it names none of them.
 *
 * EVERY STORED CREDENTIAL IS CONSIDERED, and that is the whole content of this function. SPEC.md's
 * failure list names "a query that silently reads only the most recent credential, so a second
 * device registers but can never log in" — a defect invisible on a one-device setup, which is every
 * setup on day one. Taking the list and matching over all of it is what makes the second device
 * work; the caller's job is to fetch all of them.
 *
 * The comparison is an exact string match on the base64url form both ends agree on: the column
 * carries `CHECK (credential_id ~ '^[A-Za-z0-9_-]+$')` and `base64url` in
 * `shared/contracts/auth.ts` refuses padding and the standard alphabet at the wire, so there is no
 * decode step here to get padded-versus-unpadded wrong.
 *
 * `null` means "no such credential", which the caller turns into the same `CEREMONY_FAILED` refusal
 * as a bad signature. It is never an empty credential or a default.
 */
export function selectCredential(
  stored: readonly StoredCredential[],
  presentedCredentialId: string
): StoredCredential | null {
  return stored.find((candidate) => candidate.credentialId === presentedCredentialId) ?? null;
}

/** The message from a thrown verification error, without assuming it was an `Error`. */
function failureReason(caught: unknown): string {
  return caught instanceof Error ? caught.message : 'verification threw a non-Error value';
}

/**
 * Verify a registration ceremony against the server's fixed configuration.
 *
 * The cast to the library's type is the one unavoidable seam between the contract and the library,
 * and it is deliberately a pass-through rather than a rebuild: the parsed value is a superset of
 * `RegistrationResponseJSON` (looseObject keeps every key the browser sent), but TypeScript cannot
 * see that a `Record<string, unknown>` index signature satisfies the library's named optional
 * fields. Constructing a fresh object here to satisfy the compiler would drop exactly the keys the
 * loose schemas exist to preserve.
 *
 * A THROW IS A REFUSAL, NOT AN ERROR TO PROPAGATE. The library signals a wrong origin, a wrong RP
 * id, a wrong challenge and a malformed attestation by throwing, and signals a bad signature by
 * returning `verified: false`. Both are the same answer to the caller — the ceremony did not
 * verify — so both become the failure branch here. Nothing else is caught: this function performs
 * no I/O, so there is no transient failure for a blanket catch to swallow into an "allow".
 */
export async function verifyRegistrationCeremony(options: {
  ceremonyResponse: RegistrationCeremonyResponse;
  expectedChallenge: ExpectedChallenge;
}): Promise<RegistrationVerification> {
  let verification;
  try {
    verification = await verifyRegistrationResponse({
      response: options.ceremonyResponse as unknown as RegistrationResponseJSON,
      expectedChallenge: options.expectedChallenge,
      expectedOrigin: [...EXPECTED_ORIGINS],
      expectedRPID: [...EXPECTED_RP_IDS],
    });
  } catch (caught) {
    return { verified: false, reason: failureReason(caught) };
  }

  if (!verification.verified) {
    return { verified: false, reason: 'the registration response did not verify' };
  }

  const { credential } = verification.registrationInfo;
  return {
    verified: true,
    credential: {
      credentialId: credential.id,
      publicKey: credential.publicKey,
      // The authenticator's own counter at enrolment. Stored as reported — including 0, which is a
      // real reading meaning "this authenticator does not implement a counter" and not a missing
      // observation.
      signCount: credential.counter,
      // NULL when the authenticator reported nothing; the array when it reported one, including an
      // empty one. `?? null` collapses `undefined` to SQL NULL and leaves `[]` alone, which is the
      // distinction `webauthn_credentials.transports` refuses a DEFAULT in order to keep.
      transports: credential.transports ?? null,
    },
  };
}

/**
 * Verify an authentication ceremony against the server's fixed configuration and ONE stored
 * credential.
 *
 * The credential is an argument rather than something this function looks up, for two reasons: it
 * keeps the module free of a database (see `StoredCredential`), and it makes the caller state which
 * stored public key it believes the assertion belongs to. SPEC.md's F11 is the fixture that matters
 * here — a response structurally identical to a valid one, signed by a different private key, must
 * fail — and it can only be written against a function that takes the public key explicitly.
 */
export async function verifyAuthenticationCeremony(options: {
  ceremonyResponse: AuthenticationCeremonyResponse;
  expectedChallenge: ExpectedChallenge;
  credential: StoredCredential;
}): Promise<AuthenticationVerification> {
  // THE LIBRARY DOES NOT CHECK THIS, measured rather than assumed: `verifyAuthenticationResponse`
  // destructures `id` and `rawId` from the response, compares those two to each other, and never
  // compares either to the credential it was handed. So "the assertion names the credential whose
  // public key we are checking it against" is the application's obligation, and skipping it is not
  // visible in any signature check — an assertion genuinely signed by an enrolled authenticator
  // would verify while claiming to be a different credential. `selectCredential` is where the
  // pairing is chosen; this is the assertion that the caller did not mis-pair it afterwards.
  if (options.ceremonyResponse.id !== options.credential.credentialId) {
    return { verified: false, reason: 'the assertion names a different credential than the one supplied' };
  }

  let verification;
  try {
    verification = await verifyAuthenticationResponse({
      response: options.ceremonyResponse as unknown as AuthenticationResponseJSON,
      expectedChallenge: options.expectedChallenge,
      expectedOrigin: [...EXPECTED_ORIGINS],
      expectedRPID: [...EXPECTED_RP_IDS],
      credential: {
        id: options.credential.credentialId,
        publicKey: options.credential.publicKey,
        counter: options.credential.signCount,
        transports: options.credential.transports ?? undefined,
      } as Parameters<typeof verifyAuthenticationResponse>[0]['credential'],
    });
  } catch (caught) {
    // This branch carries the clone-detection refusal as well as the origin/challenge/RP-id ones.
    return { verified: false, reason: failureReason(caught) };
  }

  if (!verification.verified) {
    return { verified: false, reason: 'the authentication response did not verify' };
  }

  return { verified: true, newSignCount: verification.authenticationInfo.newCounter };
}
