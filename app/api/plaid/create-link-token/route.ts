import { NextRequest } from 'next/server';
import { plaidClient } from '@/lib/plaid';
import { CountryCode, Products } from 'plaid';
import type { ApiResponse } from '@/shared/types';
import { createLogger } from '@/lib/logger';

const log = createLogger('create-link-token');

export async function POST(_req: NextRequest) {
  try {
    const response = await plaidClient.linkTokenCreate({
      user: { client_user_id: 'local-user' },
      client_name: 'B8 Finance',
      products: [Products.Transactions],
      country_codes: [CountryCode.Us],
      language: 'en',
    });

    return Response.json({
      success: true,
      data: { link_token: response.data.link_token },
    } satisfies ApiResponse<{ link_token: string }>);
  } catch (err) {
    // Log only the message, never the raw error object — Plaid SDK errors are axios errors
    // whose `.config.headers` carries the live PLAID-CLIENT-ID/PLAID-SECRET, and logging
    // an Error with extra own properties would print those properties too.
    log.error('request failed', { error: err instanceof Error ? err.message : String(err) });
    return Response.json(
      { success: false, error: { code: 'PLAID_ERROR', message: 'Failed to create link token' } } satisfies ApiResponse<never>,
      { status: 500 }
    );
  }
}
