/**
 * Which cash balances have stopped being trustworthy, and why.
 *
 * A wallet's balance is exactly as true as its last count. Every other account on the dashboard is
 * maintained by something — a feed, a valuation — and says so when it stops. Cash has no such
 * mechanism: it goes wrong silently, at a rate nobody can see, and the only cure is a person opening
 * their wallet. This is the part that says so.
 *
 * Pure, like `feedHealth.ts` and `drift.ts` beside it, and for the same reason: which wallets are
 * stale is a classification, and a classification expressed in a WHERE clause is beyond the reach of
 * every test in this repo.
 */

export interface WalletCountState {
  accountId: string;
  name: string;
  /** The wallet's ledger balance right now. */
  balance: number;
  /** When it was last counted, or `null` if it never has been. */
  lastCountedAt: string | null;
}

export interface WalletFinding {
  accountId: string;
  name: string;
  balance: number;
  /** Whole days since the last count; `null` when it has never been counted. */
  daysSinceCount: number | null;
  /**
   * Why this wallet is being reported.
   *
   * `stale`   — counted once, long enough ago that the figure has drifted out of trust.
   * `never`   — never counted, and asserting a non-zero balance nobody has ever verified.
   */
  reason: 'stale' | 'never';
}

/**
 * Days after which a counted wallet stops being trusted.
 *
 * A POLICY CONSTANT, and named so it can be moved by evidence rather than rediscovered as a literal
 * in a conditional — the same treatment `COVERAGE_THRESHOLD` gets, for the same reason.
 *
 * Thirty days, because the alternative failure is the one that matters here. Too short and the
 * dashboard nags about a wallet the owner counted three weeks ago and has barely touched, which
 * teaches them to dismiss the warning — and a warning that is always present is one that is never
 * read, which costs the alert that mattered. Too long and the figure is wrong for a season before
 * anyone is told. A month is also the period the rest of this app reasons in, so "not counted this
 * month" needs no explanation to the person reading it.
 */
export const STALE_AFTER_DAYS = 30;

/**
 * Report the wallets whose balance should no longer be believed.
 *
 * ─── A NEVER-COUNTED EMPTY WALLET IS NOT A FINDING ────────────────────────────────────────────
 *
 * Reporting one would be reporting the absence of a problem. A wallet at zero that nobody has
 * counted is asserting nothing: there is no figure on screen that could be wrong, and nothing for
 * the owner to do about it. A never-counted wallet holding money is the opposite — it is a real
 * number on the net-worth total that no human has ever confirmed, which is worth exactly one line.
 *
 * ─── AND NEVER-COUNTED IS NOT "INFINITELY STALE" ──────────────────────────────────────────────
 *
 * The two reasons stay distinct all the way to the reader. "You have not counted this in 94 days"
 * and "you have never counted this" ask for the same action but describe different situations, and
 * collapsing them into one number means either inventing a day count for a wallet that has none, or
 * ranking a wallet added this morning against one abandoned in spring.
 *
 * Sorted worst-first — never-counted ahead of stale, then longest-uncounted — because the caller
 * renders the head of the list and a count of the rest.
 */
export function staleWallets(
  wallets: readonly WalletCountState[],
  now: Date = new Date(),
  staleAfterDays: number = STALE_AFTER_DAYS
): WalletFinding[] {
  const findings: WalletFinding[] = [];

  for (const w of wallets) {
    if (w.lastCountedAt === null) {
      // Rounded before comparing: a balance of a fraction of a penny is a rounding artifact of the
      // ledger sum, not money anyone can hold, and reporting it would be reporting float dust.
      if (Math.round(w.balance * 100) !== 0) {
        findings.push({ ...w, daysSinceCount: null, reason: 'never' });
      }
      continue;
    }

    const then = new Date(w.lastCountedAt);
    if (Number.isNaN(then.getTime())) continue;
    const days = Math.max(0, Math.floor((now.getTime() - then.getTime()) / 86_400_000));
    if (days >= staleAfterDays) {
      findings.push({ ...w, daysSinceCount: days, reason: 'stale' });
    }
  }

  return findings.sort((a, b) => {
    if (a.reason !== b.reason) return a.reason === 'never' ? -1 : 1;
    return (b.daysSinceCount ?? 0) - (a.daysSinceCount ?? 0);
  });
}
