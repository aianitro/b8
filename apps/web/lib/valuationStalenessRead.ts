import db from '@/lib/db';
import { staleValuations, type ValuationFinding } from '@/lib/domain/valuationStaleness';

/**
 * The hand-valued investment accounts whose figure is stale, as of `today` (`YYYY-MM-DD`).
 *
 * One query for the dashboard, the net-worth page and the daily email alike, so the three cannot
 * disagree about which account is overdue. The latest value's DATE comes from Postgres's own
 * rendering — see app/net-worth/page.tsx for why a Date object is not converted instead.
 */
export async function loadValuationFindings(today: string): Promise<ValuationFinding[]> {
  const result = await db.query<{ id: string; name: string; latest: string | null }>(
    `SELECT a.id, a.name,
            (SELECT MAX(v.valued_at)::date::text FROM account_valuations v WHERE v.account_id = a.id) AS latest
       FROM accounts a
      WHERE a.valuation_mode = 'valuation' AND a.is_liability = FALSE
        -- Plaid-linked accounts refresh on every sync; one that stops is the feed-health card's to
        -- name, as a connection to fix rather than a statement to upload.
        AND a.access_token IS NULL`
  );
  return staleValuations(
    result.rows.map((r) => ({ id: r.id, name: r.name, latestValuedOn: r.latest })),
    today,
  );
}
