// The one place the app talks to the server.
//
// EVERY RESPONSE IS PARSED WITH THE SHARED SCHEMA, not cast. This is the entire reason
// `packages/contracts` exists and the reason Phase 1 came before this phase: the alternative is a
// hand-written interface on the phone that agrees with the server until the day it quietly does
// not, and a finance app whose figures are silently one release out of date is worse than one that
// fails to load.
import { OverviewResponseSchema, type OverviewData } from '@b8/contracts/overview';
import { QuickEntryResponseSchema, type QuickEntryData } from '@b8/contracts/quickEntry';
import { BASE_URL, readToken } from './config';

export class ApiError extends Error {}

/**
 * Does this token actually work, before it is written to the keychain?
 *
 * A paste is the one place a credential arrives mistyped or truncated, and a token saved wrong
 * fails later as "no data" on the screen that is supposed to answer a question — the worst place to
 * debug it. One request settles it at the moment of entry.
 */
export async function verifyToken(token: string): Promise<void> {
  if (!BASE_URL) {
    throw new ApiError('EXPO_PUBLIC_B8_BASE_URL is not set — see apps/mobile/README.md');
  }
  const response = await fetch(`${BASE_URL}/api/v1/overview`, {
    headers: { Authorization: `Bearer ${token.trim()}` },
  });
  if (response.status === 401) {
    throw new ApiError('The server rejected that token. Check it was copied whole, and not expired.');
  }
  if (!response.ok) throw new ApiError(`The server answered ${response.status}.`);
}

/** The authenticated fetch every call shares, so the credential rule lives in one place. */
async function authed(path: string, init: RequestInit = {}): Promise<Response> {
  if (!BASE_URL) {
    throw new ApiError('EXPO_PUBLIC_B8_BASE_URL is not set — see apps/mobile/README.md');
  }
  const token = await readToken();
  if (!token) throw new ApiError('No device session. Sign in with your passkey.');

  const response = await fetch(`${BASE_URL}${path}`, {
    ...init,
    headers: {
      ...(init.headers ?? {}),
      Authorization: `Bearer ${token}`,
      ...(init.body ? { 'Content-Type': 'application/json' } : {}),
    },
  });

  if (response.status === 401) {
    throw new ApiError('This device session was revoked or expired. Sign in again.');
  }
  if (response.status === 403) {
    // The scope check. A READ-ONLY token can fetch the overview and cannot change a category —
    // saying which is the difference between a fixable problem and a mysterious one.
    throw new ApiError('This token is read-only. Changing a category needs a full-scope token.');
  }
  return response;
}

export interface ChatProposal {
  id: string;
  subjectId: number;
  proposed: { category: string | null };
  observed: { category: string | null };
  rationale: string | null;
  expiresAt: string;
  subject: { date: string; amount: number; merchant: string | null } | null;
}

export interface ChatTurn {
  reply: string;
  proposals: ChatProposal[];
  stoppedAtMaxTurns: boolean;
}

export class RateLimited extends ApiError {}

/**
 * Ask the agent.
 *
 * THE WHOLE CONVERSATION IS SENT EACH TIME, because the endpoint is stateless — it holds no thread
 * of its own, which is why the eval harness can ask it a fixed question and get a comparable answer.
 * The phone keeps the history; the server keeps none.
 */
export async function askChat(
  messages: Array<{ role: 'user' | 'assistant'; content: string }>
): Promise<ChatTurn> {
  const response = await authed('/api/v1/chat', { method: 'POST', body: JSON.stringify({ messages }) });

  if (response.status === 429) {
    // The app names the limit rather than saying "try later". `lib/rateLimit.ts` distinguishes a
    // per-session bucket that refills in seconds from a DAILY CEILING that resets at midnight, and
    // the server's message already says which — passing it through beats inventing a retry.
    const body = await response.json().catch(() => null);
    throw new RateLimited(body?.error?.message ?? 'Too many requests. Try again shortly.');
  }
  if (!response.ok) throw new ApiError(`The server answered ${response.status}.`);

  const body = await response.json();
  if (!body.success) throw new ApiError(body.error?.message ?? 'The agent could not answer.');
  return {
    reply: body.data.reply,
    proposals: body.data.proposals ?? [],
    stoppedAtMaxTurns: Boolean(body.data.stoppedAtMaxTurns),
  };
}

/**
 * Confirm or dismiss one agent proposal.
 *
 * The endpoint is deliberately outside `READ_SAFE_POSTS`: the agent may PROPOSE with any credential
 * that can reach chat, and only a full-scope session can make the change happen. That separation is
 * the gate — see `docs/agent-authorization.md` §4 — and this function is the only thing in the app
 * that crosses it.
 */
export async function decideProposal(
  id: string,
  decision: 'confirmed' | 'rejected'
): Promise<{ applied: boolean; message: string }> {
  const response = await authed(`/api/v1/agent/proposals/${id}/decide`, {
    method: 'POST',
    body: JSON.stringify({ decision }),
  });
  const body = await response.json().catch(() => null);
  if (!response.ok || !body?.success) {
    throw new ApiError(body?.error?.message ?? `Could not apply that (${response.status}).`);
  }
  return body.data;
}

/** Screen 4's lists: valuation-mode accounts and properties, with their latest value. */
export async function fetchQuickEntry(): Promise<QuickEntryData> {
  const response = await authed('/api/v1/quick-entry');
  if (!response.ok) throw new ApiError(`The server answered ${response.status}.`);
  const parsed = QuickEntryResponseSchema.parse(await response.json());
  if (!parsed.success) throw new ApiError(parsed.error.message);
  return parsed.data;
}

/**
 * Record a new valuation.
 *
 * APPEND, NEVER OVERWRITE. Both endpoints POST a new row into `account_valuations` /
 * `property_valuations` rather than updating a balance, so the history of what was believed and when
 * survives — which is what `lib/domain/valuation.ts` reads to build a trend, and what makes a typo
 * correctable by entering the right number rather than by editing the past.
 */
export async function postValuation(
  target: { kind: 'account'; id: string } | { kind: 'property'; id: number },
  value: number
): Promise<void> {
  const path = target.kind === 'account'
    ? `/api/v1/accounts/${encodeURIComponent(target.id)}/valuation`
    : `/api/v1/properties/${target.id}/valuation`;
  const response = await authed(path, { method: 'POST', body: JSON.stringify({ value }) });
  const body = await response.json().catch(() => null);
  if (!response.ok || !body?.success) {
    throw new ApiError(body?.error?.message ?? `Could not save that (${response.status}).`);
  }
}

/**
 * Exchange a one-minute handoff code for a device session.
 *
 * DELIBERATELY NOT THROUGH `authed`: there is no credential yet — the code IS the credential, and
 * obtaining a session is the point. The server refuses this call from anything that looks like a
 * browser, which is what makes the endpoint safe to leave pre-auth.
 */
export async function claimDeviceSession(code: string): Promise<{ token: string; expiresAt: string }> {
  if (!BASE_URL) throw new ApiError('EXPO_PUBLIC_B8_BASE_URL is not set.');
  const response = await fetch(`${BASE_URL}/api/v1/auth/device-claim`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ code }),
  });
  const body = await response.json().catch(() => null);
  if (!response.ok || !body?.success) {
    throw new ApiError(body?.error?.message ?? `Could not link this device (${response.status}).`);
  }
  return body.data;
}

/** A POST that carries the device credential. Used by push registration. */
export async function authedPost(path: string, body: unknown): Promise<void> {
  const response = await authed(path, { method: 'POST', body: JSON.stringify(body) });
  if (!response.ok) throw new ApiError(`The server answered ${response.status}.`);
  const parsed = await response.json();
  if (!parsed.success) throw new ApiError(parsed.error?.message ?? 'The server refused that.');
}

/** The budget category names, for the picker. */
export async function fetchCategoryNames(): Promise<string[]> {
  const response = await authed('/api/v1/categories');
  if (!response.ok) throw new ApiError(`The server answered ${response.status}.`);
  const body = await response.json();
  if (!body.success) throw new ApiError('Could not load categories.');
  // Shaped narrowly on purpose: the picker needs names, and binding the whole BudgetCategory row
  // here would couple this screen to columns it never reads.
  return (body.data as Array<{ name: string; exclude_from_budget: boolean; is_income: boolean }>)
    .filter((c) => !c.exclude_from_budget && !c.is_income)
    .map((c) => c.name);
}

/**
 * Set a transaction's category, directly.
 *
 * NOT a proposal, and the distinction matters. The propose/confirm gate exists to stop the MODEL
 * acting on its own (docs/agent-authorization.md §4); the owner tapping a category on their own
 * phone IS the authority the gate defers to. Routing a human decision through a confirmation would
 * be ceremony, and ceremony is what teaches people to tap without reading.
 */
export async function setCategory(transactionId: number, category: string | null): Promise<void> {
  const response = await authed(`/api/v1/transactions/${transactionId}`, {
    method: 'PATCH',
    body: JSON.stringify({ mapped_category: category }),
  });
  if (!response.ok) throw new ApiError(`Could not change that category (${response.status}).`);
}

export async function fetchOverview(): Promise<OverviewData> {
  const response = await authed('/api/v1/overview');
  if (!response.ok) throw new ApiError(`The server answered ${response.status}.`);

  // `parse`, not `safeParse`: a payload that does not match the contract is a bug worth surfacing,
  // and rendering a partially-understood one is how the web dashboard once showed four different
  // totals for one number.
  const parsed = OverviewResponseSchema.parse(await response.json());
  if (!parsed.success) throw new ApiError(parsed.error.message);
  return parsed.data;
}
