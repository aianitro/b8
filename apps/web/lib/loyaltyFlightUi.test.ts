// P8-42e1b — the `Flights` section by source scan and static render (U13, U14). No browser or jsdom
// here; what the page renders over real HTTP is the surface script's H18.
//
// U13 reads the component's own text, so it pins what the person sees and which condition shows it,
// not how the markup happens to be nested. U14 renders the real board with fabricated props: the
// section must appear only when the page passes a payload with something in it, after `Hotel stays`,
// carrying the masked code and never the code itself, and the board must still render without it.
//
// The section file is read only if it exists, so a tree without it fails on an assertion here, not on
// a missing file. Everything is fabricated: ZQ42E names and codes, plain airport fixtures.

import { existsSync, readFileSync } from 'node:fs';
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
const read = (f: string) => (existsSync(join(WEB, f)) ? readFileSync(join(WEB, f), 'utf8') : '');
const occurrences = (text: string, s: string) => text.split(s).length - 1;
const SECTION = 'components/LoyaltyFlightsSection.tsx';

const PINNED = [
  'Add a flight', 'Save flight', 'Upcoming flights', 'Recent flights', 'No flights to show', 'Flights that need a membership',
  'Add to this membership', 'Not mine', 'Ignore',
  'Miles and status credits depend on the rules of each airline program and are not calculated here.',
  'Cancelled flights are not shown.',
];

/**
 * The heading `Flights` as text of its own: JSX text or a string literal holding exactly that word. A
 * plain count would also find it inside `LoyaltyFlightsSection` and `Flights that need a membership`.
 */
const standaloneFlights = (text: string) => (text.match(/[>'"`]Flights[<'"`]/g) ?? []).length;

const CODE_CANARY = 'ZQ42ECODECANARY9';
const NUMBER_CANARY = 'ZQ42ENUMBERCANARY7K9X';

/** A fabricated overview: one hotel and one airline program, a membership on each, nothing else. */
const membership = (id: number, programId: number) => ({
  id, memberId: 5, memberDisplayName: 'ZQ42E Holder', programId, memberNumberMasked: null, tier: null, balance: null, unit: null,
  asOf: null, source: null, cardAccountId: null, cardAccountName: null, benefit: null, feeWatch: null, earn: null, earnEstimate: null, earnComparison: null,
});
const OVERVIEW = {
  members: [{ id: 5, displayName: 'ZQ42E Holder', userId: null }],
  programs: [
    { id: 3, name: 'ZQ42E Harbour Rewards', kind: 'hotel', defaultUnit: 'points', aliases: [] },
    { id: 4, name: 'ZQ42E Wings Club', kind: 'airline', defaultUnit: 'miles', aliases: [] },
  ],
  cards: [
    { programId: 3, programName: 'ZQ42E Harbour Rewards', programKind: 'hotel', memberships: [membership(2, 3)] },
    { programId: 4, programName: 'ZQ42E Wings Club', programKind: 'airline', memberships: [membership(6, 4)] },
  ],
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
    id: 1, membershipId: 2, programId: 3, property: null, maskedCode: '••••ARY1',
    checkIn: '2026-03-10', checkOut: '2026-03-12', nights: 2, state: 'booked', source: 'typed', award: null,
  }],
  queue: [],
};

const segment = (id: number, flightDate: string, maskedCode: string) => ({
  id, membershipId: 6, programId: 4, maskedCode, flightDate, origin: 'JFK', destination: 'LHR', carrier: 'ZQ', flightNumber: String(id + 10),
  state: 'booked' as const, source: 'email' as const, award: null,
});
const FLIGHTS = {
  airlineMembershipIds: [6],
  upcoming: [segment(1, '2026-04-02', '••••UPC1')],
  recent: [segment(2, '2026-03-20', '••••REC2')],
  queue: [],
};
type Flights = typeof FLIGHTS;

const render = (props: { overview: LoyaltyOverview; bookings?: LoyaltyBookings; flights?: Flights }) =>
  renderToStaticMarkup(createElement(TravelBoard as (p: typeof props) => ReturnType<typeof TravelBoard>, props)).replace(/<!-- -->/g, '');

/** The `Hotel stays` section's markup: its heading up to the next section. */
const staysOf = (html: string) => {
  const start = html.indexOf('Hotel stays');
  return start < 0 ? '' : html.slice(start, html.indexOf('</section>', start));
};

describe('the Flights section (P8-42e1b)', () => {
  it('T42e1b-U13: every pinned phrase once, no count or zero, a gated submit, a body with no source or id, and holds only in a non-empty queue', () => {
    const section = read(SECTION);
    expect(section, `${SECTION} exists`).not.toBe('');
    expect(standaloneFlights(section), 'the Flights heading').toBe(1);
    for (const s of PINNED) expect(occurrences(section, s), s).toBe(1);
    for (const s of ['Read stored mail now', 'Try failed mail again', 'Update from screenshot']) expect(section).not.toContain(s);
    // No count, total or stand-in zero.
    expect(section).not.toMatch(/\?\?\s*0\b|\|\|\s*0\b/);
    expect(section).not.toMatch(/\b(total|count|miles|credits)\s*[:=]/i);
    expect(section).not.toMatch(/\.length\}/);
    // The submit is disabled while saving, so a second tap cannot write twice.
    expect(section).toMatch(/<button type="submit" disabled=\{saving\}/);
    // The body: no source and no id; award null when blank, never false; state only booked or cancelled.
    const body = /send\('POST', '\/api\/v1\/loyalty\/segments', \{([^}]*)\}\);/.exec(section)?.[1] ?? '';
    expect(body).not.toBe('');
    expect(body).not.toMatch(/source|\bid\b/);
    expect(body).toMatch(/award: award === '' \? null : award === 'award'/);
    expect(section).toMatch(/setState\(e\.target\.value === 'cancelled' \? 'cancelled' : 'booked'\)/);
    // The hold buttons exist only inside the non-empty queue, and post to the flight route.
    expect(section).toMatch(/\{flights\.queue\.length > 0 && \(/);
    expect(section.indexOf('flights.queue.length > 0')).toBeLessThan(section.indexOf('<HeldFlight'));
    expect(section).toContain('`/api/v1/loyalty/inbox/flights/${item.id}`');
    // Rows show the masked code; nothing injects markup; one section element.
    expect(section).toMatch(/segment\.maskedCode/);
    expect(section).not.toMatch(/dangerouslySetInnerHTML|innerHTML/);
    expect(occurrences(section, '<section')).toBe(1);
    // Membership choices use the comma form, not the stays section's `·`.
    expect(section).toContain('`${c.programName}, ${m.memberDisplayName}`');
    expect(section).not.toContain('`${c.programName} · ${m.memberDisplayName}`');
  });

  it('T42e1b-U14: the board renders without flights, shows the section after Hotel stays only with something in it, and never the code', () => {
    const plain = render({ overview: OVERVIEW });
    expect(standaloneFlights(plain)).toBe(0);
    expect(plain).toContain('Certificates &amp; credits');
    expect(plain).toContain('Update from screenshot');
    const stays = render({ overview: OVERVIEW, bookings: BOOKINGS });
    expect(standaloneFlights(stays)).toBe(0);
    expect(occurrences(stays, 'Hotel stays')).toBe(1);

    const html = render({ overview: OVERVIEW, bookings: BOOKINGS, flights: FLIGHTS });
    expect(occurrences(html, '>Flights<')).toBe(1);
    expect(html.indexOf('Hotel stays')).toBeLessThan(html.indexOf('>Flights<'));
    expect(html.indexOf('>Flights<')).toBeLessThan(html.indexOf('Certificates &amp; credits'));
    expect(occurrences(html, 'Upcoming flights')).toBe(1);
    expect(occurrences(html, 'Recent flights')).toBe(1);
    expect(html).toContain('••••UPC1');
    expect(html).toContain('••••REC2');
    expect(html).toContain('ZQ42E Wings Club, ZQ42E Holder');
    for (const canary of [CODE_CANARY, NUMBER_CANARY]) expect(html).not.toContain(canary);
    expect(html).not.toContain('No flights to show');
    // The stays section is exactly as it was rendered without flights.
    expect(staysOf(html)).not.toBe('');
    expect(staysOf(html)).toBe(staysOf(stays));
    expect(html).toContain('Update from screenshot');

    const empty = render({ overview: OVERVIEW, flights: { airlineMembershipIds: [6], upcoming: [], recent: [], queue: [] } });
    expect(empty).toContain('No flights to show');
    expect(empty).not.toMatch(/\b0 flights/);
    expect(standaloneFlights(render({ overview: OVERVIEW, flights: { airlineMembershipIds: [], upcoming: [], recent: [], queue: [] } }))).toBe(0);

    const page = read('app/travel/page.tsx');
    expect(page).toMatch(/import \{ loadFlights \} from '@\/lib\/loyaltyFlightStore';/);
    expect(page).toMatch(/<TravelBoard overview=\{overview\} bookings=\{bookings\} flights=\{flights\} \/>/);
    expect(page).not.toMatch(/@\/lib\/db|raw_mail/);
    const board = read('components/TravelBoard.tsx');
    expect(board).toMatch(/flights\?: LoyaltyFlights/);
    expect(board).toMatch(/bookings\?: LoyaltyBookings/);
  });
});
