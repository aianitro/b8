// Loyalty inbox (P8-42c1) — the mailbox: its configuration from the environment, and the one real
// adapter onto it. The only non-test importer of `imapflow`, and the only file that names the
// password variable. The poller (`lib/loyaltyInbox.ts`) sees the mailbox only through `MailSource`.
//
// ─── THE MAILBOX IS NEVER MODIFIED ────────────────────────────────────────────────────────────
//
// The adapter opens the mailbox READ-ONLY (IMAP EXAMINE), so even a bug cannot flag, move or delete
// a message, and it fetches message source with imapflow's default BODY.PEEK, which does not set the
// seen flag. The interface has exactly three operations — list the envelopes since a date, fetch one
// message's bytes, close — and no write of any kind. Progress is tracked by the dedupe keys in
// Postgres, never by mailbox state. No IDLE, no long-lived connection: one connection per poll.
//
// ─── NO CREDENTIAL AND NO LIBRARY TEXT LEAVE THIS FILE ────────────────────────────────────────
//
// The host, user and password are read from the environment at call time, never at import, and are
// handed only to the IMAP client. `describeInboxConfig` is the password-free view every other caller
// sees: whether the poller is configured, why not, and the NAMES of the unset variables. Every
// failure leaves this file as a `MailSourceError` whose message is a fixed sentence and whose code is
// one of the contract's poll error codes; the library's own error (which can quote the server, the
// host or the login) is classified by its code fields and then dropped. The client's logger is off.
//
// THE REAL ADAPTER'S LOGIN, SELECT, SEARCH AND FETCH ARE NOT EXERCISED BY ANY TEST (SPEC.md Open
// question 13): only its connection path is, against a closed loopback port. The owner's first real
// run is their check: set the seven variables, press "Check inbox now" on /travel, read "Last check".
//
// This file may use `new Date(` and `toISOString` to bridge imapflow's Date values to ISO text and
// back, and nothing else from the server path's clock ban: it does no date arithmetic.

import { ImapFlow, type FetchMessageObject } from 'imapflow';
import {
  LOYALTY_INBOX_MAX_BYTES,
  LOYALTY_INBOX_REQUIRED_ENV,
  type LoyaltyInboxConfigProblem,
  type LoyaltyInboxPollErrorCode,
  type LoyaltyInboxRequiredEnv,
} from '@b8/contracts/loyalty';

// ─── Configuration ─────────────────────────────────────────────────────────────────────────────

type Env = Readonly<Record<string, string | undefined>>;

export type InboxConfig =
  | {
      ok: true;
      host: string;
      port: number;
      /** `true`: implicit TLS. `starttls`: STARTTLS required, never downgraded to cleartext. */
      tls: 'true' | 'starttls';
      user: string;
      password: string;
      mailbox: string;
      timeoutSeconds: number;
    }
  | { ok: false; problem: LoyaltyInboxConfigProblem; missing: LoyaltyInboxRequiredEnv[] };

const DEFAULT_MAILBOX = 'INBOX';
const DEFAULT_TIMEOUT_SECONDS = 60;
const MAX_TIMEOUT_SECONDS = 600;

/** A trimmed value, or undefined when unset or whitespace only. */
const valueOf = (env: Env, name: string) => {
  const v = env[name]?.trim();
  return v === undefined || v === '' ? undefined : v;
};
/** A whole number written with digits only (no sign, no decimal point, no exponent), within bounds. */
const wholeIn = (text: string, lo: number, hi: number) => /^[0-9]+$/.test(text) && Number(text) >= lo && Number(text) <= hi;

/**
 * The poller's configuration, read from `env` at call time. All five required variables unset is
 * `unset`; some but not all is `incomplete`, with `missing` naming the unset ones in contract order.
 * Then TLS, port and timeout are checked in that order and the first failure is the problem.
 *
 * TLS is the case-sensitive literal `true` (implicit TLS) or `starttls` (STARTTLS required). Anything
 * else — `false`, `TRUE`, empty — is `invalid_tls`: a plaintext login would put the password and the
 * mail on the wire in clear, so there is no configuration that allows one (the same literal rule as
 * the outbound alert's SMTP settings).
 */
export function readInboxConfig(env: Env): InboxConfig {
  const missing = LOYALTY_INBOX_REQUIRED_ENV.filter((name) => valueOf(env, name) === undefined);
  if (missing.length === LOYALTY_INBOX_REQUIRED_ENV.length) return { ok: false, problem: 'unset', missing };
  if (missing.length > 0) return { ok: false, problem: 'incomplete', missing };
  const tls = valueOf(env, 'LOYALTY_IMAP_TLS') as string;
  if (tls !== 'true' && tls !== 'starttls') return { ok: false, problem: 'invalid_tls', missing: [] };
  const port = valueOf(env, 'LOYALTY_IMAP_PORT') as string;
  if (!wholeIn(port, 1, 65535)) return { ok: false, problem: 'invalid_port', missing: [] };
  const timeout = valueOf(env, 'LOYALTY_IMAP_TIMEOUT_SECONDS');
  if (timeout !== undefined && !wholeIn(timeout, 1, MAX_TIMEOUT_SECONDS)) return { ok: false, problem: 'invalid_timeout', missing: [] };
  return {
    ok: true,
    host: valueOf(env, 'LOYALTY_IMAP_HOST') as string,
    port: Number(port),
    tls,
    user: valueOf(env, 'LOYALTY_IMAP_USER') as string,
    password: valueOf(env, 'LOYALTY_IMAP_PASSWORD') as string,
    mailbox: valueOf(env, 'LOYALTY_IMAP_MAILBOX') ?? DEFAULT_MAILBOX,
    timeoutSeconds: timeout === undefined ? DEFAULT_TIMEOUT_SECONDS : Number(timeout),
  };
}

/** The password-free view of the configuration: the only one the overview, a route or a log sees. */
export function describeInboxConfig(env: Env): {
  configured: boolean;
  problem: LoyaltyInboxConfigProblem | null;
  missing: LoyaltyInboxRequiredEnv[];
} {
  const c = readInboxConfig(env);
  return c.ok ? { configured: true, problem: null, missing: [] } : { configured: false, problem: c.problem, missing: [...c.missing] };
}

/** How long `close()` waits for LOGOUT before it closes the socket itself. */
export const CLOSE_BOUND_MS = 3000;

// ─── The mail-source interface ─────────────────────────────────────────────────────────────────

/**
 * One listed message. `fromAddress` is the single address of the From header, or null when there is
 * none or more than one. `receivedAt` is the server's received time (INTERNALDATE) as ISO text;
 * Postgres turns it into a UTC calendar date. `size` is in bytes, or null when the server did not
 * report one: an unknown size is never read as 0, so the poller cannot treat it as "small". The cap
 * then rests on `fetch`, which never returns more than one byte over it.
 */
export interface MailEnvelope {
  id: string;
  messageId: string | null;
  fromAddress: string | null;
  receivedAt: string;
  size: number | null;
}

/** Exactly three operations, none of which can modify the mailbox. */
export interface MailSource {
  /** Every message received on or after `since` (a `YYYY-MM-DD` calendar date). */
  list(since: string): Promise<MailEnvelope[]>;
  /**
   * One message's raw RFC 822 bytes, by its listed id. The real adapter asks for at most one byte
   * over `LOYALTY_INBOX_MAX_BYTES`, so a result longer than the cap means "over the cap" and its
   * bytes are a truncated prefix the poller must not keep.
   */
  fetch(id: string): Promise<Buffer>;
  /** Ends the connection. Never rejects. */
  close(): Promise<void>;
}

/** A failure with a fixed message and a classified code. No library text, host, user or password. */
export class MailSourceError extends Error {
  constructor(readonly code: LoyaltyInboxPollErrorCode) {
    super('The loyalty mailbox could not be read.');
    this.name = 'MailSourceError';
  }
}

const CONNECT_CODES = new Set([
  'ECONNREFUSED', 'ECONNRESET', 'ENOTFOUND', 'EHOSTUNREACH', 'ENETUNREACH', 'EAI_AGAIN', 'EPIPE',
  'NoConnection', 'EConnectionClosed', 'ClosedAfterConnectText',
]);
const TIMEOUT_CODES = new Set(['CONNECT_TIMEOUT', 'GREETING_TIMEOUT', 'UPGRADE_TIMEOUT', 'ETIMEOUT', 'ETIMEDOUT']);

/**
 * A thrown value as one of the poll error codes, read from its code FIELDS only (imapflow's `code`,
 * `authenticationFailed` and `serverResponseCode`, Node's socket and TLS codes), never from its
 * message. Anything unrecognised is `source_failed`.
 */
export function classifySourceError(err: unknown): LoyaltyInboxPollErrorCode {
  if (err instanceof MailSourceError) return err.code;
  const e = (err ?? {}) as { code?: unknown; authenticationFailed?: unknown; serverResponseCode?: unknown };
  const code = typeof e.code === 'string' ? e.code : '';
  const server = typeof e.serverResponseCode === 'string' ? e.serverResponseCode.toUpperCase() : '';
  if (e.authenticationFailed === true || server === 'AUTHENTICATIONFAILED' || server === 'AUTHORIZATIONFAILED') return 'auth_failed';
  if (TIMEOUT_CODES.has(code)) return 'timeout';
  if (code.startsWith('ERR_TLS') || code.startsWith('ERR_SSL') || /CERT|TLS|SSL/.test(code)) return 'tls_failed';
  if (CONNECT_CODES.has(code)) return 'connect_failed';
  if (server === 'NONEXISTENT' || code === 'NotFound') return 'mailbox_missing';
  return 'source_failed';
}

// ─── The real adapter ──────────────────────────────────────────────────────────────────────────

/**
 * The real mailbox, connected lazily on the first `list`. Throws `MailSourceError` only. Refuses to
 * build without a valid configuration (the poller has already checked; this is the second guard).
 */
export function createMailSource(env: Env): MailSource {
  const config = readInboxConfig(env);
  if (!config.ok) throw new MailSourceError('source_failed');
  const ms = config.timeoutSeconds * 1000;
  const client = new ImapFlow({
    host: config.host,
    port: config.port,
    secure: config.tls === 'true',
    // Required, not opportunistic: with STARTTLS the client must upgrade or fail, so a stripped
    // capability list cannot downgrade the login to cleartext.
    doSTARTTLS: config.tls === 'starttls' ? true : undefined,
    auth: { user: config.user, pass: config.password },
    logger: false,
    emitLogs: false,
    disableAutoIdle: true,
    connectionTimeout: ms,
    greetingTimeout: ms,
    socketTimeout: ms,
  });
  // An 'error' event with no listener would crash the process; the failure is reported through the
  // rejected call instead, classified, so the event's payload is dropped here.
  client.on('error', () => {});
  let opened = false;

  const guard = async <T>(work: () => Promise<T>): Promise<T> => {
    try {
      return await work();
    } catch (err) {
      throw new MailSourceError(classifySourceError(err));
    }
  };

  return {
    list: (since) =>
      guard(async () => {
        await client.connect();
        try {
          await client.mailboxOpen(config.mailbox, { readOnly: true });
        } catch (err) {
          const code = classifySourceError(err);
          throw new MailSourceError(code === 'source_failed' ? 'mailbox_missing' : code);
        }
        opened = true;
        // IMAP SINCE is day-granular; the poller drops anything older than its window itself.
        const uids = await client.search({ since: new Date(`${since}T00:00:00Z`) }, { uid: true });
        if (!uids || uids.length === 0) return [];
        const found: FetchMessageObject[] = await client.fetchAll(uids, { uid: true, envelope: true, internalDate: true, size: true }, { uid: true });
        return found.map((m) => {
          const from = m.envelope?.from ?? [];
          return {
            id: String(m.uid),
            messageId: m.envelope?.messageId ?? null,
            fromAddress: from.length === 1 && from[0].address ? from[0].address : null,
            receivedAt: new Date(m.internalDate ?? 0).toISOString(),
            size: typeof m.size === 'number' ? m.size : null,
          };
        });
      }),
    fetch: (id) =>
      guard(async () => {
        if (!opened) throw new MailSourceError('source_failed');
        // A bounded partial fetch (still BODY.PEEK, so the seen flag is untouched): the download can
        // never exceed the cap by more than one byte, whatever size the server reported or omitted.
        const m = await client.fetchOne(id, { uid: true, source: { maxLength: LOYALTY_INBOX_MAX_BYTES + 1 } }, { uid: true });
        if (!m || !m.source) throw new MailSourceError('source_failed');
        return m.source;
      }),
    // Bounded: a polite LOGOUT gets a few seconds, then the socket is closed regardless. A server
    // that never completes LOGOUT (or drips bytes so the socket timeout never fires) cannot keep
    // the poll, and so the advisory lock and the digest behind it, waiting.
    close: async () => {
      let timer: ReturnType<typeof setTimeout> | undefined;
      const bound = new Promise<void>((resolve) => { timer = setTimeout(resolve, CLOSE_BOUND_MS); });
      try {
        await Promise.race([client.logout(), bound]);
      } catch {
        /* forced below */
      } finally {
        clearTimeout(timer);
        try { client.close(); } catch { /* already closed */ }
      }
    },
  };
}
