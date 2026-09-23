import { describe, expect, it } from 'vitest';
import { MAX_NOTE, parseWatchInput } from './watchlist';

// A NOTE IS A NOTE; WATCHING IS A FLAG; NEITHER IMPLIES THE OTHER. The parser used to demand
// `watched` on every request and to discard the note whenever the flag came off, because the
// database refused an unwatched row holding a note. That CHECK is gone, and these pin what
// replaced it — above all that ABSENT AND NULL ARE DIFFERENT: no key leaves a column alone, an
// explicit null clears it.

describe('parseWatchInput', () => {
  it('accepts a flag with a reason, which is the case the feature exists for', () => {
    expect(parseWatchInput({ watched: true, note: 'returning to Zara' }))
      .toEqual({ ok: true, value: { watched: true, note: 'returning to Zara' } });
  });

  it('accepts a flag with no reason at all', () => {
    // Flagging something and writing the reason later is a normal way to use a list like this.
    expect(parseWatchInput({ watched: true })).toEqual({ ok: true, value: { watched: true } });
  });

  // The change that prompted all of this: a comment must not put a row on the watchlist, because
  // a watched row is excused from the budget grading and a note would silently move the figures.
  it('accepts a note with no flag, and says nothing about the flag', () => {
    const parsed = parseWatchInput({ note: 'paid for the group, being repaid' });
    expect(parsed).toEqual({ ok: true, value: { note: 'paid for the group, being repaid' } });
    expect(parsed.ok && 'watched' in parsed.value).toBe(false);
  });

  it('keeps the note when the flag is being cleared, rather than discarding it', () => {
    expect(parseWatchInput({ watched: false })).toEqual({ ok: true, value: { watched: false } });
    expect(parseWatchInput({ watched: false, note: 'still worth remembering' }))
      .toEqual({ ok: true, value: { watched: false, note: 'still worth remembering' } });
  });

  // Absent and null are different, and the UPDATE relies on the difference: no key leaves the
  // column alone, an explicit null clears it.
  it('separates an absent note from an explicit null', () => {
    const absent = parseWatchInput({ watched: true });
    expect(absent.ok && 'note' in absent.value).toBe(false);
    expect(parseWatchInput({ watched: true, note: null })).toEqual({ ok: true, value: { watched: true, note: null } });
  });

  it('treats a blank note as no note rather than as a short one', () => {
    // "   " passes a bare length check and renders as an empty gap beside a figure in the email.
    // Trimming first is what makes the length rule mean what it says.
    for (const blank of ['', '   ', '\n\t ']) {
      expect(parseWatchInput({ note: blank })).toEqual({ ok: true, value: { note: null } });
    }
  });

  it('trims a note that has a real value inside the whitespace', () => {
    expect(parseWatchInput({ note: '  wrong size, sent back \n' }))
      .toEqual({ ok: true, value: { note: 'wrong size, sent back' } });
  });

  it('refuses a note longer than the column will hold, and says how long it was', () => {
    const parsed = parseWatchInput({ note: 'x'.repeat(MAX_NOTE + 1) });
    expect(parsed.ok).toBe(false);
    expect(!parsed.ok && parsed.error.code).toBe('NOTE_TOO_LONG');
    expect(!parsed.ok && parsed.error.message).toContain(String(MAX_NOTE));
  });

  it('accepts a note of exactly the maximum, so the boundary is inclusive on both sides', () => {
    expect(parseWatchInput({ note: 'x'.repeat(MAX_NOTE) }).ok).toBe(true);
    // Length is measured AFTER trimming, so trailing spaces cannot push a legal note over.
    expect(parseWatchInput({ note: `${'x'.repeat(MAX_NOTE)}   ` }).ok).toBe(true);
  });

  it('refuses a note that is not a string', () => {
    for (const bad of [7, true, {}, []]) {
      expect(parseWatchInput({ note: bad }).ok).toBe(false);
    }
  });

  it('refuses a flag that is not a boolean', () => {
    for (const bad of ['true', 1, null, {}]) {
      expect(parseWatchInput({ watched: bad }).ok).toBe(false);
    }
  });

  // A body naming neither column is a request to change nothing, which is a caller bug worth a
  // stated 400 rather than a silent no-op UPDATE.
  it('refuses a body that asks for no change at all', () => {
    for (const bad of [{}, { hidden: true }, null, undefined, 'note', 7]) {
      expect(parseWatchInput(bad).ok).toBe(false);
    }
  });
});
