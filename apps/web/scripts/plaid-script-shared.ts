/**
 * The machinery two operator scripts share: P6-40c's enrichment backfill and P6-40e's id re-key.
 *
 * Extracted from `backfill-enrichment.ts` rather than copied into the second script, because every
 * piece here is a safety property that was argued, reviewed and fixed once (REVIEW-1 N1/N2 of 40c):
 * the strict flags, the refusal of a backup directory that could reach a public commit or another
 * machine, the backup that is read back before anything is changed, the error-code allowlist that
 * keeps `PLAID-SECRET` out of the output, and the history walk that cannot loop. Two copies would be
 * two places for one of those fixes to be missing (BUILD.md §10.3, "two definitions of one concept").
 *
 * What stays in each script is what genuinely differs: its usage text, its transport (one
 * `/transactions/sync` call), what it plans, and the one UPDATE it is allowed to send. Nothing in
 * this file writes to the database; the only SQL here is the two reads the backup needs.
 */
import { closeSync, fsyncSync, lstatSync, mkdirSync, chmodSync, openSync, readFileSync, realpathSync } from 'node:fs';
import { homedir } from 'node:os';
import path from 'node:path';
import type { Transaction, TransactionsSyncResponse } from 'plaid';

// ─── Arguments ─────────────────────────────────────────────────────────────────────────────────

/** The environment, as far as these scripts read it (`HOME`); a test passes a literal. */
export type Env = Readonly<Record<string, string | undefined>>;

/** Thrown for anything the operator typed wrong. Caught by `main`, which prints the usage. */
export class UsageError extends Error {}

export interface ScriptOptions {
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
export function parseArgs(argv: string[], env: Env = process.env): ScriptOptions {
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
 * `backups`, before any database or network access (40c's G0 amendment 4).
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

// ─── Dependencies, injectable for the tests ────────────────────────────────────────────────────

/** The slice of `lib/db` these scripts use. A test wraps the real one to observe the write order. */
export interface ScriptDb {
  query<R extends Record<string, unknown> = Record<string, unknown>>(
    text: string, values?: unknown[]
  ): Promise<{ rows: R[]; rowCount: number | null }>;
  connect(): Promise<{
    query(text: string, values?: unknown[]): Promise<{ rowCount: number | null }>;
    release(): void;
  }>;
}

export interface ScriptDeps {
  db: ScriptDb;
  /** One `/transactions/sync` page for `accessToken`, starting at `cursor` (undefined = from the start). */
  fetchPage(accessToken: string, cursor: string | undefined): Promise<TransactionsSyncResponse>;
  out(line: string): void;
  err(line: string): void;
  /** Injected so a test can make the file name deterministic; never printed except inside the path. */
  now(): Date;
  /**
   * One `write(2)` of `length` bytes of `buf` from `offset`, returning the bytes written — the shape
   * of `fs.writeSync`, which is the default. Injectable so a test can make the kernel's short write,
   * or a write that claims bytes it did not put on disk, happen on demand (40c BF-18, 40e RK-14).
   */
  writeChunk(fd: number, buf: Buffer, offset: number, length: number): number;
}

// ─── Errors that may be printed ────────────────────────────────────────────────────────────────

/**
 * A history walk a script stopped itself, with a code of its own in Plaid's `^[A-Z_]+$` shape.
 * Its message is fixed text, and it is never printed anyway — only `code` is.
 */
export class WalkError extends Error {
  constructor(readonly code: 'CURSOR_NOT_ADVANCING' | 'PAGE_LIMIT_EXCEEDED') {
    super(code);
  }
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

// ─── The history walk ──────────────────────────────────────────────────────────────────────────

/**
 * The most pages one item's walk may take before it is abandoned as failed (40c REVIEW-1 N2).
 * Generous on purpose: Plaid's sync pages hold up to a few hundred transactions, so this is far
 * beyond any household's history, and it exists only so that a Plaid that keeps answering
 * `has_more: true` with fresh cursors cannot hold the run — and the API — in a loop forever.
 */
export const MAX_PAGES_PER_ITEM = 10000;

export interface History {
  /**
   * Every statement in the walk, newest per id. A later page's statement replaces an earlier one for
   * the same id, and within a page `modified` comes after `added` — so the map holds what Plaid
   * says about each transaction now.
   */
  latest: Map<string, Transaction>;
  /**
   * Every id named in any page's `removed` list. Collected, never acted on: 40c ignores it (it
   * removes nothing and only enriches ids that are stored), and 40e reads it to decide which ids
   * are still current. Neither deletes a local row because of it.
   */
  removed: Set<string>;
}

/**
 * An item's whole history from `/transactions/sync`, from NO cursor to `has_more: false`, in
 * memory. The caller never passes a cursor in and never gets the final one out: starting from the
 * stored `accounts.cursor` would return only what changed since the last sync, and handing the end
 * cursor back would invite saving it, which would tell the next real sync it had already seen
 * everything.
 */
export async function walkHistory(
  fetchPage: ScriptDeps['fetchPage'], accessToken: string
): Promise<History> {
  const latest = new Map<string, Transaction>();
  const removed = new Set<string>();
  let cursor: string | undefined = undefined;
  for (let pages = 1; ; pages++) {
    const page: TransactionsSyncResponse = await fetchPage(accessToken, cursor);
    for (const t of page.added ?? []) latest.set(t.transaction_id, t);
    for (const t of page.modified ?? []) latest.set(t.transaction_id, t);
    for (const r of page.removed ?? []) removed.add(r.transaction_id);
    if (!page.has_more) return { latest, removed };
    // THE WALK MUST BE ABLE TO END (40c REVIEW-1 N2). `has_more: true` with no next cursor, an empty
    // one, or the cursor just sent would re-request the same page forever against the real API.
    // Thrown rather than returned, so the item fails whole like any other fetch error: nothing it
    // received is applied, because a walk that did not finish is a history that is not complete.
    const next = page.next_cursor;
    if (typeof next !== 'string' || next === '' || next === cursor) throw new WalkError('CURSOR_NOT_ADVANCING');
    if (pages >= MAX_PAGES_PER_ITEM) throw new WalkError('PAGE_LIMIT_EXCEEDED');
    cursor = next;
  }
}

// ─── The verified backup ───────────────────────────────────────────────────────────────────────

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

export interface BackupSpec {
  /** The file name's prefix; the timestamp and `.csv` follow. */
  fileStem: string;
  /**
   * A fixed SQL predicate, ANDed to `id = ANY($1)`, that the row must still satisfy to be backed up
   * — and therefore to be updated, since only rows in the file are. 40c's is `plaid_raw IS NULL`.
   * Always a literal in the calling script, never built from data.
   */
  stillTarget?: string;
}

/**
 * Writes the full pre-update row of every target, as Postgres's own text for each column, and
 * returns the row ids that are in the file.
 *
 * EVERY COLUMN, READ FROM THE CATALOGUE, so a column added to `transactions` later is backed up
 * without anyone remembering this file. AS TEXT (`::text`), because node-postgres would turn a DATE
 * into a local-midnight Date and a NUMERIC through `to_jsonb` into a float on the way back — the CSV
 * must hold the stored value, not a re-rendering of it.
 *
 * `wx` + mode 0600 + fsync: never overwrites an earlier run's file, is readable by the owner only,
 * and is on disk before the first UPDATE is sent rather than in a buffer the crash would take.
 *
 * AND IT IS CHECKED, NOT ASSUMED (40c REVIEW-1 N1). `write(2)` may write fewer bytes than asked — a
 * full disk, a quota, a signal — and reports it only in its return value, which a single call
 * ignores. So the write loops until every byte is out, and refuses a call that makes no progress.
 * Then, after fsync and close, the file is read back: it must equal what was meant to be written,
 * byte for byte, and hold exactly one data record per row selected. Any shortfall throws, and the
 * caller then sends no UPDATE at all — a backup that cannot restore every changed row is not a backup.
 */
export async function writeVerifiedBackup(
  deps: Pick<ScriptDeps, 'db' | 'now' | 'writeChunk'>, dir: string, rowIds: number[], spec: BackupSpec
): Promise<{ path: string; ids: Set<number> }> {
  const cols = (await deps.db.query<{ column_name: string }>(
    `SELECT column_name FROM information_schema.columns
      WHERE table_schema = current_schema() AND table_name = 'transactions'
      ORDER BY ordinal_position`
  )).rows.map((r) => r.column_name);
  const ident = (c: string) => `"${c.replace(/"/g, '""')}"`;
  const rows = (await deps.db.query<Record<string, string | null>>(
    `SELECT ${cols.map((c) => `${ident(c)}::text AS ${ident(c)}`).join(', ')}
       FROM transactions
      WHERE id = ANY($1)${spec.stillTarget ? ` AND ${spec.stillTarget}` : ''}
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
  const file = path.join(dir, `${spec.fileStem}-${stamp}.csv`);
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
