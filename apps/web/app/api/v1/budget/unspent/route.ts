// `GET /api/v1/budget/unspent` — every category's unspent bucket: balance, closes and allocations.
import { loadBuckets, type UnspentBucket } from '@/lib/unspentStore';
import type { ApiResponse } from '@b8/contracts/types';

export const dynamic = 'force-dynamic';

export async function GET() {
  const buckets = await loadBuckets();
  return Response.json({ success: true, data: buckets } satisfies ApiResponse<UnspentBucket[]>);
}
