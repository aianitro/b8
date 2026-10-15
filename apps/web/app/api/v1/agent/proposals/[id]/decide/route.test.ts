// The confirmation gate against a real Postgres.
//
// TIER 2, under `vitest.integration.config.mts` with the scratch-database guard in `setupFiles` —
// this file writes rows, and the guard refuses to run it against the owner's real database.
//
// WHY THESE FIXTURES EXIST RATHER THAN ONLY THE PURE ONES. `lib/domain/proposal.test.ts` covers
// every RULE, but the rules are only worth what the wiring around them is: the lock, the
// transaction boundary, the canonical write, and the scope refusal all live here and are invisible
// to a pure test. Two of the four were wrong when first written and were found by a security
// review, not by the 18 pure fixtures passing.

import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { NextRequest } from 'next/server';
import db from '@/lib/db';
import { decideProposal, canonicalCategory, createProposal } from '@/lib/proposalStore';
import { POST } from './route';
import {
  bootstrapOwner,
  enrolSecondUser,
  resetAuth,
  type EnrolledUser,
} from '@/app/api/v1/auth/secondUserTestKit';
import { SESSION_COOKIE_NAME, hashSessionToken } from '@/lib/sessionToken';

const CATEGORY = 'Groceries';
const OTHER = 'Dining Out';
let txnId: number;

async function seed(): Promise<void> {
  await db.query('DELETE FROM agent_proposals');
  await db.query("DELETE FROM transactions WHERE plaid_transaction_id LIKE 'gate-test-%'");
  await db.query(
    `INSERT INTO budget_categories (name, annual_budget, landscape, sort_order)
     VALUES ($1, 1200, 'operational', 900), ($2, 1200, 'operational', 901)
     ON CONFLICT DO NOTHING`,
    [CATEGORY, OTHER]
  );
  await db.query(
    `INSERT INTO accounts (id, name, type, landscape)
     VALUES ('gate-test-acct', 'Gate Test', 'depository', 'operational')
     ON CONFLICT (id) DO NOTHING`
  );
  const r = await db.query(
    `INSERT INTO transactions (plaid_transaction_id, account_id, date, amount, name, mapped_category)
     VALUES ('gate-test-1', 'gate-test-acct', CURRENT_DATE, 42.00, 'Gate Test Merchant', $1)
     RETURNING id`,
    [OTHER]
  );
  txnId = r.rows[0].id;
}

async function makeProposal(category: string, observed = OTHER): Promise<string> {
  const id = 'GateTest' + Math.random().toString(36).slice(2, 12).padEnd(14, 'x');
  await db.query(
    `INSERT INTO agent_proposals (id, kind, subject_id, proposed, observed, expires_at)
     VALUES ($1, 'categorize_transaction', $2, $3, $4, now() + interval '10 minutes')`,
    [id, txnId, JSON.stringify({ category }), JSON.stringify({ category: observed })]
  );
  return id;
}

/** A NextRequest, not a plain Request: the handler reads `request.cookies`, which only the former has. */
function decideRequest(id: string, decision: string): NextRequest {
  return new NextRequest(`http://localhost/api/v1/agent/proposals/${id}/decide`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ decision }),
  });
}

async function categoryOf(): Promise<string | null> {
  const r = await db.query('SELECT mapped_category FROM transactions WHERE id = $1', [txnId]);
  return r.rows[0]?.mapped_category ?? null;
}

beforeEach(seed);
afterAll(async () => {
  await db.query('DELETE FROM agent_proposals');
  await db.query("DELETE FROM transactions WHERE plaid_transaction_id LIKE 'gate-test-%'");
  await db.query("DELETE FROM accounts WHERE id = 'gate-test-acct'");
});

describe('the canonical write', () => {
  it('resolves a category case-insensitively to its stored spelling', async () => {
    expect(await canonicalCategory('GROCERIES')).toBe(CATEGORY);
    expect(await canonicalCategory('  groceries  '.trim())).toBe(CATEGORY);
    expect(await canonicalCategory('No Such Category')).toBeNull();
  });

  it('writes the CANONICAL name, not the spelling the proposal carried', async () => {
    // The defect this pins: existence was checked with lower() and the raw string was written, so
    // "GROCERIES" passed the guard and then joined to no budget line at all — the row silently
    // stopped counting toward anything while still looking categorized.
    const id = await makeProposal('GROCERIES');
    const outcome = await decideProposal({ id, decision: 'confirmed', decidedBy: null, now: new Date() });

    expect(outcome.ok).toBe(true);
    expect(await categoryOf()).toBe(CATEGORY);

    const joined = await db.query(
      `SELECT 1 FROM transactions t JOIN budget_categories bc ON bc.name = t.mapped_category
        WHERE t.id = $1`,
      [txnId]
    );
    expect(joined.rows.length).toBe(1);
  });
});

describe('single use', () => {
  it('applies once and refuses the replay', async () => {
    const id = await makeProposal(CATEGORY);
    expect((await decideProposal({ id, decision: 'confirmed', decidedBy: null, now: new Date() })).ok).toBe(true);

    const replay = await decideProposal({ id, decision: 'confirmed', decidedBy: null, now: new Date() });
    expect(replay.ok).toBe(false);
    expect(replay).toMatchObject({ code: 'ALREADY_DECIDED' });
  });

  it('applies exactly once under two concurrent confirmations', async () => {
    // The lock, asserted rather than assumed: without SELECT ... FOR UPDATE both callers read
    // decided_at IS NULL, both pass the pure check, and both write.
    const id = await makeProposal(CATEGORY);
    const [a, b] = await Promise.all([
      decideProposal({ id, decision: 'confirmed', decidedBy: null, now: new Date() }),
      decideProposal({ id, decision: 'confirmed', decidedBy: null, now: new Date() }),
    ]);
    expect([a.ok, b.ok].filter(Boolean).length).toBe(1);
    const row = await db.query('SELECT applied, decision FROM agent_proposals WHERE id = $1', [id]);
    expect(row.rows[0]).toMatchObject({ applied: true, decision: 'confirmed' });
  });
});

describe('the concurrency check', () => {
  it('refuses when the subject changed underneath, and leaves the owner edit alone', async () => {
    const id = await makeProposal(CATEGORY);
    await db.query('UPDATE transactions SET mapped_category = $1 WHERE id = $2', ['Travel', txnId]);

    const outcome = await decideProposal({ id, decision: 'confirmed', decidedBy: null, now: new Date() });
    expect(outcome).toMatchObject({ ok: false, code: 'SUBJECT_CHANGED' });
    expect(await categoryOf()).toBe('Travel');

    // Closed rather than left pending: offering the same impossible button again is worse.
    const row = await db.query('SELECT decision, failure_reason, applied FROM agent_proposals WHERE id = $1', [id]);
    expect(row.rows[0]).toMatchObject({ decision: 'rejected', failure_reason: 'SUBJECT_CHANGED', applied: false });
  });
});

describe('rejection', () => {
  it('changes nothing and closes the proposal', async () => {
    const id = await makeProposal(CATEGORY);
    const outcome = await decideProposal({ id, decision: 'rejected', decidedBy: null, now: new Date() });
    expect(outcome).toMatchObject({ ok: true, applied: false });
    expect(await categoryOf()).toBe(OTHER);
  });
});

describe('the route refuses a caller with no qualifying session', () => {
  it('answers 403 and writes nothing', async () => {
    // No Authorization header and no cookie: `credentialFrom` returns null, which is the same
    // answer it gives a read-scoped token, since it applies the scope check itself.
    const id = await makeProposal(CATEGORY);
    const res = await POST(decideRequest(id, 'confirmed'), { params: Promise.resolve({ id }) });
    expect(res.status).toBe(403);
    expect(await categoryOf()).toBe(OTHER);
  });

  it('refuses an unrecognised decision rather than defaulting to confirm', async () => {
    const id = await makeProposal(CATEGORY);
    const res = await POST(decideRequest(id, 'yes please'), { params: Promise.resolve({ id }) });
    expect([400, 403]).toContain(res.status);
    expect(await categoryOf()).toBe(OTHER);
  });
});

// P7-41a, S14. The acting PERSON is recorded beside the acting session, and outlives it.
//
// Both users are enrolled through the real ceremonies (the owner by bootstrap, the second user by
// invitation), so the sessions deciding below are ones the app issued. The auth tables are reset at
// the start and the end of this block only; the blocks above never read them.
describe('the acting user on a decision', () => {
  function decideAs(id: string, decision: string, token: string): Promise<Response> {
    return POST(
      new NextRequest(`http://localhost/api/v1/agent/proposals/${id}/decide`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', cookie: `${SESSION_COOKIE_NAME}=${token}` },
        body: JSON.stringify({ decision }),
      }),
      { params: Promise.resolve({ id }) }
    );
  }

  async function attribution(id: string) {
    const r = await db.query<{
      decided_by: string | null; decided_by_user_id: number | null;
      proposed_by: string | null; proposed_by_user_id: number | null;
    }>(
      'SELECT decided_by, decided_by_user_id, proposed_by, proposed_by_user_id FROM agent_proposals WHERE id = $1',
      [id]
    );
    return r.rows[0];
  }

  afterAll(resetAuth);

  it('T41a-S14: each decision records the deciding user, system proposals record none, and the user outlives the session', async () => {
    await resetAuth();
    await seed();
    const owner: EnrolledUser = await bootstrapOwner();
    const second = await enrolSecondUser(owner.token);

    // The category moves on every confirm, so each proposal observes what the previous one left.
    const cases: Array<[string, 'confirmed' | 'rejected', EnrolledUser, string, string]> = [
      ['second user confirms', 'confirmed', second, CATEGORY, OTHER],
      ['second user rejects', 'rejected', second, OTHER, CATEGORY],
      ['owner confirms', 'confirmed', owner, OTHER, CATEGORY],
      ['owner rejects', 'rejected', owner, CATEGORY, OTHER],
    ];
    const decidedBySecond: string[] = [];
    for (const [label, decision, actor, category, observed] of cases) {
      const id = await makeProposal(category, observed);
      const res = await decideAs(id, decision, actor.token);
      expect(res.status, label).toBe(200);
      const row = await attribution(id);
      expect(String(row.decided_by_user_id), label).toBe(String(actor.userId));
      expect(row.decided_by, label).toBe(hashSessionToken(actor.token));
      if (actor === second) decidedBySecond.push(id);
    }

    // A SYSTEM-MADE PROPOSAL names no person — not the owner. Both the direct row and one made
    // through the store with no actor, which is how the category suggester writes.
    const direct = await makeProposal(CATEGORY);
    expect(await attribution(direct)).toMatchObject({ proposed_by: null, proposed_by_user_id: null });
    await db.query('DELETE FROM agent_proposals WHERE id = $1', [direct]);
    const { view } = await createProposal({
      subjectId: txnId,
      proposed: { category: CATEGORY },
      observed: { category: OTHER },
      rationale: null,
      proposedBy: null,
      now: new Date(),
    });
    expect(await attribution(view.id)).toMatchObject({ proposed_by: null, proposed_by_user_id: null });

    // THE PERSON OUTLIVES THE SESSION. Deleting the second user's session row nulls the session
    // column (ON DELETE SET NULL) and leaves the user column exactly as it was.
    await db.query('DELETE FROM auth_sessions WHERE token_hash = $1', [hashSessionToken(second.token)]);
    for (const id of decidedBySecond) {
      const row = await attribution(id);
      expect(row.decided_by).toBeNull();
      expect(String(row.decided_by_user_id)).toBe(String(second.userId));
    }
  });
});
