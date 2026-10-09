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
 * @param size   pixel square
 * @param inset  fraction of the size left blank around the tile, for maskable icons
 * @param radius corner radius as a fraction of the TILE (not the canvas)
 */
function svg(size, { inset = 0, radius = 0.22 } = {}) {
  const pad = Math.round(size * inset);
  const tile = size - pad * 2;
  const r = Math.round(tile * radius);
  // Optical centring: the cap height of "b8" sits above the geometric middle, so the text baseline
  // is placed by `dominant-baseline` and then nudged. Without the nudge the mark reads as sitting
  // slightly high, which is visible at 512 and unmistakable on a Home Screen.
  const cy = pad + tile / 2 + tile * 0.015;
  return Buffer.from(
    `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">` +
      `<rect x="${pad}" y="${pad}" width="${tile}" height="${tile}" rx="${r}" ry="${r}" fill="${INK}"/>` +
      `<text x="${size / 2}" y="${cy}" text-anchor="middle" dominant-baseline="central" ` +
        `font-family="Helvetica,Arial,sans-serif" font-weight="700" font-size="${tile * 0.46}" ` +
        `fill="${PAPER}" letter-spacing="${tile * 0.01}">b8</text>` +
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
