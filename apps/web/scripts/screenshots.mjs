#!/usr/bin/env node
// The README's screenshots, regenerated in one command, from fabricated data only.
//
//   npm run screenshots            (from apps/web)
//
// ─── Where the data comes from, and why it cannot be the real ledger ──────────────────────────
//
// This script makes its OWN throwaway database, `b8_screens`, by name — it never reads
// DATABASE_URL from the environment or from .env.local, so no setting anywhere can point it at the
// owner's database. It drops and re-creates that one database, migrates it, fills it with
// `seed-demo.mjs`'s invented accounts and transactions, mints a test session in it, and drops it
// again at the end. The dev server it starts is handed that database explicitly; a variable set in
// the environment takes precedence over .env.local in Next, so the server cannot fall back to it.
//
// ─── How the pictures are taken ───────────────────────────────────────────────────────────────
//
// Chrome, headless, driven over its DevTools protocol with Node's own WebSocket — no browser
// library to install. Desktop at 1440×900; phone at 390×844 with touch on and the installed-app
// display mode emulated, which a viewport alone cannot do (the `standalone:` variant in
// app/globals.css keys on it). Two phone shots act before capturing: one opens a transaction's
// detail sheet, one swipes an account row to reveal Remove.
//
// Look at every image before committing: the seed is anchored to today's date, so figures move
// run to run — but they must always be the seed's.

import { spawn, execFileSync } from 'node:child_process';
import { createHash, randomBytes } from 'node:crypto';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const WEB = resolve(HERE, '..');
const ROOT = resolve(WEB, '../..');
const OUT = join(ROOT, 'docs/screenshots');
const DB = 'b8_screens';
const DB_URL = `postgresql://localhost/${DB}`;
const PORT = 3199;
const CDP_PORT = 9339;
const BASE = `http://127.0.0.1:${PORT}`;
const CHROME = process.env.CHROME ?? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const run = (cmd, args, opts = {}) => execFileSync(cmd, args, { stdio: 'inherit', ...opts });
const env = { ...process.env, DATABASE_URL: DB_URL };

// ─── The scratch database ─────────────────────────────────────────────────────────────────────

function prepareDatabase() {
  run('dropdb', ['--if-exists', DB]);
  run('createdb', [DB]);
  run('npx', ['node-pg-migrate', 'up'], { cwd: ROOT, env, stdio: 'ignore' });
  run('node', ['scripts/seed-demo.mjs', '--yes-wipe-my-database'], { cwd: WEB, env });
  const token = randomBytes(32).toString('base64url');
  const hash = createHash('sha256').update(token).digest('hex');
  // Every credential belongs to a user since P7-41a, so the fabricated owner is created first —
  // under the neutral name the migration gives a backfilled owner, which is what the sidebar shows.
  run('psql', ['-d', DB, '-v', 'ON_ERROR_STOP=1', '-qc', `
    INSERT INTO users (display_name, is_owner) VALUES ('Owner', TRUE);
    INSERT INTO webauthn_credentials (credential_id, public_key, sign_count, enrolled_via, user_id)
      VALUES ('screenshots-cred', '\\x00'::bytea, 0, 'bootstrap', (SELECT id FROM users WHERE is_owner));
    INSERT INTO auth_sessions (token_hash, credential_id, expires_at)
      VALUES ('${hash}', 'screenshots-cred', NOW() + interval '2 hours');`]);
  const propertyId = execFileSync('psql', ['-d', DB, '-Atc', 'SELECT id FROM properties ORDER BY id LIMIT 1']).toString().trim();
  return { token, propertyId };
}

// ─── The server and the browser ───────────────────────────────────────────────────────────────

async function waitFor(url, tries = 90) {
  for (let i = 0; i < tries; i++) {
    try { if ((await fetch(url)).status < 500) return; } catch { /* not up yet */ }
    await sleep(1000);
  }
  throw new Error(`timed out waiting for ${url}`);
}

function cdp(wsUrl) {
  const ws = new WebSocket(wsUrl);
  let id = 0;
  const pending = new Map();
  ws.addEventListener('message', (e) => {
    const msg = JSON.parse(e.data);
    if (msg.id && pending.has(msg.id)) {
      const { ok, fail } = pending.get(msg.id);
      pending.delete(msg.id);
      if (msg.error) fail(new Error(`${msg.error.message}`)); else ok(msg.result);
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
    close: () => ws.close(),
  };
}

// ─── What to capture ──────────────────────────────────────────────────────────────────────────

const DESKTOP = { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false };
const PHONE = { width: 390, height: 844, deviceScaleFactor: 2, mobile: true };

/** The net worth chart's Year window: the seed's history is monthly, so a month shows two points. */
const yearWindow = `[...document.querySelectorAll('button')].find((b) => b.textContent.trim() === 'Year')?.click()`;

/** Opens a transaction's detail sheet: the first row's title button. */
const openDetail = `document.querySelector('button:has(.detail-title)')?.click()`;

const shots = (propertyId) => [
  { file: 'dashboard', path: '/dashboard', size: DESKTOP },
  { file: 'accounts', path: '/accounts', size: DESKTOP },
  { file: 'budget', path: '/budget', size: DESKTOP },
  { file: 'net-worth', path: '/net-worth', size: DESKTOP, eval: yearWindow },
  { file: 'profit-loss', path: '/profit-loss', size: DESKTOP },
  { file: 'property', path: `/properties/${propertyId}`, size: DESKTOP },
  { file: 'transactions', path: '/transactions', size: DESKTOP },
  { file: 'phone-dashboard', path: '/dashboard', size: PHONE },
  { file: 'phone-accounts', path: '/accounts', size: PHONE },
  { file: 'phone-budget', path: '/budget?view=monthly', size: PHONE },
  { file: 'phone-net-worth', path: '/net-worth', size: PHONE, eval: yearWindow },
  { file: 'phone-transaction', path: '/transactions', size: PHONE, eval: openDetail },
  { file: 'phone-swipe', path: '/accounts', size: PHONE, swipe: true },
];

/**
 * The installed-app look. Emulated as a media feature where Chrome supports it; otherwise every
 * `display-mode: standalone` rule is copied into an unconditional sheet — the same trick the
 * previews used, so the result is the same either way.
 */
const FORCE_STANDALONE = `(() => {
  if (matchMedia('(display-mode: standalone)').matches) return 'emulated';
  const css = [];
  const walk = (rules) => { for (const r of rules) {
    if (r instanceof CSSMediaRule && r.conditionText.includes('display-mode: standalone')) css.push(...[...r.cssRules].map((x) => x.cssText));
    else if (r.cssRules) walk(r.cssRules);
  } };
  for (const s of document.styleSheets) { try { walk(s.cssRules); } catch {} }
  const el = document.createElement('style'); el.textContent = css.join('\\n'); document.head.append(el);
  return 'copied ' + css.length;
})()`;

/** Next's dev-mode badge is not part of the app. */
const HIDE_DEV = `(() => { const s = document.createElement('style'); s.textContent = 'nextjs-portal{display:none!important}'; document.head.append(s); })()`;

async function capture(page, shot, token) {
  const phone = shot.size === PHONE;
  await page.send('Emulation.setDeviceMetricsOverride', shot.size);
  await page.send('Emulation.setTouchEmulationEnabled', { enabled: phone, maxTouchPoints: phone ? 5 : 1 });
  await page.send('Emulation.setEmulatedMedia', { features: phone ? [{ name: 'display-mode', value: 'standalone' }] : [] });
  await page.send('Network.setCookie', { name: 'b8_session', value: token, domain: '127.0.0.1', path: '/' });
  await page.send('Page.navigate', { url: BASE + shot.path });
  await sleep(6000); // dev compile, data, charts settling
  await page.send('Runtime.evaluate', { expression: HIDE_DEV });
  if (phone) await page.send('Runtime.evaluate', { expression: FORCE_STANDALONE });
  if (shot.eval) { await page.send('Runtime.evaluate', { expression: shot.eval }); await sleep(1500); }
  if (shot.swipe) {
    // The first account row: a right-to-left drag past the reveal threshold.
    const { result } = await page.send('Runtime.evaluate', {
      expression: `(() => { const r = document.querySelector('[style*="touch-action"], .touch-pan-y')?.getBoundingClientRect(); return r ? [r.right - 30, r.top + r.height / 2] : null; })()`,
      returnByValue: true,
    });
    if (result.value) {
      const [x, y] = result.value;
      await page.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y }] });
      for (let dx = 20; dx <= 160; dx += 20) {
        await page.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: x - dx, y }] });
        await sleep(16);
      }
      await page.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
      await sleep(800);
    } else {
      console.warn('swipe: no row found');
    }
  }
  await sleep(500);
  const { data } = await page.send('Page.captureScreenshot', { format: 'jpeg', quality: 82 });
  writeFileSync(join(OUT, `${shot.file}.jpg`), Buffer.from(data, 'base64'));
  console.log(`  ${shot.file}.jpg`);
}

// ─── Main ─────────────────────────────────────────────────────────────────────────────────────

const { token, propertyId } = prepareDatabase();
const server = spawn('npx', ['next', 'dev', '-H', '127.0.0.1', '-p', String(PORT)], { cwd: WEB, env, stdio: 'ignore', detached: true });
const profile = mkdtempSync(join(tmpdir(), 'b8-screens-'));
const chrome = spawn(CHROME, [
  '--headless=new', `--remote-debugging-port=${CDP_PORT}`, `--user-data-dir=${profile}`,
  '--hide-scrollbars', '--no-first-run', '--no-default-browser-check', 'about:blank',
], { stdio: 'ignore' });

try {
  await waitFor(`${BASE}/login`);
  await waitFor(`http://127.0.0.1:${CDP_PORT}/json/version`);
  const target = await (await fetch(`http://127.0.0.1:${CDP_PORT}/json/new?about:blank`, { method: 'PUT' })).json();
  const page = cdp(target.webSocketDebuggerUrl);
  await page.opened;
  await page.send('Page.enable');
  await page.send('Network.enable');
  mkdirSync(OUT, { recursive: true });
  console.log(`writing to ${OUT}`);
  for (const shot of shots(propertyId)) await capture(page, shot, token);
  page.close();
} finally {
  chrome.kill();
  try { process.kill(-server.pid); } catch { server.kill(); }
  await sleep(1500);
  rmSync(profile, { recursive: true, force: true });
  run('dropdb', ['--if-exists', DB]);
}
