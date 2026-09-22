import db from '@/lib/db';
import type { ApiResponse } from '@b8/contracts/types';
import { createLogger } from '@/lib/logger';
import { QuickEntryDataSchema, type QuickEntryData } from '@b8/contracts/quickEntry';

const log = createLogger('quick-entry');

export const dynamic = 'force-dynamic';

/**
 * Everything screen 4 needs, in one round trip.
 *
 * ONE ENDPOINT RATHER THAN TWO, for the reason `/api/v1/overview` exists: a phone on a home network
 * pays for round trips, and a screen that renders two lists should not need two requests to know
 * whether it has anything to show.
 *
 * It exists at all because neither `accounts` nor `properties` had a GET — the web pages are server
 * components that read the database directly, which is invisible until a second client needs the
 * same data. That is the gap P1-11a predicted when it called `/api/v1/overview` "the drift an
 * endpoint nothing reads is exposed to."
 */
export async function GET() {
  try {
    const [accounts, properties] = await Promise.all([
      // LATERAL rather than a GROUP BY: the latest valuation per account is a row, not an
      // aggregate, and picking `MAX(valued_at)` then re-joining for its value is the two-step that
      // silently returns the wrong row when two valuations share a timestamp.
      db.query<{
        id: string; name: string; type: string; landscape: string;
        is_liability: boolean; latest_value: string | null; latest_at: string | null;
      }>(
        `SELECT a.id, a.name, a.type, a.landscape, a.is_liability,
                v.value::text  AS latest_value,
                v.valued_at::text AS latest_at
           FROM accounts a
           LEFT JOIN LATERAL (
             SELECT value, valued_at FROM account_valuations
              WHERE account_id = a.id
              ORDER BY valued_at DESC, id DESC
              LIMIT 1
           ) v ON TRUE
          -- Only valuation-mode accounts. A ledger account's balance is derived from its
          -- transactions, so a hand-typed number would be overwritten by the next sync — offering
          -- the entry at all would be offering a change that silently does not stick.
          WHERE a.valuation_mode = 'valuation'
          ORDER BY a.sort_order, a.name`
      ),
      db.query<{ id: number; nickname: string; type: string; latest_value: string | null; latest_at: string | null }>(
        `SELECT p.id, p.nickname, p.type,
                v.value::text AS latest_value,
                v.valued_at::text AS latest_at
           FROM properties p
           LEFT JOIN LATERAL (
             SELECT value, valued_at FROM property_valuations
              WHERE property_id = p.id
              ORDER BY valued_at DESC, id DESC
              LIMIT 1
           ) v ON TRUE
          ORDER BY p.type, p.nickname`
      ),
    ]);

    const data: QuickEntryData = {
      accounts: accounts.rows.map((r) => ({
        id: r.id,
        name: r.name,
        type: r.type,
        landscape: r.landscape,
        isLiability: r.is_liability,
        latestValue: r.latest_value === null ? null : Number(r.latest_value),
        latestAt: r.latest_at,
      })),
      properties: properties.rows.map((r) => ({
        id: r.id,
        nickname: r.nickname,
        type: r.type,
        latestValue: r.latest_value === null ? null : Number(r.latest_value),
        latestAt: r.latest_at,
      })),
    };

    // Parsed against its own contract before it leaves. The phone parses it again on arrival; this
    // side catches a drift between the query and the schema at the source, where the fix is.
    return Response.json(
      { success: true, data: QuickEntryDataSchema.parse(data) } satisfies ApiResponse<QuickEntryData>
    );
  } catch (err) {
    log.error('quick-entry read failed', { error: err instanceof Error ? err.message : String(err) });
    return Response.json(
      { success: false, error: { code: 'READ_FAILED', message: 'Could not load accounts and properties.' } } satisfies ApiResponse<never>,
      { status: 500 }
    );
  }
}
