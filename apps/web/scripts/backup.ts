/**
 * Take a backup, PROVE IT RESTORES, then prune.
 *
 * ─── Why the rehearsal is in here and not in a runbook ────────────────────────────────────────
 *
 * ROADMAP.md step 20 asks for "nightly `pg_dump` + one rehearsed restore". A restore rehearsed once,
 * by hand, on the day the routine is written, tells you about that day. What goes wrong later is
 * silent: a dump that truncates because the disk filled, a `pg_dump` that starts failing after a
 * server upgrade, a file written where nothing reads it. Every one of those produces a directory
 * full of files that look exactly like backups.
 *
 * So every dump is restored into a scratch database and counted against the source before it is
 * kept. At this size it costs a couple of seconds. The output of this script is not "a backup was
 * written", it is "a backup was written and it came back".
 *
 * ─── The two things that could destroy data, and what stops each ──────────────────────────────
 *
 * RESTORING OVER THE REAL DATABASE. The rehearsal drops and recreates its target. If that target
 * were ever `b8_finance`, this script would be the most dangerous file in the repo. `lib/testDbGuard.ts`
 * already exists to stop the test suite making that mistake and its check is reused here verbatim,
 * because the mistake is identical and a second implementation of the rule is a second thing to get
 * wrong.
 *
 * DELETING A BACKUP SOMEBODY TOOK BY HAND. The pruner only considers files matching this routine's
 * own naming pattern — see `lib/backupPlan.ts`. The directory already holds two dumps taken before
 * risky migrations, which are the only copies of what they contain.
 */
import { execFile } from 'node:child_process';
import { mkdir, readdir, rename, rm, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { backupFilename, compareCounts, selectForDeletion } from '../lib/backupPlan';
import { createLogger } from '../lib/logger';
import { REAL_DATABASE_NAME, databaseNameFromUrl } from '../lib/testDbGuard';

const run = promisify(execFile);
const log = createLogger('backup');

/** Where dumps go. Outside the repo by default, so a backup is never a commit away from a diff. */
const DIR = process.env.BACKUP_DIR ?? join(process.cwd(), '..', 'backups');

/** Thirty at ~140 KB each is about 4 MB. Small enough that the answer to "how many" is "a month". */
const KEEP = Number(process.env.BACKUP_KEEP ?? 30);

/** The rehearsal's target. Dropped and recreated on every run, so it must never be the real one. */
const REHEARSAL_DB = 'b8_restore_rehearsal';

/** Tables whose counts must match after a restore for the dump to be called good. */
const COUNTED = ['transactions', 'accounts', 'budget_categories', 'net_worth_snapshots'];

function sourceUrl(): string {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error('DATABASE_URL is not set; there is nothing to back up');
  return url;
}

/**
 * Nothing this script drops may be the real database, and the source may not be the thing we drop.
 *
 * `REHEARSAL_DB` is a literal so TypeScript can already see it differs from `REAL_DATABASE_NAME` —
 * the compiler calls that comparison unreachable, which is the right answer and not a reason to
 * skip the check at runtime: the constant could be edited, or read from the environment later.
 * Written against the string rather than the literal type so it survives that.
 */
function assertSafeRehearsalTarget(): void {
  const target: string = REHEARSAL_DB;
  if (target === REAL_DATABASE_NAME) {
    throw new Error(`backup: the rehearsal target is ${REAL_DATABASE_NAME}; refusing to drop it`);
  }
  // The other direction, which is the one that actually loses data: if DATABASE_URL somehow points
  // at the rehearsal database, the `dropdb` below would destroy the thing being backed up.
  if (databaseNameFromUrl(sourceUrl()) === target) {
    throw new Error(`backup: DATABASE_URL points at the rehearsal target ${target}; refusing`);
  }
}

async function counts(db: string): Promise<Record<string, number>> {
  const out: Record<string, number> = {};
  for (const table of COUNTED) {
    const { stdout } = await run('psql', ['-d', db, '-tAc', `SELECT count(*) FROM ${table}`]);
    out[table] = Number(stdout.trim());
  }
  return out;
}

async function main(): Promise<void> {
  assertSafeRehearsalTarget();
  await mkdir(DIR, { recursive: true });

  const url = sourceUrl();
  const finalName = backupFilename(new Date());
  const finalPath = join(DIR, finalName);
  // Written under a temp name and renamed only on success. A dump interrupted half way through has
  // a name the pruner ignores and a reader will never mistake for a backup.
  const tempPath = `${finalPath}.partial`;

  await run('pg_dump', ['-Fc', '-d', url, '-f', tempPath]);
  const { size } = await stat(tempPath);
  if (size === 0) throw new Error('backup: pg_dump produced an empty file');

  // ── The rehearsal ───────────────────────────────────────────────────────────────────────────
  const before = await counts(url);
  await run('dropdb', ['--if-exists', REHEARSAL_DB]);
  await run('createdb', [REHEARSAL_DB]);
  try {
    // `pg_restore` reports non-fatal notices on stderr and exits non-zero for them, so the counts
    // below are the check that matters rather than the exit code.
    await run('pg_restore', ['-d', REHEARSAL_DB, '--no-owner', tempPath]).catch(() => undefined);
    const after = await counts(REHEARSAL_DB);

    const mismatches = compareCounts(before, after);
    if (mismatches.length > 0) {
      throw new Error(
        'backup: restore rehearsal failed, the dump is NOT being kept — ' +
        mismatches.map((m) => `${m.table} restored ${m.restored} against ${m.source} in the source`).join('; ')
      );
    }
    log.info('restore rehearsed', { ...before });
  } finally {
    await run('dropdb', ['--if-exists', REHEARSAL_DB]).catch(() => undefined);
  }

  await rename(tempPath, finalPath);
  log.info('backup written', { file: finalName, kb: Math.round(size / 1024) });

  // ── Prune, last ─────────────────────────────────────────────────────────────────────────────
  // After the new dump is in place and verified, so a failure above never costs an old backup.
  const doomed = selectForDeletion(await readdir(DIR), KEEP);
  for (const name of doomed) await rm(join(DIR, name));
  if (doomed.length > 0) log.info('pruned old backups', { deleted: doomed.length, keeping: KEEP });
}

main().then(
  () => process.exit(0),
  (err) => {
    log.error('backup failed', { error: err instanceof Error ? err.message : String(err) });
    process.exit(1);
  }
);
