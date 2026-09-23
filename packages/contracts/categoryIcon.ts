// A one-glyph stand-in for a category name. The sole label on every heatmap tile, on both surfaces.
//
// Shared rather than the phone's, since the web dashboard's map draws the same tiles — a glyph
// table that disagreed between the two would put a different alphabet on each, which is the one
// thing worse than an unlabelled tile.
//
// ─── Why an icon rather than a truncated name ─────────────────────────────────────────────────
//
// The heatmap sizes tiles by budget, so the tail of the budget is genuinely small — and the tail is
// where an overspend hides, which is why `layoutTreemap` refuses to bucket it into an "Other". The
// first version left those tiles blank: readable, honest, and useless, because a red tile you
// cannot name is a finding you have to tap to understand.
//
// Truncation is the obvious alternative and it is worse. "Onlin…", "Educa…", "Entert…" is what a
// purely geometric fit produces — technically inside the tile and unreadable, and the digest's
// bubble renderer carries a comment saying exactly that. A glyph is legible at a size no text is.
//
// ─── Keyword matching, not a lookup by name ───────────────────────────────────────────────────
//
// Category names are typed by the owner and renamed freely, so an exact-name table would silently
// degrade to the fallback the first time one was edited. Keywords survive renaming, pluralising and
// reordering — and this ledger's own "Restoraunts" is the argument in miniature: a table keyed on
// the correct spelling would never have matched it.
//
// ORDER IS SIGNIFICANT. "Auto insurance" contains both `insurance` and `auto`; the more specific
// term is listed first, and a new entry goes in the position that keeps the existing ones correct
// rather than at the end.
//
// ─── Emoji rather than an icon set ────────────────────────────────────────────────────────────
//
// The app has no icon library and this does not justify adding one: an icon font or an SVG set
// would be a dependency, a bundle cost and a licence, to draw twenty glyphs the platform already
// ships. Emoji also render in colour against a solid tile, where a monochrome glyph would have to
// fight the status colour underneath it.

const ICONS: ReadonlyArray<[RegExp, string]> = [
  // Specific before general — see the note on ordering above.
  // VEHICLE COVER IS A CAR, NOT A SHIELD — the owner's call, and the more useful reading: on this
  // map the glyph answers "what is this spend about", and every line under Auto is about the car.
  // It must be tested BEFORE the general insurance rule, or `insur` claims it first; the two
  // orderings differ only for names containing both words, which is exactly this one.
  [/(auto|car\b|vehicle|motor).*insur|insur.*(auto|car\b|vehicle|motor)/i, '🚙'],
  [/insur/i, '🛡️'],
  [/property tax|tax/i, '🏛️'],
  [/auto|car\b|vehicle/i, '🔧'],
  [/groc|supermarket/i, '🛒'],
  [/restor|restau|dining|dine|cafe|coffee/i, '🍽️'],
  [/gas|fuel|petrol/i, '⛽'],
  [/util|electric|water|maintenance/i, '💡'],
  [/home|house|mortgage|rent\b/i, '🏠'],
  [/health|medical|doctor|dental|pharm/i, '🩺'],
  [/pet\b|pets|vet\b/i, '🐾'],
  [/educ|school|tuition|course/i, '🎓'],
  [/entertain|movie|music|game/i, '🎬'],
  [/travel|vacation|flight|hotel/i, '✈️'],
  [/transport|transit|train|bus\b|parking/i, '🚌'],
  [/cloth|beauty|apparel|salon/i, '👗'],
  [/toy|gift|flower/i, '🎁'],
  [/sport|gym|fitness/i, '🏋️'],
  [/online|subscription|software|internet|phone/i, '💻'],
  [/pocket|allowance|cash\b/i, '👛'],
  [/shared|split/i, '🤝'],
  [/one.?time|misc|other/i, '✳️'],
];

/**
 * The glyph for a category, or its first letter when nothing matches.
 *
 * THE LETTER IS A FALLBACK, NOT A DESIGN. It exists so a category this table has never heard of
 * still carries something rather than nothing, and so adding a category never requires editing this
 * file before the map is usable. Two unmatched categories sharing an initial will look alike — at
 * which point the fix is a keyword here, not a cleverer fallback.
 *
 * Never empty for a non-empty name, so a caller can render the result unconditionally.
 */
export function categoryIcon(category: string): string {
  const name = category.trim();
  if (name === '') return '•';
  for (const [pattern, icon] of ICONS) {
    if (pattern.test(name)) return icon;
  }
  // `[...name]` rather than `name[0]`: a name beginning with an emoji or an accented character
  // outside the BMP would otherwise be cut mid-code-point and render as a replacement box.
  return [...name][0].toUpperCase();
}
