// The gate between what the agent ASKS for and what actually happens.
//
// ROADMAP.md §5 step 16. Pure, and deliberately so: every rule about whether a proposal may be
// applied is decided here from facts passed in, so the rules are testable without a database, a
// model, or a clock. The route supplies the facts and performs the effect; it decides nothing.
//
// The design commitment this file exists to enforce, from docs/agent-authorization.md §4:
//
//   A WRITE TOOL RETURNS A PROPOSAL, NOT AN EFFECT.
//
// That is the only mitigation that survives the model being fully persuaded by a prompt injection,
// because it does not rely on the model at all. Everything else here is in service of it.

/** The effects the gate knows how to apply. Adding one is a migration, not a new string. */
export type ProposalKind = 'categorize_transaction';

export interface CategorizeProposed {
  /** The category to set. `null` means clear it — a real and deliberate outcome. */
  category: string | null;
}

export interface CategorizeObserved {
  /** What the transaction's category was when the proposal was made. */
  category: string | null;
}

export interface StoredProposal {
  id: string;
  kind: ProposalKind;
  subjectId: number;
  proposed: CategorizeProposed;
  observed: CategorizeObserved;
  rationale: string | null;
  expiresAt: Date;
  decidedAt: Date | null;
}

/** What the world looks like now, at the moment of confirming. */
export interface ApplyFacts {
  proposal: StoredProposal | null;
  now: Date;
  /** The subject as it stands right now. `null` when the row no longer exists. */
  currentCategory: string | null | undefined;
  subjectExists: boolean;
  /** Whether the proposed category is a real budget category. `null` (clear) is always valid. */
  categoryIsKnown: boolean;
}

export type ApplyVerdict =
  | { ok: true; setCategory: string | null }
  | { ok: false; code: ApplyRefusal; message: string };

export type ApplyRefusal =
  | 'NOT_FOUND'
  | 'ALREADY_DECIDED'
  | 'EXPIRED'
  | 'SUBJECT_GONE'
  | 'SUBJECT_CHANGED'
  | 'UNKNOWN_CATEGORY';

/**
 * May this proposal be applied right now?
 *
 * The order of these checks is not arbitrary. Cheap identity questions come before questions about
 * the world, and `ALREADY_DECIDED` precedes `EXPIRED` so that a proposal confirmed once and
 * replayed after it would have expired reports the replay rather than the expiry — the two have
 * different causes and only one of them is an attack.
 */
export function decideApply(facts: ApplyFacts): ApplyVerdict {
  const p = facts.proposal;
  if (!p) {
    return { ok: false, code: 'NOT_FOUND', message: 'No such proposal.' };
  }

  // Single use. The unique index makes a second PENDING proposal impossible; this makes a second
  // APPLICATION impossible, which is the replay the stateless design would have had to solve.
  if (p.decidedAt) {
    return { ok: false, code: 'ALREADY_DECIDED', message: 'This proposal has already been decided.' };
  }

  // `>=` so a proposal is dead exactly at its expiry, not a millisecond after. The clock is passed
  // in, so this is testable rather than a race.
  if (facts.now >= p.expiresAt) {
    return { ok: false, code: 'EXPIRED', message: 'This proposal has expired. Ask again.' };
  }

  if (!facts.subjectExists) {
    return { ok: false, code: 'SUBJECT_GONE', message: 'That transaction no longer exists.' };
  }

  // THE CHECK THAT MAKES THIS A GATE RATHER THAN A DELAY.
  //
  // The owner saw a card saying "this is Dining Out, make it Groceries" and clicked yes. If the
  // category changed in between -- by their own edit in another tab, by a rule run, by a sync --
  // then applying now performs a change they were never shown and silently discards the newer one.
  // Refusing is the only honest answer: the thing they agreed to is not the thing that would
  // happen.
  if (normalize(facts.currentCategory) !== normalize(p.observed.category)) {
    return {
      ok: false,
      code: 'SUBJECT_CHANGED',
      message:
        `This transaction changed since the suggestion was made ` +
        `(it was ${describe(p.observed.category)}, it is now ${describe(facts.currentCategory)}). ` +
        `Nothing was applied — ask again to get a fresh suggestion.`,
    };
  }

  // Re-checked at APPLY time, not only at propose time. A category can be renamed or deleted
  // between the two, and the proposal would then write a string no budget line matches -- which
  // does not error, it just quietly stops counting toward anything.
  if (p.proposed.category !== null && !facts.categoryIsKnown) {
    return {
      ok: false,
      code: 'UNKNOWN_CATEGORY',
      message: `“${p.proposed.category}” is not one of your budget categories.`,
    };
  }

  return { ok: true, setCategory: p.proposed.category };
}

/**
 * Is this proposal worth making at all?
 *
 * A proposal to change nothing is noise: it asks the owner to click a button whose effect is the
 * state they already have, and a gate that cries wolf is a gate that gets clicked through.
 */
export function isNoop(proposed: CategorizeProposed, observed: CategorizeObserved): boolean {
  return normalize(proposed.category) === normalize(observed.category);
}

/** How long a proposal stays confirmable. Short: see the migration's note on `expires_at`. */
export const PROPOSAL_TTL_MS = 15 * 60 * 1000;

export function expiryFrom(now: Date): Date {
  return new Date(now.getTime() + PROPOSAL_TTL_MS);
}

/**
 * Case- and whitespace-insensitive, because a category differing only in case is the same budget
 * line to everyone except a string comparison. Null and empty are the same absence.
 */
function normalize(value: string | null | undefined): string {
  return (value ?? '').trim().toLowerCase();
}

function describe(value: string | null | undefined): string {
  const v = (value ?? '').trim();
  return v === '' ? 'uncategorized' : `“${v}”`;
}
