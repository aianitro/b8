import { createPrivateKey, sign as cryptoSign } from 'node:crypto';
import db from './db';
import { createLogger } from './logger';
import { shouldPing, type AlertKind } from './domain/pushPing';
import { base64url, vapidAuthorization, vapidClaims, vapidSigningInput } from './domain/vapid';

const log = createLogger('webPush');

/**
 * The daily ping, to an installed PWA — §5 step 26b.
 *
 * The shell half. Every decision lives in `domain/pushPing.ts` (whether to ping) and
 * `domain/vapid.ts` (what to sign); what is here is a key, an HTTP call and the classification of
 * what came back — the parts no unit test can reach, kept small for that reason. Same shape as
 * `lib/push.ts`, which does this for Expo, and `lib/dailyDigest.ts`, which does it for mail.
 *
 * ─── NO PAYLOAD, SO NO PAYLOAD ENCRYPTION ─────────────────────────────────────────────────────
 *
 * A Web Push may be sent with an empty body. The service worker holds the ping's text as a constant
 * and shows it on receipt, so nothing needs to travel — which removes the aes128gcm/ECDH layer that
 * `web-push` exists to provide, and with it the dependency. The `p256dh` and `auth` keys that layer
 * needs are not even stored; see the migration.
 *
 * ─── Resolves, always ─────────────────────────────────────────────────────────────────────────
 *
 * Called from the daily job after the digest. A push failing must not take down the sync, the
 * snapshot or the mail that already succeeded, so every path here ends in a log line rather than a
 * rejection. Same rule as `runDailyDigest`.
 */

/** Twenty-eight days, the spec's maximum. A ping nobody received in four weeks is not news. */
const TTL_SECONDS = 28 * 24 * 60 * 60;

interface Vapid { publicKey: string; privateKey: string; subject: string }

/**
 * The keys, or null if this machine has none.
 *
 * Absent keys are NOT an error and not a warning on every run: a checked-out repo has no VAPID
 * pair, exactly as it has no SMTP password, and `alertsEnabled` already establishes that a machine
 * which has not been configured to send simply does not send.
 */
function vapidFrom(env: NodeJS.ProcessEnv): Vapid | null {
  const publicKey = env.VAPID_PUBLIC_KEY;
  const privateKey = env.VAPID_PRIVATE_KEY;
  const subject = env.VAPID_SUBJECT;
  if (!publicKey || !privateKey || !subject) return null;
  return { publicKey, privateKey, subject };
}

/**
 * Sign the VAPID JWT with the P-256 key from the environment.
 *
 * TWO THINGS HERE ARE LOAD-BEARING AND BOTH FAIL SILENTLY IF WRONG — the push service answers 401
 * with no indication of which, so the symptom of either is a phone that never buzzes.
 *
 * PKCS8, not the raw `d` scalar. A JWK EC private key needs `x` and `y` as well as `d`, and Node
 * will not derive them — passing empty strings throws `ERR_CRYPTO_INVALID_JWK`. That is what the
 * first version of this function did, and it was caught by signing a string and verifying it
 * rather than by reading the documentation.
 *
 * `dsaEncoding: 'ieee-p1363'`, not the default. Node signs ECDSA as DER, and a JWT demands the raw
 * r‖s pair — 64 bytes rather than ~70 with a wrapper.
 */
function signJwt(signingInput: string, privateKeyBase64: string): string {
  const key = createPrivateKey({
    key: Buffer.from(privateKeyBase64, 'base64'),
    format: 'der',
    type: 'pkcs8',
  });
  const signature = cryptoSign('sha256', Buffer.from(signingInput), { key, dsaEncoding: 'ieee-p1363' });
  return base64url(signature);
}

async function liveSubscriptions(): Promise<string[]> {
  const { rows } = await db.query<{ endpoint: string }>(
    'SELECT endpoint FROM web_push_subscriptions WHERE revoked_at IS NULL ORDER BY created_at'
  );
  return rows.map((r) => r.endpoint);
}

/** What the push service said, classified — never transcribed. See the migration's note. */
export function classifyStatus(status: number): 'delivered' | 'gone' | 'rejected' | 'transport' {
  // 404 and 410 both mean the subscription is dead and will never work again. That is a different
  // fact from a refusal, and it is the one that should stop the retries rather than repeat them.
  if (status === 404 || status === 410) return 'gone';
  if (status >= 200 && status < 300) return 'delivered';
  if (status >= 500) return 'transport';
  return 'rejected';
}

export async function sendWebPushIfDelivered(deliveredKinds: readonly AlertKind[]): Promise<void> {
  try {
    // THE SAME PREDICATE THE EXPO PATH USES, imported rather than restated. Newsworthiness is
    // decided once, in `breachAlert`, recorded in `alert_sends`, and read here — a second notion of
    // it on this path would be a second definition of the same thing.
    if (!shouldPing(deliveredKinds)) return;

    const vapid = vapidFrom(process.env);
    if (vapid === null) {
      log.info('no VAPID keys on this machine, nothing attempted');
      return;
    }

    const endpoints = await liveSubscriptions();
    if (endpoints.length === 0) {
      log.info('no web push subscriptions registered');
      return;
    }

    // One request per subscription, sequential. There is no batch endpoint in Web Push — unlike
    // Expo's — and on a single-user app the list is one or two rows, so a concurrency limit would be
    // machinery for a problem that does not exist.
    for (const endpoint of endpoints) {
      const claims = vapidClaims(endpoint, vapid.subject, Date.now());
      const signingInput = vapidSigningInput(claims);
      let outcome: ReturnType<typeof classifyStatus>;
      try {
        const response = await fetch(endpoint, {
          method: 'POST',
          headers: {
            Authorization: vapidAuthorization(signingInput, signJwt(signingInput, vapid.privateKey), vapid.publicKey),
            TTL: String(TTL_SECONDS),
            // Apple refuses a push with no `Content-Length`, and an empty body needs it stated.
            'Content-Length': '0',
            // What the notification is FOR. `Urgency: normal` is the default and is right: this is
            // a once-a-day ping, not an alarm, and `high` costs battery for no benefit.
            Urgency: 'normal',
          },
        });
        outcome = classifyStatus(response.status);
      } catch {
        // Never reached the service at all — a different fact from being refused by it.
        outcome = 'transport';
      }

      if (outcome === 'delivered') {
        await db.query('UPDATE web_push_subscriptions SET last_sent_at = NOW(), last_error = NULL WHERE endpoint = $1', [endpoint]);
      } else {
        // A DEAD SUBSCRIPTION REVOKES ITSELF. 404/410 is the push service saying this device will
        // never receive again; leaving it live would retry it every morning forever and bury the
        // one row that still works among rows that cannot.
        await db.query(
          `UPDATE web_push_subscriptions
              SET last_error = $2, revoked_at = CASE WHEN $2 = 'gone' THEN NOW() ELSE revoked_at END
            WHERE endpoint = $1`,
          [endpoint, outcome]
        );
        // The endpoint is credential-shaped and never logged — the same rule the token path follows.
        log.error('web push not delivered', { outcome });
      }
    }
  } catch (err) {
    // Anything unclassified. Logged and dropped, because the alternative is an unhandled rejection
    // inside the daily job that also runs the sync, the snapshot and the mail.
    log.error('web push failed', { error: err instanceof Error ? err.message : String(err) });
  }
}

/** Register or re-register a subscription. Re-subscribing the same device must not duplicate it. */
export async function registerSubscription(endpoint: string, label: string | null): Promise<void> {
  await db.query(
    `INSERT INTO web_push_subscriptions (endpoint, label) VALUES ($1, $2)
     ON CONFLICT (endpoint) DO UPDATE
       SET label = EXCLUDED.label,
           -- Re-subscribing is how a revoked or failed device comes back, so both are cleared.
           revoked_at = NULL,
           last_error = NULL`,
    [endpoint, label]
  );
}
