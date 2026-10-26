import { describe, expect, it } from '@jest/globals';

import type { DetectorFrameResult } from '../guidance/detection';
import { createGuidanceState, reduceGuidance } from '../guidance/reducer';
import {
  createGuidanceSession,
  reduceGuidanceSession,
  validateGuidanceSessionOptions,
} from '../guidance/session';
import type {
  GuidanceSessionOptions,
  GuidanceSessionState,
} from '../guidance/session';

const VEHICLE = {
  boxes: [0.2, 0.3, 0.8, 0.9],
  scores: [0.9],
  classes: [0],
  frameWidth: 480,
  frameHeight: 640,
};
const EMPTY = {
  boxes: [],
  scores: [],
  classes: [],
  frameWidth: 480,
  frameHeight: 640,
};
const DETECTION: GuidanceSessionOptions = { debounceFrames: 1, detection: {} };

function frame(
  state: GuidanceSessionState,
  now: number,
  options: GuidanceSessionOptions
): GuidanceSessionState {
  return reduceGuidanceSession(
    state,
    {
      type: 'frame',
      frame: { ready: true, issues: [], progress: 1 },
      now,
    },
    options
  );
}

function detect(
  state: GuidanceSessionState,
  result: DetectorFrameResult,
  now: number,
  options: GuidanceSessionOptions
): GuidanceSessionState {
  return reduceGuidanceSession(
    state,
    { type: 'detection', result, generation: state.generation, now },
    options
  );
}

describe('reduceGuidanceSession', () => {
  it('stays not ready until a fresh detection arrives when detection is configured', () => {
    let state = frame(createGuidanceSession(), 0, DETECTION);
    expect(state.guidance.guidance.ready).toBe(false);
    state = detect(state, VEHICLE, 10, DETECTION);
    state = frame(state, 20, DETECTION);
    expect(state.guidance.guidance.ready).toBe(true);
    state = frame(state, 1600, DETECTION);
    expect(state.guidance.guidance.ready).toBe(false);
  });

  it('shows NO_VEHICLE for an empty detection and detectorError for a failure', () => {
    let state = detect(createGuidanceSession(), EMPTY, 0, DETECTION);
    state = frame(state, 10, DETECTION);
    expect(state.guidance.guidance.issues).toEqual(['NO_VEHICLE']);
    expect(state.detectorError).toBeNull();

    state = detect(state, { error: 'E_MODEL_LOAD' }, 20, DETECTION);
    state = frame(state, 30, DETECTION);
    expect(state.guidance.guidance.issues).not.toContain('NO_VEHICLE');
    expect(state.guidance.guidance.ready).toBe(false);
    expect(state.detectorError).toBe('E_MODEL_LOAD');
  });

  it('ignores a detection from before a reset', () => {
    let state = createGuidanceSession();
    const before = state.generation;
    state = reduceGuidanceSession(state, { type: 'reset' }, DETECTION);
    expect(state.generation).toBe(before + 1);
    state = reduceGuidanceSession(
      state,
      { type: 'detection', result: VEHICLE, generation: before, now: 0 },
      DETECTION
    );
    expect(state.snapshot).toBeNull();
    state = frame(state, 10, DETECTION);
    expect(state.guidance.guidance.ready).toBe(false);
  });

  it('raises autoCaptureDue once after holdMs of ready', () => {
    const options = { ...DETECTION, autoCapture: { holdMs: 800 } };
    let state = detect(createGuidanceSession(), VEHICLE, 0, options);
    state = frame(state, 0, options);
    expect(state.autoCapture.due).toBe(false);
    state = detect(state, VEHICLE, 800, options);
    state = frame(state, 800, options);
    expect(state.autoCapture.due).toBe(true);
    state = reduceGuidanceSession(
      state,
      { type: 'acknowledgeAutoCapture' },
      options
    );
    state = detect(state, VEHICLE, 2000, options);
    state = frame(state, 2000, options);
    expect(state.autoCapture.due).toBe(false);
  });

  it('does not track auto-capture unless it is configured', () => {
    let state = detect(createGuidanceSession(), VEHICLE, 0, DETECTION);
    state = frame(state, 0, DETECTION);
    state = frame(state, 1000, DETECTION);
    expect(state.autoCapture.due).toBe(false);
  });

  it('clears auto-capture state while auto capture is off', () => {
    const on = { ...DETECTION, autoCapture: { holdMs: 800 } };
    let state = detect(createGuidanceSession(), VEHICLE, 0, on);
    state = frame(state, 0, on);
    expect(state.autoCapture.readySince).toBe(0);
    state = detect(state, VEHICLE, 900, DETECTION);
    state = frame(state, 900, DETECTION);
    expect(state.autoCapture).toEqual({
      readySince: null,
      fired: false,
      due: false,
    });
    // Re-enabled: a fresh hold starts instead of firing at once from the old readySince.
    state = detect(state, VEHICLE, 1000, on);
    state = frame(state, 1000, on);
    expect(state.autoCapture.due).toBe(false);
  });

  it('measures detection freshness from capturedAt when the result carries it', () => {
    let state = reduceGuidanceSession(
      createGuidanceSession(),
      {
        type: 'detection',
        result: { ...VEHICLE, capturedAt: 0 },
        generation: 0,
        now: 1000,
      },
      DETECTION
    );
    state = frame(state, 1400, DETECTION);
    expect(state.guidance.guidance.ready).toBe(true);
    state = frame(state, 1600, DETECTION);
    expect(state.guidance.guidance.ready).toBe(false);
  });

  it('dates a detection from a clock that runs ahead at its arrival', () => {
    // On a device, capturedAt from the worklet runtime was 11 ms after the JS runtime's arrival time.
    let state = reduceGuidanceSession(
      createGuidanceSession(),
      {
        type: 'detection',
        result: { ...VEHICLE, capturedAt: 1011 },
        generation: 0,
        now: 1000,
      },
      DETECTION
    );
    state = frame(state, 1005, DETECTION);
    expect(state.guidance.guidance.ready).toBe(true);
    state = frame(state, 2600, DETECTION);
    expect(state.guidance.guidance.ready).toBe(false);
  });

  it('behaves as before without detection', () => {
    const options = { debounceFrames: 1 };
    const state = frame(createGuidanceSession(), 0, options);
    expect(state.guidance).toEqual(
      reduceGuidance(
        createGuidanceState(),
        { ready: true, issues: [], progress: 1 },
        options
      )
    );
    expect(state.guidance.guidance.ready).toBe(true);
    expect(state.detectorError).toBeNull();
  });
});

describe('validateGuidanceSessionOptions', () => {
  it('rejects invalid session options', () => {
    expect(() =>
      validateGuidanceSessionOptions({ detection: { staleAfterMs: -1 } })
    ).toThrow(RangeError);
    expect(() =>
      validateGuidanceSessionOptions({ autoCapture: { holdMs: Number.NaN } })
    ).toThrow(RangeError);
    expect(() => validateGuidanceSessionOptions({})).not.toThrow();
  });
});
