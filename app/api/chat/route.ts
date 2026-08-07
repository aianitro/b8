import { NextRequest } from 'next/server';
import Anthropic from '@anthropic-ai/sdk';
import db from '@/lib/db';
import type { ApiResponse } from '@/shared/types';
import { createLogger } from '@/lib/logger';

const log = createLogger('chat');

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

// ── Tools ─────────────────────────────────────────────────────────────────────

const TOOLS: Anthropic.Tool[] = [
  {
    name: 'get_budget_summary',
    description: 'Get annual budget vs YTD spending and remaining for every budget category. Use this first for budget/pacing questions.',
    input_schema: { type: 'object' as const, properties: {}, required: [] },
  },
  {
    name: 'get_monthly_spending',
    description: 'Get month-by-month spending totals for the current year, optionally filtered to one category.',
    input_schema: {
      type: 'object' as const,
      properties: {
        category: { type: 'string', description: 'Budget category name to filter by (optional — omit for all categories)' },
      },
    },
  },
  {
    name: 'get_top_merchants',
    description: 'Get top merchants by total spend, optionally filtered by category and date range.',
    input_schema: {
      type: 'object' as const,
      properties: {
        category: { type: 'string', description: 'Budget category name (optional)' },
        from_date: { type: 'string', description: 'Start date YYYY-MM-DD (optional)' },
        to_date:   { type: 'string', description: 'End date YYYY-MM-DD (optional)' },
        limit:     { type: 'number', description: 'Max results, default 10' },
      },
    },
  },
  {
    name: 'get_transactions',
    description: 'Get individual transactions. Use for specific lookups, anomalies, or when the user asks about particular purchases.',
    input_schema: {
      type: 'object' as const,
      properties: {
        category:  { type: 'string', description: 'Budget category name (optional)' },
        from_date: { type: 'string', description: 'Start date YYYY-MM-DD (optional)' },
        to_date:   { type: 'string', description: 'End date YYYY-MM-DD (optional)' },
        limit:     { type: 'number', description: 'Max results, default 20, max 100' },
      },
    },
  },
];

// ── Tool execution ─────────────────────────────────────────────────────────────

async function runTool(name: string, input: Record<string, unknown>): Promise<unknown> {
  switch (name) {
    case 'get_budget_summary': {
      const r = await db.query(`
        SELECT bc.name AS category, bc.landscape, bc.annual_budget,
               COALESCE(SUM(t.amount) FILTER (WHERE t.amount > 0), 0) AS ytd_spent,
               bc.annual_budget - COALESCE(SUM(t.amount) FILTER (WHERE t.amount > 0), 0) AS remaining,
               ROUND(bc.annual_budget / 12, 2) AS monthly_reference
        FROM budget_categories bc
        LEFT JOIN transactions t ON t.mapped_category = bc.name
          AND EXTRACT(YEAR FROM t.date) = EXTRACT(YEAR FROM CURRENT_DATE)
        WHERE bc.exclude_from_budget = FALSE
        GROUP BY bc.name, bc.landscape, bc.annual_budget
        ORDER BY bc.landscape, bc.name
      `);
      return r.rows;
    }

    case 'get_monthly_spending': {
      const { category } = input as { category?: string };
      const args: unknown[] = [];
      const catFilter = category ? (args.push(category), `AND t.mapped_category = $${args.length}`) : '';
      const r = await db.query(`
        SELECT EXTRACT(MONTH FROM t.date)::int AS month,
               TRIM(TO_CHAR(t.date, 'Month')) AS month_name,
               t.mapped_category AS category,
               SUM(t.amount) FILTER (WHERE t.amount > 0) AS spent
        FROM transactions t
        JOIN budget_categories bc ON bc.name = t.mapped_category AND bc.exclude_from_budget = FALSE
        WHERE EXTRACT(YEAR FROM t.date) = EXTRACT(YEAR FROM CURRENT_DATE)
          ${catFilter}
        GROUP BY month, month_name, t.mapped_category
        ORDER BY month, t.mapped_category
      `, args);
      return r.rows;
    }

    case 'get_top_merchants': {
      const { category, from_date, to_date, limit = 10 } = input as {
        category?: string; from_date?: string; to_date?: string; limit?: number;
      };
      const conds = ['t.amount > 0'];
      const args: unknown[] = [];
      if (category)  { args.push(category);  conds.push(`t.mapped_category = $${args.length}`); }
      if (from_date) { args.push(from_date); conds.push(`t.date >= $${args.length}`); }
      if (to_date)   { args.push(to_date);   conds.push(`t.date <= $${args.length}`); }
      args.push(Math.min(Number(limit), 50));
      const r = await db.query(`
        SELECT COALESCE(t.merchant_name, t.name) AS merchant,
               t.mapped_category AS category,
               COUNT(*)::int AS transactions,
               SUM(t.amount)::numeric(12,2) AS total_spent
        FROM transactions t
        WHERE ${conds.join(' AND ')}
        GROUP BY merchant, t.mapped_category
        ORDER BY total_spent DESC
        LIMIT $${args.length}
      `, args);
      return r.rows;
    }

    case 'get_transactions': {
      const { category, from_date, to_date, limit = 20 } = input as {
        category?: string; from_date?: string; to_date?: string; limit?: number;
      };
      const conds: string[] = [];
      const args: unknown[] = [];
      if (category)  { args.push(category);  conds.push(`t.mapped_category = $${args.length}`); }
      if (from_date) { args.push(from_date); conds.push(`t.date >= $${args.length}`); }
      if (to_date)   { args.push(to_date);   conds.push(`t.date <= $${args.length}`); }
      args.push(Math.min(Number(limit), 100));
      const where = conds.length ? `AND ${conds.join(' AND ')}` : '';
      const r = await db.query(`
        SELECT t.date::text, t.amount::numeric(12,2), COALESCE(t.merchant_name, t.name) AS merchant,
               t.mapped_category AS category, a.name AS account
        FROM transactions t
        JOIN accounts a ON a.id = t.account_id
        WHERE 1=1 ${where}
        ORDER BY t.date DESC
        LIMIT $${args.length}
      `, args);
      return r.rows;
    }

    default:
      return { error: `Unknown tool: ${name}` };
  }
}

// ── System prompt ──────────────────────────────────────────────────────────────

async function buildSystemPrompt(): Promise<string> {
  const [cats, accounts] = await Promise.all([
    db.query('SELECT name, landscape, annual_budget FROM budget_categories WHERE exclude_from_budget = FALSE ORDER BY landscape, name'),
    db.query('SELECT name, type, landscape FROM accounts ORDER BY name'),
  ]);

  const today = new Date().toISOString().split('T')[0];
  const month = new Date().getMonth() + 1;

  const catLines = cats.rows.map((c) =>
    `  - ${c.name} (${c.landscape}): $${Number(c.annual_budget).toLocaleString()}/year`
  ).join('\n');

  const acctLines = accounts.rows.map((a) =>
    `  - ${a.name} (${a.type}, ${a.landscape})`
  ).join('\n');

  return `You are a personal finance assistant for B8 Finance — a private single-user app.
Today is ${today}. We are in month ${month} of 12 (${Math.round((month / 12) * 100)}% through the year).

Budget categories (annual allocations):
${catLines}

Tracked accounts:
${acctLines}

Landscape definitions:
- "operational" = day-to-day spending (food, utilities, services, travel, etc.)
- "capital" = major long-term investments (home projects, large one-time purchases)

Guidelines:
- Always use tools to fetch real data before answering quantitative questions — never guess amounts.
- Format currency as USD (e.g. $1,234). Be concise and direct.
- For pacing: expected YTD = (annual_budget / 12) × months_elapsed. Flag if actual > expected.
- For forecasting: project year-end = (ytd_spent / month) × 12.
- Highlight risks and anomalies proactively when you see them in the data.
- Transfer transactions are excluded from budgets and should not be counted as spending.`;
}

// ── Agentic loop ───────────────────────────────────────────────────────────────

type Message = Anthropic.MessageParam;

async function runAgentLoop(messages: Message[]): Promise<string> {
  const system = await buildSystemPrompt();
  const history: Message[] = [...messages];
  const MAX_TURNS = 5;

  for (let turn = 0; turn < MAX_TURNS; turn++) {
    const response = await anthropic.messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: 2048,
      system,
      tools: TOOLS,
      messages: history,
    });

    // Collect text and tool calls from this response
    const textBlocks = response.content.filter((b): b is Anthropic.TextBlock => b.type === 'text');
    const toolUseBlocks = response.content.filter((b): b is Anthropic.ToolUseBlock => b.type === 'tool_use');

    if (response.stop_reason === 'end_turn' || toolUseBlocks.length === 0) {
      return textBlocks.map((b) => b.text).join('');
    }

    // Add assistant turn
    history.push({ role: 'assistant', content: response.content });

    // Execute all tools in parallel and collect results
    const toolResults = await Promise.all(
      toolUseBlocks.map(async (block) => {
        const result = await runTool(block.name, block.input as Record<string, unknown>);
        return {
          type: 'tool_result' as const,
          tool_use_id: block.id,
          content: JSON.stringify(result),
        };
      })
    );

    history.push({ role: 'user', content: toolResults });
  }

  return 'I reached the maximum number of reasoning steps. Please try a more specific question.';
}

// ── Route handler ──────────────────────────────────────────────────────────────

export async function POST(req: NextRequest) {
  if (!process.env.ANTHROPIC_API_KEY) {
    return Response.json(
      { success: false, error: { code: 'NO_API_KEY', message: 'ANTHROPIC_API_KEY is not set in .env.local' } } satisfies ApiResponse<never>,
      { status: 500 }
    );
  }

  const { messages } = await req.json() as { messages: Message[] };
  if (!messages?.length) {
    return Response.json(
      { success: false, error: { code: 'INVALID_INPUT', message: 'messages required' } } satisfies ApiResponse<never>,
      { status: 400 }
    );
  }

  try {
    const reply = await runAgentLoop(messages);
    return Response.json({ success: true, data: { reply } } satisfies ApiResponse<{ reply: string }>);
  } catch (err) {
    log.error('request failed', { error: err instanceof Error ? err.message : String(err) });
    return Response.json(
      { success: false, error: { code: 'CHAT_ERROR', message: 'Failed to get response from Claude' } } satisfies ApiResponse<never>,
      { status: 500 }
    );
  }
}
