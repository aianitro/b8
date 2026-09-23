import { MAX_WATCH_NOTE } from '@b8/contracts/overview';
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
// Moved to `@b8/contracts/overview` when the phone started writing notes as well. Re-exported so
// this module's existing importers keep working and the move stays one file.
export const MAX_NOTE = MAX_WATCH_NOTE;

/**
 * What the caller asked to change. EITHER KEY MAY BE ABSENT, and absent is not the same as null:
 * `note: null` clears the note, no `note` key leaves it alone. The pair was a single indivisible
 * update while the database refused a note without a flag; now that it does not, a caller that
 * wants to toggle the flag must be able to do so without restating the note it is not touching.
 */
export type WatchInput = { watched?: boolean; note?: string | null };

export type WatchRefusal = { code: string; message: string };

/**
 * What the caller asked for, or a refusal naming what is wrong with it.
 *
 * Returns a discriminated result rather than throwing: a bad note is an ordinary 400, not an
 * exception, and a route that has to try/catch its own validator ends up catching real bugs too.
 */
export function parseWatchInput(body: unknown): { ok: true; value: WatchInput } | { ok: false; error: WatchRefusal } {
  if (typeof body !== 'object' || body === null) {
    return { ok: false, error: { code: 'INVALID_INPUT', message: 'a body with watched or note is required' } };
  }

  const hasWatched = 'watched' in body;
  const hasNote = 'note' in body;
  if (!hasWatched && !hasNote) {
    return { ok: false, error: { code: 'INVALID_INPUT', message: 'watched or note must be present' } };
  }

  const value: WatchInput = {};

  if (hasWatched) {
    const { watched } = body as { watched: unknown };
    if (typeof watched !== 'boolean') {
      return { ok: false, error: { code: 'INVALID_INPUT', message: 'watched must be a boolean' } };
    }
    value.watched = watched;
  }

  if (hasNote) {
    const raw = (body as { note: unknown }).note;
    if (raw !== null && typeof raw !== 'string') {
      return { ok: false, error: { code: 'INVALID_INPUT', message: 'note must be a string or null' } };
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
    value.note = note;
  }

  // UNFLAGGING NO LONGER DISCARDS THE NOTE. It used to, because the database refused the surviving
  // combination — an unwatched row holding a note — and making the obvious request mean the obvious
  // thing was the only way to avoid a 400 for something nobody meant. That CHECK is gone
  // (migrations/…_note-decoupled-from-flag.sql): a note is the owner's comment and taking a row off
  // the list is not a reason to delete what they wrote about it.
  return { ok: true, value };
}
