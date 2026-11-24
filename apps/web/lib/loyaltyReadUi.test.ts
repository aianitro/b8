// P8-42c2 — the reading half of the /travel inbox panel: its wording and controls (scenario U6).
//
// NO RENDERER EXISTS in this repo (no jsdom, no testing-library), so the page is checked the way
// `loyaltyInboxUi.test.ts` checks it: over the SOURCE, with the TypeScript compiler API where the
// question is structural (which condition guards a control, which handler a control calls, in what
// order a handler sends) and by text where it is wording. What the page actually renders is proved
// over real HTTP by step H15 of `scripts/gifts-surface-check.mjs`.
//
// Every checker is also run against fabricated violating sources and a clean one, so a checker that
// matches nothing cannot pass the real tree by accident. Fabricated names carry `ZQ42C2`.

import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';
import { describe, expect, it } from 'vitest';

const WEB = fileURLToPath(new URL('..', import.meta.url));
const rel = (f: string) => relative(WEB, f).split('\\').join('/');
const read = (f: string) => readFileSync(join(WEB, f), 'utf8');
const ACCOUNT_PAGE = 'app/accounts/[id]/page.tsx';
const POLL_PATH = '/api/v1/loyalty/inbox/poll';
const READ_PATH = '/api/v1/loyalty/inbox/read';

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
const isLoyaltyPageFile = (f: string) => /^components\/(Loyalty|Travel)[A-Za-z]*\.tsx$/.test(f) || f.startsWith('app/travel/');
const realSources = (): Src[] =>
  [...filesUnder('components'), ...filesUnder('app/travel'), ACCOUNT_PAGE].filter((f) => !isTest(f)).map((file) => ({ file, text: read(file) }));

// ─── The checkers ───────────────────────────────────────────────────────────────────────────────

/** The fixed wording of SPEC.md "Visible text" for the reading half, as it is written in the source. */
const PHRASES = [
  'Needs attention', 'Nothing needs attention', 'Needs attention: ', 'Why: ', ' · ', 'no number shown', 'as of ', 'no date',
  'The mail shows too little of the number', 'No membership ends with this number', 'More than one membership ends with this number',
  'The mail names a different program', 'The unit could not be confirmed against the stored balance', 'The mail has no date',
  'The date is in the future', 'There is no earlier balance to compare with', 'The balance changed by more than 50%',
  'Apply', 'Not mine', 'Ignore', 'Apply to', 'Choose a membership',
  'Reading mail is not set up', 'ANTHROPIC_API_KEY', 'Read stored mail now', 'Waiting to be read: ', 'Could not be read: ', 'Try failed mail again',
  'Not read yet', 'Last read: ', ' · ok', 'failed (',
  'Balance in last statement: yes', 'Balance in last statement: no', 'Balance in last statement: not read yet',
  'Expires ', 'points', 'miles', 'nights', 'usd', 'status', 'something else',
  'From mail: ', 'free night', 'companion fare', 'travel credit', ', expires ', ', no expiry stated',
];

function missingPhrases(sources: Src[]): string[] {
  return PHRASES.filter((p) => !sources.some((s) => s.text.includes(p)));
}

type FnNode = ts.ArrowFunction | ts.FunctionExpression | ts.FunctionDeclaration;
const isFn = (n: ts.Node): n is FnNode => ts.isArrowFunction(n) || ts.isFunctionExpression(n) || ts.isFunctionDeclaration(n);
const enclosingFn = (n: ts.Node): FnNode | undefined => {
  let p: ts.Node | undefined = n.parent;
  while (p && !isFn(p)) p = p.parent;
  return p as FnNode | undefined;
};
const fnName = (fn: FnNode, sf: ts.SourceFile) =>
  ts.isFunctionDeclaration(fn) ? fn.name?.text : ts.isVariableDeclaration(fn.parent) ? fn.parent.name.getText(sf) : undefined;
const isText = (n: ts.Node, phrase: string) => (ts.isJsxText(n) || ts.isStringLiteralLike(n)) && n.text.includes(phrase);
const attrsOf = (el: ts.JsxOpeningLikeElement) => el.attributes.properties.filter(ts.isJsxAttribute);
const attrExpr = (a: ts.JsxAttribute) => (a.initializer && ts.isJsxExpression(a.initializer) ? a.initializer.expression : undefined);
/** Whether an attribute's expression is `name`, or a function that calls `name`. */
const refersTo = (attr: ts.JsxAttribute, name: string, sf: ts.SourceFile) => {
  const e = attrExpr(attr);
  if (!e) return false;
  if (ts.isIdentifier(e)) return e.text === name;
  let found = false;
  walk(e, (n) => { if (ts.isCallExpression(n) && n.expression.getText(sf) === name) found = true; });
  return isFn(e) && found;
};
/** The nearest JSX element around `n` that has an attribute called `attr`. */
const elementWith = (n: ts.Node, attr: string, sf: ts.SourceFile): ts.JsxElement | undefined => {
  let p: ts.Node | undefined = n.parent;
  while (p) {
    if (ts.isJsxElement(p) && attrsOf(p.openingElement).some((a) => a.name.getText(sf) === attr)) return p;
    p = p.parent;
  }
  return undefined;
};
/** Whether `n` sits under a `?:` or `&&` whose condition reads `word`. */
const guardedBy = (n: ts.Node, word: string, sf: ts.SourceFile) => {
  let p: ts.Node | undefined = n.parent;
  while (p) {
    if (ts.isConditionalExpression(p) && p.condition.getText(sf).includes(word)) return true;
    if (ts.isBinaryExpression(p) && p.operatorToken.kind === ts.SyntaxKind.AmpersandAmpersandToken && p.left.getText(sf).includes(word)) return true;
    p = p.parent;
  }
  return false;
};

/** `Read stored mail now` and `Try failed mail again` are rendered only under a condition on `readable`. */
function readControlProblems(sources: Src[]): string[] {
  const out: string[] = [];
  for (const s of sources) {
    const sf = parseText(s.file, s.text);
    walk(sf, (n) => {
      if (!ts.isJsxText(n) && !(ts.isStringLiteralLike(n) && ts.isJsxExpression(n.parent))) return;
      for (const label of ['Read stored mail now', 'Try failed mail again']) {
        if (isText(n, label) && !guardedBy(n, 'readable', sf)) out.push(`${s.file}: ${label} is not under a condition on readable`);
      }
    });
  }
  return out;
}

/** Whether a call sends to `path`: a string literal holding it, or the `READ_PATH` constant for the read. */
const sendsTo = (call: ts.CallExpression, path: string, sf: ts.SourceFile) =>
  call.arguments.some((a) => (ts.isStringLiteralLike(a) && a.text === path) || (path === READ_PATH && a.getText(sf) === 'READ_PATH'));

/**
 * The `Check inbox now` rule: still under a condition on `configured`; its onClick handler is a named
 * function holding exactly two sends, the poll then the read; and no `return` (and no branch holding
 * one) sits between them, so the read is sent whatever the poll answered.
 */
function checkNowProblems(sources: Src[]): string[] {
  const out: string[] = [];
  let found = 0;
  for (const s of sources) {
    const sf = parseText(s.file, s.text);
    walk(sf, (x) => {
      if (!isText(x, 'Check inbox now')) return;
      found++;
      if (!guardedBy(x, 'configured', sf)) out.push(`${s.file}: Check inbox now is not under a condition on configured`);
      const el = elementWith(x, 'onClick', sf);
      const click = el && attrsOf(el.openingElement).find((a) => a.name.getText(sf) === 'onClick');
      const e = click && attrExpr(click);
      const name = e && ts.isIdentifier(e) ? e.text : undefined;
      let handler: FnNode | undefined;
      walk(sf, (n) => { if (isFn(n) && name && fnName(n, sf) === name) handler = n; });
      if (!handler || !handler.body || !ts.isBlock(handler.body)) { out.push(`${s.file}: Check inbox now has no named handler`); return; }
      const sends: ts.CallExpression[] = [];
      walk(handler.body, (n) => { if (ts.isCallExpression(n) && n.expression.getText(sf) === 'send') sends.push(n); });
      if (sends.length !== 2 || !sendsTo(sends[0], POLL_PATH, sf) || !sendsTo(sends[1], READ_PATH, sf)) {
        out.push(`${s.file}: Check inbox now does not send the poll and then the read, and nothing else`);
        return;
      }
      const stmts = handler.body.statements;
      const at = (call: ts.Node) => stmts.findIndex((st) => st.pos <= call.pos && call.end <= st.end);
      const [p, r] = [at(sends[0]), at(sends[1])];
      if (p < 0 || r <= p) { out.push(`${s.file}: the read is not sent after the poll`); return; }
      for (const st of stmts.slice(p, r)) {
        let exits = false;
        walk(st, (n) => { if (ts.isReturnStatement(n) || ts.isThrowStatement(n)) exits = true; });
        if (exits) out.push(`${s.file}: the read is skipped when the poll fails`);
      }
    });
  }
  if (found === 0) out.push('Check inbox now is not on the page');
  return out;
}

/**
 * A queue action rule: `action: '<value>'` is written in exactly one object literal across every
 * source, inside a named handler, and that handler is attached through `onClick` to the element
 * labelled `label`.
 */
function actionProblems(sources: Src[], value: string, label: string): string[] {
  const hits = sources.flatMap((s) => {
    const sf = parseText(s.file, s.text);
    const out: { s: Src; sf: ts.SourceFile; n: ts.Node }[] = [];
    walk(sf, (n) => {
      if (ts.isPropertyAssignment(n) && n.name.getText(sf) === 'action' && ts.isStringLiteralLike(n.initializer) && n.initializer.text === value) out.push({ s, sf, n });
    });
    return out;
  });
  if (hits.length !== 1) return [`${value} is sent from ${hits.length} places, not one`];
  const { s, sf, n } = hits[0];
  const fn = enclosingFn(n);
  const name = fn && fnName(fn, sf);
  if (!name) return [`${s.file}: ${value} is not sent from a named handler`];
  let attached = false;
  walk(sf, (x) => {
    if (!ts.isJsxElement(x) || !x.children.some((c) => ts.isJsxText(c) && c.text.trim() === label)) return;
    if (attrsOf(x.openingElement).some((a) => a.name.getText(sf) === 'onClick' && refersTo(a, name, sf))) attached = true;
  });
  return attached ? [] : [`${s.file}: the ${value} handler is not attached to ${label}`];
}

/** The Apply control is disabled while the item has no unique match and no membership is chosen. */
function applyDisabledProblems(sources: Src[]): string[] {
  const out: string[] = [];
  let found = 0;
  for (const s of sources) {
    const sf = parseText(s.file, s.text);
    walk(sf, (x) => {
      if (!ts.isJsxElement(x) || !x.children.some((c) => ts.isJsxText(c) && c.text.trim() === 'Apply')) return;
      found++;
      const dis = attrsOf(x.openingElement).find((a) => a.name.getText(sf) === 'disabled');
      const e = dis && attrExpr(dis);
      const text = e ? e.getText(sf) : '';
      if (!/unique/.test(text) || !/choice/.test(text)) out.push(`${s.file}: Apply is not disabled until a membership is chosen`);
    });
  }
  if (found === 0) out.push('no Apply control');
  return out;
}

/** Things no page-side source may contain. */
function hygieneProblems(sources: Src[]): string[] {
  const out: string[] = [];
  for (const s of sources) {
    // A server-only import is judged in the loyalty page files: a few older dashboard and account
    // components are server components that query the database on purpose, and are not this page's.
    if (isLoyaltyPageFile(s.file) && /from\s+['"](imapflow|mailparser|pg|@anthropic-ai\/sdk|@\/lib\/db|@\/lib\/loyaltyInboxRead|@\/lib\/loyaltyReader|@\/lib\/loyaltyInbox)['"]/.test(s.text)) {
      out.push(`${s.file}: imports a server-only module`);
    }
    for (const [re, what] of [[/member_number/, 'names member_number'], [/process\.env/, 'reads process.env'],
      [/dangerouslySetInnerHTML|\binnerHTML\b/, 'injects markup']] as const) if (re.test(s.text)) out.push(`${s.file}: ${what}`);
  }
  return out;
}

/** The new reading files never turn a missing value into zero. */
function nullAsZeroProblems(sources: Src[]): string[] {
  return sources
    .filter((s) => /^components\/Loyalty(InboxReadPanel|ReadQueueItem|FromMailLine)\.tsx$/.test(s.file))
    .filter((s) => /\?\?\s*['"]?0\b|\|\|\s*['"]?0\b/.test(s.text))
    .map((s) => `${s.file}: renders a null as 0`);
}

const allProblems = (sources: Src[]) => [
  ...missingPhrases(sources).map((p) => `missing phrase ${p}`),
  ...readControlProblems(sources),
  ...checkNowProblems(sources),
  ...actionProblems(sources, 'apply', 'Apply'),
  ...actionProblems(sources.filter((s) => s.file !== 'components/LoyaltyStaysSection.tsx'), 'not_mine', 'Not mine'),
  ...actionProblems(sources.filter((s) => s.file !== 'components/LoyaltyStaysSection.tsx'), 'ignore', 'Ignore'),
  ...applyDisabledProblems(sources),
  ...hygieneProblems(sources),
  ...nullAsZeroProblems(sources),
];

// ─── Fabricated sources ─────────────────────────────────────────────────────────────────────────

const PANEL = `'use client';
export default function ZQ42C2Panel({ inbox, read }) {
  async function checkNow() {
    const polled = await send('POST', '${POLL_PATH}', {});
    const reading = await send('POST', READ_PATH, {});
    if (!polled.ok) { return; }
  }
  async function readNow() { await send('POST', READ_PATH, {}); }
  return <section>
    {inbox.configured ? <button onClick={checkNow}>Check inbox now</button> : null}
    {read.readable && read.waiting > 0 ? <button onClick={readNow}>Read stored mail now</button> : null}
    {read.readable ? <button onClick={readNow}>Try failed mail again</button> : null}
  </section>;
}`;
const ITEM = `'use client';
export default function ZQ42C2Item({ item }) {
  async function applyItem() { await act({ action: 'apply', membershipId: 1 }); }
  async function notMine() { await act({ action: 'not_mine' }); }
  async function ignoreItem() { await act({ action: 'ignore' }); }
  return <li>
    <button onClick={applyItem} disabled={busy || (unique === null && choice === null)}>Apply</button>
    <button onClick={notMine}>Not mine</button>
    <button onClick={ignoreItem}>Ignore</button>
  </li>;
}`;
// The guarded control labels live in PANEL, under their conditions; every other phrase is here.
const GUARDED = ['Read stored mail now', 'Try failed mail again'];
const WORDS = `export const W = () => <p>{${JSON.stringify(PHRASES.filter((p) => !GUARDED.includes(p)).join(' | '))}}</p>;`;
const fakeClean = (): Src[] => [
  { file: 'components/LoyaltyZqPanel.tsx', text: PANEL },
  { file: 'components/LoyaltyZqItem.tsx', text: ITEM },
  { file: 'components/LoyaltyZqWords.tsx', text: WORDS },
];

describe('the loyalty inbox reading panel (P8-42c2)', () => {
  it('T42c2-U6: the reading wording and controls have one home each, and no page file reads the environment or a server module', () => {
    const clean = fakeClean();
    // The phrase list is checked over the words file only; the structural checkers over the controls.
    expect(allProblems(clean)).toEqual([]);
    const swapIn = (i: number, from: string, to: string): Src[] =>
      clean.map((s, j) => (j === i ? { ...s, text: s.text.replace(from, to) } : s));

    // A missing phrase.
    expect(missingPhrases(swapIn(2, 'Nothing needs attention', 'All clear'))).toEqual(['Nothing needs attention']);
    // A read sent before the poll, a read skipped after a failed poll, a third send.
    const readFirst = PANEL.replace(`const polled = await send('POST', '${POLL_PATH}', {});\n    const reading = await send('POST', READ_PATH, {});`,
      `const reading = await send('POST', READ_PATH, {});\n    const polled = await send('POST', '${POLL_PATH}', {});`);
    expect(checkNowProblems([{ ...clean[0], text: readFirst }])).toEqual(['components/LoyaltyZqPanel.tsx: Check inbox now does not send the poll and then the read, and nothing else']);
    const skipped = PANEL.replace(`const reading = await send('POST', READ_PATH, {});\n    if (!polled.ok) { return; }`,
      `if (!polled.ok) { return; }\n    const reading = await send('POST', READ_PATH, {});`);
    expect(checkNowProblems([{ ...clean[0], text: skipped }])).toEqual(['components/LoyaltyZqPanel.tsx: the read is skipped when the poll fails']);
    expect(checkNowProblems(swapIn(0, "if (!polled.ok) { return; }", "await send('POST', '/x', {});"))).toHaveLength(1);
    // Check inbox now without its condition on configured.
    expect(checkNowProblems(swapIn(0, '{inbox.configured ? <button onClick={checkNow}>Check inbox now</button> : null}', '<button onClick={checkNow}>Check inbox now</button>')))
      .toEqual(['components/LoyaltyZqPanel.tsx: Check inbox now is not under a condition on configured']);
    // An unconditional Read stored mail now.
    expect(readControlProblems(swapIn(0, '{read.readable && read.waiting > 0 ? <button onClick={readNow}>Read stored mail now</button> : null}', '<button onClick={readNow}>Read stored mail now</button>')))
      .toEqual(['components/LoyaltyZqPanel.tsx: Read stored mail now is not under a condition on readable']);
    // A queue action sent from two places, or wired to the wrong control.
    expect(actionProblems([...clean, { file: 'components/LoyaltyZqTwo.tsx', text: `const f = () => act({ action: 'ignore' });` }], 'ignore', 'Ignore'))
      .toEqual(['ignore is sent from 2 places, not one']);
    expect(actionProblems(swapIn(1, '<button onClick={notMine}>Not mine</button>', '<button onClick={ignoreItem}>Not mine</button>'), 'not_mine', 'Not mine')).toHaveLength(1);
    // Apply enabled with no membership chosen.
    expect(applyDisabledProblems(swapIn(1, 'disabled={busy || (unique === null && choice === null)}', 'disabled={busy}')))
      .toEqual(['components/LoyaltyZqItem.tsx: Apply is not disabled until a membership is chosen']);
    // An innerHTML use, an environment read, a server-only import, a member number column, a null as zero.
    expect(hygieneProblems(swapIn(1, '<li>', '<li dangerouslySetInnerHTML={{ __html: item.x }}>'))).toEqual(['components/LoyaltyZqItem.tsx: injects markup']);
    expect(hygieneProblems(swapIn(0, 'read.readable ?', 'process.env.X ?'))).toEqual(['components/LoyaltyZqPanel.tsx: reads process.env']);
    expect(hygieneProblems([...clean, { file: 'components/LoyaltyZqDb.tsx', text: "import { loadReadOverview } from '@/lib/loyaltyInboxRead';\nconst c = 'member_number';" }]))
      .toEqual(['components/LoyaltyZqDb.tsx: imports a server-only module', 'components/LoyaltyZqDb.tsx: names member_number']);
    expect(nullAsZeroProblems([{ file: 'components/LoyaltyReadQueueItem.tsx', text: 'const b = item.balance ?? 0;' }])).toHaveLength(1);

    // The real tree.
    const real = realSources();
    expect(real.some((s) => s.file === 'components/LoyaltyInboxReadPanel.tsx')).toBe(true);
    expect(allProblems(real)).toEqual([]);
  });
});
