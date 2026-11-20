/**
 * Import the household's loyalty spreadsheet, exactly as the owner exports it (P8-42a).
 *
 *   npm run import:loyalty -- --file <sheet.csv> --as-of YYYY-MM-DD [--default-member <name>]
 *   npm run import:loyalty -- --file <sheet.csv> --as-of YYYY-MM-DD [--default-member <name>] --apply
 *
 * Run once, by hand, on the home server. A DRY RUN unless `--apply` is given: it reads the sheet and
 * the database, plans every row, prints the counts, and writes nothing. Re-runnable: a second
 * `--apply` finds every membership, reading and bonus it would write already there and writes none.
 *
 * ─── What it reads ────────────────────────────────────────────────────────────────────────────
 *
 * The sheet as the owner keeps it: an unnamed first column holding a label (a program name, perhaps
 * followed by a household member's first name), then `Balance`, `Annual fee`, `Annual bonus`,
 * `Annual bonus availability` and `Account #`, in any case and spacing. The sheet has no date, so
 * every reading takes the required `--as-of` date — the wall clock is never read, because "today"
 * would make an old sheet's figures look newer than a reading typed since. A label naming no member
 * belongs to `--default-member`, which must name an existing member exactly; nobody is assumed.
 *
 * The parsing, label resolution and planning are `lib/domain/loyaltyImport.ts`'s, pure and tested
 * there; this file only reads the file and the state, prints, and writes.
 *
 * ─── What it writes ───────────────────────────────────────────────────────────────────────────
 *
 * New memberships (with the account number, never a tier), new readings with source `import`, and
 * an instrument for a bonus the availability column says is issued and unused. Never a program, an
 * alias or a member — a label that names no alias is refused, and the owner adds the alias on
 * /travel. Never an update: an existing membership keeps its number and tier, and a stored imported
 * reading for the same day with a different balance is refused as a conflict.
 *
 * ALL OR NOTHING. With `--apply`, the plan is made again inside one transaction that holds the three
 * tables it writes against concurrent writers, and any refused row rolls the whole run back with
 * exit 1. The partial unique indexes on imported readings and instruments back the same rule in the
 * schema, so even an interleaving this script did not foresee cannot duplicate a row.
 *
 * ─── What it prints ───────────────────────────────────────────────────────────────────────────
 *
 * Exactly 20 lines: the mode, 14 counts, 5 lists of refused row numbers. Never a label, a name, a
 * member number, a balance or a fee — not in an error either. Output goes through `deps.out` and
 * `deps.err` only, after `rekey-plaid-ids.ts`, so the test captures everything the script says.
 * Exit codes: 0 success, 1 any refused row or a failed run, 2 a usage or file-level refusal.
 *
 * It imports no network client, and deliberately not the shared helper module of the Plaid
 * scripts, which pulls in the Plaid client's types; it carries its own small usage error instead.
 */
import { readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import db from '../lib/db';
import {
  parseImportCsv,
  planImport,
  planLines,
  type ImportOptions,
  type ImportPlan,
  type ImportState,
} from '../lib/domain/loyaltyImport';
import { giftDate as calendarDate } from '@b8/contracts/gifts';
import type { LoyaltyUnit } from '@b8/contracts/loyalty';

export const USAGE =
  'usage: npm run import:loyalty -- --file <sheet.csv> --as-of YYYY-MM-DD [--default-member <name>] [--apply]\n' +
  '  --file             the sheet exported as CSV (required)\n' +
  '  --as-of            the calendar date every balance in the sheet is true for (required)\n' +
  '  --default-member   the member a label without a member name belongs to\n' +
  '  (no --apply)       dry run: print the counts, write nothing';

export type Env = Readonly<Record<string, string | undefined>>;

/** Anything the operator typed wrong, or a file this script will not read. Exit 2. */
export class UsageError extends Error {}

/** The part of `lib/db` this script uses. */
export interface ImportDb {
  query<R extends Record<string, unknown> = Record<string, unknown>>(
    text: string, values?: unknown[]
  ): Promise<{ rows: R[]; rowCount: number | null }>;
  connect(): Promise<{
    query<R extends Record<string, unknown> = Record<string, unknown>>(
      text: string, values?: unknown[]
    ): Promise<{ rows: R[]; rowCount: number | null }>;
    release(): void;
  }>;
}

export interface ImportDeps {
  db: ImportDb;
  out(line: string): void;
  err(line: string): void;
  readFile(file: string): string;
}

export const defaultDeps: ImportDeps = {
  db: db as unknown as ImportDb,
  out: (line) => console.log(line),
  err: (line) => console.error(line),
  readFile: (file) => {
    // A directory or a missing path is the operator's mistake, not a crash.
    if (!statSync(file).isFile()) throw new UsageError('--file is not a regular file');
    return readFileSync(file, 'utf8');
  },
};

export interface ImportArgs extends ImportOptions {
  file: string;
  apply: boolean;
}

/**
 * The arguments, checked before anything is read. A value is never echoed: a pasted member name or
 * path in the wrong position would otherwise land in the output.
 */
export function parseArgs(argv: readonly string[]): ImportArgs {
  let file: string | undefined;
  let asOf: string | undefined;
  let defaultMember: string | undefined;
  let apply = false;
  const seen = new Set<string>();
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (seen.has(a)) throw new UsageError('an argument was given twice');
    if (a === '--apply') { apply = true; seen.add(a); continue; }
    if (a === '--file' || a === '--as-of' || a === '--default-member') {
      const v = argv[i + 1];
      if (v === undefined || v.startsWith('--')) throw new UsageError(`${a} needs a value`);
      seen.add(a);
      i++;
      if (a === '--file') file = v;
      else if (a === '--as-of') asOf = v;
      else defaultMember = v;
      continue;
    }
    throw new UsageError('unknown argument; the flags are --file, --as-of, --default-member and --apply');
  }
  if (file === undefined || file.trim() === '') throw new UsageError('--file is required');
  if (asOf === undefined) throw new UsageError('--as-of is required');
  // A real calendar date (2026-02-30 is refused), checked by integer arithmetic, never by Date.
  if (!calendarDate.safeParse(asOf).success) throw new UsageError('--as-of must be a real date, YYYY-MM-DD');
  if (defaultMember !== undefined && defaultMember.trim() === '') throw new UsageError('--default-member needs a value');
  return { file, asOf, defaultMember, apply };
}

type Query = ImportDb['query'];

/** Everything the plan compares against, read in one go. */
export async function readState(query: Query): Promise<ImportState> {
  // One query after another, not Promise.all: under --apply these run on ONE client inside the
  // transaction, and a client runs one query at a time.
  const members = await query<{ id: number; displayName: string }>(
    'SELECT id, display_name AS "displayName" FROM household_members'
  );
  const programs = await query<{ id: number; defaultUnit: LoyaltyUnit }>(
    'SELECT id, default_unit AS "defaultUnit" FROM loyalty_programs'
  );
  const aliases = await query<{ programId: number; alias: string }>(
    'SELECT program_id AS "programId", alias FROM loyalty_program_aliases'
  );
  const memberships = await query<{ id: number; memberId: number; programId: number }>(
    'SELECT id, member_id AS "memberId", program_id AS "programId" FROM loyalty_memberships'
  );
  const observations = await query<{ membershipId: number; asOf: string; balance: string; unit: LoyaltyUnit }>(
    `SELECT membership_id AS "membershipId", as_of::text AS "asOf", balance::text AS balance, unit
       FROM loyalty_observations WHERE source = 'import'`
  );
  const instruments = await query<{ membershipId: number }>(
    `SELECT DISTINCT membership_id AS "membershipId" FROM loyalty_instruments WHERE source = 'import'`
  );
  return {
    members: members.rows,
    programs: programs.rows,
    aliases: aliases.rows,
    memberships: memberships.rows,
    importObservations: observations.rows,
    importInstrumentMemberships: instruments.rows.map((r) => r.membershipId),
  };
}

/** Thrown when a write finds the database other than the plan saw it; the transaction rolls back. */
class WriteMismatch extends Error {}

/** The plan's writes, in row order, on one client inside the caller's transaction. */
async function performWrites(query: Query, plan: ImportPlan, asOf: string): Promise<void> {
  for (const w of plan.writes) {
    let membershipId = w.membershipId;
    if (membershipId === null) {
      const r = await query<{ id: number }>(
        `INSERT INTO loyalty_memberships (member_id, program_id, member_number)
         VALUES ($1, $2, $3) ON CONFLICT (member_id, program_id) DO NOTHING RETURNING id`,
        [w.memberId, w.programId, w.memberNumber]
      );
      if (r.rows.length !== 1) throw new WriteMismatch();
      membershipId = r.rows[0].id;
    }
    if (w.observation) {
      const r = await query(
        `INSERT INTO loyalty_observations (membership_id, as_of, balance, unit, source)
         VALUES ($1, $2, $3::numeric, $4, 'import')
         ON CONFLICT (membership_id, as_of) WHERE source = 'import' DO NOTHING`,
        [membershipId, asOf, w.observation.balance, w.observation.unit]
      );
      if (r.rowCount !== 1) throw new WriteMismatch();
    }
    if (w.instrument) {
      const r = await query(
        `INSERT INTO loyalty_instruments (membership_id, kind, description, source)
         VALUES ($1, 'other', $2, 'import')
         ON CONFLICT (membership_id) WHERE source = 'import' DO NOTHING`,
        [membershipId, w.instrument.description]
      );
      if (r.rowCount !== 1) throw new WriteMismatch();
    }
  }
}

const FILE_REFUSAL: Record<string, string> = {
  'malformed': 'the file is not a readable CSV (an unterminated quote, or no header row)',
  'label-header': 'the first column must have an empty header (it holds the row labels)',
  'missing-balance': 'the file has no Balance column',
  'duplicate-header': 'a recognised column header appears twice',
};

/**
 * Arguments and the file first — both before any database access — then the plan, and with
 * `--apply` the writes. Returns the exit code rather than exiting, so the test drives it like the
 * shell does.
 */
export async function main(
  argv: string[], _env: Env = process.env, deps: ImportDeps = defaultDeps
): Promise<{ exitCode: number; plan: ImportPlan | null }> {
  let args: ImportArgs;
  let text: string;
  try {
    args = parseArgs(argv);
    try {
      text = deps.readFile(path.resolve(args.file));
    } catch (err) {
      if (err instanceof UsageError) throw err;
      throw new UsageError('--file could not be read');
    }
  } catch (err) {
    if (!(err instanceof UsageError)) throw err;
    deps.err(err.message);
    deps.err(USAGE);
    return { exitCode: 2, plan: null };
  }
  const csv = parseImportCsv(text);
  if (!csv.ok) {
    deps.err(`refusing the file: ${FILE_REFUSAL[csv.reason]}; nothing was changed`);
    return { exitCode: 2, plan: null };
  }

  let plan: ImportPlan;
  try {
    if (!args.apply) {
      plan = planImport(csv.rows, await readState((t, v) => deps.db.query(t, v)), args);
    } else {
      const client = await deps.db.connect();
      const query: Query = (t, v) => client.query(t, v);
      try {
        await query('BEGIN');
        // Writers of these three tables wait until this run commits or rolls back, so the state the
        // plan is made from is the state the writes land on.
        await query('LOCK TABLE loyalty_memberships, loyalty_observations, loyalty_instruments IN SHARE ROW EXCLUSIVE MODE');
        plan = planImport(csv.rows, await readState(query), args);
        if (plan.writes.length > 0) await performWrites(query, plan, args.asOf);
        await query('COMMIT');
      } catch (err) {
        await query('ROLLBACK').catch(() => {});
        throw err;
      } finally {
        client.release();
      }
    }
  } catch {
    // No error object is printed: a database error's detail can quote the row it refused.
    deps.err('import could not run; nothing was changed');
    return { exitCode: 1, plan: null };
  }

  for (const line of planLines(plan, args.apply)) deps.out(line);
  const refused = plan.counts.refused_program + plan.counts.refused_member + plan.counts.refused_value
    + plan.counts.refused_duplicate + plan.counts.conflicts;
  return { exitCode: refused > 0 ? 1 : 0, plan };
}

/**
 * True only when this file is the process's entry point. The test imports the module, and importing
 * it must neither connect nor run: `lib/db` is lazy, and this check keeps `main` from starting under
 * the test runner, whose `argv[1]` is its own binary.
 */
export function isEntryPoint(argv: string[] = process.argv): boolean {
  return path.basename(argv[1] ?? '') === 'import-loyalty.ts';
}

if (isEntryPoint()) {
  main(process.argv.slice(2))
    .then(async ({ exitCode }) => {
      // Without ending the pool the event loop stays alive and the script never exits.
      await db.end().catch(() => {});
      process.exit(exitCode);
    })
    .catch(async () => {
      console.error('import could not run; nothing was changed');
      await db.end().catch(() => {});
      process.exit(1);
    });
}
