// P6-40d — the enriched rows are wired the way the pure tests assume they are.
//
// `enrichedDisplay.test.ts` proves `safeLogoUrl` refuses a `javascript:` URL. That proves nothing
// about the page if a row writes `src={t.logo_url}` beside it, or a phone-only branch renders a
// second `img` the sanitiser never sees. Those are properties of the components' SOURCE, and this
// repo has no component-test environment (vitest is node-only, on purpose), so they are asserted
// over the TSX's AST with the TypeScript compiler API.
//
// AN AST, NOT A GREP (BUILD.md A10). A comment reading "src comes from safeLogoUrl" satisfies a
// substring search and proves nothing; here a `src` passes only if its expression IS a call to
// `safeLogoUrl`, or an identifier every declaration of which is initialised from one.
//
// Every checker below is also run against small fabricated sources that break the rule, so a
// checker that silently matches nothing cannot pass the real files by accident.

import { readdirSync, readFileSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';
import { describe, expect, it } from 'vitest';

const WEB = fileURLToPath(new URL('..', import.meta.url));
const STATEMENT = join(WEB, 'components/AccountStatementList.tsx');
const TABLE = join(WEB, 'components/TransactionTable.tsx');
const ROW_COMPONENTS = [STATEMENT, TABLE];
const ACCOUNT_PAGE = join(WEB, 'app/accounts/[id]/page.tsx');
const TX_PAGE = join(WEB, 'app/transactions/page.tsx');
const ENRICHMENT_FIELDS = ['logo_url', 'authorized_date', 'location_city', 'location_region'];

function parseText(file: string, text: string): ts.SourceFile {
  return ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
}
const parse = (file: string) => parseText(file, readFileSync(file, 'utf8'));

function walk(node: ts.Node, visit: (n: ts.Node) => void): void {
  visit(node);
  ts.forEachChild(node, (c) => walk(c, visit));
}

type JsxOpening = ts.JsxOpeningElement | ts.JsxSelfClosingElement;

function jsxElements(sf: ts.SourceFile, name?: string): JsxOpening[] {
  const out: JsxOpening[] = [];
  walk(sf, (n) => {
    if ((ts.isJsxOpeningElement(n) || ts.isJsxSelfClosingElement(n)) && (name === undefined || n.tagName.getText(sf) === name)) {
      out.push(n);
    }
  });
  return out;
}

function attr(el: JsxOpening, name: string): ts.JsxAttribute | undefined {
  return el.attributes.properties.find(
    (p): p is ts.JsxAttribute => ts.isJsxAttribute(p) && p.name.getText() === name,
  );
}

/** An attribute's value expression: `{x}` gives x, `"x"` gives the string literal. */
function attrExpr(a: ts.JsxAttribute | undefined): ts.Expression | undefined {
  const init = a?.initializer;
  if (!init) return undefined;
  if (ts.isStringLiteral(init)) return init;
  if (ts.isJsxExpression(init)) return init.expression;
  return undefined;
}

function isCallTo(node: ts.Node | undefined, fn: string): node is ts.CallExpression {
  return !!node && ts.isCallExpression(node) && ts.isIdentifier(node.expression) && node.expression.text === fn;
}

/**
 * Whether an `img`'s `src` (or another URL attribute) is the sanitiser's output: a direct
 * `safeLogoUrl(...)` call, or an identifier that is declared in this file and EVERY declaration of
 * which is initialised from one — so a second, shadowing `const src = t.logo_url` in a mobile-only
 * branch fails.
 */
function srcIsSanitised(sf: ts.SourceFile, el: JsxOpening, name = 'src'): boolean {
  const expr = attrExpr(attr(el, name));
  if (!expr) return false;
  if (isCallTo(expr, 'safeLogoUrl')) return true;
  if (!ts.isIdentifier(expr)) return false;
  const decls: ts.VariableDeclaration[] = [];
  walk(sf, (n) => {
    if (ts.isVariableDeclaration(n) && ts.isIdentifier(n.name) && n.name.text === expr.text) decls.push(n);
  });
  // A parameter of that name would be fed from outside the file; refuse it.
  let isParam = false;
  walk(sf, (n) => {
    if (ts.isParameter(n) && ts.isIdentifier(n.name) && n.name.text === expr.text) isParam = true;
    if (ts.isBindingElement(n) && ts.isIdentifier(n.name) && n.name.text === expr.text) isParam = true;
  });
  return !isParam && decls.length > 0 && decls.every((d) => isCallTo(d.initializer, 'safeLogoUrl'));
}

/**
 * Every `img` / `Image` element that could fetch something other than the sanitiser's output:
 * a `src` not from `safeLogoUrl`; a `srcSet`/`srcset` present and not from it either (a second
 * URL the browser may prefer over `src`); a spread attribute (which can carry any `src` or
 * `srcSet` past this check unseen); or a `style` that mentions a logo field or a URL (a
 * `background-image: url(...)` fetches just as `src` does).
 */
function unsanitisedImages(sf: ts.SourceFile): string[] {
  return [...jsxElements(sf, 'img'), ...jsxElements(sf, 'Image')]
    .filter((el) => {
      if (!srcIsSanitised(sf, el)) return true;
      for (const name of ['srcSet', 'srcset']) {
        if (attr(el, name) !== undefined && !srcIsSanitised(sf, el, name)) return true;
      }
      if (el.attributes.properties.some(ts.isJsxSpreadAttribute)) return true;
      const style = attr(el, 'style');
      let styleMentionsLogo = false;
      if (style?.initializer) {
        walk(style.initializer, (m) => {
          if ((ts.isIdentifier(m) || ts.isStringLiteralLike(m) || ts.isTemplateLiteralToken(m)) && /logo|url|src/i.test(m.text)) {
            styleMentionsLogo = true;
          }
        });
      }
      return styleMentionsLogo;
    })
    .map((el) => el.getText(sf).slice(0, 80));
}

/** Every `x.add(...)` call outside an `onError` attribute — a failure recorded on a guess. */
function addsOutsideOnError(sf: ts.SourceFile): string[] {
  const out: string[] = [];
  walk(sf, (n) => {
    if (!ts.isCallExpression(n) || !ts.isPropertyAccessExpression(n.expression) || n.expression.name.text !== 'add') return;
    for (let p: ts.Node | undefined = n.parent; p; p = p.parent) {
      if (ts.isJsxAttribute(p) && p.name.getText(sf) === 'onError') return;
    }
    out.push(n.getText(sf).slice(0, 60));
  });
  return out;
}

/** Every `naturalWidth` read that is not exactly `naturalWidth > 0` — zero pixels is not failure. */
function naturalWidthGuesses(sf: ts.SourceFile): string[] {
  const out: string[] = [];
  walk(sf, (n) => {
    if (!ts.isPropertyAccessExpression(n) || n.name.text !== 'naturalWidth') return;
    const b = n.parent;
    const ok = ts.isBinaryExpression(b) && b.left === n && b.operatorToken.kind === ts.SyntaxKind.GreaterThanToken
      && ts.isNumericLiteral(b.right) && b.right.text === '0';
    if (!ok) out.push(b.getText(sf).slice(0, 60));
  });
  return out;
}

/** Whether `node` sits under a `?:`, `&&`, `||` or `??` before reaching `stop` — rendered only sometimes. */
function conditionalBetween(node: ts.Node, stop: ts.Node): boolean {
  const shortCircuits = [ts.SyntaxKind.AmpersandAmpersandToken, ts.SyntaxKind.BarBarToken, ts.SyntaxKind.QuestionQuestionToken];
  for (let p: ts.Node | undefined = node.parent; p && p !== stop; p = p.parent) {
    if (ts.isConditionalExpression(p)) return true;
    if (ts.isBinaryExpression(p) && shortCircuits.includes(p.operatorToken.kind)) return true;
  }
  return false;
}

function isAncestor(ancestor: ts.Node, node: ts.Node): boolean {
  for (let p: ts.Node | undefined = node.parent; p; p = p.parent) if (p === ancestor) return true;
  return false;
}

/**
 * Violations of "the tile is always the box, and the logo is invisible until it loads" (F1):
 * - the placeholder initial is rendered inside an element that is not itself conditional within
 *   its `return`, and every `img` sits inside that element — laid over the tile, not instead of it;
 * - every `img` has an `onLoad`, and its `className` carries a hiding class (`opacity-0` or
 *   `invisible`) in some fragment: the state it is in until `onLoad` says otherwise.
 * The first version (img OR tile, img visible while loading) fails all of these.
 */
function visibleBeforeLoad(sf: ts.SourceFile): string[] {
  const out: string[] = [];
  const initialNames = new Set<string>();
  walk(sf, (n) => {
    if (ts.isVariableDeclaration(n) && ts.isIdentifier(n.name) && isCallTo(n.initializer, 'placeholderInitial')) initialNames.add(n.name.text);
  });
  const tiles: ts.JsxElement[] = [];
  walk(sf, (n) => {
    if (!ts.isJsxExpression(n) || !n.expression || !ts.isJsxElement(n.parent)) return;
    const e = n.expression;
    if (!(isCallTo(e, 'placeholderInitial') || (ts.isIdentifier(e) && initialNames.has(e.text)))) return;
    let ret: ts.Node | undefined = n.parent;
    while (ret && !ts.isReturnStatement(ret)) ret = ret.parent;
    if (ret && !conditionalBetween(n.parent, ret)) tiles.push(n.parent);
  });
  if (tiles.length === 0) out.push('no unconditionally rendered tile carries the placeholder initial');
  for (const img of jsxElements(sf, 'img')) {
    const label = img.getText(sf).slice(0, 60);
    if (!tiles.some((t) => isAncestor(t, img))) out.push(`img not laid over the tile: ${label}`);
    if (attr(img, 'onLoad') === undefined) out.push(`img without onLoad: ${label}`);
    let hides = false;
    const cls = attr(img, 'className')?.initializer;
    if (cls) {
      walk(cls, (m) => {
        if ((ts.isStringLiteralLike(m) || ts.isTemplateLiteralToken(m)) && /(^|\s)(opacity-0|invisible)(\s|$)/.test(m.text)) hides = true;
      });
    }
    if (!hides) out.push(`img className never hides it: ${label}`);
  }
  return out;
}

/** Every `img` missing `referrerPolicy="no-referrer"` or an `onError`. */
function leakyImages(sf: ts.SourceFile): string[] {
  return [...jsxElements(sf, 'img'), ...jsxElements(sf, 'Image')]
    .filter((el) => {
      const rp = attrExpr(attr(el, 'referrerPolicy'));
      const okReferrer = !!rp && ts.isStringLiteral(rp) && rp.text === 'no-referrer';
      return !okReferrer || attr(el, 'onError') === undefined;
    })
    .map((el) => el.getText(sf).slice(0, 80));
}

function moduleSpecifiers(sf: ts.SourceFile): string[] {
  return sf.statements
    .filter(ts.isImportDeclaration)
    .map((d) => (d.moduleSpecifier as ts.StringLiteral).text);
}

/** The file an import specifier names, for this app's `@/` alias and relative imports. */
function resolveImport(fromFile: string, spec: string): string | null {
  const base = spec.startsWith('@/') ? join(WEB, spec.slice(2)) : spec.startsWith('.') ? resolve(fromFile, '..', spec) : null;
  return base === null ? null : `${base.replace(/\.tsx?$/, '')}.tsx`;
}

/** The local name a file's default import of `target` is bound to, or null. */
function defaultImportOf(sf: ts.SourceFile, file: string, target: string): string | null {
  for (const d of sf.statements.filter(ts.isImportDeclaration)) {
    const spec = (d.moduleSpecifier as ts.StringLiteral).text;
    if (resolveImport(file, spec) === target && d.importClause?.name) return d.importClause.name.text;
  }
  return null;
}

/** Whether `node` sits inside the callback of a `.map(...)` call. */
function insideMap(node: ts.Node): boolean {
  for (let n: ts.Node | undefined = node.parent; n; n = n.parent) {
    if ((ts.isArrowFunction(n) || ts.isFunctionExpression(n)) && n.parent && ts.isCallExpression(n.parent)
      && ts.isPropertyAccessExpression(n.parent.expression) && n.parent.expression.name.text === 'map') {
      return true;
    }
  }
  return false;
}

function enclosingFunction(node: ts.Node): ts.Node | undefined {
  for (let n: ts.Node | undefined = node.parent; n; n = n.parent) {
    if (ts.isArrowFunction(n) || ts.isFunctionExpression(n) || ts.isFunctionDeclaration(n)) return n;
  }
  return undefined;
}

function insideJsxExpression(node: ts.Node): boolean {
  for (let n: ts.Node | undefined = node.parent; n; n = n.parent) {
    if (ts.isJsxExpression(n)) return true;
    if (ts.isFunctionLike(n)) return false;
  }
  return false;
}

/**
 * Whether a call's result reaches rendered JSX: it is inside a `{...}` JSX expression itself, or
 * it initialises (possibly nested inside another call) a variable that is read inside one in the
 * same function.
 */
function resultIsRendered(call: ts.CallExpression): boolean {
  if (insideJsxExpression(call)) return true;
  let n: ts.Node = call;
  while (n.parent && !ts.isVariableDeclaration(n.parent) && !ts.isStatement(n.parent)) n = n.parent;
  const decl = n.parent;
  if (!decl || !ts.isVariableDeclaration(decl) || !ts.isIdentifier(decl.name)) return false;
  const name = decl.name.text;
  const fn = enclosingFunction(decl);
  if (!fn) return false;
  let rendered = false;
  walk(fn, (m) => {
    if (ts.isIdentifier(m) && m.text === name && m !== decl.name && insideJsxExpression(m)) rendered = true;
  });
  return rendered;
}

/** The property signatures of a named interface or type alias, through intersections. */
function rowTypeMembers(sf: ts.SourceFile, typeName: string): Map<string, ts.PropertySignature> {
  const members = new Map<string, ts.PropertySignature>();
  const collect = (node: ts.Node) => {
    if (ts.isTypeLiteralNode(node) || ts.isInterfaceDeclaration(node)) {
      for (const m of node.members) if (ts.isPropertySignature(m)) members.set(m.name.getText(sf), m);
    } else if (ts.isIntersectionTypeNode(node)) {
      node.types.forEach(collect);
    }
  };
  for (const s of sf.statements) {
    if (ts.isInterfaceDeclaration(s) && s.name.text === typeName) collect(s);
    if (ts.isTypeAliasDeclaration(s) && s.name.text === typeName) collect(s.type);
  }
  return members;
}

/** `string | null`, required — not optional, not `string` alone, not anything wider. */
function isRequiredNullableString(sig: ts.PropertySignature | undefined): boolean {
  if (!sig || sig.questionToken || !sig.type || !ts.isUnionTypeNode(sig.type)) return false;
  const kinds = sig.type.types.map((t) =>
    t.kind === ts.SyntaxKind.StringKeyword ? 'string'
      : ts.isLiteralTypeNode(t) && t.literal.kind === ts.SyntaxKind.NullKeyword ? 'null'
      : 'other');
  return kinds.length === 2 && kinds.includes('string') && kinds.includes('null');
}

/** Every `href` attribute whose expression mentions an enrichment field (or the website). */
function enrichmentHrefs(sf: ts.SourceFile): string[] {
  const out: string[] = [];
  walk(sf, (n) => {
    if (!ts.isJsxAttribute(n) || n.name.getText(sf) !== 'href' || !n.initializer) return;
    walk(n.initializer, (m) => {
      if (ts.isIdentifier(m) && /logo|website|authori[sz]ed|location|city|region|detail/i.test(m.text)) out.push(n.getText(sf));
    });
  });
  return out;
}

/** Every identifier, string or template fragment naming the retained raw Plaid object. */
function rawPlaidMentions(sf: ts.SourceFile): string[] {
  const out: string[] = [];
  walk(sf, (n) => {
    const text = ts.isIdentifier(n) || ts.isStringLiteralLike(n) || ts.isTemplateLiteralToken(n) ? n.text : null;
    if (text !== null && text.includes('plaid_raw')) out.push(text.slice(0, 60));
  });
  return out;
}

/** The shared mark: the one component file that imports the sanitiser. Discovered, not named. */
function discoverMarkFile(): string[] {
  const dir = join(WEB, 'components');
  const files = (readdirSync(dir, { recursive: true }) as string[])
    .filter((f) => f.endsWith('.tsx'))
    .map((f) => join(dir, f));
  return files.filter((f) => {
    const sf = parse(f);
    return sf.statements.some((s) => ts.isImportDeclaration(s)
      && /enrichedDisplay$/.test((s.moduleSpecifier as ts.StringLiteral).text)
      && s.importClause?.namedBindings && ts.isNamedImports(s.importClause.namedBindings)
      && s.importClause.namedBindings.elements.some((e) => (e.propertyName ?? e.name).text === 'safeLogoUrl'));
  });
}

const markFiles = discoverMarkFile();
const MARK = markFiles[0];

describe('the checkers catch what they are meant to (fabricated sources)', () => {
  const bad = (body: string) => parseText('fake.tsx', body);

  it('flags a src fed from the row field, a shadowed identifier, a parameter, and next/image', () => {
    expect(unsanitisedImages(bad('const C = ({ t }) => <img src={t.logo_url} />;'))).toHaveLength(1);
    expect(unsanitisedImages(bad(`
      const src = safeLogoUrl(a);
      function M(t) { const src = t.logo_url; return <img src={src} />; }`))).toHaveLength(1);
    expect(unsanitisedImages(bad('const C = ({ src }) => <img src={src} />;'))).toHaveLength(1);
    expect(unsanitisedImages(bad('const C = ({ t }) => <Image src={t.logo_url} alt="" />;'))).toHaveLength(1);
    // And passes the two allowed shapes.
    expect(unsanitisedImages(bad('const C = ({ u }) => <img src={safeLogoUrl(u)} />;'))).toEqual([]);
    // srcSet / srcset not from the sanitiser, a spread, and a style that names the logo.
    expect(unsanitisedImages(bad('const C = ({ u, t }) => <img src={safeLogoUrl(u)} srcSet={t.logo_url} />;'))).toHaveLength(1);
    expect(unsanitisedImages(bad('const C = ({ u, t }) => <img src={safeLogoUrl(u)} srcset={`${t.logo_url} 2x`} />;'))).toHaveLength(1);
    expect(unsanitisedImages(bad('const C = ({ u, p }) => <img src={safeLogoUrl(u)} {...p} />;'))).toHaveLength(1);
    expect(unsanitisedImages(bad('const C = ({ u, t }) => <img src={safeLogoUrl(u)} style={{ backgroundImage: `url(${t.logo_url})` }} />;'))).toHaveLength(1);
    expect(unsanitisedImages(bad('const C = ({ u }) => <img src={safeLogoUrl(u)} srcSet={safeLogoUrl(u)} style={{ width: 28 }} />;'))).toEqual([]);
    expect(unsanitisedImages(bad('function C({ u }) { const s = safeLogoUrl(u); return <img src={s} />; }'))).toEqual([]);
  });

  it('flags an img without no-referrer or without onError', () => {
    expect(leakyImages(bad('<img src={s} onError={f} />'))).toHaveLength(1);
    expect(leakyImages(bad('<img src={s} referrerPolicy="origin" onError={f} />'))).toHaveLength(1);
    expect(leakyImages(bad('<img src={s} referrerPolicy="no-referrer" />'))).toHaveLength(1);
    expect(leakyImages(bad('<img src={s} referrerPolicy="no-referrer" onError={f} />'))).toEqual([]);
  });

  it('flags an href built from an enrichment field, a raw-object mention, and a too-wide row type', () => {
    expect(enrichmentHrefs(bad('<a href={t.website}>x</a>'))).toHaveLength(1);
    expect(enrichmentHrefs(bad('<a href={`https://maps.example/?q=${t.location_city}`}>x</a>'))).toHaveLength(1);
    expect(enrichmentHrefs(bad('<a href={`/accounts/${t.account_id}`}>x</a>'))).toEqual([]);
    expect(rawPlaidMentions(bad('const q = `SELECT plaid_raw FROM transactions`;'))).toHaveLength(1);
    const types = bad('type R = { logo_url?: string | null; authorized_date: string; location_city: string | null | number };');
    const m = rowTypeMembers(types, 'R');
    expect(isRequiredNullableString(m.get('logo_url'))).toBe(false);
    expect(isRequiredNullableString(m.get('authorized_date'))).toBe(false);
    expect(isRequiredNullableString(m.get('location_city'))).toBe(false);
    expect(isRequiredNullableString(rowTypeMembers(bad('interface R { x: string | null }'), 'R').get('x'))).toBe(true);
  });

  it('flags an img visible before it loads, an img without onLoad, and an img instead of the tile', () => {
    const mark = (body: string) => bad(`function M({ u, n, ok }) { const s = safeLogoUrl(u); const initial = placeholderInitial(n); ${body} }`);
    // Visible while loading: no hiding class.
    expect(visibleBeforeLoad(mark('return <span>{initial}<img src={s} onLoad={f} className="size-7" /></span>;'))).toHaveLength(1);
    // No onLoad, so nothing would ever show it.
    expect(visibleBeforeLoad(mark('return <span>{initial}<img src={s} className="opacity-0" /></span>;'))).toHaveLength(1);
    // The first version's shape: the img OR the tile, never both.
    expect(visibleBeforeLoad(mark('if (s) return <img src={s} onLoad={f} className="opacity-0" />; return <span>{initial}</span>;')).length).toBeGreaterThanOrEqual(1);
    expect(visibleBeforeLoad(mark('return ok ? <img src={s} onLoad={f} className="opacity-0" /> : <span>{initial}</span>;')).length).toBeGreaterThanOrEqual(1);
    // And passes the required shape.
    expect(visibleBeforeLoad(mark("return <span>{initial}{s && <img src={s} onLoad={f} className={`a ${ok ? 'opacity-100' : 'opacity-0'}`} />}</span>;"))).toEqual([]);
  });

  it('flags a failure recorded outside onError, and a zero naturalWidth read as failure', () => {
    expect(addsOutsideOnError(bad('useEffect(() => { if (img.complete) dead.add(src); });'))).toHaveLength(1);
    expect(addsOutsideOnError(bad('const x = <img onError={() => { dead.add(src); }} />;'))).toEqual([]);
    expect(naturalWidthGuesses(bad('if (img.complete && img.naturalWidth === 0) fail();'))).toHaveLength(1);
    expect(naturalWidthGuesses(bad('if (!img.naturalWidth) fail();'))).toHaveLength(1);
    expect(naturalWidthGuesses(bad('if (img.complete && img.naturalWidth > 0) show();'))).toEqual([]);
  });

  it('flags a detail computed but never rendered', () => {
    const sf = bad('rows.map((t) => { const d = enrichmentDetail(t); return <li>{t.name}</li>; });');
    const calls: ts.CallExpression[] = [];
    walk(sf, (n) => { if (isCallTo(n, 'enrichmentDetail')) calls.push(n); });
    expect(calls.map(resultIsRendered)).toEqual([false]);
  });
});

describe('the enriched rows are wired through the sanitiser (AST)', () => {
  it('there is exactly one shared mark component, it is a client component, and it renders an img', () => {
    expect(markFiles.map((f) => relative(WEB, f))).toHaveLength(1);
    const sf = parse(MARK);
    // `'use client'` as the first statement: the error handler must run in the browser, and a
    // server-rendered mark would leave a dead URL as a broken-image icon.
    const first = sf.statements[0];
    expect(first && ts.isExpressionStatement(first) && ts.isStringLiteral(first.expression) && first.expression.text).toBe('use client');
    expect(jsxElements(sf, 'img').length).toBeGreaterThanOrEqual(1);
  });

  it('1. every img/Image in the mark and both row components takes its src (and any srcSet) from safeLogoUrl, with no spread and no logo-fed style, and none imports next/image', () => {
    for (const file of [MARK, ...ROW_COMPONENTS]) {
      const sf = parse(file);
      expect({ file: relative(WEB, file), unsanitised: unsanitisedImages(sf) }).toEqual({ file: relative(WEB, file), unsanitised: [] });
      expect(moduleSpecifiers(sf)).not.toContain('next/image');
    }
    for (const page of [ACCOUNT_PAGE, TX_PAGE]) expect(moduleSpecifiers(parse(page))).not.toContain('next/image');
  });

  it('2. every img sends no referrer, falls back on error, and is a fixed, lazy, decorative, undraggable box with no crossOrigin', () => {
    for (const file of [MARK, ...ROW_COMPONENTS]) {
      expect({ file: relative(WEB, file), leaky: leakyImages(parse(file)) }).toEqual({ file: relative(WEB, file), leaky: [] });
    }
    for (const el of jsxElements(parse(MARK), 'img')) {
      expect(attr(el, 'crossOrigin')).toBeUndefined();
      const loading = attrExpr(attr(el, 'loading'));
      expect(loading && ts.isStringLiteral(loading) && loading.text).toBe('lazy');
      const alt = attrExpr(attr(el, 'alt'));
      expect(alt && ts.isStringLiteral(alt) ? alt.text : null).toBe('');
      expect(attrExpr(attr(el, 'draggable'))?.kind).toBe(ts.SyntaxKind.FalseKeyword);
      expect(attr(el, 'width')).toBeDefined();
      expect(attr(el, 'height')).toBeDefined();
    }
  });

  it('R4/F1. the tile is always the box, and the logo stays invisible until it has loaded', () => {
    expect(visibleBeforeLoad(parse(MARK))).toEqual([]);
  });

  it('R4/H9. a logo is recorded as failed only by a real error event, never by a zero naturalWidth', () => {
    const sf = parse(MARK);
    expect(addsOutsideOnError(sf)).toEqual([]);
    expect(naturalWidthGuesses(sf)).toEqual([]);
  });

  it('3. both row components render the shared mark and the enrichment detail inside the row map', () => {
    for (const file of ROW_COMPONENTS) {
      const sf = parse(file);
      const local = defaultImportOf(sf, file, MARK);
      expect({ file: relative(WEB, file), importsMark: local !== null }).toEqual({ file: relative(WEB, file), importsMark: true });
      const marks = jsxElements(sf, local!).filter(insideMap);
      expect(marks.length).toBeGreaterThanOrEqual(1);
      // Fed from the row's own logo column, not a constant that would make the wiring vacuous.
      for (const el of marks) expect(attrExpr(attr(el, 'logoUrl'))?.getText(sf)).toMatch(/\.logo_url$/);

      const calls: ts.CallExpression[] = [];
      walk(sf, (n) => { if (isCallTo(n, 'enrichmentDetail')) calls.push(n); });
      const inRows = calls.filter(insideMap);
      expect({ file: relative(WEB, file), calls: inRows.length }).not.toEqual({ file: relative(WEB, file), calls: 0 });
      for (const call of inRows) expect(resultIsRendered(call)).toBe(true);
    }
  });

  it('4. no href in either row component is built from a logo, website, authorized-date or location field', () => {
    for (const file of ROW_COMPONENTS) expect(enrichmentHrefs(parse(file))).toEqual([]);
  });

  it('5. the raw Plaid object is named nowhere in the row components, the mark, or either page', () => {
    for (const file of [...ROW_COMPONENTS, MARK, ACCOUNT_PAGE, TX_PAGE]) {
      expect({ file: relative(WEB, file), mentions: rawPlaidMentions(parse(file)) }).toEqual({ file: relative(WEB, file), mentions: [] });
    }
  });

  it('6. the row types carry the four enrichment fields as required string | null', () => {
    const rowTypes: [string, string][] = [
      [STATEMENT, 'StatementRow'],
      [TABLE, 'TxRow'],
      [ACCOUNT_PAGE, 'TxRow'],
      [TX_PAGE, 'TxRow'],
    ];
    for (const [file, typeName] of rowTypes) {
      const members = rowTypeMembers(parse(file), typeName);
      for (const field of ENRICHMENT_FIELDS) {
        expect({ file: relative(WEB, file), field, ok: isRequiredNullableString(members.get(field)) })
          .toEqual({ file: relative(WEB, file), field, ok: true });
      }
    }
  });
});
