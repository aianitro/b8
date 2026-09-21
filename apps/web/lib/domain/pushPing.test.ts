import { describe, expect, it } from 'vitest';
import {
  chunkDevices, classifyTicket, MAX_DEVICES_PER_REQUEST, PING, shouldPing,
} from './pushPing';

describe('what leaves the machine', () => {
  it('carries no financial content at all', () => {
    // THE ASSERTION THE DECISION RESTS ON. The owner chose a content-free ping because push lands
    // on a lock screen readable without unlocking the phone; this fixture is what stops a later
    // "wording tweak" quietly becoming a change to what leaves the machine.
    const text = `${PING.title} ${PING.body}`.toLowerCase();
    for (const leak of ['$', 'budget', 'over', 'dining', 'groceries', 'spent', 'category', '%']) {
      expect(text).not.toContain(leak);
    }
  });

  it('has no digit in the BODY, so no figure can hide there', () => {
    // The body, not the title: the product is called "b8" and that 8 is a name, not a figure.
    // THIS IS THE THIRD TIME THAT 8 HAS TRIPPED A DIGIT CHECK in this codebase — twice in the eval
    // grader, where `numbers_in` read the 8 out of "B8 Finance" and failed three correct refusals.
    // The fix is the same both times: narrow the control to where the rule actually applies rather
    // than loosen the rule.
    expect(/\d/.test(PING.body)).toBe(false);
  });

  it('pins the title to the product name exactly, so nothing can be appended to it', () => {
    expect(PING.title).toBe('b8');
  });

  it('still says enough to be worth opening', () => {
    expect(PING.body.length).toBeGreaterThan(10);
  });
});

describe('whether to ping', () => {
  it('pings when the run delivered something', () => {
    expect(shouldPing(['digest'])).toBe(true);
    expect(shouldPing(['projected-breach', 'digest'])).toBe(true);
  });

  it('does not ping when nothing was delivered', () => {
    // The negative control for inherited suppression: a digest suppressed as "not news twice", or
    // alerts disabled, or a failed send, all arrive here as an empty list.
    expect(shouldPing([])).toBe(false);
  });
});

describe('batching', () => {
  it('leaves a small household in one request', () => {
    expect(chunkDevices(['a', 'b'])).toEqual([['a', 'b']]);
  });

  it('splits at Expo’s documented cap rather than truncating', () => {
    const many = Array.from({ length: MAX_DEVICES_PER_REQUEST + 1 }, (_, i) => i);
    const chunks = chunkDevices(many);
    expect(chunks.length).toBe(2);
    expect(chunks[0].length).toBe(MAX_DEVICES_PER_REQUEST);
    expect(chunks[1].length).toBe(1);
    expect(chunks.flat()).toEqual(many);
  });

  it('handles an empty device list without producing an empty request', () => {
    expect(chunkDevices([])).toEqual([]);
  });
});

describe('classifying a ticket', () => {
  it('reports success as no failure', () => {
    expect(classifyTicket({ status: 'ok' })).toBeNull();
  });

  it('singles out an uninstalled app, so the row stops being a target', () => {
    expect(classifyTicket({ status: 'error', details: { error: 'DeviceNotRegistered' } }))
      .toBe('unregistered');
  });

  it('classifies anything else rather than transcribing it', () => {
    // A provider's rejection quotes the request back. `push_devices.last_error` is a closed set for
    // the same reason `alert_sends.failure_reason` is.
    expect(classifyTicket({ status: 'error', details: { error: 'MessageTooBig' } })).toBe('rejected');
    expect(classifyTicket({ status: 'error' })).toBe('rejected');
  });
});
