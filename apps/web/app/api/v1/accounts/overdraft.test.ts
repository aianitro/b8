// Overdraft watch against a scratch database: episodes open, update and close on sync balances, the
// push goes out once per episode — retried while no device took it — and the account settings gate
// it. Fabricated accounts under one prefix, removed afterwards. The push sender is replaced: nothing
// here reaches a push service.

import { NextRequest } from 'next/server';
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';

const sent = vi.hoisted(() => ({ calls: [] as string[], devices: 1 }));
vi.mock('@/lib/webPush', () => ({
  sendWebPush: async (urgency: string) => { sent.calls.push(urgency); return sent.devices; },
}));

import db from '@/lib/db';
import { checkOverdraft, loadForecasts, loadOverdrafts } from '@/lib/overdraftWatch';
import { PATCH } from './[id]/route';

const P = 'overdraft-test';
const CHECKING = `${P}-checking`;
const CARD = `${P}-card`;

const episodes = async () => (await db.query<{ closed: boolean; pushed: boolean; low: string; last: string }>(
  `SELECT closed_at IS NOT NULL AS closed, pushed_at IS NOT NULL AS pushed, low_balance::text AS low, last_balance::text AS last
     FROM overdraft_episodes WHERE account_id = $1 ORDER BY id`, [CHECKING])).rows;
const patch = (body: unknown) => PATCH(
  new NextRequest(`http://localhost/api/v1/accounts/${CHECKING}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }),
  { params: Promise.resolve({ id: CHECKING }) });
const see = (current: number | null, available: number | null) => checkOverdraft([{ accountId: CHECKING, current, available }]);

async function cleanup() {
  await db.query('DELETE FROM overdraft_episodes WHERE account_id LIKE $1', [`${P}-%`]);
  await db.query('DELETE FROM overdraft_forecasts WHERE account_id LIKE $1', [`${P}-%`]);
  await db.query('DELETE FROM transactions WHERE plaid_transaction_id LIKE $1', [`${P}-%`]);
  await db.query('DELETE FROM accounts WHERE id LIKE $1', [`${P}-%`]);
}

beforeEach(async () => {
  await cleanup();
  sent.calls = []; sent.devices = 1;
  await db.query(`INSERT INTO accounts (id, name, type, access_token) VALUES ($1, 'Fabricated checking', 'depository', 'fabricated-token'), ($2, 'Fabricated card', 'credit', 'fabricated-token')`, [CHECKING, CARD]);
});

afterAll(async () => { await cleanup(); await db.end(); });

describe('overdraft watch', () => {
  it('opens on the lower balance, pushes once, keeps the low, and closes on recovery', async () => {
    await see(20, -5);
    expect(sent.calls).toEqual(['high']);
    expect(await episodes()).toEqual([{ closed: false, pushed: true, low: '-5.00', last: '-5.00' }]);
    expect((await loadOverdrafts()).find((f) => f.accountId === CHECKING)?.balance).toBe(-5);

    await see(-12, -12);
    expect(sent.calls).toEqual(['high']); // same episode, no second push
    expect(await episodes()).toEqual([{ closed: false, pushed: true, low: '-12.00', last: '-12.00' }]);

    await see(40, 40);
    expect((await episodes())[0].closed).toBe(true);
    expect((await loadOverdrafts()).find((f) => f.accountId === CHECKING)).toBeUndefined();

    await see(-1, -1); // falls again: a new episode, a new push
    expect(sent.calls).toEqual(['high', 'high']);
    expect((await episodes()).length).toBe(2);
  });

  it('retries the push on the next sync when no device took it', async () => {
    sent.devices = 0;
    await see(-5, -5);
    expect((await episodes())[0].pushed).toBe(false);
    sent.devices = 1;
    await see(-5, -5);
    expect(sent.calls).toEqual(['high', 'high']);
    expect((await episodes())[0].pushed).toBe(true);
  });

  it('ignores a credit card, honours the cushion, and stops when switched off', async () => {
    await checkOverdraft([{ accountId: CARD, current: -500, available: -500 }]);
    expect(sent.calls).toEqual([]);

    expect((await patch({ overdraft_cushion: -1 })).status).toBe(400);
    expect((await patch({ overdraft_cushion: 100 })).status).toBe(200);
    await see(99, 99);
    expect(sent.calls).toEqual(['high']);

    // Switched off: the episode stays open but leaves the bell, and nothing more is pushed.
    expect((await patch({ overdraft_watch: false })).status).toBe(200);
    await see(150, 150);
    expect((await episodes())[0].closed).toBe(false);
    expect((await loadOverdrafts()).find((f) => f.accountId === CHECKING)).toBeUndefined();
    expect(sent.calls).toEqual(['high']);
  });
});

describe('overdraft forecast', () => {
  // A fortnightly charge of 50 whose last instalment was 11 days ago: the next lands in 3 days.
  beforeEach(async () => {
    for (let i = 0; i < 4; i++) {
      await db.query(
        `INSERT INTO transactions (plaid_transaction_id, account_id, date, amount, name) VALUES ($1, $2, CURRENT_DATE - $3::int, 50, 'FABRICATED RENT')`,
        [`${P}-rent${i}`, CHECKING, 11 + 14 * i]);
    }
  });
  const forecasts = async () => (await db.query<{ closed: string | null; low: string; pushed: boolean }>(
    `SELECT closed_reason AS closed, projected_low::text AS low, pushed_at IS NOT NULL AS pushed FROM overdraft_forecasts WHERE account_id = $1 ORDER BY id`, [CHECKING])).rows;

  it('opens when the coming charge would overdraw, pushes at normal urgency once, and clears', async () => {
    await see(30, 30);
    expect(await forecasts()).toEqual([{ closed: null, low: '-20.00', pushed: true }]);
    expect(sent.calls).toEqual(['normal']);
    const f = (await loadForecasts()).find((x) => x.accountId === CHECKING);
    expect(f?.charges).toEqual([expect.objectContaining({ label: 'FABRICATED RENT', amount: 50 })]);

    await see(35, 35); // refreshed, not pushed again
    expect(await forecasts()).toEqual([{ closed: null, low: '-15.00', pushed: true }]);
    expect(sent.calls).toEqual(['normal']);

    await see(100, 100);
    expect(await forecasts()).toEqual([{ closed: 'cleared', low: '-15.00', pushed: true }]);
  });

  it('gives way to an episode when the forecast comes true', async () => {
    await see(30, 30);
    await see(-5, -5);
    expect((await forecasts())[0].closed).toBe('episode');
    expect((await episodes()).length).toBe(1);
    expect(sent.calls).toEqual(['normal', 'high']);
  });
});
