// P7-41c — attaching a row already in the ledger, and the form's default window: U1–U9 of
// plan/tasks/P7-41c-gift-attach/SPEC.md, one `it` each, titled by id.
//
// Pure. Nothing here reads a clock or a database: every `today` is a string handed in, and the
// date scenarios run unchanged under any process time zone (acceptance #4 runs this file under
// three). U8 and U9 read SOURCE, over the AST with the TypeScript compiler API, the way
// `giftSurfaceWiring.test.ts` does — and every checker is also run against fabricated sources that
// break its rule and a clean one, so a checker that matches nothing cannot pass the real tree.
//
// Every value is fabricated; merchants are invented names, and canaries are `ZQ41C…` tokens.

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import ts from 'typescript';
import { describe, expect, it } from 'vitest';
import {
  acceptsAttach,
  addDays,
  attachFloor,
  giftFormDefaults,
  isAttachCandidate,
  isCandidate,
  stateAfterClaim,
  type AttachRow,
  type GiftCriteria,
} from './domain/giftMatch';
import { localIsoDate } from './localDate';
import { GUARDED_WRITERS, ROUTES } from './giftSurfaceRegistry';

const WEB = fileURLToPath(new URL('..', import.meta.url));

const GIFT: GiftCriteria = {
  id: 7,
  createdAt: '2026-10-01T09:00:00.000000',
  state: 'awaiting',
  amount: '48.15',
  merchant: 'quillfeather',
  accountId: 'acct-zq41c-card',
  windowStart: '2026-11-01',
  windowEnd: '2026-11-10',
};

const ROW: AttachRow = {
  id: 300,
  plaidTransactionId: 'plaid-zq41c-1',
  accountId: 'acct-zq41c-card',
  date: '2026-11-05',
  authorizedDate: null,
  amount: '48.15',
  name: 'QUILLFEATHER GOODS ZQ41C',
  merchantName: 'Quillfeather Goods',
  pending: false,
  linked: false,
  inTransferGroup: false,
};

const row = (patch: Partial<AttachRow>): AttachRow => ({ ...ROW, ...patch });
const gift = (patch: Partial<GiftCriteria>): GiftCriteria => ({ ...GIFT, ...patch });
const anyWindow = (g: GiftCriteria): GiftCriteria => ({ ...g, windowStart: '0001-01-01', windowEnd: '9999-12-31' });

describe('which row the giver may attach (U1–U3)', () => {
  it('T41c-U1: the attach rule ignores the window — a row long before it, long after it, and one with no authorized date all qualify', () => {
    const before = row({ date: '2025-01-03', authorizedDate: '2025-01-02' });
    const after = row({ date: '2027-06-30', authorizedDate: '2027-06-29' });
    const noAuth = row({ date: '2026-12-25', authorizedDate: null });
    for (const r of [before, after, noAuth]) {
      expect({ date: r.date, ok: isAttachCandidate(GIFT, r) }).toEqual({ date: r.date, ok: true });
    }
    // The window is what changed: the sync's rule refuses the first two.
    expect(isCandidate(GIFT, before)).toBe(false);
    expect(isCandidate(GIFT, after)).toBe(false);
    // And not vacuous: the same rows fail attach on a criterion.
    expect(isAttachCandidate(GIFT, { ...before, amount: '48.16' })).toBe(false);
  });

  it('T41c-U2: reuse, not redefinition — for every gift and row shape outside a transfer, attach equals isCandidate with a window that holds every date', () => {
    const gifts: GiftCriteria[] = [
      GIFT,
      gift({ amount: null }),
      gift({ merchant: null }),
      gift({ accountId: null }),
      gift({ amount: '0.15', merchant: null, accountId: null }),
      gift({ merchant: 'goods', windowStart: '2026-01-01', windowEnd: '2026-01-01' }),
    ];
    const rows: AttachRow[] = [
      ROW,
      row({ amount: '48.16' }), // amount miss
      row({ amount: '48.14' }),
      row({ amount: '48.150' }), // a third decimal is not a cent value
      row({ amount: '0.15' }),
      row({ merchantName: 'Inkwell Supply' }), // merchant miss
      row({ merchantName: null }), // name fallback, a hit
      row({ merchantName: null, name: 'OTHER ZQ41C' }), // name fallback, a miss
      row({ merchantName: null, name: null }),
      row({ accountId: 'acct-zq41c-other' }), // account miss
      row({ amount: '-48.15' }), // refund
      row({ amount: '0.00' }), // zero
      row({ plaidTransactionId: 'manual_zq41c' }),
      row({ plaidTransactionId: 'csv_zq41c' }),
      row({ pending: true }),
      row({ linked: true }),
      row({ date: '2026-11-01' }), // inside the window
      row({ date: '2026-10-31', authorizedDate: null }), // outside, before
      row({ date: '2026-11-11', authorizedDate: '2026-11-10' }), // posted after, authorized inside
      row({ date: '2026-12-01', authorizedDate: '2026-12-01' }), // both outside
    ];
    let pairs = 0;
    for (const g of gifts) {
      for (const r of rows) {
        pairs++;
        expect({ g: g.amount + '/' + g.merchant, r: r.id + r.amount + r.date, same: isAttachCandidate(g, r) })
          .toEqual({ g: g.amount + '/' + g.merchant, r: r.id + r.amount + r.date, same: isCandidate(anyWindow(g), r) });
      }
    }
    expect(pairs).toBeGreaterThanOrEqual(40);
    // The grid is not all one answer.
    const answers = gifts.flatMap((g) => rows.map((r) => isAttachCandidate(g, r)));
    expect(answers.filter(Boolean).length).toBeGreaterThan(5);
    expect(answers.filter((a) => !a).length).toBeGreaterThan(5);
  });

  it('T41c-U3: every refusal shape is applied, one assertion each', () => {
    expect(isAttachCandidate(GIFT, ROW)).toBe(true); // the control every refusal below departs from
    expect(isAttachCandidate(GIFT, row({ amount: '-48.15' }))).toBe(false);
    expect(isAttachCandidate(gift({ amount: null }), row({ amount: '0.00' }))).toBe(false);
    expect(isAttachCandidate(GIFT, row({ pending: true }))).toBe(false);
    expect(isAttachCandidate(GIFT, row({ plaidTransactionId: 'manual_zq41c' }))).toBe(false);
    expect(isAttachCandidate(GIFT, row({ plaidTransactionId: 'csv_zq41c' }))).toBe(false);
    expect(isAttachCandidate(GIFT, row({ linked: true }))).toBe(false);
    expect(isAttachCandidate(GIFT, row({ amount: '48.16' }))).toBe(false);
    expect(isAttachCandidate(GIFT, row({ amount: '48.14' }))).toBe(false);
    // The float traps of T41b-M3: each matches itself exactly, and fails one cent either way.
    for (const a of ['0.15', '19.35', '2.55', '1.57', '100.07', '48.15', '33.33']) {
      const g = gift({ amount: a });
      const [whole, frac] = a.split('.');
      const up = `${whole}.${String(Number(frac) + 1).padStart(2, '0')}`;
      const down = `${whole}.${String(Number(frac) - 1).padStart(2, '0')}`;
      expect({ a, self: isAttachCandidate(g, row({ amount: a })), up: isAttachCandidate(g, row({ amount: up })), down: isAttachCandidate(g, row({ amount: down })) })
        .toEqual({ a, self: true, up: false, down: false });
    }
    expect(isAttachCandidate(GIFT, row({ merchantName: 'Inkwell Supply', name: 'INKWELL ZQ41C' }))).toBe(false);
    expect(isAttachCandidate(gift({ merchant: 'qu' }), ROW)).toBe(false); // two characters
    expect(isAttachCandidate(gift({ merchant: '   ' }), ROW)).toBe(false); // whitespace only
    // Literal criteria: a LIKE or a regex reading would match these rows; a literal one does not.
    const literal: [string, string][] = [['a_b', 'axb store'], ['100%', '1000 things'], ['.*', 'anything at all'], ['(', 'no paren here']];
    for (const [criterion, merchant] of literal) {
      expect({ criterion, ok: isAttachCandidate(gift({ merchant: criterion, amount: null }), row({ merchantName: merchant })) })
        .toEqual({ criterion, ok: false });
    }
    expect(isAttachCandidate(gift({ merchant: 'a_b', amount: null }), row({ merchantName: 'shop a_b ZQ41C' }))).toBe(true);
    expect(isAttachCandidate(GIFT, row({ accountId: 'acct-zq41c-other' }))).toBe(false);
    // ANDed: amount hit and merchant miss, and the reverse.
    expect(isAttachCandidate(GIFT, row({ merchantName: 'Inkwell Supply', name: null }))).toBe(false);
    expect(isAttachCandidate(GIFT, row({ amount: '12.07' }))).toBe(false);
    expect(isAttachCandidate(gift({ amount: null, merchant: null }), ROW)).toBe(false);
    // Half of a transfer pair, with everything else matching.
    expect(isAttachCandidate(GIFT, row({ inTransferGroup: true }))).toBe(false);
  });
});

describe('when a gift can take a row, and which rows are recent enough (U4–U6)', () => {
  it('T41c-U4: a gift accepts an attach only while awaiting or choose and strictly before its reveal date, across a month and a year end', () => {
    for (const today of ['2026-10-22', '2026-10-31', '2026-12-31', '2028-02-28', '2028-02-29']) {
      for (const state of ['awaiting', 'choose'] as const) {
        expect({ today, state, tomorrow: acceptsAttach(state, addDays(today, 1), today) }).toEqual({ today, state, tomorrow: true });
        expect({ today, state, onTheDay: acceptsAttach(state, today, today) }).toEqual({ today, state, onTheDay: false });
        expect({ today, state, yesterday: acceptsAttach(state, addDays(today, -1), today) }).toEqual({ today, state, yesterday: false });
      }
      for (const state of ['matched', 'unmatched', 'cancelled'] as const) {
        expect({ today, state, ok: acceptsAttach(state, '2099-12-31', today) }).toEqual({ today, state, ok: false });
      }
    }
    // The rollovers themselves, spelled out.
    expect(acceptsAttach('awaiting', '2026-11-01', '2026-10-31')).toBe(true);
    expect(acceptsAttach('awaiting', '2027-01-01', '2026-12-31')).toBe(true);
    expect(acceptsAttach('awaiting', '2026-12-31', '2027-01-01')).toBe(false);
  });

  it('T41c-U5: the candidate floor is the creation date minus seven days, inclusive, across a leap year and a year end', () => {
    expect(attachFloor('2026-03-01', 7)).toBe('2026-02-22');
    expect(attachFloor('2028-03-02', 7)).toBe('2028-02-24');
    expect(attachFloor('2027-01-03', 7)).toBe('2026-12-27');
    expect(attachFloor('2026-10-22', 0)).toBe('2026-10-22');
    const floor = attachFloor('2026-03-01', 7);
    const inside = (date: string) => date >= floor;
    expect(inside(addDays(floor, -1))).toBe(false);
    expect(inside(floor)).toBe(true);
    expect(inside(addDays(floor, 1))).toBe(true);
    expect(addDays(floor, -1)).toBe('2026-02-21');
  });

  it('T41c-U6: one attached row matches an awaiting gift; a choose gift stays choose holding one more', () => {
    expect(stateAfterClaim('awaiting', 0, 1)).toBe('matched');
    expect(stateAfterClaim('choose', 2, 1)).toBe('choose');
    expect(stateAfterClaim('choose', 1, 1)).toBe('choose');
    // An awaiting gift with nothing held never skips to choose on a single attach.
    expect(stateAfterClaim('awaiting', 0, 1)).not.toBe('choose');
  });
});

describe('the form opens on the giver\'s today (U7)', () => {
  it('T41c-U7: the defaults are the local date in both fields and nothing else, under any process zone', () => {
    expect(giftFormDefaults('2026-10-22')).toEqual({ windowStart: '2026-10-22', windowEnd: '2026-10-22' });
    for (const d of ['2026-10-31', '2028-02-29', '2026-12-31', '2027-01-01']) {
      const out = giftFormDefaults(d);
      expect(Object.keys(out).sort()).toEqual(['windowEnd', 'windowStart']);
      expect(out).toEqual({ windowStart: d, windowEnd: d });
      expect(out.windowEnd >= out.windowStart).toBe(true);
    }
    // The browser's calendar: a local late-evening moment is still that local day, whatever
    // `TZ` this process runs under — the UTC slice would say the next day west of Greenwich.
    const lateEvening = new Date(2026, 9, 22, 23, 30);
    expect(giftFormDefaults(localIsoDate(lateEvening))).toEqual({ windowStart: '2026-10-22', windowEnd: '2026-10-22' });
    const earlyMorning = new Date(2026, 11, 31, 0, 15);
    expect(giftFormDefaults(localIsoDate(earlyMorning))).toEqual({ windowStart: '2026-12-31', windowEnd: '2026-12-31' });
  });
});

// ─── U8: the two components, over the AST ──────────────────────────────────────────────────────

function parseText(file: string, text: string): ts.SourceFile {
  return ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
}

function walk(node: ts.Node, visit: (n: ts.Node) => void): void {
  visit(node);
  ts.forEachChild(node, (c) => walk(c, visit));
}

function some(node: ts.Node, test: (n: ts.Node) => boolean): boolean {
  let hit = false;
  walk(node, (n) => { if (!hit && test(n)) hit = true; });
  return hit;
}

const isCallTo = (n: ts.Node, name: string) =>
  ts.isCallExpression(n) && ts.isIdentifier(n.expression) && n.expression.text === name;

/** The text of a fetch URL argument: a string, or a template with every `${…}` as `*`. */
function urlText(e: ts.Expression | undefined): string | null {
  if (!e) return null;
  if (ts.isStringLiteral(e) || ts.isNoSubstitutionTemplateLiteral(e)) return e.text;
  if (ts.isTemplateExpression(e)) return e.head.text + e.templateSpans.map((s) => '*' + s.literal.text).join('');
  return null;
}

/** Problems with the gift form's notion of today. Empty means the rule holds. */
function formProblems(sf: ts.SourceFile): string[] {
  const out: string[] = [];
  const importsLocal = sf.statements.some((s) => ts.isImportDeclaration(s)
    && (s.moduleSpecifier as ts.StringLiteral).text === '@/lib/localDate'
    && !!s.importClause?.namedBindings && ts.isNamedImports(s.importClause.namedBindings)
    && s.importClause.namedBindings.elements.some((e) => e.name.text === 'localIsoDate'));
  if (!importsLocal) out.push('localIsoDate is not imported from @/lib/localDate');
  walk(sf, (n) => {
    if (ts.isNewExpression(n) && ts.isIdentifier(n.expression) && n.expression.text === 'Date') out.push('new Date(');
    if (ts.isPropertyAccessExpression(n) && /^(toISOString|getTimezoneOffset)$/.test(n.name.text)) out.push(n.name.text);
    // localIsoDate is only ever CALLED (never passed on, never stored as a value).
    if (ts.isIdentifier(n) && n.text === 'localIsoDate' && !ts.isImportSpecifier(n.parent)
        && !(ts.isCallExpression(n.parent) && n.parent.expression === n)) out.push('localIsoDate used without a call');
  });
  let calls = 0;
  walk(sf, (n) => { if (isCallTo(n, 'localIsoDate')) calls++; });
  if (calls === 0) out.push('no localIsoDate() call');
  // The default is LIVE: read by useSyncExternalStore, whose snapshot calls localIsoDate() on every
  // render, so a field nobody has typed in shows today whenever it is looked at.
  const live = some(sf, (n) => isCallTo(n, 'useSyncExternalStore')
    && some((n as ts.CallExpression).arguments[1] ?? n, (m) => isCallTo(m, 'localIsoDate'))
    && (n as ts.CallExpression).arguments.length >= 2);
  if (!live) out.push('the default is not re-read from localIsoDate on every render');
  // The submit handler: the function that posts the gift. Every setForm in it must leave the two
  // dates UNSET (null), so they go back to following the live default. Pinning them to any date —
  // the first render's, or a fresh localIsoDate() at the moment of the save — leaves the next gift
  // marked after midnight on yesterday.
  const submits: ts.Node[] = [];
  walk(sf, (n) => {
    if ((ts.isFunctionDeclaration(n) || ts.isArrowFunction(n) || ts.isFunctionExpression(n))
        && some(n, (m) => isCallTo(m, 'fetch') && urlText((m as ts.CallExpression).arguments[0]) === '/api/v1/gifts')) {
      submits.push(n);
    }
  });
  const handler = submits[submits.length - 1];
  if (!handler) out.push('no submit handler');
  else {
    const resets: ts.CallExpression[] = [];
    walk(handler, (n) => { if (isCallTo(n, 'setForm')) resets.push(n as ts.CallExpression); });
    if (resets.length === 0) out.push('the submit handler never resets the form');
    for (const r of resets) {
      if (r.arguments.length !== 1 || !leavesDatesUnset(sf, r.arguments[0])) out.push('a reset pins the dates instead of leaving them to follow today');
    }
  }
  if (some(sf, (n) => (ts.isStringLiteralLike(n) || ts.isTemplateLiteralToken(n)) && /\/candidates/.test(n.text))) {
    out.push('the form mentions candidates');
  }
  return out;
}

const DATE_KEYS = ['windowStart', 'windowEnd'];

/** A same-file `const` whose initializer is an object literal, or null. */
function constObject(sf: ts.SourceFile, name: string): ts.ObjectLiteralExpression | null {
  let found: ts.ObjectLiteralExpression | null = null;
  walk(sf, (n) => {
    if (ts.isVariableDeclaration(n) && ts.isIdentifier(n.name) && n.name.text === name && n.initializer
        && (n.parent.flags & ts.NodeFlags.Const)) {
      let init: ts.Expression = n.initializer;
      while (ts.isAsExpression(init) || ts.isSatisfiesExpression(init) || ts.isParenthesizedExpression(init)) init = init.expression;
      if (ts.isObjectLiteralExpression(init)) found = init;
    }
  });
  return found;
}

/**
 * Whether the state `e` sets leaves both dates null. Followed through same-file constants and
 * spreads in order: a spread of anything that is not such a constant, or a date given any value
 * but `null`, pins the dates.
 */
function leavesDatesUnset(sf: ts.SourceFile, e: ts.Expression, depth = 0): boolean {
  if (depth > 4) return false;
  let obj: ts.ObjectLiteralExpression | null = null;
  if (ts.isIdentifier(e)) obj = constObject(sf, e.text);
  else if (ts.isObjectLiteralExpression(e)) obj = e;
  if (!obj) return false;
  const unset = new Set<string>();
  for (const p of obj.properties) {
    if (ts.isSpreadAssignment(p)) {
      if (leavesDatesUnset(sf, p.expression, depth + 1)) DATE_KEYS.forEach((k) => unset.add(k));
      else DATE_KEYS.forEach((k) => unset.delete(k));
    } else if (p.name && DATE_KEYS.includes(p.name.getText(sf))) {
      const k = p.name.getText(sf);
      if (ts.isPropertyAssignment(p) && p.initializer.kind === ts.SyntaxKind.NullKeyword) unset.add(k);
      else unset.delete(k);
    }
  }
  return DATE_KEYS.every((k) => unset.has(k));
}

/** The nearest enclosing function of `n`. */
function enclosingFunction(n: ts.Node): ts.FunctionLikeDeclaration | null {
  for (let p = n.parent; p; p = p.parent) {
    if (ts.isFunctionDeclaration(p) || ts.isArrowFunction(p) || ts.isFunctionExpression(p) || ts.isMethodDeclaration(p)) return p;
  }
  return null;
}

const inEventAttribute = (n: ts.Node) => {
  for (let p = n.parent; p; p = p.parent) {
    if (ts.isJsxAttribute(p)) return /^on[A-Z]/.test(p.name.getText());
  }
  return false;
};

const inEffect = (n: ts.Node) => {
  for (let p = n.parent; p; p = p.parent) {
    if (ts.isCallExpression(p) && ts.isIdentifier(p.expression) && /^use(Layout)?Effect$|^useMemo$|^useSyncExternalStore$/.test(p.expression.text)) return true;
  }
  return false;
};

/** Problems with how the gift list reaches the two new routes. Empty means the rules hold. */
function listProblems(sf: ts.SourceFile): string[] {
  const out: string[] = [];
  const fetches: { url: string; call: ts.CallExpression }[] = [];
  walk(sf, (n) => {
    if (isCallTo(n, 'fetch')) {
      const call = n as ts.CallExpression;
      fetches.push({ url: urlText(call.arguments[0]) ?? '(not a literal)', call });
    }
  });
  const candidates = fetches.filter((f) => f.url.endsWith('/candidates'));
  const attaches = fetches.filter((f) => f.url.endsWith('/attach'));
  if (candidates.length === 0) out.push('no fetch of a literal path ending /candidates');
  if (attaches.length === 0) out.push('no fetch of a literal path ending /attach');
  for (const f of fetches) if (f.url === '(not a literal)') out.push('a fetch whose path is not a literal');

  for (const { call } of attaches) {
    const init = call.arguments[1];
    const body = init && ts.isObjectLiteralExpression(init)
      ? init.properties.find((p) => p.name?.getText(sf) === 'body') : undefined;
    const value = body && ts.isPropertyAssignment(body) ? body.initializer : undefined;
    const sent = value && ts.isCallExpression(value) && value.expression.getText(sf) === 'JSON.stringify' ? value.arguments[0] : undefined;
    if (!sent || !ts.isObjectLiteralExpression(sent)) { out.push('the attach body is not JSON.stringify of an object literal'); continue; }
    const keys = sent.properties.map((p) => (ts.isSpreadAssignment(p) ? '...' : p.name?.getText(sf) ?? '?'));
    if (keys.length !== 1 || keys[0] !== 'transactionId') out.push(`the attach body sends ${keys.join(',')}`);
  }

  for (const { call } of candidates) {
    if (inEffect(call)) { out.push('candidates fetched inside an effect'); continue; }
    const fn = enclosingFunction(call);
    if (!fn) { out.push('candidates fetched at module scope'); continue; }
    if (inEventAttribute(fn)) continue; // an inline handler
    // A named handler: every reference to it is inside an event attribute, and it is not the
    // component itself (a fetch in the component body runs on every render).
    const name = ts.isFunctionDeclaration(fn) && fn.name ? fn.name.text
      : ts.isVariableDeclaration(fn.parent) && ts.isIdentifier(fn.parent.name) ? fn.parent.name.text : null;
    if (name === null) { out.push('candidates fetched in an anonymous function outside a handler'); continue; }
    if (enclosingFunction(fn) === null) { out.push('candidates fetched in the component body'); continue; }
    const refs: ts.Identifier[] = [];
    walk(sf, (n) => {
      if (ts.isIdentifier(n) && n.text === name && n !== (fn as ts.FunctionDeclaration).name
          && !(ts.isVariableDeclaration(n.parent) && n.parent.name === n)) refs.push(n);
    });
    if (refs.length === 0) out.push(`${name} is never called`);
    for (const r of refs) if (!inEventAttribute(r) || inEffect(r)) out.push(`${name} is called outside an event handler`);
  }
  return out;
}

const CLEAN_FORM = `
'use client';
import { useState, useSyncExternalStore } from 'react';
import { localIsoDate } from '@/lib/localDate';
import { giftFormDefaults } from '@/lib/domain/giftMatch';
export default function F() {
  const today = useSyncExternalStore(() => () => {}, () => localIsoDate(), () => null);
  const BLANK = { amount: '', windowStart: null, windowEnd: null };
  const [form, setForm] = useState(BLANK);
  const defaults = today === null ? null : giftFormDefaults(today);
  async function submit() {
    const res = await fetch('/api/v1/gifts', { method: 'POST', body: JSON.stringify(form) });
    setForm(BLANK);
  }
  return <form onSubmit={submit}>{today}</form>;
}`;

const CLEAN_LIST = `
'use client';
export default function L({ gifts }) {
  async function find(id) { const r = await fetch(\`/api/v1/gifts/\${id}/candidates\`); }
  async function attach(id, transactionId) {
    await fetch(\`/api/v1/gifts/\${id}/attach\`, { method: 'POST', body: JSON.stringify({ transactionId }) });
  }
  return <div>{gifts.map((g) => <button onClick={() => find(g.id)}><span onClick={() => attach(g.id, 1)} /></button>)}</div>;
}`;

describe('the components are wired as the spec says (U8, U9)', () => {
  it('T41c-U8: the form takes today only from localIsoDate, re-read on every render, and its reset leaves the dates following it; the list fetches candidates only on a click and attaches with transactionId alone', () => {
    const form = parseText('GiftForm.tsx', readFileSync(join(WEB, 'components/GiftForm.tsx'), 'utf8'));
    const list = parseText('GiftList.tsx', readFileSync(join(WEB, 'components/GiftList.tsx'), 'utf8'));
    expect(formProblems(form)).toEqual([]);
    expect(listProblems(list)).toEqual([]);

    // The checkers against clean fabricated sources …
    expect(formProblems(parseText('f.tsx', CLEAN_FORM))).toEqual([]);
    expect(listProblems(parseText('l.tsx', CLEAN_LIST))).toEqual([]);
    // … and against sources that break each rule.
    const formViolators: [string, string][] = [
      [CLEAN_FORM.replace('() => localIsoDate()', '() => new Date().toISOString().slice(0, 10)'), 'toISOString'],
      [CLEAN_FORM.replace('() => localIsoDate()', '() => localIsoDate(new Date(Date.now() - new Date().getTimezoneOffset()))'), 'getTimezoneOffset'],
      [CLEAN_FORM.replace("import { localIsoDate } from '@/lib/localDate';", "import { localIsoDate } from '@/lib/elsewhere';"), 'localIsoDate is not imported from @/lib/localDate'],
      // The reset pinned to the first render's date (M18), to a fresh date at the moment of the save
      // (the G3 cycle 1 N1 defect), or to a typed-over date: each stops the fields following today.
      [CLEAN_FORM.replace('setForm(BLANK);', 'setForm({ ...BLANK, ...defaults });'), 'a reset pins the dates instead of leaving them to follow today'],
      [CLEAN_FORM.replace('setForm(BLANK);', 'setForm({ ...BLANK, ...giftFormDefaults(today) });'), 'a reset pins the dates instead of leaving them to follow today'],
      [CLEAN_FORM.replace('setForm(BLANK);', 'setForm({ ...BLANK, ...giftFormDefaults(localIsoDate()) });'), 'a reset pins the dates instead of leaving them to follow today'],
      [CLEAN_FORM.replace('setForm(BLANK);', 'setForm({ ...BLANK, windowEnd: form.windowEnd });'), 'a reset pins the dates instead of leaving them to follow today'],
      [CLEAN_FORM.replace('setForm(BLANK);', ''), 'the submit handler never resets the form'],
      [CLEAN_FORM.replace('const today = useSyncExternalStore(() => () => {}, () => localIsoDate(), () => null);', 'const today = localIsoDate();'), 'the default is not re-read from localIsoDate on every render'],
      [CLEAN_FORM.replace('() => localIsoDate()', 'localIsoDate'), 'localIsoDate used without a call'],
    ];
    for (const [src, problem] of formViolators) {
      expect({ problem, found: formProblems(parseText('f.tsx', src)).includes(problem) }).toEqual({ problem, found: true });
    }
    const listViolators: [string, string][] = [
      [CLEAN_LIST.replace('JSON.stringify({ transactionId })', 'JSON.stringify({ transactionId, giftId: id })'), 'the attach body sends transactionId,giftId'],
      [CLEAN_LIST.replace('JSON.stringify({ transactionId })', 'JSON.stringify({ ...candidate })'), 'the attach body sends ...'],
      [CLEAN_LIST.replace("return <div>", "useEffect(() => { for (const g of gifts) find(g.id); }, []);\n  return <div>"), 'find is called outside an event handler'],
      [CLEAN_LIST.replace("return <div>", "useEffect(() => { fetch(`/api/v1/gifts/${gifts[0].id}/candidates`); }, []);\n  return <div>"), 'candidates fetched inside an effect'],
      [CLEAN_LIST.replace("return <div>", "fetch(`/api/v1/gifts/${gifts[0].id}/candidates`);\n  return <div>"), 'candidates fetched in the component body'],
      [CLEAN_LIST.replace('/attach', '/link'), 'no fetch of a literal path ending /attach'],
    ];
    for (const [src, problem] of listViolators) {
      expect({ problem, found: listProblems(parseText('l.tsx', src)).includes(problem) }).toEqual({ problem, found: true });
    }
  });

  it('T41c-U9: the registry lists the candidates route as text-bearing under X1 and the attach route as guarded-write under C1; the writer list is unchanged', () => {
    const find = (file: string) => ROUTES.filter((r) => r.file === file);
    expect(find('app/api/v1/gifts/[id]/candidates/route.ts')).toEqual([
      { file: 'app/api/v1/gifts/[id]/candidates/route.ts', classes: ['text-bearing'], scenario: 'X1' },
    ]);
    expect(find('app/api/v1/gifts/[id]/attach/route.ts')).toEqual([
      { file: 'app/api/v1/gifts/[id]/attach/route.ts', classes: ['guarded-write'], scenario: 'C1' },
    ]);
    for (const r of ROUTES.filter((x) => x.file.includes('/gifts/'))) expect(r.scenario ?? '').toMatch(/^[A-Z]\d+$/);
    // The attach route writes through the gift store, the writer already registered; no new writer.
    expect(GUARDED_WRITERS.map((w) => w.file)).toEqual([
      'app/api/v1/transactions/[id]/route.ts',
      'app/api/v1/transactions/bulk/route.ts',
      'app/api/v1/transfers/route.ts',
      'lib/cashTransferStore.ts',
      'app/api/v1/rules/route.ts',
      'app/api/v1/rules/apply/route.ts',
      'lib/proposalStore.ts',
      'lib/giftStore.ts',
    ]);
  });
});
