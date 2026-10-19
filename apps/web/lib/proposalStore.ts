// Persistence for agent proposals. The rules live in `lib/domain/proposal.ts`; this file only
// fetches facts and performs the effect the pure decision authorised.

import { randomBytes } from 'node:crypto';
import db from '@/lib/db';
import {
  decideApply,
  expiryFrom,
  type ApplyVerdict,
  type CategorizeObserved,
  type CategorizeProposed,
  type StoredProposal,
} from '@/lib/domain/proposal';
import { visibleTransactions, giftHeldSql, type GiftViewer } from '@/lib/giftReadPath';
import { GIFT_LOCKED_ERROR, giftLockSql, lockedFor } from '@/lib/giftLock';

/** 16 CSPRNG bytes as unpadded base64url — 22 chars, matching the table's id CHECK. */
export function generateProposalId(): string {
  return randomBytes(16).toString('base64url');
}

export interface ProposalView {
  id: string;
  kind: 'categorize_transaction';
  subjectId: number;
  proposed: CategorizeProposed;
  observed: CategorizeObserved;
  rationale: string | null;
  expiresAt: string;
  /** Enough for the confirmation card to describe the change without a second round trip. */
  subject: { date: string; amount: number; merchant: string | null } | null;
}

interface ProposalRow {
  id: string;
  kind: 'categorize_transaction';
  subject_id: number;
  proposed: CategorizeProposed;
  observed: CategorizeObserved;
  rationale: string | null;
  expires_at: Date;
  decided_at: Date | null;
}

function toStored(row: ProposalRow): StoredProposal {
  return {
    id: row.id,
    kind: row.kind,
    subjectId: row.subject_id,
    proposed: row.proposed,
    observed: row.observed,
    rationale: row.rationale,
    expiresAt: new Date(row.expires_at),
    decidedAt: row.decided_at ? new Date(row.decided_at) : null,
  };
}

/**
 * The transaction a proposal is about, as the confirmation card needs to show it — AS `viewer` SEES
 * IT (P7-41b). Read through `visibleTransactions(viewer)`, so a row a gift holds for someone else is
 * `Gift` on the card and in every message built from it. `held` says whether an unrevealed gift holds
 * the row at all, whoever is looking: such a row's category is locked for everyone, so no proposal
 * about it is made (the chat refuses first) and none can be applied.
 */
export async function loadSubject(
  transactionId: number,
  viewer: GiftViewer
): Promise<{ category: string | null; date: string; amount: number; merchant: string | null; held: boolean } | null> {
  const r = await db.query(
    `SELECT t.mapped_category, t.date::text AS date, t.amount::float8 AS amount,
            COALESCE(t.merchant_name, t.name) AS merchant,
            ${giftHeldSql('t')} AS held
       FROM ${visibleTransactions(viewer)} t WHERE t.id = $1`,
    [transactionId]
  );
  if (r.rows.length === 0) return null;
  const row = r.rows[0];
  return {
    category: row.mapped_category ?? null,
    date: row.date,
    amount: Number(row.amount),
    merchant: row.merchant ?? null,
    held: row.held === true,
  };
}

/**
 * The budget category's CANONICAL name, or null if there is none.
 *
 * Returns the name rather than a boolean, and the distinction is the whole point. Existence was
 * once checked with `lower(name) = lower($1)` while the apply wrote the model's raw string — so
 * "GROCERIES" passed the check and was written verbatim, and every consumer joins
 * `mapped_category` to `budget_categories.name` with an exact `=`. The row then counted toward
 * nothing: gone from the budget page, the monthly grid, the year-end read and both agent tools,
 * while `/transactions` still showed it as categorized. A silently uncounted $900 is exactly the
 * defect class this repo exists to avoid, and a case-insensitive guard in front of a
 * case-sensitive write manufactures it.
 *
 * `ORDER BY name = $1 DESC` prefers an exact match when two categories differ only by case, so the
 * answer does not depend on row order.
 */
export async function canonicalCategory(name: string): Promise<string | null> {
  const r = await db.query(
    `SELECT name FROM budget_categories WHERE lower(name) = lower($1) ORDER BY (name = $1) DESC LIMIT 1`,
    [name]
  );
  return r.rows.length ? (r.rows[0].name as string) : null;
}

/**
 * Record a proposal.
 *
 * If a pending proposal for this subject already exists, the new one is NOT stored and the existing
 * one comes back with `preexisting: true`. The caller MUST NOT then describe the change it asked
 * for: the stored row may propose something entirely different, and narrating the request while
 * rendering the stored row puts a sentence and a confirmation card side by side that disagree —
 * which is the one thing that teaches an owner to stop reading the card.
 */
export interface CreateResult {
  view: ProposalView;
  /** True when a pending proposal for this subject already existed and this one was NOT stored. */
  preexisting: boolean;
}

/**
 * Who did something to a proposal: the SESSION and the PERSON behind it, always together.
 *
 * ONE VALUE, NOT TWO ARGUMENTS, because the two columns are one fact recorded twice for two
 * lifetimes. `proposed_by` / `decided_by` name a session, which is pruned at sign-in housekeeping or
 * cascaded away when a passkey is removed (ON DELETE SET NULL); `proposed_by_user_id` /
 * `decided_by_user_id` (P7-41a) name the person and survive that. A writer that could pass a session
 * without its user is the silent half of the attribution — the migration's CHECKs refuse that row,
 * and this shape makes it unwritable before the database has to. Both halves come from the same
 * `ActiveSession`, resolved at the request boundary where the caller is known.
 *
 * `null` is "no person": a system-made proposal (the category suggester), or a caller with no
 * session. It is never the owner by default — `categorySuggester` selects on `proposed_by IS NULL`,
 * and a NULL user here is what keeps those proposals distinguishable from a person's.
 */
export type ProposalActor = { tokenHash: string; userId: number };

export async function createProposal(args: {
  subjectId: number;
  proposed: CategorizeProposed;
  observed: CategorizeObserved;
  rationale: string | null;
  proposedBy: ProposalActor | null;
  now: Date;
  /**
   * How long the proposal stays confirmable. Defaults to the chat's short window (PROPOSAL_TTL_MS),
   * which exists because a chat proposal is made mid-conversation and should be decided in it. The
   * category suggester passes days instead: its proposals wait for the owner to next open the app.
   */
  ttlMs?: number;
}): Promise<CreateResult> {
  const id = generateProposalId();
  const r = await db.query(
    `INSERT INTO agent_proposals
       (id, kind, subject_id, proposed, observed, rationale, expires_at, proposed_by, proposed_by_user_id)
     VALUES ($1, 'categorize_transaction', $2, $3, $4, $5, $6, $7, $8)
     ON CONFLICT (kind, subject_id) WHERE decided_at IS NULL DO NOTHING
     RETURNING id, expires_at`,
    [
      id,
      args.subjectId,
      JSON.stringify(args.proposed),
      JSON.stringify(args.observed),
      args.rationale,
      (args.ttlMs === undefined ? expiryFrom(args.now) : new Date(args.now.getTime() + args.ttlMs)).toISOString(),
      args.proposedBy?.tokenHash ?? null,
      args.proposedBy?.userId ?? null,
    ]
  );

  if (r.rows.length === 0) {
    const existing = await db.query(
      `SELECT id, kind, subject_id, proposed, observed, rationale, expires_at, decided_at
         FROM agent_proposals
        WHERE kind = 'categorize_transaction' AND subject_id = $1 AND decided_at IS NULL`,
      [args.subjectId]
    );
    return { view: await viewOf(toStored(existing.rows[0] as ProposalRow), args.proposedBy?.userId ?? null), preexisting: true };
  }

  return { preexisting: false, view: await viewOf({
    id: r.rows[0].id,
    kind: 'categorize_transaction',
    subjectId: args.subjectId,
    proposed: args.proposed,
    observed: args.observed,
    rationale: args.rationale,
    expiresAt: new Date(r.rows[0].expires_at),
    decidedAt: null,
  }, args.proposedBy?.userId ?? null) };
}

/** The card for a proposal, built for the person who asked for it (the system's own: nobody). */
async function viewOf(p: StoredProposal, viewer: GiftViewer): Promise<ProposalView> {
  const subject = await loadSubject(p.subjectId, viewer);
  return {
    id: p.id,
    kind: p.kind,
    subjectId: p.subjectId,
    proposed: p.proposed,
    observed: p.observed,
    rationale: p.rationale,
    expiresAt: p.expiresAt.toISOString(),
    subject: subject
      ? { date: subject.date, amount: subject.amount, merchant: subject.merchant }
      : null,
  };
}

export type DecideOutcome =
  | { ok: true; applied: boolean; message: string }
  | { ok: false; code: string; message: string };

/**
 * Apply or reject a proposal.
 *
 * THE WHOLE THING RUNS IN ONE TRANSACTION WITH THE PROPOSAL ROW LOCKED. Without the lock, two
 * confirmations racing both read `decided_at IS NULL`, both pass the pure check, and both apply —
 * which is precisely the replay the single-use rule exists to prevent, arriving through
 * concurrency instead of through a resent request.
 */
export async function decideProposal(args: {
  id: string;
  decision: 'confirmed' | 'rejected';
  /** See `ProposalActor`: the session and its person, written together on every closing UPDATE. */
  decidedBy: ProposalActor | null;
  now: Date;
}): Promise<DecideOutcome> {
  const client = await db.connect();
  try {
    await client.query('BEGIN');

    const found = await client.query(
      `SELECT id, kind, subject_id, proposed, observed, rationale, expires_at, decided_at
         FROM agent_proposals WHERE id = $1 FOR UPDATE`,
      [args.id]
    );
    const stored = found.rows.length ? toStored(found.rows[0] as ProposalRow) : null;

    if (args.decision === 'rejected') {
      // A rejection needs none of the world-checks: refusing to do something is always safe, and
      // an expired or stale proposal is exactly the kind a person would want to dismiss.
      if (!stored) {
        await client.query('ROLLBACK');
        return { ok: false, code: 'NOT_FOUND', message: 'No such proposal.' };
      }
      if (stored.decidedAt) {
        await client.query('ROLLBACK');
        return { ok: false, code: 'ALREADY_DECIDED', message: 'This proposal has already been decided.' };
      }
      await client.query(
        `UPDATE agent_proposals
            SET decided_at = $2, decision = 'rejected', decided_by = $3, decided_by_user_id = $4
          WHERE id = $1`,
        [args.id, args.now.toISOString(), args.decidedBy?.tokenHash ?? null, args.decidedBy?.userId ?? null]
      );
      await client.query('COMMIT');
      return { ok: true, applied: false, message: 'Dismissed. Nothing was changed.' };
    }

    // READ THE SUBJECT ON THE LOCKED CLIENT, not on the pool. The optimistic-concurrency check is
    // only meaningful if the value it compares was read inside the same transaction that performs
    // the write — a pool read can be served by another connection and observe a different snapshot,
    // which would let the check pass against a row that has since moved.
    const subjectRow = stored
      ? await client.query(
          `SELECT mapped_category FROM transactions WHERE id = $1`,
          [stored.subjectId]
        )
      : { rows: [] as Array<{ mapped_category: string | null }> };
    const subjectExists = subjectRow.rows.length > 0;

    // HELD BY A GIFT (P7-41b): the category of a row an unrevealed gift holds is locked for
    // everyone, the giver included, so a proposal made before the gift took the row can no longer
    // be applied. Closed as rejected — the same impossible button should not be offered again — and
    // answered with the one locked refusal every write uses, which carries no row text.
    if (stored && !stored.decidedAt && subjectExists
        && await lockedFor([stored.subjectId], 'category', args.decidedBy?.userId ?? null, client)) {
      await client.query(
        `UPDATE agent_proposals
            SET decided_at = $2, decision = 'rejected', failure_reason = 'GIFT_LOCKED', decided_by = $3,
                decided_by_user_id = $4
          WHERE id = $1`,
        [args.id, args.now.toISOString(), args.decidedBy?.tokenHash ?? null, args.decidedBy?.userId ?? null]
      );
      await client.query('COMMIT');
      return { ok: false, code: GIFT_LOCKED_ERROR.code, message: GIFT_LOCKED_ERROR.message };
    }
    const currentCategory = subjectExists ? subjectRow.rows[0].mapped_category ?? null : null;

    let canonical: string | null = null;
    if (stored?.proposed.category != null) {
      const c = await client.query(
        `SELECT name FROM budget_categories WHERE lower(name) = lower($1) ORDER BY (name = $1) DESC LIMIT 1`,
        [stored.proposed.category]
      );
      canonical = c.rows.length ? (c.rows[0].name as string) : null;
    }

    const verdict: ApplyVerdict = decideApply({
      proposal: stored,
      now: args.now,
      currentCategory,
      subjectExists,
      categoryIsKnown: stored?.proposed.category == null ? true : canonical !== null,
    });

    if (!verdict.ok) {
      // A refusal that is about the WORLD rather than about the proposal's identity still closes
      // the proposal: leaving it pending would offer the owner the same impossible button again.
      if (stored && !stored.decidedAt && verdict.code !== 'NOT_FOUND') {
        await client.query(
          `UPDATE agent_proposals
              SET decided_at = $2, decision = 'rejected', failure_reason = $3, decided_by = $4,
                  decided_by_user_id = $5
            WHERE id = $1`,
          [args.id, args.now.toISOString(), verdict.code, args.decidedBy?.tokenHash ?? null, args.decidedBy?.userId ?? null]
        );
      }
      await client.query('COMMIT');
      return { ok: false, code: verdict.code, message: verdict.message };
    }

    // The CANONICAL name, never the model's spelling. See `canonicalCategory`.
    const toWrite = verdict.setCategory === null ? null : canonical;
    await client.query(
      `UPDATE transactions SET mapped_category = $1, rule_applied = false
        WHERE id = $2 AND NOT ${giftLockSql('transactions', 'category', null)}`,
      [toWrite, stored!.subjectId]
    );
    await client.query(
      `UPDATE agent_proposals
          SET decided_at = $2, decision = 'confirmed', applied = TRUE, decided_by = $3,
              decided_by_user_id = $4
        WHERE id = $1`,
      [args.id, args.now.toISOString(), args.decidedBy?.tokenHash ?? null, args.decidedBy?.userId ?? null]
    );
    await client.query('COMMIT');

    return {
      ok: true,
      applied: true,
      message: toWrite ? `Categorized as ${toWrite}.` : 'Category cleared.',
    };
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}
