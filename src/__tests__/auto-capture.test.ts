import { describe, expect, it } from '@jest/globals';

import {
  DEFAULT_AUTO_CAPTURE_HOLD_MS,
  acknowledgeAutoCapture,
  createAutoCaptureState,
  reduceAutoCapture,
} from '../guidance/autoCapture';

describe('reduceAutoCapture', () => {
  it('fires once after holdMs of continuous ready and re-arms after ready drops', () => {
    expect(DEFAULT_AUTO_CAPTURE_HOLD_MS).toBe(800);
    let state = createAutoCaptureState();
    expect(state).toEqual({ readySince: null, fired: false, due: false });
    state = reduceAutoCapture(state, { ready: true, now: 0 }, 800);
    state = reduceAutoCapture(state, { ready: true, now: 799 }, 800);
    expect(state.due).toBe(false);
    state = reduceAutoCapture(state, { ready: true, now: 800 }, 800);
    expect(state.due).toBe(true);
    state = acknowledgeAutoCapture(state);
    expect(state.due).toBe(false);
    state = reduceAutoCapture(state, { ready: true, now: 5000 }, 800);
    expect(state.due).toBe(false);
    state = reduceAutoCapture(state, { ready: false, now: 5001 }, 800);
    expect(state).toEqual({ readySince: null, fired: false, due: false });
    state = reduceAutoCapture(state, { ready: true, now: 5002 }, 800);
    state = reduceAutoCapture(state, { ready: true, now: 5802 }, 800);
    expect(state.due).toBe(true);
  });

  it('stays due without acknowledgement while ready continues', () => {
    let state = reduceAutoCapture(
      createAutoCaptureState(),
      { ready: true, now: 0 },
      0,
    );
    expect(state.due).toBe(true);
    state = reduceAutoCapture(state, { ready: true, now: 10 }, 0);
    expect(state.due).toBe(true);
  });

  it('clears a pending capture when ready drops', () => {
    let state = reduceAutoCapture(
      createAutoCaptureState(),
      { ready: true, now: 0 },
      0,
    );
    state = reduceAutoCapture(state, { ready: false, now: 1 }, 0);
    expect(state.due).toBe(false);
  });

  it('rejects a negative or non-finite hold', () => {
    expect(() =>
      reduceAutoCapture(createAutoCaptureState(), { ready: true, now: 0 }, -1),
    ).toThrow(RangeError);
    expect(() =>
      reduceAutoCapture(
        createAutoCaptureState(),
        { ready: true, now: 0 },
        Number.NaN,
      ),
    ).toThrow(RangeError);
  });
});
