import { describe, expect, it } from '@jest/globals';

import { createGuidanceState, reduceGuidance } from '../guidance/reducer';
import type { GuidanceFrameResult } from '../guidance/reducer';

const goodFrame: GuidanceFrameResult = {
  ready: true,
  issues: [],
  progress: 1,
};

describe('reduceGuidance', () => {
  it('starts not ready with no issues and zero progress', () => {
    expect(createGuidanceState().guidance).toEqual({
      ready: false,
      issues: [],
      progress: 0,
    });
    expect(createGuidanceState()).not.toBe(createGuidanceState());
  });

  it('smooths progress using an exponential moving average', () => {
    const first = reduceGuidance(createGuidanceState(), goodFrame);
    const second = reduceGuidance(first, goodFrame);
    expect(first.guidance.progress).toBe(0.25);
    expect(second.guidance.progress).toBe(0.4375);
    expect(
      reduceGuidance(second, { ...goodFrame, progress: 0 }).guidance.progress,
    ).toBe(0.328125);
  });

  it('requires three consecutive ready frames by default', () => {
    let state = createGuidanceState();
    for (let index = 1; index <= 4; index++) {
      state = reduceGuidance(state, goodFrame);
      expect(state.guidance.ready).toBe(index >= 3);
    }
    expect(state.consecutiveFrames).toBe(3);
  });

  it('revokes readiness immediately and restarts the ready debounce', () => {
    let state = createGuidanceState();
    for (let index = 0; index < 3; index++) {
      state = reduceGuidance(state, goodFrame);
    }
    state = reduceGuidance(state, {
      ...goodFrame,
      issues: ['BLURRY'],
    });
    expect(state.guidance.ready).toBe(false);
    expect(state.guidance.issues).toEqual([]);
    state = reduceGuidance(state, goodFrame);
    expect(state.guidance.ready).toBe(false);
    expect(state.consecutiveFrames).toBe(1);
  });

  it('debounces issue changes and treats issues as an unordered set', () => {
    let state = createGuidanceState();
    const badFrame: GuidanceFrameResult = {
      ready: true,
      issues: ['TILTED', 'BLURRY', 'BLURRY'],
      progress: 0.2,
    };
    state = reduceGuidance(state, badFrame);
    state = reduceGuidance(state, {
      ...badFrame,
      issues: ['BLURRY', 'TILTED'],
    });
    expect(state.guidance.issues).toEqual([]);
    state = reduceGuidance(state, badFrame);
    expect(state.guidance.issues).toEqual(['BLURRY', 'TILTED']);
    expect(state.guidance.ready).toBe(false);
    state = reduceGuidance(state, goodFrame);
    expect(state.guidance.issues).toEqual(['BLURRY', 'TILTED']);
    state = reduceGuidance(state, goodFrame);
    state = reduceGuidance(state, goodFrame);
    expect(state.guidance.issues).toEqual([]);
    expect(state.guidance.ready).toBe(true);
  });

  it('does not commit alternating issue sets', () => {
    let state = createGuidanceState();
    for (let index = 0; index < 10; index++) {
      state = reduceGuidance(state, {
        ready: false,
        issues: index % 2 === 0 ? ['BLURRY'] : ['TILTED'],
        progress: 0.5,
      });
    }
    expect(state.guidance.issues).toEqual([]);
    expect(state.guidance.ready).toBe(false);
  });

  it('supports immediate updates and a custom smoothing factor', () => {
    const state = reduceGuidance(createGuidanceState(), goodFrame, {
      smoothingFactor: 1,
      debounceFrames: 1,
    });
    expect(state.guidance).toEqual(goodFrame);
    expect(
      reduceGuidance(createGuidanceState(), goodFrame, {
        smoothingFactor: 0.5,
      }).guidance.progress,
    ).toBe(0.5);
  });

  it('does not infer readiness from progress alone', () => {
    expect(
      reduceGuidance(
        createGuidanceState(),
        { ...goodFrame, ready: false },
        { debounceFrames: 1 },
      ).guidance.ready,
    ).toBe(false);
  });

  it.each([
    { progress: -1, expected: 0 },
    { progress: 2, expected: 1 },
    { progress: Number.NaN, expected: 0 },
    { progress: Number.POSITIVE_INFINITY, expected: 1 },
    { progress: Number.NEGATIVE_INFINITY, expected: 0 },
  ])('normalizes progress $progress', ({ progress, expected }) => {
    expect(
      reduceGuidance(
        createGuidanceState(),
        { ...goodFrame, progress },
        { smoothingFactor: 1 },
      ).guidance.progress,
    ).toBe(expected);
  });

  it.each([0, -1, 1.1, Number.NaN, Number.POSITIVE_INFINITY])(
    'rejects invalid smoothingFactor %s',
    (smoothingFactor) => {
      expect(() =>
        reduceGuidance(createGuidanceState(), goodFrame, { smoothingFactor }),
      ).toThrow(RangeError);
    },
  );

  it.each([0, -1, 1.5, Number.NaN, Number.POSITIVE_INFINITY, 2 ** 53])(
    'rejects invalid debounceFrames %s',
    (debounceFrames) => {
      expect(() =>
        reduceGuidance(createGuidanceState(), goodFrame, { debounceFrames }),
      ).toThrow(RangeError);
    },
  );

  it('is deterministic and does not mutate or retain frame arrays', () => {
    const state = createGuidanceState();
    Object.freeze(state.guidance.issues);
    Object.freeze(state.guidance);
    Object.freeze(state.candidate.issues);
    Object.freeze(state.candidate);
    Object.freeze(state);
    const frame = Object.freeze({
      ready: false,
      issues: Object.freeze(['TILTED', 'BLURRY'] as const),
      progress: 0.5,
    });

    const result = reduceGuidance(state, frame, { debounceFrames: 1 });
    expect(result).toEqual(reduceGuidance(state, frame, { debounceFrames: 1 }));
    expect(result.guidance.issues).not.toBe(frame.issues);
    expect(frame.issues).toEqual(['TILTED', 'BLURRY']);
    expect(state.guidance.progress).toBe(0);
  });
});
