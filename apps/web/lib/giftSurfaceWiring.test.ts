// P7-41b — the masking is wired the way the pure tests and the read path assume it is (W1–W13).
//
// `giftMask.test.ts` proves the masked projection leaks nothing. That proves nothing about a page if
// the page reads `t.merchant_name` from `transactions` beside it. Which file reads what, which file
// writes rows, which route sets which header — those are properties of the SOURCE, so they are
// asserted over the AST with the TypeScript compiler API, the way `enrichedDisplayWiring.test.ts`
// does for the enriched rows.
//
// AN AST, NOT A GREP (BUILD.md A10). SQL is collected from string and template literals as the
// compiler parses them, with `${IDENT}` resolved to the literal a same-file constant holds and a `+`
// of literals joined — so SQL split across a constant or a concatenation is read whole, and SQL in a
// comment is not read at all.
//
// EVERY CHECKER IS ALSO RUN AGAINST FABRICATED SOURCES that break its rule and against clean ones,
// so a checker that silently matches nothing cannot pass the real tree by accident.

import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';
import { describe, expect, it } from 'vitest';
import {
  EXEMPT_FILES,
  GUARDED_WRITERS,
  PAGES,
  READ_PATH_FILES,
  READ_PATH_PREDICATES,
  ROUTES,
  type Surface,
} from './giftSurfaceRegistry';

const WEB = fileURLToPath(new URL('..', import.meta.url));
const rel = (f: string) => relative(WEB, f).split('\\').join('/');

function parseText(file: string, text: string): ts.SourceFile {
  return ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true, file.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
}
const parse = (file: string) => parseText(file, readFileSync(file, 'utf8'));

function walk(node: ts.Node, visit: (n: ts.Node) => void): void {
  visit(node);
  ts.forEachChild(node, (c) => walk(c, visit));
}

/** Every `.ts`/`.tsx` under `dir`, recursively. */
function filesUnder(dir: string): string[] {
  return (readdirSync(join(WEB, dir), { recursive: true }) as string[])
    .filter((f) => /\.tsx?$/.test(f))
    .map((f) => join(WEB, dir, f));
}

/** Tests, kits and setup files are not the app — they are excluded from the source scans. */
const isAppSource = (f: string) =>
  !/\.test\.tsx?$/.test(f) && !/TestKit\.ts$/.test(f) && !/TestFixtures\.ts$/.test(f) && !/\.setup\.ts$/.test(f);

const SOURCES = ['app', 'lib', 'components'].flatMap(filesUnder).filter(isAppSource);

// ─── SQL extraction ─────────────────────────────────────────────────────────────────────────────

/** A row source a call produces, written into extracted SQL where `${visibleTransactions(…)}` sat. */
const VIEW = '__VISIBLE_TRANSACTIONS__';
/** Anything else interpolated that cannot be resolved to a literal. */
const OPAQUE = '__OPAQUE__';

/**
 * The SQL-bearing texts of a file. Each string literal and each template literal is one text, with
 * `${x}` replaced by the literal a same-file `const x` holds (recursively), by `VIEW` when the
 * expression is — or names a constant initialised by — a call to `visibleTransactions`, and by
 * `OPAQUE` otherwise. A `+` chain whose leaves are all literals or resolvable constants is one text.
 */
function sqlTexts(sf: ts.SourceFile): string[] {
  const consts = new Map<string, ts.Expression>();
  walk(sf, (n) => {
    if (ts.isVariableDeclaration(n) && ts.isIdentifier(n.name) && n.initializer
        && ts.isVariableDeclarationList(n.parent) && (n.parent.flags & ts.NodeFlags.Const)) {
      consts.set(n.name.text, n.initializer);
    }
  });
  const isViewCall = (e: ts.Expression): boolean =>
    ts.isCallExpression(e) && ts.isIdentifier(e.expression) && e.expression.text === 'visibleTransactions';

  const resolve = (e: ts.Expression, depth = 0): string | null => {
    if (depth > 8) return null;
    if (ts.isParenthesizedExpression(e)) return resolve(e.expression, depth + 1);
    if (ts.isStringLiteral(e) || ts.isNoSubstitutionTemplateLiteral(e)) return e.text;
    if (ts.isTemplateExpression(e)) {
      let out = e.head.text;
      for (const span of e.templateSpans) out += substitute(span.expression, depth) + span.literal.text;
      return out;
    }
    if (ts.isBinaryExpression(e) && e.operatorToken.kind === ts.SyntaxKind.PlusToken) {
      const l = resolve(e.left, depth + 1);
      const r = resolve(e.right, depth + 1);
      return l === null || r === null ? null : l + r;
    }
    if (ts.isIdentifier(e)) {
      const init = consts.get(e.text);
      return init ? resolve(init, depth + 1) : null;
    }
    return null;
  };
  const substitute = (e: ts.Expression, depth: number): string => {
    if (isViewCall(e)) return ` ${VIEW} `;
    if (ts.isIdentifier(e)) {
      const init = consts.get(e.text);
      if (init && isViewCall(init)) return ` ${VIEW} `;
    }
    const r = resolve(e, depth + 1);
    return r === null ? ` ${OPAQUE} ` : r;
  };

  const out: string[] = [];
  walk(sf, (n) => {
    // The outermost `+` chain is read whole; its parts are also literals and are read on their own,
    // which is harmless — a fragment with no FROM touches no table.
    if (ts.isBinaryExpression(n) && n.operatorToken.kind === ts.SyntaxKind.PlusToken
        && !(ts.isBinaryExpression(n.parent) && n.parent.operatorToken.kind === ts.SyntaxKind.PlusToken)) {
      const r = resolve(n);
      if (r !== null) out.push(r);
    }
    if (ts.isStringLiteral(n) || ts.isNoSubstitutionTemplateLiteral(n) || ts.isTemplateExpression(n)) {
      if (ts.isImportDeclaration(n.parent) || ts.isExportDeclaration(n.parent)) return;
      const r = resolve(n);
      if (r !== null) out.push(r);
    }
  });
  return out;
}

// ─── The protected-read detector (W1, W2) ──────────────────────────────────────────────────────

/**
 * The columns a masked row may not carry, as `TRANSACTION_COLUMN_MASK` says — minus `watched_at`,
 * which figures read legitimately (the drill-down's `pending` and the outlook's grading sum by it).
 * A surface that SHOWS the flag also shows the row's label, and is caught on that.
 */
const PROTECTED = [
  'name', 'merchant_name', 'plaid_category', 'plaid_category_detailed', 'plaid_category_confidence',
  'authorized_date', 'payment_channel', 'merchant_entity_id', 'logo_url', 'website',
  'location_city', 'location_region', 'location_country', 'plaid_raw', 'note', 'plaid_transaction_id',
];

const KEYWORDS = new Set([
  'where', 'join', 'left', 'right', 'inner', 'outer', 'full', 'cross', 'natural', 'on', 'using', 'group',
  'order', 'limit', 'set', 'returning', 'union', 'and', 'or', 'as', 'having', 'for', 'window', 'offset',
]);

export interface Finding { kind: 'read' | 'write'; detail: string }

/** Comments dropped, so prose that names a column is not a read of it. */
const stripComments = (sql: string) => sql.replace(/--[^\n]*/g, ' ').replace(/\/\*[\s\S]*?\*\//g, ' ');

/** The aliases under which `transactions` itself (not the masked row source) is read in `sql`. */
function rawAliases(sql: string): Set<string> {
  const aliases = new Set<string>();
  const re = /\b(?:from|join|update|delete\s+from)\s+transactions\b(?:\s+(?:as\s+)?([a-z_][a-z0-9_]*))?/gi;
  for (let m = re.exec(sql); m; m = re.exec(sql)) {
    aliases.add('transactions');
    const a = m[1]?.toLowerCase();
    if (a && !KEYWORDS.has(a)) aliases.add(a);
  }
  return aliases;
}

/** What one SQL text reads of `transactions` that it may not. */
export function protectedReads(rawSql: string): Finding[] {
  const sql = stripComments(rawSql);
  const aliases = rawAliases(sql);
  if (aliases.size === 0) return [];
  const kind: Finding['kind'] = /^\s*(?:with\b[\s\S]*?\)\s*)?(update|delete)\b/i.test(sql) || /\bupdate\s+transactions\b|\bdelete\s+from\s+transactions\b/i.test(sql)
    ? 'write' : 'read';
  const found: string[] = [];
  const cols = PROTECTED.join('|');
  for (const a of aliases) {
    const q = a.replace(/[^a-z0-9_]/gi, '');
    for (const m of sql.matchAll(new RegExp(`\\b${q}\\s*\\.\\s*(${cols}|\\*)(?![a-z0-9_])`, 'gi'))) found.push(`${a}.${m[1]}`);
    if (new RegExp(`\\b(?:to_jsonb|row_to_json|to_json|jsonb_build_object\\s*\\(\\s*\\*)\\s*\\(\\s*${q}\\s*\\)`, 'i').test(sql)) found.push(`json(${a})`);
    if (new RegExp(`\\b${q}\\s*::\\s*text\\b`, 'i').test(sql)) found.push(`${a}::text`);
  }
  if (/\bplaid_raw\b/i.test(sql)) found.push('plaid_raw');
  if (/\bselect\s+\*/i.test(sql)) found.push('SELECT *');
  // A protected column named bare: unqualified, and not the output name after AS.
  for (const m of sql.matchAll(new RegExp(`(?<![.\\w])(${cols})(?![\\w(])`, 'gi'))) {
    const before = sql.slice(0, m.index).trimEnd();
    if (/\bas$/i.test(before)) continue;
    found.push(`bare ${m[1]}`);
  }
  return [...new Set(found)].map((detail) => ({ kind, detail }));
}

/**
 * Fragments: a literal that names `X.<protected>` without a FROM of its own — a WHERE condition
 * pushed into an array, say — read in a file that reads `transactions` itself as `X` and never binds
 * `X` to the masked row source. Such a fragment can only be joined into a raw read.
 */
function fragmentReads(texts: string[]): Finding[] {
  const raw = new Set<string>();
  const viewed = new Set<string>();
  for (const t of texts) {
    const sql = stripComments(t);
    for (const a of rawAliases(sql)) raw.add(a);
    for (const m of sql.matchAll(new RegExp(`${VIEW}\\s+(?:as\\s+)?([a-z_][a-z0-9_]*)`, 'gi'))) viewed.add(m[1].toLowerCase());
  }
  const out: Finding[] = [];
  for (const t of texts) {
    const sql = stripComments(t);
    if (/\b(from|join)\b/i.test(sql)) continue;
    for (const a of raw) {
      if (viewed.has(a)) continue;
      for (const m of sql.matchAll(new RegExp(`\\b${a}\\s*\\.\\s*(${PROTECTED.join('|')})\\b`, 'gi'))) {
        out.push({ kind: 'read', detail: `fragment ${a}.${m[1]}` });
      }
    }
  }
  return out;
}

/** Every protected read in a source file. */
export function findingsIn(sf: ts.SourceFile): Finding[] {
  const texts = sqlTexts(sf);
  return [...texts.flatMap(protectedReads), ...fragmentReads(texts)];
}

/** Whether a file writes viewer-visible columns of rows, or deletes rows (W12). */
function writesRows(sf: ts.SourceFile): boolean {
  return sqlTexts(sf).map(stripComments).some((sql) =>
    /\bdelete\s+from\s+transactions\b/i.test(sql)
    || (/\bupdate\s+transactions\b/i.test(sql)
        && /\bset\b[\s\S]*\b(mapped_category|hidden|note|watched_at|property_id|transfer_group_id)\s*=/i.test(sql)));
}

// ─── Fabricated sources for the detector ───────────────────────────────────────────────────────

const fake = (body: string) => parseText('fake.ts', body);

describe('the detector catches what it is meant to (fabricated sources)', () => {
  it('T41b-W2: every fabricated protected read is flagged, and clean sources yield nothing', () => {
    const violators = [
      'const q = `SELECT t.merchant_name FROM transactions t`;',
      "const LABEL = 'COALESCE(t.merchant_name, t.name)'; const q = `SELECT ${LABEL} FROM transactions t`;",
      "const q = 'SELECT * FROM transactions WHERE id = $1';",
      'const q = `SELECT t.* FROM transactions t JOIN accounts a ON a.id = t.account_id`;',
      'const q = `SELECT to_jsonb(t) FROM transactions t`;',
      'const q = `SELECT row_to_json(t) FROM transactions t`;',
      'const q = `SELECT t::text FROM transactions t`;',
      'const q = `SELECT t.plaid_raw FROM transactions t`;',
      "const q = `SELECT COALESCE(NULLIF(t.name, ''), 'x') FROM transactions t`;",
      "const q = 'SELECT t.merch' + 'ant_name FROM trans' + 'actions t';",
      'const q = `SELECT t.id FROM transactions t JOIN transactions t2 ON t2.id = t.id WHERE t2.note IS NULL`;',
      "const q = 'SELECT name, merchant_name FROM transactions WHERE id = $1';",
      // A WHERE fragment joined at runtime into a raw read of the same alias.
      "const conds = ['t.merchant_name ILIKE $1']; const q = `SELECT t.id FROM transactions t WHERE ${conds.join(' AND ')}`;",
    ];
    for (const v of violators) {
      expect({ v, flagged: findingsIn(fake(v)).length > 0 }).toEqual({ v, flagged: true });
    }
    const clean = [
      'const q = `SELECT a.name FROM accounts a`;',
      'const q = `SELECT SUM(t.amount) FROM transactions t JOIN accounts a ON a.id = t.account_id WHERE a.name = $1`;',
      'const q = `SELECT t.name, t.merchant_name, t.note FROM ${visibleTransactions(viewer)} t`;',
      'const rows = visibleTransactions(viewer); const q = `SELECT t.merchant_name FROM ${rows} t`;',
      "const q = 'SELECT COUNT(*) AS name FROM transactions';",
      '// SELECT t.merchant_name FROM transactions t\nconst q = 1;',
    ];
    for (const c of clean) expect({ c, findings: findingsIn(fake(c)) }).toEqual({ c, findings: [] });
  });
});

// ─── W1, W3: the real tree ──────────────────────────────────────────────────────────────────────

describe('no surface reads a row\'s text around the read path (AST)', () => {
  it('T41b-W1: no non-test source under app, lib or components reads a protected column of transactions outside the read path, the exempt list and the guarded writers\' own writes', () => {
    const allowed = new Set([...READ_PATH_FILES, ...EXEMPT_FILES.map((e) => e.file)]);
    const writers = new Set(GUARDED_WRITERS.map((w) => w.file));
    const offenders: { file: string; findings: string[] }[] = [];
    for (const f of SOURCES) {
      const file = rel(f);
      if (allowed.has(file)) continue;
      const findings = findingsIn(parse(f)).filter((x) => !(x.kind === 'write' && writers.has(file)));
      if (findings.length) offenders.push({ file, findings: findings.map((x) => x.detail) });
    }
    expect(offenders).toEqual([]);
    // Not vacuous: the exempt ingest is seen by the detector reading `transactions` directly, and so
    // are the guarded writers' own writes.
    expect(findingsIn(parse(join(WEB, 'lib/sync.ts'))).length).toBeGreaterThan(0);
    expect(findingsIn(parse(join(WEB, 'app/api/v1/rules/apply/route.ts'))).map((x) => x.kind)).toContain('write');
    // And the scan covered the tree.
    expect(SOURCES.length).toBeGreaterThan(100);
  });

  it('T41b-W3: every exempt entry names a real file with a reason, and none is a route, a page or a component', () => {
    expect(EXEMPT_FILES.map((e) => e.file)).toEqual(['lib/sync.ts']);
    for (const e of EXEMPT_FILES) {
      expect(existsSync(join(WEB, e.file))).toBe(true);
      expect(e.reason.trim().length).toBeGreaterThan(20);
      expect(/(^|\/)(route\.ts|page\.tsx)$/.test(e.file) || e.file.startsWith('components/')).toBe(false);
    }
    // The checker refuses a blanket exemption shape: fabricated entries of each forbidden kind.
    const bad = ['app/api/v1/overview/route.ts', 'app/transactions/page.tsx', 'components/TransactionTable.tsx'];
    for (const b of bad) expect(/(^|\/)(route\.ts|page\.tsx)$/.test(b) || b.startsWith('components/')).toBe(true);
  });
});

// ─── W4: the registry ───────────────────────────────────────────────────────────────────────────

function registryProblems(found: string[], registry: Surface[]): string[] {
  const listed = new Map(registry.map((s) => [s.file, s]));
  const out: string[] = [];
  for (const f of found) if (!listed.has(f)) out.push(`unclassified ${f}`);
  for (const s of registry) {
    if (!found.includes(s.file)) out.push(`listed but missing ${s.file}`);
    if (s.classes.length === 0) out.push(`no class ${s.file}`);
    if ((s.classes.includes('text-bearing') || s.classes.includes('guarded-write')) && !/^[A-Z]\d+$/.test(s.scenario ?? '')) {
      out.push(`no scenario ${s.file}`);
    }
  }
  return out;
}

describe('every page and route is classified (W4)', () => {
  it('T41b-W4: the registry lists exactly the route.ts files under app/api/v1 and the page.tsx files under app, each with a class and, where text-bearing, its scenario', () => {
    const routes = filesUnder('app/api/v1').filter((f) => f.endsWith('/route.ts')).map(rel).sort();
    const pages = filesUnder('app').filter((f) => f.endsWith('/page.tsx')).map(rel).sort();
    expect(registryProblems(routes, ROUTES)).toEqual([]);
    expect(registryProblems(pages, PAGES)).toEqual([]);
    expect(routes.length).toBeGreaterThan(40);
    expect(pages.length).toBeGreaterThan(15);
    // The checker itself: an unlisted file, and a text-bearing entry with no scenario, are named.
    expect(registryProblems([...routes, 'app/api/v1/export/route.ts'], ROUTES)).toEqual(['unclassified app/api/v1/export/route.ts']);
    expect(registryProblems(['x/route.ts'], [{ file: 'x/route.ts', classes: ['text-bearing'] }])).toEqual(['no scenario x/route.ts']);
  });
});

// ─── W5: no export ──────────────────────────────────────────────────────────────────────────────

/** String literals in a route that would make it a file download. */
function exportHeaders(sf: ts.SourceFile): string[] {
  const out: string[] = [];
  walk(sf, (n) => {
    if ((ts.isStringLiteral(n) || ts.isNoSubstitutionTemplateLiteral(n) || ts.isTemplateHead(n) || ts.isTemplateMiddle(n) || ts.isTemplateTail(n))
        && /content-disposition|text\/csv|application\/(octet-stream|vnd\.|pdf|zip)|attachment;/i.test(n.text)) {
      out.push(n.text.slice(0, 60));
    }
  });
  return out;
}

describe('there is no export surface (W5)', () => {
  it('T41b-W5: no route.ts sets Content-Disposition, text/csv or a file content type, and a fabricated one is flagged', () => {
    const routes = filesUnder('app').filter((f) => f.endsWith('/route.ts'));
    expect(routes.map((f) => ({ file: rel(f), headers: exportHeaders(parse(f)) })).filter((r) => r.headers.length)).toEqual([]);
    expect(exportHeaders(fake("return new Response(csv, { headers: { 'Content-Disposition': 'attachment; filename=x.csv' } });"))).not.toEqual([]);
    expect(exportHeaders(fake("return new Response(csv, { headers: { 'content-type': 'text/csv' } });"))).not.toEqual([]);
    expect(exportHeaders(fake("return Response.json({ ok: true });"))).toEqual([]);
  });
});

// ─── W6: push stays content-free ───────────────────────────────────────────────────────────────

/** `fetch(...)` calls whose init object has a `body` (or a spread that could carry one). */
function fetchBodies(sf: ts.SourceFile): string[] {
  const out: string[] = [];
  walk(sf, (n) => {
    if (!ts.isCallExpression(n) || !ts.isIdentifier(n.expression) || n.expression.text !== 'fetch') return;
    const init = n.arguments[1];
    if (!init) return;
    if (!ts.isObjectLiteralExpression(init)) { out.push('init is not an object literal'); return; }
    for (const p of init.properties) {
      if (ts.isSpreadAssignment(p)) out.push('spread in init');
      else if (p.name && p.name.getText(sf).replace(/['"]/g, '') === 'body') out.push('body');
    }
  });
  return out;
}

/** Violations in a service worker's push handler: `event.data`, or a non-constant notification argument. */
function pushHandlerProblems(sf: ts.SourceFile): string[] {
  const out: string[] = [];
  const constObjects = new Set<string>();
  walk(sf, (n) => {
    if (ts.isVariableDeclaration(n) && ts.isIdentifier(n.name) && n.initializer && ts.isObjectLiteralExpression(n.initializer)
        && (n.parent.flags & ts.NodeFlags.Const)
        && n.initializer.properties.every((p) => ts.isPropertyAssignment(p) && ts.isStringLiteral(p.initializer))) {
      constObjects.add(n.name.text);
    }
  });
  let handlers = 0;
  walk(sf, (n) => {
    if (!ts.isCallExpression(n) || !ts.isPropertyAccessExpression(n.expression) || n.expression.name.text !== 'addEventListener') return;
    const [type, handler] = n.arguments;
    if (!type || !ts.isStringLiteral(type) || type.text !== 'push' || !handler) return;
    handlers++;
    walk(handler, (m) => {
      if (ts.isPropertyAccessExpression(m) && m.name.text === 'data') out.push('reads event.data');
      if (ts.isCallExpression(m) && ts.isPropertyAccessExpression(m.expression) && m.expression.name.text === 'showNotification') {
        const leaves: ts.Expression[] = [];
        for (const a of m.arguments) {
          if (ts.isObjectLiteralExpression(a)) {
            for (const p of a.properties) if (ts.isPropertyAssignment(p)) leaves.push(p.initializer); else out.push('non-literal option');
          } else leaves.push(a);
        }
        for (const l of leaves) {
          const ok = ts.isStringLiteral(l) || l.kind === ts.SyntaxKind.TrueKeyword || l.kind === ts.SyntaxKind.FalseKeyword
            || (ts.isPropertyAccessExpression(l) && ts.isIdentifier(l.expression) && constObjects.has(l.expression.text));
          if (!ok) out.push(`non-constant argument ${l.getText(sf).slice(0, 40)}`);
        }
      }
    });
  });
  if (handlers === 0) out.push('no push handler');
  return out;
}

describe('push stays content-free (W6)', () => {
  it('T41b-W6: the web push request has no body, and the service worker shows only constants and never reads event.data', () => {
    const webPush = parse(join(WEB, 'lib/webPush.ts'));
    let fetches = 0;
    walk(webPush, (n) => { if (ts.isCallExpression(n) && ts.isIdentifier(n.expression) && n.expression.text === 'fetch') fetches++; });
    expect(fetches).toBeGreaterThan(0);
    expect(fetchBodies(webPush)).toEqual([]);
    const sw = parseText('sw.js', readFileSync(join(WEB, 'public/sw.js'), 'utf8'));
    expect(pushHandlerProblems(sw)).toEqual([]);
    // Fabricated violators.
    expect(fetchBodies(fake("await fetch(endpoint, { method: 'POST', body: label });"))).toEqual(['body']);
    expect(fetchBodies(fake("await fetch(endpoint, { method: 'POST', ...extra });"))).toEqual(['spread in init']);
    expect(pushHandlerProblems(fake("self.addEventListener('push', (event) => { const t = event.data.text(); self.registration.showNotification(t); });")).length).toBeGreaterThan(0);
    expect(pushHandlerProblems(fake("const P = { title: 'b8' }; self.addEventListener('push', (e) => { e.waitUntil(self.registration.showNotification(P.title, { body: merchant })); });"))).toHaveLength(1);
    expect(pushHandlerProblems(fake("const P = { title: 'b8', body: 'x' }; self.addEventListener('push', (e) => { e.waitUntil(self.registration.showNotification(P.title, { body: P.body, tag: 't', renotify: true })); });"))).toEqual([]);
  });
});

// ─── W7: digest image inputs carry no row text ─────────────────────────────────────────────────

const ROW_TEXT_PROPS = new Set(['label', 'merchant', 'name', 'note', 'description', 'memo', 'payee']);

/** Row-text property names reachable in `type`, recursively through objects, arrays and unions. */
function rowTextProps(checker: ts.TypeChecker, type: ts.Type, seen = new Set<ts.Type>()): string[] {
  if (seen.has(type)) return [];
  seen.add(type);
  const out: string[] = [];
  if (type.isUnionOrIntersection()) for (const t of type.types) out.push(...rowTextProps(checker, t, seen));
  const index = checker.getIndexTypeOfType(type, ts.IndexKind.Number);
  if (index) out.push(...rowTextProps(checker, index, seen));
  for (const arg of checker.getTypeArguments(type as ts.TypeReference) ?? []) out.push(...rowTextProps(checker, arg, seen));
  for (const p of type.getProperties()) {
    if (ROW_TEXT_PROPS.has(p.name)) out.push(p.name);
    const decl = p.valueDeclaration ?? p.declarations?.[0];
    // Only the app's own shapes are walked: a built-in's members (Array.prototype, String) are not data.
    if (decl && !decl.getSourceFile().fileName.includes('node_modules')) {
      out.push(...rowTextProps(checker, checker.getTypeOfSymbolAtLocation(p, decl), seen));
    }
  }
  return out;
}

function programFor(files: string[]): ts.Program {
  const config = ts.readConfigFile(join(WEB, 'tsconfig.json'), ts.sys.readFile);
  const parsed = ts.parseJsonConfigFileContent(config.config, ts.sys, WEB);
  return ts.createProgram(files, { ...parsed.options, noEmit: true });
}

/** The row-text properties in every parameter of the named functions of `file`. */
function imageInputProblems(program: ts.Program, file: string, names: string[]): Record<string, string[]> {
  const checker = program.getTypeChecker();
  const sf = program.getSourceFile(file)!;
  const out: Record<string, string[]> = {};
  walk(sf, (n) => {
    if (ts.isFunctionDeclaration(n) && n.name && names.includes(n.name.text)) {
      out[n.name.text] = n.parameters.flatMap((p) => rowTextProps(checker, checker.getTypeAtLocation(p)));
    }
  });
  return out;
}

describe('digest images are fed no row text (W7)', () => {
  it('T41b-W7: the parameter types of renderChartPng, renderBubblesPng and the two SVG builders carry no label, merchant, name, note, description, memo or payee, recursively', () => {
    const image = join(WEB, 'lib/digestImage.ts');
    const chart = join(WEB, 'lib/domain/digestChart.ts');
    const bubbles = join(WEB, 'lib/domain/digestBubbles.ts');
    const program = programFor([image, chart, bubbles]);
    expect(imageInputProblems(program, image, ['renderChartPng', 'renderBubblesPng'])).toEqual({ renderChartPng: [], renderBubblesPng: [] });
    expect(imageInputProblems(program, chart, ['renderChartSvg'])).toEqual({ renderChartSvg: [] });
    expect(imageInputProblems(program, bubbles, ['renderBubblesSvg'])).toEqual({ renderBubblesSvg: [] });
    // The checker finds a row label nested two levels down in a fabricated signature.
    const host = ts.createCompilerHost({});
    const src = 'interface Row { amount: number; detail: { label: string } }\nexport function renderFake(rows: Row[]): void {}';
    const orig = host.getSourceFile;
    host.getSourceFile = (name, lang) => name === '/fake.ts' ? ts.createSourceFile(name, src, lang) : orig(name, lang);
    const fakeProgram = ts.createProgram(['/fake.ts'], { noEmit: true }, host);
    expect(imageInputProblems(fakeProgram, '/fake.ts', ['renderFake'])).toEqual({ renderFake: ['label'] });
  });
});

// ─── W8, W9, W10: gift-path files ──────────────────────────────────────────────────────────────

/** Every app source file whose path contains `gift`, any case. */
const GIFT_FILES = SOURCES.filter((f) => /gift/i.test(rel(f)));

const LOG_WORDS = /merchant|name|amount|note|label|criteria|criterion/i;

/** `log.*` / `console.*` calls with an argument whose AST mentions a row or criterion word. */
function chattyLogs(sf: ts.SourceFile): string[] {
  const out: string[] = [];
  walk(sf, (n) => {
    if (!ts.isCallExpression(n) || !ts.isPropertyAccessExpression(n.expression)) return;
    const target = n.expression.expression;
    if (!ts.isIdentifier(target) || !/^(log|console)$/.test(target.text)) return;
    for (const a of n.arguments) {
      let hit = false;
      walk(a, (m) => {
        if ((ts.isIdentifier(m) || ts.isStringLiteralLike(m) || ts.isTemplateLiteralToken(m)) && LOG_WORDS.test(m.text)) hit = true;
      });
      if (hit) out.push(n.getText(sf).slice(0, 80));
    }
  });
  return out;
}

/** JS clocks, UTC slicing and float money in a gift file. */
function clockAndFloat(sf: ts.SourceFile): string[] {
  const out: string[] = [];
  walk(sf, (n) => {
    if (ts.isNewExpression(n) && ts.isIdentifier(n.expression) && n.expression.text === 'Date') out.push('new Date(');
    if (ts.isCallExpression(n)) {
      const callee = n.expression.getText(sf);
      if (/^Date\.now$/.test(callee)) out.push('Date.now(');
      if (/(^|\.)toISOString$/.test(callee)) out.push('toISOString');
      if (/(^|\.)parseFloat$/.test(callee)) out.push('parseFloat');
      if (/(^|\.)toFixed$/.test(callee)) out.push('toFixed');
      if (/^Math\.round$/.test(callee)) out.push('Math.round');
    }
    if (ts.isBinaryExpression(n) && (n.operatorToken.kind === ts.SyntaxKind.AsteriskToken || n.operatorToken.kind === ts.SyntaxKind.AsteriskEqualsToken)) {
      let amounty = false;
      for (const side of [n.left, n.right]) walk(side, (m) => { if (ts.isIdentifier(m) && /amount/i.test(m.text)) amounty = true; });
      if (amounty) out.push(`multiplies an amount: ${n.getText(sf).slice(0, 40)}`);
    }
  });
  return out;
}

function imports(sf: ts.SourceFile): string[] {
  return sf.statements.filter(ts.isImportDeclaration).map((d) => (d.moduleSpecifier as ts.StringLiteral).text);
}

describe('gift modules keep their own rules (W8–W10)', () => {
  it('T41b-W8: no log or console call in a gift file mentions a merchant, name, amount, note, label or criterion', () => {
    expect(GIFT_FILES.length).toBeGreaterThanOrEqual(10);
    expect(GIFT_FILES.map((f) => ({ file: rel(f), logs: chattyLogs(parse(f)) })).filter((x) => x.logs.length)).toEqual([]);
    expect(chattyLogs(fake("log.info('gift matched', { merchant: gift.merchant });"))).toHaveLength(1);
    expect(chattyLogs(fake('console.log(criteria);'))).toHaveLength(1);
    expect(chattyLogs(fake("log.info('gift sweep', { told: 2 });"))).toEqual([]);
  });

  it('T41b-W9: no gift file reads a JS clock, slices an ISO string, parses a float, rounds, or multiplies an amount', () => {
    expect(GIFT_FILES.map((f) => ({ file: rel(f), found: clockAndFloat(parse(f)) })).filter((x) => x.found.length)).toEqual([]);
    expect(clockAndFloat(fake('const today = new Date().toISOString().slice(0, 10);')).sort()).toEqual(['new Date(', 'toISOString']);
    expect(clockAndFloat(fake('const x = Date.now();'))).toEqual(['Date.now(']);
    expect(clockAndFloat(fake('const c = Math.round(parseFloat(amount) * 100); const s = n.toFixed(2);'))).toHaveLength(4);
    expect(clockAndFloat(fake("const ok = a.slice(0, 4) === b.slice(0, 4);"))).toEqual([]);
  });

  it('T41b-W10: the gift modules the unit tests import import no database, pg or next module', () => {
    const pure = ['lib/domain/giftMatch.ts', 'lib/domain/giftMask.ts'];
    // The pure modules the unit tests import, discovered from the tests themselves.
    const tested = ['lib/giftMatch.test.ts', 'lib/giftMask.test.ts'].flatMap((t) =>
      imports(parse(join(WEB, t))).filter((s) => /gift/i.test(s)).map((s) => rel(join(dirname(join(WEB, t)), s)) + '.ts'));
    expect([...new Set(tested)].sort()).toEqual([...pure].sort());
    const bad = (s: string) => /(^|\/)db$|^pg$|^next(\/|$)/.test(s);
    for (const f of pure) expect({ f, bad: imports(parse(join(WEB, f))).filter(bad) }).toEqual({ f, bad: [] });
    expect(imports(fake("import db from './db'; import { Pool } from 'pg'; import { cookies } from 'next/headers';")).filter(bad)).toHaveLength(3);
  });
});

// ─── W11: the read path takes a viewer ─────────────────────────────────────────────────────────

/** Exported functions of a read-path file that do not take a required `viewer` admitting `null`. */
function viewerlessExports(sf: ts.SourceFile, predicates: string[]): string[] {
  const out: string[] = [];
  for (const s of sf.statements) {
    if (!ts.isFunctionDeclaration(s) || !s.name || !s.modifiers?.some((m) => m.kind === ts.SyntaxKind.ExportKeyword)) continue;
    if (predicates.includes(s.name.text)) continue;
    const p = s.parameters.find((x) => ts.isIdentifier(x.name) && x.name.text === 'viewer');
    const typeText = p?.type?.getText(sf) ?? '';
    const admitsNull = /\bnull\b/.test(typeText) || typeText === 'GiftViewer';
    if (!p || p.questionToken || p.initializer || !admitsNull) out.push(s.name.text);
  }
  return out;
}

describe('the read path cannot be called without saying who is looking (W11)', () => {
  it('T41b-W11: every exported row source of the read path takes a non-optional viewer whose type admits null', () => {
    for (const file of READ_PATH_FILES) {
      const sf = parse(join(WEB, file));
      expect(viewerlessExports(sf, READ_PATH_PREDICATES)).toEqual([]);
      // `GiftViewer` is exactly `number | null`.
      const mask = readFileSync(join(WEB, 'lib/domain/giftMask.ts'), 'utf8');
      expect(mask).toMatch(/export type GiftViewer = number \| null;/);
    }
    expect(viewerlessExports(fake('export function visibleRows(): string { return ""; }'), [])).toEqual(['visibleRows']);
    expect(viewerlessExports(fake('export function visibleRows(viewer?: number | null): string { return ""; }'), [])).toEqual(['visibleRows']);
    expect(viewerlessExports(fake('export function visibleRows(viewer: number): string { return ""; }'), [])).toEqual(['visibleRows']);
    expect(viewerlessExports(fake('export function visibleRows(viewer: number | null): string { return ""; }'), [])).toEqual([]);
  });
});

// ─── W12: writers are registered ───────────────────────────────────────────────────────────────

describe('every writer of a row is a registered, guarded writer (W12)', () => {
  it('T41b-W12: the files that update a visible column of transactions or delete from it, outside the sync, are exactly the registered guarded writers', () => {
    const found = SOURCES.filter((f) => rel(f) !== 'lib/sync.ts' && writesRows(parse(f))).map(rel).sort();
    expect(found).toEqual(GUARDED_WRITERS.map((w) => w.file).sort());
    for (const w of GUARDED_WRITERS) expect(['X12', 'G7']).toContain(w.scenario);
    // Every registered writer asks the lock, or is the gift's own store.
    for (const w of GUARDED_WRITERS.filter((x) => x.file !== 'lib/giftStore.ts')) {
      const text = readFileSync(join(WEB, w.file), 'utf8');
      const sf = parse(join(WEB, w.file));
      const asks = imports(sf).some((s) => /giftLock$|giftReadPath$/.test(s));
      expect({ file: w.file, asks }).toEqual({ file: w.file, asks: true });
      expect(text.length).toBeGreaterThan(0);
    }
    expect(writesRows(fake("const q = 'UPDATE transactions SET note = $1 WHERE id = $2';"))).toBe(true);
    expect(writesRows(fake("const q = 'DELETE FROM transactions WHERE id = $1';"))).toBe(true);
    expect(writesRows(fake("const q = 'UPDATE transactions SET plaid_transaction_id = $1 WHERE id = $2';"))).toBe(false);
  });
});

// ─── W13: the category by identity ─────────────────────────────────────────────────────────────

describe('the gift category is found by id, never by name (W13)', () => {
  it('T41b-W13: no non-test, non-migration source under apps/web has a string literal naming the seeded gift category', () => {
    const NAME = ['toys', 'gifts', 'flowers'].join('/');
    const named = (sf: ts.SourceFile) => {
      let hit = false;
      walk(sf, (n) => { if (ts.isStringLiteralLike(n) && n.text.toLowerCase().includes(NAME)) hit = true; });
      return hit;
    };
    const everything = ['app', 'lib', 'components', 'scripts'].flatMap(filesUnder).filter(isAppSource);
    expect(everything.filter((f) => named(parse(f))).map(rel)).toEqual([]);
    expect(named(fake("const q = `SELECT id FROM budget_categories WHERE name = 'Toys/Gifts/Flowers'`;"))).toBe(true);
    expect(named(fake("const q = 'SELECT category_id FROM gift_settings';"))).toBe(false);
  });
});
