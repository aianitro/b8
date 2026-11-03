// `POST /api/v1/budget/unspent/close` — close every month that has ended without waiting out its
// grace days, filling each spending category's bucket. The budget page's "Close now"; the daily job
// does the same thing on its own schedule (lib/scheduler.ts). The rule about which months may be
// taken is lib/domain/unspent.ts's, and the month now running is never one of them.
import { closeNow } from '@/lib/unspentStore';
import { createLogger } from '@/lib/logger';
import type { ApiResponse } from '@b8/contracts/types';

const log = createLogger('unspent');

export interface CloseResult {
  /** The months closed by this call, earliest first. */
  closed: { year: number; month: number }[];
  /** How many category rows were written across them. */
  written: number;
}

export async function POST() {
  try {
    const { closed, written } = await closeNow();
    if (closed.length === 0) {
      return Response.json(
        { success: false, error: { code: 'INVALID_INPUT', message: 'No month has ended that is still waiting to be closed.' } } satisfies ApiResponse<never>,
        { status: 400 }
      );
    }
    log.info('closed on request', { months: closed.length });
    return Response.json({ success: true, data: { closed, written } } satisfies ApiResponse<CloseResult>, { status: 201 });
  } catch (err) {
    log.error('close failed', { error: err instanceof Error ? err.message : String(err) });
    return Response.json(
      { success: false, error: { code: 'SERVER_ERROR', message: 'Could not close the month.' } } satisfies ApiResponse<never>,
      { status: 500 }
    );
  }
}
