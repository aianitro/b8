// Sending the ping. The rules live in `lib/domain/pushPing.ts`; this is the network and the rows.
//
// THE ONLY OUTBOUND DESTINATION THIS FILE MAY TALK TO is Expo's push service, and the only payload
// it may carry is the constant `PING`. Both are fixed by `plan/tasks/P3-25-push-ping/DECISION.md`,
// which is the BUILD.md §5.1 escalation ROADMAP.md §5's outbound carve-out requires every time a
// destination changes. Widening either is a new escalation, not a patch.

import db from '@/lib/db';
import { createLogger } from '@/lib/logger';
import {
  chunkDevices, classifyTicket, PING, shouldPing, type AlertKind, type PushFailure,
} from '@/lib/domain/pushPing';

const log = createLogger('push');

const EXPO_ENDPOINT = 'https://exp.host/--/api/v2/push/send';

/** Every device still listening. Revoked rows are never send targets. */
async function activeDevices(): Promise<string[]> {
  const r = await db.query<{ token: string }>(
    'SELECT token FROM push_devices WHERE revoked_at IS NULL ORDER BY created_at'
  );
  return r.rows.map((row) => row.token);
}

export async function registerDevice(token: string, label: string | null): Promise<void> {
  // ON CONFLICT rather than an insert-or-check: re-opening the app must be idempotent, and a device
  // that was revoked and then registers again is the owner deliberately re-enabling it.
  await db.query(
    `INSERT INTO push_devices (token, label) VALUES ($1, $2)
     ON CONFLICT (token) DO UPDATE
        SET label = COALESCE(EXCLUDED.label, push_devices.label),
            revoked_at = NULL,
            last_error = NULL`,
    [token, label]
  );
  // The token is NOT logged. It addresses a device — anyone holding it can make this phone buzz —
  // so it is treated like the credential it is, exactly as `lib/sessionToken.ts` treats its own.
  log.info('push device registered', { label });
}

/**
 * Send one content-free ping per listening device, if the run delivered anything.
 *
 * RESOLVES RATHER THAN REJECTS, by construction. This is the same rule the mail follows in
 * `lib/scheduler.ts`: the transport is the least important thing in the daily job, and a push outage
 * must never cost the sync, the snapshot or the digest that already went out.
 */
export async function sendPingIfDelivered(deliveredKinds: readonly AlertKind[]): Promise<void> {
  try {
    if (!shouldPing(deliveredKinds)) {
      log.info('nothing delivered, no ping');
      return;
    }

    const devices = await activeDevices();
    if (devices.length === 0) {
      log.info('no registered devices');
      return;
    }

    for (const batch of chunkDevices(devices)) {
      // The payload is the CONSTANT, spread into one message per device. There is no branch here on
      // kind, category or amount, and adding one would be the payload change the DECISION forbids.
      const messages = batch.map((to) => ({ to, title: PING.title, body: PING.body, sound: 'default' }));

      let response: Response;
      try {
        response = await fetch(EXPO_ENDPOINT, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
          body: JSON.stringify(messages),
        });
      } catch {
        await recordFailure(batch, 'transport');
        log.warn('push transport failed', { devices: batch.length });
        continue;
      }

      if (!response.ok) {
        await recordFailure(batch, 'rejected');
        log.warn('push rejected', { status: response.status, devices: batch.length });
        continue;
      }

      // Expo answers with one ticket per message, in order.
      const body = (await response.json()) as { data?: Array<{ status?: string; details?: { error?: string } }> };
      const tickets = body.data ?? [];

      await Promise.all(batch.map(async (token, i) => {
        const failure = tickets[i] ? classifyTicket(tickets[i]) : 'rejected';
        if (failure === null) {
          await db.query('UPDATE push_devices SET last_sent_at = now(), last_error = NULL WHERE token = $1', [token]);
          return;
        }
        // AN UNINSTALLED APP REVOKES ITSELF. Without this the row fails every night forever, and a
        // nightly failure nobody acts on is a log line that trains you to ignore the log.
        if (failure === 'unregistered') {
          await db.query(
            "UPDATE push_devices SET revoked_at = now(), last_error = 'unregistered' WHERE token = $1",
            [token]
          );
          log.info('push device gone, revoked itself');
          return;
        }
        await db.query('UPDATE push_devices SET last_error = $2 WHERE token = $1', [token, failure]);
      }));
    }

    log.info('ping sent', { devices: devices.length, kinds: deliveredKinds.length });
  } catch (err) {
    // Swallowed on purpose, and recorded. See the resolves-rather-than-rejects note above.
    log.error('ping failed', { error: err instanceof Error ? err.message : String(err) });
  }
}

async function recordFailure(tokens: readonly string[], failure: PushFailure): Promise<void> {
  await db.query('UPDATE push_devices SET last_error = $2 WHERE token = ANY($1)', [tokens, failure]);
}
