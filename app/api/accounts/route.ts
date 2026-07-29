import { NextRequest } from 'next/server';
import { randomUUID } from 'crypto';
import db from '@/lib/db';
import type { ApiResponse, Landscape } from '@/shared/types';

export async function POST(req: NextRequest) {
  try {
    const { name, bank, type, subtype, landscape } = await req.json() as {
      name: string;
      bank?: string;
      type: string;
      subtype?: string | null;
      landscape: Landscape;
    };

    if (!name?.trim() || !type?.trim() || !landscape) {
      return Response.json(
        { success: false, error: { code: 'BAD_REQUEST', message: 'name, type, and landscape are required' } } satisfies ApiResponse<null>,
        { status: 400 }
      );
    }

    const id = `manual_${randomUUID()}`;
    await db.query(
      `INSERT INTO accounts (id, name, type, subtype, landscape, bank, access_token)
       VALUES ($1, $2, $3, $4, $5, $6, NULL)`,
      [id, name.trim(), type, subtype ?? null, landscape, bank?.trim() || null]
    );

    return Response.json({ success: true, data: { id } } satisfies ApiResponse<{ id: string }>);
  } catch (err) {
    console.error('[accounts POST]', err instanceof Error ? err.message : err);
    return Response.json(
      { success: false, error: { code: 'SERVER_ERROR', message: 'Failed to create account' } } satisfies ApiResponse<null>,
      { status: 500 }
    );
  }
}
