import { describe, expect, it } from 'vitest';
import { MAX_NOTE, parseWatchInput } from './watchlist';

/** The happy shape, so each fixture below changes exactly one thing about it. */
const flagged = { watched: true, watch_note: 'returning to Zara' };

describe('parseWatchInput', () => {
  it('accepts a flag with a reason, which is the case the feature exists for', () => {
    expect(parseWatchInput(flagged)).toEqual({ ok: true, value: { watched: true, note: 'returning to Zara' } });
  });

  it('accepts a flag with no reason at all', () => {
    // The note is the useful part but not the required part: flagging something and writing the
    // reason later is a normal way to use a list like this.
    expect(parseWatchInput({ watched: true })).toEqual({ ok: true, value: { watched: true, note: null } });
    expect(parseWatchInput({ watched: true, watch_note: null })).toEqual({ ok: true, value: { watched: true, note: null } });
  });

  it('treats a blank note as no note rather than as a short one', () => {
    // "   " passes a bare length check and renders as an empty gap beside a figure in the email.
    // Trimming first is what makes the length rule mean what it says.
    for (const blank of ['', '   ', '\n\t ']) {
      expect(parseWatchInput({ watched: true, watch_note: blank })).toEqual({ ok: true, value: { watched: true, note: null } });
    }
  });

  it('trims a note that has a real value inside the whitespace', () => {
    const parsed = parseWatchInput({ watched: true, watch_note: '  wrong size, sent back \n' });
    expect(parsed).toEqual({ ok: true, value: { watched: true, note: 'wrong size, sent back' } });
  });

  it('discards the note when the flag is being cleared, rather than refusing the pair', () => {
    // The database CHECK forbids a stored note with no flag. Refusing the REQUEST would mean a
    // caller who is finished with a transaction gets a 400 for something nobody meant; this is what
    // makes the obvious request mean the obvious thing.
    expect(parseWatchInput({ watched: false, watch_note: 'still here' })).toEqual({ ok: true, value: { watched: false, note: null } });
  });

  it('refuses a note longer than the column will hold, and says how long it was', () => {
    const parsed = parseWatchInput({ watched: true, watch_note: 'x'.repeat(MAX_NOTE + 1) });
    expect(parsed.ok).toBe(false);
    if (parsed.ok) throw new Error('unreachable');
    expect(parsed.error.code).toBe('NOTE_TOO_LONG');
    // The number is in the message because "too long" without a length is not actionable.
    expect(parsed.error.message).toContain('201');
    expect(parsed.error.message).toContain(String(MAX_NOTE));
  });

  it('accepts a note of exactly the maximum, so the boundary is inclusive on both sides', () => {
    // Asserted against the DATABASE's boundary, which is `BETWEEN 1 AND 200`. A validator that
    // refused 200 would refuse a row Postgres accepts, and the two would disagree about the rule.
    expect(parseWatchInput({ watched: true, watch_note: 'x'.repeat(MAX_NOTE) }).ok).toBe(true);
    expect(parseWatchInput({ watched: true, watch_note: 'x'.repeat(MAX_NOTE + 1) }).ok).toBe(false);
  });

  it('measures the note AFTER trimming, not before', () => {
    // Otherwise a note that fits is refused for whitespace that was never going to be stored.
    const padded = `  ${'x'.repeat(MAX_NOTE)}  `;
    expect(padded.length).toBeGreaterThan(MAX_NOTE);
    expect(parseWatchInput({ watched: true, watch_note: padded }).ok).toBe(true);
  });

  it('refuses anything that is not a boolean flag', () => {
    for (const bad of [{}, { watched: 'true' }, { watched: 1 }, { watched: null }, null, 'watched', 42]) {
      const parsed = parseWatchInput(bad);
      expect(parsed.ok).toBe(false);
      if (!parsed.ok) expect(parsed.error.code).toBe('INVALID_INPUT');
    }
  });

  it('refuses a note that is not a string', () => {
    for (const bad of [42, true, {}, []]) {
      const parsed = parseWatchInput({ watched: true, watch_note: bad });
      expect(parsed.ok).toBe(false);
      if (!parsed.ok) expect(parsed.error.code).toBe('INVALID_INPUT');
    }
  });
});
