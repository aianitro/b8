/**
 * Re-key stored Plaid rows to the ids Plaid now uses for the same transactions (P6-40e).
 *
 *   npm run rekey:plaid-ids -w @b8/web                       dry run: counts only, writes nothing
 *   npm run rekey:plaid-ids -w @b8/web -- --apply            CSV backup first, then the UPDATEs
 *   npm run rekey:plaid-ids -w @b8/web -- --apply --backup-dir <dir>
 *
 * Run by hand by the operator; re-runnable, and a second `--apply` changes nothing. Not wired into
 * the daily job, the scheduler or any route, and nothing imports it but its own test.
 *
 * ─── The problem it repairs ───────────────────────────────────────────────────────────────────
 *
 * Some stored rows carry a `plaid_transaction_id` Plaid no longer uses, while Plaid's history holds
 * the same transaction (same account, date, amount and name) under an id that is stored nowhere.
 * Sync's re-identification would have renamed them had it ever been handed that history as `added`
 * — it was not (EVIDENCE.md, "Root cause"). Until they are renamed, 40c cannot enrich them, and the
 * next `modified` event Plaid sends under the new id would be stored as a second copy.
 *
 * ─── "Same transaction" is sync's definition, and only sync's ─────────────────────────────────
 *
 * The match key is imported from `lib/domain/txnMatch` and the pairing itself is made by
 * `matchReissuedTransactions`, the function sync calls, fed exactly as sync feeds it: the stored
 * DATE through the shared date-only helper (never through a UTC conversion, which shifts it a day
 * east of Greenwich), the stored NUMERIC through `Number`, the stored name as stored (NULL stays
 * NULL), and Plaid's date, amount and name as received. A second statement of the key here would be
 * a second definition of one concept (BUILD.md §10.3), and the two would drift.
 *
 * What this adds is the one thing sync deliberately does not do: refuse to choose. Sync claims
 * greedily, lowest row id first, because mid-sync a missed pair costs a duplicate the owner can see.
 * Here a wrong pair costs a silently swapped history, so a key with more than one stored row or more
 * than one free statement is left alone and counted `ambiguous` — decided BEFORE the matcher runs,
 * because after it the greedy choice has already been made. A `csv_`/`manual_` row with the key
 * counts on the stored side (owner decision D-csv): the orphan might really be its lookalike.
 *
 * ─── What it reads ────────────────────────────────────────────────────────────────────────────
 *
 * Each item's history through the shared walk (`plaid-script-shared.ts`): `/transactions/sync` from
 * NO cursor, every page, in memory, the final cursor discarded, and an item whose walk fails on any
 * page — or does not advance, or never ends — fails whole and contributes nothing. The stored
 * `accounts.cursor` is never selected. "Current history" is every id in the walk MINUS every id any
 * page named in `removed` (D3): an id added and then removed is neither present nor a target. Pending
 * statements make their id present but are never a target, as sync never stores one.
 *
 * ─── What it writes, which is one column ──────────────────────────────────────────────────────
 *
 * `plaid_transaction_id`, on an existing row selected by primary key, and nothing else: no new row,
 * no removal (Plaid's `removed` list is read for D3 only), no other column of `transactions` — not
 * the enrichment, which 40c fills in afterwards, not `name` even where the matcher paired a
 * case-or-whitespace difference — and never `accounts` or `transaction_tombstones`. No rules load.
 *
 * Each UPDATE re-checks inside the statement that the row still holds its old id and that the new
 * id is still stored nowhere and not tombstoned. A plan is a reading, and a sync or an owner's delete
 * landing between it and the write would otherwise be overwritten — or, for an id that appeared in
 * the meantime, collide on the unique index and take the whole item's transaction down with it.
 *
 * ─── Order of operations in --apply ───────────────────────────────────────────────────────────
 *
 * 1. Every item is walked and classified; nothing is written yet.
 * 2. One CSV of the FULL current row of every planned row is written, fsynced and read back
 *    (`writeVerifiedBackup`). If that fails, the run stops with nothing changed.
 * 3. Only then the UPDATEs, one transaction per item, and only for rows that are in the CSV.
 *
 * ─── Output carries counts and nothing else ───────────────────────────────────────────────────
 *
 * As 40c: fixed words, the mode, item ordinals, integer counts, the backup path and its row count,
 * and for a failed item Plaid's error CODE if it is one (`^[A-Z_]+$`), otherwise `UNKNOWN`. Never an
 * error object or its message — an axios error carries `PLAID-SECRET` in `.config.headers` — never an
 * id, name, amount or date, and not the structured logger, whose lines carry a timestamp.
 */
import { writeSync } from 'node:fs';
import path from 'node:path';
import type { Transaction, TransactionsSyncResponse } from 'plaid';
import db from '../lib/db';
import { plaidClient } from '../lib/plaid';
import { toDateInputValue } from '../lib/domain/property';
import {
  key as matchKey, matchReissuedTransactions, type ExistingTxn, type IncomingTxn,
} from '../lib/domain/txnMatch';
import {
  assertBackupDirAllowed, parseArgs, safeErrorCode, UsageError, walkHistory, writeVerifiedBackup,
  type Env, type ScriptDb, type ScriptDeps, type ScriptOptions,
} from './plaid-script-shared';

export const USAGE =
  'usage: npm run rekey:plaid-ids -w @b8/web [-- --apply] [--backup-dir <dir>]\n' +
  '  (no flag)          dry run: report counts, write nothing\n' +
  '  --apply            write a CSV backup of the rows to re-key, then re-key them\n' +
  '  --backup-dir <dir> where --apply writes the CSV (default $HOME/b8-backfill-backups;\n' +
  '                     never inside a git work tree or a backups directory)';

/**
 * The real transport, the same request 40c and sync send: the token, the walk's own cursor and the
 * personal-finance option, so the statements are the shape sync maps.
 */
async function fetchPageFromPlaid(accessToken: string, cursor: string | undefined): Promise<TransactionsSyncResponse> {
  const res = await plaidClient().transactionsSync({
    access_token: accessToken,
    cursor,
    options: { include_personal_finance_category: true },
  });
  return res.data;
}

export const defaultDeps: ScriptDeps = {
  db: db as unknown as ScriptDb,
  fetchPage: fetchPageFromPlaid,
  out: (line) => console.log(line),
  err: (line) => console.error(line),
  now: () => new Date(),
  writeChunk: (fd, buf, offset, length) => writeSync(fd, buf, offset, length),
};

// ─── Counting ──────────────────────────────────────────────────────────────────────────────────

/**
 * Every bucket, always present and always a number; each row or statement lands in exactly one.
 *
 * Stored side, every row on the item's accounts, first applicable bucket wins (D4, D5):
 *   stored_rows = excluded_csv_manual + stored_tombstoned + not_orphaned + orphans
 *   orphans     = no_match + excluded_new_id_stored + excluded_new_id_tombstoned + ambiguous + would_rekey
 *
 * Plaid side, every distinct id in the walk:
 *   plaid_returned = plaid_removed + unknown_account + pending + posted
 * `plaid_not_stored` is the part of `posted` stored nowhere and not chosen as a new id — statements
 * the next sync will deliver itself, counted so their number is visible and left alone.
 *
 * Apply only: would_rekey = rekeyed + skipped_at_write.
 */
export interface RekeyCounts {
  stored_rows: number;
  excluded_csv_manual: number;
  stored_tombstoned: number;
  not_orphaned: number;
  orphans: number;
  no_match: number;
  excluded_new_id_stored: number;
  excluded_new_id_tombstoned: number;
  ambiguous: number;
  would_rekey: number;
  plaid_returned: number;
  plaid_removed: number;
  unknown_account: number;
  pending: number;
  posted: number;
  plaid_not_stored: number;
  rekeyed: number;
  skipped_at_write: number;
}

const COUNT_KEYS: (keyof RekeyCounts)[] = [
  'stored_rows', 'excluded_csv_manual', 'stored_tombstoned', 'not_orphaned', 'orphans',
  'no_match', 'excluded_new_id_stored', 'excluded_new_id_tombstoned', 'ambiguous', 'would_rekey',
  'plaid_returned', 'plaid_removed', 'unknown_account', 'pending', 'posted', 'plaid_not_stored',
  'rekeyed', 'skipped_at_write',
];

/** Meaningful only after an apply; a dry run printing `rekeyed=0` would read as a result. */
const APPLY_ONLY = new Set<keyof RekeyCounts>(['rekeyed', 'skipped_at_write']);

function zeroCounts(): RekeyCounts {
  return Object.fromEntries(COUNT_KEYS.map((k) => [k, 0])) as unknown as RekeyCounts;
}

export interface ItemReport {
  ordinal: number;
  failed: boolean;
  /** Plaid's error code when it matched `^[A-Z_]+$`, else `UNKNOWN`; null for an item that did not fail. */
  errorCode: string | null;
  counts: RekeyCounts;
}

export interface RekeySummary {
  mode: 'dry-run' | 'apply';
  items_total: number;
  items_failed: number;
  items: ItemReport[];
  /** Sums over the items that did not fail. */
  totals: RekeyCounts;
  /** Null when no CSV was written — always in a dry run, and in an apply with nothing to re-key. */
  backup: { path: string; rows: number } | null;
  exitCode: number;
}

// ─── Planning ──────────────────────────────────────────────────────────────────────────────────

interface Target { rowId: number; oldId: string; newId: string }
interface ItemPlan { report: ItemReport; targets: Target[] }

interface StoredRow {
  id: number; plaid_transaction_id: string; account_id: string; date: Date; amount: string; name: string | null;
}

/** A stored row in the matcher's shape, converted exactly as `lib/sync.ts` converts it. */
function asExisting(r: StoredRow): ExistingTxn {
  return {
    id: r.id, plaidTransactionId: r.plaid_transaction_id, accountId: r.account_id,
    date: toDateInputValue(r.date), amount: Number(r.amount), name: r.name,
  };
}

/** A Plaid statement in the matcher's shape, as `lib/sync.ts` passes it: Plaid's values as given. */
function asIncoming(t: Transaction): IncomingTxn {
  return {
    plaidTransactionId: t.transaction_id, accountId: t.account_id,
    date: t.date, amount: t.amount, name: t.name ?? null,
  };
}

/** `csv_` and `manual_` rows are the owner's own imports: never re-keyed (owner decision). */
function isCsvOrManual(plaidId: string): boolean {
  return plaidId.startsWith('csv_') || plaidId.startsWith('manual_');
}

async function planItem(deps: ScriptDeps, ordinal: number, accessToken: string, accountIds: string[]): Promise<ItemPlan> {
  const history = await walkHistory(deps.fetchPage, accessToken);
  const counts = zeroCounts();
  const known = new Set(accountIds);

  // The Plaid side. `current` is D3's history: the walk minus everything `removed` named. Presence
  // (D4) is by id alone, on any account — the conservative reading: a stored id Plaid still sends
  // is never renamed, whatever account Plaid now files it under. Targets are narrower: posted, and
  // on one of THIS item's accounts, so a statement from another item's walk, or for an account this
  // database does not hold, can never be paired (D2).
  const current = new Set<string>();
  const posted: Transaction[] = [];
  for (const [id, t] of history.latest) {
    counts.plaid_returned++;
    if (history.removed.has(id)) { counts.plaid_removed++; continue; }
    current.add(id);
    if (!known.has(t.account_id)) { counts.unknown_account++; continue; }
    if (t.pending) { counts.pending++; continue; }
    counts.posted++;
    posted.push(t);
  }

  const stored = (await deps.db.query<StoredRow & Record<string, unknown>>(
    `SELECT id, plaid_transaction_id, account_id, date, amount, name
       FROM transactions
      WHERE account_id = ANY($1)
      ORDER BY id`,
    [accountIds]
  )).rows;

  // GLOBAL, not this item's rows: an id stored on any row anywhere cannot be given to a second row
  // (the unique index would refuse it mid-transaction, and before that it would be a duplicate).
  const postedIds = posted.map((t) => t.transaction_id);
  const storedAnywhere = new Set((await deps.db.query<{ plaid_transaction_id: string }>(
    'SELECT plaid_transaction_id FROM transactions WHERE plaid_transaction_id = ANY($1)',
    [postedIds]
  )).rows.map((r) => r.plaid_transaction_id));
  // Read only. Both roles: a stored row bearing a tombstoned id is kept out of the pool, and a
  // tombstoned statement is never a target and takes no claim — sync's re-identification rule.
  const tombstoned = new Set((await deps.db.query<{ plaid_transaction_id: string }>(
    'SELECT plaid_transaction_id FROM transaction_tombstones WHERE plaid_transaction_id = ANY($1)',
    [[...postedIds, ...stored.map((r) => r.plaid_transaction_id)]]
  )).rows.map((r) => r.plaid_transaction_id));

  // The stored side (D4), first applicable bucket wins.
  const orphans: ExistingTxn[] = [];
  const storedPerKey = new Map<string, number>();
  const countStored = (e: ExistingTxn) => {
    const k = matchKey(e);
    storedPerKey.set(k, (storedPerKey.get(k) ?? 0) + 1);
  };
  for (const r of stored) {
    counts.stored_rows++;
    const id = r.plaid_transaction_id;
    if (isCsvOrManual(id)) { counts.excluded_csv_manual++; countStored(asExisting(r)); continue; }
    if (tombstoned.has(id)) { counts.stored_tombstoned++; continue; }
    if (current.has(id)) { counts.not_orphaned++; continue; }
    counts.orphans++;
    const e = asExisting(r);
    countStored(e);
    orphans.push(e);
  }

  const candidatesPerKey = new Map<string, IncomingTxn[]>();
  for (const t of posted) {
    const c = asIncoming(t);
    const k = matchKey(c);
    if (!candidatesPerKey.has(k)) candidatesPerKey.set(k, []);
    candidatesPerKey.get(k)!.push(c);
  }

  // Each orphan (D5). Ambiguity is settled per key before any pairing, and counted once per orphan.
  const targets: Target[] = [];
  const chosen = new Set<string>();
  for (const o of orphans) {
    const k = matchKey(o);
    const all = candidatesPerKey.get(k) ?? [];
    if (all.length === 0) { counts.no_match++; continue; }
    const free = all.filter((c) => !storedAnywhere.has(c.plaidTransactionId) && !tombstoned.has(c.plaidTransactionId));
    if (free.length === 0) {
      if (all.some((c) => storedAnywhere.has(c.plaidTransactionId))) counts.excluded_new_id_stored++;
      else counts.excluded_new_id_tombstoned++;
      continue;
    }
    if (storedPerKey.get(k) !== 1 || free.length !== 1) { counts.ambiguous++; continue; }
    // One stored row, one free statement, one key: the pairing is the matcher's own. If the matcher
    // declined the pair the key just grouped, the key above and the matcher would disagree — two
    // definitions — and the item fails rather than guessing which one is right.
    const { reidentify } = matchReissuedTransactions(free, [o]);
    if (reidentify.length !== 1 || reidentify[0].existingId !== o.id) {
      throw new Error('match key and matcher disagree');
    }
    counts.would_rekey++;
    chosen.add(reidentify[0].newPlaidTransactionId);
    targets.push({ rowId: o.id, oldId: o.plaidTransactionId, newId: reidentify[0].newPlaidTransactionId });
  }
  counts.plaid_not_stored = posted.filter((t) => !storedAnywhere.has(t.transaction_id) && !chosen.has(t.transaction_id)).length;

  return { report: { ordinal, failed: false, errorCode: null, counts }, targets };
}

// ─── Writing ───────────────────────────────────────────────────────────────────────────────────

/**
 * The UPDATEs for one item, in one transaction: an item is re-keyed whole or not at all. Selected by
 * primary key AND the old id, so a row sync renamed since the plan is left as sync left it; and the
 * new id re-checked against every stored row and every tombstone at the moment of the write. A row
 * any of those three refuses is counted `skipped_at_write`, not an error: the next run re-plans it.
 */
async function applyItem(deps: ScriptDeps, targets: Target[]): Promise<{ rekeyed: number; skipped: number }> {
  const client = await deps.db.connect();
  let rekeyed = 0;
  try {
    await client.query('BEGIN');
    for (const t of targets) {
      const r = await client.query(
        `UPDATE transactions
            SET plaid_transaction_id = $3
          WHERE id = $1
            AND plaid_transaction_id = $2
            AND NOT EXISTS (SELECT 1 FROM transactions other WHERE other.plaid_transaction_id = $3)
            AND NOT EXISTS (SELECT 1 FROM transaction_tombstones tt WHERE tt.plaid_transaction_id = $3)`,
        [t.rowId, t.oldId, t.newId]
      );
      rekeyed += r.rowCount ?? 0;
    }
    await client.query('COMMIT');
    return { rekeyed, skipped: targets.length - rekeyed };
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}

function countsLine(c: RekeyCounts, apply: boolean): string {
  return COUNT_KEYS.filter((k) => apply || !APPLY_ONLY.has(k)).map((k) => `${k}=${c[k]}`).join(' ');
}

// ─── The run ───────────────────────────────────────────────────────────────────────────────────

/**
 * The whole run, given validated options. Resolves with the summary in every outcome it can report
 * — a failed item is a count, not a throw — and rejects only when it could not even list the items.
 */
export async function runRekey(opts: ScriptOptions, deps: ScriptDeps = defaultDeps): Promise<RekeySummary> {
  const mode = opts.apply ? 'apply' : 'dry-run';
  // Items in a stable order, each named by its smallest account id — used only to sort. The token
  // is the item's identity here and is never printed.
  const items = (await deps.db.query<{ access_token: string; account_ids: string[] }>(
    `SELECT access_token, array_agg(id ORDER BY id) AS account_ids
       FROM accounts
      WHERE access_token IS NOT NULL
      GROUP BY access_token
      ORDER BY min(id)`
  )).rows;
  deps.out(`rekey-plaid-ids: mode=${mode} items=${items.length}`);

  const plans: ItemPlan[] = [];
  for (const [i, item] of items.entries()) {
    try {
      plans.push(await planItem(deps, i + 1, item.access_token, item.account_ids));
    } catch (err) {
      // The code and nothing else from `err` — see the header.
      plans.push({ report: { ordinal: i + 1, failed: true, errorCode: safeErrorCode(err), counts: zeroCounts() }, targets: [] });
    }
  }

  let backup: RekeySummary['backup'] = null;
  let backupFailed = false;
  const allTargets = plans.flatMap((p) => p.targets);
  if (opts.apply && allTargets.length > 0) {
    try {
      const written = await writeVerifiedBackup(deps, opts.backupDir, allTargets.map((t) => t.rowId), { fileStem: 'plaid-rekey' });
      backup = { path: written.path, rows: written.ids.size };
      // A planned row missing from the file (gone between the plan and the backup) is not attempted,
      // and is counted with the rows the write-time checks refused, so the dry run's `would_rekey`
      // still equals `rekeyed + skipped_at_write`.
      for (const p of plans) {
        const kept = p.targets.filter((t) => written.ids.has(t.rowId));
        p.report.counts.skipped_at_write += p.targets.length - kept.length;
        p.targets = kept;
      }
    } catch {
      // No UPDATE without a backup. The reason is not printed: a database error can carry a row's values.
      backupFailed = true;
      deps.err('backup could not be written or verified; nothing was changed');
    }
  }

  if (opts.apply && !backupFailed) {
    for (const p of plans) {
      if (p.report.failed || p.targets.length === 0) continue;
      try {
        const r = await applyItem(deps, p.targets);
        p.report.counts.rekeyed = r.rekeyed;
        p.report.counts.skipped_at_write += r.skipped;
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
  else if (opts.apply && !backupFailed) deps.out('backup: none written, nothing to re-key');

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
  argv: string[], env: Env = process.env, deps: ScriptDeps = defaultDeps
): Promise<{ exitCode: number; summary: RekeySummary | null }> {
  let opts: ScriptOptions;
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
    const summary = await runRekey(opts, deps);
    return { exitCode: summary.exitCode, summary };
  } catch {
    deps.err('rekey could not run (listing items failed); nothing was changed');
    return { exitCode: 1, summary: null };
  }
}

/**
 * True only when this file is the process's entry point. The test imports the module, and importing
 * it must neither connect nor run: `lib/db` and `lib/plaid` are both lazy, and this check is what
 * keeps `main` from starting under the test runner, whose `argv[1]` is its own binary.
 */
export function isEntryPoint(argv: string[] = process.argv): boolean {
  return path.basename(argv[1] ?? '') === 'rekey-plaid-ids.ts';
}

if (isEntryPoint()) {
  main(process.argv.slice(2))
    .then(async ({ exitCode }) => {
      // Without ending the pool the event loop stays alive and the script never exits.
      await db.end().catch(() => {});
      process.exit(exitCode);
    })
    .catch(async () => {
      console.error('rekey could not run; nothing was changed');
      await db.end().catch(() => {});
      process.exit(1);
    });
}
