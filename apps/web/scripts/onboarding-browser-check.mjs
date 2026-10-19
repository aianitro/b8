#!/usr/bin/env node
// The browser check for P7-41a2: the owner mints an invitation in the app, a second "device" opens
// the link and enrols a passkey, and nothing about the code leaks on the way. Scenarios B1 to B9 of
// plan/tasks/P7-41a2-browser-onboarding/SPEC.md.
//
//   node apps/web/scripts/onboarding-browser-check.mjs                  (from the repo root)
//   node apps/web/scripts/onboarding-browser-check.mjs --screenshots=DIR
//
// It prints one line per step, `B<n> PASS <what was observed>`, then `OK B1-B9`. The first failing
// step prints `B<n> FAIL <observed>` and the script exits non-zero after cleaning up.
//
// ─── Why it needs its own database, and port 3000 ─────────────────────────────────────────────
//
// It makes its OWN scratch database, `b8_onboarding_check`, by that hard-coded name. It never reads
// DATABASE_URL, refuses to touch any other name, and drops the database at the end, so no setting
// anywhere can aim it at the owner's ledger. The data is fabricated: one owner called "Owner", with
// a placeholder credential and a browser session minted with `psql`, the way `screenshots.mjs`
// does it — and nothing else, so no page it opens shows a figure.
//
// The dev server must be on port 3000 and the browser on `http://localhost:3000`, because that is
// the WebAuthn origin the server accepts (`APP_PORT` in `lib/webauthnOrigins.ts`) and an origin is
// matched as a whole string. `screenshots.mjs`'s port would make every ceremony a SecurityError. The
// in-process Plaid scheduler is switched off for the run.
//
// ─── Why five Chromes ─────────────────────────────────────────────────────────────────────────
//
// Each "device" is a separate Chrome process with its own throwaway profile directory, so no cookie,
// storage area or credential is shared between them, and each has its own virtual authenticator
// (`WebAuthn.addVirtualAuthenticator`) standing in for a platform passkey. Chrome is driven over
// its DevTools protocol with Node's own WebSocket, as in `screenshots.mjs`.
//
// ─── The code is never printed ────────────────────────────────────────────────────────────────
//
// The minted codes exist in this process's memory only. Every line this script prints passes
// through `redact`, which replaces any code it knows with `<code>`; observations are lengths and
// booleans. The dev server's output goes to a file in a temporary directory, which step B3 counts
// the code in and which is deleted with the directory.

import { spawn, execFileSync } from 'node:child_process';
import { createHash, randomBytes } from 'node:crypto';
import { createWriteStream, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const WEB = resolve(HERE, '..');
const ROOT = resolve(WEB, '../..');
const DB = 'b8_onboarding_check';
const PORT = 3000;
const ORIGIN = `http://localhost:${PORT}`;
const CHROME = process.env.CHROME ?? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const INVITEE = 'Test User Two';
const SHOTS = process.argv.find((a) => a.startsWith('--screenshots='))?.slice('--screenshots='.length) ?? null;

/** The one database this script may touch. A second guard, so an edit to `DB` alone cannot widen it. */
function guardedDatabase(name) {
  if (name !== 'b8_onboarding_check') throw new Error(`refusing to touch database ${name}`);
  return name;
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const sha256 = (value) => createHash('sha256').update(value).digest('hex');

// ─── Output, redacted ─────────────────────────────────────────────────────────────────────────

const secrets = new Set();
function redact(text) {
  let out = String(text);
  for (const secret of secrets) out = out.split(secret).join('<code>');
  return out;
}

class StepFailure extends Error {
  constructor(step, observed) { super(observed); this.step = step; }
}
function check(step, condition, observed) {
  if (!condition) throw new StepFailure(step, observed);
}
const pass = (step, observed) => console.log(redact(`${step} PASS ${observed}`));

// ─── The scratch database ─────────────────────────────────────────────────────────────────────

const db = guardedDatabase(DB);
const psql = (sql) => execFileSync('psql', ['-d', db, '-v', 'ON_ERROR_STOP=1', '-Atqc', sql]).toString().trim();

function prepareDatabase() {
  execFileSync('dropdb', ['--if-exists', db], { stdio: 'ignore' });
  execFileSync('createdb', [db], { stdio: 'ignore' });
  execFileSync('npx', ['node-pg-migrate', 'up'], {
    cwd: ROOT, env: { ...process.env, DATABASE_URL: `postgresql://localhost/${db}` }, stdio: 'ignore',
  });
  const token = randomBytes(32).toString('base64url');
  psql(`
    INSERT INTO users (display_name, is_owner) VALUES ('Owner', TRUE);
    INSERT INTO webauthn_credentials (credential_id, public_key, sign_count, enrolled_via, user_id)
      VALUES ('onboarding-check-owner-cred', '\\x00'::bytea, 0, 'bootstrap', (SELECT id FROM users WHERE is_owner));
    INSERT INTO auth_sessions (token_hash, credential_id, expires_at)
      VALUES ('${sha256(token)}', 'onboarding-check-owner-cred', NOW() + interval '2 hours');`);
  return token;
}

const counts = () => {
  const [users, credentials, ownerCredentials] = psql(`SELECT
      (SELECT COUNT(*) FROM users), (SELECT COUNT(*) FROM webauthn_credentials),
      (SELECT COUNT(*) FROM webauthn_credentials WHERE user_id = (SELECT id FROM users WHERE is_owner))`).split('|').map(Number);
  return { users, credentials, ownerCredentials };
};
const consumed = (code) => psql(`SELECT consumed_at IS NOT NULL FROM user_invitations WHERE code_hash = '${sha256(code)}'`);

// ─── The server and the browsers ──────────────────────────────────────────────────────────────

async function waitFor(url, tries = 120) {
  for (let i = 0; i < tries; i++) {
    try { if ((await fetch(url)).status < 500) return; } catch { /* not up yet */ }
    await sleep(1000);
  }
  throw new Error(`timed out waiting for ${url}`);
}

/** A DevTools connection with request/response and event subscription. */
function cdp(wsUrl) {
  const ws = new WebSocket(wsUrl);
  let id = 0;
  const pending = new Map();
  const listeners = new Map();
  ws.addEventListener('message', (e) => {
    const msg = JSON.parse(e.data);
    if (msg.id && pending.has(msg.id)) {
      const { ok, fail } = pending.get(msg.id);
      pending.delete(msg.id);
      if (msg.error) fail(new Error(msg.error.message)); else ok(msg.result);
    } else if (msg.method) {
      for (const handler of listeners.get(msg.method) ?? []) handler(msg.params);
    }
  });
  const opened = new Promise((r) => ws.addEventListener('open', r, { once: true }));
  return {
    opened,
    send: (method, params = {}) => new Promise((ok, fail) => {
      const n = ++id;
      pending.set(n, { ok, fail });
      ws.send(JSON.stringify({ id: n, method, params }));
    }),
    on: (method, handler) => listeners.set(method, [...(listeners.get(method) ?? []), handler]),
    close: () => ws.close(),
  };
}

const DESKTOP = { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false };
const PHONE = { width: 390, height: 844, deviceScaleFactor: 2, mobile: true };

const browsers = [];
let nextCdpPort = 9351;

/**
 * A fresh "device": its own Chrome, its own profile directory, its own virtual authenticator, and a
 * network log of every request the page makes (URL, method, and the full header set Chrome sent,
 * including the `Referer` it computed).
 */
async function device(name) {
  const port = nextCdpPort++;
  const profile = mkdtempSync(join(tmpdir(), `b8-onboarding-${name}-`));
  const proc = spawn(CHROME, [
    '--headless=new', `--remote-debugging-port=${port}`, `--user-data-dir=${profile}`,
    '--hide-scrollbars', '--no-first-run', '--no-default-browser-check', 'about:blank',
  ], { stdio: 'ignore' });
  browsers.push({ proc, profile });
  await waitFor(`http://127.0.0.1:${port}/json/version`, 30);
  const target = await (await fetch(`http://127.0.0.1:${port}/json/new?about:blank`, { method: 'PUT' })).json();
  const page = cdp(target.webSocketDebuggerUrl);
  await page.opened;

  const requests = new Map();
  page.on('Network.requestWillBeSent', (p) => {
    const r = requests.get(p.requestId) ?? { headers: {} };
    requests.set(p.requestId, { ...r, id: p.requestId, url: p.request.url, method: p.request.method, headers: { ...r.headers, ...p.request.headers } });
  });
  page.on('Network.requestWillBeSentExtraInfo', (p) => {
    const r = requests.get(p.requestId) ?? { id: p.requestId, headers: {} };
    requests.set(p.requestId, { ...r, headers: { ...r.headers, ...p.headers } });
  });
  page.on('Network.responseReceived', (p) => {
    const r = requests.get(p.requestId);
    if (r) r.status = p.response.status;
  });

  await page.send('Page.enable');
  await page.send('Runtime.enable');
  await page.send('Network.enable');
  await page.send('Network.setCacheDisabled', { cacheDisabled: true });
  await page.send('WebAuthn.enable');
  const { authenticatorId } = await page.send('WebAuthn.addVirtualAuthenticator', {
    options: {
      protocol: 'ctap2', transport: 'internal', hasResidentKey: true,
      hasUserVerification: true, isUserVerified: true, automaticPresenceSimulation: true,
    },
  });

  const evaluate = async (expression) => {
    const { result, exceptionDetails } = await page.send('Runtime.evaluate', {
      expression, returnByValue: true, awaitPromise: true, userGesture: true,
    });
    if (exceptionDetails) throw new Error(`page script failed: ${exceptionDetails.exception?.description ?? exceptionDetails.text}`);
    return result.value;
  };
  const until = async (expression, what, timeoutMs = 60000) => {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      try { const value = await evaluate(expression); if (value) return value; } catch { /* mid-navigation */ }
      await sleep(250);
    }
    throw new Error(`timed out waiting for ${what}`);
  };
  const size = async (metrics) => {
    const phone = metrics === PHONE;
    await page.send('Emulation.setDeviceMetricsOverride', metrics);
    await page.send('Emulation.setTouchEmulationEnabled', { enabled: phone, maxTouchPoints: phone ? 5 : 1 });
  };
  const go = async (url) => {
    await page.send('Page.navigate', { url });
    await until(`document.readyState === 'complete' && location.href !== 'about:blank'`, `load of ${url}`);
  };
  const credentials = async () => (await page.send('WebAuthn.getCredentials', { authenticatorId })).credentials.length;
  const storage = () => evaluate(`JSON.stringify([Object.entries(localStorage), Object.entries(sessionStorage), document.cookie])`);
  const shot = async (file) => {
    if (!SHOTS) return;
    // Next's dev badge is not part of the app, and the link field is blurred so no screenshot can
    // carry a code: the glyphs are made transparent and only a blurred shadow of them is drawn.
    await evaluate(`(() => { const s = document.createElement('style'); s.textContent =
      'nextjs-portal{display:none!important} [data-invite-link]{color:transparent!important;text-shadow:0 0 9px rgba(15,23,42,.75)!important}';
      document.head.append(s); return true; })()`);
    await sleep(300);
    const { data } = await page.send('Page.captureScreenshot', { format: 'png' });
    mkdirSync(SHOTS, { recursive: true });
    writeFileSync(join(SHOTS, `${file}.png`), Buffer.from(data, 'base64'));
  };
  return { page, requests, evaluate, until, size, go, credentials, storage, shot };
}

// ─── Page scripts ─────────────────────────────────────────────────────────────────────────────

/** The invite control in the visible container: the drawer on a phone, the sidebar otherwise. */
const CONTROL = (phone) => phone
  ? `document.querySelector('div.fixed.inset-0 [data-invite-control]')`
  : `document.querySelector('aside [data-invite-control]')`;

const signedInAs = (phone) => phone
  ? `document.querySelector('div.fixed.inset-0')?.textContent.includes('Signed in as')`
  : `document.querySelector('aside')?.textContent.includes('Signed in as')`;

const alertText = `[...document.querySelectorAll('[role=alert]')].map((e) => e.textContent.trim()).filter(Boolean).join(' ')`;

/**
 * B1 at one width: open the control, type the name, submit with the request held by the DevTools
 * `Fetch` domain so the in-flight state can be observed deterministically, double-click while held,
 * release, read the link, dismiss, and look for the code everywhere. Returns the minted code.
 */
async function ownerMints(A, phone) {
  await A.size(phone ? PHONE : DESKTOP);
  // Categories rather than the dashboard: on this empty fabricated store the dashboard renders
  // zero-dollar tiles, and a screenshot of the panel has no business carrying any figure at all.
  await A.go(`${ORIGIN}/categories`);
  if (phone) {
    await A.until(`!!document.querySelector('button[aria-label="Open navigation"]')`, 'the menu button');
    await A.until(`(document.querySelector('button[aria-label="Open navigation"]').click(), !!document.querySelector('div.fixed.inset-0'))`, 'the drawer');
  }
  await A.until(`!!${CONTROL(phone)}`, 'the invite control', 90000);
  await A.evaluate(`((el) => (el.matches('button') ? el : el.querySelector('button')).click())(${CONTROL(phone)})`);
  await A.until(`!!document.querySelector('#invite-name')`, 'the name field');
  await A.evaluate(`document.querySelector('#invite-name').focus()`);
  await A.page.send('Input.insertText', { text: INVITEE });
  await A.until(`document.querySelector('[data-invite-submit]') && !document.querySelector('[data-invite-submit]').disabled`, 'an enabled submit');

  // Hold the create request at the network layer.
  const paused = [];
  A.page.on('Fetch.requestPaused', (p) => paused.push(p));
  await A.page.send('Fetch.enable', { patterns: [{ urlPattern: '*/api/v1/auth/invitations', requestStage: 'Request' }] });
  await A.evaluate(`document.querySelector('[data-invite-submit]').click()`);
  const deadline = Date.now() + 15000;
  while (paused.length === 0 && Date.now() < deadline) await sleep(50);
  check('B1', paused.length === 1, `create request not observed in flight (paused=${paused.length})`);
  const disabledInFlight = await A.evaluate(`document.querySelector('[data-invite-submit]').disabled`);
  // A second click while held must not start a second request.
  await A.evaluate(`document.querySelector('[data-invite-submit]').click(); document.querySelector('[data-invite-submit]').click()`);
  await sleep(800);
  const heldCount = paused.length;
  await A.page.send('Fetch.continueRequest', { requestId: paused[0].requestId });
  await A.page.send('Fetch.disable');
  check('B1', disabledInFlight === true, 'the submit control was enabled while the request was in flight');
  check('B1', heldCount === 1, `a double click started ${heldCount} create requests`);

  await A.until(`!!document.querySelector('[data-invite-link]')`, 'the invitation link');
  const link = await A.evaluate(`document.querySelector('[data-invite-link]').value`);
  const shownExpiry = await A.evaluate(`document.querySelector('[data-invite-panel] time')?.getAttribute('datetime') ?? null`);
  const shownText = await A.evaluate(`document.querySelector('[data-invite-panel] time')?.textContent ?? ''`);

  // What the server actually answered, read off the wire.
  const create = [...A.requests.values()].filter((r) => r.url === `${ORIGIN}/api/v1/auth/invitations` && r.method === 'POST');
  check('B1', create.length === 1, `expected one create request, saw ${create.length}`);
  const { body } = await A.page.send('Network.getResponseBody', { requestId: create[0].id });
  const created = JSON.parse(body).data;
  secrets.add(created.code);
  A.requests.clear();

  const url = new URL(link);
  check('B1', url.search === '', 'the link has a query string');
  check('B1', url.pathname === '/login', `the link path is ${url.pathname}`);
  check('B1', url.hash.length > 1, 'the link has no fragment');
  check('B1', url.hash === `#invite=${created.code}`, 'the link fragment does not carry the server\'s code');
  check('B1', !link.slice(0, link.indexOf('#')).includes(created.code), 'the code is in the server-visible part of the link');
  check('B1', shownExpiry === created.expiresAt && shownText.length > 0, 'the panel does not show the server\'s expiresAt');

  await A.shot(phone ? 'owner-panel-390' : 'owner-panel-desktop');

  await A.evaluate(`document.querySelector('[data-invite-done]').click()`);
  await A.until(`!document.querySelector('[data-invite-panel]')`, 'the panel to close');
  const html = await A.evaluate(`document.documentElement.outerHTML + [...document.querySelectorAll('input,textarea')].map((e) => e.value).join(' ')`);
  check('B1', !html.includes(created.code), 'the code is still in the document after dismissing');
  const stored = await A.storage();
  check('B1', !stored.includes(created.code), 'the code is in localStorage, sessionStorage or document.cookie');
  return { code: created.code, link, linkLength: link.length, hashLength: url.hash.length };
}

/** Click the invitation-mode register button and wait for either a landing or a refusal. */
async function acceptInvitation(device) {
  await device.until(`!!document.querySelector('[data-invitation-register]')`, 'the invitation-mode button');
  await device.evaluate(`document.querySelector('[data-invitation-register]').click()`);
  return device.until(`location.pathname === '/dashboard' ? 'landed' : (${alertText}) ? 'refused' : ''`, 'a landing or a refusal', 60000);
}

// ─── Main ─────────────────────────────────────────────────────────────────────────────────────

const busy = Number(execFileSync('sh', ['-c', `lsof -nP -iTCP:${PORT} -sTCP:LISTEN | wc -l`]).toString().trim());
if (busy !== 0) {
  console.log(`B1 FAIL port ${PORT} is already in use; stop the server holding it`);
  process.exit(1);
}

const work = mkdtempSync(join(tmpdir(), 'b8-onboarding-check-'));
const serverLogPath = join(work, 'server.log');
const serverLog = createWriteStream(serverLogPath);
const ownerToken = prepareDatabase();
const server = spawn('npx', ['next', 'dev', '-H', 'localhost', '-p', String(PORT)], {
  cwd: WEB,
  env: { ...process.env, DATABASE_URL: `postgresql://localhost/${db}`, SCHEDULER_IN_PROCESS: 'false' },
  stdio: ['ignore', 'pipe', 'pipe'],
  detached: true,
});
server.stdout.pipe(serverLog);
server.stderr.pipe(serverLog);

let exitCode = 0;
// The step under way, so an unexpected error (a timeout, a page script throwing) is still reported
// against the step that hit it.
let current = 'B1';
try {
  await waitFor(`${ORIGIN}/login`);

  // ── B1 ──
  current = 'B1';
  const A = await device('A');
  await A.page.send('Network.setCookie', { name: 'b8_session', value: ownerToken, domain: 'localhost', path: '/' });
  const desktop = await ownerMints(A, false);
  const phone = await ownerMints(A, true);
  pass('B1', `owner minted at 1440px and 390px (drawer); link path=/login search='' hash length=${desktop.hashLength}/${phone.hashLength}; expiresAt shown matches server; submit disabled in flight, one request per double click; after Done the code is in neither the DOM nor localStorage/sessionStorage/document.cookie`);

  // ── B2 ──
  current = 'B2';
  const before2 = counts();
  const B = await device('B');
  await B.size(DESKTOP);
  await B.go(desktop.link);
  const hashAtLoad = await B.evaluate(`location.hash`);
  const hrefAtLoad = await B.evaluate(`location.href`);
  // The scrub runs on hydration; give it until the invitation mode renders, then read again.
  await B.until(`!!document.querySelector('[data-invitation-register]')`, 'the invitation mode');
  const hash = await B.evaluate(`location.hash`);
  const href = await B.evaluate(`location.href`);
  check('B2', hash === '' && !href.includes(desktop.code), `fragment still present after load (hash length ${hash.length})`);
  await B.shot('invitee-invitation-mode');
  const outcome = await acceptInvitation(B);
  check('B2', outcome === 'landed', `the ceremony did not land: ${await B.evaluate(alertText)}`);
  const meBody = await B.evaluate(`fetch('/api/v1/auth/me').then((r) => r.json())`);
  check('B2', meBody?.data?.displayName === INVITEE && meBody?.data?.isOwner === false, `me returned ${JSON.stringify(meBody?.data ?? meBody)}`);
  await B.until(`document.querySelector('aside')?.textContent.includes('Signed in as') && document.querySelector('aside').textContent.includes(${JSON.stringify(INVITEE)})`, 'the sidebar name');
  const invitee = psql(`SELECT u.is_owner, u.display_name, COUNT(c.*) FROM users u LEFT JOIN webauthn_credentials c ON c.user_id = u.id
                         WHERE NOT u.is_owner GROUP BY u.id`).split('\n');
  const after2 = counts();
  check('B2', invitee.length === 1 && invitee[0] === `f|${INVITEE}|1`, `second users row is ${invitee.join(';')}`);
  check('B2', after2.users === before2.users + 1 && after2.ownerCredentials === before2.ownerCredentials, 'unexpected user or owner credential count');
  check('B2', (await B.credentials()) === 1, 'the invitee authenticator holds no credential');
  const history = await B.page.send('Page.getNavigationHistory');
  check('B2', history.entries.every((e) => !e.url.includes(desktop.code)), 'a history entry still carries the code');
  await B.evaluate(`history.back(), true`);
  await sleep(2500);
  const backHref = await B.evaluate(`location.href`);
  check('B2', !backHref.includes(desktop.code), 'Back returned to a URL containing the code');
  // Return to the signed-in page for B8.
  await B.go(`${ORIGIN}/dashboard`);
  pass('B2', `location.hash at load complete ${hashAtLoad === '' ? "''" : 'length ' + hashAtLoad.length}, href free of the code ${!hrefAtLoad.includes(desktop.code)}; after hydration hash '' and href free of the code; landed on /dashboard; me displayName=${INVITEE} isOwner=false; sidebar shows the name; users ${before2.users}->${after2.users}, invitee is_owner=f with 1 credential; ${history.entries.length} history entries free of the code; Back free of the code`);

  // ── B3 ──
  current = 'B3';
  const requestsB = [...B.requests.values()].filter((r) => r.url && !r.url.startsWith('data:'));
  const withHeader = requestsB.filter((r) => Object.keys(r.headers).some((k) => k.toLowerCase() === 'x-invitation-code'));
  const headerPaths = withHeader.map((r) => new URL(r.url).pathname).sort();
  const referers = requestsB.map((r) => Object.entries(r.headers).find(([k]) => k.toLowerCase() === 'referer')?.[1]).filter(Boolean);
  const foreign = requestsB.filter((r) => new URL(r.url).origin !== ORIGIN);
  check('B3', requestsB.every((r) => !r.url.includes(desktop.code)), 'a request URL contains the code');
  check('B3', referers.every((v) => !v.includes(desktop.code)), 'a Referer contains the code');
  check('B3', JSON.stringify(headerPaths) === JSON.stringify(['/api/v1/auth/register/options', '/api/v1/auth/register/verify']), `x-invitation-code was sent on ${headerPaths.join(', ') || 'nothing'}`);
  check('B3', withHeader.every((r) => Object.entries(r.headers).find(([k]) => k.toLowerCase() === 'x-invitation-code')[1] === desktop.code), 'the header value is not the code');
  check('B3', foreign.length === 0, `requests to another origin: ${foreign.map((r) => new URL(r.url).origin).join(', ')}`);
  const storedB = await B.storage();
  check('B3', !storedB.includes(desktop.code), 'the code is in profile B storage or cookies');
  serverLog.write('');
  await sleep(500);
  let grepCount = '0';
  try { grepCount = execFileSync('grep', ['-c', '--', desktop.code, serverLogPath]).toString().trim(); } catch (e) { grepCount = e.stdout?.toString().trim() || '0'; }
  const logText = readFileSync(serverLogPath, 'utf8');
  check('B3', grepCount === '0' && !logText.includes(phone.code) && !logText.includes(sha256(desktop.code)), `server output holds the code (grep -c ${grepCount})`);
  pass('B3', `${requestsB.length} requests from profile B: none carries the code in its URL; ${referers.length} Referer headers, none with the code; x-invitation-code only on register/options and register/verify; 0 requests to an origin other than ${ORIGIN}; storage and cookies free of the code; dev-server output grep -c = ${grepCount}`);

  // ── B4 ──
  current = 'B4';
  const before4 = counts();
  const C = await device('C');
  await C.size(DESKTOP);
  await C.go(desktop.link);
  const outcome4 = await acceptInvitation(C);
  const refusal4 = await C.evaluate(alertText);
  check('B4', outcome4 === 'refused' && refusal4.length > 0, `consumed link was not refused (${outcome4})`);
  await C.shot('invitee-refused');
  check('B4', (await C.credentials()) === 0, 'the authenticator created a credential');
  check('B4', counts().users === before4.users, 'users count changed');
  pass('B4', `consumed link refused with a visible message (${refusal4.length} characters); virtual authenticator holds 0 credentials; users ${before4.users}->${counts().users}`);

  // ── B5 ──
  current = 'B5';
  const D = await device('D');
  await D.size(DESKTOP);
  await D.go(`${ORIGIN}/login#invite=short`);
  await D.until(`(${alertText}).length > 0`, 'a refusal');
  await sleep(1500);
  const refusal5 = await D.evaluate(alertText);
  const optionsCalls = [...D.requests.values()].filter((r) => r.url?.includes('/api/v1/auth/register/options'));
  check('B5', optionsCalls.length === 0, `register/options was requested ${optionsCalls.length} times`);
  check('B5', (await D.evaluate(`location.hash`)) === '', 'the malformed fragment stayed in the address bar');
  await D.shot('malformed-link-refused');
  pass('B5', `malformed link refused with a visible message (${refusal5.length} characters) and 0 requests to register/options`);

  // ── B6 ──
  current = 'B6';
  const before6 = counts();
  await A.size(DESKTOP);
  await A.go(phone.link);
  const outcome6 = await acceptInvitation(A);
  const refusal6 = await A.evaluate(alertText);
  const after6 = counts();
  check('B6', outcome6 === 'refused' && refusal6.length > 0, `the owner's browser was not refused (${outcome6})`);
  check('B6', after6.ownerCredentials === before6.ownerCredentials && after6.users === before6.users && after6.credentials === before6.credentials, 'a credential or user was added');
  check('B6', consumed(phone.code) === 'f', 'the invitation was consumed');
  pass('B6', `owner opening a fresh link while signed in: refused (${refusal6.length} characters); owner credentials ${before6.ownerCredentials}->${after6.ownerCredentials}; users ${before6.users}->${after6.users}; invitation still unconsumed`);

  // ── B7 ──
  current = 'B7';
  const E = await device('E');
  await E.size(DESKTOP);
  await E.go(`${ORIGIN}/login`);
  const texts = await E.evaluate(`({
    buttons: [...document.querySelectorAll('main button')].map((b) => b.textContent.trim()),
    body: document.querySelector('main').textContent,
    invitation: !!document.querySelector('[data-invitation-register]'),
  })`);
  check('B7', JSON.stringify(texts.buttons) === JSON.stringify(['Sign in with a passkey', 'Register this device']), `buttons are ${texts.buttons.join(' / ')}`);
  check('B7', texts.body.includes('This app is reachable only with a passkey on this device.') && texts.body.includes('Registering a device only works before the first passkey is enrolled'), 'the explanatory text changed');
  check('B7', !texts.invitation && !texts.body.includes('invited'), 'invitation UI on an ordinary /login');
  // Hydration has no marker on this page, so the click is retried until the request is seen.
  let ordinary = [];
  for (let i = 0; i < 20 && ordinary.length === 0; i++) {
    await E.evaluate(`[...document.querySelectorAll('main button')].find((b) => b.textContent.trim() === 'Register this device').click()`);
    await sleep(750);
    ordinary = [...E.requests.values()].filter((r) => r.url?.endsWith('/api/v1/auth/register/options'));
  }
  await E.until(`(${alertText}).length > 0`, 'the closed-registration refusal');
  const refusal7 = await E.evaluate(alertText);
  const { body: closedBody } = await E.page.send('Network.getResponseBody', { requestId: ordinary[0].id });
  const closed = JSON.parse(closedBody);
  check('B7', ordinary[0].status === 403 && closed.error?.code === 'REGISTRATION_CLOSED' && refusal7 === closed.error.message, `register/options answered ${ordinary[0].status} ${closed.error?.code}`);
  check('B7', ordinary.every((r) => !Object.keys(r.headers).some((k) => k.toLowerCase() === 'x-invitation-code')), 'the ordinary request carried x-invitation-code');
  pass('B7', `ordinary /login: both buttons and both explanatory lines present, no invitation UI; "Register this device" got 403 REGISTRATION_CLOSED shown verbatim; request carried no x-invitation-code`);

  // ── B8 ──
  current = 'B8';
  const seen = [];
  for (const [who, dev, expected] of [['B', B, false], ['A', A, true]]) {
    for (const phoneWidth of [false, true]) {
      for (const path of ['/dashboard', '/categories']) {
        await dev.size(phoneWidth ? PHONE : DESKTOP);
        await dev.go(`${ORIGIN}${path}`);
        if (phoneWidth) {
          await dev.until(`!!document.querySelector('button[aria-label="Open navigation"]')`, 'the menu button');
          await dev.until(`(document.querySelector('button[aria-label="Open navigation"]').click(), !!document.querySelector('div.fixed.inset-0'))`, 'the drawer');
        }
        // Wait for `me` to have answered, so an absent control is a decision and not a race.
        await dev.until(signedInAs(phoneWidth), `the signed-in line for ${who}`, 90000);
        const present = await dev.evaluate(`!!document.querySelector('[data-invite-control]')`);
        check('B8', present === expected, `profile ${who} at ${phoneWidth ? 390 : 1440}px on ${path}: control ${present ? 'present' : 'absent'}`);
        seen.push(`${who}${phoneWidth ? '@390' : '@1440'}${path}=${present ? 'present' : 'absent'}`);
      }
    }
  }
  pass('B8', seen.join(' '));

  // ── B9 ──
  current = 'B9';
  const raw = execFileSync('curl', ['-s', '-D', '-', `${ORIGIN}/login`]).toString();
  const header = /^referrer-policy:\s*no-referrer\s*$/im.test(raw);
  const meta = raw.includes('<meta name="referrer" content="no-referrer"');
  check('B9', header || meta, 'no Referrer-Policy header and no referrer meta on /login');
  pass('B9', `curl -s -D - ${ORIGIN}/login: Referrer-Policy header no-referrer=${header}, meta=${meta}`);

  console.log('OK B1-B9');
} catch (error) {
  exitCode = 1;
  if (error instanceof StepFailure) console.log(redact(`${error.step} FAIL ${error.message}`));
  else console.log(redact(`${current} FAIL ${error?.message ?? error}`));
} finally {
  for (const { proc } of browsers) proc.kill();
  try { process.kill(-server.pid); } catch { server.kill(); }
  await sleep(2000);
  for (const { profile } of browsers) rmSync(profile, { recursive: true, force: true });
  rmSync(work, { recursive: true, force: true });
  try { execFileSync('dropdb', ['--if-exists', db], { stdio: 'ignore' }); } catch { /* reported by the exit code below */ }
}
process.exit(exitCode);
