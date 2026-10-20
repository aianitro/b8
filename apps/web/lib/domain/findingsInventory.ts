// The producer inventory (P5-34, SPEC.md "Producer inventory"): every module that computes something
// that could be worth telling the owner, and what the finding vocabulary decided about it.
//
// WHY A REGISTRY RATHER THAN A COMMENT. The next producer will be written by somebody who has not read
// this step's spec, and the failure this step exists to prevent — a second, private idea of "how bad
// is this" — is exactly what an undecided producer grows into. `findingsWiring.test.ts` (W3) scans the
// app for every exported type named `…Finding` or `…Health` and fails until it appears here, either
// `converted` (naming the kinds it becomes) or `excluded` (with the reason, in a sentence). The name
// test is a heuristic, a proxy for "is a finding producer"; the excluded entries below that do not
// match it are the hand-read half of the same control, and W6 keeps both halves honest by checking
// that every entry's file exists and exports the type it names.
//
// Keys are the exported type names; `file` is relative to `apps/web`. Data only — nothing here is
// executed by the conversions, and nothing existing imports it.

import type { FindingKind } from '@b8/contracts/findings';

export type InventoryEntry =
  | { file: string; disposition: 'converted'; kinds: readonly FindingKind[] }
  | { file: string; disposition: 'excluded'; reason: string };

export const PRODUCER_INVENTORY = {
  // ─── Converted: one kind each, except the adherence union, which is both of its members ───────
  BreachFinding: { file: 'lib/domain/adherence.ts', disposition: 'converted', kinds: ['budget-breach'] },
  ChronicUnderspendFinding: {
    file: 'lib/domain/adherence.ts', disposition: 'converted', kinds: ['budget-underspend'],
  },
  AdherenceFinding: {
    file: 'lib/domain/adherence.ts', disposition: 'converted', kinds: ['budget-breach', 'budget-underspend'],
  },
  DriftFinding: { file: 'lib/domain/drift.ts', disposition: 'converted', kinds: ['balance-drift'] },
  FeedFinding: { file: 'lib/domain/feedHealth.ts', disposition: 'converted', kinds: ['feed-degraded'] },
  SyncItemHealth: { file: 'lib/domain/syncHealth.ts', disposition: 'converted', kinds: ['sync-stale'] },
  JobHealth: { file: 'lib/domain/jobHealth.ts', disposition: 'converted', kinds: ['job-overdue'] },
  WalletFinding: { file: 'lib/domain/walletStaleness.ts', disposition: 'converted', kinds: ['cash-uncounted'] },
  ValuationFinding: {
    file: 'lib/domain/valuationStaleness.ts', disposition: 'converted', kinds: ['valuation-stale'],
  },
  OverdraftFinding: { file: 'lib/overdraftWatch.ts', disposition: 'converted', kinds: ['overdraft-open'] },
  ForecastFinding: { file: 'lib/overdraftWatch.ts', disposition: 'converted', kinds: ['overdraft-forecast'] },

  // ─── Excluded, each for a stated reason (SPEC.md's inventory table, rows marked "no") ─────────
  MonthOutlook: {
    file: 'lib/domain/monthOutlook.ts', disposition: 'excluded',
    reason: 'A verdict over every scored category, not a list of detections; folding it in would invent a projected kind and a per-category confidence (SPEC.md open question 3).',
  },
  CategorizationCoverage: {
    file: 'lib/domain/monthOutlook.ts', disposition: 'excluded',
    reason: 'A confidence qualifier on the headline, not an item worth telling; step 35 or 36 may use it.',
  },
  AlertMessage: {
    file: 'lib/domain/breachAlert.ts', disposition: 'excluded',
    reason: 'An outbound message derived from the month outlook, not a detection of its own.',
  },
  DigestData: {
    file: 'lib/domain/digest.ts', disposition: 'excluded',
    reason: 'A consumer and renderer; its job-gap and valuation strings re-render findings already converted here.',
  },
  PropertyPnl: {
    file: 'lib/domain/propertyPnl.ts', disposition: 'excluded',
    reason: 'Profit and loss arithmetic with no anomaly producer; "no new detectors" forbids inventing one (open question 2).',
  },
  LedgerRow: {
    file: 'lib/domain/propertyLedger.ts', disposition: 'excluded',
    reason: 'Ledger arithmetic with no anomaly producer; "no new detectors" forbids inventing one (open question 2).',
  },
  CategoryPace: {
    file: 'lib/domain/pacing.ts', disposition: 'excluded',
    reason: 'A position that feeds the month outlook, an input to a producer rather than an output worth telling.',
  },
  EpisodeStep: {
    file: 'lib/domain/overdraft.ts', disposition: 'excluded',
    reason: 'A state transition that feeds the overdraft episode table; the open episode it produces is converted.',
  },
  ForecastStep: {
    file: 'lib/domain/overdraft.ts', disposition: 'excluded',
    reason: 'A state transition that feeds the overdraft forecast table; the open forecast it produces is converted.',
  },
  CashProjection: {
    file: 'lib/domain/cashForecast.ts', disposition: 'excluded',
    reason: 'A projected cash series that feeds the overdraft forecast, an input rather than a finding.',
  },
  WatchedTransaction: {
    file: 'lib/watchlistRead.ts', disposition: 'excluded',
    reason: 'A transaction the owner flagged by hand; owner-authored, not a detection.',
  },
  GiftOutcome: {
    file: 'lib/domain/giftMatch.ts', disposition: 'excluded',
    reason: 'Drives the gift window-end notice, which is private to the giver; a household-wide list carrying it would reveal that a gift exists.',
  },
  TxnMatchResult: {
    file: 'lib/domain/txnMatch.ts', disposition: 'excluded',
    reason: 'Ingest re-identification of transactions, not anything worth telling the owner.',
  },
} as const satisfies Record<string, InventoryEntry>;
