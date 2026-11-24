// P8-42e1 — the `Hotel stays` section by source scan and static render (U14, U15). No browser or jsdom
// here (SPEC.md T17); what the page renders over real HTTP is the surface script's H17.
//
// U14 reads the component's own text, so it pins what the person sees and which condition shows it,
// not how the markup happens to be nested. U15 renders the real board with fabricated props: the
// section must appear only when the page passes a payload, and its markup must carry the masked code
// and never the code itself.

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import type { LoyaltyBookings, LoyaltyOverview } from '@b8/contracts/loyalty';
import TravelBoard from '@/components/TravelBoard';

// The board's client components ask for a router; rendered to a string here, nothing navigates.
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: () => {} }) }));

const WEB = fileURLToPath(new URL('../', import.meta.url));
const read = (f: string) => readFileSync(join(WEB, f), 'utf8');
const occurrences = (text: string, s: string) => text.split(s).length - 1;
const SECTION = 'components/LoyaltyStaysSection.tsx';

const PINNED = [
  'Hotel stays', 'Add a stay', 'Save stay', 'Upcoming', 'Completed this year', 'nights counted in', 'No stay counted yet',
  'Property not stated', 'Stays that need a membership', 'Add to this membership', 'Not mine', 'Ignore',
  'Cancelled stays are not counted.', 'Program-specific qualifying rules are not applied; every night of a completed stay counts.',
];

const CODE_CANARY = 'ZQ42ECODECANARY9';
const MASKED = '••••ARY9';

/** A fabricated overview: one hotel program with one membership, nothing else to show. */
const OVERVIEW = {
  members: [{ id: 5, displayName: 'ZQ42E Holder', userId: null }],
  programs: [{ id: 3, name: 'ZQ42E Harbour Rewards', kind: 'hotel', defaultUnit: 'points', aliases: [] }],
  cards: [{
    programId: 3, programName: 'ZQ42E Harbour Rewards', programKind: 'hotel',
    memberships: [{
      id: 2, memberId: 5, memberDisplayName: 'ZQ42E Holder', programId: 3, memberNumberMasked: null, tier: null, balance: null, unit: null,
      asOf: null, source: null, cardAccountId: null, cardAccountName: null, benefit: null, feeWatch: null, earn: null, earnEstimate: null, earnComparison: null,
    }],
  }],
  instruments: [],
  cardAccounts: [],
  inbox: {
    configured: false, problem: 'unset', missing: [], retentionDays: 30, silenceDays: 45, lastCheck: null,
    senderDomains: [], coverage: [], forwarding: [], unknownSenders: [], unknownSenderTotal: 0, unattributed: 0,
  },
  inboxRead: { readable: false, lastRead: null, waiting: 0, failed: 0, needsAttentionTotal: 0, needsAttention: [], coverage: [], fromMail: [], screenshotDue: [] },
} as unknown as LoyaltyOverview;

const BOOKINGS: LoyaltyBookings = {
  year: 2026,
  nights: [{ membershipId: 2, nightsThisYear: 2 }],
  upcoming: [],
  completed: [{
    id: 1, membershipId: 2, programId: 3, property: null, maskedCode: MASKED,
    checkIn: '2026-03-10', checkOut: '2026-03-12', nights: 2, state: 'booked', source: 'typed', award: null,
  }],
  queue: [],
};

const render = (props: { overview: LoyaltyOverview; bookings?: LoyaltyBookings }) =>
  renderToStaticMarkup(createElement(TravelBoard, props)).replace(/<!-- -->/g, '');

describe('the Hotel stays section (P8-42e1)', () => {
  it('T42e1-U14: every pinned phrase once, a dash and words for nothing counted, a gated submit, and a body with no source or nights', () => {
    const section = read(SECTION);
    for (const s of PINNED) expect(occurrences(section, s), s).toBe(1);
    // The nights line: a dash and the sentence for null, never a zero standing in for no data.
    expect(section).toMatch(/nights === null \? \(\s*<span[^>]*>\{'— · No stay counted yet'\}<\/span>/);
    expect(section).not.toMatch(/\?\?\s*0\b|\|\|\s*0\b/);
    // The submit is disabled while saving, so a second tap cannot write twice.
    expect(section).toMatch(/<button type="submit" disabled=\{saving\}/);
    // The body: no source, no nights; property and award null when blank; state only booked or cancelled.
    const body = /send\('POST', '\/api\/v1\/loyalty\/stays', \{([^}]*)\}\);/.exec(section)?.[1] ?? '';
    expect(body).not.toBe('');
    expect(body).not.toMatch(/source|nights/);
    expect(body).toMatch(/property: property\.trim\(\) === '' \? null : property\.trim\(\)/);
    expect(body).toMatch(/award: award === '' \? null : award === 'award'/);
    expect(section).toMatch(/setState\(e\.target\.value === 'cancelled' \? 'cancelled' : 'booked'\)/);
    // The hold buttons exist only inside the non-empty queue.
    expect(section).toMatch(/\{bookings\.queue\.length > 0 && \(/);
    expect(section.indexOf('bookings.queue.length > 0')).toBeLessThan(section.indexOf('<HeldBooking'));
    // Rows show the masked code; nothing injects markup.
    expect(section).toMatch(/stay\.maskedCode/);
    expect(section).not.toMatch(/dangerouslySetInnerHTML|innerHTML/);
    expect(section).toMatch(/const propertyText = \(property: string \| null\) => property \?\? 'Property not stated';/);
  });

  it('T42e1-U15: the board renders without bookings and shows the section only with them, the masked code and never the code', () => {
    const without = render({ overview: OVERVIEW });
    expect(without).not.toContain('Hotel stays');
    expect(without).toContain('Certificates &amp; credits');
    expect(without).toContain('Update from screenshot');

    const html = render({ overview: OVERVIEW, bookings: BOOKINGS });
    expect(occurrences(html, 'Hotel stays')).toBe(1);
    expect(html).toContain('2 nights counted in 2026');
    expect(html).toContain('Completed this year');
    expect(html).toContain(MASKED);
    expect(html).toContain('Property not stated');
    expect(html).not.toContain(CODE_CANARY);
    expect(html).toContain('Certificates &amp; credits');
    expect(html.indexOf('Hotel stays')).toBeLessThan(html.indexOf('Certificates &amp; credits'));
    // An empty payload draws nothing; a membership with nothing counted draws the dash.
    expect(render({ overview: OVERVIEW, bookings: { year: 2026, nights: [], upcoming: [], completed: [], queue: [] } })).not.toContain('Hotel stays');
    const dash = render({ overview: OVERVIEW, bookings: { ...BOOKINGS, nights: [{ membershipId: 2, nightsThisYear: null }], completed: [] } });
    expect(dash).toContain('— · No stay counted yet');
    expect(dash).not.toMatch(/\b0 nights/);

    const page = read('app/travel/page.tsx');
    expect(page).toMatch(/import \{ loadBookings \} from '@\/lib\/loyaltyBookingStore';/);
    expect(page).toMatch(/<TravelBoard overview=\{overview\} bookings=\{bookings\} \/>/);
    expect(page).not.toMatch(/@\/lib\/db|raw_mail/);
    expect(read('components/TravelBoard.tsx')).toMatch(/bookings\?: LoyaltyBookings/);
  });
});
