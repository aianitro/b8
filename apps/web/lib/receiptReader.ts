import Anthropic from '@anthropic-ai/sdk';
import { createLogger } from './logger';
import { cleanReading, type ReceiptReading } from './domain/receiptMatch';
import type { ReceiptType } from './receipt';

// Reading a receipt photo with Claude: the merchant, and the subtotal, tax, tip and total as printed
// or written on it.
//
// A PROPOSAL, NEVER A FACT. What comes back here pre-fills a form the owner confirms; nothing is
// watched until they do. So a reading that fails, is refused or makes no sense degrades to empty
// fields, and the owner types the amount — the photo is stored either way. This never throws.
//
// STRUCTURED OUTPUT, so the answer is JSON in the shape below and not prose to be scraped; and then
// `cleanReading` checks every field again, because the schema guarantees types, not sense.
//
// THE PHOTO GOES TO ANTHROPIC, as the chat's and the category suggester's ledger text already does.
// The phone has re-encoded it, so it carries no EXIF location. Without ANTHROPIC_API_KEY nothing is
// sent and the owner fills the form by hand.

const log = createLogger('receiptReader');

/**
 * Claude Opus 5.5: handwriting on a signed slip — the tip and the total written in pen — is the
 * part that matters most and is hardest to read, and a receipt is a single small request.
 */
const MODEL = 'claude-opus-5-5';
/** Tried in the same call if the first model declines the request on policy grounds. */
const FALLBACK_MODEL = 'claude-opus-4-8';

const nullable = (type: 'string' | 'number', description: string) => ({
  anyOf: [{ type }, { type: 'null' }],
  description,
});

const SCHEMA = {
  type: 'object',
  properties: {
    merchant: nullable('string', 'The business name as printed at the top of the receipt.'),
    subtotal: nullable('number', 'The pre-tax subtotal of the bill.'),
    tax: nullable('number', 'Sales tax.'),
    tip: nullable('number', 'The tip or gratuity, printed or handwritten. Null if none was written.'),
    total: nullable('number', 'The final amount to be charged. On a signed slip this is the handwritten total including tip; otherwise the printed total.'),
  },
  required: ['merchant', 'subtotal', 'tax', 'tip', 'total'],
  additionalProperties: false,
};

const PROMPT = [
  'This is a photo of a receipt, usually from a restaurant, taken by its owner to record what their card will be charged.',
  'Read the merchant name and the amounts. If a tip and total were written in by hand on a signed slip, use the handwritten values.',
  'Amounts are plain numbers in the receipt\'s currency, without symbols. Use null for anything that is not on the receipt or cannot be read with confidence; never guess.',
].join(' ');

export const EMPTY_READING: ReceiptReading = { merchant: null, subtotal: null, tax: null, tip: null, total: null };

/** What the photo says, as far as it can be read. Empty when no key is configured or the read fails. */
export async function readReceipt(image: Uint8Array, type: ReceiptType): Promise<ReceiptReading> {
  if (!process.env.ANTHROPIC_API_KEY) return EMPTY_READING;
  try {
    const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
    const response = await client.beta.messages.create({
      model: MODEL,
      max_tokens: 4096,
      betas: ['server-side-fallback-2026-07-01'],
      fallbacks: [{ model: FALLBACK_MODEL }],
      output_config: { effort: 'medium', format: { type: 'json_schema', schema: SCHEMA } },
      messages: [{
        role: 'user',
        content: [
          { type: 'image', source: { type: 'base64', media_type: type, data: Buffer.from(image).toString('base64') } },
          { type: 'text', text: PROMPT },
        ],
      }],
    });
    if (response.stop_reason === 'refusal') {
      log.warn('receipt read refused', { category: response.stop_details?.category ?? null });
      return EMPTY_READING;
    }
    const text = response.content.map((b) => (b.type === 'text' ? b.text : '')).join('');
    const reading = cleanReading(JSON.parse(text));
    // Which fields were read, never their values: a log line is not where figures belong.
    log.info('receipt read', {
      model: response.model,
      read: Object.entries(reading).filter(([, v]) => v !== null).map(([k]) => k),
      inputTokens: response.usage.input_tokens,
      outputTokens: response.usage.output_tokens,
    });
    return reading;
  } catch (err) {
    if (err instanceof Anthropic.RateLimitError) log.warn('receipt read rate-limited');
    else if (err instanceof Anthropic.APIError) log.error('receipt read failed', { status: err.status ?? null });
    else log.error('receipt read failed', { error: err instanceof Error ? err.message : String(err) });
    return EMPTY_READING;
  }
}
