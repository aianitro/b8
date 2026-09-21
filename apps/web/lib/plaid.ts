import { Configuration, PlaidApi, PlaidEnvironments } from 'plaid';

/**
 * The Plaid client, built on first use rather than on import.
 *
 * ─── Why this is a function now ───────────────────────────────────────────────────────────────
 *
 * It used to be `export const plaidClient`, with two module-scope throws above it for the missing
 * credentials. Good rules, wrong place: `next build` IMPORTS every route module to collect
 * configuration, so a module that throws on import cannot be built in an environment without Plaid
 * credentials. On the laptop this never showed, because Next loads `.env.local` during a build.
 * Inside Docker the builder stage has no credentials — `.dockerignore` excludes `.env*`, correctly
 * — and the build died on the first route importing this file.
 *
 * `lib/db.ts` had the identical defect and is fixed the same way, on the same day. Two instances
 * make it a class worth naming: ENV VALIDATED AT MODULE SCOPE IS ENV VALIDATED AT BUILD TIME. The
 * check is not weakened here, only deferred to the first call — there is no configuration in which
 * a Plaid request now succeeds that used to fail.
 *
 * A FUNCTION RATHER THAN A LAZY PROXY. A `Proxy` would have kept all four call sites reading
 * `plaidClient.itemGet(...)` and hidden the laziness completely, which is precisely the objection:
 * the thing worth seeing at a call site is that the client may not exist yet and asking for it can
 * throw. Four call sites is a cheap price for that being visible.
 */
let cached: PlaidApi | null = null;

export function plaidClient(): PlaidApi {
  if (cached) return cached;

  // The same two messages as the old module-scope throws, so an operator searching for either
  // still finds the same string for the same missing key.
  if (!process.env.PLAID_CLIENT_ID) throw new Error('PLAID_CLIENT_ID is not set');
  if (!process.env.PLAID_SECRET) throw new Error('PLAID_SECRET is not set');

  const env = process.env.PLAID_ENV ?? 'sandbox';

  cached = new PlaidApi(
    new Configuration({
      basePath: PlaidEnvironments[env as keyof typeof PlaidEnvironments],
      baseOptions: {
        headers: {
          'PLAID-CLIENT-ID': process.env.PLAID_CLIENT_ID,
          'PLAID-SECRET': process.env.PLAID_SECRET,
        },
      },
    })
  );
  return cached;
}
