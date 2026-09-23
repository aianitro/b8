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

const INK = '#111827';   // the wordmark's ground, matching C.ink on the phone
const PAPER = '#ffffff';

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
