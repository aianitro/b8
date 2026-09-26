/**
 * What to call a backup and which ones to delete — the two decisions in a backup routine that can
 * lose data, kept pure so they can be tested without a database or a filesystem.
 *
 * The dump itself, the restore rehearsal and the deleting all live in `scripts/backup.ts`. What is
 * here is the arithmetic that tells it what to do.
 */

/**
 * Files this routine writes, and the only files it will ever consider deleting.
 *
 * `.age` IS OPTIONAL BECAUSE ENCRYPTION IS. A dump is encrypted when `BACKUP_AGE_RECIPIENT` is
 * set and written plain when it is not, and the pruner has to recognise both — a pattern that
 * matched only the plain name would quietly stop pruning the day encryption was turned on, and a
 * retention rule that silently retains everything is the kind of bug found by a full disk.
 *
 * Both sort correctly together: the timestamp precedes the extension, so a mixed directory still
 * orders by date rather than by whether a file happens to be encrypted.
 */
const NAME = /^b8_finance_(\d{8}T\d{6}Z)\.dump(?:\.age)?$/;

/**
 * Captures of `.env.local`: `b8_env_20260926T130000Z_1f3a9c2b4d5e.env.age`.
 *
 * ─── `.age` IS NOT OPTIONAL HERE, UNLIKE THE DUMP ABOVE ───────────────────────────────────────
 *
 * A dump is written plain when no recipient is set, because the trade is worth it: that data already
 * sits in Postgres on the same disk, so a plaintext dump beside it adds little, and refusing to back
 * up at all would be worse. `.env.local` inverts both halves. It is nothing but credentials, and the
 * backup directory is replicated to a laptop and to Google Drive — neither of which `.env.local`
 * reaches today. A plaintext capture there would MANUFACTURE exposure that does not otherwise exist,
 * in two places outside this machine. So the routine skips the capture rather than writing one in
 * the clear, and says so; there is no plain form of this name to match.
 *
 * THE HASH IN THE NAME IS WHAT MAKES RETENTION MEAN SOMETHING. The server cannot read its own
 * captures back — the private key is deliberately elsewhere — so it cannot ask "has this changed
 * since last time" by decrypting. Carrying the digest of the plaintext in the filename answers it
 * without a sidecar file and without the key: a capture is written only when the newest existing one
 * carries a different hash. Ten captures are therefore ten distinct configurations, which may span
 * years, rather than ten copies of last week.
 */
const ENV_NAME = /^b8_env_(\d{8}T\d{6}Z)_([0-9a-f]{12})\.env\.age$/;

/**
 * `b8_finance_20260916T224500Z.dump`.
 *
 * UTC, and sortable as text. A local-time name would reorder itself twice a year at the daylight
 * boundary, and the one night that matters is the night the clock goes back — two dumps an hour
 * apart, the second sorting before the first, and the pruner keeping the wrong one.
 */
export function backupFilename(now: Date, prefix = 'b8_finance'): string {
  const iso = now.toISOString();
  return `${prefix}_${iso.slice(0, 10).replace(/-/g, '')}T${iso.slice(11, 19).replace(/:/g, '')}Z.dump`;
}

/**
 * `b8_env_20260926T130000Z_1f3a9c2b4d5e.env.age`, from the same clock and the plaintext's digest.
 *
 * Twelve hex characters of a SHA-256, which is not a secret: it is the digest of a whole file, so it
 * cannot be walked back to the contents, and the only thing it reveals is WHETHER the configuration
 * changed between two dates — already evident from there being two files.
 */
export function envBackupFilename(now: Date, sha256: string): string {
  const short = sha256.slice(0, 12);
  if (!/^[0-9a-f]{12}$/.test(short)) throw new RangeError(`backupPlan: expected a hex digest, got ${sha256.slice(0, 20)}`);
  const iso = now.toISOString();
  return `b8_env_${iso.slice(0, 10).replace(/-/g, '')}T${iso.slice(11, 19).replace(/:/g, '')}Z_${short}.env.age`;
}

/** The digest the newest env capture carries, or `null` if there is not one yet. */
export function newestEnvHash(names: readonly string[]): string | null {
  const mine = names.filter((n) => ENV_NAME.test(n)).sort();
  const newest = mine[mine.length - 1];
  return newest ? (ENV_NAME.exec(newest)?.[2] ?? null) : null;
}

/**
 * Which env captures to delete. Separate from `selectForDeletion` rather than a parameter on it,
 * because the two retentions answer different questions and should be free to disagree: dumps are
 * kept by DAY, and a month of them is a month of history. Env captures are kept by CHANGE, so a
 * count of ten is ten configurations however long they took to accumulate.
 */
export function selectEnvForDeletion(names: readonly string[], keep: number): string[] {
  if (keep < 1) throw new RangeError(`backupPlan: keep must be at least 1, got ${keep}`);
  const mine = names.filter((n) => ENV_NAME.test(n)).sort();
  return mine.slice(0, Math.max(0, mine.length - keep));
}

/**
 * Which files to delete, given everything in the directory.
 *
 * ─── IT WILL NOT TOUCH A FILE IT DID NOT WRITE ────────────────────────────────────────────────
 *
 * The directory already holds `b8_finance_pre-P0-09a_20260831T174605Z.dump` and
 * `budget_categories_backup_20260910.sql` — made by hand, before any of this existed, and the only
 * copies of what they contain. Anything not matching this routine's exact naming pattern is
 * invisible to the pruner. That is the property worth having: a retention rule that reasons about
 * "the oldest files" rather than "the oldest files I made" is one bad glob away from deleting the
 * backup somebody took deliberately before a risky migration.
 *
 * Sorted by the timestamp IN THE NAME, not by mtime. A file copied or restored from elsewhere gets
 * a fresh mtime and would sort as new; the name is what says when the data is from.
 */
export function selectForDeletion(names: readonly string[], keep: number): string[] {
  if (keep < 1) throw new RangeError(`backupPlan: keep must be at least 1, got ${keep}`);

  const mine = names.filter((n) => NAME.test(n)).sort();
  // Newest last after a lexical sort, because the stamp is UTC and fixed-width.
  return mine.slice(0, Math.max(0, mine.length - keep));
}

/** The timestamp a name encodes, or `null` if this routine did not write it. */
export function stampOf(name: string): string | null {
  return NAME.exec(name)?.[1] ?? null;
}

/** A table whose restored row count did not match the source. */
export interface CountMismatch {
  table: string;
  source: number;
  restored: number;
}

/**
 * Compare the rehearsal's restored counts against the source's.
 *
 * Extracted from `scripts/backup.ts` so the branch that decides a dump is bad can be tested. It was
 * four inline lines in a script that has never had a bad dump to work on — which is the definition
 * of a control nobody has seen fire.
 *
 * A MISSING TABLE IS A MISMATCH, NOT A SKIP. If the restore produced no such table at all, the
 * count is absent rather than zero, and treating absent as "nothing to compare" would let the worst
 * possible dump — one that restored none of the schema — pass silently. It is reported as −1 so the
 * message says something a reader can act on rather than `undefined`.
 */
export function compareCounts(
  source: Readonly<Record<string, number>>,
  restored: Readonly<Record<string, number>>
): CountMismatch[] {
  return Object.keys(source)
    .filter((table) => restored[table] !== source[table])
    .map((table) => ({
      table,
      source: source[table],
      restored: restored[table] ?? -1,
    }));
}
