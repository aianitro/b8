// Generates the VAPID keypair Web Push identifies this server by — §5 step 26b.
//
// Run ONCE per deployment and keep the output out of the repository:
//
//   node apps/web/scripts/make-vapid-keys.mjs
//
// The public key is handed to the browser at subscribe time and is not secret. The PRIVATE key
// signs the JWT that authorises every push, so anyone holding it can make this owner's phone buzz —
// the same property `push_devices.token` has, and it gets the same treatment: `.env.local`, which is
// gitignored and excluded from the deploy rsync.
//
// P-256 because the Web Push spec says so (`ES256`), not as a choice. `web-push` generates the same
// pair; this exists so the repo does not take a dependency to call one function in `node:crypto`.

import { generateKeyPairSync } from 'node:crypto';

const b64url = (buf) => Buffer.from(buf).toString('base64url');

const { publicKey, privateKey } = generateKeyPairSync('ec', { namedCurve: 'prime256v1' });

// The UNCOMPRESSED point (0x04 || X || Y), which is what a browser's `applicationServerKey` wants.
// A DER/SPKI export would be rejected by `PushManager.subscribe` without a useful error.
const raw = publicKey.export({ format: 'jwk' });
const uncompressed = Buffer.concat([
  Buffer.from([0x04]),
  Buffer.from(raw.x, 'base64url'),
  Buffer.from(raw.y, 'base64url'),
]);

// PKCS8 DER, base64 — ONE env value that Node can import directly.
//
// The obvious alternative is the raw `d` scalar, which is what `web-push` stores and what a JWK
// calls the private key. Node will not rebuild a P-256 private key from `d` alone: a JWK EC key
// needs `x` and `y` as well, and deriving them is a point multiplication Node's crypto does not
// expose. Passing empty strings for them throws `ERR_CRYPTO_INVALID_JWK` — which, had it reached
// the daily job, would have surfaced as a phone that simply never buzzed.
const pkcs8 = privateKey.export({ format: 'der', type: 'pkcs8' });

console.log('# Web Push (VAPID). Add to apps/web/.env.local on EVERY machine that sends —');
console.log('# the local one and the server. Never commit; never rsync.');
console.log(`VAPID_PUBLIC_KEY=${b64url(uncompressed)}`);
console.log(`VAPID_PRIVATE_KEY=${pkcs8.toString('base64')}`);
console.log('# The `sub` claim. A mailto: or https: the push service can contact about this sender.');
console.log('VAPID_SUBJECT=mailto:b8@localhost');
