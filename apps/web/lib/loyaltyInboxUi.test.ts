// P8-42c1 — the loyalty inbox panel's wording and controls on /travel (scenario U6).
//
// NO RENDERER EXISTS in this repo (no jsdom, no testing-library), so the page is checked the way
// `loyaltyCardUi.test.ts` checks it: over the SOURCE, with the TypeScript compiler API where the
// question is structural (which element a handler hangs on, which condition guards a control) and
// by text where it is wording. What the page actually renders is proved over real HTTP by step H14
// of `scripts/gifts-surface-check.mjs`.
//
// Every checker is also run against fabricated violating sources and a clean one, so a checker that
// matches nothing cannot pass the real tree by accident. Fabricated names carry `ZQ42C`.

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
const realSources = (): Src[] =>
  [...filesUnder('components'), ...filesUnder('app/travel'), ACCOUNT_PAGE].filter((f) => !isTest(f)).map((file) => ({ file, text: read(file) }));
const isLoyaltyPageFile = (f: string) => /^components\/(Loyalty|Travel)[A-Za-z]*\.tsx$/.test(f) || f.startsWith('app/travel/');

// ─── The checkers ───────────────────────────────────────────────────────────────────────────────

/** The fixed wording of SPEC.md "Visible text", as it is written in the source. */
const PHRASES = [
  'Loyalty inbox', 'Raw mail is kept 30 days, then deleted.', 'Inbox polling is not set up', 'forwarding filter',
  'Check inbox now', 'Not checked yet', 'Last check: ', 'failed (', 'No mail from unknown senders',
  'Mail from unknown senders: ', ' × ', 'Not matched to a person: ', ': no forwarding address set', ': no mail yet',
  ': last mail ', ': forwarding quiet for ', 'Last mail seen: ', 'No mail seen yet', ' in the last 30 days',
  'No sender domains set', 'Edit sender domains', 'Edit forwarding addresses',
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

/** The JSX attributes of an opening or self-closing element, by name. */
const attrsOf = (el: ts.JsxOpeningLikeElement) => el.attributes.properties.filter(ts.isJsxAttribute);
/** Whether an attribute's expression is `name` or a function calling `name`. */
const refersTo = (attr: ts.JsxAttribute, name: string, sf: ts.SourceFile) => {
  const e = attr.initializer && ts.isJsxExpression(attr.initializer) ? attr.initializer.expression : undefined;
  if (!e) return false;
  if (ts.isIdentifier(e)) return e.text === name;
  let found = false;
  walk(e, (n) => { if (ts.isCallExpression(n) && n.expression.getText(sf) === name) found = true; });
  return isFn(e) && found;
};

/**
 * The poll rule: the poll path is written exactly once across every source, inside a named handler;
 * that handler is attached through `onClick` to the element holding `Check inbox now`; and every
 * `Check inbox now` sits under a condition that reads `configured`.
 */
function pollProblems(sources: Src[]): string[] {
  const hits = sources.flatMap((s) => {
    const sf = parseText(s.file, s.text);
    const out: { s: Src; sf: ts.SourceFile; n: ts.Node }[] = [];
    walk(sf, (n) => { if (ts.isStringLiteralLike(n) && n.text.includes(POLL_PATH)) out.push({ s, sf, n }); });
    return out;
  });
  if (hits.length !== 1) return [`the poll path is written ${hits.length} times, not once`];
  const { s, sf, n } = hits[0];
  const fn = enclosingFn(n);
  const name = fn && fnName(fn, sf);
  if (!name) return [`${s.file}: the poll is not sent from a named handler`];
  const problems: string[] = [];
  let attached = 0;
  walk(sf, (x) => {
    if (!isText(x, 'Check inbox now')) return;
    let p: ts.Node | undefined = x.parent;
    let guarded = false;
    let element: ts.JsxElement | undefined;
    while (p) {
      if (!element && ts.isJsxElement(p) && attrsOf(p.openingElement).some((a) => a.name.getText(sf) === 'onClick')) element = p;
      if (ts.isConditionalExpression(p) && p.condition.getText(sf).includes('configured')) guarded = true;
      if (ts.isBinaryExpression(p) && p.operatorToken.kind === ts.SyntaxKind.AmpersandAmpersandToken && p.left.getText(sf).includes('configured')) guarded = true;
      p = p.parent;
    }
    if (!guarded) problems.push(`${s.file}: Check inbox now is not under a condition on configured`);
    const onClick = element && attrsOf(element.openingElement).find((a) => a.name.getText(sf) === 'onClick');
    if (onClick && refersTo(onClick, name, sf)) attached++;
  });
  if (attached === 0) problems.push(`${s.file}: the poll handler is not attached to Check inbox now`);
  return problems;
}

/**
 * An edit rule: `key` is written in exactly one object literal across every source, inside a named
 * handler, and that handler is passed through a JSX attribute of an element labelled `label`.
 */
function editProblems(sources: Src[], key: string, label: string): string[] {
  const hits = sources.flatMap((s) => {
    const sf = parseText(s.file, s.text);
    const out: { s: Src; sf: ts.SourceFile; n: ts.Node }[] = [];
    walk(sf, (n) => { if ((ts.isPropertyAssignment(n) || ts.isShorthandPropertyAssignment(n)) && n.name.getText(sf) === key) out.push({ s, sf, n }); });
    return out;
  });
  if (hits.length !== 1) return [`${key} is sent from ${hits.length} places, not one`];
  const { s, sf, n } = hits[0];
  const fn = enclosingFn(n);
  const name = fn && fnName(fn, sf);
  if (!name) return [`${s.file}: ${key} is not sent from a named handler`];
  let attached = false;
  walk(sf, (x) => {
    if (!ts.isJsxOpeningElement(x) && !ts.isJsxSelfClosingElement(x)) return;
    const attrs = attrsOf(x);
    const labelled = attrs.some((a) => a.initializer !== undefined && ts.isStringLiteral(a.initializer) && a.initializer.text === label)
      || (ts.isJsxOpeningElement(x) && ts.isJsxElement(x.parent) && x.parent.children.some((c) => isText(c, label)));
    if (labelled && attrs.some((a) => refersTo(a, name, sf))) attached = true;
  });
  return attached ? [] : [`${s.file}: the ${key} handler is not attached to ${label}`];
}

/** Things no page-side source may contain; the ledger and the database only in loyalty page files. */
function hygieneProblems(sources: Src[]): string[] {
  const out: string[] = [];
  for (const s of sources) {
    if (/from\s+['"](imapflow|mailparser)['"]/.test(s.text)) out.push(`${s.file}: imports a mail package`);
    for (const [re, what] of [[/raw_mail/, 'names raw_mail'], [/LOYALTY_IMAP_PASSWORD/, 'names the password'], [/process\.env/, 'reads process.env'],
      [/dangerouslySetInnerHTML|\binnerHTML\b/, 'injects markup']] as const) if (re.test(s.text)) out.push(`${s.file}: ${what}`);
    if (isLoyaltyPageFile(s.file)) {
      if (/from\s+['"](@\/lib\/db|(\.\.?\/)+(lib\/)?db)['"]/.test(s.text)) out.push(`${s.file}: imports db`);
      if (/\b(FROM|JOIN)\s+transactions\b/i.test(s.text)) out.push(`${s.file}: reads transactions`);
    }
  }
  return out;
}

const allProblems = (sources: Src[]) => [
  ...missingPhrases(sources).map((p) => `missing phrase ${p}`),
  ...pollProblems(sources),
  ...editProblems(sources, 'senderDomains', 'Edit sender domains'),
  ...editProblems(sources, 'forwardingAddresses', 'Edit forwarding addresses'),
  ...hygieneProblems(sources),
];

// ─── Fabricated sources ─────────────────────────────────────────────────────────────────────────

const PANEL = `'use client';
export default function ZQ42CPanel({ inbox }) {
  async function checkNow() { await send('POST', '${POLL_PATH}', {}); }
  async function saveDomains(e) { await send('PATCH', '/x', { senderDomains: e }); }
  async function saveAddresses(e) { await send('PATCH', '/y', { forwardingAddresses: e }); }
  return <section><h2>Loyalty inbox</h2><p>Raw mail is kept 30 days, then deleted.</p>
    {inbox.configured ? <button onClick={checkNow}>Check inbox now</button> : <p>Inbox polling is not set up, add a forwarding filter</p>}
    <ZQ42CList label="Edit sender domains" onSave={(e) => saveDomains(e)} />
    <ZQ42CList label="Edit forwarding addresses" onSave={saveAddresses} />
  </section>;
}`;
const WORDS = `export const W = () => <p>Not checked yet · Last check: · failed ( · No mail from unknown senders · Mail from unknown senders:  × ` +
  ` · Not matched to a person:  · : no forwarding address set · : no mail yet · : last mail  · : forwarding quiet for  · Last mail seen:  · No mail seen yet ·  in the last 30 days · No sender domains set</p>;`;
const fakeClean = (): Src[] => [{ file: 'components/LoyaltyZqPanel.tsx', text: PANEL }, { file: 'components/LoyaltyZqWords.tsx', text: WORDS }];

describe('the loyalty inbox panel (P8-42c1)', () => {
  it('T42c1-U6: the page wording and its controls have one home each, and no page file reads the environment, the ledger or mail', () => {
    const clean = fakeClean();
    expect(allProblems(clean)).toEqual([]);

    const swap = (from: string, to: string): Src[] => [{ ...clean[0], text: PANEL.replace(from, to) }, clean[1]];
    // An innerHTML use, a process.env read and a missing phrase are each named.
    expect(hygieneProblems(swap('<h2>Loyalty inbox</h2>', '<h2 dangerouslySetInnerHTML={{ __html: inbox.x }} />'))).toEqual(['components/LoyaltyZqPanel.tsx: injects markup']);
    expect(hygieneProblems(swap('inbox.configured ?', 'process.env.X ?'))).toEqual(['components/LoyaltyZqPanel.tsx: reads process.env']);
    expect(hygieneProblems([...clean, { file: 'components/LoyaltyZqDb.tsx', text: "import db from '@/lib/db';\nimport { simpleParser } from 'mailparser';" }]))
      .toEqual(['components/LoyaltyZqDb.tsx: imports a mail package', 'components/LoyaltyZqDb.tsx: imports db']);
    expect(missingPhrases(swap('Raw mail is kept 30 days, then deleted.', 'Raw mail is kept a while.'))).toEqual(['Raw mail is kept 30 days, then deleted.']);
    // A second poll sender, an unguarded or unattached Check inbox now.
    expect(pollProblems([...clean, { file: 'components/LoyaltyZqOther.tsx', text: `const go = () => fetch('${POLL_PATH}');` }])).toEqual(['the poll path is written 2 times, not once']);
    expect(pollProblems(swap('{inbox.configured ? <button onClick={checkNow}>Check inbox now</button> : <p>', '<button onClick={checkNow}>Check inbox now</button>{<p>'))).toHaveLength(1);
    expect(pollProblems(swap('onClick={checkNow}', 'onClick={() => null}'))).toEqual(['components/LoyaltyZqPanel.tsx: the poll handler is not attached to Check inbox now']);
    // An edit sent from a second place, or wired to the wrong control.
    expect(editProblems([...clean, { file: 'components/LoyaltyZqTwo.tsx', text: `const f = (e) => send('PATCH', '/z', { senderDomains: e });` }], 'senderDomains', 'Edit sender domains'))
      .toEqual(['senderDomains is sent from 2 places, not one']);
    expect(editProblems(swap('label="Edit sender domains" onSave={(e) => saveDomains(e)}', 'label="Edit sender domains" onSave={saveAddresses}'), 'senderDomains', 'Edit sender domains')).toHaveLength(1);

    // The real tree.
    const real = realSources();
    expect(real.some((s) => s.file === 'components/LoyaltyInboxPanel.tsx')).toBe(true);
    expect(allProblems(real)).toEqual([]);
  });
});
