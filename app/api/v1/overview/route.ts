// `GET /api/v1/overview` — everything `app/dashboard/page.tsx` fetches today, in one request.
//
// A THIN WRAPPER, and deliberately nothing more. The composition, the wire-formatting and the six
// ad hoc reads live in `@/lib/overviewRead`, because `vitest.config.mts` collects `lib/` and
// `shared/` and not `app/**` — so logic placed in this file would be logic the repo's existing
// suite cannot reach. Everything here is HTTP: call the shell, wrap the result in the envelope
// every other route already returns, hand it to `Response.json`.
//
// NO QUERY PARAMETERS, NO AUTH, NO RATE LIMIT. Auth is Phase 1 step 12 and rate limiting is step
// 13. This endpoint is exactly as unauthenticated as all 27 routes under `app/api/` are today —
// a pre-existing condition of the whole route surface, not a new exposure opened here.
//
// NO `.parse()` ON THE WAY OUT. The response contract is `OverviewResponseSchema` in
// `shared/contracts/overview.ts`, and it is enforced by this route's own test rather than on every
// request: validating here would make a schema that has fallen behind an additive change in
// `lib/domain/**` into a 500 for a change that broke nothing. The fixtures parse the real
// JSON-round-tripped response, which is the value a consumer actually receives.
//
// `Response.json` is the Web API, as in every other handler here — `next/server` is not imported
// because nothing in this file needs the extended request or response.

import { loadOverview } from '@/lib/overviewRead';
import type { OverviewData } from '@/shared/contracts/overview';
import type { ApiResponse } from '@/shared/types';

export async function GET() {
  const data = await loadOverview();
  return Response.json({ success: true, data } satisfies ApiResponse<OverviewData>);
}
