#!/usr/bin/env node
// The HTTP surface check for P7-41b: every page, over a real `next dev`, as the recipient and as the
// giver of a gift. Scenarios H1 to H10 of plan/tasks/P7-41b-gifts/SPEC.md.
//
//   node apps/web/scripts/gifts-surface-check.mjs                       (from the repo root)
//
// It prints one line per step, `H<n> PASS <what was observed>`, then `OK H1-H10`. The first failing
// step prints `H<n> FAIL <observed>` and the script exits non-zero after cleaning up.
//
// ─── Why it needs its own database ────────────────────────────────────────────────────────────
//
// It makes its OWN scratch database, `b8_gifts_check`, by that hard-coded name. It never reads
// DATABASE_URL, refuses to touch any other name, and drops the database at the end, so no setting
// anywhere can aim it at the owner's ledger. Everything in it is fabricated and seeded with `psql`
// the way `screenshots.mjs` seeds a session: an owner called "Owner" (the RECIPIENT here), a second
// user called "Test User Two" (the GIVER), a browser session for each, two accounts on a fabricated
// Plaid item, one property, a gift category, a gift held row and an ordinary row. Every text field of
// the held row — and of its `plaid_raw` — carries the canary `ZQ41BGIFTROW`, so a leak is found by
// substring in any case. The dev server runs on port 3198 with that database passed explicitly and
// the in-process scheduler off; its stdout and stderr go to a file in a temporary directory, which
// H8 searches and which is deleted with the directory.
//
// No browser: the full HTML of each page, inlined flight data included, is what the server sends,
// and that is what a leak would be found in. H9 asks for the flight payload alone (`RSC: 1`).

import { spawn, execFileSync } from 'node:child_process';
import { createHash, randomBytes } from 'node:crypto';
import { createWriteStream, mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const WEB = resolve(HERE, '..');
const ROOT = resolve(WEB, '../..');
const DB = 'b8_gifts_check';
const PORT = 3198;
const ORIGIN = `http://127.0.0.1:${PORT}`;

/** The held row's canary, and the gift's merchant criterion (a substring of the row's merchant). */
const CANARY = 'ZQ41BGIFTROW';
/** The ordinary row's token — visible to everyone; its presence proves a page rendered rows at all. */
const PLAIN = 'ZQ41BPLAINROW';
const GIFT_AMOUNT = '41.35';

/** The one database this script may touch. A second guard, so an edit to `DB` alone cannot widen it. */
function guardedDatabase(name) {
  if (name !== 'b8_gifts_check') throw new Error(`refusing to touch database ${name}`);
  return name;
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const sha256 = (value) => createHash('sha256').update(value).digest('hex');

class StepFailure extends Error {
  constructor(step, observed) { super(observed); this.step = step; }
}
function check(step, condition, observed) {
  if (!condition) throw new StepFailure(step, observed);
}
const pass = (step, observed) => console.log(`${step} PASS ${observed}`);

/**
 * Every page under `app/`, by file, with its class and the URL it is fetched at. H1 compares this
 * table with the filesystem; a page nobody classified fails it.
 */
const PAGES = {
  'app/page.tsx': { cls: 'no-transaction-data', url: () => '/' },
  'app/accounts/page.tsx': { cls: 'numeric-only', url: () => '/accounts' },
  'app/accounts/[id]/page.tsx': { cls: 'text-bearing', url: (w) => `/accounts/${w.card}` },
  'app/budget/page.tsx': { cls: 'numeric-only', url: () => '/budget' },
  'app/categories/page.tsx': { cls: 'no-transaction-data', url: () => '/categories' },
  'app/categories/[name]/page.tsx': { cls: 'text-bearing', url: (w) => `/categories/${encodeURIComponent(w.category)}` },
  'app/dashboard/page.tsx': { cls: 'text-bearing', url: () => '/dashboard' },
  'app/gifts/page.tsx': { cls: 'text-bearing', url: () => '/gifts' },
  'app/import/page.tsx': { cls: 'no-transaction-data', url: () => '/import' },
  'app/insights/page.tsx': { cls: 'no-transaction-data', url: () => '/insights' },
  'app/login/page.tsx': { cls: 'no-transaction-data', url: () => '/login' },
  'app/net-worth/page.tsx': { cls: 'numeric-only', url: () => '/net-worth' },
  'app/offline/page.tsx': { cls: 'no-transaction-data', url: () => '/offline' },
  'app/profit-loss/page.tsx': { cls: 'numeric-only', url: () => '/profit-loss' },
  'app/properties/page.tsx': { cls: 'numeric-only', url: () => '/properties' },
  'app/properties/[id]/page.tsx': { cls: 'text-bearing', url: (w) => `/properties/${w.property}` },
  'app/rules/page.tsx': { cls: 'text-bearing', url: () => '/rules' },
  'app/sandbox/page.tsx': { cls: 'numeric-only', url: () => '/sandbox' },
  'app/transactions/page.tsx': { cls: 'text-bearing', url: () => '/transactions' },
};

/** The pages H3 and H4 expect the held row's label on. */
const ROW_PAGES = ['app/transactions/page.tsx', 'app/accounts/[id]/page.tsx', 'app/categories/[name]/page.tsx', 'app/dashboard/page.tsx', 'app/properties/[id]/page.tsx'];

// ─── The scratch database ─────────────────────────────────────────────────────────────────────

const db = guardedDatabase(DB);
const psql = (sql) => execFileSync('psql', ['-d', db, '-v', 'ON_ERROR_STOP=1', '-Atqc', sql]).toString().trim();

function prepareDatabase() {
  execFileSync('dropdb', ['--if-exists', db], { stdio: 'ignore' });
  execFileSync('createdb', [db], { stdio: 'ignore' });
  execFileSync('npx', ['node-pg-migrate', 'up'], {
    cwd: ROOT, env: { ...process.env, DATABASE_URL: `postgresql://localhost/${db}` }, stdio: 'ignore',
  });
  const ownerToken = randomBytes(32).toString('base64url');
  const twoToken = randomBytes(32).toString('base64url');
  const raw = JSON.stringify({
    name: `${CANARY} POS`, merchant_name: `${CANARY} Goods`,
    counterparties: [{ name: `${CANARY} Counterparty`, website: `${CANARY.toLowerCase()}.example` }],
    location: { address: `${CANARY} Street`, city: `${CANARY}City`, store_number: `${CANARY}Store` },
    payment_meta: { payment_processor: `${CANARY}Processor` },
  }).replace(/'/g, "''");
  const ids = psql(`
    INSERT INTO users (display_name, is_owner) VALUES ('Owner', TRUE), ('Test User Two', FALSE);
    INSERT INTO webauthn_credentials (credential_id, public_key, sign_count, enrolled_via, user_id) VALUES
      ('gifts-check-owner-cred', '\\x00'::bytea, 0, 'bootstrap', (SELECT id FROM users WHERE is_owner)),
      ('gifts-check-two-cred', '\\x01'::bytea, 0, 'authenticated', (SELECT id FROM users WHERE NOT is_owner));
    INSERT INTO auth_sessions (token_hash, credential_id, expires_at) VALUES
      ('${sha256(ownerToken)}', 'gifts-check-owner-cred', NOW() + interval '2 hours'),
      ('${sha256(twoToken)}', 'gifts-check-two-cred', NOW() + interval '2 hours');
    INSERT INTO properties (nickname, type) VALUES ('Fabricated Cottage', 'rental');
    INSERT INTO accounts (id, name, type, access_token, cursor, property_id) VALUES
      ('zq41b_check_card', 'Fabricated Card', 'credit', 'zq41b-check-token', 'zq41b-check-cursor', (SELECT id FROM properties));
    INSERT INTO budget_categories (name, annual_budget, landscape) VALUES ('Fabricated Gift Shelf', 0, 'operational');
    UPDATE gift_settings SET category_id = (SELECT id FROM budget_categories WHERE name = 'Fabricated Gift Shelf');
    INSERT INTO transactions (plaid_transaction_id, account_id, date, amount, name, merchant_name, plaid_category,
        plaid_category_detailed, plaid_category_confidence, mapped_category, rule_applied, payment_channel,
        merchant_entity_id, logo_url, website, location_city, location_region, location_country, note, plaid_raw)
      VALUES
      ('zq41b-check-gift', 'zq41b_check_card', CURRENT_DATE, ${GIFT_AMOUNT}, '${CANARY} POS', '${CANARY} Goods',
        '${CANARY}_PRIMARY', '${CANARY}_DETAILED', '${CANARY}CONF', 'Fabricated Gift Shelf', FALSE, '${CANARY}channel',
        '${CANARY}entity', 'https://${CANARY.toLowerCase()}.example/logo.png', '${CANARY.toLowerCase()}.example',
        '${CANARY}City', '${CANARY}Region', '${CANARY}Country', '${CANARY} note', '${raw}'::jsonb),
      ('zq41b-check-plain', 'zq41b_check_card', CURRENT_DATE, 7.15, '${PLAIN} POS', '${PLAIN} Goods',
        NULL, NULL, NULL, 'Fabricated Gift Shelf', FALSE, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL);
    INSERT INTO gifts (giver_user_id, recipient_user_id, merchant, window_start, window_end, reveal_date, state)
      VALUES ((SELECT id FROM users WHERE NOT is_owner), (SELECT id FROM users WHERE is_owner), '${CANARY}',
              CURRENT_DATE - 3, CURRENT_DATE + 3, CURRENT_DATE + 30, 'matched');
    INSERT INTO gift_transactions (transaction_id, gift_id, prior_mapped_category, prior_rule_applied)
      VALUES ((SELECT id FROM transactions WHERE plaid_transaction_id = 'zq41b-check-gift'), (SELECT id FROM gifts), NULL, FALSE);
    SELECT (SELECT id FROM properties) || ',' || (SELECT id FROM gifts);`);
  const [property, gift] = ids.split('\n').pop().split(',');
  return {
    owner: ownerToken, two: twoToken, card: 'zq41b_check_card', category: 'Fabricated Gift Shelf',
    property: Number(property), gift: Number(gift),
  };
}

// ─── The server ───────────────────────────────────────────────────────────────────────────────

async function waitFor(url, tries = 180) {
  for (let i = 0; i < tries; i++) {
    try { if ((await fetch(url)).status < 500) return; } catch { /* not up yet */ }
    await sleep(1000);
  }
  throw new Error(`timed out waiting for ${url}`);
}

/** A page as `token`'s browser receives it: status and the whole body. */
async function get(path, token, extraHeaders = {}) {
  requested.add(path);
  const res = await fetch(`${ORIGIN}${path}`, {
    headers: { cookie: `b8_session=${token}`, ...extraHeaders },
    redirect: 'follow',
  });
  return { status: res.status, text: await res.text() };
}

/** Every path this script asked for, so H8 can tell the dev server's access log from a leak. */
const requested = new Set();

/** Whether `text` holds `token` in any case, raw or URL-encoded. */
const holds = (text, token) => text.toLowerCase().includes(token.toLowerCase());

/** The "N transactions" figure and the money line the /transactions page heads its list with. */
function resultBlock(html) {
  const count = /(\d[\d,]*)<!-- -->\s*transaction|(\d[\d,]*) transaction/.exec(html);
  const rows = (html.match(/data-transaction-row|<tr[ >]/g) ?? []).length;
  return { count: count ? (count[1] ?? count[2]) : null, rows };
}

const work = mkdtempSync(join(tmpdir(), 'b8-gifts-check-'));
const serverLogPath = join(work, 'server.log');
const serverLog = createWriteStream(serverLogPath);

let w;
let server = null;
let exitCode = 0;
let current = 'H1';

try {
  w = prepareDatabase();
  server = spawn('npx', ['next', 'dev', '-H', '127.0.0.1', '-p', String(PORT)], {
    cwd: WEB,
    env: { ...process.env, DATABASE_URL: `postgresql://localhost/${db}`, SCHEDULER_IN_PROCESS: 'false' },
    stdio: ['ignore', 'pipe', 'pipe'],
    detached: true,
  });
  server.stdout.pipe(serverLog);
  server.stderr.pipe(serverLog);
  await waitFor(`${ORIGIN}/login`);

  // ── H1 ──
  const found = readdirSync(join(WEB, 'app'), { recursive: true })
    .filter((f) => f.endsWith('page.tsx')).map((f) => relative(WEB, join(WEB, 'app', f)).split('\\').join('/')).sort();
  const listed = Object.keys(PAGES).sort();
  check('H1', JSON.stringify(found) === JSON.stringify(listed), `filesystem pages ${found.join(' ')} != table`);
  check('H1', Object.values(PAGES).every((p) => ['text-bearing', 'numeric-only', 'no-transaction-data'].includes(p.cls)), 'a page has no class');
  pass('H1', `${found.length} page.tsx files on disk, all ${listed.length} classified (${Object.values(PAGES).filter((p) => p.cls === 'text-bearing').length} text-bearing)`);

  // ── H2 ──
  current = 'H2';
  const recipientPages = {};
  for (const [file, p] of Object.entries(PAGES)) {
    const r = await get(p.url(w), w.owner);
    check('H2', r.status === 200, `${p.url(w)} answered ${r.status}`);
    check('H2', !holds(r.text, CANARY), `${p.url(w)} holds the canary`);
    recipientPages[file] = r.text;
  }
  check('H2', holds(recipientPages['app/transactions/page.tsx'], PLAIN) && holds(recipientPages['app/transactions/page.tsx'], '>Gift<'),
    '/transactions shows neither the ordinary row nor the Gift label');
  check('H2', !/>(Unnamed|Transaction|—)</.test(recipientPages['app/properties/[id]/page.tsx'].split(PLAIN)[0] ?? '') || holds(recipientPages['app/properties/[id]/page.tsx'], 'Gift'),
    'the property ledger fell back to a placeholder label');
  pass('H2', `${Object.keys(PAGES).length} pages as the recipient: all 200, 0 hold the canary in any case; /transactions lists the ordinary row and the label Gift`);

  // ── H3 ──
  current = 'H3';
  for (const file of ROW_PAGES) {
    const r = await get(PAGES[file].url(w), w.two);
    check('H3', r.status === 200 && holds(r.text, CANARY), `${PAGES[file].url(w)} as the giver: ${r.status}, canary ${holds(r.text, CANARY) ? 'present' : 'absent'}`);
  }
  pass('H3', `the giver sees the canary on ${ROW_PAGES.map((f) => PAGES[f].url(w)).join(', ')}`);

  // ── H4 ──
  current = 'H4';
  psql('UPDATE gifts SET reveal_date = CURRENT_DATE - 1');
  for (const file of ROW_PAGES) {
    const r = await get(PAGES[file].url(w), w.owner);
    check('H4', holds(r.text, CANARY), `${PAGES[file].url(w)} still masked after the reveal date`);
  }
  psql('UPDATE gifts SET reveal_date = CURRENT_DATE + 30');
  const remasked = await get('/transactions', w.owner);
  check('H4', !holds(remasked.text, CANARY), 'the row did not mask again when the reveal date moved back');
  pass('H4', `with the reveal date yesterday the recipient sees the canary on all ${ROW_PAGES.length} pages; moved back, masked again`);

  // ── H5 ──
  current = 'H5';
  const nonsense = resultBlock((await get('/transactions?search=zq41bnothingmatchesthis', w.owner)).text);
  const searches = [`?search=${CANARY}`, `?search=${CANARY.slice(0, 8)}`, `?merchant=${encodeURIComponent(`${CANARY} Goods`)}`];
  for (const q of searches) {
    const block = resultBlock((await get(`/transactions${q}`, w.owner)).text);
    check('H5', JSON.stringify(block) === JSON.stringify(nonsense), `${q} as the recipient: ${JSON.stringify(block)} vs nonsense ${JSON.stringify(nonsense)}`);
  }
  const byAmount = (await get(`/transactions?search=${GIFT_AMOUNT}`, w.owner)).text;
  check('H5', holds(byAmount, '>Gift<') && !holds(byAmount, CANARY), 'an amount search did not find the Gift row');
  const giverSearch = (await get(`/transactions?search=${CANARY}`, w.two)).text;
  check('H5', resultBlock(giverSearch).count === '1', `the giver's search found ${resultBlock(giverSearch).count}`);
  pass('H5', `recipient searches (full, prefix, payee) render the nonsense block ${JSON.stringify(nonsense)}; the amount finds the Gift row; the giver's search finds 1`);

  // ── H6 ──
  current = 'H6';
  psql(`INSERT INTO category_rules (merchant_name, mapped_category) VALUES ('${CANARY} Goods', 'Fabricated Gift Shelf')`);
  const ruleCount = (html) => {
    const m = new RegExp(`merchant_name\\\\?":\\\\?"${CANARY} Goods\\\\?",\\\\?"mapped_category\\\\?":\\\\?"[^"\\\\]*\\\\?",\\\\?"count\\\\?":(\\d+)`, 'i').exec(html);
    return m ? Number(m[1]) : null;
  };
  const categoryRow = (html) => holds(html, `${CANARY}_PRIMARY`);
  const rRules = (await get('/rules', w.owner)).text;
  const gRules = (await get('/rules', w.two)).text;
  check('H6', ruleCount(rRules) === 0 && ruleCount(gRules) === 1, `merchant rule count recipient=${ruleCount(rRules)} giver=${ruleCount(gRules)}`);
  check('H6', !categoryRow(rRules) && categoryRow(gRules), 'the gift\'s Plaid category row is counted for the recipient or missing for the giver');
  pass('H6', `merchant rule on the gift's payee counts 0 rows for the recipient and 1 for the giver; its Plaid category row is absent for the recipient and present for the giver`);

  // ── H7 ──
  current = 'H7';
  const normal = (t) => t.replace(/<script[\s\S]*?<\/script>/g, '').replace(/[0-9a-f]{8,}/gi, '').replace(/\d+ (seconds?|minutes?|hours?|days?) ago/g, '');
  const targets = ['/transactions', `/accounts/${w.card}`, '/dashboard', '/api/v1/overview', `/api/v1/transactions/${psql("SELECT id FROM transactions WHERE plaid_transaction_id = 'zq41b-check-gift'")}`, '/api/v1/gifts'];
  let comparisons = 0;
  for (const t of targets) {
    const firstG = normal((await get(t, w.two)).text);
    const firstR = normal((await get(t, w.owner)).text);
    for (let i = 0; i < 2; i++) {
      const g = normal((await get(t, w.two)).text);
      const r = normal((await get(t, w.owner)).text);
      check('H7', holds(g, CANARY) === holds(firstG, CANARY) && !holds(r, CANARY), `${t} round ${i}: a viewer got the other's answer`);
      if (t.startsWith('/api/')) check('H7', g === firstG && r === firstR, `${t} round ${i}: a response changed between identical requests`);
      comparisons += 2;
    }
  }
  pass('H7', `${comparisons} alternating giver/recipient requests over ${targets.length} pages and routes: each viewer always got their own answer; API bodies byte-identical per viewer`);

  // ── H8 ──
  current = 'H8';
  serverLog.write('');
  await sleep(500);
  const logText = readFileSync(serverLogPath, 'utf8');
  // `next dev` prints one access-log line per request — `GET <path> <status> in <n>ms` — and H5
  // searched FOR the canary, so those lines repeat the script's own query string back. A line is
  // excused only when it is exactly that shape AND its path is one this script sent; anything else
  // that mentions the canary is a leak.
  const echo = (l) => {
    const m = /^\s*GET (\S+) \d{3} in /.exec(l);
    return m !== null && requested.has(m[1]);
  };
  const echoes = logText.split('\n').filter((l) => holds(l, CANARY) && echo(l)).length;
  const leakLines = logText.split('\n').filter((l) => holds(l, CANARY) && !echo(l));
  check('H8', leakLines.length === 0, `the dev-server output holds the canary on ${leakLines.length} lines: ${leakLines.slice(0, 3).join(' | ').slice(0, 300)}`);
  pass('H8', `dev-server output (${logText.length} bytes): 0 lines hold the canary in any case, besides ${echoes} access-log lines echoing this script's own search URLs`);

  // ── H9 ──
  current = 'H9';
  const flight = await get('/transactions', w.owner, { RSC: '1' });
  check('H9', flight.status === 200 && flight.text.length > 0, `RSC request answered ${flight.status}`);
  check('H9', !holds(flight.text, CANARY), 'the flight payload holds the canary');
  check('H9', holds(flight.text, PLAIN), 'the flight payload carries no rows at all');
  pass('H9', `RSC: 1 /transactions as the recipient: ${flight.text.length} bytes, ordinary row present, canary absent`);

  // ── H10 ──
  current = 'H10';
  const giverGifts = (await get('/gifts', w.two)).text;
  const recipientGifts = (await get('/gifts', w.owner)).text;
  check('H10', holds(giverGifts, CANARY) && /For (<!-- -->)?Owner/.test(giverGifts), 'the giver\'s /gifts does not list the gift with its criteria');
  check('H10', !holds(recipientGifts, CANARY) && holds(recipientGifts, 'No gifts marked yet'), 'the recipient\'s /gifts shows a gift or a criterion');
  check('H10', [giverGifts, recipientGifts].every((h) => h.includes('href="/gifts"')), 'the nav entry is missing for someone');
  pass('H10', `giver's /gifts lists the gift and its criterion; recipient's lists none and holds no criterion; the Gifts nav entry is present for both`);

  console.log('OK H1-H10');
} catch (error) {
  exitCode = 1;
  if (error instanceof StepFailure) console.log(`${error.step} FAIL ${error.message}`);
  else console.log(`${current} FAIL ${error?.message ?? error}`);
} finally {
  if (server) { try { process.kill(-server.pid); } catch { server.kill(); } }
  await sleep(2000);
  rmSync(work, { recursive: true, force: true });
  try { execFileSync('dropdb', ['--if-exists', db], { stdio: 'ignore' }); } catch { /* reported by the exit code below */ }
}
process.exit(exitCode);
