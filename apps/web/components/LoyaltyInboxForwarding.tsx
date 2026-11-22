'use client';

// Loyalty inbox (P8-42c1) — forwarding health, one line per household member, with the editor for
// the addresses they forward from. The state and the day count are the server's (Postgres
// arithmetic against CURRENT_DATE); this file only words them. A person with no address is "not set
// up", never "quiet"; quiet means strictly more than the silence threshold (45 days) with no mail
// through their addresses, whether or not any ever arrived. Mail not matched to anyone counts toward
// nobody's health. A household member with no b8 user is shown like anyone else.

import { useRouter } from 'next/navigation';
import type { LoyaltyInbox, LoyaltyInboxForwarding as Forwarding, LoyaltyMember } from '@b8/contracts/loyalty';
import LoyaltyListEditor from './LoyaltyListEditor';
import { send } from './LoyaltyRequest';

/** The line for one member, by state; every value in it is the server's. */
function healthLine(name: string, f: Forwarding): string {
  switch (f.state) {
    case 'not_set_up': return `${name}: no forwarding address set`;
    case 'no_mail_yet': return `${name}: no mail yet`;
    case 'ok': return `${name}: last mail ${f.lastReceivedOn}`;
    case 'quiet': return `${name}: forwarding quiet for ${f.quietDays} days`;
  }
}

export default function LoyaltyInboxForwarding({ inbox, members }: { inbox: LoyaltyInbox; members: LoyaltyMember[] }) {
  const router = useRouter();
  const nameOf = new Map(members.map((m) => [m.id, m.displayName]));

  async function saveAddresses(memberId: number, entries: string[]): Promise<string | null> {
    const result = await send('PATCH', `/api/v1/loyalty/members/${memberId}`, { forwardingAddresses: entries });
    if (!result.ok) return result.message;
    router.refresh();
    return null;
  }

  if (inbox.forwarding.length === 0) return null;
  return (
    <div className="mt-4">
      <h3 className="text-xs font-medium text-gray-400">Forwarding</h3>
      <ul className="mt-1 divide-y divide-gray-100">
        {inbox.forwarding.map((f) => (
          <li key={f.memberId} className="py-2 text-sm">
            <p className={f.state === 'quiet' ? 'text-amber-600' : 'text-gray-700'}>{healthLine(nameOf.get(f.memberId) ?? '', f)}</p>
            {f.addresses.length > 0 && <p className="text-xs text-gray-400 break-all">{f.addresses.join(', ')}</p>}
            <LoyaltyListEditor label="Edit forwarding addresses" values={f.addresses} onSave={(entries) => saveAddresses(f.memberId, entries)} />
          </li>
        ))}
      </ul>
    </div>
  );
}
