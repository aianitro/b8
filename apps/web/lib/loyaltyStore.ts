// Loyalty (P8-42a) — every statement the `/travel` page and the eleven loyalty routes make against
// the six loyalty tables. The decisions are `lib/domain/loyalty.ts`'s (the mask, the balance rule,
// the label rule, the current balance, the instrument order); this file reads rows, asks those
// functions, and performs what they decided.
//
// ─── THE LEDGER IS NOT READ HERE ──────────────────────────────────────────────────────────────
//
// Nothing here reads the ledger's transactions, accounts or valuations, and nothing writes them.
// Loyalty balances are not money in the ledger's sense and are never summed into any figure; the
// one link to the ledger, `loyalty_memberships.card_account_id`, is reserved for a later step and is
// never selected, set or emitted.
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
// ─── APPEND-ONLY OBSERVATIONS ─────────────────────────────────────────────────────────────────
//
// `addObservation` INSERTs. There is no statement here, or anywhere in loyalty code, that updates or
// deletes an observation: a corrected balance is a newer reading, and the current balance is derived
// from all of them by the shared reducer.

import type { PoolClient, QueryResult, QueryResultRow } from 'pg';
import db from './db';
import { createLogger } from './logger';
import {
  currentObservationByMembership,
  maskMemberNumber,
  normalizeLabel,
  parseBalance,
  sortInstruments,
} from './domain/loyalty';
import type {
  LoyaltyErrorCode,
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
}

interface ObservationRow {
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

/** One membership as the contract shows it: masked number, current balance or four nulls. */
function membershipFrom(row: MembershipRow, current: ObservationRow | undefined): LoyaltyMembership {
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
  };
}

const MEMBERSHIP_SELECT = `
  SELECT m.id, m.member_id, hm.display_name AS member_display_name, m.program_id, m.member_number, m.tier
    FROM loyalty_memberships m
    JOIN household_members hm ON hm.id = m.member_id`;

/** The membership view for one id, or null when there is no such membership. */
export async function membershipView(id: number, q: Queryable = db): Promise<LoyaltyMembership | null> {
  const r = await q.query<MembershipRow>(`${MEMBERSHIP_SELECT} WHERE m.id = $1`, [id]);
  if (r.rows.length === 0) return null;
  const current = currentObservationByMembership(await observationsOf(q, [id])).get(id);
  return membershipFrom(r.rows[0], current);
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
  const [members, programs, aliases, memberships, observations, instruments] = await Promise.all([
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
  ]);

  const aliasesOf = new Map<number, string[]>();
  for (const a of aliases.rows) aliasesOf.set(a.program_id, [...(aliasesOf.get(a.program_id) ?? []), a.alias]);
  const current = currentObservationByMembership(observations);
  const membershipsOf = new Map<number, LoyaltyMembership[]>();
  for (const row of memberships.rows) {
    membershipsOf.set(row.program_id, [...(membershipsOf.get(row.program_id) ?? []), membershipFrom(row, current.get(row.id))]);
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

export async function patchMember(id: number, body: LoyaltyMemberPatchRequest): Promise<LoyaltyResult<LoyaltyMember>> {
  try {
    // A field absent from the body keeps its value; `userId: null` is an explicit unlink, so the
    // "was it sent" flag travels separately from the value.
    const r = await db.query<{ id: number; display_name: string; user_id: number | null }>(
      `UPDATE household_members
          SET display_name = COALESCE($2, display_name),
              user_id = CASE WHEN $3 THEN $4::int ELSE user_id END
        WHERE id = $1
      RETURNING id, display_name, user_id`,
      [id, storedText(body.displayName), 'userId' in body, body.userId ?? null]
    );
    return r.rows.length === 0 ? notFound() : { ok: true, value: memberFrom(r.rows[0]) };
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
      return programById(client, id);
    });
    return program === null ? notFound() : { ok: true, value: program };
  } catch (err) {
    return fromPgError(err);
  }
}

// ─── Memberships ───────────────────────────────────────────────────────────────────────────────

export async function createMembership(body: LoyaltyMembershipCreateRequest): Promise<LoyaltyResult<LoyaltyMembership>> {
  try {
    // card_account_id is not in the column list: it is reserved for a later step and stays NULL.
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

export async function patchMembership(id: number, body: LoyaltyMembershipPatchRequest): Promise<LoyaltyResult<LoyaltyMembership>> {
  try {
    const r = await db.query(
      `UPDATE loyalty_memberships
          SET member_number = CASE WHEN $2 THEN $3 ELSE member_number END,
              tier = CASE WHEN $4 THEN $5 ELSE tier END
        WHERE id = $1 RETURNING id`,
      [id, 'memberNumber' in body, storedNumber(body.memberNumber), 'tier' in body, storedText(body.tier)]
    );
    if (r.rows.length === 0) return notFound();
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
