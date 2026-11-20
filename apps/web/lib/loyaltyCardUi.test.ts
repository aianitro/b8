// P8-42b — the card controls and the fee-watch wording on /travel and /accounts/[id] (scenario U4).
//
// NO RENDERER EXISTS in this repo (no jsdom, no testing-library), so the pages are checked the way
// `loyaltyNits.test.ts` checks them: over the SOURCE, with the TypeScript compiler API where the
// question is structural (which element a handler hangs on) and by text where it is wording. What
// the pages actually render is proved over real HTTP by step H12 of `scripts/gifts-surface-check.mjs`.
//
// Every checker is also run against fabricated violating sources and a clean one, so a checker that
// matches nothing cannot pass the real tree by accident. Fabricated names carry `ZQ42B`.

import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';
import { describe, expect, it } from 'vitest';

const WEB = fileURLToPath(new URL('..', import.meta.url));
const rel = (f: string) => relative(WEB, f).split('\\').join('/');
const read = (f: string) => readFileSync(join(WEB, f), 'utf8');
const ACCOUNT_PAGE = 'app/accounts/[id]/page.tsx';

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

/** The loyalty-scoped page files, which must leave the ledger to the store. */
const isLoyaltyPageFile = (f: string) => /^components\/(Loyalty|Travel|AccountEarns)[A-Za-z]*\.tsx$/.test(f) || f.startsWith('app/travel/');

// ─── The checkers ───────────────────────────────────────────────────────────────────────────────

const PHRASES = ['Annual fee posted', 'No annual fee seen yet', 'expected by', 'Earns into', 'Link a card', 'Unlink card', 'Set benefit'];

/** Each fixed phrase missing from every source. */
function missingPhrases(sources: Src[]): string[] {
  return PHRASES.filter((p) => !sources.some((s) => s.text.includes(p)));
}

/**
 * Whether `Earns into` is on the account page's rendering path: in the page itself, or in a
 * component file the page imports through `@/components/…`.
 */
function earnsIntoOnAccountPage(page: Src, sources: Src[]): boolean {
  if (page.text.includes('Earns into')) return true;
  const sf = parseText(page.file, page.text);
  const imported: string[] = [];
  walk(sf, (n) => {
    if (ts.isImportDeclaration(n) && ts.isStringLiteral(n.moduleSpecifier) && n.moduleSpecifier.text.startsWith('@/components/')) {
      imported.push(`${n.moduleSpecifier.text.slice(2)}.tsx`);
    }
  });
  return sources.some((s) => imported.includes(s.file) && s.text.includes('Earns into'));
}

type FnNode = ts.ArrowFunction | ts.FunctionExpression | ts.FunctionDeclaration;
const isFn = (n: ts.Node): n is FnNode => ts.isArrowFunction(n) || ts.isFunctionExpression(n) || ts.isFunctionDeclaration(n);

/** The visible text directly inside a JSX element (its JsxText children and string literals). */
function elementText(el: ts.JsxElement): string {
  return el.children.map((c) => (ts.isJsxText(c) ? c.text : ts.isJsxExpression(c) && c.expression && ts.isStringLiteral(c.expression) ? c.expression.text : '')).join(' ');
}

/**
 * Every way the unlink rule breaks: `cardAccountId: null` must be on exactly one source line, and
 * that line must sit in a function attached through a JSX `on…` attribute — by name, or written
 * inline — of an element whose own text contains `Unlink card`.
 */
function unlinkProblems(sources: Src[]): string[] {
  const lines = sources.flatMap((s) => s.text.split('\n').filter((l) => /cardAccountId:\s*null/.test(l)).map((l) => ({ s, l })));
  if (lines.length !== 1) return [`cardAccountId: null on ${lines.length} lines, not 1`];
  const { s } = lines[0];
  const sf = parseText(s.file, s.text);
  let nullFn: FnNode | undefined;
  walk(sf, (n) => {
    if (ts.isPropertyAssignment(n) && n.name.getText(sf) === 'cardAccountId' && n.initializer.kind === ts.SyntaxKind.NullKeyword) {
      let p: ts.Node | undefined = n.parent;
      while (p && !isFn(p)) p = p.parent;
      nullFn = p as FnNode | undefined;
    }
  });
  if (!nullFn) return [`${s.file}: cardAccountId: null outside a function`];
  const fn = nullFn;
  const name = ts.isFunctionDeclaration(fn) ? fn.name?.text : ts.isVariableDeclaration(fn.parent) ? fn.parent.name.getText(sf) : undefined;
  const attachedTo: string[] = [];
  walk(sf, (n) => {
    if (!ts.isJsxAttribute(n) || !/^on[A-Z]/.test(n.name.getText(sf)) || !n.initializer || !ts.isJsxExpression(n.initializer)) return;
    const e = n.initializer.expression;
    if (!e) return;
    const hit = e === fn || (ts.isIdentifier(e) && name !== undefined && e.text === name);
    if (!hit) return;
    const opening = n.parent.parent;
    attachedTo.push(ts.isJsxOpeningElement(opening) && ts.isJsxElement(opening.parent) ? elementText(opening.parent) : '');
  });
  if (attachedTo.length === 0) return [`${s.file}: cardAccountId: null is not in a JSX event handler`];
  return attachedTo.every((t) => t.includes('Unlink card')) ? [] : [`${s.file}: the null card is sent by an element that is not "Unlink card"`];
}

/** A loyalty page file importing the database or reading the ledger table itself. */
function ledgerProblems(sources: Src[]): string[] {
  const out: string[] = [];
  for (const s of sources.filter((x) => isLoyaltyPageFile(x.file))) {
    if (/from\s+['"](@\/lib\/db|(\.\.?\/)+(lib\/)?db)['"]/.test(s.text)) out.push(`${s.file}: imports db`);
    if (/\b(FROM|JOIN)\s+transactions\b/i.test(s.text)) out.push(`${s.file}: reads transactions`);
  }
  return out;
}

// ─── Fabricated sources ─────────────────────────────────────────────────────────────────────────

const clientFile = (body: string) => `'use client';\nexport default function ZQ42BCard({ m }) {\n${body}\n}\n`;
const UNLINK_OK = clientFile(
  `  async function unlinkCard() { await send('PATCH', '/x', { cardAccountId: null }); }\n` +
  `  return <span><button onClick={unlinkCard}>Unlink card</button><select aria-label="Link a card" /></span>;`
);
const fakeClean = (): Src[] => [
  { file: 'components/LoyaltyZqCard.tsx', text: UNLINK_OK },
  { file: 'components/LoyaltyZqLine.tsx', text: 'export const L = () => <span>Annual fee posted · expected by · No annual fee seen yet · Set benefit</span>;' },
  { file: 'components/AccountEarnsZq.tsx', text: 'export default function E({ p }) { return <p>Earns into {p}</p>; }' },
  { file: ACCOUNT_PAGE, text: `import AccountEarnsZq from '@/components/AccountEarnsZq';\nexport default function P() { return <AccountEarnsZq p="ZQ42B" />; }` },
];

// ─── U4 ─────────────────────────────────────────────────────────────────────────────────────────

describe('the card controls and the fee-watch wording (P8-42b)', () => {
  it('T42b-U4: the pages carry the fixed wording and the controls, Unlink card is the one null-card sender, and no page file reads the ledger', () => {
    // The checkers on fabricated sources: clean is accepted, each violation is named.
    const clean = fakeClean();
    expect(missingPhrases(clean)).toEqual([]);
    expect(earnsIntoOnAccountPage(clean[3], clean)).toBe(true);
    expect(unlinkProblems(clean)).toEqual([]);
    expect(ledgerProblems(clean)).toEqual([]);

    const secondNull = [...clean, { file: 'components/LoyaltyZqOther.tsx', text: clientFile(`  return <button onClick={() => send('PATCH', '/x', { cardAccountId: null })}>Unlink card</button>;`) }];
    expect(unlinkProblems(secondNull)).toEqual(['cardAccountId: null on 2 lines, not 1']);
    const wrongButton = [{ ...clean[0], text: UNLINK_OK.replace('<button onClick={unlinkCard}>Unlink card</button>', '<button onClick={unlinkCard}>Set benefit</button><button>Unlink card</button>') }, ...clean.slice(1)];
    expect(unlinkProblems(wrongButton)).toHaveLength(1);
    const notAttached = [{ ...clean[0], text: UNLINK_OK.replace('onClick={unlinkCard}', 'onClick={() => null}') }, ...clean.slice(1)];
    expect(unlinkProblems(notAttached)).toHaveLength(1);
    const inlineOk = [{ ...clean[0], text: clientFile(`  return <button onClick={() => send('PATCH', '/x', { cardAccountId: null })}>Unlink card</button>;`) }, ...clean.slice(1)];
    expect(unlinkProblems(inlineOk)).toEqual([]);

    const noPhrase = clean.map((s) => ({ ...s, text: s.text.replace('expected by', 'due') }));
    expect(missingPhrases(noPhrase)).toEqual(['expected by']);
    const pageWithout = { file: ACCOUNT_PAGE, text: 'export default function P() { return <p>ZQ42B</p>; }' };
    expect(earnsIntoOnAccountPage(pageWithout, clean)).toBe(false);

    const rawRead = [...clean, { file: 'components/LoyaltyZqRaw.tsx', text: "import db from '@/lib/db';\nconst q = `SELECT date FROM transactions WHERE account_id = $1`;" }];
    expect(ledgerProblems(rawRead)).toEqual(['components/LoyaltyZqRaw.tsx: imports db', 'components/LoyaltyZqRaw.tsx: reads transactions']);
    const travelRaw = [...clean, { file: 'app/travel/page.tsx', text: 'const q = `SELECT 1 FROM t JOIN transactions x ON x.id = t.id`;' }];
    expect(ledgerProblems(travelRaw)).toEqual(['app/travel/page.tsx: reads transactions']);

    // The real tree.
    const real = realSources();
    expect(real.some((s) => s.file === 'components/LoyaltyCardLink.tsx')).toBe(true);
    expect(missingPhrases(real)).toEqual([]);
    expect(earnsIntoOnAccountPage({ file: ACCOUNT_PAGE, text: read(ACCOUNT_PAGE) }, real)).toBe(true);
    expect(unlinkProblems(real)).toEqual([]);
    expect(ledgerProblems(real)).toEqual([]);
    expect(real.filter((s) => isLoyaltyPageFile(s.file)).length).toBeGreaterThanOrEqual(10);
  });
});
