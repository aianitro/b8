// `POST /api/v1/accounts/{id}/statement` — read a brokerage statement PDF and say what it states.
//
// IT RECORDS NOTHING. The reply is a preview — the date, the value, the account ending — and the
// owner confirms it through the ordinary valuation endpoint, dated to the statement. A parser that
// wrote straight to the ledger would put a misread figure into net worth with nobody having looked
// at it; one extra tap is the price of every recorded value having been seen by a person.
//
// THE PDF IS NOT KEPT. It is read in memory and dropped when the request ends: a statement carries
// the account number, holdings and the owner's name, and nothing here needs any of that after the
// three fields are out. Read on this server, by `unpdf` — no third-party service sees it.

import { NextRequest } from 'next/server';
import { extractText, getDocumentProxy } from 'unpdf';
import db from '@/lib/db';
import { createLogger } from '@/lib/logger';
import { parseBrokerageStatement, type StatementReading } from '@/lib/domain/brokerageStatement';
import type { ApiResponse } from '@b8/contracts/types';

const log = createLogger('statement');

/** Statements run to a few hundred kilobytes; anything near this is not one. */
const MAX_BYTES = 10 * 1024 * 1024;

const refuse = (code: string, message: string, status: number) =>
  Response.json({ success: false, error: { code, message } } satisfies ApiResponse<never>, { status });

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;

  const account = await db.query<{ valuation_mode: string; is_liability: boolean }>(
    'SELECT valuation_mode, is_liability FROM accounts WHERE id = $1', [id]
  );
  if (account.rows.length === 0) return refuse('NOT_FOUND', 'Account not found', 404);
  // Only an asset whose value is entered by hand. A synced account's balance comes from its feed,
  // and a statement value recorded beside it would be a second, competing figure.
  if (account.rows[0].valuation_mode !== 'valuation' || account.rows[0].is_liability) {
    return refuse('INVALID_INPUT', 'Statements can be read only for an investment account valued by hand.', 400);
  }

  let file: FormDataEntryValue | null;
  try {
    file = (await req.formData()).get('file');
  } catch {
    return refuse('INVALID_INPUT', 'Send the statement as a file upload.', 400);
  }
  if (!(file instanceof Blob)) return refuse('INVALID_INPUT', 'Send the statement as a file upload.', 400);
  if (file.size > MAX_BYTES) return refuse('INVALID_INPUT', 'That file is too large to be a statement.', 400);

  const bytes = new Uint8Array(await file.arrayBuffer());
  // `%PDF` — checked on the bytes, not the declared type, which is whatever the browser guessed.
  if (bytes.length < 4 || String.fromCharCode(...bytes.slice(0, 4)) !== '%PDF') {
    return refuse('INVALID_INPUT', 'That file is not a PDF.', 400);
  }

  let text: string;
  try {
    const pdf = await getDocumentProxy(bytes);
    text = (await extractText(pdf, { mergePages: true })).text;
  } catch {
    // Encrypted, damaged, or a scan with no text layer — all the same answer to the owner.
    return refuse('UNREADABLE', 'The PDF could not be read. Type the value instead.', 422);
  }

  const parsed = parseBrokerageStatement(text);
  if (!parsed.ok) {
    log.warn('statement not recognised');
    return refuse('UNRECOGNISED', `${parsed.reason} Type the value instead.`, 422);
  }

  return Response.json({ success: true, data: parsed.reading } satisfies ApiResponse<StatementReading>);
}
