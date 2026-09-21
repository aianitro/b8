// What a content-free ping says, and when it is worth sending one.
//
// ROADMAP.md §5 Phase 3 step 25, under the decision in `plan/tasks/P3-25-push-ping/DECISION.md`:
// the owner chose a ping that carries NO financial content, because push adds two intermediaries
// email does not have and lands on a lock screen readable without unlocking the phone.
//
// Pure, so the two rules that matter — what leaves the machine, and whether to send at all — are
// testable without a network, a device or Expo.

/** The message kinds the daily job can have delivered. Mirrors `alert_sends.kind`. */
export type AlertKind = 'projected-breach' | 'coverage' | 'digest';

export interface PingBody {
  title: string;
  body: string;
}

/**
 * THE ONLY TEXT THAT LEAVES THIS MACHINE, and it is a constant.
 *
 * Deliberately not a template and deliberately not parameterised by kind. A function that took the
 * category, or the amount, or even the kind, would be one edit away from putting it on a lock
 * screen — and that edit would look like a wording change rather than what it is, a change to what
 * leaves the machine. Making it a constant means the escalation the DECISION requires cannot be
 * skipped by accident: you cannot widen the payload without deleting this comment.
 */
export const PING: PingBody = {
  title: 'b8',
  body: 'Something needs you. Open to see.',
};

/**
 * Should a ping be sent?
 *
 * SUPPRESSION IS INHERITED, NOT REINVENTED. `lib/domain/breachAlert.ts` already decides what counts
 * as news and `alert_sends` records it; a second, independent notion of newsworthiness here would be
 * a second definition of the same thing, which is the defect class this repo keeps finding. So the
 * rule is narrow: ping if, and only if, the job actually delivered something on this run.
 *
 * `deliveredKinds` is what the run delivered — empty when the digest was suppressed as "not news
 * twice", when alerts are disabled, or when the send failed.
 */
export function shouldPing(deliveredKinds: readonly AlertKind[]): boolean {
  return deliveredKinds.length > 0;
}

/**
 * Expo's per-request device cap.
 *
 * Expo accepts a batch of messages in one call and documents 100 as the limit. A single-user
 * household will never approach it; the chunking exists so that a future in which it could is not a
 * silent truncation. Splitting is cheaper than discovering the cap in a provider's error string.
 */
export const MAX_DEVICES_PER_REQUEST = 100;

export function chunkDevices<T>(devices: readonly T[]): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < devices.length; i += MAX_DEVICES_PER_REQUEST) {
    out.push(devices.slice(i, i + MAX_DEVICES_PER_REQUEST));
  }
  return out;
}

/** Expo's per-ticket failure codes, narrowed to what `push_devices.last_error` may hold. */
export type PushFailure = 'unregistered' | 'transport' | 'rejected';

/**
 * Classify one Expo ticket.
 *
 * `DeviceNotRegistered` is the one that matters operationally: the app was uninstalled or the token
 * rotated, and the row should stop being a send target rather than failing nightly forever. Every
 * other error is classified, never transcribed — the same rule `alert_sends.failure_reason` follows,
 * because a provider's rejection quotes the request back.
 */
export function classifyTicket(ticket: {
  status?: string;
  details?: { error?: string };
}): PushFailure | null {
  if (ticket.status === 'ok') return null;
  if (ticket.details?.error === 'DeviceNotRegistered') return 'unregistered';
  return 'rejected';
}
