// T-Fixture — a fabricated, self-consistent pair of WebAuthn ceremony responses, built from a real
// test keypair, for the fixtures that cannot exist without one.
//
// WHY THIS EXISTS. SPEC.md's toolchain row T-Fixture records that no such thing is in this repo and
// that F7 onward cannot run until one is: a registration response whose embedded public key belongs
// to a private key this file holds, and an authentication response that key really signed, both
// pinned to a stated RP id, origin and challenge. There is no hardware authenticator in a test
// process and no virtual one in this repo (SPEC.md rules out Playwright and WebDriver), so the
// authenticator side is built here, by hand, to the WebAuthn specification's byte layout.
//
// THE HONEST CLAIM ABOUT WHAT THIS PROVES. This file is not a second implementation of
// verification and must never become one — `@simplewebauthn/server` is the ground truth for
// "valid", and the only reason F7 and F10 pass is that a real ECDSA signature over real
// authenticator data satisfies it. What this file CAN get wrong is producing something invalid,
// and that failure is loud: the positive controls stop passing. What it cannot do is make an
// invalid response look valid, because it does not do the checking.
//
// IT LIVES UNDER `lib/` BECAUSE THAT IS THE DECLARED SURFACE. SPEC.md's acceptance #39/#40 list the
// paths this task may touch, and a `test/` or `fixtures/` directory is not among them. It is
// nonetheless test-only: nothing under `app/` imports it, so it is not reachable from any route and
// is never bundled. Named `…TestFixtures` rather than `…Fixtures` so that is obvious at the import
// site.
//
// EVERY VALUE HERE IS FABRICATED. No real credential, no real key, no real hostname beyond the
// `localhost` the dev server already binds.

import { createHash, createSign, generateKeyPairSync, randomBytes, type KeyObject } from 'node:crypto';
import { isoCBOR } from '@simplewebauthn/server/helpers';
import type {
  AuthenticationCeremonyResponse,
  RegistrationCeremonyResponse,
} from '../shared/contracts/auth';

/**
 * The relying-party id and origin every fixture in this task is pinned to.
 *
 * Stated as literals rather than imported from `lib/webauthnOrigins.ts`, so a fixture asserts
 * against a written-down value instead of against whatever the configuration says today — the same
 * reason F1 asserts the Tailscale hostname's literal alongside the constant. `lib/webauthnVerify`'s
 * fixtures additionally assert that these literals are members of the derived sets, which is what
 * connects the two without making one define the other.
 */
export const FIXTURE_RP_ID = 'localhost';
export const FIXTURE_ORIGIN = 'http://localhost:3000';

/** An origin this server is not configured for — the one axis F8 and F13 vary. */
export const FOREIGN_ORIGIN = 'https://evil.example.com';

/** A fabricated challenge: base64url over 32 CSPRNG bytes, as a real ceremony's would be. */
export function fabricateChallenge(): string {
  return randomBytes(32).toString('base64url');
}

/** A fabricated authenticator: one P-256 keypair and the credential id it answers to. */
export interface TestAuthenticator {
  credentialId: string;
  credentialIdBytes: Buffer;
  privateKey: KeyObject;
  publicKey: KeyObject;
}

export function createTestAuthenticator(): TestAuthenticator {
  // ES256 (COSE alg -7) over P-256 — the algorithm every platform authenticator implements and the
  // first one `generateRegistrationOptions` offers.
  const { privateKey, publicKey } = generateKeyPairSync('ec', { namedCurve: 'P-256' });
  const credentialIdBytes = randomBytes(32);
  return {
    credentialId: credentialIdBytes.toString('base64url'),
    credentialIdBytes,
    privateKey,
    publicKey,
  };
}

/**
 * The COSE_Key encoding of an EC2/P-256 public key: a CBOR map of five entries.
 *
 * `isoCBOR` is the library's own encoder, used here rather than a hand-rolled one for the same
 * reason `@simplewebauthn/browser` is used on the page: the encoding step is where the bugs live.
 * The raw curve point is taken off the end of the SPKI DER — for P-256 the last 65 bytes are the
 * uncompressed point `0x04 || X(32) || Y(32)`.
 */
function coseEs256PublicKey(publicKey: KeyObject): Buffer {
  const der = publicKey.export({ type: 'spki', format: 'der' });
  const point = der.subarray(der.length - 65);
  const cose = new Map<number, number | Uint8Array>();
  cose.set(1, 2); // kty: EC2
  cose.set(3, -7); // alg: ES256
  cose.set(-1, 1); // crv: P-256
  cose.set(-2, new Uint8Array(point.subarray(1, 33))); // x
  cose.set(-3, new Uint8Array(point.subarray(33, 65))); // y
  return Buffer.from(isoCBOR.encode(cose));
}

/**
 * Authenticator data: `rpIdHash(32) || flags(1) || signCount(4)`, plus attested credential data on
 * a registration.
 *
 * The RP ID HASH IS WHAT BINDS A CEREMONY TO A RELYING PARTY, and it is computed here from whatever
 * RP id the caller passed — which is how a fixture can fabricate a response for the wrong relying
 * party without the response being malformed in any other way.
 *
 * Flags: UP (0x01) and UV (0x04) are set because `verifyRegistrationResponse` requires user
 * presence and user verification by default and this app does not relax either. AT (0x40) marks
 * attested credential data present, which only a registration carries.
 */
function authenticatorData(options: {
  rpId: string;
  signCount: number;
  attestedCredentialData: Buffer | null;
}): Buffer {
  const rpIdHash = createHash('sha256').update(options.rpId).digest();
  const flags = Buffer.from([options.attestedCredentialData ? 0x45 : 0x05]);
  const counter = Buffer.alloc(4);
  counter.writeUInt32BE(options.signCount);
  const head = Buffer.concat([rpIdHash, flags, counter]);
  return options.attestedCredentialData ? Buffer.concat([head, options.attestedCredentialData]) : head;
}

/** `clientDataJSON`, as the browser would build it: the type, the challenge and the origin. */
function clientDataJSON(type: 'webauthn.create' | 'webauthn.get', challenge: string, origin: string): Buffer {
  return Buffer.from(JSON.stringify({ type, challenge, origin, crossOrigin: false }));
}

/**
 * A registration response for `authenticator`, answering `challenge`.
 *
 * `fmt: 'none'` attestation — no attestation statement, which is what a platform authenticator
 * returns for a passkey and what this app asks for. The public key really is the fixture keypair's,
 * so the authentication responses below verify against what registration stores.
 */
export function fabricateRegistrationResponse(options: {
  authenticator: TestAuthenticator;
  challenge: string;
  rpId?: string;
  origin?: string;
  signCount?: number;
  transports?: string[];
}): RegistrationCeremonyResponse {
  const rpId = options.rpId ?? FIXTURE_RP_ID;
  const origin = options.origin ?? FIXTURE_ORIGIN;
  const cose = coseEs256PublicKey(options.authenticator.publicKey);
  const idLength = Buffer.alloc(2);
  idLength.writeUInt16BE(options.authenticator.credentialIdBytes.length);
  const attestedCredentialData = Buffer.concat([
    Buffer.alloc(16), // AAGUID — all zeroes, which is what a passkey provider reports
    idLength,
    options.authenticator.credentialIdBytes,
    cose,
  ]);
  const attestationObject = new Map<string, string | Map<never, never> | Uint8Array>();
  attestationObject.set('fmt', 'none');
  attestationObject.set('attStmt', new Map<never, never>());
  attestationObject.set(
    'authData',
    new Uint8Array(authenticatorData({ rpId, signCount: options.signCount ?? 0, attestedCredentialData }))
  );

  return {
    id: options.authenticator.credentialId,
    rawId: options.authenticator.credentialId,
    type: 'public-key',
    response: {
      clientDataJSON: clientDataJSON('webauthn.create', options.challenge, origin).toString('base64url'),
      attestationObject: Buffer.from(isoCBOR.encode(attestationObject)).toString('base64url'),
      // Carried through deliberately: `response.transports` is a key no schema in
      // `shared/contracts/auth.ts` names, and a stripping parse would drop it before the verifier
      // ever saw it. A fixture that omitted it could not catch that.
      transports: options.transports ?? ['internal', 'hybrid'],
    },
    clientExtensionResults: {},
  };
}

/**
 * An authentication response for `authenticator`, answering `challenge`.
 *
 * `signingKey` DEFAULTS TO THE AUTHENTICATOR'S OWN PRIVATE KEY and exists as a separate parameter
 * for exactly one fixture: F11 signs a structurally identical response with a DIFFERENT key and
 * requires it to be refused. Everything else about that response — the credential id, the
 * authenticator data, the client data, the origin, the challenge — is byte-identical to a valid
 * one, so the fixture varies one axis and only one.
 *
 * The signature is ECDSA-SHA256 over `authenticatorData || SHA256(clientDataJSON)`, DER-encoded,
 * which is what WebAuthn specifies for ES256 and what Node's `createSign` produces by default.
 */
export function fabricateAuthenticationResponse(options: {
  authenticator: TestAuthenticator;
  challenge: string;
  rpId?: string;
  origin?: string;
  signCount?: number;
  signingKey?: KeyObject;
  credentialId?: string;
}): AuthenticationCeremonyResponse {
  const rpId = options.rpId ?? FIXTURE_RP_ID;
  const origin = options.origin ?? FIXTURE_ORIGIN;
  const authData = authenticatorData({
    rpId,
    signCount: options.signCount ?? 0,
    attestedCredentialData: null,
  });
  const clientData = clientDataJSON('webauthn.get', options.challenge, origin);
  const signature = createSign('sha256')
    .update(Buffer.concat([authData, createHash('sha256').update(clientData).digest()]))
    .sign(options.signingKey ?? options.authenticator.privateKey);

  const credentialId = options.credentialId ?? options.authenticator.credentialId;
  return {
    id: credentialId,
    rawId: credentialId,
    type: 'public-key',
    response: {
      clientDataJSON: clientData.toString('base64url'),
      authenticatorData: authData.toString('base64url'),
      signature: signature.toString('base64url'),
      // A non-discoverable credential returns none, and this app never routes on it: there is one
      // principal, so the handle carries nothing that could select a credential.
      userHandle: null,
    },
    clientExtensionResults: {},
  };
}
