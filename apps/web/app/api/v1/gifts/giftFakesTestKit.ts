// P7-41b fixtures — the two outside boundaries the gift suites fake, and nothing else: Plaid (the
// `lib/plaid` client, as `app/api/v1/sync/route.test.ts` fakes it) and the Anthropic SDK (whose
// requests the suites read to prove what a model would have been sent).
//
// A SEPARATE MODULE WITH NO APP IMPORTS, because it is what the `vi.mock` factories load. A factory
// that imported the app (the sync, the database) would be loading the very module it is mocking.
// Not a test file and not a route: it registers no suite and adds no endpoint.
//
// Every value is fabricated.

/** The one Plaid item the gift suites own. Any other token reaching the fake is a fixture bug. */
export const GIFT_ITEM_TOKEN = 'zq41b-item-token';

export interface FakePage {
  added: unknown[];
  modified: unknown[];
  removed: { transaction_id: string }[];
  next_cursor: string;
  has_more: boolean;
  transactions_update_status?: string;
}

/** The `transactionsSync` pages still to be served, in order. */
export const plaidFake = { pages: [] as FakePage[] };

/** What replaces `@/lib/plaid`. */
export const plaidModule = {
  plaidClient: () => ({
    transactionsSync: async (req: { access_token: string }) => {
      if (req.access_token !== GIFT_ITEM_TOKEN) throw new Error('p41b: sync reached an item the gift suites do not own');
      const page = plaidFake.pages.shift();
      if (!page) throw new Error('p41b: sync asked for more pages than the test queued');
      return { data: page };
    },
    itemGet: async () => ({ data: { item: { institution_id: null }, status: {} } }),
    institutionsGetById: async () => {
      throw new Error('p41b: institutionsGetById was not expected');
    },
    transactionsRefresh: async () => ({ data: {} }),
  }),
};

export const reconcileModule = {
  reconcileAccountIds: async () => ({ remapped: [], unmatchedLive: [], unmatchedDb: [], liveBalances: [], liveCash: [] }),
};

export const balancesModule = { recordPlaidBalances: async () => 0 };

// ─── Anthropic ──────────────────────────────────────────────────────────────────────────────────

/** One request a suite's code made to the model, as it would have been sent. */
export interface ModelRequest { system?: unknown; messages: unknown; tools?: unknown }

/**
 * The fake model. `script` answers each request; `requests` records every one, so a suite can read
 * the system prompt, the tool results and the prompt the suggester built.
 */
export const anthropicFake = {
  requests: [] as ModelRequest[],
  script: (_req: ModelRequest, _n: number): unknown => ({
    content: [{ type: 'text', text: 'ok' }], stop_reason: 'end_turn', usage: { input_tokens: 1, output_tokens: 1 },
  }),
};

class FakeAnthropic {
  messages = {
    create: async (req: ModelRequest) => {
      anthropicFake.requests.push(JSON.parse(JSON.stringify(req)));
      return anthropicFake.script(req, anthropicFake.requests.length);
    },
  };
}

export const anthropicModule = { default: FakeAnthropic };
