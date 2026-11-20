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
//
// P8-42b: a membership with a linked credit card also carries that card's fee watch — the posted
// date of its most recent annual fee and where the expected benefit stands. The store finds the fee
// through the gift read path and never as any one viewer, so a gift-held row is a fee for nobody and
// this page shows the same dates to both users. It carries a date derived from a ledger row, never
// the row's text or amount, which makes it `numeric-only` in the gift surface registry (H12). This
// page still reads no ledger table itself; `loadOverview` does.
export default async function TravelPage() {
  const overview = await loadOverview();
  return <TravelBoard overview={overview} />;
}
