// Loyalty (P8-42a) — household members, the program catalog with its aliases, memberships with a
// derived current balance, append-only balance observations, instruments, and (P8-42c1) the loyalty
// inbox, and (P8-42c2) reading it, and (P8-42d) reading a screenshot. The sixteen endpoints, stated once:
//
//   GET   /api/v1/loyalty                                 —                                → LoyaltyOverviewResponseSchema
//   POST  /api/v1/loyalty/members                         LoyaltyMemberCreateRequestSchema → LoyaltyMemberResponseSchema (201)
//   PATCH /api/v1/loyalty/members/[id]                    LoyaltyMemberPatchRequestSchema  → LoyaltyMemberResponseSchema
//   POST  /api/v1/loyalty/programs                        LoyaltyProgramCreateRequestSchema → LoyaltyProgramResponseSchema (201)
//   PATCH /api/v1/loyalty/programs/[id]                   LoyaltyProgramPatchRequestSchema → LoyaltyProgramResponseSchema
//   POST  /api/v1/loyalty/memberships                     LoyaltyMembershipCreateRequestSchema → LoyaltyMembershipResponseSchema (201)
//   PATCH /api/v1/loyalty/memberships/[id]                LoyaltyMembershipPatchRequestSchema → LoyaltyMembershipResponseSchema
//   GET   /api/v1/loyalty/memberships/[id]/member-number  —                                → LoyaltyMemberNumberResponseSchema
//   POST  /api/v1/loyalty/memberships/[id]/observations   LoyaltyObservationCreateRequestSchema → LoyaltyMembershipResponseSchema (201)
//   POST  /api/v1/loyalty/instruments                     LoyaltyInstrumentCreateRequestSchema → LoyaltyInstrumentResponseSchema (201)
//   PATCH /api/v1/loyalty/instruments/[id]                LoyaltyInstrumentPatchRequestSchema → LoyaltyInstrumentResponseSchema
//   POST  /api/v1/loyalty/inbox/poll                      — (no body)                      → LoyaltyInboxPollResponseSchema (200 for every outcome)
//   POST  /api/v1/loyalty/inbox/read                      LoyaltyInboxReadRequestSchema (body optional) → LoyaltyInboxReadResponseSchema (200 for every outcome)
//   POST  /api/v1/loyalty/inbox/readings/[id]             LoyaltyInboxResolveRequestSchema → LoyaltyInboxResolveResponseSchema
//   POST  /api/v1/loyalty/memberships/[id]/screenshot     image bytes (JPEG, PNG or WebP)  → LoyaltyScreenshotReadResponseSchema (200 for every outcome)
//   POST  /api/v1/loyalty/memberships/[id]/screenshot/confirm LoyaltyScreenshotConfirmRequestSchema → LoyaltyMembershipResponseSchema (201)
//
// There is no route that updates or deletes an observation, and none that deletes a member, a
// program, a membership or an instrument. An edited balance is a POST of a new observation.
//
// WHO RECEIVES THESE SHAPES: both b8 users, as peers, with no per-user filtering. A read-scope bearer
// token may call the GETs; every write refuses it (`INSUFFICIENT_SCOPE`, 403) at the handler itself.
// A household member is never a caller.
//
// THE MEMBER NUMBER HAS TWO SCHEMAS, AND ONLY ONE ROUTE MAY USE THE FULL ONE. Every response here
// carries `memberNumberMasked` (`LoyaltyMaskedMemberNumberSchema`), which by construction cannot hold
// more than four characters of the number. The full value exists in exactly one response schema,
// `LoyaltyMemberNumberSchema`, returned by the member-number route to a `browser` session only; a
// bearer token of any scope gets 403 there. Requests may carry a full number (it is how one is set),
// and an error answering such a request must never echo it.
//
// BALANCES ARE DECIMAL TEXT END TO END, never a JSON number, never through a JS number. A whole-number
// unit (`points`, `miles`, `nights`) is digits with no decimal point; `usd` always has exactly two
// decimals in a response. The database stores the same single spelling (a per-unit scale CHECK), so
// a handler emits `balance::text` unchanged. Nothing rounds: excess precision is refused.
//
// DATES are `YYYY-MM-DD` calendar text produced by Postgres (`::text` or `to_char`), never a JS Date,
// so no time zone can move one by a day. TIMESTAMPS are not emitted at all.
//
// STRICT OBJECTS throughout, the gifts precedent: a stray key (`source: 'import'`, `cardAccountId` on
// a create) is exactly the key that must be refused, never carried through.
//
// Layering as gifts.ts: `zod` and sibling modules only. No `next/*`, no `pg`, no `lib/**`.

import { z } from 'zod';
import { apiResponseSchema } from './envelope';
import { UserIdSchema } from './auth';
// A calendar date validated by integer arithmetic, never by the JS date machinery. Reused rather
// than restated: two date validators in one package is the "two definitions of one concept" defect.
import { giftDate as calendarDate } from './gifts';

// ─── Vocabularies ───────────────────────────────────────────────────────────────────────────────
//
// Each list equals the matching CHECK in migrations/1792700000000_loyalty.sql exactly. Adding a
// value is an additive change (BUILD.md §9.2): a consumer keeps a default branch.

/** Every balance unit. `usd` is money (scale 2); the other three are whole numbers. */
export const LOYALTY_UNITS = ['points', 'miles', 'nights', 'usd'] as const;
/** The units whose balances are whole numbers: digits only, no decimal point at all. */
export const LOYALTY_WHOLE_UNITS = ['points', 'miles', 'nights'] as const;
export const LOYALTY_PROGRAM_KINDS = [
  'airline',
  'hotel',
  'card_currency',
  'travel_cash',
  'car',
  'other',
] as const;
export const LOYALTY_INSTRUMENT_KINDS = [
  'free_night',
  'companion_fare',
  'travel_credit',
  'other',
] as const;
/**
 * Where an observation came from. Only `typed` may ever arrive in a request body; `import` is
 * written by the import script, `email` (42c) and `screenshot` (42d) are reserved.
 */
export const LOYALTY_OBSERVATION_SOURCES = ['typed', 'import', 'email', 'screenshot'] as const;
/** Where an instrument came from. Requests never carry it: a route always writes `typed`. */
export const LOYALTY_INSTRUMENT_SOURCES = ['typed', 'import'] as const;
/**
 * The derived state of a linked card's annual benefit (P8-42b). NEVER STORED: computed on every read
 * from the ledger (the most recent unrefunded annual-fee row, read through the gift read path), the
 * membership's instruments and Postgres's CURRENT_DATE. No CHECK mirrors this list, because no
 * column holds it.
 *
 *   no_fee_seen — no posted annual fee on the card (none, or the most recent one was refunded).
 *   awaiting    — fee posted, CURRENT_DATE is on or before expectedBy, nothing received yet.
 *   received    — an instrument of the benefit's kind on this membership, issued (or, when its
 *                 issue date is unknown, recorded) on or after the fee date. Wins over overdue.
 *   overdue     — fee posted, CURRENT_DATE is after expectedBy, nothing received.
 */
export const LOYALTY_FEE_WATCH_STATES = ['no_fee_seen', 'awaiting', 'received', 'overdue'] as const;
/**
 * The benefit window in days. Bounds equal `loyalty_memberships_benefit_window_range` in
 * migrations/1792800000000_loyalty_card_benefit.sql. The default is what the membership PATCH route
 * stores when a benefit arrives without `windowDays`; the column has no DEFAULT (a default would fill
 * rows that describe no benefit), so this constant is the one place the number lives.
 */
export const LOYALTY_BENEFIT_WINDOW_MIN_DAYS = 1;
export const LOYALTY_BENEFIT_WINDOW_MAX_DAYS = 365;
export const LOYALTY_BENEFIT_DEFAULT_WINDOW_DAYS = 45;

/**
 * THE EARN DESCRIPTION (P8-42b2). How a rule matches spend. Equals `loyalty_earn_rules_match_kind_check`
 * in migrations/1792900000000_loyalty_earn_rules.sql.
 *
 *   category — the row's mapped category equals the rule's text after both are trimmed and
 *              case-folded. Exact equality: never a prefix, a substring or a pattern.
 *   merchant — the rule's text, case-folded and whitespace-collapsed, appears as a whole-word literal
 *              phrase in the row's name or its merchant name.
 */
export const LOYALTY_EARN_MATCH_KINDS = ['category', 'merchant'] as const;
/**
 * Where the estimate's period starts. NEVER STORED. `reading`: the day after the current reading's
 * as-of date. `last_30_days`: there is no reading, so the period is the last
 * `LOYALTY_EARN_FALLBACK_DAYS` days, and the page says so.
 */
export const LOYALTY_EARN_BASES = ['reading', 'last_30_days'] as const;
/**
 * The units an estimate or a comparison can be in. `nights` is deliberately absent: a program
 * counted in nights has no per-currency earn, so its estimate and comparison are null, never zero.
 */
export const LOYALTY_EARN_UNITS = ['points', 'miles', 'usd'] as const;
/** At most this many bonus rules per membership (the base rate is not a rule). */
export const LOYALTY_EARN_MAX_RULES = 20;
/**
 * The largest rate, inclusive. Equals the upper bound of `loyalty_memberships_earn_base_rate_range`
 * and `loyalty_earn_rules_rate_range`. The input pattern allows at most three integer digits, so
 * raising this past three digits means widening that pattern and the column's precision together.
 */
export const LOYALTY_EARN_MAX_RATE = 100;
/** With no reading, the estimate covers this many days ending on Postgres's CURRENT_DATE. */
export const LOYALTY_EARN_FALLBACK_DAYS = 30;
/**
 * The "worth a look" threshold, in percent of the estimate. A constant on purpose: not stored, not
 * configurable per membership. Strictly greater than is a miss; exactly the threshold is not.
 */
export const LOYALTY_EARN_MISS_PERCENT = 25;
/** A category rule's text, in characters once trimmed. Equals the table's bound on `match_text`. */
export const LOYALTY_EARN_CATEGORY_MATCH_MAX_CHARS = 100;
/** A merchant rule's text, in characters once trimmed. Tighter than the table's shared bound. */
export const LOYALTY_EARN_MERCHANT_MATCH_MAX_CHARS = 60;

/**
 * THE LOYALTY INBOX (P8-42c1). Forwarded loyalty mail is collected from a dedicated mailbox polled
 * read-only; only allowlisted senders are kept (raw bytes plus four header-derived facts), each kept
 * message is attributed to a household member, and the mail is deleted after the retention window.
 * Tables in migrations/1793000000000_loyalty_inbox.sql. Nothing here carries a message body, a
 * subject, a sender's address, a Message-ID, the mailbox host, user or password.
 *
 * Raw mail and unknown-sender rows are kept this many days by received date: a row whose received
 * date is strictly before CURRENT_DATE minus this is purged (exactly this many days old is kept).
 * The fetch window uses the same boundary, so a message is never fetched after it was purged.
 */
export const LOYALTY_INBOX_RETENTION_DAYS = 30;
/**
 * A member is `quiet` when strictly more than this many days have passed since their reference date
 * (newest mail received through their addresses, else the earliest address's added date). Exactly
 * this many is not quiet. One constant, the one 42c2 replaces with the longest statement cycle.
 */
export const LOYALTY_INBOX_SILENCE_DAYS = 45;
/** A message larger than this many bytes is recorded without its bytes (`oversize`), never fetched. */
export const LOYALTY_INBOX_MAX_BYTES = 5242880;
/** At most this many sender domains per program (one PATCH list). */
export const LOYALTY_INBOX_MAX_DOMAINS = 20;
/** At most this many forwarding addresses per member (one PATCH list). */
export const LOYALTY_INBOX_MAX_ADDRESSES = 10;
/** At most this many entries in the overview's unknown-sender list (the total counts every row). */
export const LOYALTY_INBOX_UNKNOWN_LIMIT = 20;
/** The exact domain text under which a sender that cannot be read as a hostname is counted. */
export const LOYALTY_INBOX_UNREADABLE = '(unreadable)';

/**
 * Where a kept message's original sender was read. Equals `loyalty_inbox_messages_origin_check`.
 *   direct     — the outer From header.
 *   attachment — the From of the first message/rfc822 part; honoured only when the outer From is a
 *                registered member address.
 *   inline     — the From: line after a forward marker in the text body; likewise member-only.
 */
export const LOYALTY_INBOX_ORIGINS = ['direct', 'attachment', 'inline'] as const;
/**
 * Who a kept message was for. Equals `loyalty_inbox_messages_attribution_check`. Only `matched`
 * names a member; the other three are "unattributed" and are never guessed.
 */
export const LOYALTY_INBOX_ATTRIBUTIONS = ['matched', 'unmatched', 'none_found', 'ambiguous'] as const;
/**
 * The classified codes of a failed poll. Equals `loyalty_inbox_state_last_error_code_check`. NOT
 * `LoyaltyErrorCode`: a failed poll is HTTP 200 with outcome `error`, never an error envelope. No
 * library error text ever accompanies a code.
 */
export const LOYALTY_INBOX_POLL_ERROR_CODES = [
  'connect_failed',
  'tls_failed',
  'auth_failed',
  'timeout',
  'mailbox_missing',
  'source_failed',
] as const;
/**
 * What a poll did. `disabled` (the environment is unset or invalid) and `already_running` (another
 * poll holds the lock) ran nothing and changed nothing; `ok` and `error` ran and recorded the state.
 */
export const LOYALTY_INBOX_POLL_OUTCOMES = ['ok', 'disabled', 'already_running', 'error'] as const;
/**
 * Why the poller is not configured. `unset`: none of the five required variables is set.
 * `incomplete`: some but not all. Then TLS, port and timeout are validated in that order and the
 * first failure is the problem.
 */
export const LOYALTY_INBOX_CONFIG_PROBLEMS = [
  'unset',
  'incomplete',
  'invalid_tls',
  'invalid_port',
  'invalid_timeout',
] as const;
/**
 * The five required environment variable NAMES, in the order `missing` lists them. Names only: no
 * schema here can carry a value. (`LOYALTY_IMAP_MAILBOX` and `LOYALTY_IMAP_TIMEOUT_SECONDS` are
 * optional and are never missing.)
 */
export const LOYALTY_INBOX_REQUIRED_ENV = [
  'LOYALTY_IMAP_HOST',
  'LOYALTY_IMAP_PORT',
  'LOYALTY_IMAP_TLS',
  'LOYALTY_IMAP_USER',
  'LOYALTY_IMAP_PASSWORD',
] as const;
/**
 * A member's forwarding health. NEVER STORED: derived on every read from the member's addresses and
 * CURRENT_DATE.
 *   not_set_up  — no address; quietDays null.
 *   no_mail_yet — an address, no attributed mail yet, quietDays at most LOYALTY_INBOX_SILENCE_DAYS.
 *   ok          — attributed mail received, quietDays at most LOYALTY_INBOX_SILENCE_DAYS.
 *   quiet       — quietDays strictly greater than LOYALTY_INBOX_SILENCE_DAYS, mail or not.
 */
export const LOYALTY_INBOX_FORWARDING_STATES = ['not_set_up', 'no_mail_yet', 'ok', 'quiet'] as const;

/**
 * Shared mail providers: a sender domain equal to one of these, or a subdomain of one, is refused on
 * input, because allowlisting it would trust every stranger with a free mailbox. Data, and a stated
 * limit: a provider not on the list is not caught (the editor is owner-only).
 */
export const LOYALTY_INBOX_SHARED_MAIL_PROVIDERS = [
  'gmail.com',
  'googlemail.com',
  'outlook.com',
  'hotmail.com',
  'live.com',
  'yahoo.com',
  'icloud.com',
  'me.com',
  'aol.com',
  'proton.me',
  'protonmail.com',
  'gmx.com',
  'mail.com',
] as const;
/**
 * Shared multi-label public suffixes: a sender domain EQUAL to one of these is refused on input (a
 * subdomain such as a company's own domain under it is allowed). No public-suffix list is consulted;
 * this short list is data and a stated limit: a suffix not on it is not caught.
 */
export const LOYALTY_INBOX_SHARED_SUFFIXES = [
  'co.uk',
  'org.uk',
  'com.au',
  'co.nz',
  'co.jp',
  'com.br',
  'co.za',
] as const;

/**
 * READING THE INBOX (P8-42c2). Each stored message is read once by Claude as a PROPOSAL; a
 * deterministic clean pass and a fixed rule order decide whether it becomes a balance (an appended
 * `email` observation), is queued for one tap on /travel, or is settled without one. Tables in
 * migrations/1793100000000_loyalty_inbox_read.sql. Nothing here carries a subject, a body, the text
 * sent to the model, the model's output, a key, a full member number or an address.
 *
 * The constants, in the order SPEC.md lists them (T42c2-U1 asserts that order):
 *   MAX_ATTEMPTS       — attempts per message, each counted before the model call.
 *   MAX_PER_RUN        — messages read per run; the rest stay unread for the next run.
 *   RETENTION_DAYS     — reads rows received strictly before CURRENT_DATE minus this are purged
 *                        (exactly this many days old is kept). Longer than the raw mail's on purpose.
 *   JUMP_PERCENT       — a reading whose absolute change times 100 is STRICTLY greater than this
 *                        times the stored balance is queued; exactly this percentage applies.
 *   SUFFIX_MIN/MAX     — a kept suffix is 3 to 4 letters or digits; fewer means "no suffix".
 *   QUEUE_LIMIT        — items listed in `needsAttention`; the total is reported separately.
 *   MAX_CHARS          — characters of message text sent to the model.
 *   TIMEOUT_SECONDS    — per-call timeout (the optional env var of the same name overrides it with
 *                        a whole number from 1 to 600; anything else means this default).
 *   RUN_BUDGET_SECONDS — a run that has used this long starts no new message.
 *   STOP_AFTER         — consecutive timeout or api_error results that stop a run.
 *   EXPIRY_MAX         — expiry warnings kept per message.
 *   INSTRUMENT_MAX     — instruments kept per message.
 */
export const LOYALTY_READ_MAX_ATTEMPTS = 3;
export const LOYALTY_READ_MAX_PER_RUN = 25;
export const LOYALTY_READ_RETENTION_DAYS = 400;
export const LOYALTY_READ_JUMP_PERCENT = 50;
export const LOYALTY_READ_SUFFIX_MIN = 3;
export const LOYALTY_READ_SUFFIX_MAX = 4;
export const LOYALTY_READ_QUEUE_LIMIT = 50;
export const LOYALTY_READ_MAX_CHARS = 20000;
export const LOYALTY_READ_TIMEOUT_SECONDS = 60;
export const LOYALTY_READ_RUN_BUDGET_SECONDS = 300;
export const LOYALTY_READ_STOP_AFTER = 3;
export const LOYALTY_READ_EXPIRY_MAX = 5;
export const LOYALTY_READ_INSTRUMENT_MAX = 10;

/**
 * The state of one attempted message. Equals `loyalty_inbox_reads_state_check`.
 *   retry, failed   — not read yet (a classified failure; `failed` is terminal until retryFailed).
 *   pending         — queued for a person, with a reason.
 *   applied         — every rule held; one `email` observation appended.
 *   applied_by_hand — a person applied the queued item; one `email` observation appended.
 *   stale           — the as-of was not strictly newer than the current reading's; nothing appended.
 *   no_balance      — the reading had no usable balance; nothing appended, never queued.
 *   not_mine_known  — an unmatched suffix already on the not-mine list; discarded, never queued.
 *   not_mine, ignored — a person resolved the queued item without applying it.
 */
export const LOYALTY_READ_STATES = [
  'retry',
  'failed',
  'pending',
  'applied',
  'applied_by_hand',
  'stale',
  'no_balance',
  'not_mine_known',
  'not_mine',
  'ignored',
] as const;
/** Why a reading was queued: the first rule of the decision order that fired. Equals `loyalty_inbox_reads_reason_check`. */
export const LOYALTY_READ_REASONS = [
  'no_suffix',
  'unmatched_suffix',
  'ambiguous_suffix',
  'program_mismatch',
  'unit_mismatch',
  'no_as_of',
  'as_of_future',
  'no_baseline',
  'implausible_jump',
] as const;
/**
 * Per-message failure codes. Equals `loyalty_inbox_reads_last_error_code_check`. `refused` and
 * `empty_message` are terminal at once; the other four retry until the third attempt. A thrown
 * reader is `api_error`; a call cut off by its bound is `timeout`.
 */
export const LOYALTY_READ_ERROR_CODES = [
  'rate_limited',
  'timeout',
  'api_error',
  'refused',
  'bad_output',
  'empty_message',
] as const;
/**
 * Per-run failure codes. Equals `loyalty_inbox_read_state_last_error_code_check`. NOT
 * `LoyaltyErrorCode`: a failed run is HTTP 200 with outcome `error`, never an error envelope.
 */
export const LOYALTY_READ_RUN_ERROR_CODES = ['rate_limited', 'timeout', 'api_error', 'store_failed'] as const;
/**
 * What a read run did. `disabled` (no key) and `already_running` (another run holds the read lock)
 * read nothing, counted nothing and wrote nothing, the state row included.
 */
export const LOYALTY_READ_OUTCOMES = ['ok', 'disabled', 'already_running', 'error'] as const;
/** The three one-tap actions on a queued item. */
export const LOYALTY_READ_ACTIONS = ['apply', 'not_mine', 'ignore'] as const;
/** What an expiry warning is about: a unit (its amount is in that unit's scale), status, or something else (never an amount). */
export const LOYALTY_READ_EXPIRY_KINDS = ['points', 'miles', 'nights', 'usd', 'status', 'other'] as const;
/**
 * The model's stated program name compared with the message's program (from its allowlisted sender
 * domain) and that program's aliases. The name itself is never stored or emitted.
 */
export const LOYALTY_READ_PROGRAM_CHECKS = ['match', 'mismatch', 'not_stated'] as const;
/**
 * Whether a program's newest successfully read statement carried a balance. NEVER STORED. `not_read`
 * is "nothing read yet" and is never rendered as `no`.
 */
export const LOYALTY_READ_COVERAGE = ['yes', 'no', 'not_read'] as const;

export const LoyaltyUnitSchema = z.enum(LOYALTY_UNITS);
export const LoyaltyProgramKindSchema = z.enum(LOYALTY_PROGRAM_KINDS);
export const LoyaltyInstrumentKindSchema = z.enum(LOYALTY_INSTRUMENT_KINDS);
export const LoyaltyObservationSourceSchema = z.enum(LOYALTY_OBSERVATION_SOURCES);
export const LoyaltyInstrumentSourceSchema = z.enum(LOYALTY_INSTRUMENT_SOURCES);
export const LoyaltyFeeWatchStateSchema = z.enum(LOYALTY_FEE_WATCH_STATES);
export const LoyaltyEarnMatchKindSchema = z.enum(LOYALTY_EARN_MATCH_KINDS);
export const LoyaltyEarnBasisSchema = z.enum(LOYALTY_EARN_BASES);
export const LoyaltyEarnUnitSchema = z.enum(LOYALTY_EARN_UNITS);
export const LoyaltyInboxOriginSchema = z.enum(LOYALTY_INBOX_ORIGINS);
export const LoyaltyInboxAttributionSchema = z.enum(LOYALTY_INBOX_ATTRIBUTIONS);
export const LoyaltyInboxPollErrorCodeSchema = z.enum(LOYALTY_INBOX_POLL_ERROR_CODES);
export const LoyaltyInboxPollOutcomeSchema = z.enum(LOYALTY_INBOX_POLL_OUTCOMES);
export const LoyaltyInboxConfigProblemSchema = z.enum(LOYALTY_INBOX_CONFIG_PROBLEMS);
export const LoyaltyInboxRequiredEnvSchema = z.enum(LOYALTY_INBOX_REQUIRED_ENV);
export const LoyaltyInboxForwardingStateSchema = z.enum(LOYALTY_INBOX_FORWARDING_STATES);
export const LoyaltyReadStateSchema = z.enum(LOYALTY_READ_STATES);
export const LoyaltyReadReasonSchema = z.enum(LOYALTY_READ_REASONS);
export const LoyaltyReadErrorCodeSchema = z.enum(LOYALTY_READ_ERROR_CODES);
export const LoyaltyReadRunErrorCodeSchema = z.enum(LOYALTY_READ_RUN_ERROR_CODES);
export const LoyaltyReadOutcomeSchema = z.enum(LOYALTY_READ_OUTCOMES);
export const LoyaltyReadActionSchema = z.enum(LOYALTY_READ_ACTIONS);
export const LoyaltyReadExpiryKindSchema = z.enum(LOYALTY_READ_EXPIRY_KINDS);
export const LoyaltyReadProgramCheckSchema = z.enum(LOYALTY_READ_PROGRAM_CHECKS);
export const LoyaltyReadCoverageSchema = z.enum(LOYALTY_READ_COVERAGE);

/**
 * The codes these endpoints define. A SUBSET, NOT A CLOSURE: the boundary's `UNAUTHENTICATED` (401)
 * and the shared `DB_ERROR` can also arrive.
 *
 *   `INVALID_INPUT`            400 — a body or id failed these schemas; a balance not valid for its
 *                                    unit; an as-of more than one day after Postgres's CURRENT_DATE;
 *                                    an instrument whose expiry or use is before its issue (also as
 *                                    stored after a PATCH); an alias that normalises to empty; an
 *                                    unknown member or program named in a membership create. The
 *                                    message never echoes a submitted member number or balance.
 *   `NOT_FOUND`                404 — no such member, program, membership or instrument for the id in
 *                                    the path. One body shape for every route.
 *   `INSUFFICIENT_SCOPE`       403 — a read-scope session attempted a write. Nothing changed.
 *   `BROWSER_SESSION_REQUIRED` 403 — the member-number route was called by anything but a cookie
 *                                    session of kind `browser` (any bearer token, whatever its
 *                                    scope). The body carries no number.
 *   `MEMBERSHIP_EXISTS`        409 — that member already holds that program (one row per pair,
 *                                    decided by the unique constraint, so a lost race is this and
 *                                    never a 500).
 *   `ALIAS_TAKEN`              409 — a program create whose normalised name, or a program PATCH whose
 *                                    alias list, contains an alias another program already holds.
 *                                    Nothing changed: the alias list is replaced atomically or not
 *                                    at all.
 *   `MEMBER_NAME_TAKEN`        409 — another member already has that display name, ignoring case.
 *   `MEMBER_USER_TAKEN`        409 — another member is already linked to that user.
 *   `CARD_ALREADY_LINKED`      409 — a membership PATCH linking a card another membership already
 *                                    holds (one card, one membership; decided by the unique index,
 *                                    so a lost race is this and never a 500). Nothing changed.
 *   `DOMAIN_TAKEN`             409 — a program PATCH whose `senderDomains` list contains a domain
 *                                    another program already holds (unique across programs, decided
 *                                    by the constraint, so a lost race is this and never a 500). The
 *                                    old list is unchanged. The message never echoes the domain.
 *   `ADDRESS_TAKEN`            409 — a member PATCH whose `forwardingAddresses` list contains an
 *                                    address another member already holds. Nothing changed. The
 *                                    message never echoes the address.
 *   `ITEM_RESOLVED`            409 — a queue action on a reads row that is not `pending` (already
 *                                    resolved, or never a queue item). Two simultaneous applies on
 *                                    one item: one 200, one of these, exactly one observation.
 *
 * Linking an account that does not exist, or whose type is not `credit`, is `INVALID_INPUT` (400)
 * with nothing changed. The message never echoes a submitted benefit description.
 */
export const LoyaltyErrorCodeSchema = z.enum([
  'INVALID_INPUT',
  'NOT_FOUND',
  'INSUFFICIENT_SCOPE',
  'BROWSER_SESSION_REQUIRED',
  'MEMBERSHIP_EXISTS',
  'ALIAS_TAKEN',
  'MEMBER_NAME_TAKEN',
  'MEMBER_USER_TAKEN',
  'CARD_ALREADY_LINKED',
  'DOMAIN_TAKEN',
  'ADDRESS_TAKEN',
  'ITEM_RESOLVED',
]);

// ─── Primitives ─────────────────────────────────────────────────────────────────────────────────

/** Any loyalty table's id (SERIAL), as it reaches a consumer. */
export const LoyaltyIdSchema = z.int().positive();

/**
 * An `[id]` path segment: a positive integer in decimal with no sign, no leading zero and no
 * surrounding space, within int4. Anything else is 400 `INVALID_INPUT`; a well-formed id with no row
 * is 404 `NOT_FOUND`.
 */
export const LoyaltyIdParamSchema = z
  .string()
  .regex(/^[1-9]\d{0,9}$/, 'expected a positive integer id')
  .refine((s) => s.length < 10 || s <= '2147483647', 'id out of range');

/** Counted in characters (code points), as the columns' `char_length` CHECKs count. */
const chars = (s: string) => Array.from(s).length;

/**
 * A human-typed name AS SUBMITTED: not blank, at most `max` characters once trimmed. The handler
 * stores the trimmed form (the columns refuse an untrimmed value). The schema refuses; it does not
 * reshape.
 */
const typedName = (max: number, what: string) =>
  z
    .string()
    .refine((s) => s.trim().length >= 1, `${what} may not be blank`)
    .refine((s) => chars(s.trim()) <= max, `${what} is at most ${max} characters`);

/**
 * A balance AS SUBMITTED. A string, never a JSON number: a number has already been through binary
 * floating point before the handler sees it. Whether it is valid depends on its unit, so the unit
 * rules are applied by the request schema that carries both (see `isBalanceForUnit`).
 */
export const LoyaltyBalanceInputSchema = z.string();

/**
 * The API balance rule for one unit (SPEC.md Conventions, "Units belong to the balance").
 *
 *   whole units — 1 to 12 digits; no sign, no fraction, no thousands separator, no decimal point at
 *                 all (a trailing `.0` is refused too).
 *   usd         — 1 to 12 integer digits, then optionally a decimal point and 1 or 2 digits. A third
 *                 fractional digit is refused, never rounded.
 *
 * No surrounding space, exponent, hex or leading `.`. Thousands separators are an import-only
 * allowance and never reach this rule. Canonicalising (`usd` to exactly two decimals) is the
 * handler's, through the shared parser, before the INSERT.
 */
export function isBalanceForUnit(unit: z.infer<typeof LoyaltyUnitSchema>, text: string): boolean {
  return unit === 'usd' ? /^\d{1,12}(?:\.\d{1,2})?$/.test(text) : /^\d{1,12}$/.test(text);
}

/** A whole-unit balance as emitted: canonical digits, no leading zero, no decimal point. */
export const LoyaltyWholeBalanceSchema = z.string().regex(/^(?:0|[1-9]\d{0,11})$/, 'expected a whole-number balance');
/** A `usd` balance as emitted: canonical, always exactly two decimals. */
export const LoyaltyUsdBalanceSchema = z
  .string()
  .regex(/^(?:0|[1-9]\d{0,11})\.\d{2}$/, 'expected a cash balance with exactly two decimals');

/**
 * THE MASKED MEMBER NUMBER — the only form any response but the member-number route carries.
 *
 * Exactly four bullets (U+2022) followed by the last 4 characters of the stored number when it has 8
 * or more, the last 3 when it has 6 or 7, and nothing when it has 5 or fewer. So at most four
 * characters of the number can ever fit here, and a full number cannot parse against it. A null or
 * empty stored number is emitted as `null`, never as bare bullets.
 */
export const LOYALTY_MASK_BULLETS = '••••';
export const LoyaltyMaskedMemberNumberSchema = z
  .string()
  .refine(
    (s) => s.startsWith(LOYALTY_MASK_BULLETS) && [0, 3, 4].includes(chars(s) - 4),
    'expected a masked member number'
  );

/**
 * A member number AS SUBMITTED to set or change it: at most 64 characters once trimmed. Blank (after
 * trimming) and `null` both mean "no number" and are stored as NULL, never as ''. Error messages
 * never echo the value.
 */
export const LoyaltyMemberNumberInputSchema = z
  .string()
  .refine((s) => chars(s.trim()) <= 64, 'a member number is at most 64 characters');

/**
 * An alias AS SUBMITTED. The handler normalises it by the one label-normalisation function and
 * refuses one that normalises to empty (400). At most 200 characters as submitted.
 */
export const LoyaltyAliasInputSchema = z
  .string()
  .refine((s) => chars(s) <= 200, 'an alias is at most 200 characters');

/**
 * A benefit window in days: an integer from 1 to 365. A JSON integer only — `1.5`, `'30'` and `-1`
 * are refused, never coerced or rounded.
 */
export const LoyaltyBenefitWindowDaysSchema = z
  .int()
  .min(LOYALTY_BENEFIT_WINDOW_MIN_DAYS)
  .max(LOYALTY_BENEFIT_WINDOW_MAX_DAYS);

/**
 * A card's annual benefit AS SUBMITTED on the membership PATCH. `kind` is one of the four instrument
 * kinds (the state matches an instrument of exactly this kind). `description` is not blank and at
 * most 200 characters once trimmed; the handler stores it trimmed. `windowDays` absent means the
 * handler stores `LOYALTY_BENEFIT_DEFAULT_WINDOW_DAYS`. Strict: a stray key is refused.
 */
export const LoyaltyBenefitInputSchema = z.strictObject({
  kind: LoyaltyInstrumentKindSchema,
  description: typedName(200, 'a benefit description'),
  windowDays: LoyaltyBenefitWindowDaysSchema.optional(),
});

/**
 * The rate rule (SPEC.md Conventions, "Rate text"): one to three integer digits, optionally a
 * decimal point and one to four digits, and at most `LOYALTY_EARN_MAX_RATE`. A fifth fractional
 * digit is refused, never rounded. No sign, exponent, separator, surrounding space or leading `.`.
 * Zero is valid ("earns nothing"). Decided on the text alone: the integer part has at most three
 * digits, so converting it is exact, and the fraction is only ever tested for being all zeros.
 */
export function isEarnRateText(text: string): boolean {
  const m = /^(\d{1,3})(?:\.(\d{1,4}))?$/.exec(text);
  if (!m) return false;
  const whole = Number(m[1]);
  return whole < LOYALTY_EARN_MAX_RATE || (whole === LOYALTY_EARN_MAX_RATE && /^0*$/.test(m[2] ?? ''));
}

/**
 * A rate AS SUBMITTED: decimal text, never a JSON number (a number has already been through binary
 * floating point before the handler sees it). Stored as NUMERIC(7,4).
 */
export const LoyaltyEarnRateInputSchema = z
  .string()
  .refine(isEarnRateText, `a rate is decimal text from 0 to ${LOYALTY_EARN_MAX_RATE} with at most four decimals`);

/**
 * A merchant rule's text, tested once trimmed: starts with a letter or digit and holds only letters,
 * digits, spaces, `&`, `'` and `-`. So no character in it can be read as a pattern character by any
 * matcher (`%`, `_`, `.`, `*`, brackets, backslash and slash are all refused). Built with the
 * constructor so the Unicode property escapes do not depend on the compile target.
 */
const MERCHANT_MATCH_TEXT = new RegExp("^[\\p{L}\\p{Nd}][\\p{L}\\p{Nd} &'-]*$", 'u');

const merchantMatch = z
  .string()
  .refine((s) => MERCHANT_MATCH_TEXT.test(s.trim()), 'a merchant rule is letters, digits, spaces, &, \' and -, starting with a letter or digit')
  .refine(
    (s) => chars(s.trim()) <= LOYALTY_EARN_MERCHANT_MATCH_MAX_CHARS,
    `a merchant rule is at most ${LOYALTY_EARN_MERCHANT_MATCH_MAX_CHARS} characters`
  );

/**
 * One bonus rule AS SUBMITTED. Strict, and the kind decides the text rule: a category text is not
 * blank and at most `LOYALTY_EARN_CATEGORY_MATCH_MAX_CHARS` once trimmed (any characters, compared
 * literally); a merchant text follows `MERCHANT_MATCH_TEXT` and `LOYALTY_EARN_MERCHANT_MATCH_MAX_CHARS`.
 * The handler stores the trimmed text. Error messages never echo the submitted text.
 */
export const LoyaltyEarnRuleInputSchema = z.discriminatedUnion('kind', [
  z.strictObject({
    kind: z.literal('category'),
    match: typedName(LOYALTY_EARN_CATEGORY_MATCH_MAX_CHARS, 'a category rule'),
    rate: LoyaltyEarnRateInputSchema,
  }),
  z.strictObject({
    kind: z.literal('merchant'),
    match: merchantMatch,
    rate: LoyaltyEarnRateInputSchema,
  }),
]);

/**
 * The key under which two rules can never both match first: same kind, and the same text as the
 * matcher compares it (trimmed and case-folded; a merchant phrase also whitespace-collapsed). A
 * second rule with the same key could never decide a row, so it is refused rather than stored dead.
 */
const earnRuleKey = (r: { kind: string; match: string }) =>
  `${r.kind}\u0000${
    r.kind === 'merchant' ? r.match.trim().toLowerCase().replace(/\s+/g, ' ') : r.match.trim().toLowerCase()
  }`;

/**
 * A membership's earn description AS SUBMITTED on the membership PATCH: the COMPLETE description, a
 * replacement and not an addition. `baseRate` and `rules` are both required (`rules` may be empty).
 * The array order is the stored order and the match order. The handler replaces the base rate and
 * every rule in one transaction, or applies nothing.
 */
export const LoyaltyEarnInputSchema = z
  .strictObject({
    baseRate: LoyaltyEarnRateInputSchema,
    rules: z
      .array(LoyaltyEarnRuleInputSchema)
      .max(LOYALTY_EARN_MAX_RULES, `at most ${LOYALTY_EARN_MAX_RULES} earn rules`),
  })
  .refine((e) => new Set(e.rules.map(earnRuleKey)).size === e.rules.length, {
    message: 'two rules of the same kind match the same text; the second could never apply',
    path: ['rules'],
  });

/**
 * THE INBOX INPUT RULES (P8-42c1), in one place. `lib/domain/loyaltyInbox.ts` imports these rather
 * than restating them: a second copy of "what is a trustworthy sender domain" is the defect this
 * package exists to prevent.
 *
 * Normalisation: trim, then lower-case, but only when the trimmed text is printable ASCII. A
 * non-ASCII entry is left as it is so the shape test refuses it (lower-casing some non-ASCII
 * characters yields ASCII ones, which must not turn a look-alike into a valid entry). The handler
 * stores exactly this normalised form.
 */
export function normaliseLoyaltyInboxEntry(text: string): string {
  const t = text.trim();
  return /^[\x21-\x7e]*$/.test(t) ? t.toLowerCase() : t;
}

/** One hostname label: 1 to 63 of letters, digits and hyphens, not starting or ending with a hyphen. */
const HOST_LABEL = '[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?';
const HOSTNAME = new RegExp(`^(?:${HOST_LABEL}\\.)+${HOST_LABEL}$`);
/** An allowlistable domain also needs a final label of 2 to 24 letters or the punycode `xn--` form. */
const ALLOWLIST_DOMAIN = new RegExp(`^(?:${HOST_LABEL}\\.)+(?:[a-z]{2,24}|xn--[a-z0-9-]{0,58}[a-z0-9])$`);
const ADDRESS = new RegExp(`^[a-z0-9.!#$%&'*+/=?^_\`{|}~-]{1,64}@(?:${HOST_LABEL}\\.)+${HOST_LABEL}$`);

/**
 * The hostname shape (already normalised): lower-case ASCII, at least two labels, at most 253
 * characters. Equals the domain CHECKs of loyalty_inbox_messages and loyalty_inbox_unknown_senders.
 * A sender domain that fails it is counted as `LOYALTY_INBOX_UNREADABLE`.
 */
export function isLoyaltyHostname(domain: string): boolean {
  return domain.length <= 253 && HOSTNAME.test(domain);
}

/**
 * Whether an already-normalised domain may be allowlisted for a program: the hostname shape with a
 * letter or punycode final label (equals `loyalty_sender_domains_domain_shape`), and neither a shared
 * mail provider nor a subdomain of one, nor exactly a shared multi-label suffix. No wildcard, scheme,
 * path, port, `@`, leading or trailing dot can pass the shape.
 */
export function isLoyaltySenderDomain(domain: string): boolean {
  if (!(domain.length <= 253 && ALLOWLIST_DOMAIN.test(domain))) return false;
  if (LOYALTY_INBOX_SHARED_MAIL_PROVIDERS.some((p) => domain === p || domain.endsWith(`.${p}`))) return false;
  return !(LOYALTY_INBOX_SHARED_SUFFIXES as readonly string[]).includes(domain);
}

/**
 * Whether an already-normalised text is a forwarding address: a plain `local@domain`, ASCII, local
 * part 1 to 64 characters of letters, digits and ``.!#$%&'*+/=?^_`{|}~-``, a hostname-shaped domain
 * of at least two labels, at most 254 characters. No display name, angle brackets or quoted local
 * part. Equals `household_member_addresses_address_shape`. Shared mail providers ARE allowed here:
 * a person forwards from whatever mailbox they have.
 */
export function isLoyaltyForwardingAddress(address: string): boolean {
  return address.length <= 254 && ADDRESS.test(address);
}

/** A list must not hold the same entry twice once normalised (the handler would store one row). */
const distinctOnceNormalised = (xs: string[]) => new Set(xs.map(normaliseLoyaltyInboxEntry)).size === xs.length;

/** A sender domain AS SUBMITTED. The message never echoes the input. */
export const LoyaltySenderDomainInputSchema = z
  .string()
  .refine((s) => isLoyaltySenderDomain(normaliseLoyaltyInboxEntry(s)), 'not a sender domain that can be allowlisted');

/** A forwarding address AS SUBMITTED. The message never echoes the input. */
export const LoyaltyForwardingAddressInputSchema = z
  .string()
  .refine((s) => isLoyaltyForwardingAddress(normaliseLoyaltyInboxEntry(s)), 'not a plain email address');

// ─── Requests ───────────────────────────────────────────────────────────────────────────────────

/** `POST /api/v1/loyalty/members`. `userId` absent or null: this person is not a b8 user. */
export const LoyaltyMemberCreateRequestSchema = z.strictObject({
  displayName: typedName(100, 'a display name'),
  userId: UserIdSchema.nullable().optional(),
});

/**
 * `PATCH /api/v1/loyalty/members/[id]`. At least one field; `userId: null` unlinks.
 *
 * `forwardingAddresses` (P8-42c1), when present, is the COMPLETE new list of addresses this member
 * forwards from, a replacement and not an addition; `[]` clears it. 0 to
 * `LOYALTY_INBOX_MAX_ADDRESSES` entries, each a plain address once normalised, no repeat once
 * normalised. The handler stores the normalised forms in one transaction: an address another member
 * holds is 409 `ADDRESS_TAKEN` and nothing changes. An address that stays keeps its `added_on`.
 * After a successful replace, retained not-yet-matched messages are re-attributed; a matched one is
 * never changed. The response is the unchanged `LoyaltyMemberSchema` (it does not echo the list;
 * the page reads it from the overview's `inbox.forwarding`).
 */
export const LoyaltyMemberPatchRequestSchema = z
  .strictObject({
    displayName: typedName(100, 'a display name').optional(),
    userId: UserIdSchema.nullable().optional(),
    forwardingAddresses: z
      .array(LoyaltyForwardingAddressInputSchema)
      .max(LOYALTY_INBOX_MAX_ADDRESSES, `at most ${LOYALTY_INBOX_MAX_ADDRESSES} forwarding addresses`)
      .refine(distinctOnceNormalised, 'the same address appears twice')
      .optional(),
  })
  .refine((b) => Object.keys(b).length > 0, 'nothing to change');

/**
 * `POST /api/v1/loyalty/programs`. The handler stores the program and, as its first alias, the
 * normalised name; if another program already holds that alias the answer is 409 `ALIAS_TAKEN` and
 * nothing is created.
 */
export const LoyaltyProgramCreateRequestSchema = z.strictObject({
  name: typedName(200, 'a program name'),
  kind: LoyaltyProgramKindSchema,
  defaultUnit: LoyaltyUnitSchema,
});

/**
 * `PATCH /api/v1/loyalty/programs/[id]`. At least one field.
 *
 * `aliases`, when present, is the COMPLETE new list, a replacement and not an addition, with at least
 * one entry. The handler normalises each, collapses duplicates, and applies the whole list in one
 * transaction: an alias held by another program answers 409 `ALIAS_TAKEN` and leaves the program's
 * aliases exactly as they were. Absent means the aliases are unchanged.
 *
 * `senderDomains` (P8-42c1), when present, is the COMPLETE new allowlist for this program, a
 * replacement and not an addition; `[]` clears it. 0 to `LOYALTY_INBOX_MAX_DOMAINS` entries, each
 * passing `isLoyaltySenderDomain` once normalised, no repeat once normalised. Applied in one
 * transaction: a domain another program holds is 409 `DOMAIN_TAKEN` and the old list is unchanged.
 * A domain that stays keeps its `last_seen_on`. The response is the unchanged
 * `LoyaltyProgramSchema` (it does not echo the list; the page reads it from `inbox.senderDomains`).
 */
export const LoyaltyProgramPatchRequestSchema = z
  .strictObject({
    name: typedName(200, 'a program name').optional(),
    kind: LoyaltyProgramKindSchema.optional(),
    defaultUnit: LoyaltyUnitSchema.optional(),
    aliases: z
      .array(LoyaltyAliasInputSchema)
      .min(1, 'a program needs at least one alias')
      .max(100, 'a program has at most 100 aliases')
      .optional(),
    senderDomains: z
      .array(LoyaltySenderDomainInputSchema)
      .max(LOYALTY_INBOX_MAX_DOMAINS, `at most ${LOYALTY_INBOX_MAX_DOMAINS} sender domains`)
      .refine(distinctOnceNormalised, 'the same domain appears twice')
      .optional(),
  })
  .refine((b) => Object.keys(b).length > 0, 'nothing to change');

/**
 * `POST /api/v1/loyalty/memberships`. An unknown member or program is refused and nothing is
 * created; a pair that already exists is 409 `MEMBERSHIP_EXISTS`. `cardAccountId` and `benefit` are
 * not accepted here (strict object): a membership is created unlinked, and a card and its benefit
 * are set afterwards by the membership PATCH, the one place their rules are checked.
 */
export const LoyaltyMembershipCreateRequestSchema = z.strictObject({
  memberId: LoyaltyIdSchema,
  programId: LoyaltyIdSchema,
  memberNumber: LoyaltyMemberNumberInputSchema.nullable().optional(),
  tier: typedName(100, 'a tier').nullable().optional(),
});

/**
 * `PATCH /api/v1/loyalty/memberships/[id]`. At least one field; `null` clears it.
 *
 * `cardAccountId` links the credit card that earns into this membership; `null` unlinks. The handler
 * refuses an unknown account or one whose type is not `credit` (400 `INVALID_INPUT`) and a card
 * another membership holds (409 `CARD_ALREADY_LINKED`). Re-linking the same card is a no-op 200.
 * Unlinking sets only the link to null: instruments and the benefit stay.
 *
 * `benefit` describes the card's annual benefit; `null` clears all three of its columns. Accepted on
 * an unlinked membership too (it is inert until a card is linked).
 *
 * `earn` (P8-42b2) replaces the whole earn description — base rate and every rule — in one
 * transaction; `null` deletes every rule and nulls the base rate. Accepted on an unlinked membership
 * (inert until a card is linked). The create schema does not accept it.
 */
export const LoyaltyMembershipPatchRequestSchema = z
  .strictObject({
    memberNumber: LoyaltyMemberNumberInputSchema.nullable().optional(),
    tier: typedName(100, 'a tier').nullable().optional(),
    cardAccountId: z.string().min(1, 'a card account id may not be empty').nullable().optional(),
    benefit: LoyaltyBenefitInputSchema.nullable().optional(),
    earn: LoyaltyEarnInputSchema.nullable().optional(),
  })
  .refine((b) => Object.keys(b).length > 0, 'nothing to change');

/**
 * `POST /api/v1/loyalty/memberships/[id]/observations` — a new reading; the only way a balance
 * changes. Appends one row with source `typed`.
 *
 * `asOf` is required: the page sends the browser's local calendar date. More than one day after
 * Postgres's CURRENT_DATE is 400, a check only the handler can make. `source` may be omitted or be
 * exactly `typed`; any other value is refused, so a client can never claim `import`, `email` or
 * `screenshot`.
 */
export const LoyaltyObservationCreateRequestSchema = z
  .strictObject({
    asOf: calendarDate,
    balance: LoyaltyBalanceInputSchema,
    unit: LoyaltyUnitSchema,
    source: z.literal('typed').optional(),
  })
  .refine((b) => isBalanceForUnit(b.unit, b.balance), {
    message: 'the balance is not valid for its unit',
    path: ['balance'],
  });

const instrumentDateOrder = (b: {
  issuedOn?: string | null;
  expiresOn?: string | null;
  usedOn?: string | null;
}) =>
  !(b.issuedOn != null && b.expiresOn != null && b.expiresOn < b.issuedOn) &&
  !(b.issuedOn != null && b.usedOn != null && b.usedOn < b.issuedOn);

/**
 * `POST /api/v1/loyalty/instruments`. Source is not in the body: a route always writes `typed`.
 * Every date may be null or absent (unknown). Expiry or use before issue is refused when both are
 * set; comparison is on the `YYYY-MM-DD` strings, which order exactly as the dates do.
 */
export const LoyaltyInstrumentCreateRequestSchema = z
  .strictObject({
    membershipId: LoyaltyIdSchema,
    kind: LoyaltyInstrumentKindSchema,
    description: typedName(200, 'a description'),
    issuedOn: calendarDate.nullable().optional(),
    expiresOn: calendarDate.nullable().optional(),
    usedOn: calendarDate.nullable().optional(),
  })
  .refine(instrumentDateOrder, {
    message: 'an instrument cannot expire or be used before it is issued',
    path: ['expiresOn'],
  });

/**
 * `PATCH /api/v1/loyalty/instruments/[id]`. At least one field; `null` clears a date. The order rule
 * is checked here for the dates in the body and by the handler against the stored row (the table's
 * CHECK backs both; its violation is 400, never 500).
 */
export const LoyaltyInstrumentPatchRequestSchema = z
  .strictObject({
    kind: LoyaltyInstrumentKindSchema.optional(),
    description: typedName(200, 'a description').optional(),
    issuedOn: calendarDate.nullable().optional(),
    expiresOn: calendarDate.nullable().optional(),
    usedOn: calendarDate.nullable().optional(),
  })
  .refine((b) => Object.keys(b).length > 0, 'nothing to change')
  .refine(instrumentDateOrder, {
    message: 'an instrument cannot expire or be used before it is issued',
    path: ['expiresOn'],
  });

/**
 * `POST /api/v1/loyalty/inbox/read` (P8-42c2). The body is optional; an absent body reads as `{}`.
 * `retryFailed: true` first deletes every `failed` reads row whose message still has its bytes
 * (returning it to unread with zero attempts); rows whose bytes are gone are left alone. Strict.
 */
export const LoyaltyInboxReadRequestSchema = z.strictObject({
  retryFailed: z.boolean().optional(),
});

/**
 * `POST /api/v1/loyalty/inbox/readings/[id]` (P8-42c2): one action on one queued item, only while it
 * is `pending` (else 409 `ITEM_RESOLVED`).
 *
 *   apply    — `membershipId` is required when the item has no unique match and must be a
 *              membership of the item's program (else 400 `INVALID_INPUT`); with a unique match it
 *              may be omitted. Appends one `email` observation with the item's balance and unit,
 *              dated by the item's as-of, or by its received date when it has none. An as-of more
 *              than one day after CURRENT_DATE is 400. The item becomes `applied_by_hand` in the same
 *              transaction.
 *   not_mine — the item becomes `not_mine`; with a suffix, (program, suffix) is recorded and every
 *              other pending `unmatched_suffix` item of that pair follows. No observation.
 *   ignore   — the item becomes `ignored`. No observation, no record.
 *
 * Discriminated on `action` and strict per branch, so `membershipId` with `not_mine` or `ignore` is
 * refused rather than silently dropped. Error messages never echo input.
 */
export const LoyaltyInboxResolveRequestSchema = z.discriminatedUnion('action', [
  z.strictObject({ action: z.literal('apply'), membershipId: LoyaltyIdSchema.optional() }),
  z.strictObject({ action: z.literal('not_mine') }),
  z.strictObject({ action: z.literal('ignore') }),
]);

// ─── Responses ──────────────────────────────────────────────────────────────────────────────────

/** A household member. `userId` null: not a b8 user. */
export const LoyaltyMemberSchema = z.strictObject({
  id: LoyaltyIdSchema,
  displayName: z.string().min(1),
  userId: UserIdSchema.nullable(),
});

/**
 * A catalog program with its aliases (stored, normalised), ordered by alias ascending so a list never
 * depends on insertion order. Never empty for a program created through the routes or the seed.
 */
export const LoyaltyProgramSchema = z.strictObject({
  id: LoyaltyIdSchema,
  name: z.string().min(1),
  kind: LoyaltyProgramKindSchema,
  defaultUnit: LoyaltyUnitSchema,
  aliases: z.array(z.string().min(1)),
});

/** A card's annual benefit as stored (the three `benefit_*` columns). `windowDays` is always set. */
export const LoyaltyBenefitSchema = z.strictObject({
  kind: LoyaltyInstrumentKindSchema,
  description: z.string().min(1),
  windowDays: LoyaltyBenefitWindowDaysSchema,
});

/**
 * THE FEE WATCH — derived on every read, never stored (see `LOYALTY_FEE_WATCH_STATES`).
 *
 *   feeDate    — the POSTED date (never the authorized date) of the card's most recent annual-fee
 *                row, if that row was not refunded; null when there is none. Postgres `::text`.
 *   expectedBy — feeDate plus the benefit window in calendar days, by Postgres date arithmetic.
 *                Null whenever there is no fee or no benefit to wait for.
 *   state      — one of the four states when a benefit is described; null when none is.
 *
 * Consistency, enforced here so a producer cannot emit a state that contradicts its dates:
 * `state` null implies `expectedBy` null (`feeDate` may be either: a linked card with no benefit
 * still shows its fee date). `no_fee_seen` implies both dates null. `awaiting`, `received` and
 * `overdue` imply both dates present.
 *
 * THE FEE AMOUNT IS NEVER EMITTED. There is deliberately no amount field, and the strict object
 * refuses one: no figure is needed to say whether the benefit arrived, and a ledger amount on a
 * loyalty surface would be a new place for a money figure to leak (SPEC.md Open question 9).
 *
 * The answer is identical for every viewer: a ledger row held by an unrevealed gift is never a fee
 * for anyone, giver included. That is why the routes returning a membership are `numeric-only` in
 * the gift surface registry (they carry a date derived from a ledger row, never its text).
 */
export const LoyaltyFeeWatchSchema = z
  .strictObject({
    feeDate: calendarDate.nullable(),
    expectedBy: calendarDate.nullable(),
    state: LoyaltyFeeWatchStateSchema.nullable(),
  })
  .refine((w) => w.state !== null || w.expectedBy === null, {
    message: 'with no state there is no expected-by date',
    path: ['expectedBy'],
  })
  .refine((w) => w.state !== 'no_fee_seen' || (w.feeDate === null && w.expectedBy === null), {
    message: 'no_fee_seen carries no dates',
    path: ['feeDate'],
  })
  .refine(
    (w) =>
      w.state === null || w.state === 'no_fee_seen' || (w.feeDate !== null && w.expectedBy !== null),
    { message: 'awaiting, received and overdue carry both dates', path: ['feeDate'] }
  );

/**
 * A rate as emitted: the NUMERIC(7,4) column's `::text`, so exactly four decimals and no leading
 * zero (a page may trim trailing zeros by string work). Within the same bounds as the input.
 */
export const LoyaltyEarnRateSchema = z
  .string()
  .refine((s) => /^(?:0|[1-9]\d{0,2})\.\d{4}$/.test(s) && isEarnRateText(s), 'expected a rate with exactly four decimals');

/** One stored bonus rule, in stored order. `match` is the trimmed text as stored. */
export const LoyaltyEarnRuleSchema = z.strictObject({
  kind: LoyaltyEarnMatchKindSchema,
  match: z.string().min(1),
  rate: LoyaltyEarnRateSchema,
});

/** A membership's stored earn description. `rules` is in stored (match) order and may be empty. */
export const LoyaltyEarnSchema = z.strictObject({
  baseRate: LoyaltyEarnRateSchema,
  rules: z.array(LoyaltyEarnRuleSchema).max(LOYALTY_EARN_MAX_RULES),
});

/**
 * A signed estimate figure in its unit, as emitted: canonical decimal text from Postgres's single
 * `round(numeric, scale)` of the exact sum. Whole units (`points`, `miles`): an optional minus, then
 * digits with no leading zero and no decimal point. `usd`: the same with exactly two decimals. The
 * plain zero only: a negative zero is refused. Negative is legitimate (refunds outweighing
 * purchases in the window) and is never clamped.
 */
export function isEarnFigureForUnit(unit: string, text: string): boolean {
  const shaped = unit === 'usd' ? /^-?(?:0|[1-9]\d*)\.\d{2}$/.test(text) : /^-?(?:0|[1-9]\d*)$/.test(text);
  return shaped && !/^-0(?:\.00)?$/.test(text);
}

/** A canonical figure is zero exactly when it is the plain zero of its scale. */
const isZeroFigure = (text: string) => /^0(?:\.00)?$/.test(text);

/** A canonical figure in minor units (the decimal point removed), for exact comparison. */
const minorUnits = (text: string) => BigInt(text.replace('.', ''));

/**
 * THE EARN ESTIMATE — derived on every read, never stored (P8-42b2).
 *
 *   since  — the period's start, exclusive: the current reading's as-of date (`basis: reading`), or
 *            CURRENT_DATE minus `LOYALTY_EARN_FALLBACK_DAYS` (`basis: last_30_days`). The period ends
 *            on CURRENT_DATE inclusive. Postgres `::text`.
 *   unit   — the current reading's unit, or with no reading the program's default unit. Never
 *            `nights` (the estimate is null then, not zero).
 *   amount — the card's purchases less its refunds since `since`, each priced by its first matching
 *            rule (or the base rate), summed exactly and rounded once. See `isEarnFigureForUnit`.
 *
 * Strict: no spend total, row, merchant or per-rule breakdown can be carried. The same for every
 * viewer: a row held by an unrevealed gift is never spend for anyone.
 */
export const LoyaltyEarnEstimateSchema = z
  .strictObject({
    since: calendarDate,
    basis: LoyaltyEarnBasisSchema,
    unit: LoyaltyEarnUnitSchema,
    amount: z.string(),
  })
  .refine((e) => isEarnFigureForUnit(e.unit, e.amount), {
    message: 'the estimate is not canonical decimal text for its unit',
    path: ['amount'],
  });

/** A difference percentage as emitted: signed, exactly one decimal, the plain zero only. */
const isDifferencePercentText = (text: string) => /^-?(?:0|[1-9]\d*)\.\d$/.test(text) && text !== '-0.0';

/**
 * THE MISS RULE (SPEC.md Conventions), decided exactly on the emitted figures and never on the
 * rounded percentage. With a zero estimate: a miss exactly when the actual is not zero. Otherwise:
 * a miss exactly when one hundred times the absolute difference is STRICTLY greater than
 * `LOYALTY_EARN_MISS_PERCENT` times the absolute estimate. Integer arithmetic in minor units (both
 * figures share the unit's scale), never a JS float.
 */
export function isEarnMiss(estimated: string, actual: string): boolean {
  const zero = BigInt(0);
  const abs = (x: bigint) => (x < zero ? -x : x);
  const e = minorUnits(estimated);
  const a = minorUnits(actual);
  if (e === zero) return a !== zero;
  return BigInt(100) * abs(a - e) > BigInt(LOYALTY_EARN_MISS_PERCENT) * abs(e);
}

/**
 * THE LATEST "ESTIMATE VS ACTUAL" — derived on every read, never stored (P8-42b2).
 *
 *   from, to          — the previous and the current reading's as-of dates; `from` is strictly
 *                       before `to`. The window is the days after `from` up to and including `to`.
 *   unit              — both readings' unit (they must agree, or there is no comparison). Never
 *                       `nights`.
 *   estimated         — the estimate over that window, canonical for the unit.
 *   actual            — current balance minus previous balance, exact, canonical for the unit.
 *   differencePercent — one hundred times (actual minus estimated) over the absolute estimated,
 *                       rounded once to one decimal, half away from zero. Null exactly when
 *                       `estimated` is zero (no division by zero, and never shown as zero).
 *   worthALook        — `isEarnMiss(estimated, actual)`. Advisory only; no alert, no push.
 *
 * Refinements make a contradiction unparseable: dates out of order, a non-canonical figure, a
 * negative zero, a percentage present with a zero estimate or absent with a non-zero one, a
 * `worthALook` that disagrees with the miss rule. Strict: no spend figure can be carried.
 */
export const LoyaltyEarnComparisonSchema = z
  .strictObject({
    from: calendarDate,
    to: calendarDate,
    unit: LoyaltyEarnUnitSchema,
    estimated: z.string(),
    actual: z.string(),
    differencePercent: z.string().nullable(),
    worthALook: z.boolean(),
  })
  .refine((c) => c.from < c.to, { message: 'from must be before to', path: ['from'] })
  .refine((c) => isEarnFigureForUnit(c.unit, c.estimated), {
    message: 'estimated is not canonical decimal text for its unit',
    path: ['estimated'],
  })
  .refine((c) => isEarnFigureForUnit(c.unit, c.actual), {
    message: 'actual is not canonical decimal text for its unit',
    path: ['actual'],
  })
  .refine((c) => c.differencePercent === null || isDifferencePercentText(c.differencePercent), {
    message: 'differencePercent is signed text with exactly one decimal',
    path: ['differencePercent'],
  })
  .refine((c) => (c.differencePercent === null) === isZeroFigure(c.estimated), {
    message: 'differencePercent is null exactly when the estimate is zero',
    path: ['differencePercent'],
  })
  .refine(
    (c) =>
      // Only judged on well-formed figures; a malformed one is already reported above.
      !(isEarnFigureForUnit(c.unit, c.estimated) && isEarnFigureForUnit(c.unit, c.actual)) ||
      c.worthALook === isEarnMiss(c.estimated, c.actual),
    { message: 'worthALook does not follow the miss rule', path: ['worthALook'] }
  );

/**
 * One credit account a membership may be linked to — the `/travel` link picker's choices. Only
 * accounts whose type is `credit`. `name` is the account's display name as stored.
 */
export const LoyaltyCardAccountSchema = z.strictObject({
  id: z.string().min(1),
  name: z.string(),
});

/**
 * One membership as every response but the member-number route shows it.
 *
 * `memberNumberMasked` is the ONLY number field, and it is masked (null when no number is stored).
 *
 * `balance`, `unit`, `asOf` and `source` describe the CURRENT observation — the one with the greatest
 * as-of date, ties by latest recorded time, then highest id, chosen by the shared reducer in
 * apps/web/lib/domain/observations.ts and never by arrival. All four are null together when the
 * membership has no observation (rendered "—", never 0), and all four are present together
 * otherwise. A zero balance is a reading and is `"0"` (or `"0.00"` for usd), never null.
 *
 * THE CARD (P8-42b). `cardAccountId` and `cardAccountName` are the linked credit account, null
 * together when no card is linked. `benefit` is the described annual benefit, or null; it is kept
 * across an unlink, so it may be present with no card. `feeWatch` is null exactly when no card is
 * linked, and otherwise always an object (all three fields null for a linked card with no benefit
 * and no fee). When `feeWatch` is present, its `state` is null exactly when `benefit` is null: there
 * is a state only when there is something to wait for.
 *
 * THE EARN DESCRIPTION AND ITS DERIVED FIGURES (P8-42b2). `earn` is the stored description, or null
 * when none is stored; like `benefit` it is kept across an unlink. `earnEstimate` and
 * `earnComparison` are DERIVED on every read and never stored. `earnEstimate` is null when no card
 * is linked, `earn` is null, or the unit is `nights`. `earnComparison` is null in those cases and
 * also when fewer than two readings exist on different as-of dates or the latest two differ in unit.
 * A null is rendered as an absent phrase, never as `0`; a genuine zero is a figure. All three keys
 * are required (nullable, never optional). The same for every viewer. Never `feeWatch`'s concern:
 * the earn description does not alter any `feeWatch` field.
 */
export const LoyaltyMembershipSchema = z
  .strictObject({
    id: LoyaltyIdSchema,
    memberId: LoyaltyIdSchema,
    memberDisplayName: z.string().min(1),
    programId: LoyaltyIdSchema,
    memberNumberMasked: LoyaltyMaskedMemberNumberSchema.nullable(),
    tier: z.string().min(1).nullable(),
    balance: z.string().nullable(),
    unit: LoyaltyUnitSchema.nullable(),
    asOf: calendarDate.nullable(),
    source: LoyaltyObservationSourceSchema.nullable(),
    cardAccountId: z.string().min(1).nullable(),
    cardAccountName: z.string().nullable(),
    benefit: LoyaltyBenefitSchema.nullable(),
    feeWatch: LoyaltyFeeWatchSchema.nullable(),
    earn: LoyaltyEarnSchema.nullable(),
    earnEstimate: LoyaltyEarnEstimateSchema.nullable(),
    earnComparison: LoyaltyEarnComparisonSchema.nullable(),
  })
  .refine((m) => m.earnEstimate === null || (m.cardAccountId !== null && m.earn !== null), {
    message: 'an estimate needs a linked card and an earn description',
    path: ['earnEstimate'],
  })
  .refine((m) => m.earnComparison === null || (m.cardAccountId !== null && m.earn !== null), {
    message: 'a comparison needs a linked card and an earn description',
    path: ['earnComparison'],
  })
  .refine((m) => (m.cardAccountId === null) === (m.cardAccountName === null), {
    message: 'cardAccountId and cardAccountName are null together or present together',
    path: ['cardAccountName'],
  })
  .refine((m) => (m.cardAccountId === null) === (m.feeWatch === null), {
    message: 'feeWatch is null exactly when no card is linked',
    path: ['feeWatch'],
  })
  .refine((m) => m.feeWatch === null || (m.feeWatch.state === null) === (m.benefit === null), {
    message: 'a linked card has a state exactly when a benefit is described',
    path: ['feeWatch'],
  })
  .refine(
    (m) =>
      [m.balance, m.unit, m.asOf, m.source].every((v) => v === null) ||
      [m.balance, m.unit, m.asOf, m.source].every((v) => v !== null),
    { message: 'balance, unit, asOf and source are null together or present together', path: ['balance'] }
  )
  .refine(
    (m) =>
      m.balance === null ||
      (m.unit === 'usd'
        ? LoyaltyUsdBalanceSchema.safeParse(m.balance).success
        : LoyaltyWholeBalanceSchema.safeParse(m.balance).success),
    { message: 'the balance is not in the canonical form for its unit', path: ['balance'] }
  );

/**
 * One program card on /travel: a program with at least one membership, and its memberships (one
 * line each), ordered by member display name then membership id. A program with no membership has
 * no card; it is still in the catalog list.
 */
export const LoyaltyProgramCardSchema = z.strictObject({
  programId: LoyaltyIdSchema,
  programName: z.string().min(1),
  programKind: LoyaltyProgramKindSchema,
  memberships: z.array(LoyaltyMembershipSchema).min(1),
});

/** An instrument. Every date null = unknown. */
export const LoyaltyInstrumentSchema = z.strictObject({
  id: LoyaltyIdSchema,
  membershipId: LoyaltyIdSchema,
  kind: LoyaltyInstrumentKindSchema,
  description: z.string().min(1),
  issuedOn: calendarDate.nullable(),
  expiresOn: calendarDate.nullable(),
  usedOn: calendarDate.nullable(),
  source: LoyaltyInstrumentSourceSchema,
});

/** A whole count as emitted: a non-negative JSON integer, never fractional, never negative. */
const InboxCountSchema = z.int().nonnegative();

/**
 * The last poll that ran, from `loyalty_inbox_state`. `on` is its CURRENT_DATE as Postgres text.
 * `errorCode` is set exactly when `outcome` is `error`, and is a classified code only.
 */
export const LoyaltyInboxLastCheckSchema = z
  .strictObject({
    on: calendarDate,
    outcome: z.enum(['ok', 'error']),
    errorCode: LoyaltyInboxPollErrorCodeSchema.nullable(),
  })
  .refine((c) => (c.errorCode !== null) === (c.outcome === 'error'), {
    message: 'errorCode is set exactly when the outcome is error',
    path: ['errorCode'],
  });

/** A program's stored allowlist, for a program with at least one domain, domains ascending. */
export const LoyaltyInboxSenderDomainsSchema = z.strictObject({
  programId: LoyaltyIdSchema,
  domains: z.array(z.string().refine(isLoyaltyHostname, 'expected a hostname')).min(1).max(LOYALTY_INBOX_MAX_DOMAINS),
});

/**
 * Coverage of one program with at least one domain. `lastSeenOn`: the greatest `last_seen_on` over
 * its domains, null = no mail seen yet (never a date, never the epoch). `storedInWindow`: retained
 * messages for the program with received date on or after CURRENT_DATE minus the retention days.
 */
export const LoyaltyInboxCoverageSchema = z.strictObject({
  programId: LoyaltyIdSchema,
  lastSeenOn: calendarDate.nullable(),
  storedInWindow: InboxCountSchema,
});

/**
 * One member's forwarding health (see `LOYALTY_INBOX_FORWARDING_STATES`). `addresses` is the owner's
 * own configuration, ascending. `lastReceivedOn`: the greatest `last_received_on` over the addresses,
 * or null. `quietDays`: CURRENT_DATE minus the reference date in whole days (Postgres), null exactly
 * for `not_set_up`. Never negative: received dates are UTC calendar dates while CURRENT_DATE follows
 * the session time zone, so a message received this evening can carry tomorrow's date for a few
 * hours; the producer computes `GREATEST(0, CURRENT_DATE - reference)` in SQL rather than emit a
 * negative day count. The refinements make a state that contradicts its fields unparseable.
 */
export const LoyaltyInboxForwardingSchema = z
  .strictObject({
    memberId: LoyaltyIdSchema,
    addresses: z
      .array(z.string().refine(isLoyaltyForwardingAddress, 'expected a plain address'))
      .max(LOYALTY_INBOX_MAX_ADDRESSES),
    state: LoyaltyInboxForwardingStateSchema,
    lastReceivedOn: calendarDate.nullable(),
    quietDays: InboxCountSchema.nullable(),
  })
  .refine((f) => (f.state === 'not_set_up') === (f.addresses.length === 0), {
    message: 'not_set_up exactly when the member has no address',
    path: ['state'],
  })
  .refine((f) => (f.state === 'not_set_up') === (f.quietDays === null), {
    message: 'quietDays is null exactly for not_set_up',
    path: ['quietDays'],
  })
  .refine((f) => f.state !== 'not_set_up' || f.lastReceivedOn === null, {
    message: 'not_set_up has no received date',
    path: ['lastReceivedOn'],
  })
  .refine((f) => f.state !== 'no_mail_yet' || f.lastReceivedOn === null, {
    message: 'no_mail_yet has no received date',
    path: ['lastReceivedOn'],
  })
  .refine((f) => f.state !== 'ok' || f.lastReceivedOn !== null, {
    message: 'ok has a received date',
    path: ['lastReceivedOn'],
  })
  .refine(
    (f) =>
      f.quietDays === null ||
      (f.state === 'quiet') === (f.quietDays > LOYALTY_INBOX_SILENCE_DAYS),
    { message: 'quiet exactly when quietDays is above the silence threshold', path: ['state'] }
  );

/** One unknown sender domain (or `LOYALTY_INBOX_UNREADABLE`) and its count of retained rows. */
export const LoyaltyInboxUnknownSenderSchema = z.strictObject({
  domain: z.string().refine((d) => d === LOYALTY_INBOX_UNREADABLE || isLoyaltyHostname(d), 'expected a hostname'),
  count: z.int().positive(),
});

/**
 * THE OVERVIEW'S INBOX PANEL (P8-42c1). Every count and day difference is computed in Postgres.
 *
 *   configured, problem, missing — the password-free view of the environment. `configured` exactly
 *        when `problem` is null. `missing` lists required variable NAMES only (never values): all
 *        five for `unset`, one to four for `incomplete`, none otherwise.
 *   retentionDays, silenceDays — the two constants, so the page states them without importing logic.
 *   lastCheck       — null = never polled ("Not checked yet").
 *   senderDomains   — one entry per program with at least one domain.
 *   coverage        — one entry per program with at least one domain (the same programs).
 *   forwarding      — one entry per household member.
 *   unknownSenders  — retained unknown rows by domain, count descending then domain ascending, at most
 *                     `LOYALTY_INBOX_UNKNOWN_LIMIT` entries.
 *   unknownSenderTotal — the count of all retained unknown rows (not just the listed ones).
 *   unattributed    — retained kept messages whose attribution is not `matched`.
 *
 * No key can hold a message body, a subject, a sender's address, a Message-ID, the host, the user
 * or the password: the objects are strict and every string is shape-checked.
 */
export const LoyaltyInboxSchema = z
  .strictObject({
    configured: z.boolean(),
    problem: LoyaltyInboxConfigProblemSchema.nullable(),
    missing: z.array(LoyaltyInboxRequiredEnvSchema),
    retentionDays: z.literal(LOYALTY_INBOX_RETENTION_DAYS),
    silenceDays: z.literal(LOYALTY_INBOX_SILENCE_DAYS),
    lastCheck: LoyaltyInboxLastCheckSchema.nullable(),
    senderDomains: z.array(LoyaltyInboxSenderDomainsSchema),
    coverage: z.array(LoyaltyInboxCoverageSchema),
    forwarding: z.array(LoyaltyInboxForwardingSchema),
    unknownSenders: z.array(LoyaltyInboxUnknownSenderSchema).max(LOYALTY_INBOX_UNKNOWN_LIMIT),
    unknownSenderTotal: InboxCountSchema,
    unattributed: InboxCountSchema,
  })
  .refine((i) => i.configured === (i.problem === null), {
    message: 'configured exactly when there is no problem',
    path: ['configured'],
  })
  .refine((i) => new Set(i.missing).size === i.missing.length, {
    message: 'a missing name appears twice',
    path: ['missing'],
  })
  .refine(
    (i) =>
      i.problem === 'unset'
        ? i.missing.length === LOYALTY_INBOX_REQUIRED_ENV.length
        : i.problem === 'incomplete'
          ? i.missing.length >= 1 && i.missing.length < LOYALTY_INBOX_REQUIRED_ENV.length
          : i.missing.length === 0,
    { message: 'missing does not agree with the problem', path: ['missing'] }
  )
  .refine(
    (i) =>
      [...i.coverage.map((c) => c.programId)].sort((a, b) => a - b).join() ===
      [...i.senderDomains.map((s) => s.programId)].sort((a, b) => a - b).join(),
    { message: 'coverage covers exactly the programs with sender domains', path: ['coverage'] }
  )
  .refine((i) => i.unknownSenders.reduce((n, u) => n + u.count, 0) <= i.unknownSenderTotal, {
    message: 'the listed unknown senders exceed the total',
    path: ['unknownSenderTotal'],
  });

/**
 * `POST /api/v1/loyalty/inbox/poll` (P8-42c1), no body. HTTP 200 for all four outcomes.
 *
 *   fetched    — envelopes listed in the window.
 *   stored     — new messages kept (an oversize one included).
 *   duplicates — envelopes whose dedupe key was already known (never downloaded again).
 *   unknown    — new unknown-sender rows (counted by domain only).
 *   expired    — envelopes older than the window (dropped, not stored, not counted unknown).
 *   oversize   — new messages recorded without their bytes.
 *   errorCode  — set exactly when `outcome` is `error`; a classified code only.
 *
 * `disabled` and `already_running` ran nothing, so every count is zero. An `error` may carry the
 * counts reached before the failure. Strict: no subject, body, raw byte, address or library text.
 */
export const LoyaltyInboxPollSchema = z
  .strictObject({
    outcome: LoyaltyInboxPollOutcomeSchema,
    fetched: InboxCountSchema,
    stored: InboxCountSchema,
    duplicates: InboxCountSchema,
    unknown: InboxCountSchema,
    expired: InboxCountSchema,
    oversize: InboxCountSchema,
    errorCode: LoyaltyInboxPollErrorCodeSchema.nullable(),
  })
  .refine((p) => (p.errorCode !== null) === (p.outcome === 'error'), {
    message: 'errorCode is set exactly when the outcome is error',
    path: ['errorCode'],
  })
  .refine(
    (p) =>
      (p.outcome !== 'disabled' && p.outcome !== 'already_running') ||
      [p.fetched, p.stored, p.duplicates, p.unknown, p.expired, p.oversize].every((n) => n === 0),
    { message: 'a poll that did not run has zero counts', path: ['outcome'] }
  );

// ─── Reading the inbox (P8-42c2) ────────────────────────────────────────────────────────────────

/**
 * Canonical decimal text for a unit, as Postgres emits a reads or observations balance: whole units
 * are digits with no leading zero and no decimal point, `usd` has exactly two decimals. Any other
 * `what` (status, other) has no scale, so no text is canonical for it.
 */
const isCanonicalForUnit = (unit: string, text: string) =>
  unit === 'usd'
    ? LoyaltyUsdBalanceSchema.safeParse(text).success
    : (LOYALTY_WHOLE_UNITS as readonly string[]).includes(unit) && LoyaltyWholeBalanceSchema.safeParse(text).success;

const MASKED_SUFFIX = new RegExp(
  `^${LOYALTY_MASK_BULLETS}[A-Z0-9]{${LOYALTY_READ_SUFFIX_MIN},${LOYALTY_READ_SUFFIX_MAX}}$`
);

/**
 * A kept suffix as emitted: the existing masked form, four bullets then the 3 or 4 upper-case
 * letters or digits stored in `loyalty_inbox_reads.suffix`. The only member-number fragment any
 * payload of this step carries; bare bullets and anything longer are refused.
 */
export const LoyaltyReadMaskedSuffixSchema = LoyaltyMaskedMemberNumberSchema.refine(
  (s) => MASKED_SUFFIX.test(s),
  'expected four bullets and a 3 or 4 character suffix'
);

/**
 * One expiry warning from mail, as stored and emitted. `amount` is null (none stated, or not a
 * figure) or canonical decimal text in the scale of `what`; `status` and `other` never carry one.
 */
export const LoyaltyReadExpiryWarningSchema = z
  .strictObject({
    what: LoyaltyReadExpiryKindSchema,
    expiresOn: calendarDate,
    amount: z.string().nullable(),
  })
  .refine((w) => w.amount === null || isCanonicalForUnit(w.what, w.amount), {
    message: 'an amount is canonical for its unit, and status or other carry none',
    path: ['amount'],
  });

/** One instrument from mail, as stored and emitted. `expiresOn` null = the mail stated no expiry. */
export const LoyaltyReadInstrumentSchema = z.strictObject({
  kind: LoyaltyInstrumentKindSchema,
  expiresOn: calendarDate.nullable(),
});

/** Reasons decided after the suffix rule: an item with one of these always has a suffix. */
const SUFFIX_REQUIRED_REASONS: readonly string[] = [
  'unmatched_suffix',
  'ambiguous_suffix',
  'unit_mismatch',
  'no_as_of',
  'as_of_future',
  'no_baseline',
  'implausible_jump',
];

/**
 * One queued item (`pending` reads row).
 *
 *   maskedSuffix           — null exactly for `no_suffix` (and possibly `program_mismatch`).
 *   balance, unit          — the proposal, canonical for the unit. Always present: a reading with no
 *                            balance is `no_balance` and is never queued.
 *   asOf                   — null = the mail gave no date (`no_as_of`; rendered `no date`).
 *   receivedOn             — the message's received date; also the date an apply uses when asOf is null.
 *   candidateMembershipIds — memberships of the item's program whose stored number ends with the
 *                            suffix, computed in SQL at read time, ascending, no repeat; empty with
 *                            no suffix. Ids only: the full number never enters the payload. May differ
 *                            from what the reason recorded if memberships changed since the read.
 */
export const LoyaltyReadItemSchema = z
  .strictObject({
    id: LoyaltyIdSchema,
    programId: LoyaltyIdSchema,
    maskedSuffix: LoyaltyReadMaskedSuffixSchema.nullable(),
    balance: z.string(),
    unit: LoyaltyUnitSchema,
    asOf: calendarDate.nullable(),
    receivedOn: calendarDate,
    reason: LoyaltyReadReasonSchema,
    candidateMembershipIds: z.array(LoyaltyIdSchema),
  })
  .refine((i) => isCanonicalForUnit(i.unit, i.balance), {
    message: 'the balance is not in the canonical form for its unit',
    path: ['balance'],
  })
  .refine((i) => i.reason !== 'no_suffix' || i.maskedSuffix === null, {
    message: 'no_suffix carries no suffix',
    path: ['maskedSuffix'],
  })
  .refine((i) => !SUFFIX_REQUIRED_REASONS.includes(i.reason) || i.maskedSuffix !== null, {
    message: 'this reason was decided on a suffix',
    path: ['maskedSuffix'],
  })
  .refine((i) => i.reason !== 'no_as_of' || i.asOf === null, {
    message: 'no_as_of carries no date',
    path: ['asOf'],
  })
  .refine((i) => i.maskedSuffix !== null || i.candidateMembershipIds.length === 0, {
    message: 'with no suffix there are no candidates',
    path: ['candidateMembershipIds'],
  })
  .refine(
    (i) => i.candidateMembershipIds.every((id, k, a) => k === 0 || a[k - 1] < id),
    { message: 'candidates are ascending with no repeat', path: ['candidateMembershipIds'] }
  );

/** Coverage of one program that has a sender domain (see `LOYALTY_READ_COVERAGE`). */
export const LoyaltyReadCoverageEntrySchema = z.strictObject({
  programId: LoyaltyIdSchema,
  balanceInLastStatement: LoyaltyReadCoverageSchema,
});

/**
 * The extracted fields shown on one membership line: the newest reads row (received date, then id)
 * in state `applied`, `applied_by_hand`, `stale` or `no_balance` for that membership whose arrays are
 * not both empty. Never a `pending` row.
 */
export const LoyaltyReadFromMailSchema = z
  .strictObject({
    membershipId: LoyaltyIdSchema,
    receivedOn: calendarDate,
    expiryWarnings: z.array(LoyaltyReadExpiryWarningSchema).max(LOYALTY_READ_EXPIRY_MAX),
    instruments: z.array(LoyaltyReadInstrumentSchema).max(LOYALTY_READ_INSTRUMENT_MAX),
  })
  .refine((f) => f.expiryWarnings.length > 0 || f.instruments.length > 0, {
    message: 'a row with nothing extracted is not listed',
    path: ['expiryWarnings'],
  });

/** The last read run, from `loyalty_inbox_read_state`. `errorCode` set exactly when `outcome` is `error`. */
export const LoyaltyReadLastReadSchema = z
  .strictObject({
    on: calendarDate,
    outcome: z.enum(['ok', 'error']),
    errorCode: LoyaltyReadRunErrorCodeSchema.nullable(),
  })
  .refine((r) => (r.errorCode !== null) === (r.outcome === 'error'), {
    message: 'errorCode is set exactly when the outcome is error',
    path: ['errorCode'],
  });

/**
 * THE OVERVIEW'S READING PANEL (`inboxRead`, P8-42c2). Every count is computed in Postgres.
 *
 *   readable            — whether `ANTHROPIC_API_KEY` is set (trimmed, non-blank). Never the key.
 *   lastRead            — null = never read ("Not read yet").
 *   waiting             — retained stored messages with bytes that are unread or in `retry`.
 *   failed              — retained reads rows in state `failed`, plus `retry` rows whose stored
 *                         message bytes are gone (message row deleted or `raw_mail` null).
 *   needsAttentionTotal — every `pending` row.
 *   needsAttention      — at most `LOYALTY_READ_QUEUE_LIMIT` of them, newest received date first,
 *                         then id descending (ordered here, so an unordered list is refused).
 *   coverage            — one entry per program that has a sender domain (the producer's duty: the
 *                         same programs as `inbox.senderDomains`; not cross-checked here).
 *   fromMail            — at most one entry per membership.
 *   screenshotDue       — (P8-42d) the ids of the memberships that need a balance from a screenshot,
 *                         strictly ascending, so each membership appears once however many sender
 *                         domains its program has. `[]` when nobody is due, never null or absent.
 *                         DERIVED on every read, never stored, in the same snapshot as the rest of the
 *                         panel, with every day count computed by Postgres from CURRENT_DATE (no JS
 *                         clock). Let T be `LOYALTY_INBOX_SILENCE_DAYS` (no new constant). "The inbox is
 *                         bringing balances for program P" exactly when all three hold: P has at least
 *                         one sender domain; P's `balanceInLastStatement` in `coverage` is `yes`; and
 *                         the greatest `last_seen_on` over P's domains is not null and at most T days
 *                         before CURRENT_DATE. A membership of P is due exactly when the inbox is not
 *                         bringing balances for P AND either it has no observation or CURRENT_DATE
 *                         minus its current observation's as-of is STRICTLY greater than T. Exactly T
 *                         days old is not due; a future-dated current observation is not due. "Current"
 *                         is the shared reducer's choice (greatest as-of, then recorded time, then id),
 *                         so an older screenshot recorded later does not clear a due membership. Why:
 *                         a program the inbox serves is never nagged (forwarding health covers it),
 *                         while one whose newest statement had no balance, or whose mail went quiet,
 *                         is; a membership with no reading is due because "—" is what the person wants
 *                         gone. Identical for every viewer.
 *
 * Strict at every depth: no key can hold a subject, a body, the text sent to the model, a URL, an
 * address, a full member number, a key or the model's output. Identical for every viewer.
 */
export const LoyaltyInboxReadPanelSchema = z
  .strictObject({
    readable: z.boolean(),
    lastRead: LoyaltyReadLastReadSchema.nullable(),
    waiting: InboxCountSchema,
    failed: InboxCountSchema,
    needsAttentionTotal: InboxCountSchema,
    needsAttention: z.array(LoyaltyReadItemSchema).max(LOYALTY_READ_QUEUE_LIMIT),
    coverage: z.array(LoyaltyReadCoverageEntrySchema),
    fromMail: z.array(LoyaltyReadFromMailSchema),
    screenshotDue: z.array(LoyaltyIdSchema),
  })
  .refine((p) => p.needsAttention.length <= p.needsAttentionTotal, {
    message: 'the listed items exceed the total',
    path: ['needsAttentionTotal'],
  })
  // Strictly ascending, so a membership can never appear twice (P8-42d, D3). Placed mid-chain so
  // the existing chain's closing line is untouched.
  .refine((p) => p.screenshotDue.every((id, k, a) => k === 0 || a[k - 1] < id), {
    message: 'screenshotDue is strictly ascending with no repeat',
    path: ['screenshotDue'],
  })
  .refine(
    (p) =>
      p.needsAttention.every((it, k, a) => {
        if (k === 0) return true;
        const prev = a[k - 1];
        return prev.receivedOn > it.receivedOn || (prev.receivedOn === it.receivedOn && prev.id > it.id);
      }),
    { message: 'items are newest received first, then id descending', path: ['needsAttention'] }
  )
  .refine((p) => new Set(p.coverage.map((c) => c.programId)).size === p.coverage.length, {
    message: 'a program appears twice in coverage',
    path: ['coverage'],
  })
  .refine((p) => new Set(p.fromMail.map((f) => f.membershipId)).size === p.fromMail.length, {
    message: 'a membership appears twice in fromMail',
    path: ['fromMail'],
  });

/**
 * `POST /api/v1/loyalty/inbox/read` (P8-42c2). HTTP 200 for all four outcomes.
 *
 *   read      — messages read in this run: `applied + queued + stale + noBalance + discarded`
 *               (refined below).
 *   applied   — auto-applied (`applied`).        queued    — newly `pending`.
 *   stale     — `stale`.                          noBalance — `no_balance`.
 *   discarded — `not_mine_known`.
 *   failed    — messages whose attempt failed in this run (left `retry` or `failed`).
 *   remaining — messages still unread after the run (unread or `retry`, with bytes).
 *   errorCode — set exactly when `outcome` is `error`.
 *
 * `disabled` and `already_running` ran nothing, so every count is zero. Strict: no subject, body,
 * text, raw byte, balance, suffix or library text.
 */
export const LoyaltyInboxReadRunSchema = z
  .strictObject({
    outcome: LoyaltyReadOutcomeSchema,
    read: InboxCountSchema,
    applied: InboxCountSchema,
    queued: InboxCountSchema,
    stale: InboxCountSchema,
    noBalance: InboxCountSchema,
    discarded: InboxCountSchema,
    failed: InboxCountSchema,
    remaining: InboxCountSchema,
    errorCode: LoyaltyReadRunErrorCodeSchema.nullable(),
  })
  .refine((r) => r.read === r.applied + r.queued + r.stale + r.noBalance + r.discarded, {
    message: 'read is the sum of applied, queued, stale, noBalance and discarded',
    path: ['read'],
  })
  .refine((r) => (r.errorCode !== null) === (r.outcome === 'error'), {
    message: 'errorCode is set exactly when the outcome is error',
    path: ['errorCode'],
  })
  .refine(
    (r) =>
      (r.outcome !== 'disabled' && r.outcome !== 'already_running') ||
      [r.read, r.applied, r.queued, r.stale, r.noBalance, r.discarded, r.failed, r.remaining].every((n) => n === 0),
    { message: 'a run that did not run has zero counts', path: ['outcome'] }
  );

/** `POST /api/v1/loyalty/inbox/readings/[id]` (P8-42c2): the item and the state the action set. */
export const LoyaltyInboxResolveSchema = z.strictObject({
  id: LoyaltyIdSchema,
  state: LoyaltyReadStateSchema.extract(['applied_by_hand', 'not_mine', 'ignored']),
});

// ─── Reading a screenshot (P8-42d) ──────────────────────────────────────────────────────────────
//
// One screenshot of a program's app is read by Claude as a PROPOSAL for one membership, shown in a
// form, and saved only when the person taps confirm. The image is read and discarded within the
// read request: no table, file, cache, log or payload holds it, and there is no stored proposal, so
// the confirm route is stateless. Nothing here needs a migration: `loyalty_observations.source`
// already allows `screenshot`.

/**
 * What a screenshot read did. All three are HTTP 200; the form is usable by hand after each.
 *   read     — the model answered and the clean pass ran. The data fields may all be null (nothing
 *              could be read), which is a reading, not an error.
 *   disabled — no `ANTHROPIC_API_KEY`; nothing was sent.
 *   error    — the call failed; `errorCode` says how. No library or model text accompanies it.
 */
export const LOYALTY_SCREENSHOT_OUTCOMES = ['read', 'disabled', 'error'] as const;
export const LoyaltyScreenshotOutcomeSchema = z.enum(LOYALTY_SCREENSHOT_OUTCOMES);

/**
 * `POST /api/v1/loyalty/memberships/[id]/screenshot` — the read answer. Writes nothing.
 *
 *   balance, unit — the cleaned reading, canonical text for the unit, null together. Null means the
 *                   screenshot showed no usable figure (never rounded, never defaulted to zero); a
 *                   read zero is a canonical zero for the unit and is a reading.
 *   asOf          — the date the screenshot states, or null (the form then offers the device's day).
 *   maskedSuffix  — the suffix the SCREENSHOT printed, masked (four bullets plus 3 or 4 characters),
 *                   never the membership's stored number and never the full printed number.
 *   programCheck, suffixCheck, unitCheck — comparisons with the membership the read was started
 *                   from. `not_stated` means "could not compare" (nothing printed, or nothing stored
 *                   to compare with) and is neither a match nor a warning. A `mismatch` WARNS and
 *                   never blocks: the person chose the membership and can see the screenshot, and
 *                   the confirm route has no stored read to block against.
 *   expiryWarnings, instruments — shown as information only; confirm stores neither.
 *
 * The refinements make a contradictory answer unparseable: a code exactly on `error`; balance and
 * unit together; a non-canonical balance; any data, or any check other than `not_stated`, on
 * `disabled` or `error`; a unit comparison with no unit; a suffix comparison with no suffix. Strict
 * at every depth, so no key can carry a name, a full member number, the image or the model's text.
 */
export const LoyaltyScreenshotReadSchema = z
  .strictObject({
    outcome: LoyaltyScreenshotOutcomeSchema,
    errorCode: LoyaltyReadErrorCodeSchema.nullable(),
    balance: z.string().nullable(),
    unit: LoyaltyUnitSchema.nullable(),
    asOf: calendarDate.nullable(),
    maskedSuffix: LoyaltyReadMaskedSuffixSchema.nullable(),
    programCheck: LoyaltyReadProgramCheckSchema,
    suffixCheck: LoyaltyReadProgramCheckSchema,
    unitCheck: LoyaltyReadProgramCheckSchema,
    expiryWarnings: z.array(LoyaltyReadExpiryWarningSchema).max(LOYALTY_READ_EXPIRY_MAX),
    instruments: z.array(LoyaltyReadInstrumentSchema).max(LOYALTY_READ_INSTRUMENT_MAX),
  })
  .refine((r) => (r.errorCode !== null) === (r.outcome === 'error'), {
    message: 'errorCode is set exactly when the outcome is error',
    path: ['errorCode'],
  })
  .refine((r) => (r.balance === null) === (r.unit === null), {
    message: 'balance and unit are null together or present together',
    path: ['balance'],
  })
  .refine((r) => r.balance === null || r.unit === null || isCanonicalForUnit(r.unit, r.balance), {
    message: 'the balance is not in the canonical form for its unit',
    path: ['balance'],
  })
  .refine(
    (r) =>
      r.outcome === 'read' ||
      (r.balance === null &&
        r.unit === null &&
        r.asOf === null &&
        r.maskedSuffix === null &&
        r.expiryWarnings.length === 0 &&
        r.instruments.length === 0 &&
        r.programCheck === 'not_stated' &&
        r.suffixCheck === 'not_stated' &&
        r.unitCheck === 'not_stated'),
    { message: 'a disabled or failed read carries no data and no comparison', path: ['outcome'] }
  )
  .refine((r) => r.unitCheck === 'not_stated' || r.unit !== null, {
    message: 'a unit comparison needs a unit',
    path: ['unitCheck'],
  })
  .refine((r) => r.suffixCheck === 'not_stated' || r.maskedSuffix !== null, {
    message: 'a suffix comparison needs a suffix',
    path: ['suffixCheck'],
  });

/**
 * `POST /api/v1/loyalty/memberships/[id]/screenshot/confirm` — appends one observation whose source
 * the HANDLER sets to `screenshot`; answers `LoyaltyMembershipResponseSchema` (201).
 *
 * There is deliberately no `source` key, and the strict object refuses one of any value: a client
 * never chooses provenance, and the typed route keeps refusing `screenshot`. The balance rule is the
 * typed path's (`isBalanceForUnit`); the as-of limit (more than one day after Postgres's CURRENT_DATE
 * is 400) is the handler's, as on the typed path. Whether the new row becomes current is the shared
 * reducer's existing rule: an as-of greater than or equal to the current one's wins (a tie goes to
 * the later recorded row), a strictly older one is recorded but not current. Error messages never
 * echo the submitted value.
 */
export const LoyaltyScreenshotConfirmRequestSchema = z
  .strictObject({
    asOf: calendarDate,
    balance: LoyaltyBalanceInputSchema,
    unit: LoyaltyUnitSchema,
  })
  .refine((b) => isBalanceForUnit(b.unit, b.balance), {
    message: 'the balance is not valid for its unit',
    path: ['balance'],
  });

/**
 * `GET /api/v1/loyalty` — the whole picture, masked numbers only.
 *
 *   members     — every household member, by display name then id.
 *   programs    — the whole catalog with aliases, by name then id.
 *   cards       — one per program with at least one membership, by program name then id.
 *   instruments — unused before used, then expiry ascending with null expiry last, then id
 *                 ascending (the page's order, decided by the server).
 *   cardAccounts — every account whose type is `credit`, linked or not, by name then id: the
 *                 choices for "Link a card". Never an account of another type.
 *   inbox       — the loyalty inbox panel (P8-42c1, `LoyaltyInboxSchema`). Required. Identical for
 *                 every viewer; it reads no ledger row.
 *   inboxRead   — the reading panel (P8-42c2, `LoyaltyInboxReadPanelSchema`). Required. Identical
 *                 for every viewer; it reads no ledger row.
 */
export const LoyaltyOverviewSchema = z.strictObject({
  members: z.array(LoyaltyMemberSchema),
  programs: z.array(LoyaltyProgramSchema),
  cards: z.array(LoyaltyProgramCardSchema),
  instruments: z.array(LoyaltyInstrumentSchema),
  cardAccounts: z.array(LoyaltyCardAccountSchema),
  inbox: LoyaltyInboxSchema,
  inboxRead: LoyaltyInboxReadPanelSchema,
});

/**
 * THE FULL MEMBER NUMBER — `GET /api/v1/loyalty/memberships/[id]/member-number` only, to a `browser`
 * session only, fetched by the copy action on click and never on page load. `memberNumber` is null
 * when none is stored. No other schema in this file has a field that can hold the full value.
 */
export const LoyaltyMemberNumberSchema = z.strictObject({
  membershipId: LoyaltyIdSchema,
  memberNumber: z.string().min(1).nullable(),
});

export const LoyaltyOverviewResponseSchema = apiResponseSchema(LoyaltyOverviewSchema);
/** `POST …/members`, `PATCH …/members/[id]`. */
export const LoyaltyMemberResponseSchema = apiResponseSchema(LoyaltyMemberSchema);
/** `POST …/programs`, `PATCH …/programs/[id]`. */
export const LoyaltyProgramResponseSchema = apiResponseSchema(LoyaltyProgramSchema);
/** `POST …/memberships`, `PATCH …/memberships/[id]`, and `POST …/memberships/[id]/observations` (the refreshed view). */
export const LoyaltyMembershipResponseSchema = apiResponseSchema(LoyaltyMembershipSchema);
/** `GET …/memberships/[id]/member-number`. */
export const LoyaltyMemberNumberResponseSchema = apiResponseSchema(LoyaltyMemberNumberSchema);
/** `POST …/instruments`, `PATCH …/instruments/[id]`. */
export const LoyaltyInstrumentResponseSchema = apiResponseSchema(LoyaltyInstrumentSchema);
/** `POST …/inbox/poll`. */
export const LoyaltyInboxPollResponseSchema = apiResponseSchema(LoyaltyInboxPollSchema);
/** `POST …/inbox/read`. */
export const LoyaltyInboxReadResponseSchema = apiResponseSchema(LoyaltyInboxReadRunSchema);
/** `POST …/inbox/readings/[id]`. */
export const LoyaltyInboxResolveResponseSchema = apiResponseSchema(LoyaltyInboxResolveSchema);
/** `POST …/memberships/[id]/screenshot`. The confirm route answers `LoyaltyMembershipResponseSchema`. */
export const LoyaltyScreenshotReadResponseSchema = apiResponseSchema(LoyaltyScreenshotReadSchema);

export type LoyaltyUnit = z.infer<typeof LoyaltyUnitSchema>;
export type LoyaltyProgramKind = z.infer<typeof LoyaltyProgramKindSchema>;
export type LoyaltyInstrumentKind = z.infer<typeof LoyaltyInstrumentKindSchema>;
export type LoyaltyObservationSource = z.infer<typeof LoyaltyObservationSourceSchema>;
export type LoyaltyInstrumentSource = z.infer<typeof LoyaltyInstrumentSourceSchema>;
export type LoyaltyErrorCode = z.infer<typeof LoyaltyErrorCodeSchema>;
export type LoyaltyFeeWatchState = z.infer<typeof LoyaltyFeeWatchStateSchema>;
export type LoyaltyBenefitInput = z.infer<typeof LoyaltyBenefitInputSchema>;
export type LoyaltyBenefit = z.infer<typeof LoyaltyBenefitSchema>;
export type LoyaltyFeeWatch = z.infer<typeof LoyaltyFeeWatchSchema>;
export type LoyaltyCardAccount = z.infer<typeof LoyaltyCardAccountSchema>;
export type LoyaltyEarnMatchKind = z.infer<typeof LoyaltyEarnMatchKindSchema>;
export type LoyaltyEarnBasis = z.infer<typeof LoyaltyEarnBasisSchema>;
export type LoyaltyEarnUnit = z.infer<typeof LoyaltyEarnUnitSchema>;
export type LoyaltyEarnRuleInput = z.infer<typeof LoyaltyEarnRuleInputSchema>;
export type LoyaltyEarnInput = z.infer<typeof LoyaltyEarnInputSchema>;
export type LoyaltyEarnRule = z.infer<typeof LoyaltyEarnRuleSchema>;
export type LoyaltyEarn = z.infer<typeof LoyaltyEarnSchema>;
export type LoyaltyEarnEstimate = z.infer<typeof LoyaltyEarnEstimateSchema>;
export type LoyaltyEarnComparison = z.infer<typeof LoyaltyEarnComparisonSchema>;
export type LoyaltyMemberCreateRequest = z.infer<typeof LoyaltyMemberCreateRequestSchema>;
export type LoyaltyMemberPatchRequest = z.infer<typeof LoyaltyMemberPatchRequestSchema>;
export type LoyaltyProgramCreateRequest = z.infer<typeof LoyaltyProgramCreateRequestSchema>;
export type LoyaltyProgramPatchRequest = z.infer<typeof LoyaltyProgramPatchRequestSchema>;
export type LoyaltyMembershipCreateRequest = z.infer<typeof LoyaltyMembershipCreateRequestSchema>;
export type LoyaltyMembershipPatchRequest = z.infer<typeof LoyaltyMembershipPatchRequestSchema>;
export type LoyaltyObservationCreateRequest = z.infer<typeof LoyaltyObservationCreateRequestSchema>;
export type LoyaltyInstrumentCreateRequest = z.infer<typeof LoyaltyInstrumentCreateRequestSchema>;
export type LoyaltyInstrumentPatchRequest = z.infer<typeof LoyaltyInstrumentPatchRequestSchema>;
export type LoyaltyMember = z.infer<typeof LoyaltyMemberSchema>;
export type LoyaltyProgram = z.infer<typeof LoyaltyProgramSchema>;
export type LoyaltyMembership = z.infer<typeof LoyaltyMembershipSchema>;
export type LoyaltyProgramCard = z.infer<typeof LoyaltyProgramCardSchema>;
export type LoyaltyInstrument = z.infer<typeof LoyaltyInstrumentSchema>;
export type LoyaltyOverview = z.infer<typeof LoyaltyOverviewSchema>;
export type LoyaltyMemberNumber = z.infer<typeof LoyaltyMemberNumberSchema>;
export type LoyaltyInboxOrigin = z.infer<typeof LoyaltyInboxOriginSchema>;
export type LoyaltyInboxAttribution = z.infer<typeof LoyaltyInboxAttributionSchema>;
export type LoyaltyInboxPollErrorCode = z.infer<typeof LoyaltyInboxPollErrorCodeSchema>;
export type LoyaltyInboxPollOutcome = z.infer<typeof LoyaltyInboxPollOutcomeSchema>;
export type LoyaltyInboxConfigProblem = z.infer<typeof LoyaltyInboxConfigProblemSchema>;
export type LoyaltyInboxRequiredEnv = z.infer<typeof LoyaltyInboxRequiredEnvSchema>;
export type LoyaltyInboxForwardingState = z.infer<typeof LoyaltyInboxForwardingStateSchema>;
export type LoyaltyInboxLastCheck = z.infer<typeof LoyaltyInboxLastCheckSchema>;
export type LoyaltyInboxSenderDomains = z.infer<typeof LoyaltyInboxSenderDomainsSchema>;
export type LoyaltyInboxCoverage = z.infer<typeof LoyaltyInboxCoverageSchema>;
export type LoyaltyInboxForwarding = z.infer<typeof LoyaltyInboxForwardingSchema>;
export type LoyaltyInboxUnknownSender = z.infer<typeof LoyaltyInboxUnknownSenderSchema>;
export type LoyaltyInbox = z.infer<typeof LoyaltyInboxSchema>;
export type LoyaltyInboxPoll = z.infer<typeof LoyaltyInboxPollSchema>;
export type LoyaltyReadState = z.infer<typeof LoyaltyReadStateSchema>;
export type LoyaltyReadReason = z.infer<typeof LoyaltyReadReasonSchema>;
export type LoyaltyReadErrorCode = z.infer<typeof LoyaltyReadErrorCodeSchema>;
export type LoyaltyReadRunErrorCode = z.infer<typeof LoyaltyReadRunErrorCodeSchema>;
export type LoyaltyReadOutcome = z.infer<typeof LoyaltyReadOutcomeSchema>;
export type LoyaltyReadAction = z.infer<typeof LoyaltyReadActionSchema>;
export type LoyaltyReadExpiryKind = z.infer<typeof LoyaltyReadExpiryKindSchema>;
export type LoyaltyReadProgramCheck = z.infer<typeof LoyaltyReadProgramCheckSchema>;
export type LoyaltyReadCoverage = z.infer<typeof LoyaltyReadCoverageSchema>;
export type LoyaltyReadExpiryWarning = z.infer<typeof LoyaltyReadExpiryWarningSchema>;
export type LoyaltyReadInstrument = z.infer<typeof LoyaltyReadInstrumentSchema>;
export type LoyaltyReadItem = z.infer<typeof LoyaltyReadItemSchema>;
export type LoyaltyReadCoverageEntry = z.infer<typeof LoyaltyReadCoverageEntrySchema>;
export type LoyaltyReadFromMail = z.infer<typeof LoyaltyReadFromMailSchema>;
export type LoyaltyReadLastRead = z.infer<typeof LoyaltyReadLastReadSchema>;
export type LoyaltyInboxReadPanel = z.infer<typeof LoyaltyInboxReadPanelSchema>;
export type LoyaltyInboxReadRequest = z.infer<typeof LoyaltyInboxReadRequestSchema>;
export type LoyaltyInboxReadRun = z.infer<typeof LoyaltyInboxReadRunSchema>;
export type LoyaltyInboxResolveRequest = z.infer<typeof LoyaltyInboxResolveRequestSchema>;
export type LoyaltyInboxResolve = z.infer<typeof LoyaltyInboxResolveSchema>;
export type LoyaltyScreenshotOutcome = z.infer<typeof LoyaltyScreenshotOutcomeSchema>;
export type LoyaltyScreenshotRead = z.infer<typeof LoyaltyScreenshotReadSchema>;
export type LoyaltyScreenshotConfirmRequest = z.infer<typeof LoyaltyScreenshotConfirmRequestSchema>;
