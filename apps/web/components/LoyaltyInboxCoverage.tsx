'use client';

// Loyalty inbox (P8-42c1) — coverage, one line per catalog program: its sender domains (the
// allowlist), the last mail seen from them (a date only, Postgres text) and how many messages are
// kept from the last 30 days, with the editor for the domains. The whole catalog is listed, folded
// away by default, because the allowlist is edited per program and most programs are ones nobody in
// the household holds.
//
// No mail yet is "No mail seen yet", never a date; a program with no domain is "No sender domains
// set" and can never keep mail until one is added. The editor's list is replaced whole by the
// program PATCH; a shared mail provider or a domain another program holds is refused there and the
// stored list stays as it was.

import { useRouter } from 'next/navigation';
import type { LoyaltyInbox, LoyaltyInboxReadPanel, LoyaltyProgram, LoyaltyReadCoverage } from '@b8/contracts/loyalty';
import LoyaltyListEditor from './LoyaltyListEditor';
import { send } from './LoyaltyRequest';

/** Whether the newest read mail of a program stated a balance (P8-42c2). Never read is not "no". */
const IN_LAST_STATEMENT: Record<LoyaltyReadCoverage, string> = {
  yes: 'Balance in last statement: yes', no: 'Balance in last statement: no', not_read: 'Balance in last statement: not read yet',
};

export default function LoyaltyInboxCoverage({
  inbox, programs, inboxRead,
}: { inbox: LoyaltyInbox; programs: LoyaltyProgram[]; inboxRead?: LoyaltyInboxReadPanel }) {
  const router = useRouter();
  const domainsOf = new Map(inbox.senderDomains.map((s) => [s.programId, s.domains]));
  const coverageOf = new Map(inbox.coverage.map((c) => [c.programId, c]));
  const readOf = new Map((inboxRead?.coverage ?? []).map((c) => [c.programId, c.balanceInLastStatement]));

  async function saveDomains(programId: number, entries: string[]): Promise<string | null> {
    const result = await send('PATCH', `/api/v1/loyalty/programs/${programId}`, { senderDomains: entries });
    if (!result.ok) return result.message;
    router.refresh();
    return null;
  }

  return (
    <details className="mt-4">
      <summary className="min-h-8 cursor-pointer text-xs font-medium text-gray-400">{`Sender domains · ${programs.length} programs`}</summary>
      <ul className="mt-1 divide-y divide-gray-100">
        {programs.map((p) => {
          const domains = domainsOf.get(p.id) ?? [];
          const c = coverageOf.get(p.id);
          return (
            <li key={p.id} className="py-2 text-sm">
              <p className="text-gray-900">{p.name}</p>
              {domains.length === 0 || c === undefined ? (
                <p className="text-xs text-gray-400">No sender domains set</p>
              ) : (
                <>
                  <p className="text-xs text-gray-500 break-all">{domains.join(', ')}</p>
                  <p className="text-xs text-gray-400">
                    {c.lastSeenOn === null ? 'No mail seen yet' : `Last mail seen: ${c.lastSeenOn}`}
                    {` · ${c.storedInWindow} in the last 30 days`}
                  </p>
                  {readOf.has(p.id) && <p className="text-xs text-gray-400">{IN_LAST_STATEMENT[readOf.get(p.id) ?? 'not_read']}</p>}
                </>
              )}
              <LoyaltyListEditor label="Edit sender domains" values={domains} onSave={(entries) => saveDomains(p.id, entries)} />
            </li>
          );
        })}
      </ul>
    </details>
  );
}
