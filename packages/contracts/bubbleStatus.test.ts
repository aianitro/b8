import { describe, expect, it } from 'vitest';
import { bubbleState, type BubbleStatusInput } from './bubbleStatus';

// The rule moved out of the web app when the phone became its third caller. These pin the four
// states and, more importantly, the two precedence rules that are easy to reorder by accident:
// `over` outranks `tooEarly`, and `tooEarly` outranks a projection.

const cat = (over: Partial<BubbleStatusInput> = {}): BubbleStatusInput => ({
  budgeted: 100, actual: 0, projectedRatio: 0.5, tooEarly: false, ...over,
});

describe('bubbleState', () => {
  it('is inside when the projection finishes under the budget', () => {
    expect(bubbleState(cat({ actual: 30, projectedRatio: 0.9 }))).toBe('inside');
  });

  it('is heading-over above 1.0 but not at it', () => {
    expect(bubbleState(cat({ projectedRatio: 1.0 }))).toBe('inside');
    expect(bubbleState(cat({ projectedRatio: 1.0001 }))).toBe('heading-over');
  });

  it('is over on spend past the line, not on a projection', () => {
    expect(bubbleState(cat({ actual: 100 }))).toBe('inside');      // at the line is not past it
    expect(bubbleState(cat({ actual: 100.01 }))).toBe('over');
  });

  // The precedence that carries the design: already-over is observed and needs no estimate, so a
  // month too young to project from is still over if it has already breached.
  it('reports over even when the month is too early to project', () => {
    expect(bubbleState(cat({ actual: 150, tooEarly: true, projectedRatio: null }))).toBe('over');
  });

  it('is too-early on the flag, and on a null ratio, before any projection is read', () => {
    expect(bubbleState(cat({ actual: 10, tooEarly: true, projectedRatio: 9 }))).toBe('too-early');
    expect(bubbleState(cat({ actual: 10, projectedRatio: null }))).toBe('too-early');
  });

  // `null` and `0` are opposite verdicts and `overviewRead` is careful to emit the right one;
  // this pins the receiving half of that contract.
  it('separates "no basis to project" from "projects at zero"', () => {
    expect(bubbleState(cat({ projectedRatio: null }))).toBe('too-early');
    expect(bubbleState(cat({ projectedRatio: 0 }))).toBe('inside');
  });

  // A refund month: negative spend cannot be over, and has a projection like any other.
  it('handles a category refunded into the negative', () => {
    expect(bubbleState(cat({ actual: -20, projectedRatio: 0.1 }))).toBe('inside');
  });

  // A zero budget makes any spend over, which is the honest reading: there was no allowance.
  it('treats any spend against a zero budget as over', () => {
    expect(bubbleState(cat({ budgeted: 0, actual: 0.01 }))).toBe('over');
    expect(bubbleState(cat({ budgeted: 0, actual: 0, projectedRatio: null }))).toBe('too-early');
  });
});
