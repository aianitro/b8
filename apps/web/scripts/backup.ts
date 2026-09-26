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
import { chmod, mkdir, readFile, readdir, rename, rm, stat } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { join } from 'node:path';
import { promisify } from 'node:util';
import {
  backupFilename, compareCounts, envBackupFilename, newestEnvHash,
  selectEnvForDeletion, selectForDeletion,
} from '../lib/backupPlan';
import { createLogger } from '../lib/logger';
import { REAL_DATABASE_NAME, databaseNameFromUrl } from '../lib/testDbGuard';

const run = promisify(execFile);
const log = createLogger('backup');

/** Where dumps go. Outside the repo by default, so a backup is never a commit away from a diff. */
const DIR = process.env.BACKUP_DIR ?? join(process.cwd(), '..', 'backups');

/** Thirty at ~140 KB each is about 4 MB. Small enough that the answer to "how many" is "a month". */
const KEEP = Number(process.env.BACKUP_KEEP ?? 30);

/**
 * The age public key every dump is encrypted to, or unset to keep writing them in the clear.
 *
 * ─── THE MACHINE CANNOT READ ITS OWN BACKUPS ──────────────────────────────────────────────────
 *
 * This is a PUBLIC key, and the private half is not on this server and must never be. So the box
 * can create backups and cannot open them — which is the property worth having on a nine-year-old
 * laptop that lives in a flat and may one day be carried out of it. A dump is the whole ledger:
 * every merchant, balance, mortgage and valuation. Encrypting at rest costs nothing and means
 * losing the machine is not the same as losing the data to whoever has it.
 *
 * It also means the destination stops mattering. Ciphertext can go to Drive, iCloud or anywhere
 * else without that being a decision about who gets to read the household's finances.
 *
 * UNSET IS A LEGITIMATE STATE, not a failure: the laptop, CI and any throwaway run have no key and
 * should still be able to take a backup. It is logged loudly either way, because silently writing
 * plaintext when someone believed otherwise is the worse error of the two.
 */
const RECIPIENT = process.env.BACKUP_AGE_RECIPIENT?.trim() || null;

/** `age` is a single static binary; on the server it lives outside PATH's usual places. */
const AGE_BIN = process.env.AGE_BIN ?? 'age';

/**
 * The credentials file, and how many distinct versions of it to keep.
 *
 * Ten rather than thirty, because captures are written only when the contents CHANGE: ten of these
 * may be several years of configuration, where thirty dumps are a month of data.
 */
const ENV_FILE = process.env.BACKUP_ENV_FILE ?? join(process.cwd(), '.env.local');
const ENV_KEEP = Number(process.env.BACKUP_ENV_KEEP ?? 10);

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

/**
 * Capture `.env.local`, encrypted, and only when it has changed.
 *
 * ─── WHY THIS EXISTS ──────────────────────────────────────────────────────────────────────────
 *
 * Every dump in this directory restores the DATA and none of the CONNECTIONS. `.env.local` holds the
 * Plaid secret, the SMTP credentials and the VAPID private key, so a restore onto a new machine came
 * back with a working database and a app that could not sync, mail, or notify — and no copy of those
 * values existed anywhere but the disk most likely to die.
 *
 * ─── ENCRYPTED OR NOT AT ALL ──────────────────────────────────────────────────────────────────
 *
 * The dump above is written plain when no recipient is set, deliberately: that data is already on
 * this disk in Postgres, so refusing to back it up would cost more than it saves. This inverts it.
 * The file is nothing but credentials, and this directory is replicated to a laptop and to Google
 * Drive — neither of which `.env.local` reaches today. Writing it plain here would create exposure
 * in two places off this machine that does not otherwise exist. So a missing recipient SKIPS the
 * capture and says so loudly, and no plaintext copy is ever produced: `age` reads the source file
 * directly and the only new file on disk is already encrypted.
 *
 * ─── AND IT NEVER LOGS A LINE OF THE FILE ─────────────────────────────────────────────────────
 *
 * Not the contents, not a parsed key, not a diff of what changed. The log is the one artifact here
 * that is read casually, shipped around, and pasted into an issue. It gets a filename and a size.
 */
async function captureEnv(): Promise<void> {
  let contents: Buffer;
  try {
    contents = await readFile(ENV_FILE);
  } catch {
    log.warn('no .env.local to capture — a restore will not carry the credentials', { path: ENV_FILE });
    return;
  }
  if (contents.length === 0) {
    log.warn('.env.local is empty; not capturing it over a previous good capture');
    return;
  }
  if (!RECIPIENT) {
    log.warn('NOT capturing .env.local — no BACKUP_AGE_RECIPIENT, and credentials are never written here in the clear');
    return;
  }

  const digest = createHash('sha256').update(contents).digest('hex');
  const existing = await readdir(DIR);
  if (newestEnvHash(existing) === digest.slice(0, 12)) return;  // unchanged; nothing to say

  const name = envBackupFilename(new Date(), digest);
  const path = join(DIR, name);
  // `age` reads ENV_FILE itself, so the plaintext is never duplicated — not to a temp file, not
  // through this process's memory on its way to disk.
  await run(AGE_BIN, ['-r', RECIPIENT, '-o', path, ENV_FILE]);
  const { size } = await stat(path);
  if (size === 0) {
    await rm(path).catch(() => undefined);
    throw new Error('backup: age produced an empty .env.local capture');
  }
  // 600 explicitly. This is the one file here whose plaintext is pure credential, and although the
  // ciphertext is useless without the key, a readable-by-anyone name is a habit worth not having.
  await chmod(path, 0o600);
  log.info('captured .env.local (it changed)', { file: name, bytes: size });

  const doomed = selectEnvForDeletion(await readdir(DIR), ENV_KEEP);
  for (const n of doomed) await rm(join(DIR, n));
  if (doomed.length > 0) log.info('pruned old .env.local captures', { deleted: doomed.length, keeping: ENV_KEEP });
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

  // ── Encryption, AFTER the rehearsal ─────────────────────────────────────────────────────────
  //
  // The order is the point. The rehearsal restores the dump to prove it is readable, and it cannot
  // do that to ciphertext without the private key — which is deliberately not on this machine. So
  // the plaintext exists only as the temp file, is verified there, and is encrypted on its way to
  // its final name. What lands on disk has been restored once and can be read by nobody here.
  if (RECIPIENT) {
    const encryptedPath = `${finalPath}.age`;
    await run(AGE_BIN, ['-r', RECIPIENT, '-o', encryptedPath, tempPath]);
    const encrypted = await stat(encryptedPath);
    if (encrypted.size === 0) throw new Error('backup: age produced an empty file');
    await rm(tempPath);
    log.info('backup written', {
      file: `${finalName}.age`, kb: Math.round(encrypted.size / 1024), encrypted: true,
    });
  } else {
    await rename(tempPath, finalPath);
    log.warn('backup written UNENCRYPTED — set BACKUP_AGE_RECIPIENT to encrypt it', {
      file: finalName, kb: Math.round(size / 1024), encrypted: false,
    });
  }

  // ── Prune, last ─────────────────────────────────────────────────────────────────────────────
  // After the new dump is in place and verified, so a failure above never costs an old backup.
  const doomed = selectForDeletion(await readdir(DIR), KEEP);
  for (const name of doomed) await rm(join(DIR, name));
  if (doomed.length > 0) log.info('pruned old backups', { deleted: doomed.length, keeping: KEEP });

  // ── The credentials, last and non-fatally ───────────────────────────────────────────────────
  //
  // Caught rather than thrown, for the same reason `daily.sh` joins its steps with `;` and not
  // `&&`: the dump is the artifact that matters, it is already written and verified by this point,
  // and a missing `age` binary or a renamed env file must not turn a good backup into a failed run.
  // It is loud in the log and invisible to the exit code.
  await captureEnv().catch((err) => {
    log.error('capturing .env.local failed; the dump above is unaffected', {
      error: err instanceof Error ? err.message : String(err),
    });
  });
}

main().then(
  () => process.exit(0),
  (err) => {
    log.error('backup failed', { error: err instanceof Error ? err.message : String(err) });
    process.exit(1);
  }
);
