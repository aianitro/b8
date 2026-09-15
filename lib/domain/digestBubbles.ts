import { packCircles } from './bubblePack';
import { bubbleColor, NEUTRAL_HEX } from './bubbleStatus';
import { STATUS_HEX } from '../chartColors';

/**
 * The dashboard's category bubbles, as an SVG the email can carry.
 *
 * Pure. `lib/digestImage.ts` rasterises it; `lib/domain/digest.ts` places the `cid:` reference.
 *
 * ─── The same packer and the same colour rule, imported not copied ────────────────────────────
 *
 * `packCircles` is the one `components/CategoryBubbles.tsx` uses, and `bubbleColor` was moved out
 * of that component into `lib/domain/bubbleStatus.ts` so both surfaces read one definition. A
 * second implementation of either is this repo's standing defect aimed at a picture: nothing would
 * fail, the email and the screen would simply start disagreeing about which categories are in
 * trouble, and nobody would notice until they were compared.
 *
 * What is NOT shared is the drawing. The component renders interactive SVG with links, hover
 * states and a legend built from Tailwind classes; none of that survives a mail client, and an
 * abstraction covering both would be contorted to no purpose. The geometry and the verdict are
 * shared because they are the parts that can be wrong; the pixels are not.
 *
 * ─── Area is the budget, colour is the verdict ────────────────────────────────────────────────
 *
 * Two channels answering different halves of one question. A list sorted by overspend puts a $75
 * education line closing at 300% above a $1,900 grocery line closing at 102%, which is true and
 * useless — the grocery line is where the money is. Area says where the money is; colour says
 * whether it is going wrong.
 */

export interface DigestBubble {
  category: string;
  /** This month's allocation. Drives the AREA of the circle. */
  budgeted: number;
  actual: number;
  projectedRatio: number | null;
  tooEarly: boolean;
}

// Twice the display size, as the P/L chart is, so the raster is sharp on a phone.
const W = 1120;
const H = 620;
const LEGEND_H = 46;
const PLOT_H = H - LEGEND_H;

const FONT = 'system-ui,-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif';
const INK = '#ffffff';
const MUTED = '#6b7280';

/** Rough width of a character at a given size, for fitting a label inside a circle. */
const charWidth = (fontSize: number) => fontSize * 0.55;

/**
 * Fewer characters than this inside a circle and the label stops being a name.
 *
 * The same threshold the component uses, and for the same reason: a purely geometric fit produced
 * "Onlin…" and "Educa…" — technically inside the circle and unreadable. Below it, the name goes
 * under the bubble instead, where it has the gap to itself.
 */
const MIN_INSIDE_CHARS = 9;

function esc(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function fitLabel(name: string, r: number, fontSize: number): string | null {
  // 1.7r rather than 2r: a chord near the edge of a circle is shorter than its diameter, and text
  // set to the full width visibly breaches the curve at both ends.
  const maxChars = Math.floor((r * 1.7) / charWidth(fontSize));
  if (name.length <= maxChars) return name;
  if (maxChars < MIN_INSIDE_CHARS) return null;
  return `${name.slice(0, maxChars - 1)}…`;
}

const money = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 });

/** A drawn label's footprint, for keeping the next one off it. */
interface Box { x0: number; y0: number; x1: number; y1: number }

function overlaps(a: Box, b: Box): boolean {
  return a.x0 < b.x1 && b.x0 < a.x1 && a.y0 < b.y1 && b.y0 < a.y1;
}

export function renderBubblesSvg(categories: DigestBubble[]): string {
  const drawable = categories.filter((c) => c.budgeted > 0);
  const packed = packCircles(
    drawable.map((c) => ({ key: c.category, weight: c.budgeted })),
    W,
    PLOT_H,
    // Looser than the dashboard's 0.62. On a screen a reader can hover an unlabelled circle to
    // find out what it is; in an email there is nothing to hover, so the gaps between circles are
    // where the small categories get their names. Packed at 0.62 nine of fifteen came out
    // anonymous, which is a picture that shows shape and withholds subject.
    { padding: 12, fill: 0.46, minRadius: 12 }
  );
  const byKey = new Map(drawable.map((c) => [c.category, c]));

  const parts: string[] = [];

  // OUTSIDE labels are collision-checked; inside ones are not, because a label inside a circle is
  // bounded by the circle and circles do not overlap. Without this the small bubbles piled their
  // names on top of each other and on their neighbours — four categories rendered as one smear of
  // grey text, which is worse than not naming them at all.
  const claimed: Box[] = [];
  const dropped: string[] = [];

  for (const circle of packed) {
    const cat = byKey.get(circle.key);
    if (!cat) continue;
    const colour = bubbleColor(cat);

    parts.push(
      `<circle cx="${circle.x.toFixed(1)}" cy="${circle.y.toFixed(1)}" r="${circle.r.toFixed(1)}" ` +
      `fill="${colour}" fill-opacity="0.9"/>`
    );

    // Label size scales with the circle so a large bubble does not carry tiny text, and is clamped
    // so a small one does not carry text taller than itself.
    const nominal = Math.max(15, Math.min(30, circle.r * 0.42));

    // Shrink before truncating. "Restoraunts" is eleven characters and missed a ten-character fit
    // by one, so it rendered as "Restorau…" inside a circle with room to spare at a slightly
    // smaller size. An ellipsis should be the last resort, not the first.
    let nameSize = nominal;
    let inside = fitLabel(cat.category, circle.r, nameSize);
    while (inside !== cat.category && nameSize > nominal * 0.72 && nameSize > 15) {
      nameSize -= 1;
      inside = fitLabel(cat.category, circle.r, nameSize);
    }
    if (inside !== cat.category) {
      // It genuinely does not fit. Go back to the nominal size and let `fitLabel` decide between an
      // ellipsis and moving the name outside — a truncated label set in shrunken type is the worst
      // of both.
      nameSize = nominal;
      inside = fitLabel(cat.category, circle.r, nameSize);
    }

    if (inside !== null) {
      parts.push(
        `<text x="${circle.x.toFixed(1)}" y="${(circle.y + (circle.r > 46 ? -1 : nameSize / 3)).toFixed(1)}" ` +
        `text-anchor="middle" font-family="${FONT}" font-size="${nameSize.toFixed(0)}" font-weight="600" ` +
        `fill="${INK}">${esc(inside)}</text>`
      );
      // The figure only where there is room under the name for it. A circle that can hold a name
      // but not a number is better with just the name than with both overlapping.
      if (circle.r > 46) {
        parts.push(
          `<text x="${circle.x.toFixed(1)}" y="${(circle.y + nameSize).toFixed(1)}" text-anchor="middle" ` +
          `font-family="${FONT}" font-size="${(nameSize * 0.78).toFixed(0)}" fill="${INK}" fill-opacity="0.85">` +
          `${esc(money.format(cat.actual))}</text>`
        );
      }
    } else {
      // Too small to hold its name: it goes underneath, in ink on the background rather than white
      // on a colour it is no longer sitting on — but only if there is room for it there.
      const size = 17;
      const halfWidth = (cat.category.length * charWidth(size)) / 2;

      // Below first, then above. Two candidate positions rather than one roughly halves the number
      // that go unnamed, and costs nothing: whichever is clear is as readable as the other.
      const candidates = [circle.y + circle.r + size, circle.y - circle.r - 6];

      const boxAt = (baseline: number): Box => ({
        x0: circle.x - halfWidth - 3,
        y0: baseline - size,
        x1: circle.x + halfWidth + 3,
        y1: baseline + 4,
      });

      const fits = (box: Box): boolean =>
        box.x0 > 2 &&
        box.x1 < W - 2 &&
        box.y0 > 2 &&
        box.y1 < PLOT_H &&
        claimed.every((c) => !overlaps(box, c)) &&
        // Kept off every OTHER circle too: a name printed across a neighbouring bubble is the worst
        // of both, unreadable itself and spoiling the shape it lands on.
        packed.every(
          (other) =>
            other.key === circle.key ||
            !overlaps(box, { x0: other.x - other.r, y0: other.y - other.r, x1: other.x + other.r, y1: other.y + other.r })
        );

      const baseline = candidates.find((y) => fits(boxAt(y)));
      if (baseline !== undefined) {
        claimed.push(boxAt(baseline));
        parts.push(
          `<text x="${circle.x.toFixed(1)}" y="${baseline.toFixed(1)}" text-anchor="middle" ` +
          `font-family="${FONT}" font-size="${size}" fill="${MUTED}">${esc(cat.category)}</text>`
        );
      } else {
        // Unnamed in the picture. It is still in the plain-text list with its figures, which is
        // where a reader goes for the ones too small to letter.
        dropped.push(cat.category);
      }
    }
  }

  // Say so, rather than leaving a handful of anonymous circles the reader cannot ask about. The
  // count is the honest version of "some of these are not labelled".
  if (dropped.length > 0) {
    parts.push(
      `<text x="${W - 10}" y="${H - 10}" text-anchor="end" font-family="${FONT}" font-size="16" ` +
      `fill="${MUTED}">${dropped.length} smaller ${dropped.length === 1 ? 'category is' : 'categories are'} unlabelled</text>`
    );
  }

  // The legend is not decoration here. On the dashboard a reader can hover a bubble; in an email
  // the colour is the only thing that says what it means, so the key has to travel with it.
  const legend: Array<[string, string]> = [
    [STATUS_HEX.over, 'already over'],
    [STATUS_HEX.watch, 'heading over'],
    [STATUS_HEX.good, 'on plan'],
    [NEUTRAL_HEX, 'too early to call'],
  ];
  let x = 10;
  for (const [colour, label] of legend) {
    parts.push(`<circle cx="${x + 8}" cy="${H - 16}" r="8" fill="${colour}"/>`);
    parts.push(
      `<text x="${x + 24}" y="${H - 10}" font-family="${FONT}" font-size="18" fill="${MUTED}">${label}</text>`
    );
    x += 34 + label.length * 9.4;
  }

  return (
    `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">` +
    `<rect width="${W}" height="${H}" fill="#ffffff"/>` +
    parts.join('') +
    `</svg>`
  );
}

export const BUBBLES_DISPLAY_WIDTH = W / 2;
export const BUBBLES_DISPLAY_HEIGHT = H / 2;
