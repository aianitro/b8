export const dynamic = 'force-dynamic';

import TravelBoard from '@/components/TravelBoard';
import { loadOverview } from '@/lib/loyaltyStore';

// Nights & Miles (P8-42a). Reads the database directly, like app/properties/page.tsx, and hands the
// client board exactly what `GET /api/v1/loyalty` returns: member numbers MASKED, balances as
// decimal text, dates as YYYY-MM-DD text. Unlike the properties page it maps no NUMERIC through
// Number(...) and no DATE through a JS Date — the store selects both as text — so a cash balance
// keeps its cents exactly and no server time zone can move an as-of date by a day.
//
// Same for both b8 users: there is no per-user filter, because they are peers over these rows. The
// proxy has already refused a request with no session before this renders.
export default async function TravelPage() {
  const overview = await loadOverview();
  return <TravelBoard overview={overview} />;
}
