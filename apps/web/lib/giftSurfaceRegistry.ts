// Gifts (P7-41b) — THE SURFACE REGISTRY. Every page and every API route in the app, classified by
// what it can carry of a ledger row, with the scenario that proves it behaves; and the files allowed
// to touch a row's text or write a row outside the read path.
//
// Data only, read by the tests: `lib/giftSurfaceWiring.test.ts` fails when a `page.tsx` or
// `route.ts` exists that is not listed here (W4), when a reader outside `READ_PATH_FILES` and
// `EXEMPT_FILES` reads a protected column from `transactions` (W1), and when the set of files that
// write rows differs from `GUARDED_WRITERS` (W12). `app/api/v1/gifts/giftSurfaces.test.ts` sweeps
// every `text-bearing` GET route here as every viewer (X1).
//
// A NEW SURFACE IS ADDED HERE BY A PERSON WHO HAS DECIDED WHAT IT SHOWS. That is the point: the
// failure W4 produces for an unlisted file is the moment someone has to answer "can this carry a
// gift's merchant, and if so, which test proves it is masked".
//
// The classes (SPEC.md W4):
//   text-bearing        — can show a row's name, merchant, note, enrichment or a gift's criteria;
//                          must read through `visibleTransactions`, and names its sweeping scenario.
//   guarded-write       — changes a row; refuses a held one (`lib/giftLock.ts`).
//   numeric-only        — sums, counts, balances, settings; carries no row text, and its figures are
//                          the same for every viewer (X5, H2).
//   no-transaction-data — reads nothing about ledger rows at all.

export type SurfaceClass = 'text-bearing' | 'guarded-write' | 'numeric-only' | 'no-transaction-data';

export interface Surface {
  /** Path from `apps/web`. */
  file: string;
  /** Every class the file's handlers fall in; a file with a GET and a PATCH may be two. */
  classes: SurfaceClass[];
  /** The scenario that proves it, required for `text-bearing` and `guarded-write`. */
  scenario?: string;
}

export const ROUTES: Surface[] = [
  { file: 'app/api/v1/accounts/[id]/balance/route.ts', classes: ['numeric-only'] },
  { file: 'app/api/v1/accounts/[id]/route.ts', classes: ['numeric-only'] },
  { file: 'app/api/v1/accounts/[id]/statement/route.ts', classes: ['numeric-only'] },
  { file: 'app/api/v1/accounts/[id]/statement/transfers/route.ts', classes: ['numeric-only'] },
  { file: 'app/api/v1/accounts/[id]/valuation/route.ts', classes: ['numeric-only'] },
  { file: 'app/api/v1/accounts/reconcile/route.ts', classes: ['no-transaction-data'] },
  { file: 'app/api/v1/accounts/reorder/route.ts', classes: ['no-transaction-data'] },
  { file: 'app/api/v1/accounts/route.ts', classes: ['numeric-only'] },
  { file: 'app/api/v1/agent/proposals/[id]/decide/route.ts', classes: ['guarded-write'], scenario: 'X12' },
  { file: 'app/api/v1/auth/invitations/route.ts', classes: ['no-transaction-data'] },
  { file: 'app/api/v1/auth/login/options/route.ts', classes: ['no-transaction-data'] },
  { file: 'app/api/v1/auth/login/verify/route.ts', classes: ['no-transaction-data'] },
  { file: 'app/api/v1/auth/logout/route.ts', classes: ['no-transaction-data'] },
  { file: 'app/api/v1/auth/me/route.ts', classes: ['no-transaction-data'] },
  { file: 'app/api/v1/auth/register/options/route.ts', classes: ['no-transaction-data'] },
  { file: 'app/api/v1/auth/register/verify/route.ts', classes: ['no-transaction-data'] },
  { file: 'app/api/v1/auth/users/[id]/revoke/route.ts', classes: ['no-transaction-data'] },
  { file: 'app/api/v1/budget/settings/route.ts', classes: ['numeric-only'] },
  { file: 'app/api/v1/budget/unspent/allocate/route.ts', classes: ['numeric-only'] },
  { file: 'app/api/v1/budget/unspent/route.ts', classes: ['numeric-only'] },
  { file: 'app/api/v1/cash-counts/route.ts', classes: ['numeric-only'] },
  { file: 'app/api/v1/cash-transfers/route.ts', classes: ['guarded-write'], scenario: 'X12' },
  { file: 'app/api/v1/categories/[name]/balance/route.ts', classes: ['numeric-only'] },
  { file: 'app/api/v1/categories/reorder/route.ts', classes: ['no-transaction-data'] },
  { file: 'app/api/v1/categories/route.ts', classes: ['numeric-only'] },
  { file: 'app/api/v1/chat/route.ts', classes: ['text-bearing'], scenario: 'X6' },
  { file: 'app/api/v1/gifts/[id]/cancel/route.ts', classes: ['guarded-write'], scenario: 'G8' },
  { file: 'app/api/v1/gifts/[id]/choose/route.ts', classes: ['guarded-write'], scenario: 'G7' },
  { file: 'app/api/v1/gifts/[id]/route.ts', classes: ['text-bearing'], scenario: 'G2' },
  { file: 'app/api/v1/gifts/route.ts', classes: ['text-bearing'], scenario: 'G2' },
  { file: 'app/api/v1/import/csv/route.ts', classes: ['numeric-only'] },
  { file: 'app/api/v1/overview/route.ts', classes: ['text-bearing'], scenario: 'X1' },
  { file: 'app/api/v1/plaid/create-link-token/route.ts', classes: ['no-transaction-data'] },
  { file: 'app/api/v1/plaid/exchange-token/route.ts', classes: ['no-transaction-data'] },
  { file: 'app/api/v1/properties/[id]/balance/route.ts', classes: ['numeric-only'] },
  { file: 'app/api/v1/properties/[id]/route.ts', classes: ['numeric-only'] },
  { file: 'app/api/v1/properties/[id]/tenant-funds/route.ts', classes: ['numeric-only'] },
  { file: 'app/api/v1/properties/[id]/valuation/[valuationId]/route.ts', classes: ['numeric-only'] },
  { file: 'app/api/v1/properties/[id]/valuation/route.ts', classes: ['numeric-only'] },
  { file: 'app/api/v1/properties/route.ts', classes: ['numeric-only'] },
  { file: 'app/api/v1/push/web/route.ts', classes: ['no-transaction-data'] },
  { file: 'app/api/v1/push/web/status/route.ts', classes: ['no-transaction-data'] },
  { file: 'app/api/v1/rules/apply/route.ts', classes: ['guarded-write'], scenario: 'X12' },
  { file: 'app/api/v1/rules/route.ts', classes: ['guarded-write'], scenario: 'X12' },
  // Counts and account names only (S23); the run's figures, never a row.
  { file: 'app/api/v1/sync/route.ts', classes: ['numeric-only'] },
  { file: 'app/api/v1/transactions/[id]/counterparts/route.ts', classes: ['text-bearing'], scenario: 'X1' },
  { file: 'app/api/v1/transactions/[id]/route.ts', classes: ['text-bearing', 'guarded-write'], scenario: 'X2' },
  { file: 'app/api/v1/transactions/bulk/route.ts', classes: ['guarded-write'], scenario: 'X12' },
  { file: 'app/api/v1/transactions/route.ts', classes: ['text-bearing'], scenario: 'X3' },
  { file: 'app/api/v1/transfers/route.ts', classes: ['guarded-write'], scenario: 'X12' },
];

export const PAGES: Surface[] = [
  { file: 'app/accounts/[id]/page.tsx', classes: ['text-bearing'], scenario: 'H2' },
  { file: 'app/accounts/page.tsx', classes: ['numeric-only'] },
  { file: 'app/budget/page.tsx', classes: ['numeric-only'] },
  { file: 'app/categories/[name]/page.tsx', classes: ['text-bearing'], scenario: 'H2' },
  { file: 'app/categories/page.tsx', classes: ['no-transaction-data'] },
  { file: 'app/dashboard/page.tsx', classes: ['text-bearing'], scenario: 'H2' },
  { file: 'app/gifts/page.tsx', classes: ['text-bearing'], scenario: 'H10' },
  { file: 'app/import/page.tsx', classes: ['no-transaction-data'] },
  { file: 'app/insights/page.tsx', classes: ['no-transaction-data'] },
  { file: 'app/login/page.tsx', classes: ['no-transaction-data'] },
  { file: 'app/net-worth/page.tsx', classes: ['numeric-only'] },
  { file: 'app/offline/page.tsx', classes: ['no-transaction-data'] },
  { file: 'app/page.tsx', classes: ['no-transaction-data'] },
  { file: 'app/profit-loss/page.tsx', classes: ['numeric-only'] },
  { file: 'app/properties/[id]/page.tsx', classes: ['text-bearing'], scenario: 'H2' },
  { file: 'app/properties/page.tsx', classes: ['numeric-only'] },
  { file: 'app/rules/page.tsx', classes: ['text-bearing'], scenario: 'H6' },
  { file: 'app/sandbox/page.tsx', classes: ['numeric-only'] },
  { file: 'app/transactions/page.tsx', classes: ['text-bearing'], scenario: 'H2' },
];

/**
 * The read path: the only files that read a protected column of `transactions` directly for a
 * viewer. Every export that yields rows takes a non-optional `viewer` (W11).
 */
export const READ_PATH_FILES = ['lib/giftReadPath.ts'];

/** Exported functions of the read path that are predicates over one row, not row sources (W11). */
export const READ_PATH_PREDICATES = ['giftMaskedSql', 'giftHeldSql', 'giftLinkedSql'];

/** Files outside the read path that may read protected columns, each with its reason (W3). */
export const EXEMPT_FILES: { file: string; reason: string }[] = [
  {
    file: 'lib/sync.ts',
    reason:
      'Ingest and internal comparison: it writes rows from Plaid, re-identifies reissued ids by name, '
      + 'and reads the rows it just inserted for the gift matcher. Its output is links and counts; '
      + 'no row text leaves it, in a response or a log line.',
  },
];

/**
 * Every file that UPDATEs a viewer-visible column of `transactions` or DELETEs from it, outside the
 * sync's ingest (W12), and the scenario proving it refuses a held row.
 */
export const GUARDED_WRITERS: { file: string; scenario: string }[] = [
  { file: 'app/api/v1/transactions/[id]/route.ts', scenario: 'X12' },
  { file: 'app/api/v1/transactions/bulk/route.ts', scenario: 'X12' },
  { file: 'app/api/v1/transfers/route.ts', scenario: 'X12' },
  { file: 'lib/cashTransferStore.ts', scenario: 'X12' },
  { file: 'app/api/v1/rules/route.ts', scenario: 'X12' },
  { file: 'app/api/v1/rules/apply/route.ts', scenario: 'X12' },
  { file: 'lib/proposalStore.ts', scenario: 'X12' },
  // The gift's own writer: filing a held row and restoring it exactly on choose, cancel and expiry.
  // Its guard is the gift itself — it touches only rows linked to the giver's own gift.
  { file: 'lib/giftStore.ts', scenario: 'G7' },
];
