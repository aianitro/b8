// Loyalty inbox, reading (P8-42c2) — what the newest settled mail said about one membership's
// expiring points and its certificates, shown under the membership line. Stored, displayed, and
// nothing more: no rule reads these and no instrument is created from them (42g decides that).
//
// Only a reading that passed the program check and matched this membership alone reaches here
// (applied, applied by hand, stale or without a balance; never one still waiting in the queue). An
// expiry with no amount shows no amount; an instrument with no expiry says "no expiry stated".

import type { LoyaltyInstrumentKind, LoyaltyReadExpiryKind, LoyaltyReadFromMail } from '@b8/contracts/loyalty';

const WHAT: Record<LoyaltyReadExpiryKind, string> = {
  points: 'points', miles: 'miles', nights: 'nights', usd: 'usd', status: 'status', other: 'something else',
};
const KIND: Record<LoyaltyInstrumentKind, string> = {
  free_night: 'free night', companion_fare: 'companion fare', travel_credit: 'travel credit', other: 'other',
};

export default function LoyaltyFromMailLine({ fromMail }: { fromMail: LoyaltyReadFromMail }) {
  return (
    <ul className="mt-1 text-xs text-gray-500">
      {fromMail.expiryWarnings.map((w, i) => (
        <li key={`e${i}`}>{`Expires ${w.expiresOn}: ${w.amount === null ? '' : `${w.amount} `}${WHAT[w.what]}`}</li>
      ))}
      {fromMail.instruments.map((x, i) => (
        <li key={`i${i}`}>{`From mail: ${KIND[x.kind]}${x.expiresOn === null ? ', no expiry stated' : `, expires ${x.expiresOn}`}`}</li>
      ))}
    </ul>
  );
}
