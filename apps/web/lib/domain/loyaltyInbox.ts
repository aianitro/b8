// Loyalty inbox (P8-42c1) — the pure decisions about one forwarded message: whose mail it is (the
// original sender, and so the program), who it was for (the household member), and the dedupe key.
// No I/O: the poller (`lib/loyaltyInbox.ts`) lists, fetches and stores; this file only reads bytes
// it is handed. It is the only non-test importer of `mailparser`.
//
// ─── THE INPUT RULES ARE THE CONTRACT'S, NOT RESTATED HERE ────────────────────────────────────
//
// What a trustworthy sender domain is, what a forwarding address is, the hostname shape and the
// normalisation all live in `packages/contracts/loyalty.ts` (`isLoyaltySenderDomain`,
// `isLoyaltyForwardingAddress`, `isLoyaltyHostname`, `normaliseLoyaltyInboxEntry`, and the shared
// provider and suffix lists inside them). This file calls them. A second copy of "which domain may be
// trusted" is exactly the drift the contract package exists to prevent.
//
// ─── WHICH HEADER COUNTS (SPEC.md Conventions, exact) ─────────────────────────────────────────
//
// Only the ADDRESS of the From header. Never its display name, never Reply-To, Return-Path, Sender,
// Message-ID or Received, never From-looking text in a body except the one inline-forward rule
// below. A From with no mailbox, or more than one, or a domain that is not lower-case ASCII
// hostname-shaped once case-folded, is UNREADABLE: the poller counts it under `(unreadable)` and
// stores nothing. A domain is never rewritten: the parser is asked NOT to decode punycode (an
// `xn--` domain stays the ASCII text the owner can allowlist), and a raw non-ASCII domain is left as
// it is so the hostname shape refuses it rather than lower-casing a look-alike into a valid name.
//
// A FORWARDED ORIGINAL IS HONOURED ONLY FROM A REGISTERED MEMBER ADDRESS. A manual forward rewrites
// From to the forwarder, so the original must come from inside the message: first an attached
// message/rfc822 part, then an inline forward block. Both are believed only when the outer From is
// one of the household's registered forwarding addresses, so a stranger cannot make a forged
// "forwarded message" from an allowlisted brand credible. Otherwise the outer From is the sender.
//
// NO SENDER AUTHENTICATION. From is unauthenticated (no DKIM, SPF or DMARC); 42c2 must treat stored
// mail as untrusted input even though its domain was allowlisted.

import { createHash } from 'node:crypto';
import { parseAddressHeader, simpleParser, type ParsedMail } from 'mailparser';
import {
  isLoyaltyForwardingAddress,
  isLoyaltyHostname,
  isLoyaltySenderDomain,
  normaliseLoyaltyInboxEntry,
  type LoyaltyInboxAttribution,
  type LoyaltyInboxOrigin,
} from '@b8/contracts/loyalty';

// ─── Domain and address input ──────────────────────────────────────────────────────────────────

/** A submitted sender domain as stored (normalised), or null when it cannot be allowlisted. */
export function storedSenderDomain(input: string): string | null {
  const d = normaliseLoyaltyInboxEntry(input);
  return isLoyaltySenderDomain(d) ? d : null;
}

/** A submitted forwarding address as stored (normalised), or null when it is not a plain address. */
export function storedForwardingAddress(input: string): string | null {
  const a = normaliseLoyaltyInboxEntry(input);
  return isLoyaltyForwardingAddress(a) ? a : null;
}

// ─── The match rule ────────────────────────────────────────────────────────────────────────────

/**
 * The hostname-shaped, case-folded domain of an address, or null (unreadable). The domain is what
 * follows the LAST `@`; a local part must be present. `zq42c-brand.test@attacker.test` therefore has
 * the domain `attacker.test`, and a domain holding markup, a space or a non-ASCII letter is null.
 */
export function senderDomainOf(address: string | null | undefined): string | null {
  if (!address) return null;
  const a = normaliseLoyaltyInboxEntry(address);
  const at = a.lastIndexOf('@');
  if (at <= 0) return null;
  const domain = a.slice(at + 1);
  return isLoyaltyHostname(domain) ? domain : null;
}

export type StoredDomain = { domain: string; programId: number };

/**
 * The stored domain a sender domain belongs to: one it EQUALS, or one it ends with after a dot.
 * When several match (`brand.test` of one program, `mail.brand.test` of another) the LONGEST wins,
 * because the owner's more specific entry is the more deliberate one. A substring, a prefix, a
 * suffix without the dot, or a longer domain that merely contains a stored one never matches:
 * `brand.test.attacker.test` does not end with `.brand.test`, and `notbrand.test` is neither equal
 * to `brand.test` nor ends with `.brand.test`. The input is case-folded and must be hostname-shaped,
 * so a trailing dot, an `@`, an empty or a non-ASCII domain matches nothing. There is no
 * public-suffix logic: only what the owner stored can match.
 */
export function matchSenderDomain(domain: string | null, stored: readonly StoredDomain[]): StoredDomain | null {
  if (domain === null) return null;
  const d = normaliseLoyaltyInboxEntry(domain);
  if (!isLoyaltyHostname(d)) return null;
  let best: StoredDomain | null = null;
  for (const s of stored) {
    if (d === s.domain || d.endsWith(`.${s.domain}`)) {
      if (best === null || s.domain.length > best.domain.length) best = s;
    }
  }
  return best;
}

// ─── The dedupe key ────────────────────────────────────────────────────────────────────────────

const sha256 = (data: string | Buffer) => createHash('sha256').update(data).digest('hex');

/**
 * The dedupe key of a Message-ID: lower-case hex SHA-256 of the id with surrounding whitespace and
 * one pair of angle brackets removed, otherwise exact (case kept). Null when there is no id. Hashed
 * so no Message-ID text, which can embed an address, is ever stored.
 */
export function messageIdKey(messageId: string | null | undefined): string | null {
  if (messageId === null || messageId === undefined) return null;
  let id = messageId.trim();
  if (id.startsWith('<') && id.endsWith('>')) id = id.slice(1, -1).trim();
  return id === '' ? null : sha256(id);
}

/** The dedupe key of a message that carries no Message-ID: SHA-256 of `raw:` and its bytes. */
export function rawKey(raw: Buffer): string {
  return sha256(Buffer.concat([Buffer.from('raw:'), raw]));
}

/**
 * The key of a message with no Message-ID that is never downloaded (an unknown sender, or an
 * oversize one): its bytes are not available, so it is keyed on what the mailbox listed. A stated
 * limit (SPEC.md leaves this case open): it is stable across re-polls while the mailbox keeps its
 * UID numbering, which is what keeps the count from growing on every poll.
 */
export function envelopeKey(envelope: { id: string; receivedAt: string; size: number | null }): string {
  // A size the server did not report is spelled `null` in the key, and stays so on every re-poll.
  return sha256(`envelope:${envelope.id}:${envelope.receivedAt}:${envelope.size}`);
}

// ─── Reading a message ─────────────────────────────────────────────────────────────────────────

/**
 * Parser options: every message/rfc822 part stays an attachment (so rule 1 can find it), and no
 * HTML is generated or converted (nothing here renders the body; less work, less surface).
 */
const PARSE = { ignoreEmbedded: true, skipHtmlToText: true, skipTextToHtml: true, skipTextLinks: true, skipImageLinks: true, keepCidLinks: true } as const;

type HeaderLines = ParsedMail['headerLines'];

/** The unfolded values of every header named `key` (lower case), in message order. */
function headerValues(lines: HeaderLines, key: string): string[] {
  return lines
    .filter((h) => h.key === key)
    .map((h) => h.line.slice(h.line.indexOf(':') + 1).replace(/\r?\n[ \t]+/g, ' ').trim());
}

/** Every mailbox address in address-header values, case-folded, groups flattened, punycode kept. */
function addressesIn(values: string[]): string[] {
  if (values.length === 0) return [];
  return parseAddressHeader(values, { flatten: true, decodePunycode: false })
    .value.flatMap((v) => (v.address ? [normaliseLoyaltyInboxEntry(v.address)] : []));
}

/**
 * The single mailbox of a From value, case-folded, or null when there is none or more than one, or a
 * group. The display name is discarded here and never consulted anywhere.
 */
function singleMailbox(values: string[]): string | null {
  if (values.length !== 1) return null;
  const parsed = parseAddressHeader(values[0], { decodePunycode: false }).value;
  if (parsed.length !== 1 || parsed[0].group !== undefined || !parsed[0].address) return null;
  return normaliseLoyaltyInboxEntry(parsed[0].address);
}

/** The outer From's single address of a raw message, case-folded, or null (unreadable or absent). */
export async function outerFromAddress(raw: Buffer): Promise<string | null> {
  const parsed = await simpleParser(raw, PARSE);
  return singleMailbox(headerValues(parsed.headerLines, 'from'));
}

/**
 * The inline-forward markers, after any `>` quote prefix is removed: a run of two or more dashes
 * around `Forwarded message` or `Original Message`, or `Begin forwarded message:`; case-insensitive.
 */
const MARKER = /^(?:-{2,}\s*(?:forwarded message|original message)\s*-{2,}|begin forwarded message:)\s*$/i;
/** How many lines after a marker its `From:` line may be. */
const MARKER_REACH = 12;
const unquote = (line: string) => line.replace(/^(?:>[ \t]?)+/, '').trimEnd();

/**
 * An inline forward in a text body: the first marker followed within twelve lines by a `From:` line.
 * The forwarded header block is that From line and the non-blank lines after it; its To and Cc lines
 * are the tier-1 recipients. Null when there is no such marker.
 */
function inlineForward(text: string | undefined): { from: string; to: string[]; cc: string[] } | null {
  if (!text) return null;
  const lines = text.split(/\r?\n/).map(unquote);
  for (let i = 0; i < lines.length; i++) {
    if (!MARKER.test(lines[i].trim())) continue;
    for (let j = i + 1; j <= i + MARKER_REACH && j < lines.length; j++) {
      const m = /^from:\s*(.*)$/i.exec(lines[j].trim());
      if (!m) continue;
      const to: string[] = [];
      const cc: string[] = [];
      for (let k = j + 1; k < lines.length && lines[k].trim() !== ''; k++) {
        const h = /^(to|cc):\s*(.*)$/i.exec(lines[k].trim());
        if (h) (h[1].toLowerCase() === 'to' ? to : cc).push(h[2]);
      }
      return { from: m[1], to, cc };
    }
  }
  return null;
}

/** Received headers' `for <address>` clauses, oldest (last in the message) first. */
function receivedFor(lines: HeaderLines): string[] {
  return headerValues(lines, 'received')
    .reverse()
    .flatMap((v) => {
      const m = /\bfor\s+<?([^\s<>;]+@[^\s<>;]+?)>?(?=[\s;]|$)/i.exec(v);
      return m ? [normaliseLoyaltyInboxEntry(m[1])] : [];
    });
}

/** Every address of the X-Forwarded-For headers, space or comma separated, in order. */
function forwardedFor(lines: HeaderLines): string[] {
  return headerValues(lines, 'x-forwarded-for')
    .flatMap((v) => v.split(/[\s,]+/))
    .map((a) => a.replace(/^<|>$/g, ''))
    .filter((a) => a.includes('@'))
    .map(normaliseLoyaltyInboxEntry);
}

export interface InboxAnalysis {
  /** Where the original sender was read. */
  origin: LoyaltyInboxOrigin;
  /** The original sender's hostname-shaped domain, or null: unreadable. */
  senderDomain: string | null;
  /** Candidate recipient addresses, case-folded, by tier: index 0 is tier 1, index 4 is tier 5. */
  tiers: string[][];
}

/** Whether an address is a registered member forwarding address, as a set or a predicate. */
export type Registered = ReadonlySet<string> | ((address: string) => boolean);
const isRegistered = (r: Registered, a: string | null) => a !== null && (typeof r === 'function' ? r(a) : r.has(a));

/**
 * The original sender and the candidate recipients of a raw message (SPEC.md Conventions):
 *
 *   sender   1. attachment — outer From registered and a message/rfc822 part: that part's From.
 *            2. inline     — outer From registered and an inline forward block: its From: line.
 *            3. direct     — the outer From.
 *   tiers    1. inside the original: an attachment's Delivered-To, X-Original-To, To, Cc; an inline
 *               block's To then Cc lines.
 *            2. outer X-Original-To, X-Forwarded-For (every address), every Delivered-To.
 *            3. outer Received `for <address>`, oldest first.
 *            4. outer To, then Cc.
 *            5. outer From, only for an attachment or inline origin (the forwarder is the member).
 *
 * `registered` decides only whether a forwarded original is honoured.
 */
export async function analyseMessage(raw: Buffer, registered: Registered): Promise<InboxAnalysis> {
  const outer = await simpleParser(raw, PARSE);
  const L = outer.headerLines;
  const outerFrom = singleMailbox(headerValues(L, 'from'));
  const member = isRegistered(registered, outerFrom);

  let origin: LoyaltyInboxOrigin = 'direct';
  let sender = outerFrom;
  let tier1: string[] = [];

  const attached = member ? outer.attachments.find((a) => a.contentType === 'message/rfc822') : undefined;
  const inline = member && !attached ? inlineForward(outer.text) : null;
  if (attached) {
    const inner = await simpleParser(attached.content, PARSE);
    const IL = inner.headerLines;
    origin = 'attachment';
    sender = singleMailbox(headerValues(IL, 'from'));
    tier1 = [
      ...addressesIn(headerValues(IL, 'delivered-to')),
      ...addressesIn(headerValues(IL, 'x-original-to')),
      ...addressesIn(headerValues(IL, 'to')),
      ...addressesIn(headerValues(IL, 'cc')),
    ];
  } else if (inline) {
    origin = 'inline';
    sender = singleMailbox([inline.from]);
    tier1 = [...addressesIn(inline.to), ...addressesIn(inline.cc)];
  }

  const tiers = [
    tier1,
    [
      ...addressesIn(headerValues(L, 'x-original-to')),
      ...forwardedFor(L),
      ...addressesIn(headerValues(L, 'delivered-to')),
    ],
    receivedFor(L),
    [...addressesIn(headerValues(L, 'to')), ...addressesIn(headerValues(L, 'cc'))],
    origin !== 'direct' && outerFrom !== null ? [outerFrom] : [],
  ];
  return { origin, senderDomain: senderDomainOf(sender), tiers };
}

// ─── Attribution ───────────────────────────────────────────────────────────────────────────────

export interface Attribution {
  attribution: LoyaltyInboxAttribution;
  /** The member, exactly when `attribution` is `matched`. */
  memberId: number | null;
  /** The registered addresses that decided a match (their `last_received_on` moves); else empty. */
  addresses: string[];
}

/**
 * Who a message was for. The walk stops at the FIRST tier holding a registered address: one member
 * there is `matched`; two or more different members there is `ambiguous` (never guessed). A
 * non-member address (the dedicated mailbox's own, in Delivered-To) never stops the walk. With no
 * registered address in any tier: `unmatched` when some candidate existed, `none_found` when none.
 */
export function attributeMessage(tiers: readonly string[][], memberOf: ReadonlyMap<string, number>): Attribution {
  let anyCandidate = false;
  for (const tier of tiers) {
    if (tier.length > 0) anyCandidate = true;
    const hits = tier.filter((a) => memberOf.has(a));
    if (hits.length === 0) continue;
    const members = new Set(hits.map((a) => memberOf.get(a) as number));
    if (members.size > 1) return { attribution: 'ambiguous', memberId: null, addresses: [] };
    return { attribution: 'matched', memberId: [...members][0], addresses: [...new Set(hits)] };
  }
  return { attribution: anyCandidate ? 'unmatched' : 'none_found', memberId: null, addresses: [] };
}

// ─── What the reader is sent (P8-42c2) ─────────────────────────────────────────────────────────

/**
 * Every URL in text: a scheme and everything up to the next space, quote, angle bracket or closing
 * bracket, and the bare `www.` form. Tracking links carry tokens and, often, the recipient's address.
 */
const URL_IN_TEXT = /\b(?:[a-z][a-z0-9+.-]*:\/\/|www\.)[^\s<>"'\])]+/gi;
/**
 * A `mailto:` or `tel:` link (P8-42c3). Neither has `//`, so the URL rule above never saw them, and a
 * `mailto:` carries an address. `\b` keeps `Hotel:` and `Intel:` out, and at least one character
 * must follow the colon, so `Tel: ` before a printed phone number is left alone.
 */
const MAILTO_OR_TEL = /\b(?:mailto|tel):[^\s<>"'\])]+/gi;
/**
 * An e-mail address anywhere in the text (P8-42c3): a quoted one, one in a reply line, one the parser
 * rendered from an HTML anchor. Every dot in the domain must be followed by a label, so a sentence's
 * closing period stays outside it; a path, query or fragment glued directly to the address goes with
 * it, so no half of a tracking address is left behind. A local part of mask characters (`a***@`) and
 * a non-ASCII address do not match: stated residuals (SPEC.md Non-goals), not oversights.
 */
const ADDRESS_IN_TEXT = /[a-z0-9._%+'-]+@[a-z0-9-]+(?:\.[a-z0-9-]+)+(?:[/?#][^\s<>"'\])]*)?/gi;
/**
 * A link written without a scheme, such as a tracking host followed by a path (P8-42c3). The shape is
 * deliberately narrow, because the text it runs over is a statement full of figures: the last label
 * is two to twenty-four LETTERS, so a decimal, a dotted date, a multiplier or a version number never
 * qualifies, and the host must be followed at once by `/`, `?` or `#`, so a bare domain, a file name
 * or a sentence end glued by a dot is left as written. The lookbehind keeps it from starting inside a
 * word or right after an `@` (addresses are already gone by the time it runs).
 */
const BARE_LINK = /(?<![\w@])(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,24}(?::[0-9]{1,5})?(?=[/?#])[^\s<>"'\])]*/gi;
/** What a removed link becomes, so the sentence around it still reads. */
const LINK_PLACEHOLDER = '[link]';
/** What a removed e-mail address becomes; distinct from a link so the sentence still says what it was. */
const ADDRESS_PLACEHOLDER = '[address]';
/** The longest subject sent. A subject is a line, not a body. */
const SUBJECT_MAX_CHARS = 300;

/** At most `max` characters (code points, never half of a surrogate pair). */
const firstChars = (text: string, max: number) => {
  const chars = Array.from(text);
  return chars.length <= max ? text : chars.slice(0, max).join('');
};

/**
 * Links and addresses replaced, in the one order the spec fixes (SPEC.md "Order of operations"):
 * scheme links, then `mailto:`/`tel:`, then addresses, then scheme-less links. The order is the
 * point. The address rule runs after `mailto:` so a `mailto:` link is one `[link]` and not
 * `mailto:[address]`; it runs before the scheme-less rule so `name@host.example/u?t=…` is one
 * `[address]` and never `name@[link]`, which would leave the local part behind.
 */
const scrubbed = (text: string) =>
  text
    .replace(URL_IN_TEXT, LINK_PLACEHOLDER)
    .replace(MAILTO_OR_TEL, LINK_PLACEHOLDER)
    .replace(ADDRESS_IN_TEXT, ADDRESS_PLACEHOLDER)
    .replace(BARE_LINK, LINK_PLACEHOLDER);

/**
 * The text without the header block of any inline forward (P8-42c3, SPEC.md "The inline-forward
 * header block"). The marker and its twelve-line reach are 42c1's own (`MARKER`, `MARKER_REACH`,
 * `unquote`), so the block removed here is the block the poll read the original sender from. For
 * each marker, the nearest `From:` line within reach and every non-blank line directly after it
 * (To, Cc, Date, Subject, folded continuations) go, whole and with any quote prefix; the marker, the
 * lines before the From line, the blank separator and the statement after it stay verbatim. Every
 * marker is handled, so a forward of a forward loses both blocks. It is shape-based and runs whatever
 * the stored origin: a member's inline forward, a stranger's quoted reply and an attached original
 * all lose the block alike, and the addresses in a block left in place are still scrubbed after.
 */
function withoutForwardHeaders(text: string): string {
  const lines = text.split('\n');
  const bare = lines.map((line) => unquote(line).trim());
  const drop = new Set<number>();
  for (let i = 0; i < lines.length; i++) {
    if (!MARKER.test(bare[i])) continue;
    for (let j = i + 1; j <= i + MARKER_REACH && j < lines.length; j++) {
      if (!/^from:/i.test(bare[j])) continue;
      for (let k = j; k < lines.length && bare[k] !== ''; k++) drop.add(k);
      break;
    }
  }
  return drop.size === 0 ? text : lines.filter((_, n) => !drop.has(n)).join('\n');
}

/**
 * Parser options for reading a stored message's text: no HTML generated, links not rewritten, and
 * every message/rfc822 part kept as an attachment (`ignoreEmbedded`), exactly as the poll's `PARSE`
 * keeps it (P8-42c3 A2). Without that flag the parser merges an attached message marked
 * `Content-Disposition: inline` into the surrounding text, its From, To, Date and Subject lines
 * included: the poll would have stored the forward as `attachment`, but the reader would find no
 * attachment and send the covering note with the original's headers. The same flag keeps a forward
 * nested inside the chosen original, and a stranger's inline original, out of the text. `PARSE`
 * itself is not reused because it also skips the HTML-to-text conversion an HTML-only statement needs.
 */
const READ_PARSE = { ignoreEmbedded: true, skipTextToHtml: true, skipTextLinks: true, skipImageLinks: true, keepCidLinks: true } as const;
/**
 * How far past the final length the text is kept BEFORE the scrub (P8-42c3 A2, A3). The four
 * patterns cost time that grows with the square of an unbroken run (a long token with no space in
 * it), and a stored mail may be megabytes: measured, a run of a million characters did not finish in
 * ten minutes, all of it under the read lock. Bounding first makes the scrub's cost a function of
 * `maxChars`, not of the mail. The margin is slack for the scrub to work in; it is NOT what keeps a
 * token whole (that is `tokenSafePrefix` below, and A2's claim that the margin alone did was wrong).
 */
const SCRUB_MARGIN_CHARS = 1024;

/** Whether one code point is whitespace, by the same `\s` the patterns stop at. */
const isSpace = (c: string) => /^\s$/.test(c);

/**
 * The first `bound` code points of `text`, never ending inside a token (P8-42c3 A3).
 *
 * WHY A WHOLE TOKEN GOES. None of the four patterns ever matches across whitespace, so the scrub of a
 * prefix that ends on a token boundary is exactly a prefix of the scrub of the whole text: every
 * token it sees is complete, and an address is either replaced whole or not reached at all. A cut in
 * the middle of a token breaks that. `zq42c3-anna@host` cut to `zq42c3-an` matches nothing and
 * survives the scrub as text; and because the scrub then shortens what comes before it (forty long
 * tracking links become `[link]`), the fragment moves inside the final `maxChars` and is sent.
 * Measured against A2's plain cut: the text sent ended in exactly such a fragment.
 *
 * So when the text is longer than the bound and the bound falls inside a token (the last kept and
 * the first dropped code point are both non-whitespace), the kept part also loses that trailing
 * token, back to the last whitespace before it. A prefix with no whitespace at all is one token and
 * becomes empty: the caller then records `empty_message` (text) or sends no subject. That only ever
 * sends less, which is the stated residual.
 *
 * Linear by construction: one pass to split code points and one backward scan, no pattern over the
 * kept string, because a backtracking pattern here would reintroduce the cost the bound exists for.
 */
function tokenSafePrefix(text: string, bound: number): string {
  const chars = Array.from(text);
  if (chars.length <= bound) return text;
  if (bound <= 0) return '';
  let end = bound;
  if (!isSpace(chars[bound - 1]) && !isSpace(chars[bound])) {
    while (end > 0 && !isSpace(chars[end - 1])) end--;
  }
  return chars.slice(0, end).join('');
}

/**
 * WHAT THE MODEL SEES OF ONE STORED MESSAGE (P8-42c2, SPEC.md Open question 3; P8-42c3): the subject
 * and the text of ONE chosen message, and nothing else. No header of any message is sent — not From,
 * To, Cc, Delivered-To, Received, Date or the Message-ID — so no routing detail leaves the machine.
 *
 *   chosen  — the outer message, unless the stored `origin` is `attachment` and the bytes hold a
 *             message/rfc822 part: then the FIRST such part, parsed as a message, and nothing of the
 *             forwarder's covering note or covering subject, even when the original has no subject
 *             or no text (an empty original gives empty text and the caller records `empty_message`;
 *             it never falls back to the note). The stored origin is 42c1's record of "a registered
 *             member forwarded this as an attachment"; it is not re-derived here from the bytes, so a
 *             stranger's mail with an attached message (stored `direct`) is read as its outer
 *             message, exactly as before. Omitted means `direct`. Only that one part is read: not a
 *             later one, not the original's own attachments, and a forward nested inside it is not
 *             unwrapped.
 *   text    — the chosen message's text/plain part when there is one; otherwise its HTML converted to
 *             text by the parser, which drops `script` and `style` and never keeps markup. Line
 *             breaks become LF, inline-forward header blocks go, the text is bounded to `maxChars`
 *             plus `SCRUB_MARGIN_CHARS` without ending inside a token (`tokenSafePrefix`), so the
 *             scrub's cost cannot grow with the mail and it never sees half a token, links and
 *             addresses are scrubbed, the result is trimmed, and only THEN cut at `maxChars`
 *             characters: a cut at `maxChars` before the scrub could leave half an address
 *             (`anna@exa`) that no pattern recognises any more.
 *             Empty means there is nothing to read: the caller records `empty_message` and never
 *             calls the model.
 *   subject — the chosen message's subject, bounded and scrubbed the same way (no block removal: it
 *             is one line), at most 300 characters; null when there is none or nothing is left. A
 *             subject that was only an address is `[address]`, which is text, not null.
 *
 * Pure: it parses the bytes it is handed. What is not scrubbed still reaches the model and is a
 * stated residual: names, postal addresses, plain phone numbers with no `tel:`, member numbers,
 * balances, dates, masked-local and non-ASCII addresses. The request asks for program fields only
 * and nothing else is kept from it.
 */
export async function textForReader(
  raw: Buffer,
  maxChars: number,
  origin: LoyaltyInboxOrigin = 'direct'
): Promise<{ subject: string | null; text: string }> {
  const outer = await simpleParser(raw, READ_PARSE);
  const attached = origin === 'attachment' ? outer.attachments.find((a) => a.contentType === 'message/rfc822') : undefined;
  const chosen = attached ? await simpleParser(attached.content, READ_PARSE) : outer;
  const body = typeof chosen.text === 'string' ? chosen.text.replace(/\r\n?/g, '\n') : '';
  const text = firstChars(scrubbed(tokenSafePrefix(withoutForwardHeaders(body), maxChars + SCRUB_MARGIN_CHARS)).trim(), maxChars);
  const subjectText = typeof chosen.subject === 'string' ? scrubbed(tokenSafePrefix(chosen.subject, SUBJECT_MAX_CHARS + SCRUB_MARGIN_CHARS)).trim() : '';
  return { subject: subjectText === '' ? null : firstChars(subjectText, SUBJECT_MAX_CHARS), text };
}
