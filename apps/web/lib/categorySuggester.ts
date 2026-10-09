import Anthropic from '@anthropic-ai/sdk';
import db from './db';
import { createLogger } from './logger';
import { createProposal } from './proposalStore';
import { buildPrompt, historySuggestions, parseModelReply, type FiledExample, type Suggestion, type UnfiledRow } from './domain/categorySuggest';

const log = createLogger('categorySuggester');

/** Haiku: the cheapest current model, and a category pick from a fixed list does not need more. */
const MODEL = 'claude-haiku-4-5-20251001';
/** A suggestion waits a week for the owner; the next run after that makes a fresh one. */
const SUGGESTION_TTL_MS = 7 * 24 * 60 * 60 * 1000;
/** Per run. The backlog drains over a few syncs rather than in one large request. */
const MAX_ROWS = 60;
const MAX_MODEL_ROWS = 40;
/** Filed examples shown to the model — enough to convey the owner's habits, few enough to be cheap. */
const MAX_EXAMPLES = 80;

/**
 * Suggest categories for unfiled transactions, as proposals the owner confirms one tap at a time.
 *
 * Called after a sync — the daily job's and the Sync button's — so new arrivals have a suggestion
 * by the time anyone looks. It never throws: a suggestion is a convenience, and nothing about a
 * sync may fail because the model is unreachable. Without ANTHROPIC_API_KEY it still makes the
 * history-based suggestions and skips the model.
 *
 * THE SAME UNFILED PREDICATE AS THE DASHBOARD (`readStats` / `readUncategorized` in overviewRead):
 * no category, not hidden, on a tracked account. Suggesting for a row the card does not count would
 * put a suggestion where nobody looks.
 */
export async function suggestCategories(now: Date = new Date()): Promise<{ history: number; model: number }> {
  try {
    // 1. CLOSE THIS SUGGESTER'S OWN STALE PROPOSALS — lapsed, or about a row since filed — so a fresh
    //    one can be made (one pending proposal per transaction is enforced by an index). Only
    //    system-made ones (`proposed_by IS NULL`): a proposal from the chat is the owner's own and is
    //    left alone. Closed as 'rejected', the only "not applied" decision the table has.
    await db.query(
      `UPDATE agent_proposals p
          SET decided_at = $1, decision = 'rejected'
        WHERE p.decided_at IS NULL AND p.proposed_by IS NULL AND p.kind = 'categorize_transaction'
          AND (p.expires_at <= $1
               OR EXISTS (SELECT 1 FROM transactions t WHERE t.id = p.subject_id AND t.mapped_category IS NOT NULL))`,
      [now]
    );

    // 2. The unfiled rows that have no pending proposal — newest first, so today's arrivals lead.
    const unfiled = await db.query<{ id: number; date: string; amount: string; name: string | null; merchant: string | null; plaid_category: string | null }>(
      `SELECT t.id, t.date::text, t.amount::text, t.name, NULLIF(t.merchant_name, '') AS merchant, t.plaid_category
         FROM transactions t
         JOIN accounts a ON a.id = t.account_id AND a.track_transactions = TRUE
        WHERE t.mapped_category IS NULL AND t.hidden = FALSE
          AND NOT EXISTS (SELECT 1 FROM agent_proposals p
                           WHERE p.kind = 'categorize_transaction' AND p.subject_id = t.id AND p.decided_at IS NULL)
        ORDER BY t.date DESC, t.id DESC
        LIMIT $1`,
      [MAX_ROWS]
    );
    if (unfiled.rows.length === 0) return { history: 0, model: 0 };
    const rows: UnfiledRow[] = unfiled.rows.map((r) => ({
      id: r.id, date: r.date, amount: Number(r.amount), name: r.name, merchant: r.merchant, plaidCategory: r.plaid_category,
    }));

    // 3. History: the owner's own filings of the same merchants over the past year.
    const filedRes = await db.query<{ merchant: string | null; name: string | null; category: string }>(
      `SELECT NULLIF(merchant_name, '') AS merchant, name, mapped_category AS category
         FROM transactions
        WHERE mapped_category IS NOT NULL AND date >= $1::date - INTERVAL '365 days'`,
      [now.toISOString().slice(0, 10)]
    );
    const filed: FiledExample[] = filedRes.rows;
    const fromHistory = historySuggestions(rows, filed);

    // 4. The model, for the rest — only when a key is configured.
    const answered = new Set(fromHistory.map((s) => s.transactionId));
    const forModel = rows.filter((r) => !answered.has(r.id)).slice(0, MAX_MODEL_ROWS);
    let fromModel: Suggestion[] = [];
    if (forModel.length > 0 && process.env.ANTHROPIC_API_KEY) {
      const categories = (await db.query<{ name: string }>('SELECT name FROM budget_categories ORDER BY name')).rows.map((c) => c.name);
      const examples = sampleExamples(filed, MAX_EXAMPLES);
      const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
      const response = await anthropic.messages.create({
        model: MODEL,
        max_tokens: 4096,
        messages: [{ role: 'user', content: buildPrompt(forModel, categories, examples) }],
      });
      const text = response.content.map((b) => (b.type === 'text' ? b.text : '')).join('');
      fromModel = parseModelReply(text, new Set(forModel.map((r) => r.id)), categories);
      log.info('model suggestions', {
        asked: forModel.length, answered: fromModel.length,
        inputTokens: response.usage.input_tokens, outputTokens: response.usage.output_tokens,
      });
    }

    // 5. Each becomes a proposal. `observed` is what the confirm path re-checks: still unfiled.
    for (const s of [...fromHistory, ...fromModel]) {
      await createProposal({
        subjectId: s.transactionId,
        proposed: { category: s.category },
        observed: { category: null },
        rationale: s.rationale,
        proposedBy: null,
        now,
        ttlMs: SUGGESTION_TTL_MS,
      });
    }
    log.info('suggested categories', { history: fromHistory.length, model: fromModel.length });
    return { history: fromHistory.length, model: fromModel.length };
  } catch (err) {
    log.error('suggestion run failed', { error: err instanceof Error ? err.message : String(err) });
    return { history: 0, model: 0 };
  }
}

/** One example per merchant, most common category, up to `max` — habits, not volume. */
function sampleExamples(filed: readonly FiledExample[], max: number): FiledExample[] {
  const seen = new Set<string>();
  const out: FiledExample[] = [];
  for (const f of filed) {
    const key = `${(f.merchant ?? f.name ?? '').toLowerCase()}|${f.category}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(f);
    if (out.length >= max) break;
  }
  return out;
}

/**
 * The pending suggestions for these transactions, for the rows that show them: transaction id →
 * the proposal to confirm, its category and why. Only this suggester's own (`proposed_by IS NULL`)
 * and only while confirmable.
 */
export async function loadSuggestions(transactionIds: readonly number[], now: Date = new Date()) {
  const map = new Map<number, { proposalId: string; category: string; rationale: string | null }>();
  if (transactionIds.length === 0) return map;
  const r = await db.query<{ id: string; subject_id: number; category: string | null; rationale: string | null }>(
    `SELECT id, subject_id, proposed->>'category' AS category, rationale
       FROM agent_proposals
      WHERE kind = 'categorize_transaction' AND decided_at IS NULL AND proposed_by IS NULL
        AND expires_at > $2 AND subject_id = ANY($1)`,
    [transactionIds, now]
  );
  for (const row of r.rows) {
    if (row.category) map.set(row.subject_id, { proposalId: row.id, category: row.category, rationale: row.rationale });
  }
  return map;
}
