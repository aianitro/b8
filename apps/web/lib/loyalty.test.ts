// P8-42a — the pure loyalty rules (U1–U5) and how the page and routes are wired (U8, U9).
//
// U1–U5 drive `lib/domain/loyalty.ts` and the shared reducer in `lib/domain/observations.ts` over
// fabricated values. U4, U8 and U9 are properties of the SOURCE — which file picks a current reading,
// which route checks the caller, where the full member number is fetched — so they are asserted over
// the AST with the TypeScript compiler API, as `giftSurfaceWiring.test.ts` does. Every checker is also
// run against a fabricated violating source and a clean one, so a checker that matches nothing
// cannot pass the real tree by accident.
//
// Every member number, name and description below is fabricated and carries `ZQ42A`. No figure here
// is anyone's balance.

import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';
import { describe, expect, it } from 'vitest';
import { LOYALTY_MASK_BULLETS, type LoyaltyInstrument } from '@b8/contracts/loyalty';
import {
  currentObservation,
  currentObservationByMembership,
  formatBalance,
  maskMemberNumber,
  parseBalance,
  sortInstruments,
  UNITS,
} from './domain/loyalty';
import { latestRowByKey, latestValueByKey } from './domain/observations';
import { PAGES, ROUTES } from './giftSurfaceRegistry';

const WEB = fileURLToPath(new URL('..', import.meta.url));
const rel = (f: string) => relative(WEB, f).split('\\').join('/');
const read = (f: string) => readFileSync(join(WEB, f), 'utf8');

function parseText(file: string, text: string): ts.SourceFile {
  return ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true, file.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
}
function walk(node: ts.Node, visit: (n: ts.Node) => void): void {
  visit(node);
  ts.forEachChild(node, (c) => walk(c, visit));
}
const filesUnder = (dir: string) =>
  existsSync(join(WEB, dir))
    ? (readdirSync(join(WEB, dir), { recursive: true }) as string[]).filter((f) => /\.tsx?$/.test(f)).map((f) => rel(join(WEB, dir, f)))
    : [];

/** Every non-test loyalty source file: the domain, the store, the routes, the page, its components, the script. */
const LOYALTY_SOURCES = [
  'lib/domain/loyalty.ts',
  'lib/domain/loyaltyImport.ts',
  'lib/loyaltyStore.ts',
  'scripts/import-loyalty.ts',
  ...filesUnder('app/api/v1/loyalty'),
  ...filesUnder('app/travel'),
  ...filesUnder('components').filter((f) => /^components\/(Loyalty|Travel)/.test(f)),
].filter((f) => !/\.test\.tsx?$/.test(f));

const COMPONENT_FILES = LOYALTY_SOURCES.filter((f) => f.startsWith('components/') || f.startsWith('app/travel/'));

// ─── U1 ─────────────────────────────────────────────────────────────────────────────────────────

describe('the member-number mask', () => {
  it('T42a-U1: four bullets and at most the last four characters, by length; null stays null; nothing else leaks', () => {
    expect(maskMemberNumber(null)).toBeNull();
    expect(maskMemberNumber(undefined)).toBeNull();
    expect(maskMemberNumber('')).toBeNull();
    expect(maskMemberNumber('   ')).toBeNull();
    const cases: [string, string][] = [
      ['Z', LOYALTY_MASK_BULLETS],
      ['ZQ', LOYALTY_MASK_BULLETS],
      ['ZQ4', LOYALTY_MASK_BULLETS],
      ['ZQ42', LOYALTY_MASK_BULLETS],
      ['ZQ42A', LOYALTY_MASK_BULLETS],
      ['ZQ42A1', `${LOYALTY_MASK_BULLETS}2A1`],
      ['ZQ42A12', `${LOYALTY_MASK_BULLETS}A12`],
      ['ZQ42A123', `${LOYALTY_MASK_BULLETS}A123`],
      ['ZQ42A1234567', `${LOYALTY_MASK_BULLETS}4567`],
      ['  ZQ42A1234567  ', `${LOYALTY_MASK_BULLETS}4567`],
    ];
    for (const [input, expected] of cases) {
      const out = maskMemberNumber(input) as string;
      expect(out).toBe(expected);
      expect(out).not.toBe(input);
      expect(out.startsWith(LOYALTY_MASK_BULLETS)).toBe(true);
      // Never more than four characters of the number after the four bullets.
      expect(Array.from(out).length - 4).toBeLessThanOrEqual(4);
    }
    // Non-ASCII is counted in characters: the last four of a 12-character mixed number.
    expect(maskMemberNumber('ZQ42AÉ漢字9876')).toBe(`${LOYALTY_MASK_BULLETS}9876`);
    expect(maskMemberNumber('ZQ42AÉÉÉ漢字')).toBe(`${LOYALTY_MASK_BULLETS}ÉÉ漢字`);
    // The mask depends only on the suffix: the same last four mask identically, different ones differ.
    expect(maskMemberNumber('ZQ42AXXX1234')).toBe(maskMemberNumber('ZQ42AYYY1234'));
    expect(maskMemberNumber('ZQ42AXXX1234')).not.toBe(maskMemberNumber('ZQ42AXXX1235'));
  });
});

// ─── U2 ─────────────────────────────────────────────────────────────────────────────────────────

describe('the API balance rule', () => {
  it('T42a-U2: whole units take digits only, usd takes up to two decimals and is emitted with exactly two, nothing rounds', () => {
    expect(parseBalance('points', '0')).toEqual({ ok: true, unit: 'points', balance: '0' });
    expect(parseBalance('points', '1500')).toEqual({ ok: true, unit: 'points', balance: '1500' });
    expect(parseBalance('miles', '000123')).toEqual({ ok: true, unit: 'miles', balance: '123' });
    for (const bad of ['1500.5', '1500.0', '1,500', '-1', ' 12', '12 ', '', '1e3', '0x10', '1500.', '1234567890123', '+5', '.5', 'NaN']) {
      expect(parseBalance('points', bad), bad).toEqual({ ok: false });
      expect(parseBalance('nights', bad), bad).toEqual({ ok: false });
    }
    expect(parseBalance('points', '123456789012')).toEqual({ ok: true, unit: 'points', balance: '123456789012' });
    expect(parseBalance('usd', '25')).toEqual({ ok: true, unit: 'usd', balance: '25.00' });
    expect(parseBalance('usd', '25.5')).toEqual({ ok: true, unit: 'usd', balance: '25.50' });
    expect(parseBalance('usd', '25.50')).toEqual({ ok: true, unit: 'usd', balance: '25.50' });
    expect(parseBalance('usd', '0')).toEqual({ ok: true, unit: 'usd', balance: '0.00' });
    for (const bad of ['25.005', '-0.01', '.5', '25.', '1,250.00', '2,031.50', '$25', ' 25', '1e2']) {
      expect(parseBalance('usd', bad), bad).toEqual({ ok: false });
    }
    // The float traps: each cent part comes back as the very same text, not via a binary double.
    for (const cents of ['0.10', '0.20', '0.30', '1.15', '4.35', '1234567.89']) {
      expect(parseBalance('usd', cents)).toEqual({ ok: true, unit: 'usd', balance: cents });
    }
    // A JSON number never passes: the rule is for text.
    expect(parseBalance('points', 1500)).toEqual({ ok: false });
    // An unknown unit refuses every input.
    for (const text of ['0', '1500', '25.50']) {
      expect(parseBalance('yen', text)).toEqual({ ok: false });
      expect(parseBalance('Points', text)).toEqual({ ok: false });
    }
    expect([...UNITS].sort()).toEqual(['miles', 'nights', 'points', 'usd']);
    // Display: grouped as text, the dash for no reading, zero as a reading.
    expect(formatBalance(null, null)).toBe('—');
    expect(formatBalance('0', 'points')).toBe('0 points');
    expect(formatBalance('16488', 'miles')).toBe('16,488 miles');
    expect(formatBalance('2031.50', 'usd')).toBe('$2,031.50');
    expect(formatBalance('0.30', 'usd')).toBe('$0.30');
  });
});

// ─── U3 ─────────────────────────────────────────────────────────────────────────────────────────

type Obs = { id: number; asOf: string; recordedAt: string; balance: string; unit: string; membershipId: number };
const obs = (id: number, asOf: string, recordedAt: string, balance: string, membershipId = 1): Obs =>
  ({ id, asOf, recordedAt, balance, unit: 'points', membershipId });

function permutations<T>(xs: T[]): T[][] {
  if (xs.length <= 1) return [xs];
  return xs.flatMap((x, i) => permutations([...xs.slice(0, i), ...xs.slice(i + 1)]).map((p) => [x, ...p]));
}

describe('the current balance', () => {
  it('T42a-U3: newest by as-of, then recorded time, then id; never by arrival; order-independent; zero is a reading', () => {
    // An older as-of recorded later, with a higher id, does not win.
    const newer = obs(1, '2026-03-01', '2026-03-01T10:00:00.000000', '500');
    const olderArrivingLater = obs(9, '2026-01-15', '2026-04-01T10:00:00.000000', '900');
    expect(currentObservation([newer, olderArrivingLater])).toBe(newer);
    expect(currentObservation([olderArrivingLater, newer])).toBe(newer);
    // Same as-of: the later recorded time wins.
    const early = obs(5, '2026-03-01', '2026-03-01T08:00:00.000000', '100');
    const late = obs(4, '2026-03-01', '2026-03-01T09:00:00.000000', '200');
    expect(currentObservation([late, early])).toBe(late);
    expect(currentObservation([early, late])).toBe(late);
    // Same as-of and recorded time: the higher id wins.
    const lowId = obs(6, '2026-03-01', '2026-03-01T08:00:00.000000', '300');
    const highId = obs(7, '2026-03-01', '2026-03-01T08:00:00.000000', '400');
    expect(currentObservation([highId, lowId])).toBe(highId);
    expect(currentObservation([lowId, highId])).toBe(highId);
    // All 120 orderings of five rows give the same row.
    const five = [
      obs(10, '2026-02-01', '2026-02-01T00:00:00.000000', '1'),
      obs(11, '2026-02-03', '2026-02-02T00:00:00.000000', '2'),
      obs(12, '2026-02-03', '2026-02-02T00:00:00.000000', '3'),
      obs(13, '2026-02-03', '2026-02-01T00:00:00.000000', '4'),
      obs(14, '2026-01-31', '2026-05-01T00:00:00.000000', '5'),
    ];
    const perms = permutations(five);
    expect(perms).toHaveLength(120);
    for (const p of perms) expect(currentObservation(p)?.id).toBe(12);
    // No rows: null, never a made-up zero.
    expect(currentObservation([])).toBeNull();
    // A zero reading is a reading.
    const zero = obs(20, '2026-01-01', '2026-01-01T00:00:00.000000', '0');
    expect(currentObservation([zero])).toBe(zero);
    // Cash text comes back byte-identical.
    const cash = { ...obs(21, '2026-01-01', '2026-01-01T00:00:00.000000', '0.30'), unit: 'usd' };
    expect(currentObservation([cash])?.balance).toBe('0.30');
    // A later calendar year beats every earlier one, whatever the month.
    const years = [obs(30, '2025-12-31', '2026-06-01T00:00:00.000000', '1'), obs(31, '2026-01-01', '2026-01-01T00:00:00.000000', '2')];
    expect(currentObservation(years)?.id).toBe(31);
    // Per membership, each reduced on its own.
    const byMembership = currentObservationByMembership([newer, olderArrivingLater, { ...zero, membershipId: 2 }]);
    expect(byMembership.get(1)).toBe(newer);
    expect(byMembership.get(2)?.balance).toBe('0');
    expect(byMembership.has(3)).toBe(false);
  });
});

// ─── U4 ─────────────────────────────────────────────────────────────────────────────────────────

/**
 * A second "pick the newest" in a loyalty source: a sort whose first or last element is taken, a
 * comparison of an as-of value, or SQL that orders or de-duplicates by as_of to pick a row.
 */
function secondReducerProblems(file: string, text: string): string[] {
  const out: string[] = [];
  const sf = parseText(file, text);
  walk(sf, (n) => {
    // x.sort(...)[0] / x.sort(...).at(-1) / [...x].sort(...)[0]
    if (ts.isElementAccessExpression(n) && ts.isCallExpression(n.expression)
        && ts.isPropertyAccessExpression(n.expression.expression) && n.expression.expression.name.text === 'sort') {
      out.push(`${file}: sort()[i]`);
    }
    if (ts.isCallExpression(n) && ts.isPropertyAccessExpression(n.expression) && n.expression.name.text === 'at'
        && ts.isCallExpression(n.expression.expression) && ts.isPropertyAccessExpression(n.expression.expression.expression)
        && n.expression.expression.expression.name.text === 'sort') {
      out.push(`${file}: sort().at()`);
    }
    // A comparison whose operand is an as-of value.
    if (ts.isBinaryExpression(n) && [ts.SyntaxKind.LessThanToken, ts.SyntaxKind.GreaterThanToken,
      ts.SyntaxKind.LessThanEqualsToken, ts.SyntaxKind.GreaterThanEqualsToken].includes(n.operatorToken.kind)) {
      const side = (e: ts.Expression) => /\b(asOf|as_of)\b/.test(e.getText(sf));
      if (side(n.left) || side(n.right)) out.push(`${file}: compares as-of`);
    }
    // SQL that picks the newest row itself.
    if (ts.isStringLiteral(n) || ts.isNoSubstitutionTemplateLiteral(n) || ts.isTemplateHead(n) || ts.isTemplateMiddle(n) || ts.isTemplateTail(n)) {
      if (/ORDER\s+BY[^;]*\bas_of\b|DISTINCT\s+ON|\bmax\s*\(\s*as_of/i.test(n.text)) out.push(`${file}: SQL picks newest`);
    }
  });
  return out;
}

describe('one reducer', () => {
  it('T42a-U4: the whole-row reducer agrees with latestValueByKey, and no loyalty source picks a current reading itself', () => {
    // 48 (rows, key) cases with distinct timestamps per key: the winning row's value equals
    // latestValueByKey's value for the same key.
    let cases = 0;
    for (let seed = 1; seed <= 12; seed++) {
      const rows: { k: string; value: number; valuedAt: string }[] = [];
      for (let i = 0; i < 4 * 6; i++) {
        const k = `k${i % 4}`;
        // Distinct per key: day and hour both derived from i, so no two rows of one key tie.
        const day = String(((i * 7 + seed * 3) % 27) + 1).padStart(2, '0');
        const hour = String(i % 24).padStart(2, '0');
        rows.push({ k, value: (i * 31 + seed) % 97, valuedAt: `2026-01-${day}T${hour}:${String(i).padStart(2, '0')}:00Z` });
      }
      const byValue = latestValueByKey(rows, (r) => r.k);
      const byRow = latestRowByKey(rows, (r) => r.k, (a, b) => Date.parse(a.valuedAt) - Date.parse(b.valuedAt));
      for (const [k, value] of byValue) {
        expect(byRow.get(k)?.value).toBe(value);
        cases++;
      }
    }
    expect(cases).toBeGreaterThanOrEqual(40);

    // The checker on fabricated sources.
    expect(secondReducerProblems('x.ts', 'const c = rows.sort(cmp)[0];')).toHaveLength(1);
    expect(secondReducerProblems('x.ts', 'const c = [...rows].sort(cmp).at(-1);')).toHaveLength(1);
    expect(secondReducerProblems('x.ts', 'const c = rows.filter((r) => r.asOf > best.asOf);')).toHaveLength(1);
    expect(secondReducerProblems('x.ts', 'const q = `SELECT DISTINCT ON (membership_id) * FROM loyalty_observations ORDER BY membership_id, as_of DESC`;')).not.toHaveLength(0);
    expect(secondReducerProblems('x.ts', 'const c = currentObservation(rows); const s = sortInstruments(list);')).toEqual([]);

    // The real tree: no second reducer, and the store gets "current" from the shared export.
    expect(LOYALTY_SOURCES.length).toBeGreaterThan(15);
    expect(LOYALTY_SOURCES.flatMap((f) => secondReducerProblems(f, read(f)))).toEqual([]);
    const store = read('lib/loyaltyStore.ts');
    expect(store).toMatch(/import \{[^}]*currentObservationByMembership[^}]*\} from '\.\/domain\/loyalty'/);
    expect(read('lib/domain/loyalty.ts')).toMatch(/import \{[^}]*latestRowByKey[^}]*\} from '\.\/observations'/);
  });
});

// ─── U5 ─────────────────────────────────────────────────────────────────────────────────────────

const inst = (id: number, expiresOn: string | null, usedOn: string | null = null): LoyaltyInstrument => ({
  id, membershipId: 1, kind: 'other', description: `ZQ42A instrument ${id}`, issuedOn: null, expiresOn, usedOn, source: 'typed',
});

describe('instrument order', () => {
  it('T42a-U5: unused before used, expiry ascending with unknown last, then id; input order irrelevant', () => {
    const rows = [
      inst(1, null),
      inst(2, '2026-12-01'),
      inst(3, '2026-06-01', '2026-05-01'),
      inst(4, '2026-02-01'),
      inst(5, '2026-02-01'),
      inst(6, null, '2026-01-01'),
    ];
    const want = [4, 5, 2, 1, 3, 6];
    for (const p of permutations(rows)) expect(sortInstruments(p).map((r) => r.id)).toEqual(want);
    expect(sortInstruments([])).toEqual([]);
    const input = [inst(2, null), inst(1, '2026-01-01')];
    sortInstruments(input);
    expect(input.map((r) => r.id)).toEqual([2, 1]);
  });
});

// ─── U8 ─────────────────────────────────────────────────────────────────────────────────────────

const LOYALTY_ROUTE_FILES = [
  'app/api/v1/loyalty/route.ts',
  'app/api/v1/loyalty/members/route.ts',
  'app/api/v1/loyalty/members/[id]/route.ts',
  'app/api/v1/loyalty/programs/route.ts',
  'app/api/v1/loyalty/programs/[id]/route.ts',
  'app/api/v1/loyalty/memberships/route.ts',
  'app/api/v1/loyalty/memberships/[id]/route.ts',
  'app/api/v1/loyalty/memberships/[id]/member-number/route.ts',
  'app/api/v1/loyalty/memberships/[id]/observations/route.ts',
  'app/api/v1/loyalty/instruments/route.ts',
  'app/api/v1/loyalty/instruments/[id]/route.ts',
];

/** The `href`s of the sidebar's NAV array, in order, and whether /travel carries its label. */
function sidebarProblems(text: string): string[] {
  const sf = parseText('Sidebar.tsx', text);
  let hrefs: { href: string; label: string }[] | null = null;
  walk(sf, (n) => {
    if (ts.isVariableDeclaration(n) && n.name.getText(sf) === 'NAV' && n.initializer && ts.isArrayLiteralExpression(n.initializer)) {
      hrefs = n.initializer.elements.filter(ts.isObjectLiteralExpression).map((o) => {
        const prop = (name: string) => {
          const p = o.properties.find((x) => ts.isPropertyAssignment(x) && x.name.getText(sf) === name) as ts.PropertyAssignment | undefined;
          return p && ts.isStringLiteral(p.initializer) ? p.initializer.text : '';
        };
        return { href: prop('href'), label: prop('label') };
      });
    }
  });
  const list = (hrefs ?? []) as { href: string; label: string }[];
  const i = list.findIndex((h) => h.href === '/travel');
  const out: string[] = [];
  if (i < 0) return ['no /travel entry'];
  if (list[i].label !== 'Nights & Miles') out.push('wrong label');
  if (list[i - 1]?.href !== '/properties') out.push('not after /properties');
  if (list[i + 1]?.href !== '/gifts') out.push('not before /gifts');
  return out;
}

/** Problems with a loyalty route's caller check. `helperAuthorizes`: the shared helper calls authorize. */
function routeAuthProblems(file: string, text: string, helperAuthorizes: boolean): string[] {
  const sf = parseText(file, text);
  const out: string[] = [];
  const imported = new Set<string>();
  walk(sf, (n) => {
    if (ts.isImportDeclaration(n) && ts.isStringLiteral(n.moduleSpecifier)) {
      const from = n.moduleSpecifier.text;
      const names = n.importClause?.namedBindings && ts.isNamedImports(n.importClause.namedBindings)
        ? n.importClause.namedBindings.elements.map((e) => e.name.text) : [];
      if ((from.endsWith('loyaltyResponses') && helperAuthorizes) || from === '@/lib/requestAuth') names.forEach((x) => imported.add(x));
    }
  });
  const resolvers = ['callerOf', 'authorize', 'credentialFrom'].filter((x) => imported.has(x));
  let handlers = 0;
  walk(sf, (n) => {
    if (ts.isFunctionDeclaration(n) && n.name && /^(GET|POST|PATCH|PUT|DELETE)$/.test(n.name.text)
        && n.modifiers?.some((m) => m.kind === ts.SyntaxKind.ExportKeyword)) {
      handlers++;
      const first = n.body?.statements[0];
      const firstText = first?.getText(sf) ?? '';
      if (!resolvers.some((r) => new RegExp(`await ${r}\\(`).test(firstText))) out.push(`${file} ${n.name.text}: caller not resolved first`);
    }
  });
  if (handlers === 0) out.push(`${file}: no handler`);
  return out;
}

/** S6 must compare the session kind to 'browser'. */
const comparesBrowserKind = (text: string) => {
  const sf = parseText('x.ts', text);
  let found = false;
  walk(sf, (n) => {
    if (ts.isBinaryExpression(n) && [ts.SyntaxKind.EqualsEqualsEqualsToken, ts.SyntaxKind.ExclamationEqualsEqualsToken].includes(n.operatorToken.kind)
        && /\.kind$/.test(n.left.getText(sf)) && ts.isStringLiteral(n.right) && n.right.text === 'browser') found = true;
  });
  return found;
};

describe('wiring', () => {
  it('T42a-U8: sidebar order and label, the registry and the surface script list every loyalty surface, every route resolves its caller first, S6 checks for a browser session', () => {
    // Sidebar, and its checker on fabricated sources.
    expect(sidebarProblems(read('components/Sidebar.tsx'))).toEqual([]);
    const nav = (entries: string) => `const NAV = [${entries}];`;
    const e = (href: string, label: string) => `{ href: '${href}', label: '${label}' },`;
    expect(sidebarProblems(nav(e('/properties', 'Properties') + e('/travel', 'Nights & Miles') + e('/gifts', 'Gifts')))).toEqual([]);
    expect(sidebarProblems(nav(e('/properties', 'Properties') + e('/gifts', 'Gifts') + e('/travel', 'Nights & Miles')))).not.toEqual([]);
    expect(sidebarProblems(nav(e('/properties', 'Properties') + e('/travel', 'Travel') + e('/gifts', 'Gifts')))).toEqual(['wrong label']);
    expect(sidebarProblems(nav(e('/properties', 'Properties') + e('/gifts', 'Gifts')))).toEqual(['no /travel entry']);

    // Registry: exactly the eleven route files, each no-transaction-data, and no other loyalty file.
    const listed = ROUTES.filter((r) => r.file.startsWith('app/api/v1/loyalty/'));
    expect(listed.map((r) => r.file).sort()).toEqual([...LOYALTY_ROUTE_FILES].sort());
    for (const r of listed) expect(r.classes).toEqual(['no-transaction-data']);
    const onDisk = filesUnder('app/api/v1/loyalty').filter((f) => f.endsWith('/route.ts')).sort();
    expect(onDisk).toEqual([...LOYALTY_ROUTE_FILES].sort());
    expect(PAGES.find((p) => p.file === 'app/travel/page.tsx')?.classes).toEqual(['no-transaction-data']);
    const surface = read('scripts/gifts-surface-check.mjs');
    expect(surface).toContain(`'app/travel/page.tsx': { cls: 'no-transaction-data', url: () => '/travel' }`);
    expect(surface).toMatch(/current = 'H11';/);
    expect(surface).toContain(`console.log('OK H1-H11');`);

    // Every route resolves its caller first, through the helper that calls the boundary's authorize.
    const helper = read('app/api/v1/loyalty/loyaltyResponses.ts');
    const helperAuthorizes = /import \{ authorize \} from '@\/lib\/requestAuth'/.test(helper) && /await authorize\(req\)/.test(helper);
    expect(helperAuthorizes).toBe(true);
    for (const f of LOYALTY_ROUTE_FILES) expect(routeAuthProblems(f, read(f), helperAuthorizes)).toEqual([]);
    expect(comparesBrowserKind(read('app/api/v1/loyalty/memberships/[id]/member-number/route.ts'))).toBe(true);

    // The checkers on fabricated sources.
    const good = `import { callerOf } from '../loyaltyResponses';\nexport async function POST(req) { const c = await callerOf(req); return c; }`;
    const late = `import { callerOf } from '../loyaltyResponses';\nexport async function POST(req) { const b = await req.json(); const c = await callerOf(req); return c; }`;
    const none = `export async function PATCH(req) { return Response.json({}); }`;
    const direct = `import { authorize } from '@/lib/requestAuth';\nexport async function PATCH(req) { const d = await authorize(req); return d; }`;
    expect(routeAuthProblems('g.ts', good, true)).toEqual([]);
    expect(routeAuthProblems('d.ts', direct, false)).toEqual([]);
    expect(routeAuthProblems('l.ts', late, true)).toHaveLength(1);
    expect(routeAuthProblems('n.ts', none, true)).toHaveLength(1);
    expect(routeAuthProblems('g.ts', good, false)).toHaveLength(1);
    expect(comparesBrowserKind(`if (caller.kind !== 'browser') return x;`)).toBe(true);
    expect(comparesBrowserKind(`if (caller.scope !== 'full') return x;`)).toBe(false);
  });
});

// ─── U9 ─────────────────────────────────────────────────────────────────────────────────────────

const EFFECT_HOOKS = new Set(['useEffect', 'useLayoutEffect', 'useMemo', 'useInsertionEffect', 'useState']);

/**
 * Where a literal path ending `suffix` is used: every occurrence must sit in a function that is an
 * event handler — named in a JSX `on…={name}` attribute, or written inline as one — and never at a
 * component's top level, in an effect, or in a file without 'use client'.
 */
function fetchPlacementProblems(file: string, text: string, suffix: string): string[] {
  const sf = parseText(file, text);
  const out: string[] = [];
  const handlerNames = new Set<string>();
  const inlineHandlers = new Set<ts.Node>();
  walk(sf, (n) => {
    if (ts.isJsxAttribute(n) && /^on[A-Z]/.test(n.name.getText(sf)) && n.initializer && ts.isJsxExpression(n.initializer) && n.initializer.expression) {
      const e = n.initializer.expression;
      if (ts.isIdentifier(e)) handlerNames.add(e.text);
      else inlineHandlers.add(e);
    }
  });
  const isClient = /^['"]use client['"]/.test(text.trimStart());
  walk(sf, (n) => {
    const literal = ts.isStringLiteral(n) || ts.isNoSubstitutionTemplateLiteral(n) || ts.isTemplateExpression(n);
    if (!literal || !n.getText(sf).replace(/[`'"]$/, '').endsWith(suffix)) return;
    if (!isClient) { out.push(`${file}: path in a server file`); return; }
    let fn: ts.Node | undefined = n.parent;
    while (fn && !ts.isFunctionDeclaration(fn) && !ts.isArrowFunction(fn) && !ts.isFunctionExpression(fn)) fn = fn.parent;
    if (!fn) { out.push(`${file}: path at module level`); return; }
    const call = fn.parent;
    if (call && ts.isCallExpression(call) && EFFECT_HOOKS.has(call.expression.getText(sf))) { out.push(`${file}: path in ${call.expression.getText(sf)}`); return; }
    const name = ts.isFunctionDeclaration(fn) ? fn.name?.text
      : ts.isVariableDeclaration(fn.parent) ? fn.parent.name.getText(sf) : undefined;
    if (!(inlineHandlers.has(fn) || (name !== undefined && handlerNames.has(name)))) out.push(`${file}: path outside an event handler`);
  });
  return out;
}

describe('page client wiring', () => {
  it('T42a-U9: the full number is fetched on tap only and from one file; a balance edit is a POST of a typed reading; dates and figures stay text; null renders as a dash', () => {
    expect(COMPONENT_FILES.length).toBeGreaterThanOrEqual(8);
    // Exactly one component file names the full-number route, and only inside its click handler.
    const naming = COMPONENT_FILES.filter((f) => read(f).includes('/member-number'));
    expect(naming).toEqual(['components/LoyaltyCopyNumber.tsx']);
    expect(fetchPlacementProblems(naming[0], read(naming[0]), '/member-number')).toEqual([]);
    expect(read(naming[0])).toMatch(/onClick=\{copyNumber\}/);
    // The checker on fabricated sources.
    const client = (body: string) => `'use client';\nimport { useEffect } from 'react';\n${body}`;
    expect(fetchPlacementProblems('a.tsx', client('export default function A({ id }) { async function go() { await fetch(`/x/${id}/member-number`); } return <button onClick={go} />; }'), '/member-number')).toEqual([]);
    expect(fetchPlacementProblems('b.tsx', client('export default function B({ id }) { return <button onClick={() => fetch(`/x/${id}/member-number`)} />; }'), '/member-number')).toEqual([]);
    expect(fetchPlacementProblems('c.tsx', client('export default function C({ id }) { useEffect(() => { fetch(`/x/${id}/member-number`); }, [id]); return null; }'), '/member-number')).toHaveLength(1);
    expect(fetchPlacementProblems('d.tsx', client('export default function D({ id }) { const p = fetch(`/x/${id}/member-number`); return null; }'), '/member-number')).toHaveLength(1);
    expect(fetchPlacementProblems('e.tsx', 'export default async function E({ id }) { await fetch(`/x/${id}/member-number`); return null; }', '/member-number')).toHaveLength(1);

    // The page passes the overview from the store, whose memberships carry only the masked field.
    const page = read('app/travel/page.tsx');
    expect(page).not.toMatch(/memberNumber(?!Masked)|member_number/);
    expect(read('lib/loyaltyStore.ts')).toMatch(/memberNumberMasked: maskMemberNumber\(row\.member_number\)/);

    // A balance edit: a POST to the observations path, source typed only; no PATCH or PUT of a balance.
    const editor = read('components/LoyaltyBalanceEditor.tsx');
    expect(editor).toMatch(/send\('POST', `\/api\/v1\/loyalty\/memberships\/\$\{membershipId\}\/observations`/);
    expect(fetchPlacementProblems('components/LoyaltyBalanceEditor.tsx', editor, '/observations')).toEqual([]);
    const sources = [...editor.matchAll(/source:\s*'([a-z]+)'/g)].map((m) => m[1]);
    expect(sources).toEqual(['typed']);
    for (const f of COMPONENT_FILES) {
      expect(read(f), f).not.toMatch(/send\('(PATCH|PUT)', `[^`]*observations|method: '(PATCH|PUT)'[^}]*observations/);
    }

    // The as-of default from the device's calendar, through the shared helper.
    expect(editor).toMatch(/import \{ localIsoDate \} from '@\/lib\/localDate';/);
    expect(editor).toMatch(/useState\(\(\) => localIsoDate\(\)\)/);
    // No clock, no float, no rounding, in any loyalty source.
    for (const f of LOYALTY_SOURCES) {
      expect(read(f), f).not.toMatch(/toISOString|new Date\(|Date\.now\(|parseFloat|toFixed|Math\.round/);
    }

    // Null renders as a dash: the line's null branch, and the shared formatter's.
    const line = read('components/LoyaltyMembershipLine.tsx');
    expect(line).toMatch(/m\.balance === null\s*\?\s*<span[^>]*>—<\/span>/);
    expect(formatBalance(null, null)).toBe('—');
  });
});
