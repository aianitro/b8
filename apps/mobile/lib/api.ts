// The one place the app talks to the server.
//
// EVERY RESPONSE IS PARSED WITH THE SHARED SCHEMA, not cast. This is the entire reason
// `packages/contracts` exists and the reason Phase 1 came before this phase: the alternative is a
// hand-written interface on the phone that agrees with the server until the day it quietly does
// not, and a finance app whose figures are silently one release out of date is worse than one that
// fails to load.
import { OverviewResponseSchema, type OverviewData } from '@b8/contracts/overview';
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
