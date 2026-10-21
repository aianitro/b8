// The transactions page's one amount field. It replaced a Min/Max pair, where finding one exact
// amount meant typing it twice. The field takes a small notation and turns it into the same
// `amountMin` / `amountMax` URL parameters the page already reads, so the server, saved links and
// shared links are untouched:
//
//   25.50       exactly that amount       → min = max = 25.50
//   20-30       a range, either order     → min 20, max 30   (also 20–30, 20—30, 20..30)
//   >100        that amount and up        → min 100          (>= is the same; bounds are inclusive)
//   <50         up to that amount         → max 50           (<= likewise)
//
// The page compares against the absolute amount, so a sign is not part of the notation: a leading
// minus is read as "the same amount, ignore the sign", which matches what the filter does anyway.
// A dollar sign and thousands commas are dropped before parsing, and so are spaces around an operator.
//
// Pure: no clock, no DOM, no URL. `formatAmountFilter` is the inverse, used to show an incoming
// link's parameters in the same notation the person would have typed.

export interface AmountBounds {
  min: string | null;
  max: string | null;
}

/** `{ ok: false }` is input that does not parse yet (e.g. a half-typed `20-`); the caller keeps the current filter. */
export type ParsedAmountFilter = ({ ok: true } & AmountBounds) | { ok: false };

const NUMBER = /^(?:\d+(?:\.\d*)?|\.\d+)$/;

/** A non-negative decimal as written, without a trailing point (`25.` → `25`), or null if not one. */
function amountToken(raw: string): string | null {
  const text = raw.startsWith('-') ? raw.slice(1) : raw;
  if (!NUMBER.test(text)) return null;
  return text.endsWith('.') ? text.slice(0, -1) : text;
}

export function parseAmountFilter(input: string): ParsedAmountFilter {
  // Spaces go only where they sit beside an operator; a space between two numbers ("20 30") is
  // left in, so it fails below rather than being read as 2030.
  const text = input.replace(/[$,]/g, '').trim().replace(/\s*(\.\.|[<>=\-–—])\s*/g, '$1');
  if (text === '') return { ok: true, min: null, max: null };
  if (/\s/.test(text)) return { ok: false };

  const bound = /^([<>])=?(.*)$/.exec(text);
  if (bound) {
    const value = amountToken(bound[2]);
    if (value === null) return { ok: false };
    return bound[1] === '>' ? { ok: true, min: value, max: null } : { ok: true, min: null, max: value };
  }

  // A range needs a number on both sides of the separator, so a lone leading minus ("-25") falls
  // through to the exact case below rather than reading as an open range.
  const range = /^(-?[\d.]+)(?:\.\.|[-–—])(-?[\d.]+)$/.exec(text);
  if (range) {
    const a = amountToken(range[1]);
    const b = amountToken(range[2]);
    if (a === null || b === null) return { ok: false };
    return Number(a) <= Number(b) ? { ok: true, min: a, max: b } : { ok: true, min: b, max: a };
  }

  const exact = amountToken(text);
  return exact === null ? { ok: false } : { ok: true, min: exact, max: exact };
}

/** The notation for a pair of URL parameters, so a shared link shows what it filters by. */
export function formatAmountFilter({ min, max }: AmountBounds): string {
  if (min && max) return Number(min) === Number(max) ? min : `${min}–${max}`;
  if (min) return `>${min}`;
  if (max) return `<${max}`;
  return '';
}
