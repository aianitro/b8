// What a transaction's detail sheet shows: the row's own columns plus the parts of Plaid's
// enrichment that never earned a column — street address, coordinates, store number,
// counterparties, payment method — read out of `plaid_raw` here, on the server.
//
// PURE, AND THE ONLY READER OF plaid_raw FOR A CLIENT. The migration that added `plaid_raw` says
// it must never be returned to a client, so the route hands back this curated object instead: a
// fixed set of named fields, each typed and checked, and nothing else from the blob. A key Plaid
// adds tomorrow reaches no browser until it is named here.
//
// No money is read out of `plaid_raw` either. `amount` comes from the column, which stays the
// only authoritative figure.

import { safeLogoUrl } from './enrichedDisplay';

export interface DetailLocation {
  address: string | null;
  city: string | null;
  region: string | null;
  postalCode: string | null;
  country: string | null;
  storeNumber: string | null;
}

export interface DetailCounterparty {
  name: string;
  /** Plaid's type, made readable: "Payment app", "Financial institution". */
  type: string | null;
  /** Safe `https:` link, or null. */
  website: string | null;
  /** `safeLogoUrl`'s output, or null. */
  logoUrl: string | null;
}

export interface TransactionDetail {
  id: number;
  /** `YYYY-MM-DD`, posted. */
  date: string;
  /** `YYYY-MM-DD`, only when it differs from the posted date. */
  authorizedDate: string | null;
  /** Plaid's sign: positive is money out. */
  amount: number;
  title: string | null;
  /** The bank's own text for the row, when it says something the title does not. */
  bankDescription: string | null;
  logoUrl: string | null;
  website: string | null;
  account: { id: string; name: string };
  budgetCategory: string | null;
  plaidCategory: string | null;
  plaidCategoryDetailed: string | null;
  plaidConfidence: string | null;
  paymentChannel: string | null;
  paymentMethod: string | null;
  paymentProcessor: string | null;
  location: DetailLocation | null;
  /** A maps search for the coordinates or, failing them, the street address. Null when neither. */
  mapsUrl: string | null;
  counterparties: DetailCounterparty[];
  note: string | null;
  watched: boolean;
  hidden: boolean;
  /** False when nothing was captured from Plaid for this row (manual, CSV, cash, or pre-capture). */
  enriched: boolean;
}

/** The row as the route selects it. Dates arrive `::text`; `amount` as NUMERIC text. */
export interface DetailRow {
  id: number;
  date: string;
  authorized_date: string | null;
  amount: string | number;
  name: string | null;
  merchant_name: string | null;
  logo_url: string | null;
  website: string | null;
  account_id: string;
  account_name: string;
  mapped_category: string | null;
  plaid_category: string | null;
  plaid_category_detailed: string | null;
  plaid_category_confidence: string | null;
  payment_channel: string | null;
  location_city: string | null;
  location_region: string | null;
  location_country: string | null;
  note: string | null;
  watched_at: unknown;
  hidden: boolean;
  plaid_raw: unknown;
}

/** Trimmed text, or null for anything that is not a non-blank string. */
function text(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const t = value.trim();
  return t === '' ? null : t;
}

function obj(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

/** `FOOD_AND_DRINK` / `in store` / `payment_app` → "Food and drink" / "In store" / "Payment app". */
export function readable(value: string | null): string | null {
  if (value === null) return null;
  const words = value.replace(/[_\s]+/g, ' ').trim().toLowerCase();
  return words === '' ? null : words[0].toUpperCase() + words.slice(1);
}

/**
 * The detailed category without its primary prefix: `FOOD_AND_DRINK_COFFEE` under
 * `FOOD_AND_DRINK` is "Coffee". Said in full when it does not start with the primary, and not at
 * all when it adds nothing to it.
 */
export function detailedCategory(primary: string | null, detailed: string | null): string | null {
  if (detailed === null) return null;
  if (primary !== null && detailed.startsWith(`${primary}_`)) return readable(detailed.slice(primary.length + 1));
  if (detailed === primary) return null;
  return readable(detailed);
}

/**
 * A website as a link, or null. Plaid sends bare hosts (`starbucks.com`), so a value with no
 * scheme is read as https. Anything that does not come out as an `http(s)` URL with a dotted host
 * and no credentials is refused — the column is third-party text and this lands in an `href`.
 */
export function safeWebsiteUrl(value: unknown): string | null {
  const t = text(value);
  if (t === null || t.length > 2048 || /[\x00-\x20\x7f]/.test(t)) return null;
  const hasScheme = /^[a-z][a-z0-9+.-]*:/i.test(t);
  if (hasScheme && !/^https?:\/\//i.test(t)) return null;
  let url: URL;
  try {
    url = new URL(hasScheme ? t : `https://${t}`);
  } catch {
    return null;
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') return null;
  if (!url.hostname.includes('.') || url.username !== '' || url.password !== '') return null;
  return url.href;
}

/** A finite coordinate within range, or null. Plaid sends numbers; anything else is refused. */
function coordinate(value: unknown, limit: number): number | null {
  return typeof value === 'number' && Number.isFinite(value) && Math.abs(value) <= limit ? value : null;
}

/**
 * A Google Maps search URL. Coordinates when both are present and in range; else the street
 * address with whatever of city, region and postcode exist. A LINK, never an embedded map: an
 * embed would tell a third party where the owner shops every time the sheet opened, where a link
 * tells it only when the owner chooses to follow it.
 */
export function mapsUrl(loc: Record<string, unknown> | null, fallback: DetailLocation | null): string | null {
  const lat = coordinate(loc?.lat, 90);
  const lon = coordinate(loc?.lon, 180);
  const base = 'https://www.google.com/maps/search/?api=1&query=';
  if (lat !== null && lon !== null) return base + encodeURIComponent(`${lat},${lon}`);
  if (fallback?.address) {
    const parts = [fallback.address, fallback.city, fallback.region, fallback.postalCode].filter((p) => p !== null);
    return base + encodeURIComponent(parts.join(', '));
  }
  return null;
}

export function transactionDetail(row: DetailRow): TransactionDetail {
  const raw = obj(row.plaid_raw);
  const rawLoc = obj(raw?.location);

  // The columns hold the cheap parts of the location; the blob, the rest. A column wins where
  // both exist — it went through the same sanitising when it was written.
  const location: DetailLocation = {
    address: text(rawLoc?.address),
    city: text(row.location_city) ?? text(rawLoc?.city),
    region: text(row.location_region) ?? text(rawLoc?.region),
    postalCode: text(rawLoc?.postal_code),
    country: text(row.location_country) ?? text(rawLoc?.country),
    storeNumber: text(rawLoc?.store_number),
  };
  const hasLocation = Object.values(location).some((v) => v !== null);

  const counterparties: DetailCounterparty[] = Array.isArray(raw?.counterparties)
    ? (raw.counterparties as unknown[]).flatMap((c) => {
        const cp = obj(c);
        const name = text(cp?.name);
        if (cp === null || name === null) return [];
        return [{
          name,
          type: readable(text(cp.type)),
          website: safeWebsiteUrl(cp.website),
          logoUrl: safeLogoUrl(text(cp.logo_url)),
        }];
      })
    : [];

  const meta = obj(raw?.payment_meta);
  const title = text(row.merchant_name) ?? text(row.name);
  const name = text(row.name);
  const authorized = text(row.authorized_date);
  const primary = text(row.plaid_category);

  return {
    id: row.id,
    date: row.date,
    authorizedDate: authorized !== null && authorized !== row.date ? authorized : null,
    amount: Number(row.amount),
    title,
    bankDescription: name !== null && name !== title ? name : null,
    logoUrl: safeLogoUrl(row.logo_url),
    website: safeWebsiteUrl(row.website),
    account: { id: row.account_id, name: row.account_name },
    budgetCategory: text(row.mapped_category),
    plaidCategory: readable(primary),
    plaidCategoryDetailed: detailedCategory(primary, text(row.plaid_category_detailed)),
    plaidConfidence: readable(text(row.plaid_category_confidence)),
    paymentChannel: readable(text(row.payment_channel)),
    paymentMethod: readable(text(meta?.payment_method)),
    paymentProcessor: text(meta?.payment_processor),
    location: hasLocation ? location : null,
    mapsUrl: hasLocation ? mapsUrl(rawLoc, location) : null,
    counterparties,
    note: text(row.note),
    watched: row.watched_at !== null && row.watched_at !== undefined,
    hidden: row.hidden,
    enriched: raw !== null,
  };
}
