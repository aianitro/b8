/**
 * Fill P6-40b's enrichment columns onto transactions stored before 40b existed (P6-40c).
 *
 *   npm run backfill:enrichment -w @b8/web                       dry run: counts only, writes nothing
 *   npm run backfill:enrichment -w @b8/web -- --apply            CSV backup first, then the UPDATEs
 *   npm run backfill:enrichment -w @b8/web -- --apply --backup-dir <dir>
 *
 * Run by hand, once, by the operator; re-runnable, and a second `--apply` changes nothing. Not wired
 * into the daily job, the scheduler or any route, and nothing imports it but its own test.
 *
 * ─── What it reads, and why from no cursor ────────────────────────────────────────────────────
 *
 * Each item's history comes from `/transactions/sync` started with NO cursor, paged through
 * `next_cursor` / `has_more` in memory, and the final cursor is thrown away. The stored
 * `accounts.cursor` is never even selected: passing it would return only what changed since the
 * last sync — almost nothing — and the run would report success having enriched nothing. And the
 * cursor this walk ends on is never saved, because saving it would tell the next real sync that it
 * had already seen the whole history. The sync endpoint rather than any other read because it returns
 * the same `Transaction` shape sync's upserts map, so a backfilled row holds exactly what a normal
 * sync would have written: the eleven values come from `plaidEnrichment`, the one mapping 40b
 * shares, U+FFFD sanitising and date-string handling included. Nothing here re-serialises them.
 *
 * ─── What it writes, which is almost nothing ──────────────────────────────────────────────────
 *
 * One UPDATE, of the eleven 40b columns, on a row that already exists, matched by Plaid id AND
 * confined to the accounts of the item that returned it (ids are scoped to an item, so after a
 * re-auth the same id can name another item's row). Never a new row, never a removal — Plaid's
 * `removed` list is not read at all — and never the `accounts` table. Not `name`, `amount`, `date`,
 * `plaid_category`, nor any of the owner's own columns either, even where Plaid now says something
 * different: refreshing those is sync's job, and a one-off script rewriting owner-visible figures
 * is the worst way for them to change. No rules are loaded, so no row is re-categorised.
 *
 * A row is a target only while `plaid_raw IS NULL` — 40b writes `plaid_raw` on every upsert, so
 * NULL means "never enriched" and non-NULL means done. That predicate is in the UPDATE itself, not
 * only in the read that planned it: a sync landing between the plan and the write has written
 * Plaid's newer statement, and a guard checked only at read time would overwrite it with an older one.
 *
 * ─── Order of operations in --apply, which is the safety argument ─────────────────────────────
 *
 * 1. Every item is fetched and classified, and nothing is written yet. An item whose fetch fails —
 *    on any page — contributes nothing at all: no backup row, no UPDATE. A half-walked history is
 *    never applied, which also covers Plaid rejecting a walk whose data moved underneath it; the
 *    item is reported failed by code and the operator re-runs, which is safe because the run is
 *    idempotent.
 * 2. One CSV is written of the FULL current row (every column, as text) of exactly the rows about to
 *    change, fsynced and closed. If it cannot be written, the run stops with nothing changed.
 * 3. Only then the UPDATEs, one transaction per item, and only for rows that are in that CSV.
 *
 * ─── Output carries counts and nothing else ───────────────────────────────────────────────────
 *
 * This prints to a terminal that may be pasted into an evidence file in a public repo, so stdout and
 * stderr carry fixed words, the mode, item ordinals, integer counts, the backup path and its row
 * count — and, for a failed item, Plaid's error CODE if it is one (`^[A-Z_]+$`), otherwise
 * `UNKNOWN`. Never an error object or its message: an axios error carries the request's
 * `.config.headers`, which hold `PLAID-SECRET` (the hazard `lib/sync.ts` documents), and Plaid's
 * messages can echo identifiers. Not the structured logger either, because its lines carry a
 * timestamp, and the rule this output is checked against is that its only digits are counts.
 */
import { closeSync, fsyncSync, lstatSync, mkdirSync, chmodSync, openSync, readFileSync, realpathSync, writeSync } from 'node:fs';
import { homedir } from 'node:os';
import path from 'node:path';
import type { Transaction, TransactionsSyncResponse } from 'plaid';
import db from '../lib/db';
import { plaidClient } from '../lib/plaid';
import { enrichmentParams, plaidEnrichment } from '../lib/plaidEnrichment';

// ─── Arguments ─────────────────────────────────────────────────────────────────────────────────

export const USAGE =
  'usage: npm run backfill:enrichment -w @b8/web [-- --apply] [--backup-dir <dir>]\n' +
  '  (no flag)          dry run: report counts, write nothing\n' +
  '  --apply            write a CSV backup of the rows to change, then update them\n' +
  '  --backup-dir <dir> where --apply writes the CSV (default $HOME/b8-backfill-backups;\n' +
  '                     never inside a git work tree or a backups directory)';

/** The environment, as far as this script reads it (`HOME`); a test passes a literal. */
export type Env = Readonly<Record<string, string | undefined>>;

/** Thrown for anything the operator typed wrong. Caught by `main`, which prints `USAGE`. */
export class UsageError extends Error {}

export interface BackfillOptions {
  apply: boolean;
  /** Absolute. Checked by `assertBackupDirAllowed` before anything else happens. */
  backupDir: string;
}

/**
 * The default backup directory: `$HOME/b8-backfill-backups`.
 *
 * NOT `apps/backups/`, which is where `scripts/backup.ts` writes and therefore where it would look
 * natural. `ops/laptop/pull-backups.sh` rsyncs that whole directory to the owner's laptop, and the
 * dumps it is meant for are age-encrypted; this CSV is plaintext real rows. Outside the repo and
 * outside anything that is pulled, it stays on the server unless someone decides otherwise.
 */
export function defaultBackupDir(env: Env = process.env): string {
  return path.join(env.HOME ?? homedir(), 'b8-backfill-backups');
}

/**
 * The flags, strictly. Anything unrecognised is an error rather than ignored, because the one typo
 * that matters — `--aply` — would otherwise run a dry run the operator believes was the real one,
 * or, with a looser matcher, the real one when they meant to look first.
 */
export function parseArgs(argv: string[], env: Env = process.env): BackfillOptions {
  let apply = false;
  let backupDir: string | null = null;
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--apply') {
      apply = true;
    } else if (a === '--backup-dir') {
      const v = argv[i + 1];
      if (v === undefined || v === '' || v.startsWith('--')) throw new UsageError('--backup-dir needs a directory');
      backupDir = v;
      i++;
    } else if (a.startsWith('--backup-dir=')) {
      const v = a.slice('--backup-dir='.length);
      if (v === '') throw new UsageError('--backup-dir needs a directory');
      backupDir = v;
    } else {
      // The argument itself is not echoed: it is whatever the operator typed, and a pasted token
      // or path in the wrong position would otherwise land in the output.
      throw new UsageError('unknown argument; the only flags are --apply and --backup-dir');
    }
  }
  return { apply, backupDir: path.resolve(backupDir ?? defaultBackupDir(env)) };
}

/**
 * `p` with symlinks resolved as far as the filesystem has it: the deepest existing ancestor through
 * `realpath`, the rest appended. A directory that does not exist yet still has to be judged by where
 * it WILL be, and a symlink from `/tmp/x` into the repo must be judged by its target.
 */
function realpathOfNearest(p: string): string {
  const rest: string[] = [];
  let cur = p;
  for (;;) {
    try {
      return path.join(realpathSync(cur), ...rest.reverse());
    } catch {
      const parent = path.dirname(cur);
      if (parent === cur) return p;
      rest.push(path.basename(cur));
      cur = parent;
    }
  }
}

/**
 * Refuses a backup directory that is inside a git work tree or inside any directory named
 * `backups`, before any database or network access (G0 amendment 4).
 *
 * THE WORK TREE BY LOOKING FOR `.git`, walking up from the resolved path, rather than by comparing
 * with this script's own location. That covers this checkout wherever it lives on the server and any
 * other repository the operator happens to point at, and it needs no git binary. A file inside a
 * work tree is one `git add .` from a public commit, which a `.gitignore` line only half-prevents.
 *
 * ANY `backups` SEGMENT, not only `apps/backups`. The pull script's source directory is configurable
 * on the laptop, where this script cannot see it, and refusing a name costs the operator one flag.
 */
export function assertBackupDirAllowed(dir: string): void {
  const real = realpathOfNearest(path.resolve(dir));
  if (real.split(path.sep).includes('backups')) {
    throw new UsageError('refusing a backup directory inside a "backups" directory (it may be copied off this machine)');
  }
  let cur = real;
  for (;;) {
    try {
      lstatSync(path.join(cur, '.git'));
      throw new UsageError('refusing a backup directory inside a git work tree');
    } catch (err) {
      if (err instanceof UsageError) throw err;
    }
    const parent = path.dirname(cur);
    if (parent === cur) return;
    cur = parent;
  }
}

// ─── Dependencies, injectable for the test ─────────────────────────────────────────────────────

/** The slice of `lib/db` this script uses. A test wraps the real one to observe the write order. */
export interface BackfillDb {
  query<R extends Record<string, unknown> = Record<string, unknown>>(
    text: string, values?: unknown[]
  ): Promise<{ rows: R[]; rowCount: number | null }>;
  connect(): Promise<{
    query(text: string, values?: unknown[]): Promise<{ rowCount: number | null }>;
    release(): void;
  }>;
}

export interface BackfillDeps {
  db: BackfillDb;
  /** One `/transactions/sync` page for `accessToken`, starting at `cursor` (undefined = from the start). */
  fetchPage(accessToken: string, cursor: string | undefined): Promise<TransactionsSyncResponse>;
  out(line: string): void;
  err(line: string): void;
  /** Injected so a test can make the file name deterministic; never printed except inside the path. */
  now(): Date;
  /**
   * One `write(2)` of `length` bytes of `buf` from `offset`, returning the bytes written — the shape
   * of `fs.writeSync`, which is the default. Injectable so a test can make the kernel's short write,
   * or a write that claims bytes it did not put on disk, happen on demand (BF-18).
   */
  writeChunk(fd: number, buf: Buffer, offset: number, length: number): number;
}

/**
 * The real transport. The request names the token, the walk's own cursor and the option sync uses
 * for the personal-finance category — and nothing else, so the response is the shape sync maps.
 */
async function fetchPageFromPlaid(accessToken: string, cursor: string | undefined): Promise<TransactionsSyncResponse> {
  const res = await plaidClient().transactionsSync({
    access_token: accessToken,
    cursor,
    options: { include_personal_finance_category: true },
  });
  return res.data;
}

export const defaultDeps: BackfillDeps = {
  db: db as unknown as BackfillDb,
  fetchPage: fetchPageFromPlaid,
  out: (line) => console.log(line),
  err: (line) => console.error(line),
  now: () => new Date(),
  writeChunk: (fd, buf, offset, length) => writeSync(fd, buf, offset, length),
};

// ─── Counting ──────────────────────────────────────────────────────────────────────────────────

/**
 * Every bucket, always present and always a number. The identities, per item:
 *   plaid_returned = unknown_account + pending_skipped + not_local + would_update + already_enriched
 *   matched        = would_update + already_enriched
 * `local_not_returned` counts LOCAL rows instead — un-enriched rows on the item's accounts that no
 * posted statement in the history matched — so it sits outside that sum. It is where Plaid's history
 * window shows: rows older than what Plaid returns stay un-enriched, and that is expected, not an error.
 */
export interface BackfillCounts {
  plaid_returned: number;
  pending_skipped: number;
  unknown_account: number;
  not_local: number;
  matched: number;
  would_update: number;
  already_enriched: number;
  local_not_returned: number;
  updated: number;
}

export interface ItemReport {
  ordinal: number;
  failed: boolean;
  /** Plaid's error code when it matched `^[A-Z_]+$`, else `UNKNOWN`; null for an item that did not fail. */
  errorCode: string | null;
  counts: BackfillCounts;
}

export interface BackfillSummary {
  mode: 'dry-run' | 'apply';
  items_total: number;
  items_failed: number;
  items: ItemReport[];
  /** Sums over the items that did not fail. */
  totals: BackfillCounts;
  /** Null when no CSV was written — always in a dry run, and in an apply with nothing to change. */
  backup: { path: string; rows: number } | null;
  exitCode: number;
}

const COUNT_KEYS: (keyof BackfillCounts)[] = [
  'plaid_returned', 'pending_skipped', 'unknown_account', 'not_local', 'matched',
  'would_update', 'already_enriched', 'local_not_returned', 'updated',
];

function zeroCounts(): BackfillCounts {
  return {
    plaid_returned: 0, pending_skipped: 0, unknown_account: 0, not_local: 0, matched: 0,
    would_update: 0, already_enriched: 0, local_not_returned: 0, updated: 0,
  };
}

/**
 * A Plaid error code safe to print, or `UNKNOWN`. Read from `response.data.error_code`, the one
 * place the SDK's axios errors carry it; the error's message and everything else on it is ignored.
 */
export function safeErrorCode(err: unknown): string {
  if (err instanceof WalkError) return err.code;
  const code = (err as { response?: { data?: { error_code?: unknown } } } | null)?.response?.data?.error_code;
  return typeof code === 'string' && /^[A-Z_]+$/.test(code) ? code : 'UNKNOWN';
}

/**
 * A history walk this script stopped itself, with a code of its own in Plaid's `^[A-Z_]+$` shape.
 * Its message is fixed text, and it is never printed anyway — only `code` is.
 */
export class WalkError extends Error {
  constructor(readonly code: 'CURSOR_NOT_ADVANCING' | 'PAGE_LIMIT_EXCEEDED') {
    super(code);
  }
}

/**
 * The most pages one item's walk may take before it is abandoned as failed (REVIEW-1 N2). Generous
 * on purpose: Plaid's sync pages hold up to a few hundred transactions, so this is far beyond any
 * household's history, and it exists only so that a Plaid that keeps answering `has_more: true`
 * with fresh cursors cannot hold the run — and the API — in a loop forever.
 */
export const MAX_PAGES_PER_ITEM = 10000;

// ─── The run ───────────────────────────────────────────────────────────────────────────────────

interface Target { rowId: number; plaidId: string; params: (string | null)[] }
interface ItemPlan { report: ItemReport; targets: Target[] }

/**
 * Every Plaid statement in the item's history, newest per id, from no cursor to `has_more: false`.
 * A later page's statement replaces an earlier one for the same id, and within a page `modified`
 * comes after `added` — so a row is enriched from what Plaid says about it now. `removed` is not
 * read: a removal is sync's concern, and this script never removes anything.
 */
async function fetchHistory(deps: BackfillDeps, accessToken: string): Promise<Map<string, Transaction>> {
  const latest = new Map<string, Transaction>();
  let cursor: string | undefined = undefined;
  for (let pages = 1; ; pages++) {
    const page: TransactionsSyncResponse = await deps.fetchPage(accessToken, cursor);
    for (const t of page.added ?? []) latest.set(t.transaction_id, t);
    for (const t of page.modified ?? []) latest.set(t.transaction_id, t);
    if (!page.has_more) return latest;
    // THE WALK MUST BE ABLE TO END (REVIEW-1 N2). `has_more: true` with no next cursor, an empty
    // one, or the cursor just sent would re-request the same page forever against the real API.
    // Thrown rather than returned, so the item fails whole like any other fetch error: nothing it
    // received is applied, because a walk that did not finish is a history that is not complete.
    const next = page.next_cursor;
    if (typeof next !== 'string' || next === '' || next === cursor) throw new WalkError('CURSOR_NOT_ADVANCING');
    if (pages >= MAX_PAGES_PER_ITEM) throw new WalkError('PAGE_LIMIT_EXCEEDED');
    cursor = next;
  }
}

async function planItem(
  deps: BackfillDeps, ordinal: number, accessToken: string, accountIds: string[]
): Promise<ItemPlan> {
  const history = await fetchHistory(deps, accessToken);

  // Only the columns the classification needs. `plaid_raw IS NULL` as a boolean, not the object,
  // so a large history is not pulled into memory just to be tested for presence.
  const local = await deps.db.query<{ id: number; plaid_transaction_id: string; unenriched: boolean }>(
    `SELECT id, plaid_transaction_id, plaid_raw IS NULL AS unenriched
       FROM transactions
      WHERE account_id = ANY($1)`,
    [accountIds]
  );
  const byPlaidId = new Map(local.rows.map((r) => [r.plaid_transaction_id, r]));
  const known = new Set(accountIds);

  const counts = zeroCounts();
  const targets: Target[] = [];
  const matchedRowIds = new Set<number>();
  for (const txn of history.values()) {
    counts.plaid_returned++;
    if (!known.has(txn.account_id)) { counts.unknown_account++; continue; }
    // Pending statements are never stored by sync and never used here: the posted form arrives
    // later, often under a different id, and is what the row should be enriched from.
    if (txn.pending) { counts.pending_skipped++; continue; }
    const row = byPlaidId.get(txn.transaction_id);
    // `byPlaidId` holds this item's accounts only, so an id stored on ANOTHER item's account lands
    // here too, as not local — never a fuzzy re-match, never a new row.
    if (!row) { counts.not_local++; continue; }
    counts.matched++;
    matchedRowIds.add(row.id);
    if (!row.unenriched) { counts.already_enriched++; continue; }
    counts.would_update++;
    targets.push({ rowId: row.id, plaidId: txn.transaction_id, params: enrichmentParams(plaidEnrichment(txn)) });
  }
  counts.local_not_returned = local.rows.filter((r) => r.unenriched && !matchedRowIds.has(r.id)).length;

  return { report: { ordinal, failed: false, errorCode: null, counts }, targets };
}

/**
 * Records in a CSV this file wrote: newlines outside double quotes. A quoted field may hold a
 * newline (an owner's note can), so counting lines would over-count; `""` inside a quoted field
 * toggles twice and so leaves the state as it was. Every record ends in a newline.
 */
export function csvRecordCount(text: string): number {
  let inQuotes = false;
  let records = 0;
  for (const ch of text) {
    if (ch === '"') inQuotes = !inQuotes;
    else if (ch === '\n' && !inQuotes) records++;
  }
  return records;
}

/** One CSV field: NULL as nothing at all, every value quoted, so `""` (empty text) stays distinct. */
function csvField(v: string | null): string {
  return v === null ? '' : `"${v.replace(/"/g, '""')}"`;
}

/**
 * Writes the full pre-update row of every target, as Postgres's own text for each column, and
 * returns the row ids that are in the file.
 *
 * EVERY COLUMN, READ FROM THE CATALOGUE, so a column added to `transactions` later is backed up
 * without anyone remembering this file. AS TEXT (`::text`), because node-postgres would turn a DATE
 * into a local-midnight Date and a NUMERIC through `to_jsonb` into a float on the way back — the CSV
 * must hold the stored value, not a re-rendering of it. Re-checked against `plaid_raw IS NULL` so the
 * file holds exactly the rows the UPDATEs below are allowed to touch.
 *
 * `wx` + mode 0600 + fsync: never overwrites an earlier run's file, is readable by the owner only,
 * and is on disk before the first UPDATE is sent rather than in a buffer the crash would take.
 *
 * AND IT IS CHECKED, NOT ASSUMED (REVIEW-1 N1). `write(2)` may write fewer bytes than asked — a full
 * disk, a quota, a signal — and reports it only in its return value, which a single call ignores.
 * So the write loops until every byte is out, and refuses a call that makes no progress. Then,
 * after fsync and close, the file is read back: it must equal what was meant to be written, byte
 * for byte, and hold exactly one data record per row selected. Any shortfall throws, and the caller
 * then sends no UPDATE at all — a backup that cannot restore every changed row is not a backup.
 */
async function writeBackup(deps: BackfillDeps, dir: string, rowIds: number[]): Promise<{ path: string; ids: Set<number> }> {
  const cols = (await deps.db.query<{ column_name: string }>(
    `SELECT column_name FROM information_schema.columns
      WHERE table_schema = current_schema() AND table_name = 'transactions'
      ORDER BY ordinal_position`
  )).rows.map((r) => r.column_name);
  const ident = (c: string) => `"${c.replace(/"/g, '""')}"`;
  const rows = (await deps.db.query<Record<string, string | null>>(
    `SELECT ${cols.map((c) => `${ident(c)}::text AS ${ident(c)}`).join(', ')}
       FROM transactions
      WHERE id = ANY($1) AND plaid_raw IS NULL
      ORDER BY id`,
    [rowIds]
  )).rows;

  let created = false;
  try { lstatSync(dir); } catch { created = true; }
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  // mkdir's mode passes through the umask; set it outright on a directory this run created. An
  // existing directory's mode is the operator's choice and is left alone.
  if (created) chmodSync(dir, 0o700);

  // Milliseconds kept: two runs in one second must not collide, and `wx` would refuse the second.
  const stamp = deps.now().toISOString().replace(/[-:]/g, '');
  const file = path.join(dir, `enrichment-backfill-${stamp}.csv`);
  const body = Buffer.from(
    [cols.join(','), ...rows.map((r) => cols.map((c) => csvField(r[c])).join(','))].join('\n') + '\n',
    'utf8'
  );
  const fd = openSync(file, 'wx', 0o600);
  try {
    let offset = 0;
    while (offset < body.length) {
      const n = deps.writeChunk(fd, body, offset, body.length - offset);
      if (!(n > 0)) throw new Error('backup write made no progress');
      offset += n;
    }
    fsyncSync(fd);
  } finally {
    closeSync(fd);
  }
  const onDisk = readFileSync(file);
  if (!onDisk.equals(body) || csvRecordCount(onDisk.toString('utf8')) - 1 !== rows.length) {
    throw new Error('backup file does not match the rows selected');
  }
  chmodSync(file, 0o600);
  return { path: file, ids: new Set(rows.map((r) => Number(r.id))) };
}

/**
 * The UPDATEs for one item, in one transaction: an item is enriched whole or not at all. The WHERE
 * repeats the Plaid id as well as the NULL guard, so a row that sync re-identified (renumbered) since
 * the plan is left for sync rather than given another transaction's enrichment.
 */
async function applyItem(deps: BackfillDeps, targets: Target[]): Promise<number> {
  const client = await deps.db.connect();
  let updated = 0;
  try {
    await client.query('BEGIN');
    for (const t of targets) {
      const r = await client.query(
        `UPDATE transactions
            SET plaid_category_detailed   = $3,
                plaid_category_confidence = $4,
                authorized_date           = $5::date,
                payment_channel           = $6,
                merchant_entity_id        = $7,
                logo_url                  = $8,
                website                   = $9,
                location_city             = $10,
                location_region           = $11,
                location_country          = $12,
                plaid_raw                 = $13::jsonb
          WHERE id = $1 AND plaid_transaction_id = $2 AND plaid_raw IS NULL`,
        [t.rowId, t.plaidId, ...t.params]
      );
      updated += r.rowCount ?? 0;
    }
    await client.query('COMMIT');
    return updated;
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}

function countsLine(c: BackfillCounts, apply: boolean): string {
  // `updated` only means something in apply; a dry run printing `updated=0` would read as a result.
  return COUNT_KEYS.filter((k) => apply || k !== 'updated').map((k) => `${k}=${c[k]}`).join(' ');
}

/**
 * The whole run, given validated options. Resolves with the summary in every outcome it can report
 * — a failed item is a count, not a throw — and rejects only when it could not even list the items.
 */
export async function runBackfill(opts: BackfillOptions, deps: BackfillDeps = defaultDeps): Promise<BackfillSummary> {
  const mode = opts.apply ? 'apply' : 'dry-run';
  // Items in a stable order, each named by its smallest account id — which is only ever used to
  // sort. The token is the item's identity here and is never printed.
  const items = (await deps.db.query<{ access_token: string; account_ids: string[] }>(
    `SELECT access_token, array_agg(id ORDER BY id) AS account_ids
       FROM accounts
      WHERE access_token IS NOT NULL
      GROUP BY access_token
      ORDER BY min(id)`
  )).rows;
  deps.out(`backfill-enrichment: mode=${mode} items=${items.length}`);

  const plans: ItemPlan[] = [];
  for (const [i, item] of items.entries()) {
    try {
      plans.push(await planItem(deps, i + 1, item.access_token, item.account_ids));
    } catch (err) {
      // The code and nothing else from `err` — see the header.
      plans.push({ report: { ordinal: i + 1, failed: true, errorCode: safeErrorCode(err), counts: zeroCounts() }, targets: [] });
    }
  }

  let backup: BackfillSummary['backup'] = null;
  let backupFailed = false;
  const allTargets = plans.flatMap((p) => p.targets);
  if (opts.apply && allTargets.length > 0) {
    try {
      const written = await writeBackup(deps, opts.backupDir, allTargets.map((t) => t.rowId));
      backup = { path: written.path, rows: written.ids.size };
      for (const p of plans) p.targets = p.targets.filter((t) => written.ids.has(t.rowId));
    } catch {
      // No UPDATE without a backup. The reason is not printed: a filesystem error message carries
      // the path it failed on, which is fine, but a database one can carry a row's values.
      backupFailed = true;
      deps.err('backup could not be written or verified; nothing was changed');
    }
  }

  if (opts.apply && !backupFailed) {
    for (const p of plans) {
      if (p.report.failed || p.targets.length === 0) continue;
      try {
        p.report.counts.updated = await applyItem(deps, p.targets);
      } catch (err) {
        p.report.failed = true;
        p.report.errorCode = safeErrorCode(err);
        p.report.counts = zeroCounts();
      }
    }
  }

  const totals = zeroCounts();
  for (const p of plans) {
    const r = p.report;
    if (r.failed) {
      deps.err(`item ${r.ordinal} of ${items.length}: failed code=${r.errorCode}`);
      continue;
    }
    for (const k of COUNT_KEYS) totals[k] += r.counts[k];
    deps.out(`item ${r.ordinal} of ${items.length}: ${countsLine(r.counts, opts.apply)}`);
  }
  const itemsFailed = plans.filter((p) => p.report.failed).length;
  deps.out(`totals: ${countsLine(totals, opts.apply)} items_failed=${itemsFailed}`);
  if (backup) deps.out(`backup: rows=${backup.rows} path=${backup.path}`);
  else if (opts.apply && !backupFailed) deps.out('backup: none written, nothing to update');

  return {
    mode,
    items_total: items.length,
    items_failed: itemsFailed,
    items: plans.map((p) => p.report),
    totals,
    backup,
    exitCode: itemsFailed > 0 || backupFailed ? 1 : 0,
  };
}

/**
 * Arguments and the backup-directory refusal first — both before any database or network access —
 * then the run. Returns the exit code rather than exiting, so the test drives it like the shell.
 */
export async function main(
  argv: string[], env: Env = process.env, deps: BackfillDeps = defaultDeps
): Promise<{ exitCode: number; summary: BackfillSummary | null }> {
  let opts: BackfillOptions;
  try {
    opts = parseArgs(argv, env);
    assertBackupDirAllowed(opts.backupDir);
  } catch (err) {
    if (!(err instanceof UsageError)) throw err;
    deps.err(err.message);
    deps.err(USAGE);
    return { exitCode: 2, summary: null };
  }
  try {
    const summary = await runBackfill(opts, deps);
    return { exitCode: summary.exitCode, summary };
  } catch {
    deps.err('backfill could not run (listing items failed); nothing was changed');
    return { exitCode: 1, summary: null };
  }
}

/**
 * True only when this file is the process's entry point. The test imports the module, and importing
 * it must neither connect nor run: `lib/db` and `lib/plaid` are both lazy, and this check is what
 * keeps `main` from starting under the test runner, whose `argv[1]` is its own binary.
 */
export function isEntryPoint(argv: string[] = process.argv): boolean {
  return path.basename(argv[1] ?? '') === 'backfill-enrichment.ts';
}

if (isEntryPoint()) {
  main(process.argv.slice(2))
    .then(async ({ exitCode }) => {
      // Without ending the pool the event loop stays alive and the script never exits.
      await db.end().catch(() => {});
      process.exit(exitCode);
    })
    .catch(async () => {
      console.error('backfill could not run; nothing was changed');
      await db.end().catch(() => {});
      process.exit(1);
    });
}
