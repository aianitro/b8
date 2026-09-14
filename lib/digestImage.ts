import sharp from 'sharp';
import { renderChartSvg, type ChartPoint } from './domain/digestChart';

/**
 * The chart, rasterised — the one step in the digest that is not pure, and the only one that needs
 * a native library.
 *
 * ─── PNG, not the SVG itself, and that is forced rather than preferred ────────────────────────
 *
 * Gmail strips `<svg>` from a message body and does not render an SVG attachment as an image
 * either. So the vector has to become pixels somewhere, and the only question is where. Doing it
 * here — once, at send time — keeps `lib/domain/digestChart.ts` a pure function whose geometry can
 * be asserted in the ordinary test suite without pulling a native dependency into it.
 *
 * ─── Why `sharp` and not a new dependency ─────────────────────────────────────────────────────
 *
 * It is already installed: Next uses it for image optimisation. Listing it in `package.json` as a
 * DIRECT dependency changes nothing about what is downloaded and everything about what is
 * guaranteed — a transitive install is a package that can disappear when the package that brought
 * it in changes its mind, and the failure would be a silent one at 6am with no chart in the mail.
 *
 * Twice the display size, so the image is sharp on a phone, where this is read.
 */
export async function renderChartPng(points: ChartPoint[]): Promise<Buffer> {
  const svg = renderChartSvg(points);
  return sharp(Buffer.from(svg, 'utf8')).png({ compressionLevel: 9 }).toBuffer();
}

/**
 * The `Content-ID` the HTML refers to and the attachment answers to.
 *
 * `cid:` IS the point of this whole arrangement. A remote `<img src="https://…">` is a second
 * outbound surface — it reaches a host nobody chose, and the request itself reports that the
 * message was opened, when, and from where. A `cid:` part is bytes already inside the envelope:
 * nothing is fetched, nothing is reported, and the message renders identically with the network
 * unplugged. The renderer's rule was never "no images", it was "nothing that phones home".
 *
 * A constant rather than a literal in two files, because the HTML reference and the attachment's
 * id have to be the same string or the image silently does not appear.
 */
export const CHART_CID = 'b8-digest-chart';
