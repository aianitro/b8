import { NextRequest } from 'next/server';
import { plaidClient } from '@/lib/plaid';
import { CountryCode, Products } from 'plaid';
import type { ApiResponse } from '@/shared/types';

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
    // whose `.config.headers` carries the live PLAID-CLIENT-ID/PLAID-SECRET, and console.error
    // on an Error with extra own properties prints those properties too.
    console.error('[create-link-token]', err instanceof Error ? err.message : err);
    return Response.json(
      { success: false, error: { code: 'PLAID_ERROR', message: 'Failed to create link token' } } satisfies ApiResponse<never>,
      { status: 500 }
    );
  }
}
