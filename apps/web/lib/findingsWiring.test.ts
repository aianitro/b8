// P5-34 — the finding vocabulary is single-sourced, closed and complete, as a property of the SOURCE
// (scenarios W1–W6).
//
// `lib/domain/findings.test.ts` proves the conversions map each producer state correctly. That proves
// nothing about a card that assigns its own `severity: 'warning'` beside them, a producer added next
// month that nobody decided about, or a vocabulary module that quietly imports the database. Those
// are properties of which file says what, so they are asserted over the AST with the TypeScript
// compiler API, the way `giftSurfaceWiring.test.ts` asserts the gift masking.
//
// AN AST, NOT A GREP (BUILD.md A10). A severity named in a comment is not an assignment, and an
// assignment routed through a ternary or a same-file constant still is one. Text search gets both of
// those wrong in opposite directions.
//
// EVERY CHECKER IS ALSO RUN AGAINST FABRICATED SOURCES that break its rule and against clean ones, so
// a checker that silently matches nothing cannot pass the real tree by accident.

import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { basename, join, posix, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';
import { describe, expect, it } from 'vitest';
import { FindingKindSchema } from '@b8/contracts/findings';
import { FINDING_CONVERSIONS } from './domain/findings';
import { PRODUCER_INVENTORY, type InventoryEntry } from './domain/findingsInventory';
import { TRANSACTION_COLUMN_MASK } from './domain/giftMask';

const WEB = fileURLToPath(new URL('..', import.meta.url));
const REPO = join(WEB, '..', '..');
const CONTRACT = join(REPO, 'packages/contracts/findings.ts');
const rel = (f: string) => relative(WEB, f).split('\\').join('/');

function parseText(file: string, text: string): ts.SourceFile {
  return ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true, file.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
}
const parse = (file: string) => parseText(file, readFileSync(file, 'utf8'));
const fake = (body: string, file = 'fake.ts') => parseText(file, body);

function walk(node: ts.Node, visit: (n: ts.Node) => void): void {
  visit(node);
  ts.forEachChild(node, (c) => walk(c, visit));
}

/** Every `.ts`/`.tsx` under `dir` (absolute), recursively, outside `node_modules`. */
function filesUnder(dir: string): string[] {
  return (readdirSync(dir, { recursive: true }) as string[])
    .filter((f) => /\.tsx?$/.test(f) && !f.split(/[\\/]/).includes('node_modules'))
    .map((f) => join(dir, f));
}

/** Tests, kits and setup files are not the app — excluded from the scans, as in giftSurfaceWiring. */
const isAppSource = (f: string) =>
  !/\.test\.tsx?$/.test(f) && !/TestKit\.ts$/.test(f) && !/TestFixtures\.ts$/.test(f) && !/\.setup\.ts$/.test(f)
  && !/\.d\.ts$/.test(f);

/** The vocabulary modules themselves: the one place a severity may be written. */
const isVocabulary = (f: string) => /^lib\/domain\/findings[A-Za-z]*(\.test)?\.ts$/.test(rel(f));

const WEB_SOURCES = ['app', 'lib', 'components'].flatMap((d) => filesUnder(join(WEB, d))).filter(isAppSource);
const CONTRACT_SOURCES = filesUnder(join(REPO, 'packages/contracts')).filter(isAppSource);
const VOCABULARY = filesUnder(join(WEB, 'lib/domain')).filter((f) => isVocabulary(f) && isAppSource(f));

const lineOf = (sf: ts.SourceFile, n: ts.Node) => sf.getLineAndCharacterOfPosition(n.getStart(sf)).line + 1;

/** The same-file `const` initialisers, by name. */
function constsOf(sf: ts.SourceFile): Map<string, ts.Expression> {
  const consts = new Map<string, ts.Expression>();
  walk(sf, (n) => {
    if (ts.isVariableDeclaration(n) && ts.isIdentifier(n.name) && n.initializer
        && ts.isVariableDeclarationList(n.parent) && (n.parent.flags & ts.NodeFlags.Const)) {
      consts.set(n.name.text, n.initializer);
    }
  });
  return consts;
}

/** `x as T`, `x satisfies T`, `x!`, `(x)` — the expression underneath. */
function unwrap(e: ts.Expression): ts.Expression {
  while (ts.isParenthesizedExpression(e) || ts.isAsExpression(e) || ts.isSatisfiesExpression(e)
    || ts.isNonNullExpression(e) || ts.isTypeAssertionExpression(e)) e = e.expression;
  return e;
}

const nameText = (n: ts.PropertyName | ts.Expression): string | null => {
  if (ts.isIdentifier(n) || ts.isStringLiteral(n) || ts.isNoSubstitutionTemplateLiteral(n)) return n.text;
  if (ts.isComputedPropertyName(n)) return nameText(unwrap(n.expression));
  return null;
};

// ─── W1: severity is assigned only in the vocabulary modules ───────────────────────────────────

const SEVERITY_LITERALS = new Set(['critical', 'warning', 'notice']);

/**
 * The same-file functions, by name: `function f() {}` declarations, and `const f = () => …` or
 * `const f = function () {}` (P5-36, widening T34-W1 per P5-34 N1).
 */
function functionsOf(sf: ts.SourceFile): Map<string, ts.FunctionLikeDeclaration> {
  const fns = new Map<string, ts.FunctionLikeDeclaration>();
  walk(sf, (n) => {
    if (ts.isFunctionDeclaration(n) && n.name && n.body) fns.set(n.name.text, n);
    if (ts.isVariableDeclaration(n) && ts.isIdentifier(n.name) && n.initializer
        && ts.isVariableDeclarationList(n.parent) && (n.parent.flags & ts.NodeFlags.Const)) {
      const init = unwrap(n.initializer);
      if (ts.isArrowFunction(init) || ts.isFunctionExpression(init)) fns.set(n.name.text, init);
    }
  });
  return fns;
}

/**
 * What a function can return: an arrow's expression body, or the operand of every `return` in its
 * body — not counting the returns of functions nested inside it, which return to somebody else.
 */
function returnedExpressions(fn: ts.FunctionLikeDeclaration): ts.Expression[] {
  if (!fn.body) return [];
  if (!ts.isBlock(fn.body)) return [fn.body];
  const out: ts.Expression[] = [];
  const visit = (n: ts.Node): void => {
    if (ts.isFunctionLike(n)) return;
    if (ts.isReturnStatement(n) && n.expression) out.push(n.expression);
    ts.forEachChild(n, visit);
  };
  ts.forEachChild(fn.body, visit);
  return out;
}

/** What a severity expression may resolve through: the file's constants and its functions. */
interface SeverityScope {
  consts: Map<string, ts.Expression>;
  fns: Map<string, ts.FunctionLikeDeclaration>;
}

/** The value a same-file object literal gives one named key: an assignment's initializer, or a shorthand's constant. */
function propertyValue(lit: ts.ObjectLiteralExpression, key: string, scope: SeverityScope): ts.Expression | undefined {
  for (const p of lit.properties) {
    if (ts.isPropertyAssignment(p) && nameText(p.name) === key) return p.initializer;
    if (ts.isShorthandPropertyAssignment(p) && p.name.text === key) return scope.consts.get(key) ?? p.name;
  }
  return undefined;
}

/**
 * The same-file object or array literal `e` names, if any: a constant (`M`, through `as const` and the
 * other wrappers `unwrap` removes), or a named property of one that is itself a literal (`M.a`, `M.a.b`).
 * Anything else — a parameter, an import, a call — is not a table this file wrote.
 */
function tableOf(e: ts.Expression, scope: SeverityScope, depth: number): ts.ObjectLiteralExpression | ts.ArrayLiteralExpression | undefined {
  if (depth > 8) return undefined;
  e = unwrap(e);
  let target: ts.Expression | undefined;
  if (ts.isIdentifier(e)) target = scope.consts.get(e.text);
  else if (ts.isPropertyAccessExpression(e)) {
    const parent = tableOf(e.expression, scope, depth + 1);
    target = parent && ts.isObjectLiteralExpression(parent) ? propertyValue(parent, e.name.text, scope) : undefined;
  }
  if (!target) return undefined;
  target = unwrap(target);
  if (ts.isObjectLiteralExpression(target) || ts.isArrayLiteralExpression(target)) return target;
  return ts.isIdentifier(target) || ts.isPropertyAccessExpression(target) ? tableOf(target, scope, depth + 1) : undefined;
}

/**
 * Whether `e` can evaluate to one of the three severity literals: directly, through a ternary or a
 * `??`/`||`/`&&`, through a type assertion, or through a same-file constant (recursively).
 *
 * Widened in P5-36 (P5-34 N1) to two more routes a literal takes to a `severity` key: element access
 * into a same-file object or array literal any of whose values can be a severity (`M[k]`, `L[0]`),
 * and the return value of a same-file function or arrow that can return one (`sev()`). Element access
 * into anything that is not such a table (`input.sevs[k]`) and a helper whose returns are not
 * literals stay clean: they read a severity somebody else wrote.
 *
 * Widened again at P5-36 G2 to property (dot) access into such a table (`M.high`, and a nested
 * `M.a.b`): the orchestrator's mutation M14 wrote `{ severity: LEVELS.high }` in a script and the
 * bracket-only check let it through. Dot access names one property, so only that property's value is
 * judged — `M.a` is clean when `a` holds a non-severity, even if a sibling holds one.
 */
function takesSeverityLiteral(e: ts.Expression, scope: SeverityScope, depth = 0): boolean {
  if (depth > 8) return false;
  e = unwrap(e);
  if (ts.isStringLiteral(e) || ts.isNoSubstitutionTemplateLiteral(e)) return SEVERITY_LITERALS.has(e.text);
  if (ts.isConditionalExpression(e)) {
    return takesSeverityLiteral(e.whenTrue, scope, depth + 1) || takesSeverityLiteral(e.whenFalse, scope, depth + 1);
  }
  if (ts.isBinaryExpression(e) && [
    ts.SyntaxKind.QuestionQuestionToken, ts.SyntaxKind.BarBarToken, ts.SyntaxKind.AmpersandAmpersandToken,
  ].includes(e.operatorToken.kind)) {
    return takesSeverityLiteral(e.left, scope, depth + 1) || takesSeverityLiteral(e.right, scope, depth + 1);
  }
  if (ts.isIdentifier(e)) {
    const init = scope.consts.get(e.text);
    return init ? takesSeverityLiteral(init, scope, depth + 1) : false;
  }
  if (ts.isPropertyAccessExpression(e)) {
    const lit = tableOf(e.expression, scope, depth + 1);
    const value = lit && ts.isObjectLiteralExpression(lit) ? propertyValue(lit, e.name.text, scope) : undefined;
    return value ? takesSeverityLiteral(value, scope, depth + 1) : false;
  }
  if (ts.isElementAccessExpression(e)) {
    const lit = tableOf(e.expression, scope, depth + 1);
    if (lit && ts.isObjectLiteralExpression(lit)) {
      return lit.properties.some((p) => ts.isPropertyAssignment(p) && takesSeverityLiteral(p.initializer, scope, depth + 1));
    }
    if (lit && ts.isArrayLiteralExpression(lit)) return lit.elements.some((el) => takesSeverityLiteral(el, scope, depth + 1));
    return false;
  }
  if (ts.isCallExpression(e) && ts.isIdentifier(e.expression)) {
    const fn = scope.fns.get(e.expression.text);
    return fn ? returnedExpressions(fn).some((r) => takesSeverityLiteral(r, scope, depth + 1)) : false;
  }
  return false;
}

/** Every place `sf` writes a severity literal into something named `severity`. Reads are not writes. */
export function severityAssignments(sf: ts.SourceFile): string[] {
  const scope: SeverityScope = { consts: constsOf(sf), fns: functionsOf(sf) };
  const out: string[] = [];
  const hit = (n: ts.Node, how: string) => out.push(`${sf.fileName}:${lineOf(sf, n)} ${how}`);
  walk(sf, (n) => {
    if (ts.isPropertyAssignment(n) && nameText(n.name) === 'severity' && takesSeverityLiteral(n.initializer, scope)) {
      hit(n, ts.isComputedPropertyName(n.name) ? 'computed key' : 'property');
    }
    if (ts.isShorthandPropertyAssignment(n) && n.name.text === 'severity' && takesSeverityLiteral(n.name, scope)) {
      hit(n, 'shorthand');
    }
    if (ts.isBinaryExpression(n) && n.operatorToken.kind === ts.SyntaxKind.EqualsToken) {
      const l = n.left;
      const named = (ts.isPropertyAccessExpression(l) && l.name.text === 'severity')
        || (ts.isElementAccessExpression(l) && nameText(unwrap(l.argumentExpression)) === 'severity');
      if (named && takesSeverityLiteral(n.right, scope)) hit(n, 'assignment');
    }
    if (ts.isJsxAttribute(n) && ts.isIdentifier(n.name) && n.name.text === 'severity' && n.initializer) {
      const init = n.initializer;
      const lit = ts.isStringLiteral(init) ? SEVERITY_LITERALS.has(init.text)
        : ts.isJsxExpression(init) && init.expression ? takesSeverityLiteral(init.expression, scope) : false;
      if (lit) hit(n, 'jsx prop');
    }
  });
  return out;
}

describe('P5-34 wiring: severity has one home', () => {
  it('T34-W1: no source outside lib/domain/findings*.ts assigns a severity literal; fabricated violators are flagged', () => {
    const scanned = [...WEB_SOURCES, ...CONTRACT_SOURCES].filter((f) => !isVocabulary(f));
    const offenders = scanned.flatMap((f) => severityAssignments(parse(f)).map((h) => `${rel(f)} ${h}`));
    expect(offenders).toEqual([]);
    // Not vacuous: the scan covered the tree, the contract package included, and the detector does
    // see the assignments the vocabulary module itself makes.
    expect(scanned.length).toBeGreaterThan(200);
    expect(scanned.some((f) => f === CONTRACT)).toBe(true);
    expect(scanned.some((f) => rel(f).startsWith('components/'))).toBe(true);
    expect(severityAssignments(parse(join(WEB, 'lib/domain/findings.ts'))).length).toBeGreaterThanOrEqual(10);

    const violators: [string, string][] = [
      ["const card = { severity: 'warning', title: 'x' };", 'Card.tsx'],
      ["const f = { severity: stale ? 'warning' : 'notice' };", 'a.ts'],
      ["const LEVEL = 'critical'; const f = { severity: LEVEL };", 'b.ts'],
      ["const severity = 'notice'; const f = { severity };", 'c.ts'],
      ["const f = { ['severity']: 'warning' };", 'd.ts'],
      ["const f = { 'severity': 'critical' as const };", 'e.ts'],
      ["finding.severity = 'warning';", 'f.ts'],
      ["const f = { severity: level ?? 'notice' };", 'g.ts'],
      ["const A = 'warning'; const B = A; const f = { severity: B };", 'h.ts'],
      ['export function C() { return <Badge severity="critical" />; }', 'i.tsx'],
      ["export function D() { return <Badge severity={x ? 'warning' : 'notice'} />; }", 'j.tsx'],
    ];
    for (const [src, file] of violators) {
      expect({ src, flagged: severityAssignments(fake(src, file)).length > 0 }).toEqual({ src, flagged: true });
    }
    const clean: [string, string][] = [
      ["if (f.severity === 'critical') bell();", 'k.ts'],
      ["const urgent = findings.filter((f) => f.severity !== 'notice');", 'l.ts'],
      ["// severity: 'warning' in a comment is not an assignment\nconst x = 1;", 'm.ts'],
      ["const f = { severity: input.severity, label: 'warning' };", 'n.ts'],
      ["const tone = { level: 'warning' };", 'o.ts'],
      ["const f = { severity: 'high' };", 'p.ts'],
    ];
    for (const [src, file] of clean) {
      expect({ src, hits: severityAssignments(fake(src, file)) }).toEqual({ src, hits: [] });
    }
  });
});

// ─── W2: the conversion registry matches the contract's kinds ──────────────────────────────────

/** The string literals of `FindingKindSchema = z.enum([...])`, or null when the declaration is absent. */
export function contractKinds(sf: ts.SourceFile): string[] | null {
  const init = constsOf(sf).get('FindingKindSchema');
  if (!init) return null;
  const call = unwrap(init);
  if (!ts.isCallExpression(call) || !call.arguments[0]) return null;
  const arr = unwrap(call.arguments[0]);
  if (!ts.isArrayLiteralExpression(arr)) return null;
  return arr.elements.map((e) => nameText(unwrap(e))).filter((x): x is string => x !== null);
}

/** The keys of the exported `FINDING_CONVERSIONS` object literal, or null when it is absent. */
export function registryKinds(sf: ts.SourceFile): string[] | null {
  const init = constsOf(sf).get('FINDING_CONVERSIONS');
  if (!init) return null;
  const obj = unwrap(init);
  if (!ts.isObjectLiteralExpression(obj)) return null;
  return obj.properties.map((p) => (p.name ? nameText(p.name) : null)).filter((x): x is string => x !== null);
}

/** What differs between the two kind sets, named. */
export function kindMismatch(contract: string[] | null, registry: string[] | null): string[] {
  if (contract === null) return ['contract: FindingKindSchema not found'];
  if (registry === null) return ['registry: FINDING_CONVERSIONS not found'];
  return [
    ...contract.filter((k) => !registry.includes(k)).map((k) => `no conversion for ${k}`),
    ...registry.filter((k) => !contract.includes(k)).map((k) => `conversion for unknown kind ${k}`),
    ...registry.filter((k, i) => registry.indexOf(k) !== i).map((k) => `duplicate conversion ${k}`),
  ];
}

const CONTRACT_KINDS = contractKinds(parse(CONTRACT)) ?? [];

describe('P5-34 wiring: one conversion per kind', () => {
  it('T34-W2: the conversion registry names every contract kind and no other; fabricated pairs are flagged', () => {
    const registry = registryKinds(parse(join(WEB, 'lib/domain/findings.ts')));
    expect(kindMismatch(CONTRACT_KINDS, registry)).toEqual([]);
    expect(CONTRACT_KINDS).toHaveLength(10);
    // The AST reading agrees with the runtime values it describes.
    expect([...CONTRACT_KINDS].sort()).toEqual([...FindingKindSchema.options].sort());
    expect([...(registry ?? [])].sort()).toEqual(Object.keys(FINDING_CONVERSIONS).sort());

    const contract = "export const FindingKindSchema = z.enum(['a-kind', 'b-kind', 'c-kind']);";
    const reg = (keys: string[]) =>
      `export const FINDING_CONVERSIONS = { ${keys.map((k) => `'${k}': { convert: f }`).join(', ')} } as const satisfies X;`;
    const pair = (keys: string[]) => kindMismatch(contractKinds(fake(contract)), registryKinds(fake(reg(keys))));
    expect(pair(['a-kind', 'b-kind', 'c-kind'])).toEqual([]);
    expect(pair(['a-kind', 'c-kind'])).toEqual(['no conversion for b-kind']);
    expect(pair(['a-kind', 'b-kind', 'c-kind', 'd-kind'])).toEqual(['conversion for unknown kind d-kind']);
    expect(kindMismatch(contractKinds(fake(contract)), registryKinds(fake('export const OTHER = {};'))))
      .toEqual(['registry: FINDING_CONVERSIONS not found']);
  });
});

// ─── W3: every producer-shaped export is decided ──────────────────────────────────────────────

const PRODUCER_NAME = /(Finding|Health)$/;

/** Exported declarations whose name ends in `Finding` or `Health`, including re-exported names. */
export function exportedProducerTypes(sf: ts.SourceFile): string[] {
  const out: string[] = [];
  const exported = (n: ts.Node) =>
    ts.canHaveModifiers(n) && (ts.getModifiers(n) ?? []).some((m) => m.kind === ts.SyntaxKind.ExportKeyword);
  for (const st of sf.statements) {
    if ((ts.isInterfaceDeclaration(st) || ts.isTypeAliasDeclaration(st) || ts.isClassDeclaration(st) || ts.isEnumDeclaration(st))
        && st.name && exported(st) && PRODUCER_NAME.test(st.name.text)) out.push(st.name.text);
    if (ts.isExportDeclaration(st) && st.exportClause && ts.isNamedExports(st.exportClause)) {
      for (const s of st.exportClause.elements) if (PRODUCER_NAME.test(s.name.text)) out.push(s.name.text);
    }
  }
  return out;
}

/** What is wrong with the inventory's decisions about `found`, given the contract's kinds. */
export function undecidedProducers(
  found: string[],
  inventory: Record<string, InventoryEntry>,
  kinds: readonly string[],
): string[] {
  const out: string[] = [];
  for (const name of found) {
    const e = inventory[name];
    if (!e) { out.push(`undecided ${name}`); continue; }
    if (e.disposition === 'converted' && e.kinds.length === 0) out.push(`converted to nothing ${name}`);
    if (e.disposition === 'excluded' && e.reason.trim().length < 20) out.push(`no real reason ${name}`);
  }
  for (const [name, e] of Object.entries(inventory)) {
    if (e.disposition !== 'converted') continue;
    for (const k of e.kinds) if (!kinds.includes(k)) out.push(`${name} names unknown kind ${k}`);
  }
  for (const k of kinds) {
    if (!Object.values(inventory).some((e) => e.disposition === 'converted' && e.kinds.includes(k as never))) {
      out.push(`no producer for kind ${k}`);
    }
  }
  return out;
}

describe('P5-34 wiring: the producer inventory is complete', () => {
  it('T34-W3: every exported *Finding / *Health type under lib and components is in the inventory; RentFinding is flagged', () => {
    const scanned = WEB_SOURCES.filter((f) => /^(lib|components)\//.test(rel(f)) && !isVocabulary(f));
    const found = scanned.flatMap((f) => exportedProducerTypes(parse(f)));
    expect(undecidedProducers(found, PRODUCER_INVENTORY, CONTRACT_KINDS)).toEqual([]);
    // The real set today, by name, so a new one is a visible change to this list.
    expect([...found].sort()).toEqual([
      'AdherenceFinding', 'BreachFinding', 'ChronicUnderspendFinding', 'DriftFinding', 'FeedFinding',
      'ForecastFinding', 'JobHealth', 'OverdraftFinding', 'SyncItemHealth', 'ValuationFinding', 'WalletFinding',
    ]);
    // Every found type is one the inventory converts; the excluded entries are the hand-read half.
    for (const name of found) expect((PRODUCER_INVENTORY as Record<string, InventoryEntry>)[name].disposition, name).toBe('converted');

    // The checker itself.
    expect(exportedProducerTypes(fake('export interface RentFinding { amount: number }'))).toEqual(['RentFinding']);
    expect(undecidedProducers(['RentFinding'], PRODUCER_INVENTORY, CONTRACT_KINDS)).toEqual(['undecided RentFinding']);
    expect(exportedProducerTypes(fake('export type LeaseHealth = { ok: boolean };'))).toEqual(['LeaseHealth']);
    expect(exportedProducerTypes(fake('interface LocalFinding { x: 1 }\nexport { LocalFinding };'))).toEqual(['LocalFinding']);
    expect(exportedProducerTypes(fake('interface PrivateFinding { x: 1 }\nexport interface RentRow { y: 2 }'))).toEqual([]);
    expect(undecidedProducers(['DriftFinding'], PRODUCER_INVENTORY, CONTRACT_KINDS)).toEqual([]);
    expect(undecidedProducers(['X'], { X: { file: 'x.ts', disposition: 'excluded', reason: 'short' } }, []))
      .toEqual(['no real reason X']);
    expect(undecidedProducers([], { Y: { file: 'y.ts', disposition: 'converted', kinds: ['made-up' as never] } }, ['a-kind']))
      .toEqual(['Y names unknown kind made-up', 'no producer for kind a-kind']);
  });
});

// ─── W4: the vocabulary modules are pure and single-sourced ────────────────────────────────────

const VALUE_IMPORTS_ALLOWED = (target: string) =>
  target.startsWith('lib/domain/') || target === 'lib/budgetMath' || target === '@b8/contracts/findings' || target === 'zod';
const TYPE_IMPORTS_ALLOWED = (target: string) => VALUE_IMPORTS_ALLOWED(target) || target === 'lib/overdraftWatch';
const FORBIDDEN_NAMES = new Set(['isScoredCategory', 'isTrackedCategory']);

/** A module specifier as a path under apps/web (`lib/…`), or the bare package name. */
function importTarget(fromRel: string, spec: string): string {
  if (spec.startsWith('@/')) return spec.slice(2).replace(/\.tsx?$/, '');
  if (spec.startsWith('.')) return posix.normalize(posix.join(posix.dirname(fromRel), spec)).replace(/\.tsx?$/, '');
  return spec;
}

/** Everything in a vocabulary module that breaks purity or the single-sourcing rules. */
export function purityViolations(sf: ts.SourceFile, fromRel: string): string[] {
  const out: string[] = [];
  const at = (n: ts.Node, what: string) => out.push(`${fromRel}:${lineOf(sf, n)} ${what}`);
  for (const st of sf.statements) {
    const spec = (ts.isImportDeclaration(st) || ts.isExportDeclaration(st)) && st.moduleSpecifier
      && ts.isStringLiteral(st.moduleSpecifier) ? st.moduleSpecifier.text : null;
    if (spec === null) continue;
    const target = importTarget(fromRel, spec);
    let typeOnly = false;
    const names: string[] = [];
    if (ts.isImportDeclaration(st)) {
      const c = st.importClause;
      const named = c?.namedBindings && ts.isNamedImports(c.namedBindings) ? c.namedBindings.elements : [];
      for (const e of named) names.push((e.propertyName ?? e.name).text);
      typeOnly = !!c && (c.isTypeOnly
        || (!c.name && !!c.namedBindings && ts.isNamedImports(c.namedBindings) && named.length > 0 && named.every((e) => e.isTypeOnly)));
    } else if (ts.isExportDeclaration(st)) {
      typeOnly = st.isTypeOnly;
      if (st.exportClause && ts.isNamedExports(st.exportClause)) {
        for (const e of st.exportClause.elements) names.push((e.propertyName ?? e.name).text);
      }
    }
    if (!(typeOnly ? TYPE_IMPORTS_ALLOWED : VALUE_IMPORTS_ALLOWED)(target)) {
      at(st, `${typeOnly ? 'type ' : ''}import of ${spec}`);
    }
    for (const n of names) if (FORBIDDEN_NAMES.has(n)) at(st, `imports ${n}`);
  }
  walk(sf, (n) => {
    if (ts.isPropertyAccessExpression(n) && FORBIDDEN_NAMES.has(n.name.text)) at(n, `uses ${n.name.text}`);
    if (ts.isCallExpression(n)) {
      const c = n.expression;
      if (c.kind === ts.SyntaxKind.ImportKeyword) at(n, 'dynamic import');
      if (ts.isIdentifier(c) && (c.text === 'require' || c.text === 'parseFloat')) at(n, `${c.text}(`);
      if (ts.isPropertyAccessExpression(c) && ts.isIdentifier(c.expression)) {
        const call = `${c.expression.text}.${c.name.text}`;
        if (call === 'Date.now' || call === 'Math.random' || call === 'Number.parseFloat' || call === 'performance.now') {
          at(n, `${call}(`);
        }
      }
    }
    if (ts.isNewExpression(n) && ts.isIdentifier(n.expression) && n.expression.text === 'Date'
        && (!n.arguments || n.arguments.length === 0)) at(n, 'new Date()');
  });
  return out;
}

describe('P5-34 wiring: the vocabulary is pure', () => {
  it('T34-W4: lib/domain/findings*.ts import only pure modules, never the scored-set predicates, and read no clock', () => {
    // P5-35 added `findingsFreshness.ts`, which the vocabulary pattern names by design; the rule below
    // now covers it too. Only this enumeration changed — the rule and its fabricated violators did not.
    // P5-36 added `findingsDigest.ts` the same way, and the same rule covers it.
    expect(VOCABULARY.map(rel).sort()).toEqual([
      'lib/domain/findings.ts', 'lib/domain/findingsDigest.ts', 'lib/domain/findingsFreshness.ts',
      'lib/domain/findingsInventory.ts',
    ]);
    for (const f of VOCABULARY) expect(purityViolations(parse(f), rel(f)), rel(f)).toEqual([]);

    const from = 'lib/domain/findingsX.ts';
    const violators = [
      "import db from '../db';",
      "import { wireMoney } from '../overviewRead';",
      "import { loadForecasts } from '../overdraftWatch';",
      "import { isScoredCategory } from './adherence';",
      "import type { isTrackedCategory } from './adherence';",
      "import * as adherence from './adherence'; const s = adherence.isScoredCategory(c);",
      "import type { OverviewData } from '@b8/contracts/overview';",
      "import { z } from '@b8/contracts/representation';",
      'const t = Date.now();',
      'const d = new Date();',
      'const d = new Date;',
      'const r = Math.random();',
      "const n = parseFloat('1.5');",
      "const m = import('../db');",
      "export { loadOverdrafts } from '../overdraftWatch';",
    ];
    for (const v of violators) {
      expect({ v, flagged: purityViolations(fake(v), from).length > 0 }).toEqual({ v, flagged: true });
    }
    const clean = [
      "import type { ForecastFinding } from '../overdraftWatch';",
      "import { type OverdraftFinding } from '../overdraftWatch';",
      "import { roundCents } from '../budgetMath';",
      "import { withoutNegativeZero } from './adherence';",
      "import type { Finding } from '@b8/contracts/findings';",
      "import { z } from 'zod';",
      'const d = new Date(Date.UTC(2026, 0, 1));',
      "// Date.now() in a comment is not a clock read\nconst x = 1;",
      "const s = f.lastSuccessfulUpdate.toISOString();",
    ];
    for (const c of clean) expect({ c, v: purityViolations(fake(c), from) }).toEqual({ c, v: [] });
  });
});

// ─── W5: the contract file is closed ───────────────────────────────────────────────────────────

const LOOSENING_METHODS = new Set(['optional', 'nullish', 'partial', 'passthrough', 'loose', 'strip']);

/** What in a contract source would let a key go missing, an extra key through, or apps/web in. */
export function contractViolations(sf: ts.SourceFile): string[] {
  const out: string[] = [];
  const at = (n: ts.Node, what: string) => out.push(`${lineOf(sf, n)} ${what}`);
  for (const st of sf.statements) {
    if ((ts.isImportDeclaration(st) || ts.isExportDeclaration(st)) && st.moduleSpecifier && ts.isStringLiteral(st.moduleSpecifier)) {
      const spec = st.moduleSpecifier.text;
      if (spec.startsWith('@/') || /(^|\/)apps\//.test(spec) || spec.startsWith('../')) at(st, `imports ${spec}`);
    }
  }
  walk(sf, (n) => {
    if (!ts.isCallExpression(n) || !ts.isPropertyAccessExpression(n.expression)) return;
    const { expression: target, name } = n.expression;
    if (LOOSENING_METHODS.has(name.text)) at(n, `.${name.text}()`);
    if (ts.isIdentifier(target) && target.text === 'z' && (name.text === 'object' || name.text === 'looseObject')) {
      at(n, `z.${name.text}(`);
    }
  });
  return out;
}

describe('P5-34 wiring: the contract is closed', () => {
  it('T34-W5: packages/contracts/findings.ts imports nothing from apps/web, never calls .optional(), never builds z.object(', () => {
    const sf = parse(CONTRACT);
    expect(contractViolations(sf)).toEqual([]);
    // Not vacuous: the file builds its members with the strict form, ten times at least.
    let strict = 0;
    walk(sf, (n) => {
      if (ts.isCallExpression(n) && ts.isPropertyAccessExpression(n.expression) && n.expression.name.text === 'strictObject') strict++;
    });
    expect(strict).toBeGreaterThanOrEqual(10);

    const violators = [
      "import type { DriftFinding } from '../../apps/web/lib/domain/drift';",
      "import { x } from '@/lib/domain/drift';",
      'export const A = z.strictObject({ a: z.string().optional() });',
      'export const A = z.object({ a: z.string() });',
      'export const A = z.looseObject({ a: z.string() });',
      'export const A = z.strictObject({ a: z.string().nullish() });',
      'export const A = z.strictObject({ a: z.string() }).partial();',
    ];
    for (const v of violators) {
      expect({ v, flagged: contractViolations(fake(v)).length > 0 }).toEqual({ v, flagged: true });
    }
    const clean = [
      "import { z } from 'zod';\nimport { moneyString } from './overview';",
      'export const A = z.strictObject({ a: z.string().nullable() });',
      '// z.object( in a comment\nexport const B = 1;',
    ];
    for (const c of clean) expect({ c, v: contractViolations(fake(c)) }).toEqual({ c, v: [] });
  });
});

// ─── W6: the registries are internally sound ───────────────────────────────────────────────────

/** Whether `sf` exports a declaration (or a re-export) named `name`. */
function exportsName(sf: ts.SourceFile, name: string): boolean {
  const exported = (n: ts.Node) =>
    ts.canHaveModifiers(n) && (ts.getModifiers(n) ?? []).some((m) => m.kind === ts.SyntaxKind.ExportKeyword);
  return sf.statements.some((st) =>
    ((ts.isInterfaceDeclaration(st) || ts.isTypeAliasDeclaration(st) || ts.isClassDeclaration(st)
      || ts.isEnumDeclaration(st) || ts.isFunctionDeclaration(st)) && st.name?.text === name && exported(st))
    || (ts.isExportDeclaration(st) && !!st.exportClause && ts.isNamedExports(st.exportClause)
      && st.exportClause.elements.some((e) => e.name.text === name)));
}

/**
 * Every inventory entry names a file that exists and exports the named type; every excluded entry
 * has a reason; every converted entry names kinds. `readSource` returns a file's text, or null when
 * it does not exist, so the checker can be run against fabricated trees.
 */
export function inventoryIntegrity(
  inventory: Record<string, InventoryEntry>,
  readSource: (file: string) => string | null,
): string[] {
  const out: string[] = [];
  for (const [name, e] of Object.entries(inventory)) {
    const text = readSource(e.file);
    if (text === null) { out.push(`${name}: no such file ${e.file}`); continue; }
    if (!exportsName(fake(text, basename(e.file)), name)) out.push(`${name}: not exported by ${e.file}`);
    if (e.disposition === 'excluded' && !(typeof e.reason === 'string' && e.reason.trim().length > 0)) {
      out.push(`${name}: excluded without a reason`);
    }
    if (e.disposition === 'converted' && e.kinds.length === 0) out.push(`${name}: converted to no kind`);
  }
  return out;
}

const readWebSource = (file: string) => {
  const abs = join(WEB, file);
  return existsSync(abs) ? readFileSync(abs, 'utf8') : null;
};

describe('P5-34 wiring: registry integrity', () => {
  it('T34-W6: every inventory entry names an existing file exporting it, with a reason or kinds; the two registries agree', () => {
    expect(inventoryIntegrity(PRODUCER_INVENTORY, readWebSource)).toEqual([]);
    expect(Object.keys(PRODUCER_INVENTORY).length).toBeGreaterThanOrEqual(11);
    expect(Object.values(PRODUCER_INVENTORY).some((e) => e.disposition === 'excluded')).toBe(true);

    // Each conversion names a producer the inventory converts into that very kind.
    const inv = PRODUCER_INVENTORY as Record<string, InventoryEntry>;
    for (const [kind, c] of Object.entries(FINDING_CONVERSIONS)) {
      const e = inv[c.producer];
      expect(e, `${kind} -> ${c.producer}`).toBeDefined();
      expect(e.disposition === 'converted' && (e.kinds as readonly string[]).includes(kind), `${kind} -> ${c.producer}`).toBe(true);
    }
    // And each converted inventory kind has a conversion whose producer is that entry or a union of it.
    for (const [name, e] of Object.entries(inv)) {
      if (e.disposition !== 'converted') continue;
      for (const k of e.kinds) expect(Object.keys(FINDING_CONVERSIONS), `${name} -> ${k}`).toContain(k);
    }

    // The checker itself, against a fabricated tree.
    const tree: Record<string, string> = {
      'lib/a.ts': 'export interface AFinding { x: 1 }',
      'lib/b.ts': 'interface BFinding { x: 1 }',
    };
    const read = (f: string) => tree[f] ?? null;
    expect(inventoryIntegrity({ AFinding: { file: 'lib/a.ts', disposition: 'converted', kinds: ['balance-drift'] } }, read)).toEqual([]);
    expect(inventoryIntegrity({ AFinding: { file: 'lib/gone.ts', disposition: 'converted', kinds: ['balance-drift'] } }, read))
      .toEqual(['AFinding: no such file lib/gone.ts']);
    expect(inventoryIntegrity({ BFinding: { file: 'lib/b.ts', disposition: 'excluded', reason: 'a reason long enough to count' } }, read))
      .toEqual(['BFinding: not exported by lib/b.ts']);
    expect(inventoryIntegrity({ AFinding: { file: 'lib/a.ts', disposition: 'excluded', reason: '' } }, read))
      .toEqual(['AFinding: excluded without a reason']);
    expect(inventoryIntegrity({ AFinding: { file: 'lib/a.ts', disposition: 'converted', kinds: [] } }, read))
      .toEqual(['AFinding: converted to no kind']);
  });
});

// ─── Evidence: the inventory, printed ─────────────────────────────────────────────────────────

describe('P5-34 evidence', () => {
  it('the inventory dispositions match SPEC.md', () => {
    const lines = Object.entries(PRODUCER_INVENTORY as Record<string, InventoryEntry>).map(([name, e]) =>
      `${name} (${e.file}) -> ${e.disposition === 'converted' ? `converted: ${e.kinds.join(', ')}` : `excluded: ${e.reason}`}`);
    const converted = Object.entries(PRODUCER_INVENTORY).filter(([, e]) => e.disposition === 'converted').map(([n]) => n);
    expect(converted).toEqual([
      'BreachFinding', 'ChronicUnderspendFinding', 'AdherenceFinding', 'DriftFinding', 'FeedFinding', 'SyncItemHealth',
      'JobHealth', 'WalletFinding', 'ValuationFinding', 'OverdraftFinding', 'ForecastFinding',
    ]);
    if (process.env.T34_PRINT === '1') console.log(`\nP5-34 producer inventory\n${lines.join('\n')}\n`);
  });
});

// ─── P5-35: freshness is pure, single-sourced, viewer-safe and unconsumed (W1–W3) ─────────────────

const FRESHNESS = join(WEB, 'lib/domain/findingsFreshness.ts');
const FRESHNESS_READ = join(WEB, 'lib/findingsFreshnessRead.ts');

/** The unit constants the freshness module may write as numbers: zero, one, and ms per second, hour, day. */
const UNIT_LITERALS = new Set([0, 1, 1000, 3_600_000, 86_400_000]);

/** Each threshold, by the name it must be imported under and the module it must come from. */
const THRESHOLD_IMPORTS: [string, string][] = [
  ['STALE_AFTER_DAYS', './syncHealth'],
  ['STALE_AFTER_HOURS', './feedHealth'],
  ['STALE_AFTER_DAYS', './walletStaleness'],
  ['VALUATION_STALE_DAYS', './valuationStaleness'],
];

/**
 * Every way a SQL text can read Postgres's clock. Widened in P5-36 (P5-35 N1): `CURRENT_TIME`,
 * `LOCALTIME` (a whole word, so `LOCALTIMESTAMP` still matches its own entry and a column such as
 * `localtime_name` does not), `timeofday()`, and the special date and time input strings `'now'`,
 * `'today'`, `'tomorrow'` and `'yesterday'` when they are cast — by `::` or `CAST(… AS …)` — since a
 * cast is what makes Postgres read the clock for them. The same words as plain values (`label =
 * 'today'`) are not clocks.
 */
const SQL_CLOCKS = new RegExp([
  String.raw`\bnow\s*\(`, String.raw`\bcurrent_date\b`, String.raw`\bcurrent_timestamp\b`, String.raw`\bcurrent_time\b`,
  String.raw`\bclock_timestamp\b`, String.raw`\blocaltimestamp\b`, String.raw`\blocaltime\b`, String.raw`\btimeofday\s*\(`,
  String.raw`\btransaction_timestamp\b`, String.raw`\bstatement_timestamp\b`,
  String.raw`'(?:now|today|tomorrow|yesterday)'\s*::`, String.raw`\bcast\s*\(\s*'(?:now|today|tomorrow|yesterday)'`,
].join('|'), 'i');

/** Every string and template literal's text (template spans joined with a placeholder), outside imports. */
function literalTexts(sf: ts.SourceFile): string[] {
  const out: string[] = [];
  walk(sf, (n) => {
    if (ts.isImportDeclaration(n.parent ?? n) || ts.isExportDeclaration(n.parent ?? n)) return;
    if (ts.isStringLiteral(n) || ts.isNoSubstitutionTemplateLiteral(n)) out.push(n.text);
    if (ts.isTemplateExpression(n)) out.push([n.head.text, ...n.templateSpans.map((s) => s.literal.text)].join(' ${} '));
  });
  return out;
}

/** What in the freshness modules reads a clock, parses a float, copies a threshold or reads a SQL clock. */
export function freshnessPurityViolations(sf: ts.SourceFile, opts: { pure: boolean }): string[] {
  const out: string[] = [];
  const at = (n: ts.Node, what: string) => out.push(`${lineOf(sf, n)} ${what}`);
  walk(sf, (n) => {
    if (ts.isCallExpression(n)) {
      const c = n.expression;
      if (ts.isIdentifier(c) && c.text === 'parseFloat') at(n, 'parseFloat(');
      if (ts.isPropertyAccessExpression(c) && ts.isIdentifier(c.expression)) {
        const call = `${c.expression.text}.${c.name.text}`;
        if (['Date.now', 'Math.random', 'Number.parseFloat', 'performance.now'].includes(call)) at(n, `${call}(`);
      }
    }
    if (ts.isNewExpression(n) && ts.isIdentifier(n.expression) && n.expression.text === 'Date'
        && (!n.arguments || n.arguments.length === 0)) at(n, 'new Date()');
    if (ts.isIdentifier(n) && n.text === 'LATE_AFTER_HOURS') at(n, 'LATE_AFTER_HOURS');
    if (opts.pure && ts.isNumericLiteral(n) && !UNIT_LITERALS.has(Number(n.text))) at(n, `numeric literal ${n.text}`);
  });
  if (opts.pure) {
    for (const st of sf.statements) {
      if (!ts.isImportDeclaration(st) || !ts.isStringLiteral(st.moduleSpecifier)) continue;
      const spec = st.moduleSpecifier.text;
      if (!(spec.startsWith('./') && !spec.slice(2).includes('/')) && spec !== '@b8/contracts/findings') at(st, `import of ${spec}`);
    }
    const imported = new Set<string>();
    for (const st of sf.statements) {
      if (!ts.isImportDeclaration(st) || !ts.isStringLiteral(st.moduleSpecifier)) continue;
      const b = st.importClause?.namedBindings;
      if (b && ts.isNamedImports(b)) for (const e of b.elements) imported.add(`${(e.propertyName ?? e.name).text}@${st.moduleSpecifier.text}`);
    }
    for (const [name, from] of THRESHOLD_IMPORTS) if (!imported.has(`${name}@${from}`)) out.push(`threshold ${name} not imported from ${from}`);
  }
  for (const t of literalTexts(sf)) if (SQL_CLOCKS.test(t)) out.push(`SQL clock in "${t.trim().slice(0, 40)}"`);
  return out;
}

describe('P5-35 wiring: freshness is pure and single-sourced', () => {
  it('T35-W1: no clock, no parseFloat, no copied threshold and no SQL clock in the freshness modules; fabricated violators are flagged', () => {
    expect(freshnessPurityViolations(parse(FRESHNESS), { pure: true })).toEqual([]);
    expect(freshnessPurityViolations(parse(FRESHNESS_READ), { pure: false })).toEqual([]);
    // Not vacuous: the read module does have SQL literals, and the pure module numeric ones.
    expect(literalTexts(parse(FRESHNESS_READ)).filter((t) => /\bfrom\b/i.test(t)).length).toBeGreaterThanOrEqual(8);
    let numerics = 0;
    walk(parse(FRESHNESS), (n) => { if (ts.isNumericLiteral(n)) numerics++; });
    expect(numerics).toBeGreaterThan(0);

    const imports = THRESHOLD_IMPORTS.map(([n, f], i) => `import { ${n} as T${i} } from '${f}';`).join('\n');
    const pureViolators = [
      `${imports}\nconst t = Date.now();`,
      `${imports}\nconst d = new Date();`,
      `${imports}\nconst d = new Date;`,
      `${imports}\nconst r = Math.random();`,
      `${imports}\nconst n = parseFloat('1.5');`,
      `${imports}\nconst stale = days >= 2;`,
      `${imports}\nconst stale = days >= 30;`,
      `${imports}\nconst stale = hours > 36;`,
      `${imports}\nconst stale = days >= 100;`,
      `${imports}\nconst late = LATE_AFTER_HOURS;`,
      THRESHOLD_IMPORTS.slice(1).map(([n, f], i) => `import { ${n} as T${i} } from '${f}';`).join('\n'),
      `${imports}\nimport db from '../db';`,
      `${imports}\nconst q = 'SELECT NOW()';`,
    ];
    for (const v of pureViolators) {
      expect({ v, flagged: freshnessPurityViolations(fake(v), { pure: true }).length > 0 }).toEqual({ v, flagged: true });
    }
    const readViolators = [
      'const q = `SELECT 1 FROM sync_log WHERE ran_at < NOW()`;',
      "const q = 'SELECT CURRENT_DATE';",
      'const q = `SELECT current_timestamp`;',
      'const q = `SELECT clock_timestamp()`;',
      'const t = Date.now();',
    ];
    for (const v of readViolators) {
      expect({ v, flagged: freshnessPurityViolations(fake(v), { pure: false }).length > 0 }).toEqual({ v, flagged: true });
    }
    const clean = [
      `${imports}\nconst ms = 86_400_000; const x = 1000 * 0 + 1;`,
      `${imports}\nconst d = new Date(Date.UTC(2026, 0, 1));`.replace('2026, 0, 1', 'y, m, d'),
      `${imports}\n// Date.now() and days >= 2 in a comment\nconst x = 1;`,
    ];
    for (const c of clean) expect({ c, v: freshnessPurityViolations(fake(c), { pure: true }) }).toEqual({ c, v: [] });
    expect(freshnessPurityViolations(fake("const q = 'SELECT ran_at FROM sync_log ORDER BY ran_at DESC';"), { pure: false })).toEqual([]);
  });

  it('T35-W2: the backup-rehearsal mismatch and pending proposals are decided — excluded, with reasons', () => {
    const inv = PRODUCER_INVENTORY as Record<string, InventoryEntry>;
    for (const [name, file] of [['CountMismatch', 'lib/backupPlan.ts'], ['StoredProposal', 'lib/domain/proposal.ts']] as const) {
      const e = inv[name];
      expect(e, name).toBeDefined();
      expect(e.file, name).toBe(file);
      expect(e.disposition, name).toBe('excluded');
      expect(e.disposition === 'excluded' && e.reason.trim().length >= 20, name).toBe(true);
      expect(exportsName(fake(readFileSync(join(WEB, file), 'utf8'), basename(file)), name), name).toBe(true);
    }
    // The integrity check covers them too, and would flag an entry pointing at the wrong file.
    expect(inventoryIntegrity(PRODUCER_INVENTORY, readWebSource)).toEqual([]);
    expect(inventoryIntegrity({ CountMismatch: { file: 'lib/domain/proposal.ts', disposition: 'excluded', reason: 'a reason long enough to count' } }, readWebSource))
      .toEqual(['CountMismatch: not exported by lib/domain/proposal.ts']);
  });
});

// ─── W3: viewer safety and containment ─────────────────────────────────────────────────────────

/** The columns a masked row does not carry as stored: every mask entry whose treatment is not `keep`. */
const PROTECTED_COLUMNS = Object.entries(TRANSACTION_COLUMN_MASK).filter(([, t]) => t !== 'keep').map(([c]) => c);

/** What in a read module could carry row text: a protected column in SQL that names `transactions`, or the gift read path. */
export function viewerLeaks(sf: ts.SourceFile): string[] {
  const out: string[] = [];
  for (const t of literalTexts(sf)) {
    if (!/\btransactions\b/i.test(t)) continue;
    for (const c of PROTECTED_COLUMNS) if (new RegExp(`\\b${c}\\b`, 'i').test(t)) out.push(`${c} in a transactions literal`);
    if (/\*/.test(t.replace(/count\s*\(\s*\*\s*\)/gi, ''))) out.push('* in a transactions literal');
  }
  for (const st of sf.statements) {
    if (ts.isImportDeclaration(st) && ts.isStringLiteral(st.moduleSpecifier) && /giftReadPath/.test(st.moduleSpecifier.text)) {
      out.push(`imports ${st.moduleSpecifier.text}`);
    }
  }
  return out;
}

/** Whether a module specifier, seen from `fromRel`, names the finding vocabulary or the freshness read. */
function namesVocabulary(fromRel: string, spec: string): boolean {
  if (spec === '@b8/contracts/findings') return true;
  if (fromRel.startsWith('../../packages/contracts/')) return spec === './findings' || spec === './findings.ts';
  const target = importTarget(fromRel, spec);
  // P5-36: the findings digest's loader is part of what is contained, like the freshness read.
  if (target === 'lib/findingsDigestRead') return true;
  return /^lib\/domain\/findings[A-Za-z]*$/.test(target) || target === 'lib/findingsFreshnessRead';
}

/**
 * The declared importers: the vocabulary modules, the freshness read, and the contract itself; and,
 * from P5-36, the findings digest's loader, its page and its view — the first consumer, and the only
 * one this step declares.
 */
const DIGEST_IMPORTERS = new Set(['lib/findingsDigestRead.ts', 'app/digest/page.tsx', 'components/DigestView.tsx']);
const DECLARED_IMPORTER = (r: string) => DIGEST_IMPORTERS.has(r) ||
  /^lib\/domain\/findings[A-Za-z]*\.ts$/.test(r) || r === 'lib/findingsFreshnessRead.ts' || r === '../../packages/contracts/findings.ts';

/** Non-test files importing the vocabulary that are not declared importers. */
export function undeclaredImporters(files: { rel: string; sf: ts.SourceFile }[]): string[] {
  const out: string[] = [];
  for (const { rel: r, sf } of files) {
    if (DECLARED_IMPORTER(r)) continue;
    for (const st of sf.statements) {
      if ((ts.isImportDeclaration(st) || ts.isExportDeclaration(st)) && st.moduleSpecifier && ts.isStringLiteral(st.moduleSpecifier)
          && namesVocabulary(r, st.moduleSpecifier.text)) out.push(`${r} -> ${st.moduleSpecifier.text}`);
    }
    walk(sf, (n) => {
      if (ts.isCallExpression(n) && n.expression.kind === ts.SyntaxKind.ImportKeyword && n.arguments[0]
          && ts.isStringLiteral(n.arguments[0]) && namesVocabulary(r, n.arguments[0].text)) out.push(`${r} -> import(${n.arguments[0].text})`);
    });
  }
  return out;
}

describe('P5-35 wiring: freshness is viewer-safe and has no consumer', () => {
  it('T35-W3: no protected column in the read module SQL on transactions, no gift read path, and no undeclared importer of the vocabulary', () => {
    // The protected set is derived from the mask, not restated; it includes the obvious ones.
    for (const c of ['merchant_name', 'name', 'note', 'plaid_raw']) expect(PROTECTED_COLUMNS).toContain(c);
    for (const c of ['account_id', 'date', 'mapped_category', 'hidden']) expect(PROTECTED_COLUMNS).not.toContain(c);

    const read = parse(FRESHNESS_READ);
    expect(viewerLeaks(read)).toEqual([]);
    // Not vacuous: the read module does read `transactions`.
    expect(literalTexts(read).some((t) => /\bfrom\s+transactions\b/i.test(t))).toBe(true);

    const leaky = [
      'const q = `SELECT t.merchant_name FROM transactions t`;',
      "const q = 'SELECT t.account_id, t.name FROM transactions t';",
      'const q = `SELECT 1 FROM transactions t WHERE t.note IS NULL`;',
      'const q = `SELECT t.* FROM transactions t`;',
      "import { visibleTransactions } from './giftReadPath';",
      "const q = `SELECT plaid_raw FROM transactions`;",
    ];
    for (const v of leaky) expect({ v, flagged: viewerLeaks(fake(v)).length > 0 }).toEqual({ v, flagged: true });
    const safe = [
      'const q = `SELECT t.account_id, t.date FROM transactions t WHERE t.hidden = FALSE`;',
      "const q = 'SELECT id, name FROM budget_categories';",
      "const q = 'SELECT COUNT(*) FROM transactions';",
    ];
    for (const c of safe) expect({ c, v: viewerLeaks(fake(c)) }).toEqual({ c, v: [] });

    // Containment: nothing outside the declared importers imports the vocabulary or the read.
    const files = [...WEB_SOURCES, ...CONTRACT_SOURCES].map((f) => ({ rel: rel(f), sf: parse(f) }));
    expect(undeclaredImporters(files)).toEqual([]);
    // Not vacuous: the declared importers do import it.
    expect(files.filter((f) => DECLARED_IMPORTER(f.rel)).length).toBeGreaterThanOrEqual(4);
    const consumers = [
      { rel: 'components/DigestCard.tsx', sf: fake("import { assembleFindings } from '@/lib/domain/findings';", 'DigestCard.tsx') },
      { rel: 'app/api/v1/findings/route.ts', sf: fake("import type { Finding } from '@b8/contracts/findings';") },
      { rel: 'lib/digestRead.ts', sf: fake("import { loadFreshnessFacts } from './findingsFreshnessRead';") },
      { rel: 'lib/overviewRead.ts', sf: fake("export { freshnessOf } from './domain/findingsFreshness';") },
      { rel: 'lib/x.ts', sf: fake("const m = import('./domain/findingsInventory');") },
      { rel: '../../packages/contracts/overview.ts', sf: fake("import { FindingSchema } from './findings';") },
    ];
    for (const c of consumers) expect({ c: c.rel, flagged: undeclaredImporters([c]).length > 0 }).toEqual({ c: c.rel, flagged: true });
    expect(undeclaredImporters([{ rel: 'lib/x.ts', sf: fake("import { feedFindings } from './domain/feedHealth';") }])).toEqual([]);
  });
});

// ─── P5-36: the findings digest is pure, thin and contained (W1–W5) ──────────────────────────────

const DIGEST = join(WEB, 'lib/domain/findingsDigest.ts');
const DIGEST_READ = join(WEB, 'lib/findingsDigestRead.ts');
const DIGEST_PAGE = join(WEB, 'app/digest/page.tsx');
const DIGEST_VIEW = join(WEB, 'components/DigestView.tsx');

/**
 * Every non-test file under `scripts/` (`.ts` and `.mjs`) and `instrumentation.ts`: the code that
 * runs outside a request — the daily job, the backup, the boot hook — which the P5-34 scan never
 * read (P5-34 N1). Parsed as TypeScript, which accepts the plain JavaScript of the `.mjs` files.
 */
const SCRIPT_SOURCES = [
  ...readdirSync(join(WEB, 'scripts'))
    .filter((f) => /\.(ts|mjs)$/.test(f) && !/\.test\.ts$/.test(f))
    .map((f) => join(WEB, 'scripts', f)),
  join(WEB, 'instrumentation.ts'),
];

describe('P5-36 wiring: the SQL-clock check, widened', () => {
  it('T36-W1: CURRENT_TIME, LOCALTIME, timeofday() and cast date strings are flagged; known columns and plain values are not; both read modules are clean', () => {
    const flagged = (src: string) => freshnessPurityViolations(fake(src), { pure: false }).length > 0;
    const newFamilies = [
      "const q = 'SELECT CURRENT_TIME';",
      'const q = `SELECT ran_at FROM sync_log WHERE ran_at::time < LOCALTIME`;',
      "const q = 'SELECT timeofday()';",
      `const q = "SELECT 1 WHERE ran_at < 'now'::timestamptz";`,
      `const q = "SELECT 1 WHERE d = 'today'::date";`,
      `const q = "SELECT 1 WHERE d = 'tomorrow' :: date";`,
      `const q = "SELECT 1 WHERE d = 'yesterday'::date";`,
      "const q = `SELECT 1 WHERE ran_at < CAST('now' AS timestamptz)`;",
      "const q = `SELECT cast( 'today' as date)`;",
    ];
    for (const v of newFamilies) expect({ v, flagged: flagged(v) }).toEqual({ v, flagged: true });
    // The families the P5-35 check already knew are still flagged, LOCALTIMESTAMP included.
    const oldFamilies = [
      'const q = `SELECT NOW()`;', "const q = 'SELECT CURRENT_DATE';", 'const q = `SELECT current_timestamp`;',
      'const q = `SELECT clock_timestamp()`;', 'const q = `SELECT LOCALTIMESTAMP`;',
      'const q = `SELECT transaction_timestamp()`;', 'const q = `SELECT statement_timestamp()`;',
    ];
    for (const v of oldFamilies) expect({ v, flagged: flagged(v) }).toEqual({ v, flagged: true });
    const clean = [
      'const q = `SELECT known_at FROM observations`;',
      'const q = `SELECT localtime_name FROM zones`;',
      "const q = `SELECT 1 FROM labels WHERE label = 'today'`;",
      'const q = `SELECT today_total FROM rollups`;',
      "const q = `SELECT 1 FROM labels WHERE label = 'now'`;",
    ];
    for (const c of clean) expect({ c, v: freshnessPurityViolations(fake(c), { pure: false }) }).toEqual({ c, v: [] });

    // The real read modules, the freshness read and the new loader, are clean under the wider check.
    expect(freshnessPurityViolations(parse(FRESHNESS_READ), { pure: false })).toEqual([]);
    expect(freshnessPurityViolations(parse(DIGEST_READ), { pure: false })).toEqual([]);
    // Not vacuous: the loader does carry SQL of its own.
    expect(literalTexts(parse(DIGEST_READ)).some((t) => /\bfrom\s+accounts\b/i.test(t))).toBe(true);
  });
});

describe('P5-36 wiring: severity has one home, widened', () => {
  it('T36-W2: a severity literal reaching a severity key through a lookup table or a helper is flagged; scripts and instrumentation are scanned and clean', () => {
    const violators: [string, string][] = [
      ["const M = { a: 'warning' }; const f = ({ severity: M[k] });", 'q.ts'],
      ["const L = ['notice']; const f = ({ severity: L[0] });", 'r.ts'],
      ["function sev() { return 'warning'; } const f = ({ severity: sev() });", 's.ts'],
      ["const sev = (x: boolean) => (x ? 'warning' : 'notice'); const f = ({ severity: sev(y) });", 't.ts'],
      ["const sev = function () { if (a) return 'critical'; return b; }; finding.severity = sev();", 'u.ts'],
      ["const M = { a: 'warning' } as const; export function C() { return <Badge severity={M[k]} />; }", 'v.tsx'],
      // Dot access into a lookup table (P5-36 G2, mutation M14), plain, `as const`, nested and in JSX.
      ["const LEVELS = { high: 'critical' } as const; export const probe = { severity: LEVELS.high };", 'zz-probe.ts'],
      ["const M = { a: 'warning' }; const f = ({ severity: M.a });", 'da.ts'],
      ["const M = { a: { b: 'notice' } } as const; finding.severity = M.a.b;", 'db.ts'],
      ["const N = { b: 'notice' }; const M = { a: N }; const f = ({ severity: M.a.b });", 'dc.ts'],
      ["const M = { a: 'warning' } as const; export function C() { return <Badge severity={M.a} />; }", 'dd.tsx'],
    ];
    for (const [src, file] of violators) {
      expect({ src, flagged: severityAssignments(fake(src, file)).length > 0 }).toEqual({ src, flagged: true });
    }
    const clean: [string, string][] = [
      ['const f = ({ severity: input.sevs[k] });', 'w.ts'],
      ['function sev(f: { severity: string }) { return f.severity; } const g = ({ severity: sev(x) });', 'x.ts'],
      ["const M = { a: 'high', b: 'low' }; const f = ({ severity: M[k] });", 'y.ts'],
      ["function outer() { const inner = () => 'warning'; return level; } const f = ({ severity: outer() });", 'z.ts'],
      // Dot access into a table whose values, or whose named value, are not severities.
      ["const M = { a: 'high' } as const; const f = ({ severity: M.a });", 'ca.ts'],
      ["const M = { a: 'high', b: 'warning' }; const f = ({ severity: M.a });", 'cb.ts'],
      ["const M = { a: 'high' } as const; export function C() { return <Badge severity={M.a} />; }", 'cc.tsx'],
      ['const f = ({ severity: input.levels.high });', 'cd.ts'],
    ];
    for (const [src, file] of clean) {
      expect({ src, hits: severityAssignments(fake(src, file)) }).toEqual({ src, hits: [] });
    }

    // The widened scan: the P5-34 set plus every non-test script and the boot hook.
    const scanned = [...WEB_SOURCES, ...CONTRACT_SOURCES, ...SCRIPT_SOURCES].filter((f) => !isVocabulary(f));
    expect(scanned.flatMap((f) => severityAssignments(parse(f)).map((h) => `${rel(f)} ${h}`))).toEqual([]);
    expect(SCRIPT_SOURCES.some((f) => rel(f).startsWith('scripts/') && f.endsWith('.ts'))).toBe(true);
    expect(SCRIPT_SOURCES.some((f) => rel(f).startsWith('scripts/') && f.endsWith('.mjs'))).toBe(true);
    expect(scanned.some((f) => rel(f) === 'instrumentation.ts')).toBe(true);
    expect(SCRIPT_SOURCES.every((f) => !/\.test\.ts$/.test(f))).toBe(true);
  });
});

describe('P5-36 wiring: the vocabulary has exactly its declared importers', () => {
  it('T36-W3: only the declared files import the vocabulary, the freshness read or the digest loader; fabricated consumers are flagged', () => {
    const files = [...WEB_SOURCES, ...CONTRACT_SOURCES].map((f) => ({ rel: rel(f), sf: parse(f) }));
    expect(undeclaredImporters(files)).toEqual([]);

    // The five declared consumers outside the vocabulary modules exist and do import it.
    const importsVocabulary = (r: string, sf: ts.SourceFile) => sf.statements.some((st) =>
      (ts.isImportDeclaration(st) || ts.isExportDeclaration(st)) && !!st.moduleSpecifier && ts.isStringLiteral(st.moduleSpecifier)
      && namesVocabulary(r, st.moduleSpecifier.text));
    for (const f of [DIGEST, FRESHNESS_READ, DIGEST_READ, DIGEST_PAGE, DIGEST_VIEW]) {
      expect(existsSync(f), rel(f)).toBe(true);
      expect(importsVocabulary(rel(f), parse(f)), rel(f)).toBe(true);
      expect(DECLARED_IMPORTER(rel(f)), rel(f)).toBe(true);
    }

    const consumers = [
      { rel: 'app/dashboard/page.tsx', sf: fake("import { composeDigest } from '@/lib/domain/findingsDigest';", 'page.tsx') },
      { rel: 'components/AlertBell.tsx', sf: fake("import type { FindingsDigest } from '@/lib/domain/findingsDigest';", 'AlertBell.tsx') },
      { rel: 'components/DigestCard.tsx', sf: fake("import { loadFindingsDigestInput } from '@/lib/findingsDigestRead';", 'DigestCard.tsx') },
      { rel: 'lib/digestRead.ts', sf: fake("import { composeDigest } from './domain/findingsDigest';") },
      { rel: 'lib/overviewRead.ts', sf: fake("import { loadFindingsDigestInput } from './findingsDigestRead';") },
      { rel: 'app/api/v1/digest/route.ts', sf: fake("import { composeDigest } from '@/lib/domain/findingsDigest';") },
      { rel: 'lib/x.ts', sf: fake("const m = import('./domain/findingsDigest');") },
    ];
    for (const c of consumers) expect({ c: c.rel, flagged: undeclaredImporters([c]).length > 0 }).toEqual({ c: c.rel, flagged: true });
    // The email digest's own modules are not the vocabulary: importing them is not flagged here.
    expect(undeclaredImporters([{ rel: 'lib/x.ts', sf: fake("import { loadDigest } from './digestRead';") }])).toEqual([]);
  });
});

/** Literal texts that look like SQL statements. */
const SQL_STATEMENT = /\bselect\b[\s\S]*\bfrom\b|\binsert\s+into\b|\bupdate\s+\w+\s+set\b|\bdelete\s+from\b/i;
const THRESHOLD_NAMES = new Set(['STALE_AFTER_DAYS', 'STALE_AFTER_HOURS', 'VALUATION_STALE_DAYS', 'LATE_AFTER_HOURS']);

/** What in the digest module reads a clock, judges an age, reaches outside its siblings, or writes a severity. */
export function digestPurityViolations(sf: ts.SourceFile): string[] {
  const out: string[] = [];
  const at = (n: ts.Node, what: string) => out.push(`${lineOf(sf, n)} ${what}`);
  for (const st of sf.statements) {
    if (!(ts.isImportDeclaration(st) || ts.isExportDeclaration(st)) || !st.moduleSpecifier || !ts.isStringLiteral(st.moduleSpecifier)) continue;
    const spec = st.moduleSpecifier.text;
    if (!(spec.startsWith('./') && !spec.slice(2).includes('/')) && spec !== '@b8/contracts/findings') at(st, `import of ${spec}`);
  }
  walk(sf, (n) => {
    if (ts.isCallExpression(n)) {
      const c = n.expression;
      if (c.kind === ts.SyntaxKind.ImportKeyword) at(n, 'dynamic import');
      if (ts.isIdentifier(c) && c.text === 'parseFloat') at(n, 'parseFloat(');
      if (ts.isPropertyAccessExpression(c) && ts.isIdentifier(c.expression)) {
        const call = `${c.expression.text}.${c.name.text}`;
        if (['Date.now', 'Math.random', 'Number.parseFloat', 'performance.now'].includes(call)) at(n, `${call}(`);
      }
    }
    if (ts.isNewExpression(n) && ts.isIdentifier(n.expression) && n.expression.text === 'Date'
        && (!n.arguments || n.arguments.length === 0)) at(n, 'new Date()');
    if (ts.isIdentifier(n) && THRESHOLD_NAMES.has(n.text)) at(n, n.text);
    if (ts.isNumericLiteral(n) && n.text !== '0' && n.text !== '1') at(n, `numeric literal ${n.text}`);
  });
  for (const t of literalTexts(sf)) {
    if (SQL_STATEMENT.test(t) || SQL_CLOCKS.test(t)) out.push(`SQL in "${t.trim().slice(0, 40)}"`);
  }
  for (const h of severityAssignments(sf)) out.push(`severity written: ${h}`);
  return out;
}

describe('P5-36 wiring: the digest module is pure', () => {
  it('T36-W4: findingsDigest.ts reads no clock, imports no threshold, has no literal but 0 and 1, no SQL, and writes no severity', () => {
    const sf = parse(DIGEST);
    expect(digestPurityViolations(sf)).toEqual([]);
    expect(severityAssignments(sf)).toEqual([]);
    // Not vacuous: the module does have numeric literals and imports, all of the allowed kind.
    let numerics = 0;
    walk(sf, (n) => { if (ts.isNumericLiteral(n)) numerics++; });
    expect(numerics).toBeGreaterThan(0);
    expect(sf.statements.filter(ts.isImportDeclaration).length).toBeGreaterThanOrEqual(2);

    const violators = [
      'const t = Date.now();',
      'const d = new Date();',
      'const d = new Date;',
      'const r = Math.random();',
      "const n = parseFloat('1.5');",
      'const t = performance.now();',
      "import { STALE_AFTER_DAYS } from './syncHealth';",
      "import { STALE_AFTER_HOURS as H } from './feedHealth';",
      "import { STALE_AFTER_DAYS as W } from './walletStaleness';",
      "import { VALUATION_STALE_DAYS } from './valuationStaleness';",
      "import { LATE_AFTER_HOURS } from './jobHealth';",
      "import db from '../db';",
      "import { x } from './sub/module';",
      "import type { OverviewData } from '@b8/contracts/overview';",
      'const stale = days >= 2;',
      'const n = 9;',
      "const q = 'SELECT id FROM accounts';",
      "const q = `SELECT NOW()`;",
      "const f = { severity: 'warning' };",
      "const m = import('./findings');",
    ];
    for (const v of violators) expect({ v, flagged: digestPurityViolations(fake(v)).length > 0 }).toEqual({ v, flagged: true });
    const clean = [
      "import { FINDING_SOURCES, type FindingSource } from './findings';",
      "import { SeveritySchema, type Finding } from '@b8/contracts/findings';",
      'const one = n === 1 ? 0 : 1;',
      "const rank = (f: { severity: string }) => order.indexOf(f.severity);",
      "const s = `${n} days ago, from the last selected source`;",
      '// Date.now() and STALE_AFTER_DAYS in a comment\nconst x = 0;',
    ];
    for (const c of clean) expect({ c, v: digestPurityViolations(fake(c)) }).toEqual({ c, v: [] });
  });
});

const SEVERITY_WORD = /\b(critical|warning|notice)\b/i;
const ALL_CLEAR = /all clear|good news|nothing to report|no issues|all good|on track|nothing wrong|healthy|up to date|up-to-date/i;
/** What the page may import, as targets under apps/web or bare packages. */
const PAGE_IMPORTS = new Set(['components/DigestView', 'lib/domain/findingsDigest', 'lib/domain/monthOutlook', 'lib/findingsDigestRead', 'lib/giftViewer']);

/** What in the page or the view computes a figure, reads a clock, words a severity or reaches the database. */
export function thinViolations(sf: ts.SourceFile, fromRel: string, role: 'page' | 'view' | 'loader'): string[] {
  const out: string[] = [];
  const at = (n: ts.Node, what: string) => out.push(`${lineOf(sf, n)} ${what}`);
  let zeroArgDates = 0;
  const calls = new Set<string>();
  for (const st of sf.statements) {
    if (!ts.isImportDeclaration(st) || !ts.isStringLiteral(st.moduleSpecifier)) continue;
    const spec = st.moduleSpecifier.text;
    const target = importTarget(fromRel, spec);
    if (/giftReadPath/.test(spec)) at(st, `imports ${spec}`);
    const names = st.importClause?.namedBindings && ts.isNamedImports(st.importClause.namedBindings)
      ? st.importClause.namedBindings.elements.map((e) => (e.propertyName ?? e.name).text) : [];
    if (names.includes('visibleTransactions')) at(st, 'imports visibleTransactions');
    if (role === 'page' && !PAGE_IMPORTS.has(target) && !/^(react|next)(\/|$)/.test(target)) at(st, `page imports ${spec}`);
    if (role === 'view' && (target === 'lib/db' || target === 'pg' || /Read$/.test(target))) at(st, `view imports ${spec}`);
  }
  walk(sf, (n) => {
    if (ts.isIdentifier(n) && n.text === 'visibleTransactions') at(n, 'visibleTransactions');
    if (role === 'loader') return;
    if (ts.isCallExpression(n)) {
      const c = n.expression;
      if (ts.isIdentifier(c)) {
        calls.add(c.text);
        if (c.text === 'parseFloat' || c.text === 'Number') at(n, `${c.text}(`);
      }
      if (ts.isPropertyAccessExpression(c)) {
        calls.add(c.name.text);
        if (c.name.text === 'toFixed') at(n, '.toFixed(');
        if (ts.isIdentifier(c.expression)) {
          const call = `${c.expression.text}.${c.name.text}`;
          if (['Math.abs', 'Math.round', 'Date.now', 'performance.now', 'Number.parseFloat'].includes(call)) at(n, `${call}(`);
        }
      }
    }
    if (ts.isPropertyAccessExpression(n) && ts.isIdentifier(n.expression) && n.expression.text === 'Intl' && n.name.text === 'NumberFormat') {
      at(n, 'Intl.NumberFormat');
    }
    if (ts.isNewExpression(n) && ts.isIdentifier(n.expression) && n.expression.text === 'Date') {
      if (!n.arguments || n.arguments.length === 0) zeroArgDates++;
      if (role === 'view') at(n, 'new Date');
    }
    if (ts.isStringLiteral(n) || ts.isNoSubstitutionTemplateLiteral(n) || ts.isJsxText(n) || ts.isTemplateHead(n)
        || ts.isTemplateMiddle(n) || ts.isTemplateTail(n)) {
      if (ts.isImportDeclaration(n.parent)) return;
      if (SEVERITY_WORD.test(n.text)) at(n, `severity word in "${n.text.trim().slice(0, 30)}"`);
      if (ALL_CLEAR.test(n.text)) at(n, `all-clear phrase in "${n.text.trim().slice(0, 30)}"`);
    }
  });
  if (role === 'page') {
    if (zeroArgDates !== 1) out.push(`${zeroArgDates} clock reads, expected exactly one`);
    for (const fn of ['pageViewer', 'loadFindingsDigestInput', 'composeDigest']) if (!calls.has(fn)) out.push(`does not call ${fn}`);
    const def = sf.statements.filter(ts.isFunctionDeclaration)
      .find((st) => (ts.getModifiers(st) ?? []).some((m) => m.kind === ts.SyntaxKind.DefaultKeyword));
    if (!def || !(ts.getModifiers(def) ?? []).some((m) => m.kind === ts.SyntaxKind.AsyncKeyword)) out.push('no default async export');
    const dynamic = sf.statements.some((st) => ts.isVariableStatement(st)
      && (ts.getModifiers(st) ?? []).some((m) => m.kind === ts.SyntaxKind.ExportKeyword)
      && st.declarationList.declarations.some((d) => ts.isIdentifier(d.name) && d.name.text === 'dynamic'
        && !!d.initializer && ts.isStringLiteral(d.initializer) && d.initializer.text === 'force-dynamic'));
    if (!dynamic) out.push("no export const dynamic = 'force-dynamic'");
  }
  return out;
}

describe('P5-36 wiring: the page and the view are thin', () => {
  it('T36-W5: the page has one clock read, calls the viewer, the loader and composeDigest, and reaches no database; neither page nor view computes a figure or words a severity', () => {
    expect(thinViolations(parse(DIGEST_PAGE), rel(DIGEST_PAGE), 'page')).toEqual([]);
    expect(thinViolations(parse(DIGEST_VIEW), rel(DIGEST_VIEW), 'view')).toEqual([]);
    // No file of the digest reads the gift read path or masks a figure per viewer.
    for (const f of [DIGEST, DIGEST_READ]) expect(thinViolations(parse(f), rel(f), 'loader'), rel(f)).toEqual([]);
    expect(viewerLeaks(parse(DIGEST_READ))).toEqual([]);

    const page = (body: string) => `export const dynamic = 'force-dynamic';
import DigestView from '@/components/DigestView';
import { composeDigest } from '@/lib/domain/findingsDigest';
import { loadFindingsDigestInput } from '@/lib/findingsDigestRead';
import { pageViewer } from '@/lib/giftViewer';
export default async function P() {
  const now = new Date();
  const { findings, notEvaluated, period } = await loadFindingsDigestInput(await pageViewer('/digest'), now);
  ${body}
  return <DigestView digest={composeDigest(findings, period, { notEvaluated })} />;
}`;
    const pageFile = 'app/digest/page.tsx';
    const flaggedPage = (src: string) => thinViolations(fake(src, 'page.tsx'), pageFile, 'page').length > 0;
    expect(thinViolations(fake(page(''), 'page.tsx'), pageFile, 'page')).toEqual([]);
    const pageViolators = [
      page('const later = new Date();'),
      page('const t = Date.now();'),
      page('const x = Math.abs(-1);'),
      page("const x = Number('1');"),
      page("const label = 'warning';"),
      page("const label = 'all clear';"),
      page('const f = new Intl.NumberFormat();'),
      `import db from '@/lib/db';\n${page('')}`,
      `import { Pool } from 'pg';\n${page('')}`,
      `import { visibleTransactions } from '@/lib/giftReadPath';\n${page('')}`,
      `import { loadFeedHealth } from '@/lib/feedHealthRead';\n${page('')}`,
      `import { asOfDate } from '@/lib/domain/findings';\n${page('')}`,
      page('').replace("export const dynamic = 'force-dynamic';", ''),
      page('').replace('export default async function', 'export default function'),
      page('').replace("await pageViewer('/digest')", 'null'),
    ];
    for (const v of pageViolators) expect({ v, flagged: flaggedPage(v) }).toEqual({ v, flagged: true });

    const viewFile = 'components/DigestView.tsx';
    const flaggedView = (src: string) => thinViolations(fake(src, 'DigestView.tsx'), viewFile, 'view').length > 0;
    const viewViolators = [
      'export default function V({ v }: { v: string }) { return <p>{Math.round(1.5)}</p>; }',
      'export default function V({ v }: { v: string }) { return <p>{parseFloat(v)}</p>; }',
      'export default function V({ v }: { v: string }) { return <p>{(1).toFixed(2)}</p>; }',
      'export default function V() { return <p>{new Date().getFullYear()}</p>; }',
      'export default function V() { return <p>{Date.now()}</p>; }',
      "export default function V() { return <p>{'notice'}</p>; }",
      'export default function V() { return <p>Nothing wrong today</p>; }',
      "import db from '@/lib/db';\nexport default function V() { return <p />; }",
    ];
    for (const v of viewViolators) expect({ v, flagged: flaggedView(v) }).toEqual({ v, flagged: true });
    const viewClean = "const T: Record<string, string> = { critical: 'border-red-200' };\nexport default function V({ s }: { s: string }) { return <p className={T[s]}>{s}</p>; }";
    expect(thinViolations(fake(viewClean, 'DigestView.tsx'), viewFile, 'view')).toEqual([]);

    const loaderLeak = "import { visibleTransactions } from './giftReadPath';\nconst rows = visibleTransactions(viewer);";
    expect(thinViolations(fake(loaderLeak), 'lib/findingsDigestRead.ts', 'loader').length).toBeGreaterThan(0);
  });
});
