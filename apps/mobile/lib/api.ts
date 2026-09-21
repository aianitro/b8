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

export async function fetchOverview(): Promise<OverviewData> {
  if (!BASE_URL) {
    throw new ApiError('EXPO_PUBLIC_B8_BASE_URL is not set — see apps/mobile/README.md');
  }
  const token = await readToken();
  if (!token) throw new ApiError('No device session. Sign in with your passkey.');

  const response = await fetch(`${BASE_URL}/api/v1/overview`, {
    headers: { Authorization: `Bearer ${token}` },
  });

  if (response.status === 401) {
    throw new ApiError('This device session was revoked or expired. Sign in again.');
  }
  if (!response.ok) throw new ApiError(`The server answered ${response.status}.`);

  // `parse`, not `safeParse`: a payload that does not match the contract is a bug worth surfacing,
  // and rendering a partially-understood one is how the web dashboard once showed four different
  // totals for one number.
  const parsed = OverviewResponseSchema.parse(await response.json());
  if (!parsed.success) throw new ApiError(parsed.error.message);
  return parsed.data;
}
