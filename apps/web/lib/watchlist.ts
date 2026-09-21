/**
 * The write-path rules for "keep an eye on this one", as pure functions.
 *
 * Extracted from the route for the reason `lib/categoryControl.ts` and `lib/budgetMath.ts` were:
 * a rule inside a handler is a rule the unit suite cannot reach, and `vitest.config.mts` collects
 * `lib/`. The route below stays HTTP shaping and one statement.
 *
 * ─── These duplicate the database's CHECKs, on purpose, and the duplication is the point ──────
 *
 * `migrations/…_transaction-watchlist.sql` already refuses an empty note, an over-long one, and a
 * note with no flag. Postgres is the authority and stays the authority — but a constraint violation
 * arrives at a handler as error 23514 with a constraint name, which becomes a 500 and a message the
 * owner cannot act on. That is precisely the shape of the bug this session already fixed once on
 * the auth routes: a refusal nobody could read.
 *
 * So these run first to produce a STATED refusal with a 400, and the CHECKs remain underneath as
 * the thing that is actually true of the data. Neither is redundant: delete the functions and the
 * owner gets a 500; delete the CHECKs and a second writer — a script, a future bulk endpoint —
 * writes rows these rules would have refused.
 */

/** The longest note the column will hold, and the longest one the digest can render on a line. */
export const MAX_NOTE = 200;

export type WatchInput = { watched: boolean; note: string | null };

export type WatchRefusal = { code: string; message: string };

/**
 * What the caller asked for, or a refusal naming what is wrong with it.
 *
 * Returns a discriminated result rather than throwing: a bad note is an ordinary 400, not an
 * exception, and a route that has to try/catch its own validator ends up catching real bugs too.
 */
export function parseWatchInput(body: unknown): { ok: true; value: WatchInput } | { ok: false; error: WatchRefusal } {
  if (typeof body !== 'object' || body === null || !('watched' in body)) {
    return { ok: false, error: { code: 'INVALID_INPUT', message: 'watched must be present and boolean' } };
  }

  const { watched } = body as { watched: unknown };
  if (typeof watched !== 'boolean') {
    return { ok: false, error: { code: 'INVALID_INPUT', message: 'watched must be a boolean' } };
  }

  const raw = 'watch_note' in body ? (body as { watch_note: unknown }).watch_note : null;
  if (raw !== null && raw !== undefined && typeof raw !== 'string') {
    return { ok: false, error: { code: 'INVALID_INPUT', message: 'watch_note must be a string or null' } };
  }

  // Trimmed before every other test, so "   " is the empty note it plainly is rather than a
  // three-character one that satisfies the length CHECK and renders as a blank in the email.
  const trimmed = typeof raw === 'string' ? raw.trim() : null;
  const note = trimmed === null || trimmed === '' ? null : trimmed;

  if (note !== null && note.length > MAX_NOTE) {
    return {
      ok: false,
      error: { code: 'NOTE_TOO_LONG', message: `The note is ${note.length} characters; the limit is ${MAX_NOTE}.` },
    };
  }

  // Unflagging DISCARDS the note rather than refusing the pair. A caller clearing the flag is
  // finished with the transaction, and making them send `watch_note: null` as well would be a
  // second way to get a 400 for something nobody meant. The database's CHECK forbids the stored
  // combination; this is what makes the obvious request mean the obvious thing.
  return { ok: true, value: { watched, note: watched ? note : null } };
}
