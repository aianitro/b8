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
import { writeSync } from 'node:fs';
import path from 'node:path';
import type { Transaction, TransactionsSyncResponse } from 'plaid';
import db from '../lib/db';
import { plaidClient } from '../lib/plaid';
import { enrichmentParams, plaidEnrichment } from '../lib/plaidEnrichment';
// The arguments, the backup-directory refusal, the verified backup, the error-code allowlist and
// the history walk live in one module that P6-40e's re-key script shares, so a fix to any of them
// lands in both. Re-exported under the names this script has always exported, so its own test and
// anything reading it see the same surface as before the extraction.
import {
  assertBackupDirAllowed, parseArgs, safeErrorCode, UsageError, walkHistory, writeVerifiedBackup,
  type Env, type ScriptDb, type ScriptDeps, type ScriptOptions,
} from './plaid-script-shared';

export {
  assertBackupDirAllowed, csvRecordCount, defaultBackupDir, MAX_PAGES_PER_ITEM, parseArgs, safeErrorCode,
  UsageError, WalkError, type Env,
} from './plaid-script-shared';

// ─── Arguments ─────────────────────────────────────────────────────────────────────────────────

export const USAGE =
  'usage: npm run backfill:enrichment -w @b8/web [-- --apply] [--backup-dir <dir>]\n' +
  '  (no flag)          dry run: report counts, write nothing\n' +
  '  --apply            write a CSV backup of the rows to change, then update them\n' +
  '  --backup-dir <dir> where --apply writes the CSV (default $HOME/b8-backfill-backups;\n' +
  '                     never inside a git work tree or a backups directory)';

export type BackfillOptions = ScriptOptions;

// ─── Dependencies, injectable for the test ─────────────────────────────────────────────────────

/** The slice of `lib/db` this script uses. A test wraps the real one to observe the write order. */
export type BackfillDb = ScriptDb;

export type BackfillDeps = ScriptDeps;

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

// ─── The run ───────────────────────────────────────────────────────────────────────────────────

interface Target { rowId: number; plaidId: string; params: (string | null)[] }
interface ItemPlan { report: ItemReport; targets: Target[] }

/**
 * Every Plaid statement in the item's history, newest per id, from no cursor to `has_more: false`
 * — the shared walk, with its cursor-must-advance and page-cap guards. `removed` is not read here: a
 * removal is sync's concern, and this script never removes anything.
 */
async function fetchHistory(deps: BackfillDeps, accessToken: string): Promise<Map<string, Transaction>> {
  return (await walkHistory(deps.fetchPage, accessToken)).latest;
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
 * The shared verified backup of the full pre-update rows, re-checked against `plaid_raw IS NULL` so
 * the file holds exactly the rows the UPDATEs below are allowed to touch.
 */
function writeBackup(deps: BackfillDeps, dir: string, rowIds: number[]): Promise<{ path: string; ids: Set<number> }> {
  return writeVerifiedBackup(deps, dir, rowIds, { fileStem: 'enrichment-backfill', stillTarget: 'plaid_raw IS NULL' });
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
