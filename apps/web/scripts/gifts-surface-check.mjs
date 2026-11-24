#!/usr/bin/env node
// The HTTP surface check for P7-41b: every page, over a real `next dev`, as the recipient and as the
// giver of a gift. Scenarios H1 to H10 of plan/tasks/P7-41b-gifts/SPEC.md.
//
//   node apps/web/scripts/gifts-surface-check.mjs                       (from the repo root)
//
// It prints one line per step, `H<n> PASS <what was observed>`, then `OK H1-H10`. The first failing
// step prints `H<n> FAIL <observed>` and the script exits non-zero after cleaning up.
//
// P8-42a added H11 (the loyalty page and overview, SPEC.md S10 of P8-42a-loyalty-model-page-import).
// P8-42b added H12 (a credit card linked to a membership, its annual fee held by a second gift, the
// fee watch on /travel, /accounts/<card> and the API through every state). P8-42b2 added H13 (the
// earn estimate and its comparison with the next reading, with a gift-held row that must not count,
// driven by the pinned fixture `lib/fixtures/loyalty-earn-cases.json`). P8-42c1 added H14 (the
// loyalty inbox panel on /travel and the on-demand poll route, against a mailbox that cannot be
// reached). P8-42c2 added H15 (the reading queue, its wording and its three actions, and the read
// route, with no API key and a model endpoint that cannot be reached), so the final success line is
// now `OK H1-H16`: P8-42d added H16 (a balance from a screenshot: the "Update from screenshot" control on
// every membership, the "Needs a screenshot" section, the read route answering `disabled` with no key,
// and the confirm route clearing the prompt).
//
// THE MAILBOX VARIABLES. The dev server never inherits a `LOYALTY_IMAP_` variable from the shell that
// runs this script: every one is removed from its environment, and five are then set to fabricated
// values — the loopback address, a port this script bound and closed a moment before spawning, TLS,
// and the canary user and password of `lib/fixtures/loyalty-inbox/cases.json`. A poll therefore
// always fails to connect, and a real credential cannot be reached from here whatever is exported.
//
// THE MODEL VARIABLES (P8-42c2). The same holds for Claude: every inherited `ANTHROPIC_` variable is
// removed and `ANTHROPIC_API_KEY` is then set blank (so `.env.local` cannot supply one and reading is
// disabled), and `ANTHROPIC_BASE_URL` is set
// to another loopback port this script bound and closed, so even a client built by mistake could
// reach nothing.
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
import { createServer } from 'node:net';
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
  'app/digest/page.tsx': { cls: 'numeric-only', url: () => '/digest' },
  'app/gifts/page.tsx': { cls: 'text-bearing', url: () => '/gifts' },
  'app/import/page.tsx': { cls: 'no-transaction-data', url: () => '/import' },
  'app/insights/page.tsx': { cls: 'no-transaction-data', url: () => '/insights' },
  'app/login/page.tsx': { cls: 'no-transaction-data', url: () => '/login' },
  'app/net-worth/page.tsx': { cls: 'numeric-only', url: () => '/net-worth' },
  'app/offline/page.tsx': { cls: 'no-transaction-data', url: () => '/offline' },
  'app/profit-loss/page.tsx': { cls: 'numeric-only', url: () => '/profit-loss' },
  'app/properties/page.tsx': { cls: 'numeric-only', url: () => '/properties' },
  'app/properties/[id]/page.tsx': { cls: 'text-bearing', url: (w) => `/properties/${w.property}` },
  'app/receipts/page.tsx': { cls: 'text-bearing', url: () => '/receipts' },
  'app/rules/page.tsx': { cls: 'text-bearing', url: () => '/rules' },
  'app/sandbox/page.tsx': { cls: 'numeric-only', url: () => '/sandbox' },
  'app/transactions/page.tsx': { cls: 'text-bearing', url: () => '/transactions' },
  'app/travel/page.tsx': { cls: 'numeric-only', url: () => '/travel' },
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

/** The fabricated mailbox canaries H14 hands the server and then looks for in every response. */
const INBOX = JSON.parse(readFileSync(join(WEB, 'lib/fixtures/loyalty-inbox/cases.json'), 'utf8'));

/** A loopback port nothing listens on: bound by the OS, then closed before the server starts. */
const closedPort = () => new Promise((done, fail) => {
  const probe = createServer();
  probe.on('error', fail);
  probe.listen(0, '127.0.0.1', () => {
    const { port } = probe.address();
    probe.close(() => done(port));
  });
});

/** The reading fixture (P8-42c2): H15 seeds its `surface` group and looks for its canaries. */
const READ = JSON.parse(readFileSync(join(WEB, 'lib/fixtures/loyalty-read/cases.json'), 'utf8'));

/**
 * The server's environment: no inherited mailbox or Anthropic variable, then the five fabricated
 * mailbox ones and a model base URL on a closed loopback port. `ANTHROPIC_API_KEY` stays absent.
 */
function serverEnv(mailPort, modelPort) {
  const env = Object.fromEntries(Object.entries(process.env).filter(([k]) => !k.startsWith('LOYALTY_IMAP_') && !k.startsWith('ANTHROPIC_')));
  env.ANTHROPIC_BASE_URL = `http://127.0.0.1:${modelPort}`;
  // Blank rather than deleted: `next dev` fills every variable the process lacks from `.env.local`,
  // which may hold a real key, but never replaces one the process already has. A blank key is "not
  // set up" to the reader (`readerAvailable` trims), so no key of any kind reaches the server.
  env.ANTHROPIC_API_KEY = '';
  env.LOYALTY_IMAP_HOST = '127.0.0.1';
  env.LOYALTY_IMAP_PORT = String(mailPort);
  env.LOYALTY_IMAP_TLS = 'true';
  env.LOYALTY_IMAP_USER = INBOX.canaries.user;
  env.LOYALTY_IMAP_PASSWORD = INBOX.canaries.password;
  return { ...env, DATABASE_URL: `postgresql://localhost/${db}`, SCHEDULER_IN_PROCESS: 'false' };
}
let mailPort;
let modelPort;

try {
  w = prepareDatabase();
  mailPort = await closedPort();
  modelPort = await closedPort();
  server = spawn('npx', ['next', 'dev', '-H', '127.0.0.1', '-p', String(PORT)], {
    cwd: WEB,
    env: serverEnv(mailPort, modelPort),
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

  // ── H11 ── (P8-42a) The loyalty page and overview carry a member number masked, for both people.
  // One member, one membership on the first catalog program whose number is an 18-character canary,
  // and one reading. The visible suffix (the mask's last four) must be there — proving the line
  // rendered at all — and the canary itself, in any case, must not: not in the HTML, not in the
  // inlined flight data, not in the JSON.
  current = 'H11';
  const NUMBER_CANARY = 'ZQ42ANUMCANARY9876';
  psql(`
    INSERT INTO household_members (display_name) VALUES ('ZQ42A Surface Member');
    INSERT INTO loyalty_memberships (member_id, program_id, member_number)
      VALUES ((SELECT id FROM household_members WHERE display_name = 'ZQ42A Surface Member'),
              (SELECT id FROM loyalty_programs ORDER BY id LIMIT 1), '${NUMBER_CANARY}');
    INSERT INTO loyalty_observations (membership_id, as_of, balance, unit, source)
      VALUES ((SELECT max(id) FROM loyalty_memberships), CURRENT_DATE, 1200, 'points', 'typed');`);
  for (const [who, token] of [['owner', w.owner], ['second user', w.two]]) {
    const page = await get('/travel', token);
    check('H11', page.status === 200, `/travel as the ${who} answered ${page.status}`);
    check('H11', page.text.includes('Nights & Miles') || page.text.includes('Nights &amp; Miles'), `/travel as the ${who} lacks its label`);
    check('H11', page.text.includes('9876'), `/travel as the ${who} lacks the masked suffix`);
    check('H11', !holds(page.text, NUMBER_CANARY), `/travel as the ${who} holds the full member number`);
    const api = await get('/api/v1/loyalty', token);
    check('H11', api.status === 200, `/api/v1/loyalty as the ${who} answered ${api.status}`);
    check('H11', api.text.includes('9876'), `/api/v1/loyalty as the ${who} lacks the masked suffix`);
    check('H11', !holds(api.text, NUMBER_CANARY), `/api/v1/loyalty as the ${who} holds the full member number`);
  }
  pass('H11', `/travel and /api/v1/loyalty as both users: 200, label and masked suffix present, the 18-character number absent in any case`);

  // ── H12 ── (P8-42b) A credit card linked to a membership, its annual fee found in the ledger, and
  // the benefit's state, over real HTTP for both people. The card is the fabricated one H1 to H11
  // already use. Its fee row is held by a SECOND gift (giver: the second user, recipient: the owner),
  // so step 2 is the case that matters: a held row is no fee for anybody, the giver included, and its
  // name and amount appear on neither /travel nor the API. The account page is text-bearing and shows
  // the giver their own row by design (H3), so there the name is checked for the recipient alone, and
  // the amount, which the statement shows every viewer, is not checked there at all.
  //
  // The link, the benefit and the unlink go through the real PATCH route. Every date the step checks
  // is read back from Postgres, never computed here.
  current = 'H12';
  const FEE_NAME = 'ZQ42B ANNUAL MEMBERSHIP FEE';
  const FEE_AMOUNT = '61.29';
  const membershipId = Number(psql(`
    INSERT INTO household_members (display_name) VALUES ('ZQ42B Surface Member');
    INSERT INTO transactions (plaid_transaction_id, account_id, date, amount, name)
      VALUES ('zq42b-check-fee', '${w.card}', CURRENT_DATE - 5, ${FEE_AMOUNT}, '${FEE_NAME}');
    INSERT INTO gifts (giver_user_id, recipient_user_id, merchant, window_start, window_end, reveal_date, state)
      VALUES ((SELECT id FROM users WHERE NOT is_owner), (SELECT id FROM users WHERE is_owner), 'ZQ42B FEE GIFT',
              CURRENT_DATE - 10, CURRENT_DATE - 1, CURRENT_DATE + 30, 'matched');
    INSERT INTO gift_transactions (transaction_id, gift_id, prior_mapped_category, prior_rule_applied)
      VALUES ((SELECT id FROM transactions WHERE plaid_transaction_id = 'zq42b-check-fee'),
              (SELECT id FROM gifts WHERE merchant = 'ZQ42B FEE GIFT'), NULL, FALSE);
    INSERT INTO loyalty_memberships (member_id, program_id)
      VALUES ((SELECT id FROM household_members WHERE display_name = 'ZQ42B Surface Member'),
              (SELECT id FROM loyalty_programs ORDER BY id OFFSET 1 LIMIT 1))
      RETURNING id;`).split('\n').pop());
  const programName = psql(`SELECT p.name FROM loyalty_programs p JOIN loyalty_memberships m ON m.program_id = p.id WHERE m.id = ${membershipId}`);
  const day = (n) => psql(`SELECT (CURRENT_DATE + ${n})::text`);
  const escaped = (t) => t.replace(/&/g, '&amp;').replace(/'/g, '&#x27;').replace(/"/g, '&quot;');
  const hasText = (html, t) => html.includes(t) || html.includes(escaped(t));
  const uncommented = (html) => html.replace(/<!--[\s\S]*?-->/g, '');

  async function patchMembership(body) {
    const res = await fetch(`${ORIGIN}/api/v1/loyalty/memberships/${membershipId}`, {
      method: 'PATCH',
      headers: { cookie: `b8_session=${w.owner}`, 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });
    check('H12', res.status === 200, `PATCH ${Object.keys(body).join(',')} answered ${res.status}`);
    return (await res.json()).data;
  }
  /** The three surfaces as `token` sees them, the HTML with its comments removed. */
  async function surfaces(token, who) {
    const travel = await get('/travel', token);
    const account = await get(`/accounts/${w.card}`, token);
    const api = await get('/api/v1/loyalty', token);
    check('H12', travel.status === 200 && account.status === 200 && api.status === 200, `a surface failed for the ${who}`);
    const m = JSON.parse(api.text).data.cards.flatMap((c) => c.memberships).find((x) => x.id === membershipId);
    check('H12', m !== undefined, `the membership is missing from the API for the ${who}`);
    return { travel: uncommented(travel.text), account: uncommented(account.text), apiText: api.text, m };
  }
  const VIEWERS = [['owner', w.owner], ['second user', w.two]];
  async function both(step) {
    const seen = [];
    for (const [who, token] of VIEWERS) seen.push({ who, ...(await surfaces(token, who)) });
    check('H12', JSON.stringify(seen[0].m) === JSON.stringify(seen[1].m), `step ${step}: the two viewers got different membership views`);
    return seen;
  }

  // (1) Unlinked, benefit described without a window: the route stores the default.
  const described = await patchMembership({ benefit: { kind: 'free_night', description: 'ZQ42B night' } });
  check('H12', described.benefit?.windowDays === 45, `the default window is ${described.benefit?.windowDays}`);
  for (const s of await both(1)) {
    check('H12', !s.account.includes('Earns into'), `step 1: an unlinked card's page says Earns into (${s.who})`);
    check('H12', s.m.cardAccountId === null && s.m.feeWatch === null, `step 1: an unlinked membership has a card or a watch (${s.who})`);
  }
  // (2) Linked, the fee held by the gift.
  await patchMembership({ cardAccountId: w.card });
  for (const s of await both(2)) {
    check('H12', s.m.feeWatch?.state === 'no_fee_seen' && s.m.feeWatch?.feeDate === null, `step 2: a held fee counted for the ${s.who}: ${JSON.stringify(s.m.feeWatch)}`);
    for (const [where, text] of [['/travel', s.travel], ['/api/v1/loyalty', s.apiText]]) {
      check('H12', !holds(text, 'ZQ42B ANNUAL') && !text.includes(FEE_AMOUNT), `step 2: ${where} holds the held fee's name or amount (${s.who})`);
    }
    if (s.who === 'owner') check('H12', !holds(s.account, 'ZQ42B ANNUAL'), 'step 2: the recipient sees the held fee row by name');
    check('H12', s.travel.includes('No annual fee seen yet') && s.account.includes('No annual fee seen yet'), `step 2: "No annual fee seen yet" missing (${s.who})`);
    check('H12', s.account.includes('Earns into') && hasText(s.account, programName) && s.account.includes('ZQ42B night'),
      `step 2: the card's page lacks Earns into, the program or the benefit (${s.who})`);
  }
  // (3) Revealed yesterday: the fee counts, for both, with Postgres's dates.
  psql(`UPDATE gifts SET reveal_date = CURRENT_DATE - 1 WHERE merchant = 'ZQ42B FEE GIFT'`);
  const feeDate = day(-5);
  const expectedBy = day(40);
  for (const s of await both(3)) {
    check('H12', JSON.stringify(s.m.feeWatch) === JSON.stringify({ feeDate, expectedBy, state: 'awaiting' }), `step 3: ${JSON.stringify(s.m.feeWatch)} (${s.who})`);
    for (const [where, html] of [['/travel', s.travel], [`/accounts/${w.card}`, s.account]]) {
      check('H12', html.includes(`Annual fee posted ${feeDate}`) && html.includes(`expected by ${expectedBy}`), `step 3: ${where} lacks the fee date or expected-by (${s.who})`);
    }
    check('H12', !s.travel.includes('overdue') && !s.travel.includes('received'), `step 3: /travel says overdue or received while awaiting (${s.who})`);
  }
  // (4) The reveal moved back: masked again.
  psql(`UPDATE gifts SET reveal_date = CURRENT_DATE + 30 WHERE merchant = 'ZQ42B FEE GIFT'`);
  for (const s of await both(4)) check('H12', s.m.feeWatch?.state === 'no_fee_seen', `step 4: still counted after the reveal moved back (${s.who})`);
  // (5) The fee sixty days ago, revealed: overdue.
  psql(`UPDATE transactions SET date = CURRENT_DATE - 60 WHERE plaid_transaction_id = 'zq42b-check-fee';
        UPDATE gifts SET reveal_date = CURRENT_DATE - 1 WHERE merchant = 'ZQ42B FEE GIFT'`);
  const overdueSince = day(-15);
  for (const s of await both(5)) {
    check('H12', s.m.feeWatch?.state === 'overdue' && s.m.feeWatch?.expectedBy === overdueSince, `step 5: ${JSON.stringify(s.m.feeWatch)} (${s.who})`);
    check('H12', s.travel.includes('overdue') && s.account.includes('overdue') && !s.travel.includes('expected by'), `step 5: the pages do not say overdue (${s.who})`);
  }
  // (6) A free night issued yesterday: received.
  psql(`INSERT INTO loyalty_instruments (membership_id, kind, description, issued_on, source)
          VALUES (${membershipId}, 'free_night', 'ZQ42B surface night', CURRENT_DATE - 1, 'typed')`);
  for (const s of await both(6)) {
    check('H12', s.m.feeWatch?.state === 'received', `step 6: ${JSON.stringify(s.m.feeWatch)} (${s.who})`);
    check('H12', s.travel.includes('received') && s.account.includes('received'), `step 6: the pages do not say received (${s.who})`);
  }
  // (7) Benefit cleared: no state, the fee date still shown, nothing "expected".
  await patchMembership({ benefit: null });
  for (const s of await both(7)) {
    check('H12', JSON.stringify(s.m.feeWatch) === JSON.stringify({ feeDate: day(-60), expectedBy: null, state: null }), `step 7: ${JSON.stringify(s.m.feeWatch)} (${s.who})`);
    check('H12', s.travel.includes('Annual fee posted') && !s.travel.includes('expected by') && !s.account.includes('expected by'), `step 7: wrong wording with no benefit (${s.who})`);
  }
  // (8) Unlinked again.
  await patchMembership({ cardAccountId: null });
  for (const s of await both(8)) {
    check('H12', !s.account.includes('Earns into') && s.m.feeWatch === null, `step 8: the unlink did not stick (${s.who})`);
  }
  pass('H12', `both users, 8 steps over /travel, /accounts/${w.card} and /api/v1/loyalty: a gift-held fee is no fee for either; revealed, fee date ${feeDate} and expected by ${expectedBy} (Postgres dates), then overdue, received, no state without a benefit, and no Earns into once unlinked; the held row's name and amount appear on neither /travel nor the API`);

  // ── H13 ── (P8-42b2) The earn estimate and the comparison with the next reading, over real HTTP
  // for both people, on /travel, /accounts/<card> and the API. Driven entirely by the `h13` group of
  // the pinned, fabricated fixture `lib/fixtures/loyalty-earn-cases.json` (read with fs, not
  // imported): its reading, its rows, its earn description and its eight steps with what each must
  // show. No figure is written here; every expected figure is the fixture's and every date is
  // Postgres's.
  //
  // The card is the fabricated one the earlier steps use. Its rows from H1 to H12 must not price into
  // this step's figures, which the fixture computed from its own rows alone: the H1 gift row is still
  // held (H4 moved its reveal back), so it is no spend for anyone; the H12 fee row is an annual fee,
  // never spend; the ordinary row dated today WOULD be spend, so it is moved to the day before this
  // step's reading, outside both the estimate's period and the comparison's window. The held row of
  // this step is held by a third gift with the H12 pattern (giver: the second user, recipient: the
  // owner), so a held row is proved to be no spend for either viewer, the giver included.
  current = 'H13';
  const H = JSON.parse(readFileSync(join(WEB, 'lib/fixtures/loyalty-earn-cases.json'), 'utf8')).h13;
  const EARN_GIFT = 'ZQ42B2 EARN GIFT';
  const quote = (t) => `'${String(t).replace(/'/g, "''")}'`;
  const earnMember = Number(psql(`
    UPDATE transactions SET date = CURRENT_DATE + ${Number(H.reading.day) - 1} WHERE plaid_transaction_id = 'zq41b-check-plain';
    INSERT INTO household_members (display_name) VALUES ('ZQ42B2 Surface Member');
    INSERT INTO loyalty_memberships (member_id, program_id)
      VALUES ((SELECT id FROM household_members WHERE display_name = 'ZQ42B2 Surface Member'),
              (SELECT id FROM loyalty_programs ORDER BY id OFFSET 2 LIMIT 1))
      RETURNING id;`).split('\n').pop());
  for (const r of H.rows) {
    psql(`INSERT INTO transactions (plaid_transaction_id, account_id, date, amount, name)
            VALUES (${quote(`zq42b2-check-${r.ref}`)}, '${w.card}', CURRENT_DATE + ${Number(r.day)}, ${quote(r.amount)}::numeric, ${quote(r.name)})`);
  }
  for (const r of H.rows.filter((x) => x.heldByGift)) {
    psql(`INSERT INTO gifts (giver_user_id, recipient_user_id, merchant, window_start, window_end, reveal_date, state)
            VALUES ((SELECT id FROM users WHERE NOT is_owner), (SELECT id FROM users WHERE is_owner), '${EARN_GIFT}',
                    CURRENT_DATE - 10, CURRENT_DATE - 1, CURRENT_DATE + ${Number(r.revealDay)}, 'matched');
          INSERT INTO gift_transactions (transaction_id, gift_id, prior_mapped_category, prior_rule_applied)
            VALUES ((SELECT id FROM transactions WHERE plaid_transaction_id = ${quote(`zq42b2-check-${r.ref}`)}),
                    (SELECT id FROM gifts WHERE merchant = '${EARN_GIFT}'), NULL, FALSE)`);
  }
  const revealEarnGift = (n) => psql(`UPDATE gifts SET reveal_date = CURRENT_DATE + ${Number(n)} WHERE merchant = '${EARN_GIFT}'`);

  async function earnWrite(method, path, body, status) {
    const res = await fetch(`${ORIGIN}${path}`, {
      method,
      headers: { cookie: `b8_session=${w.owner}`, 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });
    check('H13', res.status === status, `${method} ${path} answered ${res.status}`);
  }
  const patchEarnMembership = (body) => earnWrite('PATCH', `/api/v1/loyalty/memberships/${earnMember}`, body, 200);
  const addEarnReading = async (r) =>
    earnWrite('POST', `/api/v1/loyalty/memberships/${earnMember}/observations`, { asOf: day(r.day), balance: r.balance, unit: r.unit }, 201);

  /** What each fixture step does, by its id; the fixture says what each must show. */
  const ACTIONS = {
    H1: () => patchEarnMembership({ cardAccountId: w.card }),
    H2: () => patchEarnMembership({ earn: H.earn }),
    H3: () => revealEarnGift(-1),
    H4: () => revealEarnGift(30),
    H5: async (s) => { revealEarnGift(-1); await addEarnReading(s.reading); },
    H6: (s) => addEarnReading(s.reading),
    H7: () => patchEarnMembership({ earn: null }),
    H8: () => patchEarnMembership({ cardAccountId: null }),
  };

  /** The expected figure object with its day offsets turned into Postgres dates, compared key by key. */
  const withDates = (o) => {
    const out = { ...o };
    for (const [k, to] of [['sinceDay', 'since'], ['fromDay', 'from'], ['toDay', 'to']]) {
      if (k in out) { out[to] = day(out[k]); delete out[k]; }
    }
    return out;
  };
  const agrees = (actual, expected) => (expected === null ? actual === null
    : actual !== null && Object.entries(withDates(expected)).every(([k, v]) => JSON.stringify(actual[k]) === JSON.stringify(v)));

  await addEarnReading(H.reading);
  const shown = [];
  for (const step of H.steps) {
    const action = ACTIONS[step.id];
    check('H13', action !== undefined, `the fixture step ${step.id} has no action here`);
    await action(step);
    const views = [];
    for (const [who, token] of VIEWERS) {
      const pages = { '/travel': uncommented((await get('/travel', token)).text), [`/accounts/${w.card}`]: uncommented((await get(`/accounts/${w.card}`, token)).text) };
      const apiText = (await get('/api/v1/loyalty', token)).text;
      const m = JSON.parse(apiText).data.cards.flatMap((c) => c.memberships).find((x) => x.id === earnMember);
      check('H13', m !== undefined, `${step.id}: the membership is missing from the API for the ${who}`);
      for (const key of ['earn', 'earnEstimate', 'earnComparison']) {
        if (key in step.expect) check('H13', agrees(m[key], step.expect[key]), `${step.id}: ${key} is ${JSON.stringify(m[key])} for the ${who}`);
      }
      for (const [where, html] of Object.entries(pages)) {
        for (const t of step.expect.htmlHas ?? []) check('H13', hasText(html, t), `${step.id}: ${where} lacks "${t}" (${who})`);
        for (const t of step.expect.htmlAbsent ?? []) check('H13', !hasText(html, t), `${step.id}: ${where} shows "${t}" (${who})`);
      }
      const forbiddenIn = { '/travel': pages['/travel'], '/api/v1/loyalty': apiText };
      for (const where of H.forbiddenOn) {
        for (const t of H.forbiddenText) check('H13', !holds(forbiddenIn[where], t), `${step.id}: ${where} holds "${t}" (${who})`);
      }
      views.push(m);
    }
    check('H13', JSON.stringify(views[0].earnEstimate) === JSON.stringify(views[1].earnEstimate)
      && JSON.stringify(views[0].earnComparison) === JSON.stringify(views[1].earnComparison), `${step.id}: the two viewers got different figures`);
    shown.push(views[0]);
  }
  const atH2 = shown[1].earnEstimate;
  const atH5 = shown[4].earnComparison;
  pass('H13', `both users, ${H.steps.length} fixture steps over /travel, /accounts/${w.card} and /api/v1/loyalty: estimate ${atH2.amount} ${atH2.unit} since ${atH2.since} (${atH2.basis}) with the held row excluded for both, counted once revealed, excluded again when held; comparison ${atH5.from} to ${atH5.to} estimated ${atH5.estimated} reported ${atH5.actual} (${atH5.differencePercent}%, worth a look ${atH5.worthALook}); cleared and unlinked show no figure; the held row's name and the payment, fee and held amounts appear on neither /travel nor the API`);

  // ── H14 ── (P8-42c1) The loyalty inbox panel on /travel and the on-demand poll, over real HTTP for
  // both people. Seeded by SQL on this scratch database with fabricated rows only: a program with a
  // sender domain last seen two days ago, a member with a forwarding address, one stored message
  // whose bytes are the body canary, three unknown-sender rows over two domains, and a second member
  // whose address last received mail 46 days ago (one past the 45-day silence threshold, so quiet).
  // The mailbox the server was given is a closed loopback port, so the poll must fail as
  // `connect_failed` and the panel must then say so. Nothing the mail holds, nor the password, the
  // user or the loopback host, may appear in any response of the step.
  current = 'H14';
  const brand = INBOX.programs.brand;
  psql(`
    INSERT INTO loyalty_programs (name, kind, default_unit) VALUES ('ZQ42C Surface Stays', 'hotel', 'points');
    INSERT INTO loyalty_sender_domains (program_id, domain, last_seen_on)
      VALUES ((SELECT id FROM loyalty_programs WHERE name = 'ZQ42C Surface Stays'), '${brand.domain}', CURRENT_DATE - 2);
    INSERT INTO household_members (display_name) VALUES ('ZQ42C Surface Anna'), ('ZQ42C Surface Quiet');
    INSERT INTO household_member_addresses (member_id, address, added_on, last_received_on) VALUES
      ((SELECT id FROM household_members WHERE display_name = 'ZQ42C Surface Anna'), '${INBOX.people.A}', CURRENT_DATE - 10, CURRENT_DATE - 2),
      ((SELECT id FROM household_members WHERE display_name = 'ZQ42C Surface Quiet'), '${INBOX.people.B}', CURRENT_DATE - 60, CURRENT_DATE - 46);
    INSERT INTO loyalty_inbox_messages (dedupe_key, received_on, program_id, sender_domain, origin, attribution, member_id, raw_mail)
      VALUES (repeat('a', 64), CURRENT_DATE - 2, (SELECT id FROM loyalty_programs WHERE name = 'ZQ42C Surface Stays'), '${brand.domain}',
              'direct', 'matched', (SELECT id FROM household_members WHERE display_name = 'ZQ42C Surface Anna'),
              convert_to('${INBOX.canaries.body}', 'UTF8'));
    INSERT INTO loyalty_inbox_unknown_senders (dedupe_key, received_on, domain) VALUES
      (repeat('b', 64), CURRENT_DATE - 1, 'attacker.test'), (repeat('c', 64), CURRENT_DATE - 3, 'attacker.test'),
      (repeat('d', 64), CURRENT_DATE - 1, 'other-sender.test');`);
  const secrets = [INBOX.canaries.body, INBOX.canaries.password, INBOX.canaries.user, '127.0.0.1', `:${mailPort}`];
  const said = [];
  const panelText = (html) => uncommented(html).replace(/<[^>]+>/g, '\n').split('\n').map((t) => t.trim()).filter(Boolean);
  const before = [
    'Loyalty inbox', 'Check inbox now', 'Not checked yet', 'Mail from unknown senders: 3', 'attacker.test × 2', 'other-sender.test × 1',
    'ZQ42C Surface Quiet: forwarding quiet for 46 days', 'Last mail seen: ', 'Raw mail is kept 30 days, then deleted.',
  ];
  for (const [who, token] of [['owner', w.owner], ['second user', w.two]]) {
    const page = await get('/travel', token);
    check('H14', page.status === 200, `/travel answered ${page.status} for the ${who}`);
    for (const t of before) check('H14', hasText(uncommented(page.text), t), `/travel lacks "${t}" for the ${who}`);
    said.push(page.text);
    const api = await get('/api/v1/loyalty', token);
    check('H14', api.status === 200, `/api/v1/loyalty answered ${api.status} for the ${who}`);
    said.push(api.text);
  }
  const sample = panelText((await get('/travel', w.owner)).text);
  const from = sample.indexOf('Loyalty inbox');
  const poll = async (headers) => {
    const res = await fetch(`${ORIGIN}/api/v1/loyalty/inbox/poll`, { method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body: '{}' });
    const text = await res.text();
    said.push(text);
    return { status: res.status, text };
  };
  const unauth = await poll({});
  check('H14', unauth.status === 401, `the poll with no cookie answered ${unauth.status}`);
  const polled = await poll({ cookie: `b8_session=${w.owner}` });
  check('H14', polled.status === 200, `the poll answered ${polled.status}`);
  const result = JSON.parse(polled.text).data;
  check('H14', result?.outcome === 'error' && result?.errorCode === 'connect_failed', `the poll answered ${result?.outcome} ${result?.errorCode}`);
  for (const [who, token] of [['owner', w.owner], ['second user', w.two]]) {
    const page = await get('/travel', token);
    for (const t of ['Last check: ', 'failed (connect_failed)']) check('H14', hasText(uncommented(page.text), t), `/travel after the poll lacks "${t}" for the ${who}`);
    said.push(page.text);
    said.push((await get('/api/v1/loyalty', token)).text);
  }
  for (const text of said) for (const t of secrets) check('H14', !holds(text, t), `a response of the step holds "${t}"`);
  console.log(`H14 sample ${sample.slice(from, from + 24).join(' | ')}`);
  pass('H14', `both users, /travel and /api/v1/loyalty before and after the poll: the panel shows ${before.length} phrases, the unauthenticated poll is 401, the owner's poll is 200 error connect_failed against a closed loopback port, /travel then shows the failed check; ${said.length} responses hold none of the body canary, the password, the user or the loopback host`);

  // ── H15 ── (P8-42c2) The reading queue on /travel and its actions, over real HTTP for both people.
  // Seeded by SQL from the pinned fixture's `surface` group: three programs with sender domains, three
  // memberships with fabricated numbers and baselines, three queued readings (a unique match, an
  // ambiguous suffix, no date), an applied reading carrying an expiry and an instrument, a reading
  // without a balance, a failed one and one waiting to retry. The server has no API key, so reading
  // is "not set up" and the read route answers `disabled`; the queue actions still work, because a
  // person's decision needs no model. No full member number, key or loopback host may appear.
  current = 'H15';
  {
    const S = READ.surface;
    const q = (t) => `'${String(t).replace(/'/g, "''")}'`;
    const dayExpr = (v) => {
      if (v === null || v === undefined) return 'NULL';
      const m = /^\{\{DAY:(-?\d+)\}\}$/.exec(v);
      return m ? `(CURRENT_DATE + ${Number(m[1])})` : `${q(v)}::date`;
    };
    const dateJson = (v) => JSON.parse(JSON.stringify(v ?? []).replace(/\{\{DAY:(-?\d+)\}\}/g, (_, n) => psql(`SELECT (CURRENT_DATE + ${Number(n)})::text`)));
    const memberName = new Map(READ.members.map((m) => [m.id, m.displayName]));
    const programName = new Map(S.programs.map((p) => [p.id, p.name]));
    for (const p of S.programs) {
      psql(`INSERT INTO loyalty_programs (name, kind, default_unit) VALUES (${q(p.name)}, ${q(p.kind)}, ${q(p.defaultUnit)});
        INSERT INTO loyalty_sender_domains (program_id, domain) VALUES ((SELECT id FROM loyalty_programs WHERE name = ${q(p.name)}), ${q(p.domain)});`);
    }
    // A person holds at most one membership of a program (UNIQUE member_id, program_id) and the fixture
    // gives one person two of one program, so each fixture membership gets its own household member,
    // named after the fixture person and the membership. Nothing in the step reads who holds it.
    const holderOf = (m) => `${memberName.get(m.member)} ${m.id}`;
    for (const m of S.memberships) psql(`INSERT INTO household_members (display_name) VALUES (${q(holderOf(m))})`);
    const membershipOf = new Map();
    for (const m of S.memberships) {
      const id = Number(psql(`INSERT INTO loyalty_memberships (member_id, program_id, member_number)
        VALUES ((SELECT id FROM household_members WHERE display_name = ${q(holderOf(m))}),
                (SELECT id FROM loyalty_programs WHERE name = ${q(programName.get(m.program))}), ${q(m.memberNumber)}) RETURNING id`).split('\n').pop());
      membershipOf.set(m.id, id);
      psql(`INSERT INTO loyalty_observations (membership_id, as_of, balance, unit, source)
        VALUES (${id}, CURRENT_DATE + ${m.baseline.asOfOffset}, ${q(m.baseline.balance)}::numeric, ${q(m.baseline.unit)}, 'typed')`);
    }
    const readOf = new Map();
    for (const r of S.reads) {
      const program = `(SELECT id FROM loyalty_programs WHERE name = ${q(programName.get(r.program))})`;
      const key = q(sha256(`zq42c2-surface-${r.id}`));
      const received = `CURRENT_DATE + ${r.receivedOffset}`;
      let values;
      if (r.state === 'failed' || r.state === 'retry') {
        values = `${key}, ${program}, ${received}, ${q(r.state)}, ${r.attempts}, ${q(r.errorCode)}, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, '[]', '[]'`;
      } else {
        const membership = r.membership === null ? 'NULL' : membershipOf.get(r.membership);
        const observation = r.state === 'applied' ? `(SELECT max(id) FROM loyalty_observations WHERE membership_id = ${membership})` : 'NULL';
        values = [key, program, received, q(r.state), 1, 'NULL', r.reason === null ? 'NULL' : q(r.reason), r.suffix === null ? 'NULL' : q(r.suffix),
          r.balance === null ? 'NULL' : `${q(r.balance)}::numeric`, r.unit === null ? 'NULL' : q(r.unit), dayExpr(r.asOf),
          q(r.suffix === null ? 'not_stated' : 'match'), 'CURRENT_DATE', r.state === 'pending' ? 'NULL' : 'CURRENT_DATE', membership, observation,
          q(JSON.stringify(dateJson(r.expiryWarnings))), q(JSON.stringify(dateJson(r.instruments)))].join(', ');
      }
      readOf.set(r.id, Number(psql(`INSERT INTO loyalty_inbox_reads (dedupe_key, program_id, received_on, state, attempts, last_error_code, reason, suffix,
          balance, unit, as_of, program_check, read_on, resolved_on, membership_id, observation_id, expiry_warnings, instruments)
        VALUES (${values}) RETURNING id`).split('\n').pop()));
    }
    // A read-scope personal token of the owner, minted the way `createPersonalToken` stores one.
    const readToken = randomBytes(32).toString('base64url');
    psql(`INSERT INTO auth_sessions (token_hash, credential_id, kind, scope, label, expires_at)
      VALUES ('${sha256(readToken)}', 'gifts-check-owner-cred', 'personal', 'read', 'zq42c2 read token', NOW() + interval '2 hours')`);

    const readSecrets = [...S.memberships.map((m) => m.memberNumber), READ.canaries.key, READ.canaries.baseUrlHost, '127.0.0.1', `:${modelPort}`];
    const heard = [];
    const post = async (path, headers, body) => {
      const res = await fetch(`${ORIGIN}${path}`, { method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body: JSON.stringify(body) });
      const text = await res.text();
      heard.push(text);
      let json = null;
      try { json = JSON.parse(text); } catch { /* reported by the status checks */ }
      return { status: res.status, json };
    };
    const owner = { cookie: `b8_session=${w.owner}` };
    const travelOf = async (token) => {
      const page = await get('/travel', token);
      heard.push(page.text);
      return { status: page.status, html: uncommented(page.text) };
    };
    const apiOf = async (token) => {
      const api = await get('/api/v1/loyalty', token);
      heard.push(api.text);
      return { status: api.status, data: JSON.parse(api.text).data };
    };

    for (const [who, token] of [['owner', w.owner], ['second user', w.two]]) {
      const page = await travelOf(token);
      check('H15', page.status === 200, `/travel answered ${page.status} for the ${who}`);
      for (const t of S.expectText) check('H15', hasText(page.html, t), `/travel lacks "${t}" for the ${who}`);
      for (const t of S.expectAbsent) check('H15', !hasText(page.html, t), `/travel shows "${t}" for the ${who}`);
      const api = await apiOf(token);
      check('H15', api.status === 200 && api.data.inboxRead.readable === false, `/api/v1/loyalty answered ${api.status} for the ${who}`);
    }
    const [ownerView, twoView] = [await apiOf(w.owner), await apiOf(w.two)];
    check('H15', JSON.stringify(ownerView.data.inboxRead) === JSON.stringify(twoView.data.inboxRead), 'the two users got different reading panels');

    // The read route: 200 disabled for the owner, 401 with no credential, 403 for a read-scope token.
    const readPath = '/api/v1/loyalty/inbox/read';
    const disabled = await post(readPath, owner, {});
    check('H15', disabled.status === 200 && disabled.json?.data?.outcome === 'disabled', `the read answered ${disabled.status} ${disabled.json?.data?.outcome}`);
    const noCookie = await post(readPath, {}, {});
    check('H15', noCookie.status === 401, `the read with no cookie answered ${noCookie.status}`);
    const readScope = await post(readPath, { authorization: `Bearer ${readToken}` }, {});
    check('H15', readScope.status === 403, `the read with a read-scope token answered ${readScope.status}`);
    const actionByToken = await post(`/api/v1/loyalty/inbox/readings/${readOf.get(S.applyItem)}`, { authorization: `Bearer ${readToken}` }, { action: 'apply' });
    check('H15', actionByToken.status === 403, `an apply with a read-scope token answered ${actionByToken.status}`);

    // Apply the unique item: 200, it leaves the queue, the balance is the applied one; a second apply is 409.
    const itemPath = (id) => `/api/v1/loyalty/inbox/readings/${readOf.get(id)}`;
    const applied = await post(itemPath(S.applyItem), owner, { action: 'apply' });
    check('H15', applied.status === 200 && applied.json?.data?.state === 'applied_by_hand', `the apply answered ${applied.status}`);
    const after = await apiOf(w.owner);
    const target = membershipOf.get(S.expectAfterApply.membership);
    const shown = after.data.cards.flatMap((c) => c.memberships).find((m) => m.id === target);
    check('H15', shown?.balance === S.expectAfterApply.balance, 'the applied balance is not the membership\'s current balance in the API');
    check('H15', after.data.inboxRead.needsAttentionTotal === S.expectAfterApply.queueTotal
      && !after.data.inboxRead.needsAttention.some((i) => i.id === readOf.get(S.applyItem)), 'the applied item is still queued');
    const grouped = S.expectAfterApply.balance.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
    const travelAfter = await travelOf(w.owner);
    check('H15', hasText(travelAfter.html, grouped), 'the applied balance is not shown on /travel');
    check('H15', hasText(travelAfter.html, `Needs attention: ${S.expectAfterApply.queueTotal}`), '/travel does not show the new queue total');
    const again = await post(itemPath(S.applyItem), owner, { action: 'apply' });
    check('H15', again.status === 409 && again.json?.error?.code === 'ITEM_RESOLVED', `a second apply answered ${again.status}`);

    // The ambiguous item refuses a membership of another program, then not_mine and ignore leave the queue.
    const elsewhere = Number(psql(`INSERT INTO loyalty_memberships (member_id, program_id)
      VALUES ((SELECT id FROM household_members WHERE display_name = ${q(holderOf(S.memberships[0]))}),
              (SELECT id FROM loyalty_programs WHERE name = ${q(programName.get('sn'))})) RETURNING id`).split('\n').pop());
    const wrong = await post(itemPath('q-ambiguous'), owner, { action: 'apply', membershipId: elsewhere });
    check('H15', wrong.status === 400 && wrong.json?.error?.code === 'INVALID_INPUT', `an apply to another program's membership answered ${wrong.status}`);
    const notMine = await post(itemPath('q-ambiguous'), owner, { action: 'not_mine' });
    check('H15', notMine.status === 200 && notMine.json?.data?.state === 'not_mine', `not mine answered ${notMine.status}`);
    const ignored = await post(itemPath('q-no-date'), owner, { action: 'ignore' });
    check('H15', ignored.status === 200 && ignored.json?.data?.state === 'ignored', `ignore answered ${ignored.status}`);
    const emptied = await apiOf(w.owner);
    check('H15', emptied.data.inboxRead.needsAttentionTotal === 0, 'not mine and ignore left an item queued');
    check('H15', hasText((await travelOf(w.two)).html, 'Nothing needs attention'), '/travel does not say the queue is empty');

    for (const text of heard) for (const t of readSecrets) check('H15', !holds(text, t), `a response of the step holds "${t}"`);
    pass('H15', `both users, /travel and /api/v1/loyalty: ${S.expectText.length} phrases present and ${S.expectAbsent.length} absent with reading not set up; the read route is 200 disabled for the owner, 401 with no cookie and 403 for a read-scope token; apply on the unique item is 200, reaches the membership's balance in the API and on /travel, and a second apply is 409; the ambiguous item refuses another program's membership with 400; not mine and ignore empty the queue; ${heard.length} responses hold no full member number, key or loopback host`);
  }

  // ── H16 ── (P8-42d) A balance from a screenshot, over real HTTP for both people, with no API key.
  // One fabricated program with no sender domain and two memberships: one whose reading is 46 days old
  // (due) carrying a full member-number canary, and one read today (not due). Earlier steps' memberships
  // stay; whichever of them the panel lists as due are due too, so the step reads the list from the API
  // rather than assuming it. The control is on every membership and on every due entry, so the page
  // carries it exactly (memberships + due entries) times. The read route has no key, so it answers
  // `disabled` and sends nothing; each due membership is then confirmed with today's date through the
  // real confirm route until the list is empty, and the section must be gone. The canary must appear
  // in no response.
  current = 'H16';
  {
    const S = READ.surface;
    const NUMBER = 'ZQ42DSURFACENUMBER7K9X';
    psql(`
      INSERT INTO loyalty_programs (name, kind, default_unit) VALUES ('ZQ42D Surface Air', 'airline', 'points');
      INSERT INTO household_members (display_name) VALUES ('ZQ42D Surface Due'), ('ZQ42D Surface Fresh');
      INSERT INTO loyalty_memberships (member_id, program_id, member_number) VALUES
        ((SELECT id FROM household_members WHERE display_name = 'ZQ42D Surface Due'), (SELECT id FROM loyalty_programs WHERE name = 'ZQ42D Surface Air'), '${NUMBER}'),
        ((SELECT id FROM household_members WHERE display_name = 'ZQ42D Surface Fresh'), (SELECT id FROM loyalty_programs WHERE name = 'ZQ42D Surface Air'), NULL);
      INSERT INTO loyalty_observations (membership_id, as_of, balance, unit, source) VALUES
        ((SELECT m.id FROM loyalty_memberships m JOIN household_members h ON h.id = m.member_id WHERE h.display_name = 'ZQ42D Surface Due'), CURRENT_DATE - 46, 12, 'points', 'typed'),
        ((SELECT m.id FROM loyalty_memberships m JOIN household_members h ON h.id = m.member_id WHERE h.display_name = 'ZQ42D Surface Fresh'), CURRENT_DATE, 12, 'points', 'typed');`);
    const idOf = (name) => Number(psql(`SELECT m.id FROM loyalty_memberships m JOIN household_members h ON h.id = m.member_id WHERE h.display_name = '${name}'`));
    const dueId = idOf('ZQ42D Surface Due');
    const freshId = idOf('ZQ42D Surface Fresh');
    const today = psql('SELECT CURRENT_DATE::text');
    const readToken = randomBytes(32).toString('base64url');
    psql(`INSERT INTO auth_sessions (token_hash, credential_id, kind, scope, label, expires_at)
      VALUES ('${sha256(readToken)}', 'gifts-check-owner-cred', 'personal', 'read', 'zq42d read token', NOW() + interval '2 hours')`);
    const heard = [];
    const people = [['owner', w.owner], ['second user', w.two]];
    const travelOf = async (token) => {
      const page = await get('/travel', token);
      heard.push(page.text);
      return { status: page.status, html: uncommented(page.text) };
    };
    const apiOf = async (token) => {
      const api = await get('/api/v1/loyalty', token);
      heard.push(api.text);
      return { status: api.status, data: JSON.parse(api.text).data };
    };
    const send = async (path, headers, body, type) => {
      const res = await fetch(`${ORIGIN}${path}`, { method: 'POST', headers: { 'content-type': type, ...headers }, body });
      const text = await res.text();
      heard.push(text);
      let json = null;
      try { json = JSON.parse(text); } catch { /* reported by the status checks */ }
      return { status: res.status, json };
    };
    const image = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), randomBytes(60)]);
    const readPath = (id) => `/api/v1/loyalty/memberships/${id}/screenshot`;
    const confirmPath = (id) => `/api/v1/loyalty/memberships/${id}/screenshot/confirm`;
    const confirm = (id, headers, body) => send(confirmPath(id), headers, JSON.stringify(body), 'application/json');
    const occurrences = (html, t) => html.split(t).length - 1;
    const views = (data) => data.cards.flatMap((c) => c.memberships);

    // (a), (b), (f) and (g) before anything is confirmed.
    const dueBefore = [];
    for (const [who, token] of people) {
      const page = await travelOf(token);
      const api = await apiOf(token);
      check('H16', page.status === 200 && api.status === 200, `/travel answered ${page.status} and the API ${api.status} for the ${who}`);
      const due = api.data.inboxRead.screenshotDue;
      const memberships = views(api.data).length;
      check('H16', due.includes(dueId) && !due.includes(freshId) && memberships > due.length, `the ${who}'s due list does not hold the due membership alone of the two`);
      const controls = occurrences(page.html, 'Update from screenshot');
      check('H16', controls === memberships + due.length, `/travel shows the control ${controls} times for the ${who}, not ${memberships} + ${due.length}`);
      check('H16', hasText(page.html, 'Needs a screenshot'), `/travel lacks the heading for the ${who}`);
      for (const t of S.expectAbsent) check('H16', !hasText(page.html, t), `/travel shows "${t}" for the ${who}`);
      const stillTrue = S.expectText.filter((t) => !/^(Needs attention: |ZQ42C2 Surface Air · |Why: |Apply|Not mine|Ignore|Choose a membership)/.test(t));
      for (const t of stillTrue) check('H16', hasText(page.html, t), `/travel lacks H15's "${t}" for the ${who}`);
      dueBefore.push(JSON.stringify(due));
    }
    check('H16', dueBefore[0] === dueBefore[1], 'the two users got different due lists');

    // (c) The read route: 401, 403, then 200 disabled with every data field null, for both people.
    const noCredential = await send(readPath(dueId), {}, image, 'image/jpeg');
    check('H16', noCredential.status === 401, `the read with no credential answered ${noCredential.status}`);
    const readScope = await send(readPath(dueId), { authorization: `Bearer ${readToken}` }, image, 'image/jpeg');
    check('H16', readScope.status === 403, `the read with a read-scope token answered ${readScope.status}`);
    for (const [who, token] of people) {
      const r = await send(readPath(dueId), { cookie: `b8_session=${token}` }, image, 'image/jpeg');
      const d = r.json?.data;
      check('H16', r.status === 200 && d?.outcome === 'disabled', `the read answered ${r.status} ${d?.outcome} for the ${who}`);
      check('H16', ['errorCode', 'balance', 'unit', 'asOf', 'maskedSuffix'].every((k) => d[k] === null) && d.expiryWarnings.length === 0 && d.instruments.length === 0,
        `the disabled read carried data for the ${who}`);
    }

    // (d) The confirm route: 401, 403, then 201; the API then shows a screenshot reading and no prompt.
    const body = { asOf: today, balance: '12', unit: 'points' };
    const anon = await confirm(dueId, {}, body);
    check('H16', anon.status === 401, `the confirm with no credential answered ${anon.status}`);
    const scoped = await confirm(dueId, { authorization: `Bearer ${readToken}` }, body);
    check('H16', scoped.status === 403, `the confirm with a read-scope token answered ${scoped.status}`);
    const saved = await confirm(dueId, { cookie: `b8_session=${w.owner}` }, body);
    check('H16', saved.status === 201 && saved.json?.data?.source === 'screenshot', `the confirm answered ${saved.status}`);
    const after = await apiOf(w.two);
    check('H16', views(after.data).find((m) => m.id === dueId)?.source === 'screenshot', 'the API does not show the confirmed reading as current');
    check('H16', !after.data.inboxRead.screenshotDue.includes(dueId), 'the confirmed membership is still due');

    // (b) Every other due membership, confirmed for today, until the list is empty; the heading goes.
    const units = new Map(after.data.programs.map((p) => [p.id, p.defaultUnit]));
    let confirmed = 1;
    for (const id of after.data.inboxRead.screenshotDue) {
      const m = views(after.data).find((v) => v.id === id);
      const r = await confirm(id, { cookie: `b8_session=${w.two}` }, { asOf: today, balance: '12', unit: m.unit ?? units.get(m.programId) });
      check('H16', r.status === 201, `confirming membership ${id} answered ${r.status}`);
      confirmed++;
    }
    const dueAfter = [];
    for (const [who, token] of people) {
      const api = await apiOf(token);
      check('H16', api.data.inboxRead.screenshotDue.length === 0, `the ${who}'s due list is not empty after the confirms`);
      dueAfter.push(JSON.stringify(api.data.inboxRead.screenshotDue));
      const page = await travelOf(token);
      check('H16', !hasText(page.html, 'Needs a screenshot'), `/travel still shows the heading for the ${who}`);
      check('H16', occurrences(page.html, 'Update from screenshot') === views(api.data).length, `/travel's control count is not one per membership for the ${who}`);
    }
    check('H16', dueAfter[0] === dueAfter[1], 'the two users got different due lists after the confirms');

    // (e) The full member number reached no response of the step.
    for (const text of heard) check('H16', !holds(text, NUMBER), 'a response of the step holds the full member number');
    pass('H16', `both users: /travel carries the control once per membership and once per due entry, with the heading while ${JSON.parse(dueBefore[0]).length} memberships are due; the read route is 401 with no credential, 403 for a read-scope token and 200 disabled with every field null for both people; the confirm route is 401, 403, then 201 with source screenshot, and ${confirmed} confirms for today empty the due list and remove the heading; both people get the same list before and after; H15's ${S.expectAbsent.length} absent phrases stay absent; ${heard.length} responses hold no full member number`);
  }

  console.log('OK H1-H16');
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
