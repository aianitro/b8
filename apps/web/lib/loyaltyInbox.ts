// Loyalty inbox (P8-42c1) — collecting forwarded loyalty mail: the poll, the retention purge, the
// daily step, the overview's inbox panel and re-attribution after an address edit. The decisions
// about one message are `lib/domain/loyaltyInbox.ts`'s; the mailbox is `lib/loyaltyInboxSource.ts`'s.
// This file lists, decides by asking those, and records. It is the only non-test file that names
// the raw bytes column: no route, page or log reads it, and the overview never selects it.
//
// ─── WHAT A POLL DOES, IN ORDER ───────────────────────────────────────────────────────────────
//
//   1. The configuration. Unset or invalid: outcome `disabled`, nothing read, nothing written.
//   2. The lock. A Postgres session advisory lock on ONE dedicated client, held for the whole poll,
//      taken by the route and the daily job alike (they can be different processes). Not taken:
//      `already_running`, nothing written. Released on every path, a timeout and an error included;
//      a process that dies loses it with its connection.
//   3. The envelopes received since CURRENT_DATE minus the retention days. Each one is, in turn:
//        expired    — its received date (UTC, from Postgres) is before the window: dropped, not stored
//                     and not counted unknown. The window and the purge share one boundary, so a
//                     message is never fetched after it was purged.
//        duplicate  — its dedupe key is already in either table: never downloaded or counted again.
//        unknown    — its envelope sender is neither allowlisted nor a registered member address:
//                     counted by domain (or `(unreadable)`), NEVER downloaded.
//        oversize   — allowlisted but larger than the cap: recorded without bytes, never downloaded.
//                     When the server reports no size, the bounded download decides instead: more
//                     bytes than the cap arrived means oversize, and the truncated bytes are dropped.
//        downloaded — allowlisted, or from a member (a possible manual forward): parsed in memory,
//                     the original sender judged again, then stored with its attribution, or, when no
//                     allowlisted original is found, discarded and counted unknown. A message the
//                     parser refuses is counted unknown under `(unreadable)`, with its key, and the
//                     poll goes on to the next one.
//      The source is then closed, within a bound, so a close that never settles cannot hold the lock.
//   4. The state row: `ok`, or `error` with a classified code.
//   5. The purge, so retention never depends on the daily job having run.
//
// ─── LOGS CARRY COUNTS AND CODES ONLY ─────────────────────────────────────────────────────────
//
// Never a subject, an address, a domain, a body, a host, a user, a password or library error text.
// A failure is reported as one of the six poll error codes, decided in the source file from the
// error's code fields; its message is never read here.
//
// ─── DATES ARE POSTGRES'S ─────────────────────────────────────────────────────────────────────
//
// Every "today", window, cut-off and day difference is CURRENT_DATE arithmetic in SQL; the received
// date is `(<ISO text>::timestamptz AT TIME ZONE 'UTC')::date`. No JS clock is read here.

import type { PoolClient } from 'pg';
import db from './db';
import { createLogger } from './logger';
import type { Queryable } from './loyaltyStore';
import {
  analyseMessage,
  attributeMessage,
  envelopeKey,
  matchSenderDomain,
  messageIdKey,
  rawKey,
  senderDomainOf,
  type StoredDomain,
} from './domain/loyaltyInbox';
import { CLOSE_BOUND_MS, classifySourceError, createMailSource, describeInboxConfig, readInboxConfig, type MailSource } from './loyaltyInboxSource';
import {
  LOYALTY_INBOX_MAX_BYTES,
  LOYALTY_INBOX_RETENTION_DAYS,
  LOYALTY_INBOX_SILENCE_DAYS,
  LOYALTY_INBOX_UNKNOWN_LIMIT,
  LOYALTY_INBOX_UNREADABLE,
  normaliseLoyaltyInboxEntry,
  type LoyaltyInbox,
  type LoyaltyInboxAttribution,
  type LoyaltyInboxForwardingState,
  type LoyaltyInboxOrigin,
  type LoyaltyInboxPoll,
  type LoyaltyInboxPollErrorCode,
} from '@b8/contracts/loyalty';

const log = createLogger('loyalty-inbox');

/**
 * The advisory lock's key: Postgres's own hash of a name no other feature uses, so the lock cannot
 * collide with another feature's integer by accident.
 */
const LOCK_SQL = `hashtext('b8:loyalty-inbox:poll')`;

type Env = Readonly<Record<string, string | undefined>>;

const zeroPoll = (outcome: LoyaltyInboxPoll['outcome'], errorCode: LoyaltyInboxPollErrorCode | null = null): LoyaltyInboxPoll => ({
  outcome, fetched: 0, stored: 0, duplicates: 0, unknown: 0, expired: 0, oversize: 0, errorCode,
});

// ─── The poll ──────────────────────────────────────────────────────────────────────────────────

type Counts = Omit<LoyaltyInboxPoll, 'outcome' | 'errorCode'>;

/** Configuration the poll decides by: the allowlist and who forwards from where. */
async function loadRouting(q: Queryable): Promise<{ domains: StoredDomain[]; memberOf: Map<string, number> }> {
  const [d, a] = await Promise.all([
    q.query<{ domain: string; programId: number }>('SELECT domain, program_id AS "programId" FROM loyalty_sender_domains'),
    q.query<{ address: string; memberId: number }>('SELECT address, member_id AS "memberId" FROM household_member_addresses'),
  ]);
  return { domains: d.rows, memberOf: new Map(a.rows.map((r) => [r.address, r.memberId])) };
}

/** Advances the durable dates of a stored message: monotone, so an older message never moves them back. */
async function advanceDates(q: Queryable, domain: string, receivedOn: string, addresses: string[]): Promise<void> {
  await q.query(
    `UPDATE loyalty_sender_domains SET last_seen_on = GREATEST(COALESCE(last_seen_on, $2::date), $2::date) WHERE domain = $1`,
    [domain, receivedOn]
  );
  if (addresses.length > 0) {
    await q.query(
      `UPDATE household_member_addresses SET last_received_on = GREATEST(COALESCE(last_received_on, $2::date), $2::date)
        WHERE address = ANY($1::text[])`,
      [addresses, receivedOn]
    );
  }
}

/** One unknown row; false when its key already existed (a lost race: a duplicate, never an error). */
async function recordUnknown(key: string, receivedOn: string, domain: string | null): Promise<boolean> {
  const r = await db.query(
    `INSERT INTO loyalty_inbox_unknown_senders (dedupe_key, received_on, domain) VALUES ($1, $2, $3)
     ON CONFLICT (dedupe_key) DO NOTHING RETURNING dedupe_key`,
    [key, receivedOn, domain ?? LOYALTY_INBOX_UNREADABLE]
  );
  return r.rows.length === 1;
}

interface StoredMessage {
  key: string;
  receivedOn: string;
  match: StoredDomain;
  senderDomain: string;
  origin: LoyaltyInboxOrigin;
  attribution: LoyaltyInboxAttribution;
  memberId: number | null;
  addresses: string[];
  raw: Buffer | null;
}

/** One kept message and its durable dates, in one transaction; false when its key already existed. */
async function recordMessage(m: StoredMessage): Promise<boolean> {
  const client = await db.connect();
  try {
    await client.query('BEGIN');
    const r = await client.query(
      `INSERT INTO loyalty_inbox_messages
         (dedupe_key, received_on, program_id, sender_domain, origin, attribution, member_id, raw_mail, oversize)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
       ON CONFLICT (dedupe_key) DO NOTHING RETURNING id`,
      [m.key, m.receivedOn, m.match.programId, m.senderDomain, m.origin, m.attribution, m.memberId, m.raw, m.raw === null]
    );
    if (r.rows.length === 1) await advanceDates(client, m.match.domain, m.receivedOn, m.addresses);
    await client.query('COMMIT');
    return r.rows.length === 1;
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}

/**
 * The body of one poll, under the lock. `stopped()` turns true when the poll has timed out; every
 * write checks it first, so a source that wakes up after the timeout cannot write rows behind a
 * released lock.
 */
async function collect(source: MailSource, counts: Counts, stopped: () => boolean): Promise<void> {
  const since = (await db.query<{ d: string }>('SELECT (CURRENT_DATE - $1::int)::text AS d', [LOYALTY_INBOX_RETENTION_DAYS])).rows[0].d;
  const envelopes = await source.list(since);
  if (stopped()) return;
  counts.fetched = envelopes.length;
  if (envelopes.length === 0) return;

  const dated = await db.query<{ receivedOn: string; expired: boolean }>(
    `SELECT (t::timestamptz AT TIME ZONE 'UTC')::date::text AS "receivedOn",
            (t::timestamptz AT TIME ZONE 'UTC')::date < CURRENT_DATE - $2::int AS expired
       FROM unnest($1::text[]) WITH ORDINALITY AS u(t, n) ORDER BY n`,
    [envelopes.map((e) => e.receivedAt), LOYALTY_INBOX_RETENTION_DAYS]
  );
  const { domains, memberOf } = await loadRouting(db);
  const listedKeys = envelopes.map((e) => messageIdKey(e.messageId)).filter((k): k is string => k !== null);
  const known = new Set(
    (await db.query<{ k: string }>(
      `SELECT dedupe_key AS k FROM loyalty_inbox_messages WHERE dedupe_key = ANY($1::text[])
       UNION SELECT dedupe_key FROM loyalty_inbox_unknown_senders WHERE dedupe_key = ANY($1::text[])`,
      [listedKeys]
    )).rows.map((r) => r.k)
  );

  const unknown = async (key: string, receivedOn: string, domain: string | null) => {
    if (stopped()) return;
    if (await recordUnknown(key, receivedOn, domain)) counts.unknown++;
    else counts.duplicates++;
    known.add(key);
  };

  for (const [i, env] of envelopes.entries()) {
    if (stopped()) return;
    const { receivedOn, expired } = dated.rows[i];
    if (expired) { counts.expired++; continue; }
    const listedKey = messageIdKey(env.messageId);
    if (listedKey !== null && known.has(listedKey)) { counts.duplicates++; continue; }

    const fromAddress = env.fromAddress === null ? null : normaliseLoyaltyInboxEntry(env.fromAddress);
    const outerDomain = senderDomainOf(fromAddress);
    const fromMember = fromAddress !== null && memberOf.has(fromAddress);
    const outerMatch = matchSenderDomain(outerDomain, domains);
    if (!fromMember && outerMatch === null) {
      await unknown(listedKey ?? envelopeKey(env), receivedOn, outerDomain);
      continue;
    }
    // Over the cap: kept without bytes. With an allowlisted envelope sender it is recorded, its
    // columns from the envelope alone; a member's oversize forward has no allowlisted sender the
    // envelope can show, so it is counted unknown under the forwarder's domain. Its key never
    // depends on the bytes, so a re-poll finds it before any download.
    const oversize = async () => {
      const key = listedKey ?? envelopeKey(env);
      if (outerMatch === null || outerDomain === null) { await unknown(key, receivedOn, outerDomain); return; }
      if (stopped()) return;
      const kept = await recordMessage({
        key, receivedOn, match: outerMatch, senderDomain: outerDomain, origin: 'direct',
        attribution: 'none_found', memberId: null, addresses: [], raw: null,
      });
      if (kept) { counts.stored++; counts.oversize++; } else counts.duplicates++;
      known.add(key);
    };
    // Decided before the download when the server reported a size. A null size is unknown, never 0:
    // the message is fetched (the adapter bounds that fetch at one byte over the cap) and judged by
    // the bytes that arrived.
    if (env.size !== null && env.size > LOYALTY_INBOX_MAX_BYTES) { await oversize(); continue; }

    const raw = await source.fetch(env.id);
    if (stopped()) return;
    if (raw.length > LOYALTY_INBOX_MAX_BYTES) { await oversize(); continue; }
    const key = listedKey ?? rawKey(raw);
    if (known.has(key)) { counts.duplicates++; continue; }
    // One message the parser refuses (a header block or a part count over mailparser's limits, a
    // malformed structure, a forwarded original that will not parse) must never abort the poll: it
    // would be re-fetched and fail again on every poll, and every later message would wait behind
    // it. It is counted as an unreadable sender, under its key, so it is never downloaded again
    // when it has a Message-ID, and the walk goes on.
    let analysis: Awaited<ReturnType<typeof analyseMessage>>;
    try {
      analysis = await analyseMessage(raw, (a) => memberOf.has(a));
    } catch {
      await unknown(key, receivedOn, null);
      continue;
    }
    const match = matchSenderDomain(analysis.senderDomain, domains);
    if (match === null || analysis.senderDomain === null) {
      // A member's forward of a sender nobody allowlisted: judged, discarded, counted. The bytes were
      // only ever held in memory.
      await unknown(key, receivedOn, analysis.senderDomain);
      continue;
    }
    const who = attributeMessage(analysis.tiers, memberOf);
    if (stopped()) return;
    const kept = await recordMessage({
      key, receivedOn, match, senderDomain: analysis.senderDomain, origin: analysis.origin,
      attribution: who.attribution, memberId: who.memberId, addresses: who.addresses, raw,
    });
    if (kept) counts.stored++; else counts.duplicates++;
    known.add(key);
  }
}

/**
 * How long the poller waits for a source's `close()` before it moves on and releases the lock. Above
 * the real adapter's own LOGOUT bound, which then force-closes its socket, so the adapter normally
 * finishes first; this bound is for a source whose close never settles at all.
 */
const CLOSE_WAIT_MS = CLOSE_BOUND_MS + 1000;

/** Calls `close()` and waits at most `ms` for it; its outcome, settled or not, is ignored. */
async function closeWithin(source: MailSource, ms: number): Promise<void> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const bound = new Promise<void>((resolve) => { timer = setTimeout(resolve, ms); });
  try {
    await Promise.race([Promise.resolve().then(() => source.close()).catch(() => {}), bound]);
  } finally {
    clearTimeout(timer);
  }
}

/** Sets all three state columns together: the CHECKs refuse any partial combination. */
async function recordState(errorCode: LoyaltyInboxPollErrorCode | null): Promise<void> {
  await db.query(
    `UPDATE loyalty_inbox_state SET last_polled_on = CURRENT_DATE, last_outcome = $1, last_error_code = $2 WHERE id = 1`,
    [errorCode === null ? 'ok' : 'error', errorCode]
  );
}

/** Takes the advisory lock on a dedicated client, or returns null (and releases it) when held elsewhere. */
async function takeLock(): Promise<PoolClient | null> {
  const client = await db.connect();
  try {
    const r = await client.query<{ locked: boolean }>(`SELECT pg_try_advisory_lock(${LOCK_SQL}) AS locked`);
    if (r.rows[0].locked) return client;
    client.release();
    return null;
  } catch (err) {
    client.release(true);
    throw err;
  }
}

async function releaseLock(client: PoolClient): Promise<void> {
  try {
    await client.query(`SELECT pg_advisory_unlock(${LOCK_SQL})`);
    client.release();
  } catch {
    // A client whose unlock failed is destroyed, never returned to the pool still holding the lock;
    // closing its session releases the lock.
    client.release(true);
  }
}

/**
 * One poll of the mailbox. Resolves, never rejects: a failure is `outcome: 'error'` with a code. The
 * environment is read now, not at import.
 */
export async function pollLoyaltyInbox(env: Env = process.env): Promise<LoyaltyInboxPoll> {
  const config = readInboxConfig(env);
  if (!config.ok) return zeroPoll('disabled');

  let lock: PoolClient | null;
  try {
    lock = await takeLock();
  } catch {
    log.error('loyalty inbox poll failed', { code: 'source_failed' });
    return zeroPoll('error', 'source_failed');
  }
  if (lock === null) return zeroPoll('already_running');

  const counts: Counts = { fetched: 0, stored: 0, duplicates: 0, unknown: 0, expired: 0, oversize: 0 };
  let errorCode: LoyaltyInboxPollErrorCode | null = null;
  let timedOut = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let source: MailSource | null = null;
  try {
    source = createMailSource(env);
    const opened = source;
    const timeout = new Promise<'timeout'>((resolve) => {
      timer = setTimeout(() => resolve('timeout'), config.timeoutSeconds * 1000);
    });
    const work = collect(opened, counts, () => timedOut).then(() => 'done' as const);
    // A source that fails after the timeout already decided the outcome must not surface as an
    // unhandled rejection; the race below still sees a failure that comes first.
    work.catch(() => {});
    const finished = await Promise.race([work, timeout]);
    if (finished === 'timeout') { timedOut = true; errorCode = 'timeout'; }
  } catch (err) {
    timedOut = true;
    errorCode = classifySourceError(err);
  } finally {
    clearTimeout(timer);
    // Bounded: a close that never settles (a server that never completes LOGOUT) must not keep the
    // advisory lock, and the digest after the daily step, waiting.
    if (source !== null) await closeWithin(source, CLOSE_WAIT_MS);
  }

  try {
    await recordState(errorCode);
    await purgeExpiredInbox();
  } catch {
    errorCode = errorCode ?? 'source_failed';
  } finally {
    await releaseLock(lock);
  }
  const result: LoyaltyInboxPoll = { outcome: errorCode === null ? 'ok' : 'error', ...counts, errorCode };
  if (errorCode === null) log.info('loyalty inbox polled', { ...counts });
  else log.warn('loyalty inbox poll failed', { code: errorCode, ...counts });
  return result;
}

// ─── Retention ─────────────────────────────────────────────────────────────────────────────────

/**
 * Deletes kept mail (bytes included) and unknown-sender rows received STRICTLY before CURRENT_DATE
 * minus the retention days: exactly thirty days old is kept, thirty-one is deleted. Configuration,
 * the state row and the two durable "last" dates are never touched — health and coverage must
 * outlive the mail. Physical erasure of the bytes follows autovacuum (a stated limit).
 */
export async function purgeExpiredInbox(q: Queryable = db): Promise<{ messages: number; unknown: number }> {
  const m = await q.query('DELETE FROM loyalty_inbox_messages WHERE received_on < CURRENT_DATE - $1::int', [LOYALTY_INBOX_RETENTION_DAYS]);
  const u = await q.query('DELETE FROM loyalty_inbox_unknown_senders WHERE received_on < CURRENT_DATE - $1::int', [LOYALTY_INBOX_RETENTION_DAYS]);
  return { messages: m.rowCount ?? 0, unknown: u.rowCount ?? 0 };
}

/**
 * The daily job's step: poll, then purge (the purge runs even when the poller is disabled, so
 * retention holds with the mailbox switched off). Resolves, never rejects: an inbox failure must
 * never cost the digest after it.
 */
export async function runLoyaltyInboxDaily(): Promise<void> {
  try {
    const poll = await pollLoyaltyInbox();
    const purged = await purgeExpiredInbox();
    log.info('loyalty inbox daily step', { outcome: poll.outcome, code: poll.errorCode, purgedMessages: purged.messages, purgedUnknown: purged.unknown });
  } catch {
    log.error('loyalty inbox daily step failed', { code: 'source_failed' });
  }
}

// ─── Re-attribution ────────────────────────────────────────────────────────────────────────────

/**
 * After a member's address list changed: re-attributes every retained message that is not yet
 * `matched`, from its stored bytes, with the current addresses. Only ever moves `unmatched`,
 * `none_found` and `ambiguous` to `matched`; a matched message is never reassigned or un-matched,
 * and the durable received date only moves forward. The origin a message was stored with is kept:
 * a forwarded original is re-read only for a message already stored as forwarded. An oversize
 * message has no bytes and stays as it is. Runs inside the caller's transaction.
 */
export async function reattributeInbox(q: Queryable): Promise<number> {
  const rows = await q.query<{ id: number; receivedOn: string; origin: LoyaltyInboxOrigin; raw: Buffer }>(
    `SELECT id, received_on::text AS "receivedOn", origin, raw_mail AS raw
       FROM loyalty_inbox_messages
      WHERE attribution <> 'matched' AND raw_mail IS NOT NULL AND received_on >= CURRENT_DATE - $1::int
      ORDER BY id`,
    [LOYALTY_INBOX_RETENTION_DAYS]
  );
  if (rows.rows.length === 0) return 0;
  const { memberOf } = await loadRouting(q);
  let changed = 0;
  for (const row of rows.rows) {
    const analysis = await analyseMessage(row.raw, () => row.origin !== 'direct');
    const who = attributeMessage(analysis.tiers, memberOf);
    if (who.attribution !== 'matched') continue;
    const r = await q.query(
      `UPDATE loyalty_inbox_messages SET attribution = 'matched', member_id = $2 WHERE id = $1 AND attribution <> 'matched'`,
      [row.id, who.memberId]
    );
    if ((r.rowCount ?? 0) === 0) continue;
    changed++;
    await q.query(
      `UPDATE household_member_addresses SET last_received_on = GREATEST(COALESCE(last_received_on, $2::date), $2::date)
        WHERE address = ANY($1::text[])`,
      [who.addresses, row.receivedOn]
    );
  }
  if (changed > 0) log.info('loyalty inbox re-attributed', { count: changed });
  return changed;
}

// ─── The overview's inbox panel ────────────────────────────────────────────────────────────────

/**
 * The `inbox` object of the overview. Every count and day difference is Postgres's; every date is
 * `::text`. The raw bytes are never selected. `quietDays` is `GREATEST(0, …)` because a received date
 * is a UTC calendar date while CURRENT_DATE follows the session's zone, which can put a message on
 * tomorrow for a few hours (accepted at G1).
 */
export async function loadInboxOverview(q: Queryable = db, env: Env = process.env): Promise<LoyaltyInbox> {
  const R = LOYALTY_INBOX_RETENTION_DAYS;
  const [state, domains, coverage, forwarding, unknown, totals] = await Promise.all([
    q.query<{ on: string | null; outcome: 'ok' | 'error' | null; errorCode: LoyaltyInboxPollErrorCode | null }>(
      `SELECT last_polled_on::text AS "on", last_outcome AS outcome, last_error_code AS "errorCode" FROM loyalty_inbox_state WHERE id = 1`
    ),
    q.query<{ programId: number; domains: string[] }>(
      `SELECT program_id AS "programId", array_agg(domain ORDER BY domain COLLATE "C") AS domains
         FROM loyalty_sender_domains GROUP BY program_id ORDER BY program_id`
    ),
    q.query<{ programId: number; lastSeenOn: string | null; storedInWindow: number }>(
      `SELECT d.program_id AS "programId", max(d.last_seen_on)::text AS "lastSeenOn",
              (SELECT count(*) FROM loyalty_inbox_messages m
                WHERE m.program_id = d.program_id AND m.received_on >= CURRENT_DATE - $1::int)::int AS "storedInWindow"
         FROM loyalty_sender_domains d GROUP BY d.program_id ORDER BY d.program_id`,
      [R]
    ),
    q.query<{ memberId: number; addresses: string[]; lastReceivedOn: string | null; quietDays: number | null; state: LoyaltyInboxForwardingState }>(
      `WITH per AS (
         SELECT hm.id, hm.display_name,
                coalesce(array_agg(a.address ORDER BY a.address COLLATE "C") FILTER (WHERE a.id IS NOT NULL), '{}') AS addresses,
                count(a.id) AS n, max(a.last_received_on) AS last_received, min(a.added_on) AS first_added
           FROM household_members hm LEFT JOIN household_member_addresses a ON a.member_id = hm.id
          GROUP BY hm.id, hm.display_name),
       days AS (
         SELECT *, CASE WHEN n = 0 THEN NULL
                        ELSE GREATEST(0, CURRENT_DATE - coalesce(last_received, first_added)) END AS quiet_days
           FROM per)
       SELECT id AS "memberId", addresses, last_received::text AS "lastReceivedOn", quiet_days AS "quietDays",
              CASE WHEN n = 0 THEN 'not_set_up'
                   WHEN quiet_days > $1::int THEN 'quiet'
                   WHEN last_received IS NULL THEN 'no_mail_yet'
                   ELSE 'ok' END AS state
         FROM days ORDER BY display_name, id`,
      [LOYALTY_INBOX_SILENCE_DAYS]
    ),
    q.query<{ domain: string; count: number }>(
      `SELECT domain, count(*)::int AS count FROM loyalty_inbox_unknown_senders
        WHERE received_on >= CURRENT_DATE - $1::int
        GROUP BY domain ORDER BY count(*) DESC, domain COLLATE "C" LIMIT $2`,
      [R, LOYALTY_INBOX_UNKNOWN_LIMIT]
    ),
    q.query<{ unknownTotal: number; unattributed: number }>(
      `SELECT (SELECT count(*) FROM loyalty_inbox_unknown_senders WHERE received_on >= CURRENT_DATE - $1::int)::int AS "unknownTotal",
              (SELECT count(*) FROM loyalty_inbox_messages
                WHERE received_on >= CURRENT_DATE - $1::int AND attribution <> 'matched')::int AS unattributed`,
      [R]
    ),
  ]);
  const s = state.rows[0];
  // A state row whose outcome is null has never been polled; the CHECKs keep the date null with it.
  const lastCheck = s && s.on !== null && s.outcome !== null ? { on: s.on, outcome: s.outcome, errorCode: s.errorCode } : null;
  return {
    ...describeInboxConfig(env),
    retentionDays: LOYALTY_INBOX_RETENTION_DAYS,
    silenceDays: LOYALTY_INBOX_SILENCE_DAYS,
    lastCheck,
    senderDomains: domains.rows,
    coverage: coverage.rows,
    forwarding: forwarding.rows,
    unknownSenders: unknown.rows,
    unknownSenderTotal: totals.rows[0].unknownTotal,
    unattributed: totals.rows[0].unattributed,
  };
}
