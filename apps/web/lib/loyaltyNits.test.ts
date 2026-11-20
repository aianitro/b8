// P8-42a2 — the member-number editor on /travel: an empty save sends nothing (U1), removing a number
// takes an explicit, confirmed control that is the only sender of a null number (U2), and the other
// inline editors keep their blank-save behaviour (U3).
//
// NO RENDERER EXISTS in this repo (no jsdom, no testing-library), so the page is checked the way
// `loyalty.test.ts` checks it: over the SOURCE, with the TypeScript compiler API. U1 and U3 go one
// step further than an AST match — they extract the `onSave` callback handed to a
// `LoyaltyInlineText`, transpile it, and EXECUTE it against recording stubs, so the assertion is
// about what the callback sends, not how it is spelled. Any identifier the callback reaches for that
// the test did not stub fails the run by name, so a restructure cannot pass by referencing something
// the harness silently ignored.
//
// Every checker is also run against fabricated violating sources and a clean one, so a checker that
// matches nothing cannot pass the real tree by accident. Every member number and name below is
// fabricated and carries `ZQ42A`.

import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';
import { describe, expect, it } from 'vitest';

const WEB = fileURLToPath(new URL('..', import.meta.url));
const rel = (f: string) => relative(WEB, f).split('\\').join('/');
const read = (f: string) => readFileSync(join(WEB, f), 'utf8');
const LINE_FILE = 'components/LoyaltyMembershipLine.tsx';

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

/** Every page-side file the clear-control rules cover: all of `components/` and `app/travel/`. */
const PAGE_FILES = [...filesUnder('components'), ...filesUnder('app/travel')].filter((f) => !/\.test\.tsx?$/.test(f));

type Src = { file: string; text: string };
const realSources = (): Src[] => PAGE_FILES.map((file) => ({ file, text: read(file) }));

// ─── The extraction harness ─────────────────────────────────────────────────────────────────────

type FnNode = ts.ArrowFunction | ts.FunctionExpression | ts.FunctionDeclaration;
const isFn = (n: ts.Node): n is FnNode => ts.isArrowFunction(n) || ts.isFunctionExpression(n) || ts.isFunctionDeclaration(n);

function jsxAttrs(n: ts.Node): ts.JsxAttributes | undefined {
  if (ts.isJsxSelfClosingElement(n) || ts.isJsxOpeningElement(n)) return n.attributes;
  return undefined;
}
function attr(n: ts.Node, name: string): ts.JsxAttribute | undefined {
  return jsxAttrs(n)?.properties.find((p): p is ts.JsxAttribute => ts.isJsxAttribute(p) && p.name.getText() === name);
}
function stringAttr(n: ts.Node, name: string): string | undefined {
  const a = attr(n, name);
  return a?.initializer && ts.isStringLiteral(a.initializer) ? a.initializer.text : undefined;
}
const tagName = (n: ts.JsxSelfClosingElement | ts.JsxOpeningElement) => n.tagName.getText();

/** The `onSave` expression of the `LoyaltyInlineText` with the given `label`; exactly one must exist. */
function onSaveOf(file: string, text: string, label: string): FnNode {
  const sf = parseText(file, text);
  const found: ts.Expression[] = [];
  walk(sf, (n) => {
    if (!(ts.isJsxSelfClosingElement(n) || ts.isJsxOpeningElement(n)) || tagName(n) !== 'LoyaltyInlineText') return;
    if (stringAttr(n, 'label') !== label) return;
    const a = attr(n, 'onSave');
    if (a?.initializer && ts.isJsxExpression(a.initializer) && a.initializer.expression) found.push(a.initializer.expression);
  });
  if (found.length !== 1) throw new Error(`expected one LoyaltyInlineText labelled "${label}" with an onSave, found ${found.length}`);
  const e = found[0];
  if (!isFn(e)) throw new Error(`the onSave of "${label}" is not an inline function`);
  return e;
}

/** Inside a type annotation, where an identifier is a type name and never a runtime reference. */
function inType(n: ts.Node): boolean {
  for (let p: ts.Node | undefined = n.parent; p; p = p.parent) if (ts.isTypeNode(p)) return true;
  return false;
}

/** The identifiers a function reads from its enclosing scope (not its own bindings, not property names). */
function freeIdentifiers(fn: ts.Node): string[] {
  const bound = new Set<string>();
  walk(fn, (n) => {
    if ((ts.isParameter(n) || ts.isVariableDeclaration(n) || ts.isBindingElement(n)) && ts.isIdentifier(n.name)) bound.add(n.name.text);
    if (ts.isFunctionDeclaration(n) && n.name && n !== fn) bound.add(n.name.text);
  });
  const free = new Set<string>();
  walk(fn, (n) => {
    if (!ts.isIdentifier(n) || inType(n)) return;
    const p = n.parent;
    if (ts.isPropertyAccessExpression(p) && p.name === n) return;
    if (ts.isPropertyAssignment(p) && p.name === n) return;
    if ((ts.isParameter(p) || ts.isVariableDeclaration(p) || ts.isBindingElement(p) || ts.isFunctionDeclaration(p)) && p.name === n) return;
    if (bound.has(n.text)) return;
    free.add(n.text);
  });
  return [...free].sort();
}

/** Turns a TS function's text into a callable, with exactly the given names in scope. */
function compile(fnText: string, scope: Record<string, unknown>): (...a: unknown[]) => unknown {
  const js = ts.transpileModule(`const __f = ${fnText};`, {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext, jsx: ts.JsxEmit.Preserve },
  }).outputText.replace(/^export \{\};?\s*$/m, '');
  const names = Object.keys(scope);
  return new Function(...names, `${js}\nreturn __f;`)(...names.map((k) => scope[k])) as (...a: unknown[]) => unknown;
}

/** The component's own `const <name> = (…) => …` helper, compiled — so a stub is the real thing. */
function componentHelper(text: string, name: string): ((...a: unknown[]) => unknown) | undefined {
  const sf = parseText('h.tsx', text);
  let init: ts.Expression | undefined;
  walk(sf, (n) => {
    if (ts.isVariableDeclaration(n) && ts.isIdentifier(n.name) && n.name.text === name && n.initializer && isFn(n.initializer)) init = n.initializer;
  });
  return init ? compile(init.getText(sf), {}) : undefined;
}

type Request = { method: string; path: string; body: Record<string, unknown> };
const GLOBALS = new Set(['Promise', 'undefined']);
const MEMBERSHIP = { id: 7, memberId: 3, memberNumberMasked: '••••0001', tier: null, memberDisplayName: 'ZQ42AAnna' };

/**
 * Runs one extracted callback on one draft. `patch` and `send` record every request (the body is
 * copied through JSON, as `send` itself does, so a null stays a null). `blankIsNull` is the
 * component's own helper. Any other free identifier fails the run, naming it.
 */
async function runSave(fn: FnNode, helperSource: string, draft: string): Promise<{ result: unknown; requests: Request[] }> {
  const requests: Request[] = [];
  const copy = (b: unknown) => JSON.parse(JSON.stringify(b)) as Record<string, unknown>;
  const real = componentHelper(helperSource, 'blankIsNull') ?? componentHelper(read(LINE_FILE), 'blankIsNull');
  const stubs: Record<string, unknown> = {
    patch: async (path: string, body: unknown) => { requests.push({ method: 'PATCH', path, body: copy(body) }); return null; },
    send: async (method: string, path: string, body: unknown) => { requests.push({ method, path, body: copy(body) }); return { ok: true }; },
    m: MEMBERSHIP,
    blankIsNull: real,
    router: { refresh() {} },
  };
  const scope: Record<string, unknown> = {};
  for (const name of freeIdentifiers(fn)) {
    if (GLOBALS.has(name)) continue;
    if (!(name in stubs) || stubs[name] === undefined) throw new Error(`unresolved identifier: ${name}`);
    scope[name] = stubs[name];
  }
  const callable = compile(fn.getText(fn.getSourceFile()), scope);
  const result = await callable(draft);
  return { result, requests };
}

const EMPTY_DRAFTS = ['', '   ', '\t\n', '\u00a0\u00a0'];
const NUMBER = 'ZQ42A-NUM-0001';
const FILLED_DRAFTS = [NUMBER, `  ${NUMBER} `];

/** Every way the member-number `onSave` in `text` breaks the N1 rule; empty when it holds. */
async function memberNumberSaveProblems(file: string, text: string): Promise<string[]> {
  const fn = onSaveOf(file, text, 'member number');
  const out: string[] = [];
  for (const draft of EMPTY_DRAFTS) {
    const r = await runSave(fn, text, draft);
    if (r.requests.length !== 0) out.push(`${JSON.stringify(draft)}: ${r.requests.length} request(s)`);
    if (r.result !== null) out.push(`${JSON.stringify(draft)}: resolved ${JSON.stringify(r.result)}, not null`);
  }
  for (const draft of FILLED_DRAFTS) {
    const r = await runSave(fn, text, draft);
    if (r.requests.length !== 1) { out.push(`${JSON.stringify(draft)}: ${r.requests.length} requests, not 1`); continue; }
    const [q] = r.requests;
    const keys = Object.keys(q.body);
    if (q.method !== 'PATCH' || !q.path.endsWith(`/memberships/${MEMBERSHIP.id}`)) out.push(`${JSON.stringify(draft)}: ${q.method} ${q.path}`);
    if (keys.length !== 1 || keys[0] !== 'memberNumber') out.push(`${JSON.stringify(draft)}: body keys ${keys.join(',')}`);
    const v = q.body.memberNumber;
    if (typeof v !== 'string' || v.trim() !== NUMBER) out.push(`${JSON.stringify(draft)}: memberNumber ${JSON.stringify(v)}`);
  }
  return out;
}

/** A fabricated membership line with the given member-number `onSave` and the real helper. */
const fakeLine = (onSave: string, extra = '') =>
  `'use client';\nexport default function L({ m }) {\n  const blankIsNull = (text) => (text.trim() === '' ? null : text);\n` +
  `  return <span><LoyaltyInlineText value={m.memberNumberMasked} placeholder="No number" label="member number" startEmpty mono onSave={${onSave}} />${extra}</span>;\n}\n`;

// ─── U1 ─────────────────────────────────────────────────────────────────────────────────────────

describe('the member-number editor (N1)', () => {
  it('T42a2-U1: an empty or whitespace-only save sends nothing and closes; a non-empty save sends one PATCH of the number', async () => {
    const text = read(LINE_FILE);
    const fn = onSaveOf(LINE_FILE, text, 'member number');
    expect(await memberNumberSaveProblems(LINE_FILE, text)).toEqual([]);
    // Stated directly as well as through the checker, so the expected values are visible here.
    for (const draft of EMPTY_DRAFTS) {
      const r = await runSave(fn, text, draft);
      expect(r.requests, JSON.stringify(draft)).toEqual([]);
      expect(r.result).toBeNull();
    }
    for (const draft of FILLED_DRAFTS) {
      const r = await runSave(fn, text, draft);
      expect(r.requests).toHaveLength(1);
      expect(r.requests[0].path).toBe(`/api/v1/loyalty/memberships/${MEMBERSHIP.id}`);
      expect(Object.keys(r.requests[0].body)).toEqual(['memberNumber']);
      expect((r.requests[0].body.memberNumber as string).trim()).toBe(NUMBER);
      expect(Object.values(r.requests[0].body)).not.toContain(null);
    }

    // The harness is not blind: each fabricated violation is seen to SEND, and the checker rejects it.
    const path = '`/api/v1/loyalty/memberships/${m.id}`';
    const preChange = fakeLine(`(t) => patch(${path}, { memberNumber: blankIsNull(t) })`);
    const unguarded = fakeLine(`(t) => patch(${path}, { memberNumber: t })`);
    const untrimmed = fakeLine(`(t) => (t.length === 0 ? Promise.resolve(null) : patch(${path}, { memberNumber: t }))`);
    const fnOf = (s: string) => onSaveOf('f.tsx', s, 'member number');
    const a = await runSave(fnOf(preChange), preChange, '');
    expect(a.requests).toEqual([{ method: 'PATCH', path: `/api/v1/loyalty/memberships/${MEMBERSHIP.id}`, body: { memberNumber: null } }]);
    const b1 = await runSave(fnOf(unguarded), unguarded, '');
    const b2 = await runSave(fnOf(unguarded), unguarded, '   ');
    expect(b1.requests.length).toBeGreaterThanOrEqual(1);
    expect(b2.requests.length).toBeGreaterThanOrEqual(1);
    const c = await runSave(fnOf(untrimmed), untrimmed, '   ');
    expect(c.requests.length).toBeGreaterThanOrEqual(1);
    for (const bad of [preChange, unguarded, untrimmed]) expect((await memberNumberSaveProblems('f.tsx', bad)).length).toBeGreaterThan(0);
    // A clean fabricated guard passes, so the checker is not rejecting everything.
    const clean = fakeLine(`(t) => (t.trim() === '' ? Promise.resolve(null) : patch(${path}, { memberNumber: t }))`);
    expect(await memberNumberSaveProblems('f.tsx', clean)).toEqual([]);
    // An identifier the harness has no stub for fails by name rather than being ignored.
    const unknown = fakeLine(`(t) => (t.trim() === '' ? Promise.resolve(null) : sendLater(${path}, { memberNumber: t }))`);
    await expect(memberNumberSaveProblems('f.tsx', unknown)).rejects.toThrow('unresolved identifier: sendLater');
  });
});

// ─── U2 ─────────────────────────────────────────────────────────────────────────────────────────

/**
 * The text a person sees or hears for an element: its aria-label, its own text, and the string
 * literals in its own `{…}` children. Nested elements are NOT included — otherwise the `<li>` around
 * the control would itself count as a "Remove number" element, ungated.
 */
function elementLabel(el: ts.JsxElement | ts.JsxSelfClosingElement): string {
  const opening = ts.isJsxElement(el) ? el.openingElement : el;
  const parts = [stringAttr(opening, 'aria-label') ?? ''];
  const literals = (n: ts.Node): void => {
    if (ts.isJsxElement(n) || ts.isJsxSelfClosingElement(n) || ts.isJsxFragment(n)) return;
    if (ts.isStringLiteral(n) || ts.isNoSubstitutionTemplateLiteral(n)) parts.push(n.text);
    ts.forEachChild(n, literals);
  };
  if (ts.isJsxElement(el)) {
    for (const child of el.children) {
      if (ts.isJsxText(child)) parts.push(child.text);
      else if (ts.isJsxExpression(child)) literals(child);
    }
  }
  return parts.join(' ');
}

/** The function an `on…` attribute runs: the inline function, or the same-file function it names. */
function handlerOf(sf: ts.SourceFile, a: ts.JsxAttribute): ts.Node | undefined {
  if (!a.initializer || !ts.isJsxExpression(a.initializer) || !a.initializer.expression) return undefined;
  const e = a.initializer.expression;
  if (!ts.isIdentifier(e)) return e;
  let target: ts.Node | undefined;
  walk(sf, (n) => {
    if (ts.isFunctionDeclaration(n) && n.name?.text === e.text) target = n;
    if (ts.isVariableDeclaration(n) && ts.isIdentifier(n.name) && n.name.text === e.text && n.initializer && isFn(n.initializer)) target = n.initializer;
  });
  return target;
}
const contains = (outer: ts.Node, inner: ts.Node) => inner.pos >= outer.pos && inner.end <= outer.end;
const elementsOf = (sf: ts.SourceFile) => {
  const out: (ts.JsxElement | ts.JsxSelfClosingElement)[] = [];
  walk(sf, (n) => { if (ts.isJsxElement(n) || ts.isJsxSelfClosingElement(n)) out.push(n); });
  return out;
};
const openingOf = (el: ts.JsxElement | ts.JsxSelfClosingElement) => (ts.isJsxElement(el) ? el.openingElement : el);
const handlerAttrs = (el: ts.JsxElement | ts.JsxSelfClosingElement) =>
  openingOf(el).attributes.properties.filter((p): p is ts.JsxAttribute => ts.isJsxAttribute(p) && /^on[A-Z]/.test(p.name.getText()));

const HAS_NUMBER = /memberNumberMasked\s*!==?\s*null/;
/** True when the element renders only behind a "the membership has a number" condition. */
function gatedOnNumber(el: ts.Node): boolean {
  for (let p: ts.Node | undefined = el.parent; p; p = p.parent) {
    if (ts.isBinaryExpression(p) && p.operatorToken.kind === ts.SyntaxKind.AmpersandAmpersandToken
      && HAS_NUMBER.test(p.left.getText()) && contains(p.right, el)) return true;
    if (ts.isConditionalExpression(p) && HAS_NUMBER.test(p.condition.getText()) && contains(p.whenTrue, el)) return true;
  }
  return false;
}

const unwrap = (e: ts.Expression): ts.Expression => (ts.isParenthesizedExpression(e) ? unwrap(e.expression) : e);
const isMemberNumberProp = (n: ts.Node): n is ts.PropertyAssignment =>
  ts.isPropertyAssignment(n) && (ts.isIdentifier(n.name) || ts.isStringLiteral(n.name)) && n.name.text === 'memberNumber';

/** Every way the sources break the "one confirmed control is the only null sender" rule. */
function clearControlProblems(sources: Src[]): string[] {
  const out: string[] = [];
  const nulls: { file: string; sf: ts.SourceFile; prop: ts.PropertyAssignment }[] = [];
  const parsed = sources.map((s) => ({ ...s, sf: parseText(s.file, s.text) }));
  for (const { file, sf } of parsed) {
    walk(sf, (n) => {
      if (isMemberNumberProp(n) && unwrap(n.initializer).kind === ts.SyntaxKind.NullKeyword) nulls.push({ file, sf, prop: n });
      // (2) A PATCH body's memberNumber is never computed by a conditional, a fallback or blankIsNull.
      if (ts.isCallExpression(n)) {
        const callee = n.expression.getText(sf);
        const isPatch = callee === 'patch' || (callee === 'send' && n.arguments[0] !== undefined && ts.isStringLiteral(n.arguments[0]) && n.arguments[0].text === 'PATCH');
        if (!isPatch) return;
        for (const arg of n.arguments) {
          if (!ts.isObjectLiteralExpression(arg)) continue;
          for (const p of arg.properties) {
            if (!isMemberNumberProp(p)) continue;
            const init = unwrap(p.initializer);
            const op = ts.isBinaryExpression(init) ? init.operatorToken.kind : undefined;
            if (ts.isConditionalExpression(init) || op === ts.SyntaxKind.QuestionQuestionToken || op === ts.SyntaxKind.BarBarToken
              || (ts.isCallExpression(init) && init.expression.getText(sf) === 'blankIsNull')) {
              out.push(`${file}: memberNumber in a PATCH body is computed (${init.getText(sf)})`);
            }
          }
        }
      }
    });
    // (4) The full-number route is named by the copy action's file alone.
    if (file !== 'components/LoyaltyCopyNumber.tsx' && sf.text.includes('/member-number')) out.push(`${file}: names /member-number`);
  }
  // (1) Exactly one null literal for memberNumber, inside an event handler.
  if (nulls.length !== 1) { out.push(`memberNumber: null appears ${nulls.length} times, not once`); return out; }
  const { file, sf, prop } = nulls[0];
  let nullFn: ts.Node | undefined = prop.parent;
  while (nullFn && !isFn(nullFn)) nullFn = nullFn.parent;
  if (!nullFn) { out.push(`${file}: memberNumber: null outside a function`); return out; }
  if (nullFn.getText(sf).includes('/member-number')) out.push(`${file}: the null handler names /member-number`);
  const nullName = ts.isFunctionDeclaration(nullFn) ? nullFn.name?.text
    : ts.isVariableDeclaration(nullFn.parent) ? nullFn.parent.name.getText(sf) : undefined;
  const elements = elementsOf(sf);
  const attachedTo = elements.filter((el) => handlerAttrs(el).some((a) => handlerOf(sf, a) === nullFn));
  if (attachedTo.length === 0) out.push(`${file}: memberNumber: null is not in a JSX event handler`);
  for (const el of attachedTo) {
    if (!elementLabel(el).includes('Confirm')) out.push(`${file}: the null handler is attached to "${elementLabel(el).trim()}", not a Confirm`);
  }
  // (3) "Remove number" exists, only when there is a number, and its own tap does not send.
  const removers = parsed.flatMap((p) => elementsOf(p.sf).filter((el) => elementLabel(el).includes('Remove number')).map((el) => ({ ...p, el })));
  if (removers.length === 0) out.push('no element labelled "Remove number"');
  for (const r of removers) {
    if (!gatedOnNumber(r.el)) out.push(`${r.file}: "Remove number" renders without a stored number`);
    for (const a of handlerAttrs(r.el)) {
      const h = handlerOf(r.sf, a);
      if (h === undefined) continue;
      if (h === nullFn || (r.sf === sf && contains(h, prop))) out.push(`${r.file}: "Remove number" itself sends the null`);
      else if (nullName !== undefined && r.sf === sf && new RegExp(`\\b${nullName}\\s*\\(`).test(h.getText(r.sf))) {
        out.push(`${r.file}: "Remove number" calls the null handler directly`);
      }
    }
  }
  return out;
}

/** A fabricated membership line with a Remove-number control; each argument swaps in a violation. */
function fakeClear({ removeClick = '() => setAsking(true)', keepClick = '() => setAsking(false)', gate = 'm.memberNumberMasked !== null && ', body = '{ memberNumber: null }' } = {}): Src {
  return {
    file: 'components/FakeLine.tsx',
    text: `'use client';
import { useState } from 'react';
export default function L({ m }) {
  const [asking, setAsking] = useState(false);
  async function patch(path, body) { return null; }
  async function removeNumber() { await patch(\`/api/v1/loyalty/memberships/\${m.id}\`, ${body}); }
  return (
    <span>
      {${gate}(asking ? (
        <span>
          <button type="button" onClick={removeNumber} aria-label="Confirm removing the member number">Confirm</button>
          <button type="button" onClick={${keepClick}}>Keep</button>
        </span>
      ) : (
        <button type="button" onClick={${removeClick}}>Remove number</button>
      ))}
    </span>
  );
}
`,
  };
}

describe('the explicit clear control (N1)', () => {
  it('T42a2-U2: "Remove number" exists only for a stored number, asks first, and its Confirm is the only sender of a null number', () => {
    expect(PAGE_FILES).toContain(LINE_FILE);
    expect(PAGE_FILES.length).toBeGreaterThanOrEqual(10);
    expect(clearControlProblems(realSources())).toEqual([]);
    // The line itself, stated directly: the confirmed handler is the one named on Confirm.
    const line = read(LINE_FILE);
    expect(line).toMatch(/onClick=\{removeNumber\}/);
    expect(line).not.toMatch(/memberNumber:\s*blankIsNull/);

    // Each checker on fabricated sources: the clean one passes, every violation is rejected.
    expect(clearControlProblems([fakeClear()])).toEqual([]);
    const oneTap = fakeClear({ removeClick: `() => patch(\`/api/v1/loyalty/memberships/\${m.id}\`, { memberNumber: null })`, body: '{ memberNumber: undefined }' });
    expect(clearControlProblems([oneTap]).join('\n')).toMatch(/not a Confirm|itself sends/);
    const callsThrough = fakeClear({ removeClick: '() => removeNumber()' });
    expect(clearControlProblems([callsThrough]).join('\n')).toMatch(/calls the null handler/);
    const secondNull = fakeClear({ keepClick: `() => patch(\`/api/v1/loyalty/memberships/\${m.id}\`, { memberNumber: null })` });
    expect(clearControlProblems([secondNull]).join('\n')).toMatch(/appears 2 times/);
    const unconditional = fakeClear({ gate: '' });
    expect(clearControlProblems([unconditional]).join('\n')).toMatch(/renders without a stored number/);
    const viaBlank = { file: 'components/FakeBlank.tsx', text: `'use client';\nexport function B({ m, t }) { return <button onClick={() => patch('/x', { memberNumber: blankIsNull(t) })}>Save</button>; }\n` };
    expect(clearControlProblems([fakeClear(), viaBlank]).join('\n')).toMatch(/computed \(blankIsNull\(t\)\)/);
    const viaFallback = { file: 'components/FakeOr.tsx', text: `'use client';\nexport function B({ t }) { return <button onClick={() => send('PATCH', '/x', { memberNumber: t || undefined })}>Save</button>; }\n` };
    expect(clearControlProblems([fakeClear(), viaFallback]).join('\n')).toMatch(/computed/);
    const routeNamed = { file: 'components/FakeRoute.tsx', text: `export const p = '/api/v1/loyalty/memberships/1/member-number';\n` };
    expect(clearControlProblems([fakeClear(), routeNamed]).join('\n')).toMatch(/names \/member-number/);
    expect(clearControlProblems([{ file: 'components/Empty.tsx', text: 'export const x = 1;\n' }]).join('\n')).toMatch(/appears 0 times/);
  });
});

// ─── U3 ─────────────────────────────────────────────────────────────────────────────────────────

/** Every way the sources break "startEmpty has one user: the member-number editor". */
function startEmptyProblems(sources: Src[]): string[] {
  const out: string[] = [];
  const users: string[] = [];
  let numberEditors = 0;
  for (const { file, text } of sources) {
    const sf = parseText(file, text);
    walk(sf, (n) => {
      if (!(ts.isJsxSelfClosingElement(n) || ts.isJsxOpeningElement(n))) return;
      const a = attr(n, 'startEmpty');
      // A bare attribute or `={true}` is on; `={false}` or anything else is not a startEmpty user.
      const on = a !== undefined && (a.initializer === undefined
        || (ts.isJsxExpression(a.initializer) && a.initializer.expression?.kind === ts.SyntaxKind.TrueKeyword));
      const isNumberEditor = tagName(n) === 'LoyaltyInlineText' && stringAttr(n, 'label') === 'member number';
      if (isNumberEditor) {
        numberEditors++;
        if (!on) out.push(`${file}: the member-number editor is not startEmpty, so it would be pre-filled with the mask`);
      }
      if (a !== undefined) users.push(`${file}:${isNumberEditor ? 'member number' : stringAttr(n, 'label') ?? tagName(n)}`);
    });
  }
  if (numberEditors !== 1) out.push(`${numberEditors} member-number editors, not 1`);
  if (users.length !== 1 || !users[0].endsWith(':member number')) out.push(`startEmpty users: ${users.join(', ') || 'none'}`);
  return out;
}

describe('the other inline editors (N1 scope)', () => {
  it('T42a2-U3: tier and name editors keep their blank-save behaviour, and startEmpty has exactly one user', async () => {
    const text = read(LINE_FILE);
    const tier = onSaveOf(LINE_FILE, text, 'tier');
    for (const draft of ['', '   ']) {
      const r = await runSave(tier, text, draft);
      expect(r.requests).toEqual([{ method: 'PATCH', path: `/api/v1/loyalty/memberships/${MEMBERSHIP.id}`, body: { tier: null } }]);
    }
    expect((await runSave(tier, text, 'ZQ42A Gold')).requests).toEqual([
      { method: 'PATCH', path: `/api/v1/loyalty/memberships/${MEMBERSHIP.id}`, body: { tier: 'ZQ42A Gold' } },
    ]);
    const name = onSaveOf(LINE_FILE, text, 'member name');
    expect((await runSave(name, text, 'ZQ42ABea')).requests).toEqual([
      { method: 'PATCH', path: `/api/v1/loyalty/members/${MEMBERSHIP.memberId}`, body: { displayName: 'ZQ42ABea' } },
    ]);

    expect(startEmptyProblems(realSources())).toEqual([]);
    // The editor still defaults startEmpty off and pre-fills the current value when it is off.
    const inline = read('components/LoyaltyInlineText.tsx');
    expect(inline).toMatch(/startEmpty = false/);
    expect(inline).toMatch(/setDraft\(startEmpty \? '' : value \?\? ''\)/);

    // Fabricated violations: a second startEmpty user; a member-number editor without it (pre-filled).
    const ok = { file: 'components/A.tsx', text: '<LoyaltyInlineText label="member number" startEmpty onSave={(t) => null} />' };
    expect(startEmptyProblems([ok])).toEqual([]);
    const second = { file: 'components/B.tsx', text: '<LoyaltyInlineText label="tier" startEmpty onSave={(t) => null} />' };
    expect(startEmptyProblems([ok, second]).join('\n')).toMatch(/startEmpty users/);
    const prefilled = { file: 'components/A.tsx', text: '<LoyaltyInlineText label="member number" onSave={(t) => null} />' };
    expect(startEmptyProblems([prefilled]).join('\n')).toMatch(/pre-filled with the mask/);
    const off = { file: 'components/A.tsx', text: '<LoyaltyInlineText label="member number" startEmpty={false} onSave={(t) => null} />' };
    expect(startEmptyProblems([off]).join('\n')).toMatch(/pre-filled with the mask/);
  });
});
