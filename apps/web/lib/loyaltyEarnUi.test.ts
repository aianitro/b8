// P8-42b2 — the earn wording and the earn-rate controls on /travel and /accounts/[id] (scenario U4).
//
// NO RENDERER EXISTS in this repo (no jsdom, no testing-library), so the pages are checked the way
// `loyaltyCardUi.test.ts` checks them: over the SOURCE, with the TypeScript compiler API where the
// question is structural (which element a handler hangs on, which component renders which) and by
// text where it is wording. What the pages actually render, with real figures from Postgres, is
// proved over real HTTP by step H13 of `scripts/gifts-surface-check.mjs`.
//
// Every checker is also run against fabricated violating sources and a clean one, so a checker that
// matches nothing cannot pass the real tree by accident. Fabricated names carry `ZQ42B2`, and no
// figure appears here: the wording is checked, never a number.

import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';
import { describe, expect, it } from 'vitest';

const WEB = fileURLToPath(new URL('..', import.meta.url));
const rel = (f: string) => relative(WEB, f).split('\\').join('/');
const read = (f: string) => readFileSync(join(WEB, f), 'utf8');
const ACCOUNT_PAGE = 'app/accounts/[id]/page.tsx';
const ACCOUNT_BLOCK = 'components/AccountEarnsInto.tsx';
const TRAVEL_CARD_LINE = 'components/LoyaltyCardLink.tsx';

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

type Src = { file: string; text: string };
const isTest = (f: string) => /\.test\.tsx?$/.test(f);

/** Every page-side source the wording and the controls may live in. */
const realSources = (): Src[] =>
  [...filesUnder('components'), ...filesUnder('app/travel'), ACCOUNT_PAGE].filter((f) => !isTest(f)).map((file) => ({ file, text: read(file) }));

/** The loyalty-scoped page files: they format through the shared helper and leave the ledger to the store. */
const isLoyaltyPageFile = (f: string) => /^components\/(Loyalty|Travel|AccountEarns)[A-Za-z]*\.tsx$/.test(f) || f.startsWith('app/travel/');

// ─── The checkers ───────────────────────────────────────────────────────────────────────────────

const PHRASES = [
  'estimated since', 'no reading yet, last 30 days', 'No earn rates set', 'No estimate for this unit', 'Estimate vs actual',
  'reported ', 'worth a look', 'no caps, tiers or rotating categories', 'Set earn rates', 'Clear earn rates',
];

/**
 * A source with its comments removed, by the compiler rather than a pattern, so a phrase that only
 * a comment mentions does not count as the page saying it.
 */
function code(s: Src): string {
  return ts.transpileModule(s.text, {
    fileName: s.file,
    compilerOptions: { removeComments: true, jsx: ts.JsxEmit.Preserve, target: ts.ScriptTarget.ESNext, module: ts.ModuleKind.ESNext },
  }).outputText;
}

/** Each fixed phrase missing from the code (not the comments) of every source. */
function missingPhrases(sources: Src[]): string[] {
  const texts = sources.map(code);
  return PHRASES.filter((p) => !texts.some((t) => t.includes(p)));
}

/** The default-import names `file` gives to each `./X` or `@/components/X` component, as `components/X.tsx`. */
function componentImports(s: Src): Map<string, string> {
  const sf = parseText(s.file, s.text);
  const out = new Map<string, string>();
  walk(sf, (n) => {
    if (!ts.isImportDeclaration(n) || !ts.isStringLiteral(n.moduleSpecifier) || !n.importClause?.name) return;
    const m = /^(?:\.\/|@\/components\/)([A-Za-z]+)$/.exec(n.moduleSpecifier.text);
    if (m) out.set(n.importClause.name.text, `components/${m[1]}.tsx`);
  });
  return out;
}

/** The component files `s` renders as JSX elements. */
function rendered(s: Src): string[] {
  const imports = componentImports(s);
  const sf = parseText(s.file, s.text);
  const out = new Set<string>();
  walk(sf, (n) => {
    if ((ts.isJsxOpeningElement(n) || ts.isJsxSelfClosingElement(n)) && imports.has(n.tagName.getText(sf))) out.add(imports.get(n.tagName.getText(sf)) as string);
  });
  return [...out];
}

/**
 * The estimate's wording has one home: exactly one source holds `estimated since`, it is a
 * component, and both the card's account block and the /travel card line render it.
 */
function oneHomeProblems(sources: Src[]): string[] {
  const homes = sources.filter((s) => code(s).includes('estimated since'));
  if (homes.length !== 1) return [`"estimated since" in ${homes.length} sources, not 1`];
  const home = homes[0].file;
  const out: string[] = [];
  for (const user of [ACCOUNT_BLOCK, TRAVEL_CARD_LINE]) {
    const s = sources.find((x) => x.file === user);
    if (!s || !rendered(s).includes(home)) out.push(`${user} does not render ${home}`);
  }
  return out;
}

type FnNode = ts.ArrowFunction | ts.FunctionExpression | ts.FunctionDeclaration;
const isFn = (n: ts.Node): n is FnNode => ts.isArrowFunction(n) || ts.isFunctionExpression(n) || ts.isFunctionDeclaration(n);

/** The visible text directly inside a JSX element (its JsxText children and string literals). */
function elementText(el: ts.JsxElement): string {
  return el.children.map((c) => (ts.isJsxText(c) ? c.text : ts.isJsxExpression(c) && c.expression && ts.isStringLiteral(c.expression) ? c.expression.text : '')).join(' ');
}

/**
 * Every way the clear rule breaks: `earn: null` must be on exactly one source line, and that line
 * must sit in a function attached through a JSX `on…` attribute — by name, or written inline — of an
 * element whose own text contains `Clear earn rates`.
 */
function clearProblems(sources: Src[]): string[] {
  const lines = sources.flatMap((s) => s.text.split('\n').filter((l) => /\bearn:\s*null/.test(l)).map(() => s));
  if (lines.length !== 1) return [`earn: null on ${lines.length} lines, not 1`];
  const s = lines[0];
  const sf = parseText(s.file, s.text);
  let nullFn: FnNode | undefined;
  walk(sf, (n) => {
    if (ts.isPropertyAssignment(n) && n.name.getText(sf) === 'earn' && n.initializer.kind === ts.SyntaxKind.NullKeyword) {
      let p: ts.Node | undefined = n.parent;
      while (p && !isFn(p)) p = p.parent;
      nullFn = p as FnNode | undefined;
    }
  });
  if (!nullFn) return [`${s.file}: earn: null outside a function`];
  const fn = nullFn;
  const name = ts.isFunctionDeclaration(fn) ? fn.name?.text : ts.isVariableDeclaration(fn.parent) ? fn.parent.name.getText(sf) : undefined;
  const attachedTo: string[] = [];
  walk(sf, (n) => {
    if (!ts.isJsxAttribute(n) || !/^on[A-Z]/.test(n.name.getText(sf)) || !n.initializer || !ts.isJsxExpression(n.initializer)) return;
    const e = n.initializer.expression;
    if (!e) return;
    if (!(e === fn || (ts.isIdentifier(e) && name !== undefined && e.text === name))) return;
    const opening = n.parent.parent;
    attachedTo.push(ts.isJsxOpeningElement(opening) && ts.isJsxElement(opening.parent) ? elementText(opening.parent) : '');
  });
  if (attachedTo.length === 0) return [`${s.file}: earn: null is not in a JSX event handler`];
  return attachedTo.every((t) => t.includes('Clear earn rates')) ? [] : [`${s.file}: the null description is sent by an element that is not "Clear earn rates"`];
}

/**
 * Formatting: the file holding the estimate's wording imports `formatBalance` from the shared module,
 * and no loyalty page file groups digits itself.
 */
function formatterProblems(sources: Src[]): string[] {
  const out: string[] = [];
  for (const s of sources.filter((x) => isLoyaltyPageFile(x.file))) {
    if (/\.toLocaleString\(|Intl\.NumberFormat/.test(s.text)) out.push(`${s.file}: formats digits itself`);
    if (s.text.includes('estimated since') && !/import \{[^}]*\bformatBalance\b[^}]*\} from '@\/lib\/domain\/loyalty'/.test(s.text)) {
      out.push(`${s.file}: does not use the shared formatBalance`);
    }
  }
  return out;
}

/** A loyalty page file (or the travel page) importing the database or reading the ledger table itself. */
function ledgerProblems(sources: Src[]): string[] {
  const out: string[] = [];
  for (const s of sources.filter((x) => isLoyaltyPageFile(x.file))) {
    if (/from\s+['"](@\/lib\/db|(\.\.?\/)+(lib\/)?db)['"]/.test(s.text)) out.push(`${s.file}: imports db`);
    if (/\b(FROM|JOIN)\s+transactions\b/i.test(s.text)) out.push(`${s.file}: reads transactions`);
  }
  return out;
}

// ─── Fabricated sources ─────────────────────────────────────────────────────────────────────────

const LINE_OK = `import { formatBalance } from '@/lib/domain/loyalty';
export default function ZQ42B2Line({ m }) {
  return <span>≈ {formatBalance(m.e.a, m.e.u)} estimated since {m.e.s} · no reading yet, last 30 days · No earn rates set · No estimate for this unit · Estimate vs actual · reported · worth a look · no caps, tiers or rotating categories</span>;
}
`;
const EDITOR_OK = `'use client';
export default function ZQ42B2Editor({ m }) {
  async function clearRates() { await send('PATCH', '/x', { earn: null }); }
  return <span><button onClick={() => null}>Set earn rates</button><button onClick={clearRates}>Clear earn rates</button></span>;
}
`;
const fakeClean = (): Src[] => [
  { file: 'components/LoyaltyZqEarnLine.tsx', text: LINE_OK },
  { file: 'components/LoyaltyZqEarnEditor.tsx', text: EDITOR_OK },
  { file: ACCOUNT_BLOCK, text: `import LoyaltyZqEarnLine from './LoyaltyZqEarnLine';\nexport default function A({ m }) { return <p>Earns into <LoyaltyZqEarnLine m={m} /></p>; }` },
  { file: TRAVEL_CARD_LINE, text: `'use client';\nimport LoyaltyZqEarnLine from './LoyaltyZqEarnLine';\nimport LoyaltyZqEarnEditor from './LoyaltyZqEarnEditor';\nexport default function C({ m }) { return <div><LoyaltyZqEarnEditor m={m} /><LoyaltyZqEarnLine m={m} /></div>; }` },
];
const swap = (sources: Src[], file: string, text: string) => sources.map((s) => (s.file === file ? { ...s, text } : s));

// ─── U4 ─────────────────────────────────────────────────────────────────────────────────────────

describe('the earn wording and the earn-rate controls (P8-42b2)', () => {
  it('T42b2-U4: the pages carry the fixed earn wording and controls, the estimate has one home, Clear earn rates is the one null sender, and no page file formats or reads the ledger itself', () => {
    // The checkers on fabricated sources: clean is accepted, each violation is named.
    const clean = fakeClean();
    expect(missingPhrases(clean)).toEqual([]);
    expect(oneHomeProblems(clean)).toEqual([]);
    expect(clearProblems(clean)).toEqual([]);
    expect(formatterProblems(clean)).toEqual([]);
    expect(ledgerProblems(clean)).toEqual([]);

    const secondNull = [...clean, { file: 'components/LoyaltyZqOther.tsx', text: `'use client';\nexport const O = () => <button onClick={() => send('PATCH', '/x', { earn: null })}>Clear earn rates</button>;` }];
    expect(clearProblems(secondNull)).toEqual(['earn: null on 2 lines, not 1']);
    const wrongButton = swap(clean, 'components/LoyaltyZqEarnEditor.tsx',
      EDITOR_OK.replace('<button onClick={clearRates}>Clear earn rates</button>', '<button onClick={clearRates}>Set earn rates</button><button>Clear earn rates</button>'));
    expect(clearProblems(wrongButton)).toHaveLength(1);
    const notAttached = swap(clean, 'components/LoyaltyZqEarnEditor.tsx', EDITOR_OK.replace('onClick={clearRates}', 'onClick={() => null}'));
    expect(clearProblems(notAttached)).toHaveLength(1);

    const noPhrase = clean.map((s) => ({ ...s, text: s.text.replace('no caps, tiers or rotating categories', 'simplified') }));
    expect(missingPhrases(noPhrase)).toEqual(['no caps, tiers or rotating categories']);
    const onlyInAComment = swap(noPhrase, 'components/LoyaltyZqEarnLine.tsx',
      `// no caps, tiers or rotating categories\n${noPhrase[0].text}`);
    expect(missingPhrases(onlyInAComment)).toEqual(['no caps, tiers or rotating categories']);
    const secondHome = [...clean, { file: 'components/LoyaltyZqCopy.tsx', text: 'export const X = () => <span>≈ 1 estimated since then</span>;' }];
    expect(oneHomeProblems(secondHome)).toEqual(['"estimated since" in 2 sources, not 1']);
    const notOnAccount = swap(clean, ACCOUNT_BLOCK, 'export default function A() { return <p>Earns into ZQ42B2</p>; }');
    expect(oneHomeProblems(notOnAccount)).toEqual([`${ACCOUNT_BLOCK} does not render components/LoyaltyZqEarnLine.tsx`]);

    const ownFormatter = swap(clean, 'components/LoyaltyZqEarnLine.tsx', LINE_OK.replace('formatBalance(m.e.a, m.e.u)', 'm.e.a.toLocaleString()'));
    expect(formatterProblems(ownFormatter)).toEqual(['components/LoyaltyZqEarnLine.tsx: formats digits itself']);
    const intl = swap(clean, 'components/LoyaltyZqEarnLine.tsx', LINE_OK.replace("import { formatBalance } from '@/lib/domain/loyalty';", 'const f = new Intl.NumberFormat();'));
    expect(formatterProblems(intl)).toEqual(['components/LoyaltyZqEarnLine.tsx: formats digits itself', 'components/LoyaltyZqEarnLine.tsx: does not use the shared formatBalance']);

    const rawRead = [...clean, { file: 'components/LoyaltyZqRaw.tsx', text: "import db from '@/lib/db';\nconst q = `SELECT amount FROM transactions WHERE account_id = $1`;" }];
    expect(ledgerProblems(rawRead)).toEqual(['components/LoyaltyZqRaw.tsx: imports db', 'components/LoyaltyZqRaw.tsx: reads transactions']);
    const travelRaw = [...clean, { file: 'app/travel/page.tsx', text: 'const q = `SELECT 1 FROM t JOIN transactions x ON x.id = t.id`;' }];
    expect(ledgerProblems(travelRaw)).toEqual(['app/travel/page.tsx: reads transactions']);

    // The real tree.
    const real = realSources();
    expect(real.some((s) => s.file === ACCOUNT_BLOCK) && real.some((s) => s.file === TRAVEL_CARD_LINE)).toBe(true);
    expect(missingPhrases(real)).toEqual([]);
    expect(oneHomeProblems(real)).toEqual([]);
    expect(clearProblems(real)).toEqual([]);
    expect(formatterProblems(real)).toEqual([]);
    expect(ledgerProblems(real)).toEqual([]);
    // The account page reaches the estimate through the block it already renders.
    expect(rendered({ file: ACCOUNT_PAGE, text: read(ACCOUNT_PAGE) })).toContain(ACCOUNT_BLOCK);
  });
});
