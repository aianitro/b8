// F7 through F13 — the verification wrappers, against the fabricated ceremony responses in
// `lib/webauthnTestFixtures.ts`.
//
// THE SHAPE OF THIS FILE IS TWO POSITIVE CONTROLS AND FIVE NEGATIVES, and the negatives are only
// worth anything because the positives exist: a verifier wired to refuse everything passes every
// negative in this file. F7 and F10 are what make F8, F9, F11, F12 and F13 falsifiable, and each
// negative differs from its positive along EXACTLY ONE axis — the origin, the challenge, the
// signing key, the credential id. Everything else about the two payloads is built by the same
// function from the same authenticator.
//
// THE FIXTURE VALUES, stated once here and transcribed into EVIDENCE.md:
//   RP id     `localhost`               (FIXTURE_RP_ID)
//   origin    `http://localhost:3000`   (FIXTURE_ORIGIN)
//   challenge 32 CSPRNG bytes, base64url, fabricated per test
//   keypair   P-256 / ES256, generated per test, never reused across files

import { describe, expect, it } from 'vitest';
import {
  AuthenticationCeremonyResponseSchema,
  RegistrationCeremonyResponseSchema,
} from '@b8/contracts/auth';
import {
  FIXTURE_ORIGIN,
  FIXTURE_RP_ID,
  FOREIGN_ORIGIN,
  createTestAuthenticator,
  fabricateAuthenticationResponse,
  fabricateChallenge,
  fabricateRegistrationResponse,
} from './webauthnTestFixtures';
import { EXPECTED_ORIGINS, EXPECTED_RP_IDS } from './webauthnOrigins';
import {
  selectCredential,
  verifyAuthenticationCeremony,
  verifyRegistrationCeremony,
  type StoredCredential,
} from './webauthnVerify';

/** Register a fabricated authenticator and return the credential as the database would hold it. */
async function enrol(): Promise<{ authenticator: ReturnType<typeof createTestAuthenticator>; credential: StoredCredential }> {
  const authenticator = createTestAuthenticator();
  const challenge = fabricateChallenge();
  const verification = await verifyRegistrationCeremony({
    ceremonyResponse: fabricateRegistrationResponse({ authenticator, challenge }),
    expectedChallenge: challenge,
  });
  if (!verification.verified) throw new Error(`fixture setup failed: ${verification.reason}`);
  return { authenticator, credential: verification.credential };
}

describe('the registration ceremony', () => {
  it('a correctly-formed registration ceremony response verifies and yields a storable credential', async () => {
    // The fixtures are pinned to values the SERVER is actually configured for. If this stops being
    // true, every negative below starts passing for the wrong reason — they would be rejected on
    // the configuration rather than on the axis each one varies.
    expect(EXPECTED_ORIGINS).toContain(FIXTURE_ORIGIN);
    expect(EXPECTED_RP_IDS).toContain(FIXTURE_RP_ID);

    const authenticator = createTestAuthenticator();
    const challenge = fabricateChallenge();
    const ceremonyResponse = fabricateRegistrationResponse({ authenticator, challenge });

    // The fabricated payload is one the frozen contract accepts, and `.parse()` keeps the keys the
    // schema does not name — `response.transports` among them. This is the loose-object rule
    // holding at the fixture as well as at the handler.
    const parsed = RegistrationCeremonyResponseSchema.parse(ceremonyResponse);
    expect((parsed.response as { transports?: string[] }).transports).toEqual(['internal', 'hybrid']);

    const verification = await verifyRegistrationCeremony({ ceremonyResponse, expectedChallenge: challenge });

    expect(verification.verified).toBe(true);
    if (!verification.verified) return;
    // STORABLE, which is a stronger claim than "verified": every column the credential table
    // requires has a value of the right shape, and none of them is empty.
    expect(verification.credential.credentialId).toBe(authenticator.credentialId);
    expect(verification.credential.credentialId).toMatch(/^[A-Za-z0-9_-]+$/);
    expect(verification.credential.publicKey.byteLength).toBeGreaterThan(0);
    expect(verification.credential.signCount).toBe(0);
    expect(verification.credential.transports).toEqual(['internal', 'hybrid']);
  });

  it("a registration response is rejected when the server's expected origin differs from the one embedded in clientDataJSON", async () => {
    const authenticator = createTestAuthenticator();
    const challenge = fabricateChallenge();
    // ONE AXIS. The origin inside `clientDataJSON` is an origin the server is not configured for;
    // the challenge, the RP id, the keypair and every byte of the attestation are what F7 used.
    const ceremonyResponse = fabricateRegistrationResponse({ authenticator, challenge, origin: FOREIGN_ORIGIN });

    // It is a perfectly well-formed payload — parsing it succeeds. Structural validity is not
    // authentication, which is why this assertion is here and not merely implied.
    expect(() => RegistrationCeremonyResponseSchema.parse(ceremonyResponse)).not.toThrow();
    expect(JSON.parse(Buffer.from(ceremonyResponse.response.clientDataJSON, 'base64url').toString()).origin)
      .toBe(FOREIGN_ORIGIN);

    const verification = await verifyRegistrationCeremony({ ceremonyResponse, expectedChallenge: challenge });

    // Refused — and there is no argument through which the caller could have offered
    // `FOREIGN_ORIGIN` as the expected value. That is the property, and it is why the function
    // takes no request.
    expect(verification.verified).toBe(false);
  });

  it("a registration response is rejected when the server's expected challenge differs from the one embedded in clientDataJSON", async () => {
    const authenticator = createTestAuthenticator();
    const issuedChallenge = fabricateChallenge();
    const someOtherChallenge = fabricateChallenge();
    expect(issuedChallenge).not.toBe(someOtherChallenge);

    // The browser answered a challenge the server did not issue for this attempt — a replayed or
    // attacker-chosen one. Everything else is F7's payload exactly.
    const ceremonyResponse = fabricateRegistrationResponse({ authenticator, challenge: someOtherChallenge });
    const verification = await verifyRegistrationCeremony({
      ceremonyResponse,
      expectedChallenge: issuedChallenge,
    });

    expect(verification.verified).toBe(false);

    // The same payload against the challenge it actually answers DOES verify, which is what makes
    // the rejection above attributable to the challenge and to nothing else.
    const control = await verifyRegistrationCeremony({
      ceremonyResponse,
      expectedChallenge: someOtherChallenge,
    });
    expect(control.verified).toBe(true);
  });
});

describe('the authentication ceremony', () => {
  it("a correctly-formed authentication response, signed by the registered credential's real private key, verifies against its stored public key", async () => {
    const { authenticator, credential } = await enrol();
    const challenge = fabricateChallenge();
    const ceremonyResponse = fabricateAuthenticationResponse({ authenticator, challenge });

    expect(() => AuthenticationCeremonyResponseSchema.parse(ceremonyResponse)).not.toThrow();

    const verification = await verifyAuthenticationCeremony({
      ceremonyResponse,
      expectedChallenge: challenge,
      credential,
    });

    expect(verification.verified).toBe(true);
    if (!verification.verified) return;
    // The counter this authenticator reported. 0 against a stored 0 is accepted, because an
    // authenticator that implements no counter reports 0 forever — the migration's `sign_count`
    // comment is the long form. Reading that as a clone would lock out every platform
    // authenticator there is.
    expect(verification.newSignCount).toBe(0);
  });

  it('an authentication response signed by a DIFFERENT private key than the one whose public key is stored is rejected', async () => {
    const { authenticator, credential } = await enrol();
    const impostor = createTestAuthenticator();
    const challenge = fabricateChallenge();

    // ONE AXIS: the signing key. The credential id, the authenticator data, the client data, the
    // origin and the challenge are the valid response's, byte for byte — only the signature was
    // produced by a key the stored public key does not match.
    const ceremonyResponse = fabricateAuthenticationResponse({
      authenticator,
      challenge,
      signingKey: impostor.privateKey,
    });
    const honest = fabricateAuthenticationResponse({ authenticator, challenge });
    expect(ceremonyResponse.id).toBe(honest.id);
    expect(ceremonyResponse.response.authenticatorData).toBe(honest.response.authenticatorData);
    expect(ceremonyResponse.response.clientDataJSON).toBe(honest.response.clientDataJSON);
    expect(ceremonyResponse.response.signature).not.toBe(honest.response.signature);

    const verification = await verifyAuthenticationCeremony({
      ceremonyResponse,
      expectedChallenge: challenge,
      credential,
    });
    expect(verification.verified).toBe(false);

    // And the honest one, differing only in the signature, verifies — so the refusal above is the
    // signature check and not some incidental malformation.
    const control = await verifyAuthenticationCeremony({
      ceremonyResponse: honest,
      expectedChallenge: challenge,
      credential,
    });
    expect(control.verified).toBe(true);
  });

  it('an authentication response for a credential ID that was never registered is rejected', async () => {
    const { authenticator, credential } = await enrol();
    const second = await enrol();
    const stranger = createTestAuthenticator();
    const challenge = fabricateChallenge();

    // THE REFUSAL IS THE APPLICATION'S, and this fixture is where that is pinned.
    // `verifyAuthenticationResponse` never compares the assertion's credential id to the credential
    // it was handed, so an unknown id is caught by the lookup — which is why the lookup is a
    // function with its own test rather than an inline `.find()` in a handler.
    const stored = [credential, second.credential];
    expect(selectCredential(stored, stranger.credentialId)).toBeNull();

    // Both enrolled credentials ARE found, over the same list — the multi-credential property that
    // a "newest row wins" lookup breaks, invisibly, until a second device tries to sign in.
    expect(selectCredential(stored, credential.credentialId)).toBe(credential);
    expect(selectCredential(stored, second.credential.credentialId)).toBe(second.credential);

    // And a caller that mis-pairs anyway is refused: an assertion signed by a genuinely enrolled
    // authenticator, but naming a credential id that is not the one being checked against.
    const misnamed = fabricateAuthenticationResponse({
      authenticator,
      challenge,
      credentialId: stranger.credentialId,
    });
    const verification = await verifyAuthenticationCeremony({
      ceremonyResponse: misnamed,
      expectedChallenge: challenge,
      credential,
    });
    expect(verification.verified).toBe(false);
  });

  it('an authentication response is rejected when its origin does not match the fixed expected-origin allowlist', async () => {
    const { authenticator, credential } = await enrol();
    const challenge = fabricateChallenge();

    // ONE AXIS: the origin in `clientDataJSON`. The signature is real and covers this client data,
    // so nothing here is malformed — the payload is internally consistent and simply happened on a
    // site this relying party does not serve.
    const ceremonyResponse = fabricateAuthenticationResponse({ authenticator, challenge, origin: FOREIGN_ORIGIN });
    expect(JSON.parse(Buffer.from(ceremonyResponse.response.clientDataJSON, 'base64url').toString()).origin)
      .toBe(FOREIGN_ORIGIN);

    const verification = await verifyAuthenticationCeremony({
      ceremonyResponse,
      expectedChallenge: challenge,
      credential,
    });
    expect(verification.verified).toBe(false);

    // The same ceremony at the configured origin verifies. Without this line the assertion above
    // would also pass against a verifier that refuses every authentication.
    const control = await verifyAuthenticationCeremony({
      ceremonyResponse: fabricateAuthenticationResponse({ authenticator, challenge, origin: FIXTURE_ORIGIN }),
      expectedChallenge: challenge,
      credential,
    });
    expect(control.verified).toBe(true);
  });
});
