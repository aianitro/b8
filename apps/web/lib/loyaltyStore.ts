// Loyalty (P8-42a) — every statement the `/travel` page and the eleven loyalty routes make against
// the six loyalty tables. The decisions are `lib/domain/loyalty.ts`'s (the mask, the balance rule,
// the label rule, the current balance, the instrument order); this file reads rows, asks those
// functions, and performs what they decided.
//
// ─── THE LEDGER IS NOT READ HERE ──────────────────────────────────────────────────────────────
//
// Nothing here writes the ledger's transactions, accounts or valuations, and nothing reads them
// except the two narrow reads below. Loyalty balances are not money in the ledger's sense and are
// never summed into any figure.
//
// ─── THE CARD AND ITS ANNUAL FEE (P8-42b) ─────────────────────────────────────────────────────
//
// `loyalty_memberships.card_account_id` links the credit card that earns into a membership. Two
// ledger reads follow from it, and only these two:
//
//   - `accounts`, for the linked card's name and for the link picker's choices (type `credit` only).
//     Neither is row text a gift could hold.
//   - the card's annual-fee row, through the gift read path (`visibleTransactions`), never the table
//     itself. The fee is FOUND on every read and never stored: its posted date, the expected-by date
//     and the state are derived in one statement from the ledger, the instruments and Postgres's
//     CURRENT_DATE (`feeWatchesOf`). The fee AMOUNT is compared in SQL to pair a refund with its fee
//     and is never selected out of the database, so no code path here can emit or log it.
//
// ─── TEXT IN, TEXT OUT ────────────────────────────────────────────────────────────────────────
//
// A balance is selected as balance::text and a calendar date as ::text, never as a NUMERIC that
// node-postgres would hand over as a string anyway nor as a DATE it would turn into a JS Date at
// the server's local midnight — one time-zone shift away from the wrong day. The per-unit scale
// CHECK means balance::text is already the canonical spelling the contract emits.
//
// ─── THE FULL MEMBER NUMBER ───────────────────────────────────────────────────────────────────
//
// Every read here masks the number in SQL's result before it leaves this file, through
// `maskMemberNumber`, except `memberNumberOf`, which serves the one copy route. Log lines carry a
// fixed message, a count and at most an error CODE — never a number, a name, a label or a balance —
// so an operator can see that writes happen without the log becoming a copy of the data.
//
// ─── THE EARN DESCRIPTION AND ITS FIGURES (P8-42b2) ───────────────────────────────────────────
//
// A third ledger read follows from the link: the card's spend, priced by the membership's earn
// rules, for the estimate and the comparison. It lives in `loyaltyEarn.ts`, through the same gift
// read path and as the same viewer `null` as the fee watch, and only the rounded, priced total
// leaves the database — never a row, a name or an amount. The description is configuration and is
// written here only through `replaceEarn`, inside the membership PATCH's one transaction.
//
// ─── APPEND-ONLY OBSERVATIONS ─────────────────────────────────────────────────────────────────
//
// `addObservation` INSERTs. There is no statement here, or anywhere in loyalty code, that updates or
// deletes an observation: a corrected balance is a newer reading, and the current balance is derived
// from all of them by the shared reducer.
//
// ─── THE LOYALTY INBOX (P8-42c1) ──────────────────────────────────────────────────────────────
//
// The overview's `inbox` panel, the program PATCH's `senderDomains` and the member PATCH's
// `forwardingAddresses` are written here; everything that touches the collected mail itself, its
// bytes above all, is `loyaltyInbox.ts`'s (`loadInboxOverview`, `reattributeInbox`). Both lists are
// replaced whole inside the PATCH's one transaction, and the UNIQUE constraints decide a taken
// domain or address (409), so a lost race is the same 409 and never a 500. An entry that stays in a
// list keeps its row, and with it `last_seen_on`, `added_on` and `last_received_on`.
//
// ─── READING THE INBOX (P8-42c2) ──────────────────────────────────────────────────────────────
//
// The overview's `inboxRead` panel is `loyaltyInboxRead.ts`'s (`loadReadOverview`), like the inbox
// panel is `loyaltyInbox.ts`'s: it counts stored mail by its bytes, which only those two files name.
// An observation a reading appends has source `email` and is written there, beside its reads row in
// one transaction; `addObservation` below still writes `typed` only.

import type { PoolClient, QueryResult, QueryResultRow } from 'pg';
import db from './db';
import { createLogger } from './logger';
import { visibleTransactions } from './giftReadPath';
import { earnDescriptionsOf, earnFiguresOf, replaceEarn } from './loyaltyEarn';
import { loadInboxOverview, reattributeInbox } from './loyaltyInbox';
import { loadReadOverview } from './loyaltyInboxRead';
import { storedForwardingAddress, storedSenderDomain } from './domain/loyaltyInbox';
import {
  currentObservationByMembership,
  maskMemberNumber,
  normalizeLabel,
  parseBalance,
  sortInstruments,
} from './domain/loyalty';
import { LOYALTY_BENEFIT_DEFAULT_WINDOW_DAYS } from '@b8/contracts/loyalty';
import type {
  LoyaltyBenefit,
  LoyaltyCardAccount,
  LoyaltyEarn,
  LoyaltyErrorCode,
  LoyaltyFeeWatch,
  LoyaltyFeeWatchState,
  LoyaltyInstrument,
  LoyaltyInstrumentCreateRequest,
  LoyaltyInstrumentKind,
  LoyaltyInstrumentPatchRequest,
  LoyaltyInstrumentSource,
  LoyaltyMember,
  LoyaltyMemberCreateRequest,
  LoyaltyMemberNumber,
  LoyaltyMemberPatchRequest,
  LoyaltyMembership,
  LoyaltyMembershipCreateRequest,
  LoyaltyMembershipPatchRequest,
  LoyaltyObservationCreateRequest,
  LoyaltyObservationSource,
  LoyaltyOverview,
  LoyaltyProgram,
  LoyaltyProgramCard,
  LoyaltyProgramCreateRequest,
  LoyaltyProgramKind,
  LoyaltyProgramPatchRequest,
  LoyaltyUnit,
} from '@b8/contracts/loyalty';

/** Anything that runs a query: the pool, or one client inside a transaction. */
export type Queryable = {
  query<R extends QueryResultRow = QueryResultRow>(text: string, values?: unknown[]): Promise<QueryResult<R>>;
};

/** A refusal a route turns into a response. Codes are the contract's; messages never echo input. */
export type LoyaltyFailure = { ok: false; code: LoyaltyErrorCode; message?: string };
export type LoyaltyResult<T> = { ok: true; value: T } | LoyaltyFailure;

const log = createLogger('loyalty');

const fail = (code: LoyaltyErrorCode, message?: string): LoyaltyFailure => {
  log.warn('loyalty request refused', { code });
  return { ok: false, code, message };
};
const notFound = (): LoyaltyFailure => fail('NOT_FOUND');

/**
 * A database refusal, translated by SQLSTATE and constraint name rather than by message text. The
 * unique constraints decide the 409s — not a prior SELECT, which two concurrent requests could both
 * pass — so a lost race is the same 409 as a plain duplicate and never a 500. A CHECK or foreign-key
 * violation is the request's fault (400). Anything else is rethrown: a real fault stays a 500.
 */
function fromPgError(err: unknown): LoyaltyFailure {
  const e = err as { code?: string; constraint?: string };
  if (e?.code === '23505') {
    switch (e.constraint) {
      case 'loyalty_memberships_member_program_key': return fail('MEMBERSHIP_EXISTS');
      case 'loyalty_program_aliases_alias_key': return fail('ALIAS_TAKEN');
      case 'household_members_display_name_ci': return fail('MEMBER_NAME_TAKEN');
      case 'household_members_user_id_key': return fail('MEMBER_USER_TAKEN');
      case 'loyalty_memberships_one_per_card': return fail('CARD_ALREADY_LINKED');
      // P8-42c1: a domain or address is unique across the whole table, so another program or member
      // holding it is this constraint, inside the replace's transaction (nothing changed).
      case 'loyalty_sender_domains_domain_key': return fail('DOMAIN_TAKEN');
      case 'household_member_addresses_address_key': return fail('ADDRESS_TAKEN');
      // Positions are written one to n inside one transaction, so this cannot happen on a body the
      // contract accepted; if it ever does it is the request's 400, never a 500.
      case 'loyalty_earn_rules_membership_position_key': return fail('INVALID_INPUT');
    }
  }
  if (e?.code === '23503') return fail('INVALID_INPUT', 'A referenced member, program, membership or user does not exist.');
  if (e?.code === '23514') return fail('INVALID_INPUT', 'A value is outside what this field allows.');
  throw err;
}

/** Runs `work` in one transaction on one client; any throw rolls it back. */
async function inTransaction<T>(work: (client: PoolClient) => Promise<T>): Promise<T> {
  const client = await db.connect();
  try {
    await client.query('BEGIN');
    const result = await work(client);
    await client.query('COMMIT');
    return result;
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}

/** A submitted member number as stored: trimmed, and blank or null both mean NULL, never ''. */
const storedNumber = (value: string | null | undefined) => {
  if (value === null || value === undefined) return null;
  const t = value.trim();
  return t === '' ? null : t;
};

/** A submitted typed name as stored: trimmed (the schema has already refused a blank one). */
const storedText = (value: string | null | undefined) => (value === null || value === undefined ? null : value.trim());

// ─── Reading ───────────────────────────────────────────────────────────────────────────────────

interface MembershipRow {
  id: number;
  member_id: number;
  member_display_name: string;
  program_id: number;
  member_number: string | null;
  tier: string | null;
  card_account_id: string | null;
  card_account_name: string | null;
  benefit_kind: LoyaltyInstrumentKind | null;
  benefit_description: string | null;
  benefit_window_days: number | null;
  program_default_unit: LoyaltyUnit;
}

export interface ObservationRow {
  membershipId: number;
  id: number;
  asOf: string;
  recordedAt: string;
  balance: string;
  unit: LoyaltyUnit;
  source: LoyaltyObservationSource;
}

/**
 * Observations of the given memberships (all of them when `ids` is null). recorded_at is rendered
 * as fixed-width UTC text so the shared comparator orders it as a string (see `DatedObservation`).
 */
async function observationsOf(q: Queryable, ids: number[] | null): Promise<ObservationRow[]> {
  const r = await q.query<ObservationRow>(
    `SELECT membership_id AS "membershipId", id, as_of::text AS "asOf",
            to_char(recorded_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US') AS "recordedAt",
            balance::text AS balance, unit, source
       FROM loyalty_observations
      WHERE $1::int[] IS NULL OR membership_id = ANY($1::int[])`,
    [ids]
  );
  return r.rows;
}

// ─── The fee watch (P8-42b) ────────────────────────────────────────────────────────────────────
//
// THE RULE, stated once, in SQL, because every comparison in it is one Postgres must make: the
// amounts are NUMERIC(12,2) compared by exact decimal equality (a JS number or a text comparison would
// make a trailing zero a question of formatting), and the dates are calendar dates compared with CURRENT_DATE (a JS
// clock would make the state depend on the server's zone).
//
// A FEE ROW is a row on the linked account with amount > 0 (money out: a card charge is positive in
// this ledger, so nothing is negated here), no transfer group, not held by an unrevealed gift, whose
// NAME — case-folded, every run of whitespace collapsed to one space — holds `annual membership fee`
// or `annual fee` as whole words. Only `name` is read: a card with no Plaid feed has nothing else,
// and the category cannot decide (the real fee carries the same detailed category as a foreign
// transaction fee, and none at all on some rows). Whole words, so `biannual fee` and `annual fees`
// are not fees.
//
// A REFUND is a row on the same account whose amount is exactly the fee's negated, posted on or
// after it, named with a fee phrase or `refund`, `reversal` or `reversed`. It cancels ONE fee: the
// most recent fee row of that amount on or before the refund's date. A card payment that happens to
// equal the fee is not named that way and cancels nothing.
//
// THE FEE is the single most recent fee row — greatest posted date, then greatest id, never arrival
// order — and only if no refund cancels it. A cancelled latest fee means no fee: last year's is not
// resurrected, which would raise a false overdue. The POSTED date, never the authorized one, which
// a hand-entered row and a masked row do not have.
//
// HELD ROWS ARE NEVER FEES, FOR ANY VIEWER. The rows are read as the viewer `null` — who masks every
// unrevealed gift — and `gift_masked` rows are excluded outright. Reading as the signed-in person
// would let the giver, who sees the real row, get a fee date the recipient does not: a derived
// answer that differs by viewer, which the gift rules forbid. So the answer is the same for both
// users and every token, and the surfaces carrying it are `numeric-only`.
//
// THE STATE, with F the fee date, E = F + the window, T = CURRENT_DATE: no fee is `no_fee_seen`; an
// instrument of the benefit's kind on THIS membership issued on or after F (or, with no issue date,
// recorded on or after F — `created_at` as a date in the session's zone) is `received`, which wins
// over overdue; T <= E is `awaiting` (E itself is still awaiting); otherwise `overdue`. Matching
// instruments are tested with EXISTS, never joined, so two of them cannot repeat a membership.

/** Whole-word fee phrases in a case-folded, whitespace-collapsed name. POSIX classes, no backslashes. */
const FEE_WORDS = `'(^|[^[:alnum:]])annual (membership )?fee($|[^[:alnum:]])'`;
const REFUND_WORDS = `'(^|[^[:alnum:]])(annual (membership )?fee|refund|reversal|reversed)($|[^[:alnum:]])'`;
const FOLDED_NAME = `regexp_replace(lower(coalesce(t.name, '')), '[[:space:]]+', ' ', 'g')`;

const FEE_WATCH_SQL = `
  WITH linked AS (
    SELECT id, card_account_id, benefit_kind, benefit_window_days
      FROM loyalty_memberships
     WHERE card_account_id IS NOT NULL AND ($1::int[] IS NULL OR id = ANY($1::int[]))
  ),
  card_rows AS (
    SELECT t.id, t.account_id, t.date, t.amount, t.transfer_group_id, ${FOLDED_NAME} AS folded
      FROM ${visibleTransactions(null)} t
     WHERE t.account_id IN (SELECT card_account_id FROM linked) AND NOT t.gift_masked
  ),
  fees AS (
    SELECT id, account_id, date, amount FROM card_rows
     WHERE amount > 0 AND transfer_group_id IS NULL AND folded ~ ${FEE_WORDS}
  ),
  refunds AS (
    SELECT id, account_id, date, amount FROM card_rows
     WHERE amount < 0 AND folded ~ ${REFUND_WORDS}
  )
  SELECT l.id, fee.date::text AS "feeDate",
         CASE WHEN fee.date IS NULL OR l.benefit_kind IS NULL THEN NULL
              ELSE (fee.date + l.benefit_window_days)::text END AS "expectedBy",
         CASE WHEN l.benefit_kind IS NULL THEN NULL
              WHEN fee.date IS NULL THEN 'no_fee_seen'
              WHEN EXISTS (SELECT 1 FROM loyalty_instruments i
                            WHERE i.membership_id = l.id AND i.kind = l.benefit_kind
                              AND COALESCE(i.issued_on, i.created_at::date) >= fee.date) THEN 'received'
              WHEN CURRENT_DATE <= fee.date + l.benefit_window_days THEN 'awaiting'
              ELSE 'overdue' END AS state
    FROM linked l
    LEFT JOIN LATERAL (
      SELECT f.id, f.date, f.amount FROM fees f
       WHERE f.account_id = l.card_account_id
       ORDER BY f.date DESC, f.id DESC LIMIT 1
    ) latest ON TRUE
    LEFT JOIN LATERAL (
      SELECT latest.date
       WHERE latest.id IS NOT NULL
         AND NOT EXISTS (
           SELECT 1 FROM refunds r
            WHERE r.account_id = l.card_account_id AND r.amount = -latest.amount AND r.date >= latest.date
              AND (SELECT f2.id FROM fees f2
                    WHERE f2.account_id = r.account_id AND f2.amount = -r.amount AND f2.date <= r.date
                    ORDER BY f2.date DESC, f2.id DESC LIMIT 1) = latest.id)
    ) fee ON TRUE`;

/**
 * The fee watch of every LINKED membership among `ids` (all of them when null), by membership id.
 * A membership with no card is absent: its `feeWatch` is null. Reads nothing but the card's rows
 * through the read path and the membership's instruments, and writes nothing.
 */
async function feeWatchesOf(q: Queryable, ids: number[] | null): Promise<Map<number, LoyaltyFeeWatch>> {
  const r = await q.query<{ id: number; feeDate: string | null; expectedBy: string | null; state: LoyaltyFeeWatchState | null }>(
    FEE_WATCH_SQL, [ids]
  );
  return new Map(r.rows.map((w) => [w.id, { feeDate: w.feeDate, expectedBy: w.expectedBy, state: w.state }]));
}

/** The three benefit columns as the contract's object, or null when no benefit is described. */
function benefitFrom(row: MembershipRow): LoyaltyBenefit | null {
  if (row.benefit_kind === null || row.benefit_description === null || row.benefit_window_days === null) return null;
  return { kind: row.benefit_kind, description: row.benefit_description, windowDays: row.benefit_window_days };
}

/**
 * One membership as the contract shows it: masked number, current balance or four nulls, and the
 * card. `feeWatch` is null exactly when no card is linked; a linked card always has one, because
 * `feeWatchesOf` returns a row for every linked membership (all three fields null when there is no
 * benefit and no fee).
 */
function membershipFrom(
  row: MembershipRow,
  current: ObservationRow | undefined,
  watches: Map<number, LoyaltyFeeWatch>,
  earn: Earning
): LoyaltyMembership {
  const linked = row.card_account_id !== null;
  return {
    id: row.id,
    memberId: row.member_id,
    memberDisplayName: row.member_display_name,
    programId: row.program_id,
    memberNumberMasked: maskMemberNumber(row.member_number),
    tier: row.tier,
    balance: current?.balance ?? null,
    unit: current?.unit ?? null,
    asOf: current?.asOf ?? null,
    source: current?.source ?? null,
    cardAccountId: row.card_account_id,
    // An account with no stored name is still linked; '' keeps the id and the name null together.
    cardAccountName: linked ? (row.card_account_name ?? '') : null,
    benefit: benefitFrom(row),
    feeWatch: linked ? (watches.get(row.id) ?? { feeDate: null, expectedBy: null, state: null }) : null,
    earn: earn.descriptions.get(row.id) ?? null,
    earnEstimate: earn.figures.get(row.id)?.earnEstimate ?? null,
    earnComparison: earn.figures.get(row.id)?.earnComparison ?? null,
  };
}

/** The earn descriptions and the figures derived from them, for a set of membership rows. */
type Earning = { descriptions: Map<number, LoyaltyEarn>; figures: Awaited<ReturnType<typeof earnFiguresOf>> };

/**
 * The earn description and the derived figures of `rows`. `ids` scopes the description read (null:
 * every membership, for the overview). Reads only; the figures are computed afresh on every call.
 */
async function earningOf(q: Queryable, rows: MembershipRow[], ids: number[] | null, observations: ObservationRow[]): Promise<Earning> {
  const descriptions = await earnDescriptionsOf(q, ids);
  const figures = await earnFiguresOf(
    q,
    rows.map((r) => ({ id: r.id, cardAccountId: r.card_account_id, programDefaultUnit: r.program_default_unit })),
    descriptions,
    observations
  );
  return { descriptions, figures };
}

// The account is LEFT JOINed for its name alone: one account per id, so it cannot repeat a line. The
// program is joined for its default unit, the earn estimate's unit when there is no reading (one
// program per membership, by the foreign key, so it cannot repeat a line either).
const MEMBERSHIP_SELECT = `
  SELECT m.id, m.member_id, hm.display_name AS member_display_name, m.program_id, m.member_number, m.tier,
         m.card_account_id, a.name AS card_account_name,
         m.benefit_kind, m.benefit_description, m.benefit_window_days,
         p.default_unit AS program_default_unit
    FROM loyalty_memberships m
    JOIN household_members hm ON hm.id = m.member_id
    JOIN loyalty_programs p ON p.id = m.program_id
    LEFT JOIN accounts a ON a.id = m.card_account_id`;

/** The membership view for one id, or null when there is no such membership. */
export async function membershipView(id: number, q: Queryable = db): Promise<LoyaltyMembership | null> {
  const r = await q.query<MembershipRow>(`${MEMBERSHIP_SELECT} WHERE m.id = $1`, [id]);
  if (r.rows.length === 0) return null;
  const [observations, watches] = await Promise.all([observationsOf(q, [id]), feeWatchesOf(q, [id])]);
  const current = currentObservationByMembership(observations).get(id);
  const earn = await earningOf(q, r.rows, [id], observations);
  return membershipFrom(r.rows[0], current, watches, earn);
}

/**
 * What the card's own `/accounts/[id]` page says about it: the membership it earns into, with that
 * program's name, or null when no membership has linked this account (always so for an account
 * whose type is not `credit`, which can never be linked). At most one, by the unique index.
 */
export async function earningOfCard(
  accountId: string,
  q: Queryable = db
): Promise<{ programName: string; membership: LoyaltyMembership } | null> {
  const r = await q.query<{ id: number; program_name: string }>(
    `SELECT m.id, p.name AS program_name
       FROM loyalty_memberships m JOIN loyalty_programs p ON p.id = m.program_id
      WHERE m.card_account_id = $1`,
    [accountId]
  );
  if (r.rows.length === 0) return null;
  const membership = await membershipView(r.rows[0].id, q);
  return membership === null ? null : { programName: r.rows[0].program_name, membership };
}

interface InstrumentRow {
  id: number;
  membershipId: number;
  kind: LoyaltyInstrumentKind;
  description: string;
  issuedOn: string | null;
  expiresOn: string | null;
  usedOn: string | null;
  source: LoyaltyInstrumentSource;
}

const INSTRUMENT_SELECT = `
  SELECT id, membership_id AS "membershipId", kind, description, issued_on::text AS "issuedOn",
         expires_on::text AS "expiresOn", used_on::text AS "usedOn", source
    FROM loyalty_instruments`;

/**
 * The whole picture `/travel` renders and `GET /api/v1/loyalty` returns. Both users see the same
 * thing: there is no per-user filter, because the two b8 users are peers over the household's
 * loyalty accounts.
 */
export async function loadOverview(q: Queryable = db): Promise<LoyaltyOverview> {
  const [members, programs, aliases, memberships, observations, instruments, watches, cardAccounts, inbox, inboxRead] = await Promise.all([
    q.query<{ id: number; display_name: string; user_id: number | null }>(
      'SELECT id, display_name, user_id FROM household_members ORDER BY display_name, id'
    ),
    q.query<{ id: number; name: string; kind: LoyaltyProgramKind; default_unit: LoyaltyUnit }>(
      'SELECT id, name, kind, default_unit FROM loyalty_programs ORDER BY name, id'
    ),
    q.query<{ program_id: number; alias: string }>(
      'SELECT program_id, alias FROM loyalty_program_aliases ORDER BY alias, id'
    ),
    q.query<MembershipRow>(`${MEMBERSHIP_SELECT} ORDER BY hm.display_name, m.id`),
    observationsOf(q, null),
    q.query<InstrumentRow>(INSTRUMENT_SELECT),
    feeWatchesOf(q, null),
    // The link picker's choices: every credit card, linked or not. No other type can be linked.
    q.query<LoyaltyCardAccount>(
      `SELECT id, coalesce(name, '') AS name FROM accounts WHERE type = 'credit' ORDER BY name, id`
    ),
    // The inbox panel (P8-42c1): configuration, health and counts only, never a byte of mail.
    loadInboxOverview(q),
    // The reading panel (P8-42c2): counts, the queue with masked suffixes, coverage and what mail
    // said about expiries and instruments. Never a byte of mail, a member number or the key.
    loadReadOverview(q),
  ]);

  const aliasesOf = new Map<number, string[]>();
  for (const a of aliases.rows) aliasesOf.set(a.program_id, [...(aliasesOf.get(a.program_id) ?? []), a.alias]);
  const current = currentObservationByMembership(observations);
  const earn = await earningOf(q, memberships.rows, null, observations);
  const membershipsOf = new Map<number, LoyaltyMembership[]>();
  for (const row of memberships.rows) {
    membershipsOf.set(row.program_id, [...(membershipsOf.get(row.program_id) ?? []), membershipFrom(row, current.get(row.id), watches, earn)]);
  }

  const programList: LoyaltyProgram[] = programs.rows.map((p) => ({
    id: p.id, name: p.name, kind: p.kind, defaultUnit: p.default_unit, aliases: aliasesOf.get(p.id) ?? [],
  }));
  // One card per program WITH a membership: the catalog is wide on purpose, and a card for every
  // seeded program would bury the household's handful under dozens of empty ones.
  const cards: LoyaltyProgramCard[] = programList.flatMap((p) => {
    const lines = membershipsOf.get(p.id);
    return lines ? [{ programId: p.id, programName: p.name, programKind: p.kind, memberships: lines }] : [];
  });

  return {
    members: members.rows.map((m) => ({ id: m.id, displayName: m.display_name, userId: m.user_id })),
    programs: programList,
    cards,
    instruments: sortInstruments(instruments.rows),
    cardAccounts: cardAccounts.rows,
    inbox,
    inboxRead,
  };
}

// ─── Members ───────────────────────────────────────────────────────────────────────────────────

const memberFrom = (r: { id: number; display_name: string; user_id: number | null }): LoyaltyMember => ({
  id: r.id, displayName: r.display_name, userId: r.user_id,
});

export async function createMember(body: LoyaltyMemberCreateRequest): Promise<LoyaltyResult<LoyaltyMember>> {
  try {
    const r = await db.query<{ id: number; display_name: string; user_id: number | null }>(
      `INSERT INTO household_members (display_name, user_id) VALUES ($1, $2) RETURNING id, display_name, user_id`,
      [body.displayName.trim(), body.userId ?? null]
    );
    log.info('loyalty member created', { count: 1 });
    return { ok: true, value: memberFrom(r.rows[0]) };
  } catch (err) {
    return fromPgError(err);
  }
}

/**
 * Edits a member. `forwardingAddresses` (P8-42c1), when present, REPLACES the member's whole list in
 * the same transaction as the other fields: addresses no longer listed are deleted, new ones
 * inserted, kept ones untouched (so their `added_on` and `last_received_on` survive). An address
 * another member holds is the unique constraint's 409 `ADDRESS_TAKEN` and nothing changes. Then, in
 * that transaction still, the retained messages not yet matched to anyone are re-attributed with the
 * new addresses; a matched message is never changed.
 */
export async function patchMember(id: number, body: LoyaltyMemberPatchRequest): Promise<LoyaltyResult<LoyaltyMember>> {
  let addresses: string[] | null = null;
  if (body.forwardingAddresses !== undefined) {
    const stored = body.forwardingAddresses.map(storedForwardingAddress);
    // The schema has refused these already; a second refusal here is the handler's 400, never a 500.
    if (stored.some((a) => a === null)) return fail('INVALID_INPUT', 'A forwarding address must be a plain email address.');
    addresses = stored as string[];
  }
  try {
    const row = await inTransaction(async (client) => {
      // A field absent from the body keeps its value; `userId: null` is an explicit unlink, so the
      // "was it sent" flag travels separately from the value.
      const r = await client.query<{ id: number; display_name: string; user_id: number | null }>(
        `UPDATE household_members
            SET display_name = COALESCE($2, display_name),
                user_id = CASE WHEN $3 THEN $4::int ELSE user_id END
          WHERE id = $1
        RETURNING id, display_name, user_id`,
        [id, storedText(body.displayName), 'userId' in body, body.userId ?? null]
      );
      if (r.rows.length === 0) return null;
      if (addresses !== null) {
        await client.query('DELETE FROM household_member_addresses WHERE member_id = $1 AND address <> ALL($2::text[])', [id, addresses]);
        await client.query(
          `INSERT INTO household_member_addresses (member_id, address)
           SELECT $1, a FROM unnest($2::text[]) AS a
            WHERE NOT EXISTS (SELECT 1 FROM household_member_addresses x WHERE x.member_id = $1 AND x.address = a)`,
          [id, addresses]
        );
        await reattributeInbox(client);
      }
      return r.rows[0];
    });
    if (row === null) return notFound();
    if (addresses !== null) log.info('loyalty forwarding addresses replaced', { count: addresses.length });
    return { ok: true, value: memberFrom(row) };
  } catch (err) {
    return fromPgError(err);
  }
}

// ─── Programs ──────────────────────────────────────────────────────────────────────────────────

async function programById(q: Queryable, id: number): Promise<LoyaltyProgram | null> {
  const p = await q.query<{ id: number; name: string; kind: LoyaltyProgramKind; default_unit: LoyaltyUnit }>(
    'SELECT id, name, kind, default_unit FROM loyalty_programs WHERE id = $1', [id]
  );
  if (p.rows.length === 0) return null;
  const a = await q.query<{ alias: string }>(
    'SELECT alias FROM loyalty_program_aliases WHERE program_id = $1 ORDER BY alias, id', [id]
  );
  const row = p.rows[0];
  return { id: row.id, name: row.name, kind: row.kind, defaultUnit: row.default_unit, aliases: a.rows.map((x) => x.alias) };
}

/**
 * A new program, with its own normalised name as its first alias, in one transaction: if another
 * program already holds that alias the whole create is refused (409) and nothing is left behind.
 */
export async function createProgram(body: LoyaltyProgramCreateRequest): Promise<LoyaltyResult<LoyaltyProgram>> {
  const alias = normalizeLabel(body.name);
  if (alias === null) return fail('INVALID_INPUT', 'A program name must contain a letter or a digit.');
  try {
    const program = await inTransaction(async (client) => {
      const r = await client.query<{ id: number }>(
        'INSERT INTO loyalty_programs (name, kind, default_unit) VALUES ($1, $2, $3) RETURNING id',
        [body.name.trim(), body.kind, body.defaultUnit]
      );
      await client.query('INSERT INTO loyalty_program_aliases (program_id, alias) VALUES ($1, $2)', [r.rows[0].id, alias]);
      return programById(client, r.rows[0].id);
    });
    log.info('loyalty program created', { count: 1 });
    return { ok: true, value: program as LoyaltyProgram };
  } catch (err) {
    return fromPgError(err);
  }
}

/**
 * Edits a program. `aliases`, when present, REPLACES the whole list: each normalised, duplicates
 * collapsed, at least one left. The delete and the inserts share one transaction, so an alias another
 * program holds refuses the request (409) with the old list exactly as it was — never half-applied.
 */
export async function patchProgram(id: number, body: LoyaltyProgramPatchRequest): Promise<LoyaltyResult<LoyaltyProgram>> {
  let aliases: string[] | null = null;
  if (body.aliases !== undefined) {
    const normalised = body.aliases.map(normalizeLabel);
    if (normalised.some((a) => a === null)) return fail('INVALID_INPUT', 'An alias must contain a letter or a digit.');
    aliases = [...new Set(normalised as string[])];
  }
  let senderDomains: string[] | null = null;
  if (body.senderDomains !== undefined) {
    const stored = body.senderDomains.map(storedSenderDomain);
    // The schema has refused these already; a second refusal here is the handler's 400, never a 500.
    if (stored.some((d) => d === null)) return fail('INVALID_INPUT', 'A sender domain cannot be allowlisted.');
    senderDomains = stored as string[];
  }
  try {
    const program = await inTransaction(async (client) => {
      const r = await client.query(
        `UPDATE loyalty_programs
            SET name = COALESCE($2, name), kind = COALESCE($3, kind), default_unit = COALESCE($4, default_unit)
          WHERE id = $1 RETURNING id`,
        [id, storedText(body.name), body.kind ?? null, body.defaultUnit ?? null]
      );
      if (r.rows.length === 0) return null;
      if (aliases !== null) {
        await client.query('DELETE FROM loyalty_program_aliases WHERE program_id = $1', [id]);
        await client.query(
          'INSERT INTO loyalty_program_aliases (program_id, alias) SELECT $1, unnest($2::text[])',
          [id, aliases]
        );
      }
      // P8-42c1: the allowlist, replaced whole. A domain that stays keeps its row and its
      // `last_seen_on`; a domain another program holds is the unique constraint's 409 DOMAIN_TAKEN,
      // which rolls back this whole transaction, the other fields included.
      if (senderDomains !== null) {
        await client.query('DELETE FROM loyalty_sender_domains WHERE program_id = $1 AND domain <> ALL($2::text[])', [id, senderDomains]);
        await client.query(
          `INSERT INTO loyalty_sender_domains (program_id, domain)
           SELECT $1, d FROM unnest($2::text[]) AS d
            WHERE NOT EXISTS (SELECT 1 FROM loyalty_sender_domains x WHERE x.program_id = $1 AND x.domain = d)`,
          [id, senderDomains]
        );
      }
      return programById(client, id);
    });
    if (program !== null && senderDomains !== null) log.info('loyalty sender domains replaced', { count: senderDomains.length });
    return program === null ? notFound() : { ok: true, value: program };
  } catch (err) {
    return fromPgError(err);
  }
}

// ─── Memberships ───────────────────────────────────────────────────────────────────────────────

export async function createMembership(body: LoyaltyMembershipCreateRequest): Promise<LoyaltyResult<LoyaltyMembership>> {
  try {
    // card_account_id and the benefit columns are not in the column list: a membership is created
    // unlinked and with no benefit (the create schema refuses both), and `patchMembership` is the one
    // place a link or a benefit is set, because that is where their rules are checked.
    const r = await db.query<{ id: number }>(
      `INSERT INTO loyalty_memberships (member_id, program_id, member_number, tier)
       VALUES ($1, $2, $3, $4) RETURNING id`,
      [body.memberId, body.programId, storedNumber(body.memberNumber), storedText(body.tier)]
    );
    log.info('loyalty membership created', { count: 1 });
    return { ok: true, value: (await membershipView(r.rows[0].id)) as LoyaltyMembership };
  } catch (err) {
    return fromPgError(err);
  }
}

/**
 * Edits a membership: the number, the tier, the card link and the benefit, each only when present.
 *
 * THE LINK. A non-null `cardAccountId` must name an account whose type is `credit`; anything else —
 * no such account, or a checking, investment or loan account — is 400 `INVALID_INPUT` with nothing
 * changed. A CHECK cannot read `accounts`, so this is the one place the rule is enforced; the type is
 * read `FOR SHARE` inside the same transaction as the write, so it cannot change between the check
 * and the link. A card another membership holds is the unique index's 23505, mapped to 409
 * `CARD_ALREADY_LINKED` — the index decides, not a prior SELECT, so two links racing for one card
 * give one 200 and one 409 and never a 500. `null` unlinks and touches nothing else: instruments and
 * the benefit stay.
 *
 * THE EARN DESCRIPTION (P8-42b2). `earn` replaces the base rate and every rule, in submitted order,
 * inside the same transaction (`replaceEarn`); `null` clears both. Accepted on an unlinked membership,
 * where it is inert until a card is linked, and kept across an unlink, as the benefit is.
 *
 * THE BENEFIT. Stored trimmed, with `LOYALTY_BENEFIT_DEFAULT_WINDOW_DAYS` when no window is given:
 * the column has no DEFAULT (it would fill rows that describe no benefit), so the route is where the
 * default is written. `null` clears all three columns together.
 */
export async function patchMembership(id: number, body: LoyaltyMembershipPatchRequest): Promise<LoyaltyResult<LoyaltyMembership>> {
  const linking = typeof body.cardAccountId === 'string' ? body.cardAccountId : null;
  const benefit = body.benefit ?? null;
  try {
    const outcome = await inTransaction(async (client): Promise<'missing' | 'not_credit' | 'done'> => {
      if (linking !== null) {
        const a = await client.query<{ type: string }>('SELECT type FROM accounts WHERE id = $1 FOR SHARE', [linking]);
        if (a.rows.length === 0 || a.rows[0].type !== 'credit') return 'not_credit';
      }
      const r = await client.query(
        `UPDATE loyalty_memberships
            SET member_number = CASE WHEN $2 THEN $3 ELSE member_number END,
                tier = CASE WHEN $4 THEN $5 ELSE tier END,
                card_account_id = CASE WHEN $6 THEN $7::text ELSE card_account_id END,
                benefit_kind = CASE WHEN $8 THEN $9::text ELSE benefit_kind END,
                benefit_description = CASE WHEN $8 THEN $10::text ELSE benefit_description END,
                benefit_window_days = CASE WHEN $8 THEN $11::int ELSE benefit_window_days END
          WHERE id = $1 RETURNING id`,
        [
          id, 'memberNumber' in body, storedNumber(body.memberNumber), 'tier' in body, storedText(body.tier),
          'cardAccountId' in body, linking,
          'benefit' in body, benefit?.kind ?? null, storedText(benefit?.description),
          benefit === null ? null : (benefit.windowDays ?? LOYALTY_BENEFIT_DEFAULT_WINDOW_DAYS),
        ]
      );
      if (r.rows.length === 0) return 'missing';
      // The earn description, whole or cleared, in this same transaction: a refusal anywhere above or
      // in it rolls back the link, the benefit and the description together.
      if (body.earn !== undefined) await replaceEarn(client, id, body.earn);
      return 'done';
    });
    if (outcome === 'missing') return notFound();
    if (outcome === 'not_credit') return fail('INVALID_INPUT', 'Only an existing credit card account can be linked.');
    if ('cardAccountId' in body) log.info('loyalty card link changed', { count: 1 });
    if (body.earn !== undefined) log.info('loyalty earn description changed', { count: body.earn === null ? 0 : body.earn.rules.length });
    return { ok: true, value: (await membershipView(id)) as LoyaltyMembership };
  } catch (err) {
    return fromPgError(err);
  }
}

/** The one full number, for the copy route alone. Null value when the membership has none stored. */
export async function memberNumberOf(id: number): Promise<LoyaltyResult<LoyaltyMemberNumber>> {
  const r = await db.query<{ member_number: string | null }>(
    'SELECT member_number FROM loyalty_memberships WHERE id = $1', [id]
  );
  if (r.rows.length === 0) return notFound();
  log.info('loyalty member number served', { count: 1 });
  return { ok: true, value: { membershipId: id, memberNumber: r.rows[0].member_number } };
}

// ─── Observations ──────────────────────────────────────────────────────────────────────────────

/**
 * A new typed reading for a membership — the only way a balance changes from the page. Appends one
 * row with source `typed` (whatever the request did or did not say: the schema already refused any
 * other value) and returns the refreshed view, whose balance is whichever reading is CURRENT — an
 * older as-of entered now is stored and does not become current.
 *
 * The as-of is compared with Postgres's CURRENT_DATE, not a JS clock: one day of slack lets a
 * person east of the server enter today's date before the server's calendar has turned.
 */
export async function addObservation(
  membershipId: number,
  body: LoyaltyObservationCreateRequest
): Promise<LoyaltyResult<LoyaltyMembership>> {
  const parsed = parseBalance(body.unit, body.balance);
  if (!parsed.ok) return fail('INVALID_INPUT', 'The balance is not valid for its unit.');
  try {
    const exists = await db.query('SELECT 1 FROM loyalty_memberships WHERE id = $1', [membershipId]);
    if (exists.rows.length === 0) return notFound();
    const future = await db.query<{ future: boolean }>('SELECT $1::date > CURRENT_DATE + 1 AS future', [body.asOf]);
    if (future.rows[0].future) return fail('INVALID_INPUT', 'A balance cannot be dated more than a day ahead.');
    await db.query(
      `INSERT INTO loyalty_observations (membership_id, as_of, balance, unit, source)
       VALUES ($1, $2, $3::numeric, $4, 'typed')`,
      [membershipId, body.asOf, parsed.balance, parsed.unit]
    );
    log.info('loyalty observation recorded', { count: 1 });
    return { ok: true, value: (await membershipView(membershipId)) as LoyaltyMembership };
  } catch (err) {
    return fromPgError(err);
  }
}

// ─── Instruments ───────────────────────────────────────────────────────────────────────────────

async function instrumentById(id: number): Promise<LoyaltyInstrument | null> {
  const r = await db.query<InstrumentRow>(`${INSTRUMENT_SELECT} WHERE id = $1`, [id]);
  return r.rows[0] ?? null;
}

export async function createInstrument(body: LoyaltyInstrumentCreateRequest): Promise<LoyaltyResult<LoyaltyInstrument>> {
  try {
    const r = await db.query<{ id: number }>(
      `INSERT INTO loyalty_instruments (membership_id, kind, description, issued_on, expires_on, used_on, source)
       VALUES ($1, $2, $3, $4, $5, $6, 'typed') RETURNING id`,
      [body.membershipId, body.kind, body.description.trim(), body.issuedOn ?? null, body.expiresOn ?? null, body.usedOn ?? null]
    );
    return { ok: true, value: (await instrumentById(r.rows[0].id)) as LoyaltyInstrument };
  } catch (err) {
    return fromPgError(err);
  }
}

/**
 * Edits an instrument. A date absent from the body keeps its value and `null` clears it. The date
 * order is checked again against the row AS IT WOULD BE STORED by the table's CHECK, so a PATCH that
 * moves only the issue date past a stored expiry is the same 400 as a body that is wrong on its own.
 */
export async function patchInstrument(id: number, body: LoyaltyInstrumentPatchRequest): Promise<LoyaltyResult<LoyaltyInstrument>> {
  try {
    const r = await db.query(
      `UPDATE loyalty_instruments
          SET kind = COALESCE($2, kind),
              description = COALESCE($3, description),
              issued_on = CASE WHEN $4 THEN $5::date ELSE issued_on END,
              expires_on = CASE WHEN $6 THEN $7::date ELSE expires_on END,
              used_on = CASE WHEN $8 THEN $9::date ELSE used_on END
        WHERE id = $1 RETURNING id`,
      [
        id, body.kind ?? null, storedText(body.description),
        'issuedOn' in body, body.issuedOn ?? null,
        'expiresOn' in body, body.expiresOn ?? null,
        'usedOn' in body, body.usedOn ?? null,
      ]
    );
    if (r.rows.length === 0) return notFound();
    return { ok: true, value: (await instrumentById(id)) as LoyaltyInstrument };
  } catch (err) {
    return fromPgError(err);
  }
}
