// The Home Screen icons, drawn rather than sourced — §5 step 26b.
//
// The same mark the daily email's masthead and the phone's dashboard already draw: a dark rounded
// square with the wordmark in it. Three of them exist because they are three different jobs, not
// three sizes of one:
//
//   icon-192 / icon-512   `purpose: any`      — shown as-is, so the mark fills the tile
//   icon-maskable-512     `purpose: maskable` — the platform CROPS this to a circle or squircle,
//                                               so the mark sits inside a safe zone with padding
//                                               around it that is expected to be cut away
//   app/apple-icon.png    Next's file convention for apple-touch-icon, which iOS masks itself
//
// A single file used for all three is either cropped through the wordmark or padded where it
// should not be. Committed as a script rather than as four opaque PNGs so the next change to the
// mark is an edit here instead of an image editor nobody has.
//
//   node apps/web/scripts/make-icons.mjs

import sharp from 'sharp';
import { mkdir } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const WEB = join(HERE, '..');

/**
 * THE BRAND GROUND, AND IT IS DELIBERATELY NOT A TOKEN FROM THE DESIGN SYSTEM.
 *
 * Every colour in `.claude/skills/uiux-promax` means something: blue is operational, violet
 * capital, green income, orange expense, red over budget, amber warning. An icon is PERMANENT, so
 * painting it in any of those makes a permanent claim — a green icon reads "on track" during a
 * month that is over budget. The skill's own rule that status colours are reserved decides it.
 *
 * So cyan-700 sits outside that set on purpose. It is the BRAND, not a state, and nothing else in
 * the app may use it.
 *
 * ─── Why it replaced the near-black, measured rather than preferred ──────────────────────────
 *
 * The mark was `#111827`, which is 17.7:1 against a white wallpaper and 1.18:1 against a black
 * one — on a dark Home Screen it did not look dark, it disappeared. An icon has no say in what sits
 * behind it, so the figure that matters is the WORSE of the two, and cyan-700's is 3.92:1: the only
 * candidate clearing 3:1 against both extremes. Teal-600 was close but reads as the income green at
 * 60pt; indigo-600 reads as the operational blue.
 *
 * ─── The email and the phone keep the ink, and that is not an inconsistency ──────────────────
 *
 * `digest.ts`'s masthead and the phone dashboard's mark are drawn on a WHITE PAGE, where dark is
 * correct and this would be worse. Same mark, different ground, different answer.
 */
const INK = '#0e7490';   // cyan-700 — brand only, never a status
/**
 * CHAMPAGNE, NOT WHITE — warm metal against a cool ground, which is the relationship that makes
 * gold-on-vert work heraldically, executed at a lightness the wallpaper constraint permits.
 *
 * True gold was measured and rejected: antique gold needs a ground of teal-800 or darker to clear
 * 3:1, and every such ground falls below 3:1 against a DARK wallpaper — the fault this icon was
 * just changed to fix. You can have the gold or the visibility, not both.
 *
 * 4.05:1 here, which clears the 3:1 floor for large bold type. It is NOT enough for 14px nav
 * labels, and `Sidebar.tsx` uses cyan-100 for those rather than reusing this.
 */
const PAPER = '#f0dfae';   // champagne — the mark, at display size only

/**
 * THE MARK IS ABRIL FATFACE, the owner's pick from seven display faces tried on this tile (Fraunces,
 * Playfair Display, Bodoni Moda, DM Serif Display, Cormorant Garamond and Italiana were the
 * others). Upright and poster-heavy: it keeps Helvetica's legibility at Home Screen size and adds
 * the contrast and ball terminals that make it a mark rather than a label.
 *
 * OUTLINES, NOT A FONT. "b8" is stored as the glyphs' paths, read once from the font with
 * opentype.js, so rendering needs no installed font and cannot fall back to Helvetica on a machine
 * that lacks it — the failure mode `font-family` in an SVG rendered by sharp always has. Font units
 * (1000 per em), y down, baseline at 0; `BBOX` is the path's extent, for centring.
 *
 * Abril Fatface © 2011 TypeTogether (www.type-together.com), licensed under the SIL Open Font
 * License 1.1, which permits embedding its outlines in this artwork.
 */
const MARK_PATH = 'M375-269Q375-372 365-407Q355-443 326-443Q297-443 274-407Q251-371 251-308L251-122Q251-79 269-49Q286-19 319-19Q351-19 363-63Q375-107 375-217L375-269M10-750L251-750L251-400Q289-486 381-486Q568-486 568-237Q568-110 517-50Q465 10 362 10Q310 10 283-6Q255-22 245-59L238 0L10 0L10-18L65-18L65-732L10-732L10-750M837-365L837-368Q740-373 686-416Q632-460 632-529Q632-613 699-662Q766-711 895-711Q1024-711 1090-665Q1156-619 1156-541Q1156-464 1105-419Q1054-375 958-368L958-365Q1174-347 1174-182Q1174-86 1107-38Q1039 10 896 10Q613 10 613-181Q613-350 837-365M983-182Q983-275 965-315Q947-355 896-355Q844-355 826-314Q808-274 808-181Q808-89 826-50Q843-11 896-11Q949-11 966-50Q983-90 983-182M896-690Q852-690 840-654Q827-619 827-558Q827-498 828-477Q829-457 833-435Q836-413 844-402Q861-378 899-378Q933-378 950-402Q963-421 964-458Q965-496 965-557Q965-619 953-654Q940-690 896-690';
const BBOX = { x1: 10, y1: -750, x2: 1174, y2: 10 };

/**
 * @param size   pixel square
 * @param inset  fraction of the size left blank around the tile, for maskable icons
 * @param radius corner radius as a fraction of the TILE (not the canvas)
 */
function svg(size, { inset = 0, radius = 0.22 } = {}) {
  const pad = Math.round(size * inset);
  const tile = size - pad * 2;
  const r = Math.round(tile * radius);
  // The outline scaled to a fixed share of the tile's width and centred on its own extent — the
  // drawn ink, not a text baseline, so no optical nudge is needed. 0.62 of the tile matches the
  // visual weight the Helvetica mark had at 0.46 em.
  const scale = (tile * 0.62) / (BBOX.x2 - BBOX.x1);
  const tx = size / 2 - ((BBOX.x1 + BBOX.x2) / 2) * scale;
  const ty = size / 2 - ((BBOX.y1 + BBOX.y2) / 2) * scale;
  return Buffer.from(
    `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">` +
      `<rect x="${pad}" y="${pad}" width="${tile}" height="${tile}" rx="${r}" ry="${r}" fill="${INK}"/>` +
      `<path d="${MARK_PATH}" fill="${PAPER}" transform="translate(${tx} ${ty}) scale(${scale})"/>` +
    `</svg>`,
    'utf8'
  );
}

const targets = [
  { file: join(WEB, 'public', 'icon-192.png'), size: 192, opts: {} },
  { file: join(WEB, 'public', 'icon-512.png'), size: 512, opts: {} },
  // 12.5% inset each side leaves the mark inside the ~80% safe zone every maskable spec assumes.
  { file: join(WEB, 'public', 'icon-maskable-512.png'), size: 512, opts: { inset: 0.125, radius: 0.5 } },
  // iOS masks apple-touch-icon itself and looks wrong if the source is already rounded, so this one
  // is a FULL-BLEED square: the platform supplies the corners.
  { file: join(WEB, 'app', 'apple-icon.png'), size: 180, opts: { radius: 0 } },
];

for (const { file, size, opts } of targets) {
  await mkdir(dirname(file), { recursive: true });
  await sharp(svg(size, opts)).png({ compressionLevel: 9 }).toFile(file);
  console.log(`wrote ${file.replace(`${WEB}/`, '')} (${size}px)`);
}
