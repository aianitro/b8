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
    console.error('[create-link-token]', err);
    return Response.json(
      { success: false, error: { code: 'PLAID_ERROR', message: 'Failed to create link token' } } satisfies ApiResponse<never>,
      { status: 500 }
    );
  }
}
